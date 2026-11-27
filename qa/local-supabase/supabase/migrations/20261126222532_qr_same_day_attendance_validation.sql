-- Strict Manila-date admission, checkout, and overdue attendance reconciliation.

alter table public.attendance_logs
  add column reconciliation_reason text,
  add constraint attendance_reconciliation_reason_check
    check (reconciliation_reason is null or (action = 'exit'
      and reconciliation_reason ~ '[^[:space:]]'
      and length(btrim(reconciliation_reason)) between 1 and 1000));

create or replace function private.enforce_attendance_visit_date()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_visit_date date;
  v_today date := (clock_timestamp() at time zone 'Asia/Manila')::date;
begin
  select sl.slot_date into v_visit_date
  from public.bookings b join public.site_slots sl on sl.id = b.slot_id
  where b.id = new.booking_id and b.site_id = new.site_id;
  if v_visit_date is null then raise exception 'Booking does not belong to this destination'; end if;

  if new.reconciliation_reason is null then
    if v_visit_date < v_today then raise exception 'Expired QR ticket';
    elsif v_visit_date > v_today then raise exception 'QR ticket not yet valid';
    end if;
  elsif new.action <> 'exit' or v_visit_date >= v_today
     or new.reconciliation_reason !~ '[^[:space:]]'
     or length(btrim(new.reconciliation_reason)) not between 1 and 1000 then
    raise exception 'Invalid overdue attendance reconciliation';
  end if;
  return new;
end
$$;
revoke all on function private.enforce_attendance_visit_date() from public, anon, authenticated, service_role;
create trigger attendance_00_visit_date_guard
  before insert on public.attendance_logs for each row execute function private.enforce_attendance_visit_date();

