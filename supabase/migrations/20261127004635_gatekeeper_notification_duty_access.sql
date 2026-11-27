create or replace function private.has_active_gatekeeper_duty(p_site_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.site_gatekeeper_duties d
    join public.tourism_sites s on s.id = d.site_id
    join public.profiles p on p.id = (select auth.uid())
    join public.staff_assignments a on a.profile_id = p.id and a.site_id = d.site_id
      and a.staff_role = 'gatekeeper' and a.is_active
    where d.site_id = p_site_id and d.status in ('scheduled', 'active')
      and d.shift_start_at <= statement_timestamp() and d.shift_end_at > statement_timestamp()
      and d.duty_date = (statement_timestamp() at time zone coalesce(s.timezone, 'Asia/Manila'))::date
      and p.role = 'gatekeeper' and p.account_status = 'active'
      and (d.primary_gatekeeper_id = p.id or exists (
        select 1 from public.site_gatekeeper_duty_support ds
        where ds.duty_id = d.id and ds.gatekeeper_id = p.id
      ))
  )
$$;
revoke all on function private.has_active_gatekeeper_duty(uuid) from public, anon;
grant execute on function private.has_active_gatekeeper_duty(uuid) to authenticated;

create or replace function private.can_review_site_payment(p_site_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select case private.current_role()
    when 'site_admin' then private.user_has_site_role(p_site_id, 'site_admin')
    when 'gatekeeper' then private.user_has_site_role(p_site_id, 'gatekeeper')
      and private.has_active_gatekeeper_duty(p_site_id)
    else false
  end
$$;
revoke all on function private.can_review_site_payment(uuid) from public, anon;
grant execute on function private.can_review_site_payment(uuid) to authenticated;

alter table public.notifications add column if not exists resolved_at timestamptz;

with ranked as (
  select id, first_value(id) over (
      partition by user_id, booking_id
      order by (resolved_at is null) desc, (read_at is null) desc, created_at desc, id
    ) as keep_id,
    bool_or(read_at is null) over (partition by user_id, booking_id) as has_unread,
    bool_or(resolved_at is null) over (partition by user_id, booking_id) as has_unresolved
  from public.notifications
  where notification_type = 'payment_verification' and booking_id is not null
)
update public.notifications n
set read_at = case when ranked.has_unread then null else n.read_at end,
    resolved_at = case when ranked.has_unresolved then null else coalesce(n.resolved_at, now()) end
from ranked
where n.id = ranked.keep_id;

with duplicates as (
  select id, row_number() over (
    partition by user_id, booking_id
    order by (resolved_at is null) desc, (read_at is null) desc, created_at desc, id
  ) as ordinal
  from public.notifications
  where notification_type = 'payment_verification' and booking_id is not null
)
update public.notifications n set resolved_at = coalesce(n.resolved_at, now())
from duplicates d where n.id = d.id and d.ordinal > 1;

drop index if exists public.notifications_payment_verification_booking_uidx;
create unique index notifications_payment_verification_booking_uidx
  on public.notifications(user_id, booking_id)
  where notification_type = 'payment_verification' and booking_id is not null and resolved_at is null;

create or replace function private.notify_gatekeepers_of_payment_proof()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_booking public.bookings%rowtype;
begin
  select * into v_booking from public.bookings where id = new.booking_id;
  if not found then return new; end if;

  if new.provider = 'manual' and new.payment_status = 'pending_verification' and new.proof_submitted_at is not null then
    if tg_op = 'UPDATE' and old.payment_status is not distinct from new.payment_status
       and old.proof_submitted_at is not distinct from new.proof_submitted_at then return new; end if;
    insert into public.notifications(user_id, booking_id, title, message, notification_type, read_at, resolved_at)
    select a.profile_id, v_booking.id, 'Payment proof needs verification',
      'Reservation ' || v_booking.booking_reference || ' has a payment proof for ' || btrim(new.currency::text) || ' ' || to_char(new.amount, 'FM999,999,990.00') || '.',
      'payment_verification', null, null
    from public.staff_assignments a
    where a.site_id = v_booking.site_id and a.staff_role = 'gatekeeper' and a.is_active
    on conflict (user_id, booking_id) where notification_type = 'payment_verification' and booking_id is not null and resolved_at is null
    do update set title = excluded.title, message = excluded.message, created_at = now(), read_at = null, resolved_at = null;
  elsif tg_op = 'UPDATE' and old.payment_status is distinct from new.payment_status
      and not exists (
        select 1 from public.payments p
        where p.booking_id = new.booking_id and p.id <> new.id
          and p.payment_status = 'pending_verification' and p.proof_submitted_at is not null
      ) then
    update public.notifications set resolved_at = now()
    where booking_id = new.booking_id and notification_type = 'payment_verification' and resolved_at is null;
  end if;
  return new;
end
$$;
revoke all on function private.notify_gatekeepers_of_payment_proof() from public, anon, authenticated;

create or replace function private.resolve_gatekeeper_reservation_notifications()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.payment_status is distinct from 'pending'
     or new.booking_status in ('cancelled', 'expired', 'completed') then
    update public.notifications set resolved_at = now()
    where booking_id = new.id and notification_type = 'reservation_received' and resolved_at is null;
  end if;
  return new;
end
$$;
revoke all on function private.resolve_gatekeeper_reservation_notifications() from public, anon, authenticated;
drop trigger if exists bookings_resolve_gatekeeper_notifications on public.bookings;
create trigger bookings_resolve_gatekeeper_notifications
after update of payment_status, booking_status on public.bookings
for each row execute function private.resolve_gatekeeper_reservation_notifications();

create or replace function public.review_manual_payment(p_payment_id uuid, p_approve boolean, p_rejection_reason text default null)
returns text language plpgsql security definer set search_path = ''
as $$
declare v_payment public.payments%rowtype; v_booking public.bookings%rowtype; v_reference text;
begin
  if private.current_role() is distinct from 'tourism_office'
     and private.current_role() is distinct from 'site_admin'
     and private.current_role() is distinct from 'gatekeeper' then
    raise exception 'Authorized destination staff access required' using errcode = '42501';
  end if;
  select * into v_payment from public.payments p where p.id = p_payment_id and p.provider = 'manual' for update;
  if not found or v_payment.payment_mode <> 'demo' or v_payment.payment_status <> 'pending_verification' or v_payment.proof_submitted_at is null then
    raise exception 'Demo payment is not awaiting verification';
  end if;
  select * into v_booking from public.bookings b where b.id = v_payment.booking_id for update;
  if not found or (private.current_role() = 'gatekeeper' and not private.can_review_site_payment(v_booking.site_id))
     or (private.current_role() is distinct from 'gatekeeper' and not private.can_manage_site(v_booking.site_id)) then
    raise exception 'You cannot review payments for this destination' using errcode = '42501';
  end if;
  if v_booking.visitor_id = (select auth.uid()) then
    raise exception 'You cannot approve your own reservation' using errcode = '42501';
  end if;
  if p_approve then
    update public.payments set payment_status = 'paid', verified_at = now(), verified_by = (select auth.uid()) where id = v_payment.id;
    update public.bookings set payment_status = 'paid', booking_status = 'confirmed', hold_expires_at = null where id = v_booking.id;
    update public.booking_holds set status = 'consumed' where booking_id = v_booking.id;
    insert into public.notifications(user_id, title, message, notification_type)
      select v_booking.visitor_id, 'Demo payment approved', 'Your demo payment was approved. Your booking is confirmed. Demo receipt is available in My Bookings.', 'payment_verified'
      where v_booking.visitor_id is not null;
    select receipt_reference into v_reference from public.payments where id = v_payment.id;
    return v_reference;
  end if;
  if nullif(trim(p_rejection_reason), '') is null or length(trim(p_rejection_reason)) > 1000 then
    raise exception 'A rejection reason is required';
  end if;
  if v_payment.payment_deadline <= now() then
    update public.payments set payment_status = 'expired', rejection_reason = trim(p_rejection_reason) where id = v_payment.id;
    update public.bookings set payment_status = 'expired', booking_status = 'expired', hold_expires_at = null where id = v_booking.id;
    update public.booking_holds set status = 'expired' where booking_id = v_booking.id;
  else
    update public.payments set payment_status = 'rejected', rejection_reason = trim(p_rejection_reason) where id = v_payment.id;
    update public.bookings set payment_status = 'rejected', hold_expires_at = v_payment.payment_deadline where id = v_booking.id;
    update public.booking_holds set expires_at = v_payment.payment_deadline where booking_id = v_booking.id and status = 'active';
  end if;
  insert into public.notifications(user_id, title, message, notification_type)
    select v_booking.visitor_id, 'Demo payment needs attention',
      case when v_payment.payment_deadline <= now() then 'Your demo proof was rejected after the deadline. The reservation expired.'
        else 'Your demo proof was rejected: ' || trim(p_rejection_reason) || '. You may resubmit before the deadline.' end,
      'payment_rejected'
    where v_booking.visitor_id is not null;
  return null;
end
$$;
revoke all on function public.review_manual_payment(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.review_manual_payment(uuid, boolean, text) to authenticated;

drop policy if exists notifications_read_own on public.notifications;
create policy notifications_read_own on public.notifications for select to authenticated
using (
  user_id = (select auth.uid())
  and (
    private.current_role() is distinct from 'gatekeeper'
    or notification_type not in ('reservation_received', 'payment_verification')
    or exists (
      select 1 from public.bookings b
      where b.id = notifications.booking_id
        and private.has_active_gatekeeper_duty(b.site_id)
    )
  )
);

drop policy if exists notifications_mark_read on public.notifications;
create policy notifications_mark_read on public.notifications for update to authenticated
using (
  user_id = (select auth.uid())
  and (
    private.current_role() is distinct from 'gatekeeper'
    or notification_type not in ('reservation_received', 'payment_verification')
    or (resolved_at is null and exists (
      select 1 from public.bookings b
      where b.id = notifications.booking_id
        and private.has_active_gatekeeper_duty(b.site_id)
    ))
  )
)
with check (user_id = (select auth.uid()));
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

drop policy if exists payments_read_owner_or_reviewer on public.payments;
create policy payments_read_owner_or_reviewer on public.payments for select to authenticated
using (exists (
  select 1 from public.bookings b
  where b.id = payments.booking_id
    and (b.visitor_id = (select auth.uid())
      or (payments.provider = 'manual' and payments.payment_status = 'pending_verification'
        and (private.current_role() = 'gatekeeper'
          and private.has_active_gatekeeper_duty(b.site_id)
          or private.current_role() = 'site_admin' and private.can_manage_site(b.site_id)
          or private.user_has_role('tourism_office') and private.can_manage_site(b.site_id))))
));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'payments') then
      alter publication supabase_realtime add table public.payments;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'site_gatekeeper_duties') then
      alter publication supabase_realtime add table public.site_gatekeeper_duties;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'site_gatekeeper_duty_support') then
      alter publication supabase_realtime add table public.site_gatekeeper_duty_support;
    end if;
  end if;
end
$$;
