create table public.site_operating_exceptions (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.tourism_sites(id) on delete cascade,
  exception_date date not null,
  opens_at time,
  closes_at time,
  is_closed boolean not null default false,
  reason text not null check (length(trim(reason)) between 2 and 500),
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, exception_date),
  check ((is_closed and opens_at is null and closes_at is null)
    or (not is_closed and opens_at is not null and closes_at > opens_at))
);
create index site_operating_exceptions_date_idx on public.site_operating_exceptions(site_id, exception_date);
create trigger site_operating_exceptions_updated_at before update on public.site_operating_exceptions
for each row execute function private.set_updated_at();
alter table public.site_operating_exceptions enable row level security;
create policy site_operating_exceptions_public_read on public.site_operating_exceptions for select to anon, authenticated
using (exists (select 1 from public.tourism_sites s where s.id = site_id and s.status = 'published'));
create policy site_operating_exceptions_manager_read on public.site_operating_exceptions for select to authenticated
using (private.can_manage_site(site_id));
create policy site_operating_exceptions_manager_write on public.site_operating_exceptions for all to authenticated
using (private.can_manage_site(site_id)) with check (private.can_manage_site(site_id));
grant select on public.site_operating_exceptions to anon, authenticated;
grant insert, update, delete on public.site_operating_exceptions to authenticated;

