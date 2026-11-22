create table public.tourism_payment_settings (
  id boolean primary key default true check (id),
  payment_window_minutes integer not null default 15 check (payment_window_minutes between 5 and 120),
  gcash_account_name text not null default '',
  gcash_account_number text not null default '',
  gcash_payment_url text not null default '',
  gcash_qr_path text,
  maya_account_name text not null default '',
  maya_account_number text not null default '',
  maya_payment_url text not null default '',
  maya_qr_path text,
  onsite_instructions text not null default 'Pay at the destination entrance or ticket booth.',
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (gcash_payment_url = '' or gcash_payment_url ~ '^https://'),
  check (maya_payment_url = '' or maya_payment_url ~ '^https://')
);
insert into public.tourism_payment_settings(id) values (true) on conflict (id) do nothing;
create trigger tourism_payment_settings_updated_at before update on public.tourism_payment_settings
  for each row execute function private.set_updated_at();
alter table public.tourism_payment_settings enable row level security;
create policy tourism_payment_settings_visitor_read on public.tourism_payment_settings
  for select to authenticated using (private.current_role() = 'visitor');
create policy tourism_payment_settings_office_manage on public.tourism_payment_settings
  for all to authenticated using (private.user_has_role('tourism_office'))
  with check (private.user_has_role('tourism_office'));
grant select, insert, update on public.tourism_payment_settings to authenticated;
revoke delete on public.tourism_payment_settings from anon, authenticated;

alter table public.payments
  add column payment_application text check (payment_application in ('gcash', 'maya')),
  add column payment_deadline timestamptz,
  add column proof_storage_path text,
  add column transaction_reference text,
  add column proof_submitted_at timestamptz,
  add column verified_by uuid references public.profiles(id) on delete set null,
  add column receipt_reference text unique,
  add column rejection_reason text;
create unique index payments_manual_booking_uidx on public.payments(booking_id) where provider = 'manual';
create unique index payments_transaction_reference_uidx on public.payments(lower(transaction_reference))
  where transaction_reference is not null;
