create or replace function private.confirm_free_booking(p_booking_id uuid, p_guest_access_token text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_booking public.bookings%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'visitor' and p.account_status = 'active'
  ) then raise exception 'Only active visitor accounts can confirm a reservation'; end if;
  select * into v_booking from public.bookings b
  where b.id = p_booking_id and b.visitor_id = auth.uid() for update;
  if not found then raise exception 'Booking not found for this visitor account'; end if;
  if v_booking.booking_status <> 'awaiting_payment' or v_booking.hold_expires_at is null or v_booking.hold_expires_at <= now() then
    raise exception 'This reservation hold has expired';
  end if;
  if exists (select 1 from public.payments p where p.booking_id = v_booking.id) then
    raise exception 'This reservation has a payment attempt and cannot be confirmed without payment';
  end if;
  update public.bookings set payment_status = 'not_required', booking_status = 'confirmed', hold_expires_at = null where id = v_booking.id;
  update public.booking_holds set status = 'consumed' where booking_id = v_booking.id;
end
$$;
create or replace function public.confirm_free_booking(p_booking_id uuid, p_guest_access_token text default null)
returns void language sql security invoker set search_path = ''
as $$ select private.confirm_free_booking(p_booking_id, null) $$;
revoke all on function private.confirm_free_booking(uuid, text) from public, anon, authenticated, service_role;
grant execute on function private.confirm_free_booking(uuid, text) to authenticated;
revoke all on function public.confirm_free_booking(uuid, text) from public, anon;
grant execute on function public.confirm_free_booking(uuid, text) to authenticated;
create function private.register_walk_in(
  p_site_id uuid, p_slot_id uuid, p_name text, p_adult_count integer,
  p_child_count integer, p_pwd_count integer, p_email text, p_phone text
)
returns table (booking_id uuid, booking_reference text, total_amount numeric, guest_access_token text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_slot public.site_slots%rowtype;
  v_site public.tourism_sites%rowtype;
  v_settings public.site_settings%rowtype;
  v_booked integer;
  v_total numeric(12,2);
  v_access_token text := encode(extensions.gen_random_bytes(32), 'hex');
  v_booking_id uuid := gen_random_uuid();
  v_reference text := 'ILG-' || upper(encode(extensions.gen_random_bytes(8), 'hex'));
begin
  if private.current_role() is distinct from 'gatekeeper'
     or not private.user_has_site_role(p_site_id, 'gatekeeper') then
    raise exception 'Gatekeeper access denied';
  end if;
  if nullif(trim(p_name), '') is null or p_adult_count is null or p_adult_count < 1
     or p_child_count is null or p_child_count < 0 or p_pwd_count is null or p_pwd_count < 0
     or p_pwd_count > p_adult_count + p_child_count
     or (nullif(trim(p_email), '') is null and nullif(trim(p_phone), '') is null) then
    raise exception 'Enter the visitor details and a valid party size';
  end if;
  select * into v_slot from public.site_slots s
  where s.id = p_slot_id and s.site_id = p_site_id and s.status = 'open' for update;
  if not found then raise exception 'This time slot is unavailable'; end if;
  select * into v_site from public.tourism_sites t where t.id = p_site_id and t.status = 'published';
  if not found then raise exception 'This site is not accepting walk-ins'; end if;
  select * into v_settings from public.site_settings ss where ss.site_id = p_site_id;
  if not found then raise exception 'Site fees are not configured'; end if;
  if p_adult_count + p_child_count > v_settings.max_per_booking then raise exception 'Party size exceeds site limit'; end if;
  if v_slot.slot_date <> (now() at time zone v_site.timezone)::date then raise exception 'Walk-in slot must be for today'; end if;
  if (now() at time zone v_site.timezone)::time < v_slot.starts_at
     or (now() at time zone v_site.timezone)::time >= v_slot.ends_at then
    raise exception 'Walk-in registration is available only during the selected time slot';
  end if;
  if exists (
    select 1 from public.site_closures c
    where c.site_id = p_site_id and v_slot.slot_date between c.starts_on and c.ends_on
      and (c.starts_at is null or (c.starts_at < v_slot.ends_at and c.ends_at > v_slot.starts_at))
  ) then raise exception 'The site is closed during this slot'; end if;
  if p_pwd_count > 0 and (v_settings.pwd_discount_percent <= 0 or v_settings.adult_fee <> v_settings.child_fee) then
    raise exception 'PWD discount is not configured for this destination';
  end if;
  v_total := v_settings.adult_fee * p_adult_count + v_settings.child_fee * p_child_count
    - round(v_settings.adult_fee * v_settings.pwd_discount_percent / 100 * p_pwd_count, 2);
  select coalesce(sum(b.visitor_count), 0)::integer into v_booked
  from public.bookings b
  where b.slot_id = v_slot.id
    and (b.booking_status = 'confirmed'
      or (b.booking_status = 'awaiting_payment' and b.hold_expires_at > now()));
  if v_booked + p_adult_count + p_child_count > v_slot.capacity then raise exception 'No capacity remains'; end if;

  insert into public.bookings(
    id, booking_reference, site_id, slot_id, visitor_name, visitor_email, visitor_phone,
    adult_count, child_count, pwd_count, total_amount, payment_status, booking_status,
    booking_source, created_by
  ) values (
    v_booking_id, v_reference, p_site_id, v_slot.id, trim(p_name),
    nullif(lower(trim(p_email)), ''), nullif(trim(p_phone), ''),
    p_adult_count, p_child_count, p_pwd_count, v_total, 'not_required', 'confirmed',
    'walk_in', (select auth.uid())
  );
  insert into public.booking_access_tokens(booking_id, token_hash)
  values (v_booking_id, extensions.digest(convert_to(v_access_token, 'UTF8'), 'sha256'));
  return query select v_booking_id, v_reference, v_total, v_access_token;
end
$$;


create or replace function private.set_booking_qr_hash(p_booking_id uuid, p_token_hash bytea)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'Server authorization required';
  end if;
  if octet_length(p_token_hash) <> 32 then raise exception 'Invalid ticket token hash'; end if;
  update public.bookings
  set qr_token_hash = p_token_hash, qr_issued_at = coalesce(qr_issued_at, now())
  where id = p_booking_id and payment_status in ('paid', 'not_required')
    and booking_status in ('confirmed', 'completed');
  if not found then raise exception 'Confirmed booking not found'; end if;
end
$$;

create or replace function private.scan_ticket(
  p_booking_id uuid, p_token_hash bytea, p_site_id uuid, p_device jsonb default '{}'::jsonb
)
returns table (
  result text, booking_reference text, visitor_name text, visitor_count integer,
  entered_at timestamptz, exited_at timestamptz
)
language plpgsql security definer set search_path = ''
as $$
declare
  v_booking public.bookings%rowtype;
  v_slot public.site_slots%rowtype;
  v_site public.tourism_sites%rowtype;
  v_entry timestamptz;
  v_exit timestamptz;
  v_now_local time;
begin
  if private.current_role() is distinct from 'gatekeeper'
     or not private.user_has_site_role(p_site_id, 'gatekeeper') then
    raise exception 'Gatekeeper access denied';
  end if;
  select * into v_booking from public.bookings b
  where b.id = p_booking_id and b.site_id = p_site_id for update;
  if not found or p_token_hash is null or v_booking.qr_token_hash <> p_token_hash then
    return query select 'invalid'::text, null::text, null::text, 0, null::timestamptz, null::timestamptz;
    return;
  end if;
  if v_booking.payment_status not in ('paid', 'not_required')
     or v_booking.booking_status not in ('confirmed', 'completed') then
    return query select 'unpaid_or_inactive'::text, v_booking.booking_reference,
      v_booking.visitor_name, v_booking.visitor_count, null::timestamptz, null::timestamptz;
    return;
  end if;
  select * into v_slot from public.site_slots s where s.id = v_booking.slot_id;
  select * into v_site from public.tourism_sites t where t.id = p_site_id;
  v_now_local := (now() at time zone v_site.timezone)::time;
  if v_slot.slot_date <> (now() at time zone v_site.timezone)::date
     or v_now_local < v_slot.starts_at - interval '30 minutes'
     or v_now_local > v_slot.ends_at + interval '3 hours' then
    return query select 'outside_window'::text, v_booking.booking_reference,
      v_booking.visitor_name, v_booking.visitor_count, null::timestamptz, null::timestamptz;
    return;
  end if;
  select min(a.scanned_at) filter (where a.action = 'entry'),
         min(a.scanned_at) filter (where a.action = 'exit')
  into v_entry, v_exit from public.attendance_logs a where a.booking_id = v_booking.id;
  if v_exit is not null then
    return query select 'completed'::text, v_booking.booking_reference,
      v_booking.visitor_name, v_booking.visitor_count, v_entry, v_exit;
    return;
  end if;
  if v_entry is null then
    insert into public.attendance_logs(booking_id, site_id, gatekeeper_id, action, device_information)
    values (v_booking.id, p_site_id, (select auth.uid()), 'entry', coalesce(p_device, '{}'::jsonb));
    return query select 'entry_recorded'::text, v_booking.booking_reference,
      v_booking.visitor_name, v_booking.visitor_count, now(), null::timestamptz;
  else
    insert into public.attendance_logs(booking_id, site_id, gatekeeper_id, action, device_information)
    values (v_booking.id, p_site_id, (select auth.uid()), 'exit', coalesce(p_device, '{}'::jsonb));
    update public.bookings set booking_status = 'completed' where id = v_booking.id;
    return query select 'exit_recorded'::text, v_booking.booking_reference,
      v_booking.visitor_name, v_booking.visitor_count, v_entry, now();
  end if;
end
$$;

revoke all on function private.scan_ticket(uuid, bytea, uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function private.scan_ticket(uuid, bytea, uuid, jsonb) to authenticated;