create or replace function private.site_operating_period_allows(
  p_site_id uuid, p_date date, p_starts_at time, p_ends_at time
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case when exists (
    select 1 from public.site_operating_exceptions e
    where e.site_id = p_site_id and e.exception_date = p_date
  ) then exists (
    select 1 from public.site_operating_exceptions e
    where e.site_id = p_site_id and e.exception_date = p_date and not e.is_closed
      and p_starts_at >= e.opens_at and p_ends_at <= e.closes_at
  ) else exists (
    select 1 from public.site_operating_hours h
    where h.site_id = p_site_id and h.weekday = extract(dow from p_date)::smallint
      and not h.is_closed and p_starts_at >= h.opens_at and p_ends_at <= h.closes_at
  ) end
$$;
revoke all on function private.site_operating_period_allows(uuid, date, time, time) from public, anon, authenticated, service_role;

create or replace function private.get_slot_availability(p_site_id uuid, p_from date, p_to date)
returns table (
  slot_id uuid, site_id uuid, slot_date date, starts_at time, ends_at time,
  capacity integer, remaining_capacity integer, status public.slot_status
)
language sql volatile security definer set search_path = ''
as $$
  select s.id, s.site_id, s.slot_date, s.starts_at, s.ends_at, s.capacity,
    least(greatest(s.capacity - coalesce(sum(b.visitor_count) filter (
      where b.booking_status = 'confirmed'
        or (b.booking_status = 'awaiting_payment' and b.hold_expires_at > now())
    ), 0)::integer, 0),
      greatest(coalesce(private.daily_capacity_remaining(s.site_id, s.slot_date), 2147483647), 0)),
    s.status
  from public.site_slots s
  join public.tourism_sites t on t.id = s.site_id
  left join public.bookings b on b.slot_id = s.id
  where s.site_id = p_site_id and s.slot_date between p_from and p_to
    and p_to >= p_from and p_to <= p_from + 62 and s.status = 'open' and t.status = 'published'
    and private.site_operating_period_allows(s.site_id, s.slot_date, s.starts_at, s.ends_at)
    and not exists (
      select 1 from public.site_closures c
      where c.site_id = s.site_id and s.slot_date between c.starts_on and c.ends_on
        and (c.starts_at is null or (c.starts_at < s.ends_at and c.ends_at > s.starts_at))
    )
  group by s.id
  order by s.slot_date, s.starts_at
$$;

create or replace function private.enforce_booking_operating_period()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_slot public.site_slots%rowtype;
begin
  select * into v_slot from public.site_slots s
  where s.id = new.slot_id and s.site_id = new.site_id;
  if not found then raise exception 'Booking time slot does not match its destination'; end if;
  if not private.site_operating_period_allows(v_slot.site_id, v_slot.slot_date, v_slot.starts_at, v_slot.ends_at) then
    raise exception 'Booking time is outside the destination operating hours';
  end if;
  return new;
end
$$;
revoke all on function private.enforce_booking_operating_period() from public, anon, authenticated, service_role;
create trigger bookings_operating_period_guard before insert or update of site_id, slot_id
on public.bookings for each row execute function private.enforce_booking_operating_period();

create or replace function private.create_booking_hold(
  p_slot_id uuid, p_name text, p_adult_count integer,
  p_child_count integer default 0, p_email text default null, p_phone text default null
)
returns table (
  booking_id uuid, booking_reference text, hold_expires_at timestamptz,
  total_amount numeric, guest_access_token text
)
language plpgsql security definer set search_path = ''
as $$
declare
  v_slot public.site_slots%rowtype;
  v_site public.tourism_sites%rowtype;
  v_settings public.site_settings%rowtype;
  v_booked integer;
  v_total numeric(12,2);
  v_booking_id uuid := gen_random_uuid();
  v_reference text := 'ILG-' || upper(encode(extensions.gen_random_bytes(8), 'hex'));
  v_expires timestamptz := now() + interval '10 minutes';
  v_guest_token text;
begin
  if p_adult_count is null or p_adult_count < 1 or p_child_count is null or p_child_count < 0
     or p_adult_count + p_child_count > 100
     or nullif(trim(p_name), '') is null
     or (nullif(trim(p_email), '') is null and nullif(trim(p_phone), '') is null) then
    raise exception 'Enter a name, one contact method, and a valid visitor count';
  end if;
  if auth.uid() is not null and private.current_role() is distinct from 'visitor' then
    raise exception 'Only active visitor accounts can make online bookings';
  end if;

  select * into v_slot from public.site_slots s where s.id = p_slot_id for update;
  if not found or v_slot.status <> 'open' then raise exception 'This time slot is unavailable'; end if;
  select * into v_site from public.tourism_sites t where t.id = v_slot.site_id and t.status = 'published';
  if not found then raise exception 'This destination is not accepting reservations'; end if;
  select * into v_settings from public.site_settings ss where ss.site_id = v_site.id;
  if not found then raise exception 'This destination has not configured its booking fees'; end if;
  if p_adult_count + p_child_count > v_settings.max_per_booking then
    raise exception 'Visitor count exceeds the site booking limit';
  end if;
  if not private.site_operating_period_allows(v_site.id, v_slot.slot_date, v_slot.starts_at, v_slot.ends_at) then
    raise exception 'This time slot is outside the published operating hours';
  end if;
  if v_slot.slot_date < (now() at time zone v_site.timezone)::date then
    raise exception 'Past dates cannot be booked';
  end if;
  if v_slot.slot_date = (now() at time zone v_site.timezone)::date
     and v_slot.ends_at <= (now() at time zone v_site.timezone)::time then
    raise exception 'This time slot has already ended';
  end if;
  if exists (
    select 1 from public.site_closures c
    where c.site_id = v_site.id and v_slot.slot_date between c.starts_on and c.ends_on
      and (c.starts_at is null or (c.starts_at < v_slot.ends_at and c.ends_at > v_slot.starts_at))
  ) then raise exception 'The destination is closed during this time'; end if;

  update public.bookings b set booking_status = 'expired', hold_expires_at = null
  where b.slot_id = v_slot.id and b.booking_status = 'awaiting_payment'
    and b.hold_expires_at <= now() and b.payment_status in ('pending', 'failed', 'expired');
  update public.booking_holds h set status = 'expired'
  where h.slot_id = v_slot.id and h.status = 'active' and h.expires_at <= now();

  select coalesce(sum(b.visitor_count), 0)::integer into v_booked
  from public.bookings b where b.slot_id = v_slot.id
    and (b.booking_status = 'confirmed'
      or (b.booking_status = 'awaiting_payment' and b.hold_expires_at > now()));
  if v_booked + p_adult_count + p_child_count > v_slot.capacity then
    raise exception 'Not enough spaces remain in this time slot';
  end if;

  v_total := (v_settings.adult_fee * p_adult_count) + (v_settings.child_fee * p_child_count);
  if auth.uid() is null then v_guest_token := encode(extensions.gen_random_bytes(32), 'hex'); end if;
  insert into public.bookings(
    id, booking_reference, visitor_id, site_id, slot_id, visitor_name,
    visitor_email, visitor_phone, adult_count, child_count, total_amount,
    booking_status, payment_status, hold_expires_at, cancellation_cutoff_at
  ) values (
    v_booking_id, v_reference, auth.uid(), v_site.id, v_slot.id, trim(p_name),
    nullif(lower(trim(p_email)), ''), nullif(trim(p_phone), ''), p_adult_count, p_child_count,
    v_total, 'awaiting_payment', 'pending', v_expires,
    ((v_slot.slot_date + v_slot.starts_at) at time zone v_site.timezone)
      - (v_settings.cancellation_cutoff_hours * interval '1 hour')
  );
  insert into public.booking_holds(booking_id, slot_id, held_capacity, expires_at)
  values (v_booking_id, v_slot.id, p_adult_count + p_child_count, v_expires);
  if v_guest_token is not null then
    insert into public.booking_access_tokens(booking_id, token_hash)
    values (v_booking_id, extensions.digest(convert_to(v_guest_token, 'UTF8'), 'sha256'));
  end if;
  return query select v_booking_id, v_reference, v_expires, v_total, v_guest_token;
end
$$;
revoke all on function private.create_booking_hold(uuid, text, integer, integer, text, text)
  from public, anon, authenticated, service_role;

create or replace function private.validate_gatekeeper_duty()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_timezone text; v_opens_at time; v_closes_at time; v_is_closed boolean; v_site_status public.site_status;
begin
  if tg_op = 'UPDATE' and old.status in ('scheduled', 'active')
    and new.status not in ('scheduled', 'active') then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext(new.site_id::text));
  perform pg_advisory_xact_lock(hashtext(new.primary_gatekeeper_id::text));
  if not private.is_active_gatekeeper_for_site(new.primary_gatekeeper_id, new.site_id) then
    raise exception 'Primary gatekeeper must be active and eligible for this destination';
  end if;
  select timezone, status into v_timezone, v_site_status from public.tourism_sites where id = new.site_id;
  if v_site_status <> 'published' then
    raise exception 'Destination must be published and open for duty assignment';
  end if;
  if new.status in ('scheduled', 'active')
    and new.duty_date < (now() at time zone v_timezone)::date then
    raise exception 'Cannot assign a past date';
  end if;
  if new.duty_date <> (new.shift_start_at at time zone v_timezone)::date then
    raise exception 'Duty date must match the shift start date in the destination timezone';
  end if;
  if new.status in ('scheduled', 'active') then
    select opens_at, closes_at, is_closed into v_opens_at, v_closes_at, v_is_closed
    from public.site_operating_exceptions
    where site_id = new.site_id and exception_date = new.duty_date;
    if not found then
      select opens_at, closes_at, is_closed into v_opens_at, v_closes_at, v_is_closed
      from public.site_operating_hours
      where site_id = new.site_id and weekday = extract(dow from new.duty_date)::smallint;
    end if;
    if not found or coalesce(v_is_closed, true)
      or new.shift_start_at <> ((new.duty_date + v_opens_at) at time zone v_timezone)
      or new.shift_end_at <> ((new.duty_date + v_closes_at) at time zone v_timezone) then
      raise exception 'Duty hours must match the destination operating schedule';
    end if;
    if exists (
      select 1 from public.site_closures c
      where c.site_id = new.site_id and new.duty_date between c.starts_on and c.ends_on
        and (c.starts_at is null or (c.starts_at < v_closes_at and c.ends_at > v_opens_at))
    ) then raise exception 'Destination has a closure during its operating hours'; end if;
  end if;
  if (select auth.uid()) is not null and new.primary_gatekeeper_id = (select auth.uid()) then
    raise exception 'Gatekeepers cannot create or assign their own duty roster entry';
  end if;
  if new.status in ('scheduled', 'active') and exists (
    select 1 from public.site_gatekeeper_duties d
    where d.id <> coalesce(new.id, gen_random_uuid()) and d.site_id = new.site_id
      and d.duty_date = new.duty_date and d.status in ('scheduled', 'active')
  ) then raise exception 'Only one daily gatekeeper assignment is allowed for this destination'; end if;
  if exists (
    select 1 from public.site_gatekeeper_duties d
    where d.id <> coalesce(new.id, gen_random_uuid())
      and d.site_id = new.site_id and d.status in ('scheduled', 'active')
      and tstzrange(d.shift_start_at, d.shift_end_at, '[)') && tstzrange(new.shift_start_at, new.shift_end_at, '[)')
  ) then raise exception 'This destination already has a gatekeeper duty during that shift'; end if;
  if exists (
    select 1 from public.site_gatekeeper_duties d
    left join public.site_gatekeeper_duty_support s on s.duty_id = d.id
    where d.id <> coalesce(new.id, gen_random_uuid()) and d.status in ('scheduled', 'active')
      and tstzrange(d.shift_start_at, d.shift_end_at, '[)') && tstzrange(new.shift_start_at, new.shift_end_at, '[)')
      and (d.primary_gatekeeper_id = new.primary_gatekeeper_id or s.gatekeeper_id = new.primary_gatekeeper_id)
  ) then raise exception 'This gatekeeper already has an overlapping duty assignment'; end if;
  if exists (
    select 1 from public.site_gatekeeper_duties d
    left join public.site_gatekeeper_duty_support s on s.duty_id = d.id
    where d.site_id <> new.site_id and d.duty_date = new.duty_date
      and d.status in ('scheduled', 'active')
      and (d.primary_gatekeeper_id = new.primary_gatekeeper_id or s.gatekeeper_id = new.primary_gatekeeper_id)
  ) then raise exception 'A gatekeeper cannot be assigned to two destinations on the same date'; end if;
  if tg_op = 'INSERT' then new.assigned_by := (select auth.uid()); end if;
  return new;