create or replace function private.ticket_attendance_state(
  p_booking_id uuid, p_token_hash bytea, p_site_id uuid, p_require_token boolean
)
returns table (
  result text, booking_reference text, visitor_name text, visitor_count integer,
  entered_at timestamptz, exited_at timestamptz,
  entered_count integer, exited_count integer, active_count integer
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
    return query select 'invalid'::text, null::text, null::text, 0, null::timestamptz, null::timestamptz, 0, 0, 0;
    return;
  end if;
  if p_require_token and (p_token_hash is null or v_booking.qr_token_hash is distinct from p_token_hash) then
    return query select 'invalid'::text, null::text, null::text, 0, null::timestamptz, null::timestamptz, 0, 0, 0;
    return;
  end if;
  if v_booking.site_id is distinct from p_site_id then
    return query select 'wrong_destination'::text, null::text, null::text, 0, null::timestamptz, null::timestamptz, 0, 0, 0;
    return;
  end if;
  select count(*)::integer into v_roster_count from public.reservation_visitors v where v.booking_id = v_booking.id;
  select exists (select 1 from public.attendance_logs a where a.booking_id = v_booking.id
    and a.counts_toward_occupancy and cardinality(a.reservation_visitor_ids) = 0) into v_legacy_untracked;

  select * into v_slot from public.site_slots s where s.id = v_booking.slot_id;
  if v_slot.id is null then
    return query select 'invalid'::text, null::text, null::text, 0, null::timestamptz, null::timestamptz, 0, 0, 0;
    return;
  end if;
  select coalesce(sum(a.visitor_count) filter (where a.action = 'entry' and a.counts_toward_occupancy), 0)::integer,
    coalesce(sum(a.visitor_count) filter (where a.action = 'exit' and a.counts_toward_occupancy), 0)::integer,
    min(a.scanned_at) filter (where a.action = 'entry' and a.counts_toward_occupancy),
    max(a.scanned_at) filter (where a.action = 'exit' and a.counts_toward_occupancy)
  into v_entered, v_exited, v_entered_at, v_exited_at
  from public.attendance_logs a where a.booking_id = v_booking.id;
  v_today := (clock_timestamp() at time zone 'Asia/Manila')::date;
  if v_slot.slot_date < v_today then
    if not p_require_token and v_entered > v_exited then
      return query select 'overdue_checkout_required'::text, v_booking.booking_reference,
        v_booking.visitor_name, v_booking.visitor_count, v_entered_at, v_exited_at,
        v_entered, v_exited, v_entered - v_exited;
    else
      return query select 'expired'::text, v_booking.booking_reference,
        v_booking.visitor_name, v_booking.visitor_count, v_entered_at, v_exited_at,
        v_entered, v_exited, greatest(v_entered - v_exited, 0);
    end if;
    return;
  elsif v_slot.slot_date > v_today then
    return query select 'not_yet_valid'::text, v_booking.booking_reference,
      v_booking.visitor_name, v_booking.visitor_count, v_entered_at, v_exited_at,
      v_entered, v_exited, greatest(v_entered - v_exited, 0);
    return;
  end if;

  if v_entered <= v_exited and v_booking.booking_status = 'cancelled' then
    return query select 'cancelled'::text, v_booking.booking_reference,
      v_booking.visitor_name, v_booking.visitor_count, v_entered_at, v_exited_at,
      v_entered, v_exited, 0;
    return;
  elsif v_entered <= v_exited and v_booking.booking_status = 'expired' then
    return query select 'expired_reservation'::text, v_booking.booking_reference,
      v_booking.visitor_name, v_booking.visitor_count, v_entered_at, v_exited_at,
      v_entered, v_exited, 0;
    return;
  elsif v_entered <= v_exited and v_booking.booking_status = 'completed' then
    return query select 'completed'::text, v_booking.booking_reference,
      v_booking.visitor_name, v_booking.visitor_count, v_entered_at, v_exited_at,
      v_entered, v_exited, 0;
    return;
  end if;
  if v_roster_count > 0 and v_roster_count <> v_booking.visitor_count and v_entered <= v_exited then
    return query select 'visitor_roster_incomplete'::text, v_booking.booking_reference,
      v_booking.visitor_name, v_booking.visitor_count, v_entered_at, v_exited_at,
      v_entered, v_exited, 0;
    return;
  end if;

  v_booking_eligible := v_booking.payment_status in ('paid', 'not_required')
    and v_booking.booking_status = 'confirmed';
  if not v_booking_eligible and v_entered <= v_exited then
    return query select 'unpaid_or_inactive'::text, v_booking.booking_reference,
      v_booking.visitor_name, v_booking.visitor_count, v_entered_at, v_exited_at,
      v_entered, v_exited, greatest(v_entered - v_exited, 0);
    return;
  end if;

  if v_entered >= v_booking.visitor_count and v_entered = v_exited then
    return query select 'completed'::text, v_booking.booking_reference,
      v_booking.visitor_name, v_booking.visitor_count, v_entered_at, v_exited_at,
      v_entered, v_exited, 0;
  elsif v_entered > v_exited and v_booking_eligible
    and v_entered < v_booking.visitor_count
    and v_roster_count = v_booking.visitor_count and not v_legacy_untracked then
    return query select 'attendance_confirmation_required'::text, v_booking.booking_reference,
      v_booking.visitor_name, v_booking.visitor_count, v_entered_at, v_exited_at,
      v_entered, v_exited, v_entered - v_exited;
  elsif v_entered > v_exited then
    return query select 'checkout_confirmation_required'::text, v_booking.booking_reference,
      v_booking.visitor_name, v_booking.visitor_count, v_entered_at, v_exited_at,
      v_entered, v_exited, v_entered - v_exited;
  elsif v_entered >= v_booking.visitor_count then
    return query select 'completed'::text, v_booking.booking_reference,
      v_booking.visitor_name, v_booking.visitor_count, v_entered_at, v_exited_at,
      v_entered, v_exited, 0;
  else
    return query select 'entry_confirmation_required'::text, v_booking.booking_reference,
      v_booking.visitor_name, v_booking.visitor_count, v_entered_at, v_exited_at,
      v_entered, v_exited, 0;
  end if;
end
$$;

create or replace function private.enforce_attendance_event()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_entered integer;
  v_exited integer;
  v_booked integer;
  v_roster_count integer;
  v_legacy_untracked boolean;
  v_selected_count integer;
  v_unique_count integer;
  v_approved_limit integer;
  v_current_occupancy bigint;
begin
  new.gatekeeper_id := (select auth.uid());
  new.duty_assignment_id := private.require_active_gatekeeper_duty(new.site_id);
  new.counts_toward_occupancy := true;
  if new.idempotency_key is null then raise exception 'Attendance idempotency key is required'; end if;
  if jsonb_typeof(new.device_information) is distinct from 'object' then
    raise exception 'Device information must be an object';
  end if;
  select b.visitor_count into v_booked from public.bookings b
  where b.id = new.booking_id and b.site_id = new.site_id
    and (new.action = 'exit' or (b.payment_status in ('paid', 'not_required')
      and b.booking_status = 'confirmed'));
  if v_booked is null then raise exception 'Booking is not eligible for admission at this destination'; end if;
  if new.visitor_count is null or new.visitor_count <= 0 then
    raise exception 'Attendance count must be positive';
  end if;
  new.reservation_visitor_ids := coalesce(new.reservation_visitor_ids, '{}'::uuid[]);
  select count(*)::integer into v_roster_count from public.reservation_visitors v where v.booking_id = new.booking_id;
  select exists (select 1 from public.attendance_logs a where a.booking_id = new.booking_id
    and a.counts_toward_occupancy and cardinality(a.reservation_visitor_ids) = 0) into v_legacy_untracked;
  select count(distinct ids.id)::integer into v_unique_count from unnest(new.reservation_visitor_ids) ids(id);
  if v_unique_count <> cardinality(new.reservation_visitor_ids) then raise exception 'Visitor selection contains duplicates'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(new.booking_id::text));
  select coalesce(sum(a.visitor_count) filter (where a.action = 'entry' and a.counts_toward_occupancy), 0)::integer,
    coalesce(sum(a.visitor_count) filter (where a.action = 'exit' and a.counts_toward_occupancy), 0)::integer
  into v_entered, v_exited from public.attendance_logs a where a.booking_id = new.booking_id;

  if v_roster_count = v_booked and not v_legacy_untracked then
    if cardinality(new.reservation_visitor_ids) <> new.visitor_count then
      raise exception 'Select each visitor entering or checking out';
    end if;
    select count(*)::integer into v_selected_count from public.reservation_visitors v
    where v.booking_id = new.booking_id and v.id = any(new.reservation_visitor_ids)
      and v.check_in_status = case when new.action = 'entry' then 'not_checked_in' else 'checked_in' end;
    if v_selected_count <> new.visitor_count then raise exception 'Selected visitors are no longer eligible for this action'; end if;
  elsif v_roster_count = v_booked and v_legacy_untracked then
    if cardinality(new.reservation_visitor_ids) <> 0 then raise exception 'This booking has untracked historical attendance'; end if;
    if new.action = 'entry' then raise exception 'Visitor identity is unavailable for this booking; contact the Tourism Office'; end if;
  elsif v_roster_count <> 0 then
    if new.action = 'entry' then raise exception 'Visitor roster is incomplete; contact the Tourism Office'; end if;
    if cardinality(new.reservation_visitor_ids) <> 0 then raise exception 'This booking has no complete individual visitor roster'; end if;
  elsif cardinality(new.reservation_visitor_ids) <> 0 then
    raise exception 'This booking has no individual visitor roster';
  end if;

  if new.action = 'entry' then
    if v_entered + new.visitor_count > v_booked then
      raise exception 'Admission count exceeds visitors remaining on this booking';
    end if;
    if (v_roster_count = 0 or v_legacy_untracked) and (v_entered <> 0 or new.visitor_count <> v_booked) then
      raise exception 'Count-only bookings must enter as one complete group';
    end if;
    select l.visitor_limit into v_approved_limit
    from public.site_approved_visitor_limits l
    where l.site_id = new.site_id and l.status = 'active'
      and l.effective_from <= (now() at time zone 'Asia/Manila')::date
      and (l.effective_to is null or l.effective_to >= (now() at time zone 'Asia/Manila')::date)
    order by l.effective_from desc, l.approved_at desc limit 1;
    if v_approved_limit is not null then
      select greatest(coalesce(sum(case when a.counts_toward_occupancy then
        case when a.action = 'entry' then a.visitor_count else -a.visitor_count end else 0 end), 0), 0)
      into v_current_occupancy from public.attendance_logs a where a.site_id = new.site_id;
      if v_current_occupancy + new.visitor_count > v_approved_limit then
        raise exception 'Approved visitor limit reached; admission cannot be recorded';
      end if;
    end if;
  else
    if new.visitor_count > v_entered - v_exited then
      raise exception 'Departure count exceeds recorded visitors currently inside';
    end if;
  end if;
  return new;
