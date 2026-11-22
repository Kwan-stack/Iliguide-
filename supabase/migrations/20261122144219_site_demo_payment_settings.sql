create table public.site_demo_payment_settings (
  site_id uuid primary key references public.tourism_sites(id) on delete cascade,
  gcash_enabled boolean not null default true,
  gcash_account_name text not null default 'Illiguide Demo Tourism Office'
    check (length(trim(gcash_account_name)) between 3 and 120 and gcash_account_name ilike '%demo%'),
  gcash_account_identifier text not null
    check (gcash_account_identifier ~ '^DEMO-GCASH-[A-Z0-9-]{3,40}$'),
  maya_enabled boolean not null default true,
  maya_account_name text not null default 'Illiguide Demo Tourism Office'
    check (length(trim(maya_account_name)) between 3 and 120 and maya_account_name ilike '%demo%'),
  maya_account_identifier text not null
    check (maya_account_identifier ~ '^DEMO-MAYA-[A-Z0-9-]{3,40}$'),
  onsite_instructions text not null default 'Present your booking reference at the destination entrance and complete payment with the authorized Gatekeeper.'
    check (length(trim(onsite_instructions)) between 1 and 1000),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.site_demo_payment_settings(site_id, gcash_account_identifier, maya_account_identifier)
select s.id,
  'DEMO-GCASH-' || upper(substr(replace(s.id::text, '-', ''), 1, 8)),
  'DEMO-MAYA-' || upper(substr(replace(s.id::text, '-', ''), 1, 8))
from public.tourism_sites s
where s.status = 'published'
on conflict (site_id) do nothing;

create function private.initialize_site_demo_payment_settings()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.site_demo_payment_settings(site_id, gcash_account_identifier, maya_account_identifier)
  values (new.id,
    'DEMO-GCASH-' || upper(substr(replace(new.id::text, '-', ''), 1, 8)),
    'DEMO-MAYA-' || upper(substr(replace(new.id::text, '-', ''), 1, 8)))
  on conflict (site_id) do nothing;
  return new;
end
$$;
revoke all on function private.initialize_site_demo_payment_settings() from public, anon, authenticated;
create trigger tourism_site_demo_payment_settings after insert on public.tourism_sites
  for each row execute function private.initialize_site_demo_payment_settings();

create trigger site_demo_payment_settings_updated_at before update on public.site_demo_payment_settings
  for each row execute function private.set_updated_at();

alter table public.site_demo_payment_settings enable row level security;
create policy site_demo_payment_settings_visitor_read on public.site_demo_payment_settings
  for select to authenticated using (
    private.current_role() = 'visitor'
    and exists (select 1 from public.tourism_sites s where s.id = site_id and s.status = 'published')
  );
create policy site_demo_payment_settings_manager_read on public.site_demo_payment_settings
  for select to authenticated using (private.can_manage_site(site_id));
create policy site_demo_payment_settings_manager_insert on public.site_demo_payment_settings
  for insert to authenticated with check (private.can_manage_site(site_id));
create policy site_demo_payment_settings_manager_update on public.site_demo_payment_settings
  for update to authenticated using (private.can_manage_site(site_id))
  with check (private.can_manage_site(site_id));
grant select, insert, update on public.site_demo_payment_settings to authenticated;
revoke delete on public.site_demo_payment_settings from public, anon, authenticated;

drop policy if exists manual_payment_proof_owner_read on storage.objects;
create policy manual_payment_proof_owner_read on storage.objects for select to authenticated
using (bucket_id = 'manual-payment-proofs'
  and exists (select 1 from public.payments p join public.bookings b on b.id = p.booking_id
    where b.id::text = (storage.foldername(name))[1]
      and (b.visitor_id = (select auth.uid()) or private.can_manage_site(b.site_id))));

create function private.require_demo_simulation_before_proof()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.payment_mode = 'demo' and new.payment_status = 'pending_verification'
     and (old.transaction_reference is null or new.transaction_reference is distinct from old.transaction_reference) then
    raise exception 'Complete the demo payment simulation before submitting proof';
  end if;
  return new;
end
$$;
revoke all on function private.require_demo_simulation_before_proof() from public, anon, authenticated;
create trigger payments_require_demo_simulation before update on public.payments
  for each row execute function private.require_demo_simulation_before_proof();

create or replace function public.begin_manual_payment(p_booking_id uuid, p_payment_application text)
returns table (payment_id uuid, payment_deadline timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare v_booking public.bookings%rowtype; v_payment public.payments%rowtype; v_deadline timestamptz; v_window_minutes integer;
begin
  if private.current_role() is distinct from 'visitor' then
    raise exception 'Only active visitor accounts can begin online payment' using errcode = '42501';
  end if;
  if p_payment_application is null or p_payment_application not in ('gcash', 'maya') then raise exception 'Choose a supported payment application'; end if;
  select * into v_booking from public.bookings b
    where b.id = p_booking_id and b.visitor_id = (select auth.uid()) for update;
  if not found or v_booking.booking_status <> 'awaiting_payment' or v_booking.hold_expires_at <= now()
     or v_booking.total_amount <= 0 then raise exception 'This reservation hold is unavailable'; end if;
  select s.payment_window_minutes into v_window_minutes from public.tourism_payment_settings s where s.id and s.demo_mode;
  if v_window_minutes is null
     or not exists (select 1 from public.site_demo_payment_settings s where s.site_id = v_booking.site_id
       and ((p_payment_application = 'gcash' and s.gcash_enabled)
         or (p_payment_application = 'maya' and s.maya_enabled))) then
    raise exception 'This demo payment method is not enabled for the destination';
  end if;
  select * into v_payment from public.payments p where p.booking_id = p_booking_id and p.provider = 'manual' for update;
  if found then
    if v_payment.payment_status = 'pending' and v_payment.payment_deadline > now() then
      update public.payments set payment_application = p_payment_application where id = v_payment.id;
      return query select v_payment.id, v_payment.payment_deadline;
      return;
    end if;
    raise exception 'A manual payment session already exists for this reservation';
  end if;
  v_deadline := now() + make_interval(mins => v_window_minutes);
  insert into public.payments(booking_id, provider, payment_mode, payment_application, amount, payment_status, payment_deadline, payment_started_at)
    values (v_booking.id, 'manual', 'demo', p_payment_application, v_booking.total_amount, 'pending', v_deadline, now())
    returning * into v_payment;
  update public.bookings set payment_method = 'online', hold_expires_at = v_deadline where id = v_booking.id;
  update public.booking_holds set expires_at = v_deadline where booking_id = v_booking.id and status = 'active';
  return query select v_payment.id, v_deadline;
end
$$;
revoke all on function public.begin_manual_payment(uuid, text) from public, anon;
grant execute on function public.begin_manual_payment(uuid, text) to authenticated;

create or replace function public.review_manual_payment(p_payment_id uuid, p_approve boolean, p_rejection_reason text default null)
returns text language plpgsql security definer set search_path = ''
as $$
declare v_payment public.payments%rowtype; v_booking public.bookings%rowtype; v_reference text;
begin
  if private.current_role() is distinct from 'tourism_office'
     and private.current_role() is distinct from 'site_admin' then
    raise exception 'Tourism Office or Site Admin access required' using errcode = '42501';
  end if;
  select * into v_payment from public.payments p where p.id = p_payment_id and p.provider = 'manual' for update;
  if not found or v_payment.payment_mode <> 'demo' or v_payment.payment_status <> 'pending_verification' or v_payment.proof_submitted_at is null then
    raise exception 'Demo payment is not awaiting verification';
  end if;
  select * into v_booking from public.bookings b where b.id = v_payment.booking_id for update;
  if not found or (private.current_role() is distinct from 'tourism_office' and not private.can_manage_site(v_booking.site_id)) then
    raise exception 'You cannot review payments for this destination' using errcode = '42501';
  end if;
  if v_booking.visitor_id = (select auth.uid()) then
    raise exception 'You cannot approve your own reservation' using errcode = '42501';
  end if;
  if p_approve then
    update public.payments set payment_status = 'paid', verified_at = now(), verified_by = (select auth.uid())
      where id = v_payment.id;
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

notify pgrst, 'reload schema';
