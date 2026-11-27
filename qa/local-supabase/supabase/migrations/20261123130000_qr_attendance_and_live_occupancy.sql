alter table public.attendance_logs
  add column idempotency_key uuid,
  add column counts_toward_occupancy boolean not null default true,
  add column reservation_visitor_ids uuid[] not null default '{}'::uuid[];

-- Older walk-in registration created an entry event before physical admission.
-- Keep those audit rows, but exclude their false admission from occupancy totals.
update public.attendance_logs a
set counts_toward_occupancy = false
from public.bookings b
where b.id = a.booking_id and b.site_id = a.site_id
  and b.booking_source = 'walk_in' and a.action = 'entry'
  and a.scanned_at = b.created_at and a.device_information = '{}'::jsonb;

alter table public.reservation_visitors
  add column checked_out_at timestamptz,
  add column checked_out_by uuid references public.profiles(id) on delete set null;
alter table public.reservation_visitors drop constraint if exists reservation_visitors_check_in_status_check;
alter table public.reservation_visitors drop constraint if exists reservation_visitors_check_in_consistency;
alter table public.reservation_visitors
  add constraint reservation_visitors_check_in_status_check
    check (check_in_status in ('not_checked_in', 'checked_in', 'checked_out')),
  add constraint reservation_visitors_check_in_consistency check (
    (check_in_status = 'not_checked_in' and checked_in_at is null and checked_in_by is null
      and checked_out_at is null and checked_out_by is null)
    or (check_in_status = 'checked_in' and checked_in_at is not null
      and checked_out_at is null and checked_out_by is null)
    or (check_in_status = 'checked_out' and checked_in_at is not null and checked_out_at is not null)
  );

with roster as (
  select b.id as booking_id, array_agg(v.id order by v.sequence_number) as visitor_ids
  from public.bookings b join public.reservation_visitors v on v.booking_id = b.id
  group by b.id, b.visitor_count having count(*) = b.visitor_count
)
update public.attendance_logs a set reservation_visitor_ids = r.visitor_ids
from roster r
where a.booking_id = r.booking_id and a.counts_toward_occupancy
  and a.visitor_count = (select b.visitor_count from public.bookings b where b.id = r.booking_id);

update public.reservation_visitors v
set check_in_status = case
      when exists (select 1 from public.attendance_logs a where a.booking_id = v.booking_id
        and a.action = 'entry' and v.id = any(a.reservation_visitor_ids))
       and not exists (select 1 from public.attendance_logs a where a.booking_id = v.booking_id
        and a.action = 'exit' and v.id = any(a.reservation_visitor_ids)) then 'checked_in'
      when exists (select 1 from public.attendance_logs a where a.booking_id = v.booking_id
        and a.action = 'entry' and v.id = any(a.reservation_visitor_ids)) then 'checked_out'
      else 'not_checked_in'
    end,
    checked_in_at = (select min(a.scanned_at) from public.attendance_logs a
      where a.booking_id = v.booking_id and a.action = 'entry' and v.id = any(a.reservation_visitor_ids)),
    checked_in_by = (select a.gatekeeper_id from public.attendance_logs a
      where a.booking_id = v.booking_id and a.action = 'entry' and v.id = any(a.reservation_visitor_ids)
      order by a.scanned_at, a.id limit 1),
    checked_out_at = case when exists (select 1 from public.attendance_logs a where a.booking_id = v.booking_id
      and a.action = 'entry' and v.id = any(a.reservation_visitor_ids)) then (select max(a.scanned_at)
      from public.attendance_logs a where a.booking_id = v.booking_id and a.action = 'exit'
      and v.id = any(a.reservation_visitor_ids)) end,
    checked_out_by = case when exists (select 1 from public.attendance_logs a where a.booking_id = v.booking_id
      and a.action = 'entry' and v.id = any(a.reservation_visitor_ids)) then (select a.gatekeeper_id
      from public.attendance_logs a where a.booking_id = v.booking_id and a.action = 'exit'
      and v.id = any(a.reservation_visitor_ids) order by a.scanned_at desc, a.id desc limit 1) end
