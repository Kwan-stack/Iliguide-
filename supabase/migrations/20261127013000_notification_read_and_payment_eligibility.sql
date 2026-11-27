drop policy if exists notifications_mark_read on public.notifications;
create policy notifications_mark_read on public.notifications for update to authenticated
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
)
with check (user_id = (select auth.uid()) and read_at is not null);

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
  if not found or v_booking.booking_status <> 'awaiting_payment' then
    raise exception 'Demo payment booking is no longer awaiting verification';
  end if;
  if (private.current_role() = 'gatekeeper' and not private.can_review_site_payment(v_booking.site_id))
     or (private.current_role() is distinct from 'gatekeeper' and not private.can_manage_site(v_booking.site_id)) then
    raise exception 'You cannot review payments for this destination' using errcode = '42501';
  end if;
  if v_booking.visitor_id = (select auth.uid()) then
    raise exception 'You cannot approve your own reservation';
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