end
$$;
revoke all on function private.validate_gatekeeper_duty() from public, anon, authenticated, service_role;

create or replace function private.validate_gatekeeper_duty_support()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_duty public.site_gatekeeper_duties%rowtype;
begin
  select * into v_duty from public.site_gatekeeper_duties where id = new.duty_id;
  if not found then raise exception 'Duty assignment was not found'; end if;
  perform pg_advisory_xact_lock(hashtext(new.gatekeeper_id::text));
  if new.gatekeeper_id = v_duty.primary_gatekeeper_id then
    raise exception 'Primary gatekeeper cannot also be a support gatekeeper';
  end if;
  if not private.is_active_gatekeeper_for_site(new.gatekeeper_id, v_duty.site_id) then
    raise exception 'Support gatekeeper must be active and eligible for this destination';
  end if;
  if (select auth.uid()) is not null and new.gatekeeper_id = (select auth.uid()) then
    raise exception 'Gatekeepers cannot assign themselves to a duty roster entry';
  end if;
  if exists (
    select 1 from public.site_gatekeeper_duties d
    left join public.site_gatekeeper_duty_support s on s.duty_id = d.id
    where d.site_id <> v_duty.site_id and d.duty_date = v_duty.duty_date
      and d.status in ('scheduled', 'active')
      and (d.primary_gatekeeper_id = new.gatekeeper_id or s.gatekeeper_id = new.gatekeeper_id)
  ) then raise exception 'A gatekeeper cannot be assigned to two destinations on the same date'; end if;
  if exists (
    select 1 from public.site_gatekeeper_duties d
    left join public.site_gatekeeper_duty_support s on s.duty_id = d.id
    where d.id <> v_duty.id and d.status in ('scheduled', 'active')
      and tstzrange(d.shift_start_at, d.shift_end_at, '[)') && tstzrange(v_duty.shift_start_at, v_duty.shift_end_at, '[)')
      and (d.primary_gatekeeper_id = new.gatekeeper_id or s.gatekeeper_id = new.gatekeeper_id)
  ) then raise exception 'This gatekeeper already has an overlapping duty assignment'; end if;
  return new;
