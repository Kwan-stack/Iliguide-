insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('manual-payment-proofs', 'manual-payment-proofs', false, 10485760, array['image/jpeg', 'image/png'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists payments_read_owner_or_reviewer on public.payments;
create policy payments_read_owner_or_reviewer on public.payments
for select to authenticated
using (exists (
  select 1 from public.bookings b
  where b.id = payments.booking_id
    and (b.visitor_id = (select auth.uid())
      or (payments.provider = 'manual' and payments.payment_status = 'pending_verification'
        and (private.can_review_site_payment(b.site_id)
          or (private.user_has_role('tourism_office') and private.can_manage_site(b.site_id)))))
));

drop policy if exists manual_payment_proof_owner_read on storage.objects;
create policy manual_payment_proof_owner_read on storage.objects for select to authenticated
using (bucket_id = 'manual-payment-proofs' and exists (
  select 1 from public.payments p join public.bookings b on b.id = p.booking_id
  where b.id::text = (storage.foldername(name))[1]
    and p.provider = 'manual' and p.proof_storage_path = storage.objects.name
    and (b.visitor_id = (select auth.uid())
      or (p.payment_status = 'pending_verification'
        and (private.can_review_site_payment(b.site_id)
          or (private.user_has_role('tourism_office') and private.can_manage_site(b.site_id)))))
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
  if p_payment_application is null or p_payment_application not in ('gcash', 'maya') then
    raise exception 'Choose a supported payment application';
  end if;
  if nullif(trim(p_transaction_reference), '') is null or length(trim(p_transaction_reference)) > 120 then
    raise exception 'Enter a valid transaction reference';
  end if;
  if p_proof_storage_path is null or p_proof_storage_path !~ ('^' || p_booking_id::text || '/[0-9a-f-]{36}\.(jpg|jpeg|png)$') then
    raise exception 'Payment proof file path is invalid';
  end if;
  select * into v_booking from public.bookings b
    where b.id = p_booking_id and b.visitor_id = (select auth.uid()) for update;
  if not found then raise exception 'Reservation not found'; end if;
  select * into v_payment from public.payments p where p.booking_id = p_booking_id and p.provider = 'manual' for update;
  if not found or v_booking.booking_status <> 'awaiting_payment'
     or v_payment.payment_status not in ('pending', 'rejected')
     or v_payment.payment_deadline <= now() then
    raise exception 'The payment deadline expired or this payment is no longer accepting proof';
  end if;
  if v_payment.payment_application <> p_payment_application then
    raise exception 'Payment application does not match this session';
  end if;
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
