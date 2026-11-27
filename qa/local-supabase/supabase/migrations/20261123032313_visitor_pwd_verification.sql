-- Private PWD evidence is stored separately from general visitor records.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pwd-id-documents', 'pwd-id-documents', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table public.reservation_pwd_verifications (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  reservation_visitor_id uuid not null unique references public.reservation_visitors(id) on delete cascade,
  site_id uuid not null references public.tourism_sites(id) on delete restrict,
  disability_category text not null check (disability_category in (
    'deaf_hard_of_hearing', 'intellectual', 'learning', 'mental', 'physical_orthopedic',
    'psychosocial', 'speech_language', 'visual', 'cancer', 'rare_disease', 'other_manual_review'
  )),
  image_path text not null unique,
  verification_status text not null default 'pending_verification'
    check (verification_status in ('pending_verification', 'verified', 'rejected')),
  delete_after date not null,
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  review_reason text check (review_reason is null or length(trim(review_reason)) between 2 and 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((verification_status = 'pending_verification' and verified_by is null and verified_at is null)
    or (verification_status in ('verified', 'rejected') and verified_by is not null and verified_at is not null)),
  check ((verification_status <> 'rejected') or review_reason is not null)
);
create index reservation_pwd_verifications_site_status_idx
  on public.reservation_pwd_verifications(site_id, verification_status, created_at desc);
create trigger reservation_pwd_verifications_updated_at before update on public.reservation_pwd_verifications
  for each row execute function private.set_updated_at();
create trigger audit_reservation_pwd_verifications after insert or update or delete on public.reservation_pwd_verifications
  for each row execute function private.audit_row_change();

alter table public.reservation_pwd_verifications enable row level security;
create policy reservation_pwd_verifications_scoped_read on public.reservation_pwd_verifications
  for select to authenticated using (
    exists (select 1 from public.bookings b where b.id = booking_id and b.visitor_id = (select auth.uid()))
    or private.can_manage_site(site_id)
    or private.user_has_site_role(site_id, 'gatekeeper')
  );
grant select on public.reservation_pwd_verifications to authenticated;
revoke insert, update, delete on public.reservation_pwd_verifications from anon, authenticated;

create policy pwd_id_owner_upload on storage.objects for insert to authenticated with check (
  bucket_id = 'pwd-id-documents'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.bookings b
    join public.reservation_visitors v on v.booking_id = b.id
    where b.id::text = (storage.foldername(name))[2]
      and v.sequence_number::text = split_part(storage.filename(name), '.', 1)
      and b.visitor_id = (select auth.uid()) and b.pwd_count > 0
      and lower(storage.filename(name)) ~ '^[0-9]+\.(jpg|jpeg|png|webp)$'
  )
);
create policy pwd_id_scoped_read on storage.objects for select to authenticated using (
  bucket_id = 'pwd-id-documents' and exists (
    select 1 from public.reservation_pwd_verifications r
    join public.bookings b on b.id = r.booking_id
    where r.image_path = name and (
      b.visitor_id = (select auth.uid()) or private.can_manage_site(r.site_id)
      or private.user_has_site_role(r.site_id, 'gatekeeper')
    )
  )
);
create policy pwd_id_owner_delete on storage.objects for delete to authenticated using (
  bucket_id = 'pwd-id-documents' and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (select 1 from public.bookings b where b.id::text = (storage.foldername(name))[2]
    and b.visitor_id = (select auth.uid()) and b.booking_status = 'awaiting_payment'
    and not exists (select 1 from public.payments p where p.booking_id = b.id))
);
create policy pwd_id_retention_delete on storage.objects for delete to authenticated using (
  bucket_id = 'pwd-id-documents' and exists (
    select 1 from public.reservation_pwd_verifications r
    where r.image_path = name and r.delete_after <= (now() at time zone 'Asia/Manila')::date
      and private.can_manage_site(r.site_id)
  )
);

