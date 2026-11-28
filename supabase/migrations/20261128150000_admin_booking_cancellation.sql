-- Non-destructive Admin Booking Cancellation support for weather conditions,
-- safety advisories, and operational overrides.
-- Preserves existing booking_status values ('cancelled'), Tourist booking (PB-007),
-- QR ticket issuance (PB-009), Gatekeeper scanning (PB-017/PB-018), and slot capacity accuracy.

-- 1. Add nullable cancellation metadata columns to public.bookings
alter table public.bookings
  add column if not exists cancellation_category text,
  add column if not exists cancellation_reason text,
  add column if not exists cancelled_by uuid references public.profiles(id) on delete set null,
  add column if not exists cancelled_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'bookings_cancellation_category_check'
  ) then
    alter table public.bookings
      add constraint bookings_cancellation_category_check
      check (
        cancellation_category is null
        or cancellation_category in (
          'Weather Condition',
          'Safety Advisory',
          'Site Maintenance',
          'Capacity Override',
          'Other'
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'bookings_cancellation_reason_length_check'
  ) then
    alter table public.bookings
      add constraint bookings_cancellation_reason_length_check
      check (cancellation_reason is null or length(btrim(cancellation_reason)) <= 1000);
  end if;
end
$$;

create index if not exists bookings_cancelled_at_idx
  on public.bookings(site_id, cancelled_at desc)
  where booking_status = 'cancelled' and cancelled_at is not null;

-- 2. RLS policy: ONLY authenticated City Tourism Office Admin accounts may cancel bookings
--    (Tourists, Gatekeepers, and Site Admins remain blocked from arbitrary booking updates.)
drop policy if exists bookings_tourism_office_admin_cancel on public.bookings;
create policy bookings_tourism_office_admin_cancel
  on public.bookings
  for update
  to authenticated
  using (private.user_has_role('tourism_office'))
  with check (
    private.user_has_role('tourism_office')
    and booking_status = 'cancelled'
    and hold_expires_at is null
  );

-- 3. Individual Admin Booking Cancellation RPC (City Tourism Office Admin only)
create or replace function public.admin_cancel_booking(
  p_booking_id uuid,
  p_category text,
  p_reason text default null
)
returns table (
  booking_id uuid,
  booking_reference text,
  booking_status public.booking_status,
  cancellation_category text,
  cancellation_reason text,
  cancelled_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_booking public.bookings%rowtype;
  v_slot public.site_slots%rowtype;
  v_category text := btrim(coalesce(p_category, ''));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_now timestamptz := now();
  v_notice text;
begin
  if v_actor is null or not private.user_has_role('tourism_office') then
    raise exception 'Only City Tourism Office administrators can cancel bookings.'
      using errcode = '42501';
  end if;

  if v_category not in (
    'Weather Condition',
    'Safety Advisory',
    'Site Maintenance',
    'Capacity Override',
    'Other'
  ) then
    raise exception 'Select a valid cancellation reason category.';
  end if;

  if v_reason is not null and length(v_reason) > 1000 then
    raise exception 'Cancellation note must be 1,000 characters or fewer.';
  end if;

  select * into v_booking
  from public.bookings b
  where b.id = p_booking_id
  for update;

  if not found then
    raise exception 'Booking not found.';
  end if;

  if v_booking.booking_status = 'cancelled' then
    raise exception 'This booking is already cancelled.';
  end if;

  if v_booking.booking_status not in ('confirmed', 'awaiting_payment') then
    raise exception 'Only active or confirmed bookings can be cancelled by an administrator.';
  end if;

  select * into v_slot from public.site_slots sl where sl.id = v_booking.slot_id;

  -- Keep qr_token_hash intact so Gatekeeper QR scans identify the ticket and report
  -- CANCELLED + reason rather than an opaque "invalid ticket" error.
  update public.bookings
  set booking_status = 'cancelled',
      hold_expires_at = null,
      cancellation_category = v_category,
      cancellation_reason = v_reason,
      cancelled_by = v_actor,
      cancelled_at = v_now
  where id = v_booking.id;

  update public.booking_holds
  set status = 'released'
  where booking_id = v_booking.id and status = 'active';

  update public.cancellation_requests
  set request_status = 'approved',
      reviewed_by = v_actor,
      reviewed_at = v_now,
      decision_note = coalesce(v_reason, 'Cancelled by Tourism Office (' || v_category || ')')
  where booking_id = v_booking.id and request_status = 'pending';

  if v_booking.visitor_id is not null then
    v_notice := 'Your reservation ' || v_booking.booking_reference
      || ' for ' || v_booking.site_name_snapshot
      || case when v_slot.slot_date is not null then ' on ' || v_slot.slot_date::text else '' end
      || ' was cancelled by the City Tourism Office (' || v_category || ').'
      || case when v_reason is not null then ' Note: ' || v_reason else '' end
      || ' Your QR ticket is no longer valid. Browse alternative available slots in IliGuide.';

    insert into public.notifications(user_id, booking_id, title, message, notification_type)
    values (
      v_booking.visitor_id,
      v_booking.id,
      'Booking cancelled by Tourism Office',
      left(v_notice, 2000),
      'admin_booking_cancelled'
    );
  end if;

  perform private.write_audit_event('admin_cancel_booking', 'bookings', v_booking.id, v_booking.site_id);

  return query
  select
    v_booking.id,
    v_booking.booking_reference,
    'cancelled'::public.booking_status,
    v_category,
    v_reason,
    v_now;
end
$$;

revoke all on function public.admin_cancel_booking(uuid, text, text) from public, anon;
grant execute on function public.admin_cancel_booking(uuid, text, text) to authenticated;

-- 4. Bulk Admin Booking Cancellation RPC for Weather/Safety Closures (City Tourism Office Admin only)
create or replace function public.admin_bulk_cancel_site_bookings(
  p_site_id uuid,
  p_starts_on date,
  p_ends_on date,
  p_category text default 'Weather Condition',
  p_reason text default null
)
returns table (
  cancelled_count integer,
  cancelled_references text[]
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_category text := btrim(coalesce(p_category, 'Weather Condition'));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_now timestamptz := now();
  v_row record;
  v_count integer := 0;
  v_refs text[] := '{}'::text[];
  v_notice text;
begin
  if v_actor is null or not private.user_has_role('tourism_office') then
    raise exception 'Only City Tourism Office administrators can bulk-cancel destination bookings.'
      using errcode = '42501';
  end if;

  if p_site_id is null or p_starts_on is null or p_ends_on is null or p_ends_on < p_starts_on then
    raise exception 'Select a valid destination and closure date range.';
  end if;

  if v_category not in (
    'Weather Condition',
    'Safety Advisory',
    'Site Maintenance',
    'Capacity Override',
    'Other'
  ) then
    raise exception 'Select a valid cancellation reason category.';
  end if;

  if v_reason is not null and length(v_reason) > 1000 then
    raise exception 'Cancellation note must be 1,000 characters or fewer.';
  end if;

  for v_row in
    select b.id, b.booking_reference, b.visitor_id, b.site_name_snapshot, sl.slot_date
    from public.bookings b
    join public.site_slots sl on sl.id = b.slot_id
    where b.site_id = p_site_id
      and sl.slot_date between p_starts_on and p_ends_on
      and b.booking_status in ('confirmed', 'awaiting_payment')
    order by sl.slot_date, b.created_at
    for update of b
  loop
    update public.bookings
    set booking_status = 'cancelled',
        hold_expires_at = null,
        cancellation_category = v_category,
        cancellation_reason = v_reason,
        cancelled_by = v_actor,
        cancelled_at = v_now
    where id = v_row.id;

    update public.booking_holds
    set status = 'released'
    where booking_id = v_row.id and status = 'active';

    update public.cancellation_requests
    set request_status = 'approved',
        reviewed_by = v_actor,
        reviewed_at = v_now,
        decision_note = coalesce(v_reason, 'Cancelled due to destination closure (' || v_category || ')')
    where booking_id = v_row.id and request_status = 'pending';

    if v_row.visitor_id is not null then
      v_notice := 'Your reservation ' || v_row.booking_reference
        || ' for ' || v_row.site_name_snapshot
        || ' on ' || v_row.slot_date::text
        || ' was cancelled by the City Tourism Office (' || v_category || ').'
        || case when v_reason is not null then ' Note: ' || v_reason else '' end
        || ' Your QR ticket is no longer valid. Browse alternative available slots in IliGuide.';

      insert into public.notifications(user_id, booking_id, title, message, notification_type)
      values (
        v_row.visitor_id,
        v_row.id,
        'Booking cancelled by Tourism Office',
        left(v_notice, 2000),
        'admin_booking_cancelled'
      );
    end if;

    v_count := v_count + 1;
    v_refs := array_append(v_refs, v_row.booking_reference);
  end loop;

  perform private.write_audit_event('admin_bulk_cancel_site_bookings', 'tourism_sites', p_site_id, p_site_id);

  return query select v_count, v_refs;
end
$$;

revoke all on function public.admin_bulk_cancel_site_bookings(uuid, date, date, text, text) from public, anon;
grant execute on function public.admin_bulk_cancel_site_bookings(uuid, date, date, text, text) to authenticated;

-- 5. Gatekeeper QR Scanner & Manual Lookup sync (PB-017 / PB-018):
--    Always reject cancelled bookings with 'cancelled' BEFORE date-window checks
--    and include cancellation_category + cancellation_reason so Gatekeepers see why.
drop function if exists public.scan_ticket(uuid, bytea, uuid, jsonb);
drop function if exists public.manual_scan_ticket(text, uuid, jsonb);
drop function if exists private.scan_ticket(uuid, bytea, uuid, jsonb);
drop function if exists private.manual_scan_ticket(text, uuid, jsonb);
drop function if exists private.ticket_attendance_state(uuid, bytea, uuid, boolean);

create function private.ticket_attendance_state(
  p_booking_id uuid, p_token_hash bytea, p_site_id uuid, p_require_token boolean
)
returns table (
  result text, booking_reference text, visitor_name text, visitor_count integer,
  entered_at timestamptz, exited_at timestamptz,
  entered_count integer, exited_count integer, active_count integer,
  cancellation_category text, cancellation_reason text, cancelled_at timestamptz
)
language plpgsql security definer set search_path = ''
as $$
declare
  v_booking public.bookings%rowtype;
  v_slot public.site_slots%rowtype;
  v_entered integer;
  v_exited integer;
  v_entered_at timestamptz;
  v_exited_at timestamptz;
  v_today date;
  v_booking_eligible boolean;
  v_roster_count integer;
  v_legacy_untracked boolean;
begin
  if private.current_role() is distinct from 'gatekeeper'
     or not private.user_has_site_role(p_site_id, 'gatekeeper') then
    raise exception 'Gatekeeper access denied';
  end if;
  perform private.require_active_gatekeeper_duty(p_site_id);

  select * into v_booking from public.bookings b where b.id = p_booking_id;
  if not found then
    return query select 'invalid'::text, null::text, null::text, 0, null::timestamptz, null::timestamptz, 0, 0, 0, null::text, null::text, null::timestamptz;
    return;
  end if;
  if p_require_token and (p_token_hash is null or v_booking.qr_token_hash is distinct from p_token_hash) then
    return query select 'invalid'::text, null::text, null::text, 0, null::timestamptz, null::timestamptz, 0, 0, 0, null::text, null::text, null::timestamptz;
    return;
  end if;
  if v_booking.site_id is distinct from p_site_id then
    return query select 'wrong_destination'::text, null::text, null::text, 0, null::timestamptz, null::timestamptz, 0, 0, 0, null::text, null::text, null::timestamptz;
    return;
  end if;

  select count(*)::integer into v_roster_count from public.reservation_visitors v where v.booking_id = v_booking.id;
  select exists (select 1 from public.attendance_logs a where a.booking_id = v_booking.id
    and a.counts_toward_occupancy and cardinality(a.reservation_visitor_ids) = 0) into v_legacy_untracked;

  select * into v_slot from public.site_slots s where s.id = v_booking.slot_id;
  if v_slot.id is null then
    return query select 'invalid'::text, null::text, null::text, 0, null::timestamptz, null::timestamptz, 0, 0, 0, null::text, null::text, null::timestamptz;
    return;
  end if;

  select coalesce(sum(a.visitor_count) filter (where a.action = 'entry' and a.counts_toward_occupancy), 0)::integer,
    coalesce(sum(a.visitor_count) filter (where a.action = 'exit' and a.counts_toward_occupancy), 0)::integer,
    min(a.scanned_at) filter (where a.action = 'entry' and a.counts_toward_occupancy),
    max(a.scanned_at) filter (where a.action = 'exit' and a.counts_toward_occupancy)
  into v_entered, v_exited, v_entered_at, v_exited_at
  from public.attendance_logs a where a.booking_id = v_booking.id;

  -- Check cancelled bookings FIRST so future/same-day cancelled bookings always show
  -- explicit CANCELLED status and cancellation reason to the Gatekeeper.
  if v_entered <= v_exited and v_booking.booking_status = 'cancelled' then
    return query select 'cancelled'::text, v_booking.booking_reference,
      v_booking.visitor_name, v_booking.visitor_count, v_entered_at, v_exited_at,
      v_entered, v_exited, 0,
      v_booking.cancellation_category, v_booking.cancellation_reason, v_booking.cancelled_at;
    return;
  end if;

  v_today := (clock_timestamp() at time zone 'Asia/Manila')::date;
  if v_slot.slot_date < v_today then
    if not p_require_token and v_entered > v_exited then
      return query select 'overdue_checkout_required'::text, v_booking.booking_reference,
        v_booking.visitor_name, v_booking.visitor_count, v_entered_at, v_exited_at,
        v_entered, v_exited, v_entered - v_exited, null::text, null::text, null::timestamptz;
    else
      return query select 'expired'::text, v_booking.booking_reference,
        v_booking.visitor_name, v_booking.visitor_count, v_entered_at, v_exited_at,
        v_entered, v_exited, greatest(v_entered - v_exited, 0), null::text, null::text, null::timestamptz;
    end if;
    return;
  elsif v_slot.slot_date > v_today then
    return query select 'not_yet_valid'::text, v_booking.booking_reference,
      v_booking.visitor_name, v_booking.visitor_count, v_entered_at, v_exited_at,
      v_entered, v_exited, greatest(v_entered - v_exited, 0), null::text, null::text, null::timestamptz;
    return;
  end if;

  if v_entered <= v_exited and v_booking.booking_status = 'expired' then
    return query select 'expired_reservation'::text, v_booking.booking_reference,
      v_booking.visitor_name, v_booking.visitor_count, v_entered_at, v_exited_at,
      v_entered, v_exited, 0, null::text, null::text, null::timestamptz;
    return;
  elsif v_entered <= v_exited and v_booking.booking_status = 'completed' then
    return query select 'completed'::text, v_booking.booking_reference,
      v_booking.visitor_name, v_booking.visitor_count, v_entered_at, v_exited_at,
      v_entered, v_exited, 0, null::text, null::text, null::timestamptz;
    return;
  end if;

  if v_roster_count > 0 and v_roster_count <> v_booking.visitor_count and v_entered <= v_exited then
    return query select 'visitor_roster_incomplete'::text, v_booking.booking_reference,
      v_booking.visitor_name, v_booking.visitor_count, v_entered_at, v_exited_at,
      v_entered, v_exited, 0, null::text, null::text, null::timestamptz;
    return;
  end if;

  v_booking_eligible := v_booking.payment_status in ('paid', 'not_required')
    and v_booking.booking_status = 'confirmed';
  if not v_booking_eligible and v_entered <= v_exited then
    return query select 'unpaid_or_inactive'::text, v_booking.booking_reference,
      v_booking.visitor_name, v_booking.visitor_count, v_entered_at, v_exited_at,
      v_entered, v_exited, greatest(v_entered - v_exited, 0), null::text, null::text, null::timestamptz;
    return;
  end if;

  if v_entered >= v_booking.visitor_count and v_entered = v_exited then
    return query select 'completed'::text, v_booking.booking_reference,
      v_booking.visitor_name, v_booking.visitor_count, v_entered_at, v_exited_at,
      v_entered, v_exited, 0, null::text, null::text, null::timestamptz;
  elsif v_entered > v_exited and v_booking_eligible
    and v_entered < v_booking.visitor_count
    and v_roster_count = v_booking.visitor_count and not v_legacy_untracked then
    return query select 'attendance_confirmation_required'::text, v_booking.booking_reference,
      v_booking.visitor_name, v_booking.visitor_count, v_entered_at, v_exited_at,
      v_entered, v_exited, v_entered - v_exited, null::text, null::text, null::timestamptz;
  elsif v_entered > v_exited then
    return query select 'checkout_confirmation_required'::text, v_booking.booking_reference,
      v_booking.visitor_name, v_booking.visitor_count, v_entered_at, v_exited_at,
      v_entered, v_exited, v_entered - v_exited, null::text, null::text, null::timestamptz;
  elsif v_entered >= v_booking.visitor_count then
    return query select 'completed'::text, v_booking.booking_reference,
      v_booking.visitor_name, v_booking.visitor_count, v_entered_at, v_exited_at,
      v_entered, v_exited, 0, null::text, null::text, null::timestamptz;
  else
    return query select 'entry_confirmation_required'::text, v_booking.booking_reference,
      v_booking.visitor_name, v_booking.visitor_count, v_entered_at, v_exited_at,
      v_entered, v_exited, 0, null::text, null::text, null::timestamptz;
  end if;
end
$$;

create function private.scan_ticket(
  p_booking_id uuid, p_token_hash bytea, p_site_id uuid, p_device jsonb default '{}'::jsonb
)
returns table (
  result text, booking_reference text, visitor_name text, visitor_count integer,
  entered_at timestamptz, exited_at timestamptz,
  entered_count integer, exited_count integer, active_count integer,
  cancellation_category text, cancellation_reason text, cancelled_at timestamptz
)
language plpgsql security definer set search_path = ''
as $$
begin
  return query select * from private.ticket_attendance_state(p_booking_id, p_token_hash, p_site_id, true);
end
$$;

create function private.manual_scan_ticket(
  p_booking_reference text, p_site_id uuid, p_device jsonb default '{}'::jsonb
)
returns table (
  result text, booking_reference text, visitor_name text, visitor_count integer,
  entered_at timestamptz, exited_at timestamptz,
  entered_count integer, exited_count integer, active_count integer,
  cancellation_category text, cancellation_reason text, cancelled_at timestamptz
)
language plpgsql security definer set search_path = ''
as $$
declare v_booking_id uuid;
begin
  if private.current_role() is distinct from 'gatekeeper'
     or not private.user_has_site_role(p_site_id, 'gatekeeper') then
    raise exception 'Gatekeeper access denied';
  end if;
  perform private.require_active_gatekeeper_duty(p_site_id);
  select b.id into v_booking_id from public.bookings b
  where b.site_id = p_site_id and lower(b.booking_reference) = lower(trim(p_booking_reference));
  return query select * from private.ticket_attendance_state(v_booking_id, null, p_site_id, false);
end
$$;

create function public.scan_ticket(
  p_booking_id uuid, p_token_hash bytea, p_site_id uuid, p_device jsonb default '{}'::jsonb
)
returns table (
  result text, booking_reference text, visitor_name text, visitor_count integer,
  entered_at timestamptz, exited_at timestamptz,
  entered_count integer, exited_count integer, active_count integer,
  cancellation_category text, cancellation_reason text, cancelled_at timestamptz
)
language sql security definer set search_path = ''
as $$ select * from private.scan_ticket(p_booking_id, p_token_hash, p_site_id, p_device) $$;

create function public.manual_scan_ticket(
  p_booking_reference text, p_site_id uuid, p_device jsonb default '{}'::jsonb
)
returns table (
  result text, booking_reference text, visitor_name text, visitor_count integer,
  entered_at timestamptz, exited_at timestamptz,
  entered_count integer, exited_count integer, active_count integer,
  cancellation_category text, cancellation_reason text, cancelled_at timestamptz
)
language sql security definer set search_path = ''
as $$ select * from private.manual_scan_ticket(p_booking_reference, p_site_id, p_device) $$;

revoke all on function private.ticket_attendance_state(uuid, bytea, uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function private.scan_ticket(uuid, bytea, uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.manual_scan_ticket(text, uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.scan_ticket(uuid, bytea, uuid, jsonb) from public, anon;
revoke all on function public.manual_scan_ticket(text, uuid, jsonb) from public, anon;
grant execute on function public.scan_ticket(uuid, bytea, uuid, jsonb) to authenticated;
grant execute on function public.manual_scan_ticket(text, uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