where not exists (select 1 from public.attendance_logs a where a.booking_id = v.booking_id
  and a.counts_toward_occupancy and cardinality(a.reservation_visitor_ids) = 0);

drop index if exists public.attendance_one_entry_uidx;
drop index if exists public.attendance_one_exit_uidx;
create index attendance_booking_entry_idx on public.attendance_logs(booking_id, scanned_at) where action = 'entry';
create unique index attendance_idempotency_key_uidx on public.attendance_logs(idempotency_key) where idempotency_key is not null;

drop function public.manual_scan_ticket(text, uuid, jsonb);
drop function private.manual_scan_ticket(text, uuid, jsonb);
drop function public.scan_ticket(uuid, bytea, uuid, jsonb);
drop function private.scan_ticket(uuid, bytea, uuid, jsonb);

create function private.ticket_attendance_state(
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
  v_site public.tourism_sites%rowtype;
  v_entered integer;
  v_exited integer;
  v_entered_at timestamptz;
  v_exited_at timestamptz;
  v_within_window boolean;
  v_booking_eligible boolean;
  v_roster_count integer;
  v_legacy_untracked boolean;
begin
  if private.current_role() is distinct from 'gatekeeper'
     or not private.user_has_site_role(p_site_id, 'gatekeeper') then
    raise exception 'Gatekeeper access denied';
  end if;
  perform private.require_active_gatekeeper_duty(p_site_id);

  select * into v_booking from public.bookings b
  where b.id = p_booking_id and b.site_id = p_site_id;
  if not found or (p_require_token and (p_token_hash is null or v_booking.qr_token_hash is distinct from p_token_hash)) then
    return query select 'invalid'::text, null::text, null::text, 0,
      null::timestamptz, null::timestamptz, 0, 0, 0;
    return;
  end if;
  select count(*)::integer into v_roster_count from public.reservation_visitors v where v.booking_id = v_booking.id;
  select exists (select 1 from public.attendance_logs a where a.booking_id = v_booking.id
    and a.counts_toward_occupancy and cardinality(a.reservation_visitor_ids) = 0) into v_legacy_untracked;

  select coalesce(sum(a.visitor_count) filter (where a.action = 'entry' and a.counts_toward_occupancy), 0)::integer,
    coalesce(sum(a.visitor_count) filter (where a.action = 'exit' and a.counts_toward_occupancy), 0)::integer,
    min(a.scanned_at) filter (where a.action = 'entry' and a.counts_toward_occupancy),
    max(a.scanned_at) filter (where a.action = 'exit' and a.counts_toward_occupancy)
  into v_entered, v_exited, v_entered_at, v_exited_at
  from public.attendance_logs a where a.booking_id = v_booking.id;
  if v_roster_count > 0 and v_roster_count <> v_booking.visitor_count and v_entered <= v_exited then
    return query select 'visitor_roster_incomplete'::text, v_booking.booking_reference,
      v_booking.visitor_name, v_booking.visitor_count, v_entered_at, v_exited_at,
      v_entered, v_exited, 0;
    return;
  end if;

  v_booking_eligible := v_booking.payment_status in ('paid', 'not_required')
    and v_booking.booking_status in ('confirmed', 'completed');
  if not v_booking_eligible and v_entered <= v_exited then
    return query select 'unpaid_or_inactive'::text, v_booking.booking_reference,
      v_booking.visitor_name, v_booking.visitor_count, v_entered_at, v_exited_at,
      v_entered, v_exited, greatest(v_entered - v_exited, 0);
    return;
  end if;

  select * into v_slot from public.site_slots s where s.id = v_booking.slot_id;
  select * into v_site from public.tourism_sites t where t.id = p_site_id;
  if v_slot.id is null or v_site.id is null then
    return query select 'invalid'::text, null::text, null::text, 0,
      null::timestamptz, null::timestamptz, 0, 0, 0;
    return;
  end if;
  v_within_window := v_slot.slot_date = (now() at time zone 'Asia/Manila')::date
    and now() >= ((v_slot.slot_date + v_slot.starts_at) at time zone 'Asia/Manila') - interval '30 minutes'
    and now() <= ((v_slot.slot_date + v_slot.ends_at) at time zone 'Asia/Manila') + interval '3 hours';

  if v_entered >= v_booking.visitor_count and v_entered = v_exited then
    return query select 'completed'::text, v_booking.booking_reference,
      v_booking.visitor_name, v_booking.visitor_count, v_entered_at, v_exited_at,
      v_entered, v_exited, 0;
  elsif v_entered > v_exited and v_booking_eligible
    and v_entered < v_booking.visitor_count and v_within_window
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
  elsif not v_within_window then
    return query select 'outside_window'::text, v_booking.booking_reference,
      v_booking.visitor_name, v_booking.visitor_count, v_entered_at, v_exited_at,
      v_entered, v_exited, 0;
  else
    return query select 'entry_confirmation_required'::text, v_booking.booking_reference,
      v_booking.visitor_name, v_booking.visitor_count, v_entered_at, v_exited_at,
      v_entered, v_exited, 0;
  end if;
end
$$;

create function private.scan_ticket(
  p_booking_id uuid, p_token_hash bytea, p_site_id uuid, p_device jsonb default '{}'::jsonb
)
returns table (
  result text, booking_reference text, visitor_name text, visitor_count integer,
  entered_at timestamptz, exited_at timestamptz,
  entered_count integer, exited_count integer, active_count integer
)
language sql security definer set search_path = ''
as $$ select * from private.ticket_attendance_state(p_booking_id, p_token_hash, p_site_id, true) $$;

create function private.manual_scan_ticket(
  p_booking_reference text, p_site_id uuid, p_device jsonb default '{}'::jsonb
)
returns table (
  result text, booking_reference text, visitor_name text, visitor_count integer,
  entered_at timestamptz, exited_at timestamptz,
  entered_count integer, exited_count integer, active_count integer
)
language plpgsql security definer set search_path = ''
as $$
declare v_booking_id uuid;
begin
  if private.current_role() is distinct from 'gatekeeper'
     or not private.user_has_site_role(p_site_id, 'gatekeeper') then raise exception 'Gatekeeper access denied'; end if;
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
  entered_count integer, exited_count integer, active_count integer
)
language sql security definer set search_path = ''
as $$ select * from private.scan_ticket(p_booking_id, p_token_hash, p_site_id, p_device) $$;