grant select (payment_application, payment_deadline, proof_storage_path, transaction_reference,
  proof_submitted_at, verified_by, receipt_reference, rejection_reason) on public.payments to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('manual-payment-proofs', 'manual-payment-proofs', false, 10485760,
  array['image/jpeg','image/png','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('manual-payment-qr', 'manual-payment-qr', true, 4194304, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy manual_payment_proof_owner_insert on storage.objects for insert to authenticated
with check (bucket_id = 'manual-payment-proofs'
  and exists (select 1 from public.payments p join public.bookings b on b.id = p.booking_id
    where b.id::text = (storage.foldername(name))[1] and b.visitor_id = (select auth.uid())
      and b.booking_status = 'awaiting_payment' and p.provider = 'manual'
      and p.payment_status in ('pending', 'rejected') and p.payment_deadline > now()));
create policy manual_payment_proof_owner_read on storage.objects for select to authenticated
using (bucket_id = 'manual-payment-proofs'
  and exists (select 1 from public.payments p join public.bookings b on b.id = p.booking_id
    where b.id::text = (storage.foldername(name))[1]
      and (b.visitor_id = (select auth.uid()) or private.user_has_role('tourism_office'))));
create policy manual_payment_proof_owner_delete on storage.objects for delete to authenticated
using (bucket_id = 'manual-payment-proofs'
  and exists (select 1 from public.payments p join public.bookings b on b.id = p.booking_id
    where b.id::text = (storage.foldername(name))[1] and b.visitor_id = (select auth.uid())
      and p.provider = 'manual' and p.payment_status in ('pending', 'rejected') and p.payment_deadline > now()));
create policy manual_payment_qr_office_insert on storage.objects for insert to authenticated
with check (bucket_id = 'manual-payment-qr' and private.user_has_role('tourism_office'));
create policy manual_payment_qr_office_update on storage.objects for update to authenticated
using (bucket_id = 'manual-payment-qr' and private.user_has_role('tourism_office'))
with check (bucket_id = 'manual-payment-qr' and private.user_has_role('tourism_office'));
create policy manual_payment_qr_office_delete on storage.objects for delete to authenticated
using (bucket_id = 'manual-payment-qr' and private.user_has_role('tourism_office'));

create function public.begin_manual_payment(p_booking_id uuid, p_payment_application text)
returns table (payment_id uuid, payment_deadline timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare
  v_booking public.bookings%rowtype;
  v_payment public.payments%rowtype;
  v_settings public.tourism_payment_settings%rowtype;
  v_window integer;
  v_deadline timestamptz;
begin
  if private.current_role() is distinct from 'visitor' then
    raise exception 'Only active visitor accounts can begin online payment' using errcode = '42501';
  end if;
  if p_payment_application is null or p_payment_application not in ('gcash', 'maya') then raise exception 'Choose a supported payment application'; end if;
  select * into v_booking from public.bookings b
    where b.id = p_booking_id and b.visitor_id = (select auth.uid()) for update;
  if not found then raise exception 'Reservation not found'; end if;
  if not found or v_booking.booking_status <> 'awaiting_payment' or v_booking.hold_expires_at <= now()
     or v_booking.total_amount <= 0 then raise exception 'This reservation hold is unavailable'; end if;
  select * into v_settings from public.tourism_payment_settings s where s.id;
  if p_payment_application = 'gcash' and (coalesce(v_settings.gcash_account_name, '') = '' or coalesce(v_settings.gcash_account_number, '') = '')
     or p_payment_application = 'maya' and (coalesce(v_settings.maya_account_name, '') = '' or coalesce(v_settings.maya_account_number, '') = '') then
    raise exception 'This payment application is not configured by the Tourism Office';
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
  v_window := v_settings.payment_window_minutes;
  v_deadline := now() + make_interval(mins => coalesce(v_window, 15));
  insert into public.payments(booking_id, provider, payment_application, amount, payment_status, payment_deadline)
  values (v_booking.id, 'manual', p_payment_application, v_booking.total_amount, 'pending', v_deadline)
  returning * into v_payment;
  update public.bookings set payment_method = 'online', hold_expires_at = v_deadline where id = v_booking.id;
  update public.booking_holds set expires_at = v_deadline where booking_id = v_booking.id and status = 'active';
  return query select v_payment.id, v_deadline;
end
$$;

create function public.submit_manual_payment_proof(
  p_booking_id uuid, p_payment_application text, p_transaction_reference text, p_proof_storage_path text
)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_booking public.bookings%rowtype; v_payment public.payments%rowtype;
begin
  if private.current_role() is distinct from 'visitor' then
    raise exception 'Only active visitor accounts can submit payment proof' using errcode = '42501';
  end if;
  if p_payment_application is null or p_payment_application not in ('gcash', 'maya') then raise exception 'Choose a supported payment application'; end if;
  if nullif(trim(p_transaction_reference), '') is null or length(trim(p_transaction_reference)) > 120 then
    raise exception 'Enter a valid transaction reference';
  end if;
  if p_proof_storage_path is null or p_proof_storage_path !~ ('^' || p_booking_id::text || '/[0-9a-f-]{36}\.(jpg|jpeg|png|pdf)$') then
    raise exception 'Payment proof file path is invalid';
  end if;
  select * into v_booking from public.bookings b
    where b.id = p_booking_id and b.visitor_id = (select auth.uid()) for update;
  if not found then raise exception 'Reservation not found'; end if;
  select * into v_payment from public.payments p where p.booking_id = p_booking_id and p.provider = 'manual' for update;
  if not found or v_booking.booking_status <> 'awaiting_payment'
     or v_payment.payment_status not in ('pending', 'rejected')
     or v_payment.payment_deadline <= now() then raise exception 'The payment deadline expired or this payment is no longer accepting proof'; end if;
  if v_payment.payment_application <> p_payment_application then raise exception 'Payment application does not match this session'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'manual-payment-proofs'
    and o.name = p_proof_storage_path and o.owner_id = (select auth.uid())::text) then
    raise exception 'Upload the payment proof before submitting';
  end if;
  begin
    update public.payments set payment_status = 'pending_verification',
      transaction_reference = trim(p_transaction_reference), proof_storage_path = p_proof_storage_path,
      proof_submitted_at = now(), rejection_reason = null where id = v_payment.id;
  exception when unique_violation then
    raise exception 'That transaction reference has already been submitted.' using errcode = '23505';
  end;
  update public.bookings set payment_status = 'pending_verification', hold_expires_at = 'infinity'::timestamptz where id = v_booking.id;
  update public.booking_holds set expires_at = 'infinity'::timestamptz where booking_id = v_booking.id and status = 'active';
  insert into public.notifications(user_id, title, message, notification_type)
  select v_booking.visitor_id, 'Payment submitted', 'Your payment proof is awaiting Tourism Office verification.', 'payment_submitted'
  where v_booking.visitor_id is not null;
end
$$;

create function public.review_manual_payment(p_payment_id uuid, p_approve boolean, p_rejection_reason text default null)
returns text language plpgsql security definer set search_path = ''
as $$
declare v_payment public.payments%rowtype; v_booking public.bookings%rowtype; v_reference text;
begin
  if private.current_role() is distinct from 'tourism_office' then
    raise exception 'Tourism Office access required' using errcode = '42501';
  end if;
  select * into v_payment from public.payments p where p.id = p_payment_id and p.provider = 'manual' for update;
  if not found or v_payment.payment_status <> 'pending_verification' or v_payment.proof_submitted_at is null then
    raise exception 'Payment is not awaiting verification';
  end if;
  select * into v_booking from public.bookings b where b.id = v_payment.booking_id for update;
  if p_approve then
    v_reference := 'ILG-RCP-' || upper(encode(extensions.gen_random_bytes(6), 'hex'));
    update public.payments set payment_status = 'paid', verified_at = now(), verified_by = (select auth.uid()),
      receipt_reference = v_reference where id = v_payment.id;
    update public.bookings set payment_status = 'paid', booking_status = 'confirmed', hold_expires_at = null where id = v_booking.id;
    update public.booking_holds set status = 'consumed' where booking_id = v_booking.id;
    insert into public.notifications(user_id, title, message, notification_type)
    select v_booking.visitor_id, 'Payment verified', 'Your payment was verified. Your booking is confirmed and receipt is available.', 'payment_verified'
    where v_booking.visitor_id is not null;
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
  select v_booking.visitor_id, 'Payment proof needs attention',
    case when v_payment.payment_deadline <= now() then 'Payment proof was rejected after the payment deadline. The reservation expired.'
      else 'Payment proof was rejected: ' || trim(p_rejection_reason) || '. You may resubmit before the payment deadline.' end,
    'payment_rejected'
  where v_booking.visitor_id is not null;
  return null;
end
$$;

create or replace function public.record_onsite_payment(p_booking_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_booking public.bookings%rowtype; v_reference text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into v_booking from public.bookings b where b.id = p_booking_id for update;
  if not found or not private.can_work_site(v_booking.site_id) then
    raise exception 'You cannot collect payment for this booking' using errcode = '42501';
  end if;
  if v_booking.payment_method <> 'onsite' or v_booking.payment_status <> 'pending' or v_booking.booking_status <> 'confirmed' then
    raise exception 'This onsite payment is not awaiting collection';
  end if;
  v_reference := 'ILG-RCP-' || upper(encode(extensions.gen_random_bytes(6), 'hex'));
  insert into public.payments(booking_id, provider, provider_reference, idempotency_key, amount,
    payment_status, verified_at, verified_by, receipt_reference, collected_by)
  values (v_booking.id, 'onsite', 'Collected onsite by authorized destination staff', 'onsite-' || v_booking.id::text,
    v_booking.total_amount, 'paid', now(), auth.uid(), v_reference, auth.uid());
  update public.bookings set payment_status = 'paid' where id = v_booking.id;
  if v_booking.visitor_id is not null then
    insert into public.notifications(user_id, title, message, notification_type)
    values (v_booking.visitor_id, 'Onsite payment recorded', 'Your onsite payment was recorded. Your receipt is available in My Bookings.', 'payment_verified');
  end if;
end
$$;

create or replace function public.expire_booking_holds()
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_count integer;
begin
  update public.payments p set payment_status = 'expired'
  where p.provider = 'manual' and p.payment_status in ('pending', 'rejected') and p.payment_deadline <= now();
  update public.bookings b set payment_status = 'expired', booking_status = 'expired', hold_expires_at = null
  where b.booking_status = 'awaiting_payment' and b.hold_expires_at <= now()
    and b.payment_status in ('pending', 'rejected', 'failed', 'expired');
  get diagnostics v_count = row_count;
  update public.booking_holds h set status = 'expired'
  where h.status = 'active' and h.expires_at <= now();
  return v_count;
end
$$;

revoke all on function public.begin_manual_payment(uuid, text) from public, anon;
grant execute on function public.begin_manual_payment(uuid, text) to authenticated;
revoke all on function public.submit_manual_payment_proof(uuid, text, text, text) from public, anon;
grant execute on function public.submit_manual_payment_proof(uuid, text, text, text) to authenticated;
revoke all on function public.review_manual_payment(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.review_manual_payment(uuid, boolean, text) to authenticated;

notify pgrst, 'reload schema';