end
$$;

create or replace function private.confirm_booking_attendance(
  p_booking_id uuid, p_token_hash bytea, p_site_id uuid, p_action public.attendance_action,
  p_visitor_count integer, p_visitor_ids uuid[], p_idempotency_key uuid, p_device jsonb, p_require_token boolean
)
returns table (
  result text, booking_reference text, visitor_name text, visitor_count integer,
  entered_at timestamptz, exited_at timestamptz,
  entered_count integer, exited_count integer, active_count integer
)
language plpgsql security definer set search_path = ''
as $$
declare
  v_booking public.bookings%rowtype;
  v_slot public.site_slots%rowtype;
  v_today date;
  v_existing public.attendance_logs%rowtype;
  v_entered integer;
  v_exited integer;
  v_roster_count integer;
  v_legacy_untracked boolean;
  v_selected_count integer;
  v_unique_count integer;
  v_entered_at timestamptz;
  v_exited_at timestamptz;
  v_limit integer;
  v_occupancy bigint;
begin
  if private.current_role() is distinct from 'gatekeeper'
     or not private.user_has_site_role(p_site_id, 'gatekeeper') then
    raise exception 'Gatekeeper access denied';
  end if;
  perform private.require_active_gatekeeper_duty(p_site_id);
  if p_action not in ('entry', 'exit') then raise exception 'Invalid attendance action'; end if;
  if p_visitor_count is null or p_visitor_count <= 0 then raise exception 'Attendance count must be positive'; end if;
  p_visitor_ids := coalesce(p_visitor_ids, '{}'::uuid[]);
  select count(distinct ids.id)::integer into v_unique_count from unnest(p_visitor_ids) ids(id);
  if v_unique_count <> cardinality(p_visitor_ids) then raise exception 'Visitor selection contains duplicates'; end if;
  if p_idempotency_key is null then raise exception 'Attendance idempotency key is required'; end if;
  if jsonb_typeof(coalesce(p_device, '{}'::jsonb)) is distinct from 'object' then
    raise exception 'Device information must be an object';
  end if;

  select * into v_booking from public.bookings b
  where b.id = p_booking_id and b.site_id = p_site_id for update;
  if not found then raise exception 'Booking does not belong to this destination'; end if;
  if p_require_token and (p_token_hash is null or v_booking.qr_token_hash is distinct from p_token_hash) then
    raise exception 'Invalid ticket';
  end if;

  select * into v_existing from public.attendance_logs a where a.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.booking_id <> p_booking_id or v_existing.site_id <> p_site_id
       or v_existing.action <> p_action or v_existing.visitor_count <> p_visitor_count
       or v_existing.reservation_visitor_ids <> p_visitor_ids then
      raise exception 'Idempotency key was already used for a different attendance event';
    end if;
    select coalesce(sum(a.visitor_count) filter (where a.action = 'entry' and a.counts_toward_occupancy), 0)::integer,
      coalesce(sum(a.visitor_count) filter (where a.action = 'exit' and a.counts_toward_occupancy), 0)::integer,
      min(a.scanned_at) filter (where a.action = 'entry' and a.counts_toward_occupancy),
      max(a.scanned_at) filter (where a.action = 'exit' and a.counts_toward_occupancy)
    into v_entered, v_exited, v_entered_at, v_exited_at
    from public.attendance_logs a where a.booking_id = p_booking_id;
    return query select case p_action when 'entry' then 'entry_recorded' else 'exit_recorded' end,
      v_booking.booking_reference, v_booking.visitor_name, v_booking.visitor_count,
      v_entered_at, v_exited_at, v_entered, v_exited, greatest(v_entered - v_exited, 0);
    return;
  end if;

  select * into v_slot from public.site_slots s where s.id = v_booking.slot_id;
  if v_slot.id is null then raise exception 'Invalid reservation date'; end if;
  v_today := (clock_timestamp() at time zone 'Asia/Manila')::date;
  if v_slot.slot_date < v_today then raise exception 'Expired QR ticket';
  elsif v_slot.slot_date > v_today then raise exception 'QR ticket not yet valid'; end if;
  if p_action = 'entry' and v_booking.booking_status = 'completed' then raise exception 'Visit already completed'; end if;
  if p_action = 'entry' and (v_booking.payment_status not in ('paid', 'not_required')
     or v_booking.booking_status <> 'confirmed') then
    raise exception 'Booking is unpaid or inactive';
  end if;

  select coalesce(sum(a.visitor_count) filter (where a.action = 'entry' and a.counts_toward_occupancy), 0)::integer,
    coalesce(sum(a.visitor_count) filter (where a.action = 'exit' and a.counts_toward_occupancy), 0)::integer
  into v_entered, v_exited from public.attendance_logs a where a.booking_id = p_booking_id;
  if p_action = 'entry' and v_entered >= v_booking.visitor_count then
    raise exception 'Visit already completed';
  elsif p_action = 'entry' and p_visitor_count > v_booking.visitor_count - v_entered then
    raise exception 'Admission count exceeds visitors remaining on this booking';
  elsif p_action = 'exit' and v_entered > v_exited and p_visitor_count > v_entered - v_exited then
    raise exception 'Departure count exceeds recorded visitors currently inside';
  end if;
  select count(*)::integer into v_roster_count from public.reservation_visitors v where v.booking_id = p_booking_id;
  select exists (select 1 from public.attendance_logs a where a.booking_id = p_booking_id
    and a.counts_toward_occupancy and cardinality(a.reservation_visitor_ids) = 0) into v_legacy_untracked;
  if v_roster_count = v_booking.visitor_count and not v_legacy_untracked then
    if cardinality(p_visitor_ids) <> p_visitor_count then raise exception 'Select each visitor entering or checking out'; end if;
    perform 1 from public.reservation_visitors v
    where v.booking_id = p_booking_id and v.id = any(p_visitor_ids) for update;
    select count(*)::integer into v_selected_count from public.reservation_visitors v
    where v.booking_id = p_booking_id and v.id = any(p_visitor_ids)
      and v.check_in_status = case when p_action = 'entry' then 'not_checked_in' else 'checked_in' end;
    if v_selected_count <> p_visitor_count then raise exception 'Selected visitors are no longer eligible for this action'; end if;
  elsif v_roster_count = v_booking.visitor_count and v_legacy_untracked then
    if cardinality(p_visitor_ids) <> 0 then raise exception 'This booking has untracked historical attendance'; end if;
    if p_action = 'entry' then raise exception 'Visitor identity is unavailable for this booking; contact the Tourism Office'; end if;
  elsif v_roster_count <> 0 then
    if p_action = 'entry' then raise exception 'Visitor roster is incomplete; contact the Tourism Office'; end if;
    if cardinality(p_visitor_ids) <> 0 then raise exception 'This booking has no complete individual visitor roster'; end if;
  elsif cardinality(p_visitor_ids) <> 0 then
    raise exception 'This booking has no individual visitor roster';
  end if;
  if p_action = 'entry' then
    if v_entered >= v_booking.visitor_count then raise exception 'Visit already completed'; end if;
    if p_visitor_count > v_booking.visitor_count - v_entered then
      raise exception 'Admission count exceeds visitors remaining on this booking';
    end if;
    if (v_roster_count = 0 or v_legacy_untracked) and (v_entered <> 0 or p_visitor_count <> v_booking.visitor_count) then
      raise exception 'Count-only bookings must enter as one complete group';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_site_id::text));
    select l.visitor_limit into v_limit from public.site_approved_visitor_limits l
    where l.site_id = p_site_id and l.status = 'active'
      and l.effective_from <= (now() at time zone 'Asia/Manila')::date
      and (l.effective_to is null or l.effective_to >= (now() at time zone 'Asia/Manila')::date)
    order by l.effective_from desc, l.approved_at desc limit 1;
    if v_limit is not null then
      select greatest(coalesce(sum(case when a.counts_toward_occupancy then
        case when a.action = 'entry' then a.visitor_count else -a.visitor_count end else 0 end), 0), 0)
      into v_occupancy from public.attendance_logs a where a.site_id = p_site_id;
      if v_occupancy + p_visitor_count > v_limit then
        raise exception 'Approved visitor limit reached; admission cannot be recorded';
      end if;
    end if;
  elsif v_entered <= v_exited then
    raise exception 'No visitors are currently checked in';
  elsif p_visitor_count > v_entered - v_exited then
    raise exception 'Departure count exceeds recorded visitors currently inside';
  end if;

  insert into public.attendance_logs(
    booking_id, site_id, gatekeeper_id, action, device_information, visitor_count,
    reservation_visitor_ids, idempotency_key, scanned_at
  ) values (
    p_booking_id, p_site_id, (select auth.uid()), p_action, coalesce(p_device, '{}'::jsonb),
    p_visitor_count, p_visitor_ids, p_idempotency_key, clock_timestamp()
  );

  if p_action = 'exit' and v_entered >= v_booking.visitor_count
     and v_entered = v_exited + p_visitor_count then
    update public.bookings set booking_status = 'completed' where id = p_booking_id and booking_status = 'confirmed';
  end if;

  select coalesce(sum(a.visitor_count) filter (where a.action = 'entry' and a.counts_toward_occupancy), 0)::integer,
    coalesce(sum(a.visitor_count) filter (where a.action = 'exit' and a.counts_toward_occupancy), 0)::integer,
    min(a.scanned_at) filter (where a.action = 'entry' and a.counts_toward_occupancy),
    max(a.scanned_at) filter (where a.action = 'exit' and a.counts_toward_occupancy)
  into v_entered, v_exited, v_entered_at, v_exited_at
  from public.attendance_logs a where a.booking_id = p_booking_id;
  return query select case p_action when 'entry' then 'entry_recorded' else 'exit_recorded' end,
    v_booking.booking_reference, v_booking.visitor_name, v_booking.visitor_count,
    v_entered_at, v_exited_at, v_entered, v_exited, greatest(v_entered - v_exited, 0);