create function public.manual_scan_ticket(
  p_booking_reference text, p_site_id uuid, p_device jsonb default '{}'::jsonb
)
returns table (
  result text, booking_reference text, visitor_name text, visitor_count integer,
  entered_at timestamptz, exited_at timestamptz,
  entered_count integer, exited_count integer, active_count integer
)
language sql security definer set search_path = ''
as $$ select * from private.manual_scan_ticket(p_booking_reference, p_site_id, p_device) $$;

create function public.attendance_participants(p_booking_reference text, p_site_id uuid)
returns table(visitor_id uuid, full_name text, visitor_type text, check_in_status text)
language plpgsql security definer set search_path = ''
as $$
declare v_booking_id uuid; v_visitor_count integer;
begin
  if private.current_role() is distinct from 'gatekeeper'
     or not private.user_has_site_role(p_site_id, 'gatekeeper') then raise exception 'Gatekeeper access denied'; end if;
  perform private.require_active_gatekeeper_duty(p_site_id);
  select b.id, b.visitor_count into v_booking_id, v_visitor_count
  from public.bookings b
  where b.site_id = p_site_id and lower(b.booking_reference) = lower(trim(p_booking_reference));
  if v_booking_id is null then return; end if;
  if (select count(*) from public.reservation_visitors v where v.booking_id = v_booking_id) <> v_visitor_count then return; end if;
  if exists (select 1 from public.attendance_logs a where a.booking_id = v_booking_id
      and a.counts_toward_occupancy and cardinality(a.reservation_visitor_ids) = 0) then return; end if;
  return query select v.id, v.full_name, v.visitor_type, v.check_in_status
  from public.reservation_visitors v where v.booking_id = v_booking_id order by v.sequence_number;
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
    and b.payment_status in ('paid', 'not_required') and b.booking_status in ('confirmed', 'completed');
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
revoke all on function private.enforce_attendance_event() from public, anon, authenticated, service_role;

