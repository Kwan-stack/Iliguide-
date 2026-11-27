create or replace function private.can_review_site_payment(p_site_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.current_role() in ('site_admin', 'gatekeeper')
    and private.user_has_site_role(p_site_id, private.current_role())
$$;
revoke all on function private.can_review_site_payment(uuid) from public, anon;
grant execute on function private.can_review_site_payment(uuid) to authenticated;

drop policy if exists payments_read_owner_or_staff on public.payments;
create policy payments_read_owner_or_reviewer on public.payments
for select to authenticated
using (exists (
  select 1 from public.bookings b
  where b.id = payments.booking_id
    and (b.visitor_id = (select auth.uid())
      or (payments.payment_status = 'pending_verification'
        and private.can_review_site_payment(b.site_id)))
));

drop policy if exists manual_payment_proof_owner_read on storage.objects;
create policy manual_payment_proof_owner_read on storage.objects for select to authenticated
using (bucket_id = 'manual-payment-proofs' and exists (
  select 1 from public.payments p join public.bookings b on b.id = p.booking_id
  where b.id::text = (storage.foldername(name))[1]
    and (b.visitor_id = (select auth.uid())
      or (p.payment_status = 'pending_verification'
        and private.can_review_site_payment(b.site_id)))
));

create or replace function public.submit_manual_payment_proof(
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
  select v_booking.visitor_id, 'Payment submitted', 'Your payment proof is awaiting Gatekeeper verification.', 'payment_submitted'
  where v_booking.visitor_id is not null;
end
$$;
revoke all on function public.submit_manual_payment_proof(uuid, text, text, text) from public, anon;
grant execute on function public.submit_manual_payment_proof(uuid, text, text, text) to authenticated;

create or replace function public.review_manual_payment(p_payment_id uuid, p_approve boolean, p_rejection_reason text default null)
returns text language plpgsql security definer set search_path = ''
as $$
declare v_payment public.payments%rowtype; v_booking public.bookings%rowtype; v_reference text;
begin
  if private.current_role() is distinct from 'gatekeeper'
     and private.current_role() is distinct from 'site_admin' then
    raise exception 'Gatekeeper or Site Admin access required' using errcode = '42501';
  end if;
  select * into v_payment from public.payments p where p.id = p_payment_id and p.provider = 'manual' for update;
  if not found or v_payment.payment_mode <> 'demo' or v_payment.payment_status <> 'pending_verification' or v_payment.proof_submitted_at is null then
    raise exception 'Demo payment is not awaiting verification';
  end if;
  select * into v_booking from public.bookings b where b.id = v_payment.booking_id for update;
  if not found or not private.can_review_site_payment(v_booking.site_id) then
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