create function public.submit_pwd_verifications(p_booking_id uuid, p_records jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_booking public.bookings%rowtype; v_record jsonb; v_visitor public.reservation_visitors%rowtype;
  v_delete_after date;
  v_sequence integer; v_path text; v_category text; v_count integer := 0;
begin
  if auth.uid() is null or jsonb_typeof(p_records) is distinct from 'array' then
    raise exception 'PWD verification details are invalid';
  end if;
  select * into v_booking from public.bookings b where b.id = p_booking_id and b.visitor_id = auth.uid() for update;
  if not found or v_booking.booking_status <> 'awaiting_payment' or v_booking.hold_expires_at <= now() then
    raise exception 'Active reservation hold not found';
  end if;
  if jsonb_array_length(p_records) <> v_booking.pwd_count then
    raise exception 'Select PWD details and a clear ID image for each visitor claiming the discount';
  end if;
  select sl.slot_date + 30 into v_delete_after from public.site_slots sl where sl.id = v_booking.slot_id;
  for v_record in select value from jsonb_array_elements(p_records) loop
    v_sequence := (v_record ->> 'sequence_number')::integer;
    v_path := v_record ->> 'image_path';
    v_category := v_record ->> 'disability_category';
    if v_sequence is null or v_path !~ ('^' || auth.uid()::text || '/' || p_booking_id::text || '/' || v_sequence::text || '\.(jpg|jpeg|png|webp)$')
       or v_category not in ('deaf_hard_of_hearing', 'intellectual', 'learning', 'mental', 'physical_orthopedic', 'psychosocial', 'speech_language', 'visual', 'cancer', 'rare_disease', 'other_manual_review') then
      raise exception 'PWD information or private ID image path is invalid';
    end if;
    select * into v_visitor from public.reservation_visitors v
      where v.booking_id = p_booking_id and v.sequence_number = v_sequence;
    if not found or not exists (select 1 from storage.objects o where o.bucket_id = 'pwd-id-documents' and o.name = v_path
       and o.owner_id = auth.uid()::text and (o.metadata ->> 'size')::bigint <= 5242880
       and o.metadata ->> 'mimetype' in ('image/jpeg', 'image/png', 'image/webp')) then
      raise exception 'Upload a valid PWD ID photo for every visitor claiming the discount';
    end if;
    insert into public.reservation_pwd_verifications(booking_id, reservation_visitor_id, site_id, disability_category, image_path, delete_after)
      values (p_booking_id, v_visitor.id, v_booking.site_id, v_category, v_path, v_delete_after);
    v_count := v_count + 1;
  end loop;
  if v_count <> v_booking.pwd_count then raise exception 'PWD visitor details do not match the discount count'; end if;
end $$;
revoke all on function public.submit_pwd_verifications(uuid, jsonb) from public, anon;
grant execute on function public.submit_pwd_verifications(uuid, jsonb) to authenticated;

create function public.cancel_pwd_booking_hold(p_booking_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in to cancel this hold'; end if;
  update public.bookings b set booking_status = 'cancelled', hold_expires_at = null
  where b.id = p_booking_id and b.visitor_id = auth.uid() and b.booking_status = 'awaiting_payment'
    and not exists (select 1 from public.payments p where p.booking_id = b.id);
  if not found then raise exception 'This reservation hold can no longer be cancelled'; end if;
  update public.booking_holds set status = 'released' where booking_id = p_booking_id and status = 'active';
  delete from public.reservation_pwd_verifications where booking_id = p_booking_id;
end $$;
revoke all on function public.cancel_pwd_booking_hold(uuid) from public, anon;
grant execute on function public.cancel_pwd_booking_hold(uuid) to authenticated;

create function public.review_pwd_verification(p_verification_id uuid, p_status text, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_record public.reservation_pwd_verifications%rowtype;
  v_booking public.bookings%rowtype;
  v_visitor public.reservation_visitors%rowtype;
  v_settings public.site_settings%rowtype;
  v_surcharge numeric(12,2) := 0;
begin
  if auth.uid() is null or p_status not in ('verified', 'rejected')
    or (p_status = 'rejected' and length(trim(coalesce(p_reason, ''))) not between 2 and 300) then
    raise exception 'Enter a valid verification decision and rejection reason';
  end if;
  select * into v_record from public.reservation_pwd_verifications where id = p_verification_id for update;
  if not found or not (private.can_manage_site(v_record.site_id) or private.user_has_site_role(v_record.site_id, 'gatekeeper')) then
    raise exception 'You are not authorized to verify PWD documents for this destination';
  end if;
  if v_record.verification_status <> 'pending_verification' then
    raise exception 'This PWD record has already been reviewed';
  end if;
  if p_status = 'rejected' then
    select * into v_booking from public.bookings where id = v_record.booking_id for update;
    if v_booking.payment_status = 'paid' or exists (
      select 1 from public.payments where booking_id = v_booking.id and payment_status = 'paid'
    ) then
      raise exception 'PWD claims must be reviewed before payment collection';
    end if;
    if v_booking.booking_status in ('awaiting_payment', 'confirmed') then
      if v_booking.payment_status = 'pending_verification' or exists (
        select 1 from public.payments where booking_id = v_booking.id and payment_status = 'pending_verification'
      ) then
        raise exception 'Review the PWD claim before reviewing submitted payment proof';
      end if;
      select * into v_visitor from public.reservation_visitors where id = v_record.reservation_visitor_id;
      select * into v_settings from public.site_settings where site_id = v_record.site_id;
      if not found or v_settings.pwd_discount_percent <= 0 then
        raise exception 'Configured PWD pricing is unavailable for this reservation';
      end if;
      v_surcharge := round(
        case when v_visitor.visitor_type = 'child' then v_settings.child_fee else v_settings.adult_fee end
        * v_settings.pwd_discount_percent / 100, 2
      );
      if v_surcharge > 0 then
        update public.bookings set total_amount = total_amount + v_surcharge where id = v_booking.id;
        update public.payments set amount = amount + v_surcharge
          where booking_id = v_booking.id and provider = 'manual' and payment_status in ('pending', 'rejected');
      end if;
    end if;
  end if;
  update public.reservation_pwd_verifications set verification_status = p_status,
    verified_by = auth.uid(), verified_at = now(), review_reason = case when p_status = 'rejected' then trim(p_reason) else null end
  where id = p_verification_id and verification_status = 'pending_verification';
  if not found then raise exception 'This PWD record has already been reviewed'; end if;
end $$;
revoke all on function public.review_pwd_verification(uuid, text, text) from public, anon;
grant execute on function public.review_pwd_verification(uuid, text, text) to authenticated;

create function public.delete_expired_pwd_verification(p_verification_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_site_id uuid;
begin
  select site_id into v_site_id from public.reservation_pwd_verifications
  where id = p_verification_id and delete_after <= (now() at time zone 'Asia/Manila')::date;
  if v_site_id is null or not private.can_manage_site(v_site_id) then
    raise exception 'Only the authorized destination manager can delete expired PWD documents';
  end if;
  delete from public.reservation_pwd_verifications where id = p_verification_id;
end $$;
revoke all on function public.delete_expired_pwd_verification(uuid) from public, anon;
grant execute on function public.delete_expired_pwd_verification(uuid) to authenticated;