end
$$;

create function public.reconcile_overdue_checkout(
  p_booking_reference text, p_site_id uuid, p_visitor_count integer,
  p_idempotency_key uuid, p_reason text, p_visitor_ids uuid[] default '{}'::uuid[],
  p_device jsonb default '{}'::jsonb
)
returns table (
  result text, booking_reference text, visitor_name text, visitor_count integer,
  entered_at timestamptz, exited_at timestamptz,
  entered_count integer, exited_count integer, active_count integer
)
language plpgsql security definer set search_path = ''
as $$
declare
  v_booking public.bookings%rowtype;
  v_slot public.site_slots%rowtype;
  v_existing public.attendance_logs%rowtype;
  v_entered integer;
  v_exited integer;
  v_roster_count integer;
  v_legacy_untracked boolean;
  v_selected_count integer;
  v_unique_count integer;
  v_entered_at timestamptz;
  v_exited_at timestamptz;
begin
  if private.current_role() is distinct from 'gatekeeper'
     or not private.user_has_site_role(p_site_id, 'gatekeeper') then
    raise exception 'Gatekeeper access denied';
  end if;
  perform private.require_active_gatekeeper_duty(p_site_id);
  if p_visitor_count is null or p_visitor_count <= 0 then raise exception 'Attendance count must be positive'; end if;
  if p_idempotency_key is null then raise exception 'Attendance idempotency key is required'; end if;
  if p_reason is null or p_reason !~ '[^[:space:]]'
     or length(btrim(p_reason)) not between 1 and 1000 then
    raise exception 'A reason is required for overdue checkout';
  end if;
  if jsonb_typeof(coalesce(p_device, '{}'::jsonb)) is distinct from 'object' then
    raise exception 'Device information must be an object';
  end if;
  p_visitor_ids := coalesce(p_visitor_ids, '{}'::uuid[]);
  select count(distinct ids.id)::integer into v_unique_count from unnest(p_visitor_ids) ids(id);
  if v_unique_count <> cardinality(p_visitor_ids) then raise exception 'Visitor selection contains duplicates'; end if;

  select * into v_booking from public.bookings b
  where b.site_id = p_site_id and lower(b.booking_reference) = lower(trim(p_booking_reference))
  for update;
  if not found then raise exception 'Booking does not belong to this destination'; end if;
  select * into v_slot from public.site_slots s where s.id = v_booking.slot_id;
  if v_slot.id is null or v_slot.slot_date >= (clock_timestamp() at time zone 'Asia/Manila')::date then
    raise exception 'Overdue checkout is only for past visit dates';
  end if;

  select * into v_existing from public.attendance_logs a where a.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.booking_id <> v_booking.id or v_existing.site_id <> p_site_id
       or v_existing.action <> 'exit' or v_existing.visitor_count <> p_visitor_count
       or v_existing.reservation_visitor_ids <> p_visitor_ids
       or v_existing.reconciliation_reason <> btrim(p_reason) then
      raise exception 'Idempotency key was already used for a different attendance event';
    end if;
    select coalesce(sum(a.visitor_count) filter (where a.action = 'entry' and a.counts_toward_occupancy), 0)::integer,
      coalesce(sum(a.visitor_count) filter (where a.action = 'exit' and a.counts_toward_occupancy), 0)::integer,
      min(a.scanned_at) filter (where a.action = 'entry' and a.counts_toward_occupancy),
      max(a.scanned_at) filter (where a.action = 'exit' and a.counts_toward_occupancy)
    into v_entered, v_exited, v_entered_at, v_exited_at
    from public.attendance_logs a where a.booking_id = v_booking.id;
    return query select 'exit_recorded'::text, v_booking.booking_reference, v_booking.visitor_name,
      v_booking.visitor_count, v_entered_at, v_exited_at, v_entered, v_exited, greatest(v_entered - v_exited, 0);
    return;
  end if;

  select coalesce(sum(a.visitor_count) filter (where a.action = 'entry' and a.counts_toward_occupancy), 0)::integer,
    coalesce(sum(a.visitor_count) filter (where a.action = 'exit' and a.counts_toward_occupancy), 0)::integer
  into v_entered, v_exited from public.attendance_logs a where a.booking_id = v_booking.id;
  if v_entered <= v_exited then raise exception 'No visitors are currently checked in'; end if;
  if p_visitor_count > v_entered - v_exited then
    raise exception 'Departure count exceeds recorded visitors currently inside';
  end if;

  select count(*)::integer into v_roster_count from public.reservation_visitors v where v.booking_id = v_booking.id;
  select exists (select 1 from public.attendance_logs a where a.booking_id = v_booking.id
    and a.counts_toward_occupancy and cardinality(a.reservation_visitor_ids) = 0) into v_legacy_untracked;
  if v_roster_count = v_booking.visitor_count and not v_legacy_untracked then
    if cardinality(p_visitor_ids) <> p_visitor_count then raise exception 'Select each visitor checking out'; end if;
    select count(*)::integer into v_selected_count from public.reservation_visitors v
    where v.booking_id = v_booking.id and v.id = any(p_visitor_ids) and v.check_in_status = 'checked_in';
    if v_selected_count <> p_visitor_count then raise exception 'Selected visitors are no longer eligible for this action'; end if;
  elsif v_roster_count = v_booking.visitor_count and v_legacy_untracked then
    if cardinality(p_visitor_ids) <> 0 then raise exception 'This booking has untracked historical attendance'; end if;
  elsif v_roster_count <> 0 then
    if cardinality(p_visitor_ids) <> 0 then raise exception 'This booking has no complete individual visitor roster'; end if;
  elsif cardinality(p_visitor_ids) <> 0 then
    raise exception 'This booking has no individual visitor roster';
  end if;

  insert into public.attendance_logs(
    booking_id, site_id, gatekeeper_id, action, device_information, visitor_count,
    reservation_visitor_ids, idempotency_key, reconciliation_reason, scanned_at
  ) values (
    v_booking.id, p_site_id, auth.uid(), 'exit',
    coalesce(p_device, '{}'::jsonb) || jsonb_build_object('method', 'overdue_reconciliation'),
    p_visitor_count, p_visitor_ids, p_idempotency_key, btrim(p_reason), clock_timestamp()
  );

  if v_entered >= v_booking.visitor_count and v_entered = v_exited + p_visitor_count then
    update public.bookings set booking_status = 'completed'
    where id = v_booking.id and booking_status = 'confirmed';
  end if;
  select coalesce(sum(a.visitor_count) filter (where a.action = 'entry' and a.counts_toward_occupancy), 0)::integer,
    coalesce(sum(a.visitor_count) filter (where a.action = 'exit' and a.counts_toward_occupancy), 0)::integer,
    min(a.scanned_at) filter (where a.action = 'entry' and a.counts_toward_occupancy),
    max(a.scanned_at) filter (where a.action = 'exit' and a.counts_toward_occupancy)
  into v_entered, v_exited, v_entered_at, v_exited_at
  from public.attendance_logs a where a.booking_id = v_booking.id;
  return query select 'exit_recorded'::text, v_booking.booking_reference, v_booking.visitor_name,
    v_booking.visitor_count, v_entered_at, v_exited_at, v_entered, v_exited, greatest(v_entered - v_exited, 0);
end
$$;

revoke all on function public.reconcile_overdue_checkout(text, uuid, integer, uuid, text, uuid[], jsonb) from public, anon;
grant execute on function public.reconcile_overdue_checkout(text, uuid, integer, uuid, text, uuid[], jsonb) to authenticated;
notify pgrst, 'reload schema';