create or replace function private.enforce_warning_entry_policy()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_limit integer;
  v_threshold smallint;
  v_occupancy bigint;
begin
  if new.action <> 'entry' then return new; end if;
  select l.visitor_limit, r.critical_threshold_percent into v_limit, v_threshold
  from public.tourism_sites s
  join public.site_capacity_rules r on r.site_id = s.id and r.restrict_at_warning
  join lateral (
    select visitor_limit from public.site_approved_visitor_limits l
    where l.site_id = s.id and l.status = 'active'
      and l.effective_from <= (now() at time zone 'Asia/Manila')::date
      and (l.effective_to is null or l.effective_to >= (now() at time zone 'Asia/Manila')::date)
    order by l.effective_from desc, l.approved_at desc limit 1
  ) l on true
  where s.id = new.site_id;
  if v_limit is null then return new; end if;
  select greatest(coalesce(sum(case when a.counts_toward_occupancy then
    case when a.action = 'entry' then a.visitor_count else -a.visitor_count end else 0 end), 0), 0)
  into v_occupancy from public.attendance_logs a where a.site_id = new.site_id;
  if v_occupancy + new.visitor_count > pg_catalog.floor(v_limit::numeric * v_threshold / 100) then
    raise exception 'Configured crowd warning entry restriction reached';
  end if;
  return new;
end
$$;
revoke all on function private.enforce_warning_entry_policy() from public, anon, authenticated, service_role;