end
$$;
revoke all on function private.validate_gatekeeper_duty_support() from public, anon, authenticated, service_role;

create or replace function private.sync_gatekeeper_duty_schedule(
  p_site_id uuid, p_from_date date default null, p_through_date date default null, p_weekday smallint default null
)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  with schedule as (
    select d.id, d.duty_date, site.timezone,
      coalesce(exception.is_closed, hours.is_closed, true) as is_closed,
      coalesce(exception.opens_at, hours.opens_at) as opens_at,
      coalesce(exception.closes_at, hours.closes_at) as closes_at,
      exists (
        select 1 from public.site_closures closure
        where closure.site_id = d.site_id and d.duty_date between closure.starts_on and closure.ends_on
          and (closure.starts_at is null or (closure.starts_at < coalesce(exception.closes_at, hours.closes_at)
            and closure.ends_at > coalesce(exception.opens_at, hours.opens_at)))
      ) as overlaps_closure
    from public.site_gatekeeper_duties d
    join public.tourism_sites site on site.id = d.site_id
    left join public.site_operating_exceptions exception on exception.site_id = d.site_id and exception.exception_date = d.duty_date
    left join public.site_operating_hours hours on hours.site_id = d.site_id and hours.weekday = extract(dow from d.duty_date)::smallint
    where d.site_id = p_site_id and d.status = 'scheduled'
      and d.duty_date >= (now() at time zone site.timezone)::date
      and d.shift_end_at > now()
      and (p_from_date is null or d.duty_date >= p_from_date)
      and (p_through_date is null or d.duty_date <= p_through_date)
      and (p_weekday is null or extract(dow from d.duty_date)::smallint = p_weekday)
  )
  update public.site_gatekeeper_duties d
  set status = case when schedule.is_closed or schedule.overlaps_closure then 'cancelled' else d.status end,
      change_reason = case when schedule.is_closed or schedule.overlaps_closure
        then 'Operating hours or closure changed' else 'Operating hours updated' end,
      shift_start_at = case when not schedule.is_closed and not schedule.overlaps_closure
        then (schedule.duty_date + schedule.opens_at) at time zone schedule.timezone else d.shift_start_at end,
      shift_end_at = case when not schedule.is_closed and not schedule.overlaps_closure
        then (schedule.duty_date + schedule.closes_at) at time zone schedule.timezone else d.shift_end_at end
  from schedule where d.id = schedule.id;
end
$$;
revoke all on function private.sync_gatekeeper_duty_schedule(uuid, date, date, smallint) from public, anon, authenticated, service_role;

create or replace function private.sync_gatekeeper_duty_schedule_after_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_site_id uuid; v_from date; v_through date; v_weekday smallint;
begin
  v_site_id := coalesce(new.site_id, old.site_id);
  if tg_table_name = 'site_operating_hours' then
    v_weekday := coalesce(new.weekday, old.weekday)::smallint;
  elsif tg_table_name = 'site_operating_exceptions' then
    v_from := coalesce(new.exception_date, old.exception_date);
    v_through := v_from;
  else
    v_from := least(new.starts_on, old.starts_on);
    v_through := greatest(new.ends_on, old.ends_on);
  end if;
  perform private.sync_gatekeeper_duty_schedule(v_site_id, v_from, v_through, v_weekday);
  return null;
end
$$;
revoke all on function private.sync_gatekeeper_duty_schedule_after_change() from public, anon, authenticated, service_role;

drop trigger if exists site_operating_hours_sync_duty on public.site_operating_hours;
create trigger site_operating_hours_sync_duty after insert or update or delete on public.site_operating_hours
for each row execute function private.sync_gatekeeper_duty_schedule_after_change();
drop trigger if exists site_operating_exceptions_sync_duty on public.site_operating_exceptions;
create trigger site_operating_exceptions_sync_duty after insert or update or delete on public.site_operating_exceptions
for each row execute function private.sync_gatekeeper_duty_schedule_after_change();
drop trigger if exists site_closures_sync_duty on public.site_closures;
create trigger site_closures_sync_duty after insert or update or delete on public.site_closures
for each row execute function private.sync_gatekeeper_duty_schedule_after_change();