create or replace function private.sync_visitor_check_in()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.action = 'entry' and cardinality(new.reservation_visitor_ids) > 0 then
    update public.reservation_visitors v
    set check_in_status = 'checked_in', checked_in_at = new.scanned_at, checked_in_by = new.gatekeeper_id
    where v.booking_id = new.booking_id and v.id = any(new.reservation_visitor_ids)
      and v.check_in_status = 'not_checked_in';
  elsif new.action = 'exit' and cardinality(new.reservation_visitor_ids) > 0 then
    update public.reservation_visitors v
    set check_in_status = 'checked_out', checked_out_at = new.scanned_at, checked_out_by = new.gatekeeper_id
    where v.booking_id = new.booking_id and v.id = any(new.reservation_visitor_ids)
      and v.check_in_status = 'checked_in';
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
  v_site public.tourism_sites%rowtype;
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

  if p_action = 'entry' and (v_booking.payment_status not in ('paid', 'not_required')
     or v_booking.booking_status not in ('confirmed', 'completed')) then
    raise exception 'Booking is unpaid or inactive';
  end if;
  select * into v_slot from public.site_slots s where s.id = v_booking.slot_id;
  select * into v_site from public.tourism_sites s where s.id = p_site_id;
  if p_action = 'entry' and (v_slot.slot_date <> (now() at time zone 'Asia/Manila')::date
     or now() < ((v_slot.slot_date + v_slot.starts_at) at time zone 'Asia/Manila') - interval '30 minutes'
     or now() > ((v_slot.slot_date + v_slot.ends_at) at time zone 'Asia/Manila') + interval '3 hours') then
    raise exception 'Outside the visit time window';
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
    booking_id, site_id, gatekeeper_id, action, device_information, visitor_count, reservation_visitor_ids, idempotency_key
  ) values (
    p_booking_id, p_site_id, (select auth.uid()), p_action, coalesce(p_device, '{}'::jsonb),
    p_visitor_count, p_visitor_ids, p_idempotency_key
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

create function public.confirm_ticket_attendance(
  p_booking_id uuid, p_token_hash bytea, p_site_id uuid, p_action public.attendance_action,
  p_visitor_count integer, p_idempotency_key uuid, p_device jsonb default '{}'::jsonb,
  p_visitor_ids uuid[] default '{}'::uuid[]
)
returns table (
  result text, booking_reference text, visitor_name text, visitor_count integer,
  entered_at timestamptz, exited_at timestamptz,
  entered_count integer, exited_count integer, active_count integer
)
language sql security definer set search_path = ''
as $$ select * from private.confirm_booking_attendance(
  p_booking_id, p_token_hash, p_site_id, p_action, p_visitor_count, p_visitor_ids, p_idempotency_key, p_device, true
) $$;

create function public.confirm_manual_attendance(
  p_booking_reference text, p_site_id uuid, p_action public.attendance_action,
  p_visitor_count integer, p_idempotency_key uuid, p_device jsonb default '{}'::jsonb,
  p_visitor_ids uuid[] default '{}'::uuid[]
)
returns table (
  result text, booking_reference text, visitor_name text, visitor_count integer,
  entered_at timestamptz, exited_at timestamptz,
  entered_count integer, exited_count integer, active_count integer
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
  if v_booking_id is null then raise exception 'Booking does not belong to this destination'; end if;
  return query select * from private.confirm_booking_attendance(
    v_booking_id, null, p_site_id, p_action, p_visitor_count, p_visitor_ids, p_idempotency_key, p_device, false
  );
end
$$;

create or replace function private.register_walk_in_with_visitors(
  p_site_id uuid, p_slot_id uuid, p_name text, p_adult_count integer,
  p_child_count integer, p_pwd_count integer, p_email text, p_phone text, p_visitors jsonb
)
returns table (booking_id uuid, booking_reference text, total_amount numeric, guest_access_token text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_slug text;
  v_person jsonb;
  v_index bigint;
  v_name text;
  v_address text;
  v_gender text;
  v_nationality text;
  v_booking record;
begin
  if p_visitors is null or jsonb_typeof(p_visitors) is distinct from 'array' then
    raise exception 'Visitor records must be an array';
  end if;
  select s.slug into v_slug
  from public.site_slots sl join public.tourism_sites s on s.id = sl.site_id
  where sl.id = p_slot_id and sl.site_id = p_site_id;
  if v_slug is null then raise exception 'Choose a valid destination and time slot'; end if;
  if v_slug in ('tinago-falls', 'mimbalot-falls', 'sikyop-agri-tourism-adventure', 'timoga-cold-springs') then
    if jsonb_array_length(p_visitors) <> coalesce(p_adult_count, 0) + coalesce(p_child_count, 0) then
      raise exception 'Provide one visitor record per adult and child';
    end if;
  elsif jsonb_array_length(p_visitors) <> 0 then
    raise exception 'This destination has no published individual visitor information requirements';
  end if;

  for v_person, v_index in
    select item.value, item.ordinality from jsonb_array_elements(p_visitors) with ordinality as item(value, ordinality)
  loop
    if jsonb_typeof(v_person) is distinct from 'object' then raise exception 'Each visitor record must be an object'; end if;
    v_name := nullif(trim(v_person ->> 'full_name'), '');
    v_address := nullif(trim(v_person ->> 'address'), '');
    v_gender := nullif(lower(trim(v_person ->> 'gender')), '');
    v_nationality := nullif(trim(v_person ->> 'nationality'), '');
    if v_name is null or length(v_name) > 120 or v_address is null or length(v_address) > 500 then
      raise exception 'Enter each visitor’s full name and complete address';
    end if;
    if v_slug = 'timoga-cold-springs' then
      if v_gender is not null or v_nationality is not null then raise exception 'Timoga visitor records require name and address only'; end if;
    else
      if v_gender is null or v_gender not in ('female', 'male', 'non_binary', 'prefer_not_to_say') then raise exception 'Select a gender for each visitor'; end if;
      if v_slug = 'mimbalot-falls' then
        if v_nationality is null or length(v_nationality) > 100 then raise exception 'Enter each Mimbalot visitor’s nationality'; end if;
      elsif v_nationality is not null then raise exception 'Nationality is not collected for this destination'; end if;
    end if;
  end loop;

  select * into v_booking from private.register_walk_in(
    p_site_id, p_slot_id, p_name, p_adult_count, p_child_count, p_pwd_count, p_email, p_phone
  );
  insert into public.reservation_visitors (
    booking_id, sequence_number, visitor_type, full_name, address, gender, nationality
  )
  select v_booking.booking_id, item.ordinality::integer,
    case when item.ordinality <= p_adult_count then 'adult' else 'child' end,
    trim(item.value ->> 'full_name'), trim(item.value ->> 'address'),
    nullif(lower(trim(item.value ->> 'gender')), ''), nullif(trim(item.value ->> 'nationality'), '')
  from jsonb_array_elements(p_visitors) with ordinality as item(value, ordinality);

  return query select v_booking.booking_id, v_booking.booking_reference,
    v_booking.total_amount, v_booking.guest_access_token;
end
$$;

create or replace view public.site_visit_daily_metrics with (security_invoker = true) as
select b.site_id, sl.slot_date as report_date,
  count(*) filter (where b.booking_status <> 'expired')::bigint as booking_count,
  count(*) filter (where b.booking_status = 'awaiting_payment')::bigint as pending_booking_count,
  count(*) filter (where b.booking_status = 'confirmed')::bigint as confirmed_booking_count,
  count(*) filter (where b.booking_status = 'cancelled')::bigint as cancelled_booking_count,
  coalesce(sum(b.visitor_count) filter (where b.booking_source = 'online'
    and b.booking_status in ('confirmed', 'completed') and b.payment_status in ('paid', 'not_required')), 0)::bigint as expected_visitor_count,
  coalesce(sum(b.adult_count) filter (where b.booking_source = 'online'
    and b.booking_status in ('confirmed', 'completed') and b.payment_status in ('paid', 'not_required')), 0)::bigint as adult_count,
  coalesce(sum(b.child_count) filter (where b.booking_source = 'online'
    and b.booking_status in ('confirmed', 'completed') and b.payment_status in ('paid', 'not_required')), 0)::bigint as child_count,
  coalesce(sum(a.entered_count) filter (where b.booking_source = 'online'
    and b.booking_status in ('confirmed', 'completed') and b.payment_status in ('paid', 'not_required')), 0)::bigint as checked_in_visitor_count
from public.bookings b
join public.site_slots sl on sl.id = b.slot_id
left join lateral (
  select coalesce(sum(al.visitor_count) filter (where al.action = 'entry' and al.counts_toward_occupancy), 0)::bigint as entered_count
  from public.attendance_logs al where al.booking_id = b.id
) a on true
group by b.site_id, sl.slot_date;

create or replace function public.site_live_occupancy(p_site_id uuid)
returns table (
  site_id uuid, current_visitor_count bigint, arrivals_today bigint, departures_today bigint,
  last_recorded_at timestamptz, calculated_at timestamptz, approved_visitor_limit integer, capacity_estimate integer
)
language sql stable security definer set search_path = ''
as $$
  with site as (
    select t.id from public.tourism_sites t
    where t.id = p_site_id and t.status = 'published' and private.can_read_site_data(t.id)
  ), bounds as (
    select s.*, (now() at time zone 'Asia/Manila')::date as report_date,
      ((now() at time zone 'Asia/Manila')::date::timestamp at time zone 'Asia/Manila') as day_start
    from site s
  ), attendance as (
    select a.* from public.attendance_logs a join bounds b on b.id = a.site_id
    where a.counts_toward_occupancy
  ), counts as (
    select coalesce(sum(case when a.action = 'entry' then a.visitor_count else -a.visitor_count end), 0)::bigint as current_count,
      coalesce(sum(a.visitor_count) filter (where a.action = 'entry' and a.scanned_at >= b.day_start), 0)::bigint as arrivals,
      coalesce(sum(a.visitor_count) filter (where a.action = 'exit' and a.scanned_at >= b.day_start), 0)::bigint as departures,
      max(a.scanned_at) as last_recorded_at
    from attendance a cross join bounds b
  )
  select b.id, greatest(c.current_count, 0), c.arrivals, c.departures, c.last_recorded_at, now(),
    lim.visitor_limit, assessment.estimated_capacity
  from bounds b cross join counts c
  left join lateral (
    select l.visitor_limit from public.site_approved_visitor_limits l
    where l.site_id = b.id and l.status = 'active'
      and l.effective_from <= b.report_date and (l.effective_to is null or l.effective_to >= b.report_date)
    order by l.effective_from desc, l.approved_at desc limit 1
  ) lim on true
  left join lateral (
    select a.estimated_capacity from public.site_capacity_assessments a
    where a.site_id = b.id and a.status in ('reviewed', 'approved_for_operational_use')
      and a.estimated_capacity is not null
    order by a.assessment_date desc, a.created_at desc limit 1
  ) assessment on true
$$;

create or replace function public.site_capacity_snapshot(p_site_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select to_jsonb(o) || pg_catalog.jsonb_build_object(
    'expected_visitor_count', coalesce(expected.visitor_count, 0),
    'near_threshold_percent', coalesce(r.near_threshold_percent,
      case when lim.approaching_threshold_percent < 85 then lim.approaching_threshold_percent end, 70),
    'almost_threshold_percent', coalesce(r.almost_threshold_percent, 85),
    'critical_threshold_percent', coalesce(r.critical_threshold_percent, 95),
    'restrict_at_warning', coalesce(r.restrict_at_warning, false),
    'estimated_live_capacity', r.estimated_live_capacity,
    'estimate_basis', r.estimate_basis
  )
  from public.site_live_occupancy(p_site_id) o
  left join public.site_capacity_rules r on r.site_id = o.site_id
  left join lateral (
    select l.approaching_threshold_percent from public.site_approved_visitor_limits l
    where l.site_id = o.site_id and l.status = 'active'
      and l.effective_from <= (now() at time zone 'Asia/Manila')::date
      and (l.effective_to is null or l.effective_to >= (now() at time zone 'Asia/Manila')::date)
    order by l.effective_from desc, l.approved_at desc limit 1
  ) lim on true
  left join lateral (
    select coalesce(sum(b.visitor_count), 0)::bigint as visitor_count
    from public.bookings b join public.site_slots sl on sl.id = b.slot_id
    where b.site_id = o.site_id and b.booking_source = 'online'
      and b.booking_status in ('confirmed', 'completed') and b.payment_status in ('paid', 'not_required')
      and sl.slot_date = (now() at time zone 'Asia/Manila')::date
  ) expected on true
  where private.can_read_site_data(o.site_id)
$$;

create trigger booking_capacity_change after insert or update or delete on public.bookings
  for each row execute function private.touch_capacity_change();
create trigger slot_capacity_change after insert or update or delete on public.site_slots
  for each row execute function private.touch_capacity_change();

insert into public.site_capacity_changes(site_id)
select distinct site_id from public.attendance_logs where not counts_toward_occupancy
on conflict (site_id) do update
set revision = public.site_capacity_changes.revision + 1, updated_at = now();

revoke all on function private.ticket_attendance_state(uuid, bytea, uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function private.scan_ticket(uuid, bytea, uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.manual_scan_ticket(text, uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.confirm_booking_attendance(uuid, bytea, uuid, public.attendance_action, integer, uuid[], uuid, jsonb, boolean) from public, anon, authenticated, service_role;
revoke all on function public.scan_ticket(uuid, bytea, uuid, jsonb) from public, anon;
revoke all on function public.manual_scan_ticket(text, uuid, jsonb) from public, anon;
revoke all on function public.confirm_ticket_attendance(uuid, bytea, uuid, public.attendance_action, integer, uuid, jsonb, uuid[]) from public, anon;
revoke all on function public.confirm_manual_attendance(text, uuid, public.attendance_action, integer, uuid, jsonb, uuid[]) from public, anon;
revoke all on function public.attendance_participants(text, uuid) from public, anon;
grant execute on function public.scan_ticket(uuid, bytea, uuid, jsonb) to authenticated;
grant execute on function public.manual_scan_ticket(text, uuid, jsonb) to authenticated;
grant execute on function public.confirm_ticket_attendance(uuid, bytea, uuid, public.attendance_action, integer, uuid, jsonb, uuid[]) to authenticated;
grant execute on function public.confirm_manual_attendance(text, uuid, public.attendance_action, integer, uuid, jsonb, uuid[]) to authenticated;
grant execute on function public.attendance_participants(text, uuid) to authenticated;
notify pgrst, 'reload schema';