create or replace function public.save_gatekeeper_day_assignment(
  p_site_id uuid,
  p_duty_date date,
  p_primary_gatekeeper_id uuid,
  p_support_gatekeeper_ids uuid[] default '{}'::uuid[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_timezone text;
  v_site_status public.site_status;
  v_opens_at time;
  v_closes_at time;
  v_is_closed boolean;
  v_shift_start timestamptz;
  v_shift_end timestamptz;
  v_ids uuid[];
  v_duty_id uuid;
  v_existing_status text;
  v_existing_start timestamptz;
  v_assignment_count integer;
begin
  if not private.can_manage_site(p_site_id) then
    raise exception 'Destination management access denied';
  end if;
  if p_primary_gatekeeper_id is null then
    raise exception 'Choose a primary gatekeeper';
  end if;
  if p_support_gatekeeper_ids is null then
    p_support_gatekeeper_ids := '{}'::uuid[];
  end if;
  if array_position(p_support_gatekeeper_ids, null) is not null
    or cardinality(p_support_gatekeeper_ids) <> cardinality(array(select distinct unnest(p_support_gatekeeper_ids))) then
    raise exception 'Each support gatekeeper can be assigned only once';
  end if;
  if p_primary_gatekeeper_id = any(p_support_gatekeeper_ids) then
    raise exception 'Primary gatekeeper cannot also be a support gatekeeper';
  end if;

  select timezone, status into v_timezone, v_site_status
  from public.tourism_sites where id = p_site_id;
  if not found then raise exception 'Destination was not found'; end if;
  if v_site_status <> 'published' then
    raise exception 'Destination must be published and open for duty assignment';
  end if;
  if p_duty_date < (now() at time zone v_timezone)::date then
    raise exception 'Cannot assign a past date';
  end if;

  select opens_at, closes_at, is_closed into v_opens_at, v_closes_at, v_is_closed
  from public.site_operating_exceptions
  where site_id = p_site_id and exception_date = p_duty_date;
  if found then
    if v_is_closed then raise exception 'Destination is closed on this date'; end if;
  else
    select opens_at, closes_at into v_opens_at, v_closes_at
    from public.site_operating_hours
    where site_id = p_site_id and weekday = extract(dow from p_duty_date)::smallint and not is_closed;
    if not found then raise exception 'Destination is closed on this weekday'; end if;
  end if;
  if exists (
    select 1 from public.site_closures c
    where c.site_id = p_site_id and p_duty_date between c.starts_on and c.ends_on
      and (c.starts_at is null or (c.starts_at < v_closes_at and c.ends_at > v_opens_at))
  ) then raise exception 'Destination has a closure during its operating hours'; end if;

  v_shift_start := (p_duty_date + v_opens_at) at time zone v_timezone;
  v_shift_end := (p_duty_date + v_closes_at) at time zone v_timezone;
  if v_shift_end <= now() then
    raise exception 'Destination operating hours have ended for this date';
  end if;

  v_ids := array[p_primary_gatekeeper_id] || p_support_gatekeeper_ids;

  if exists (
    select 1
    from public.site_gatekeeper_duties d
    left join public.site_gatekeeper_duty_support s on s.duty_id = d.id
    where d.duty_date = p_duty_date and d.site_id <> p_site_id
      and d.status in ('scheduled', 'active')
      and (d.primary_gatekeeper_id = any(v_ids) or s.gatekeeper_id = any(v_ids))
  ) then raise exception 'A gatekeeper is already assigned to another destination on this date'; end if;

  if exists (
    select 1 from public.site_gatekeeper_duties d
    where d.site_id = p_site_id and d.duty_date = p_duty_date and d.status = 'completed'
  ) then raise exception 'A completed duty cannot be reassigned on the same date'; end if;

  select count(*) into v_assignment_count
  from public.site_gatekeeper_duties d
  where d.site_id = p_site_id and d.duty_date = p_duty_date
    and d.status in ('scheduled', 'active');
  if v_assignment_count > 1 then
    raise exception 'Multiple active assignments exist for this date; resolve the legacy shifts first';
  end if;

  if v_assignment_count = 1 then
    select id, status, shift_start_at into v_duty_id, v_existing_status, v_existing_start
    from public.site_gatekeeper_duties
    where site_id = p_site_id and duty_date = p_duty_date
      and status in ('scheduled', 'active')
    for update;
    if v_existing_status <> 'scheduled' or v_existing_start <= now() then
      raise exception 'A started duty assignment cannot be changed';
    end if;
    delete from public.site_gatekeeper_duty_support where duty_id = v_duty_id;
    update public.site_gatekeeper_duties
    set shift_start_at = v_shift_start, shift_end_at = v_shift_end,
      primary_gatekeeper_id = p_primary_gatekeeper_id,
      assigned_by = (select auth.uid()), assigned_at = now(),
      change_reason = 'Daily assignment updated'
    where id = v_duty_id;
  else
    insert into public.site_gatekeeper_duties(
      site_id, duty_date, shift_start_at, shift_end_at, primary_gatekeeper_id
    ) values (
      p_site_id, p_duty_date, v_shift_start, v_shift_end, p_primary_gatekeeper_id
    ) returning id into v_duty_id;
  end if;

  insert into public.site_gatekeeper_duty_support(duty_id, gatekeeper_id)
  select v_duty_id, support_id from unnest(p_support_gatekeeper_ids) as support_id;
  return v_duty_id;
end
$$;
revoke all on function public.save_gatekeeper_day_assignment(uuid, date, uuid, uuid[]) from public, anon;
grant execute on function public.save_gatekeeper_day_assignment(uuid, date, uuid, uuid[]) to authenticated;

create or replace function public.repeat_gatekeeper_day_assignment(
  p_site_id uuid, p_from_date date, p_through_date date, p_weekdays smallint[],
  p_primary_gatekeeper_id uuid, p_support_gatekeeper_ids uuid[] default '{}'::uuid[]
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_timezone text;
  v_date date;
  v_count integer := 0;
begin
  if not private.can_manage_site(p_site_id) then
    raise exception 'Destination management access denied';
  end if;
  select timezone into v_timezone from public.tourism_sites where id = p_site_id;
  if not found then raise exception 'Destination was not found'; end if;
  if p_from_date > p_through_date or p_through_date > p_from_date + 89 then
    raise exception 'Choose a date range of 90 days or less';
  end if;
  if p_from_date < (now() at time zone v_timezone)::date then
    raise exception 'Past dates cannot be assigned';
  end if;
  if coalesce(cardinality(p_weekdays), 0) = 0
    or exists (select 1 from unnest(p_weekdays) as choices(weekday) where choices.weekday not between 0 and 6)
    or cardinality(p_weekdays) <> (select count(distinct choices.weekday) from unnest(p_weekdays) as choices(weekday)) then
    raise exception 'Choose one or more valid weekdays';
  end if;
  if p_support_gatekeeper_ids is null then p_support_gatekeeper_ids := '{}'::uuid[]; end if;

  for v_date in
    select day_value::date
    from generate_series(p_from_date::timestamp, p_through_date::timestamp, interval '1 day') as days(day_value)
  loop
    if extract(dow from v_date)::smallint = any(p_weekdays) then
      perform public.save_gatekeeper_day_assignment(
        p_site_id, v_date, p_primary_gatekeeper_id, p_support_gatekeeper_ids
      );
      v_count := v_count + 1;
    end if;
  end loop;
  if v_count = 0 then raise exception 'No dates match the selected weekdays'; end if;
  return v_count;
end
$$;
revoke all on function public.repeat_gatekeeper_day_assignment(uuid, date, date, smallint[], uuid, uuid[]) from public, anon;
grant execute on function public.repeat_gatekeeper_day_assignment(uuid, date, date, smallint[], uuid, uuid[]) to authenticated;

create or replace function public.remove_gatekeeper_day_assignment(
  p_site_id uuid,
  p_duty_date date
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_timezone text;
  v_assignment_count integer;
  v_duty_id uuid;
  v_shift_start timestamptz;
  v_status text;
begin
  if not private.can_manage_site(p_site_id) then
    raise exception 'Destination management access denied';
  end if;
  select timezone into v_timezone from public.tourism_sites where id = p_site_id;
  if not found then raise exception 'Destination was not found'; end if;
  if p_duty_date < (now() at time zone v_timezone)::date then
    raise exception 'Past duty records cannot be removed';
  end if;

  select count(*) into v_assignment_count
  from public.site_gatekeeper_duties
  where site_id = p_site_id and duty_date = p_duty_date
    and status in ('scheduled', 'active');
  if v_assignment_count = 0 then return false; end if;
  if v_assignment_count > 1 then
    raise exception 'Multiple active assignments exist for this date; resolve the legacy shifts first';
  end if;

  select id, status, shift_start_at into v_duty_id, v_status, v_shift_start
  from public.site_gatekeeper_duties
  where site_id = p_site_id and duty_date = p_duty_date
    and status in ('scheduled', 'active')
  for update;
  if v_status <> 'scheduled' or v_shift_start <= now() then
    raise exception 'A started duty assignment cannot be removed';
  end if;
  update public.site_gatekeeper_duties set status = 'cancelled', change_reason = 'Daily assignment removed'
  where id = v_duty_id;
  return true;
end
$$;
revoke all on function public.remove_gatekeeper_day_assignment(uuid, date) from public, anon;
grant execute on function public.remove_gatekeeper_day_assignment(uuid, date) to authenticated;

create or replace function public.my_active_gatekeeper_duty(p_site_id uuid)
returns table (
  duty_id uuid, duty_date date, shift_start_at timestamptz, shift_end_at timestamptz,
  duty_role text, primary_gatekeeper_name text, effective_status text
)
language sql stable security definer set search_path = ''
as $$
  select d.id, d.duty_date, d.shift_start_at, d.shift_end_at,
    case when d.primary_gatekeeper_id = (select auth.uid()) then 'primary' else 'support' end,
    primary_profile.full_name,
    case when d.status = 'completed' or d.shift_end_at <= now() then 'completed'
      when d.shift_start_at <= now() then 'on_duty' else 'scheduled_today' end
  from public.site_gatekeeper_duties d
  join public.tourism_sites site on site.id = d.site_id
  join public.profiles p on p.id = (select auth.uid())
  join public.profiles primary_profile on primary_profile.id = d.primary_gatekeeper_id
  where d.site_id = p_site_id
    and d.duty_date = (now() at time zone coalesce(site.timezone, 'Asia/Manila'))::date
    and d.status in ('scheduled', 'active', 'completed')
    and p.role = 'gatekeeper' and p.account_status = 'active'
    and (d.primary_gatekeeper_id = p.id or exists (
      select 1 from public.site_gatekeeper_duty_support s where s.duty_id = d.id and s.gatekeeper_id = p.id
    ))
  order by d.shift_start_at
  limit 1
$$;
revoke all on function public.my_active_gatekeeper_duty(uuid) from public, anon;
grant execute on function public.my_active_gatekeeper_duty(uuid) to authenticated;

revoke all on function public.create_gatekeeper_duty(uuid, date, timestamptz, timestamptz, uuid, uuid[]) from authenticated;
