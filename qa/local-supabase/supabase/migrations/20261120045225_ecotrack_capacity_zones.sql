alter table public.site_capacity_zones
  add column if not exists estimated_capacity integer
  check (estimated_capacity is null or estimated_capacity > 0);

create or replace function private.capacity_zone_coordinates_valid(p_value jsonb)
returns boolean language plpgsql immutable set search_path = ''
as $$
declare
  v_length integer;
  v_item jsonb;
  v_longitude numeric;
  v_latitude numeric;
begin
  if jsonb_typeof(p_value) <> 'array' then return false; end if;
  v_length := jsonb_array_length(p_value);
  if v_length between 2 and 3
     and jsonb_typeof(p_value -> 0) = 'number'
     and jsonb_typeof(p_value -> 1) = 'number' then
    v_longitude := (p_value ->> 0)::numeric;
    v_latitude := (p_value ->> 1)::numeric;
    if v_longitude < -180 or v_longitude > 180 or v_latitude < -90 or v_latitude > 90 then return false; end if;
    if v_length = 3 and jsonb_typeof(p_value -> 2) <> 'number' then return false; end if;
    return true;
  end if;
  if v_length = 0 then return false; end if;
  for v_item in select value from jsonb_array_elements(p_value) loop
    if not private.capacity_zone_coordinates_valid(v_item) then return false; end if;
  end loop;
  return true;
end
$$;
revoke all on function private.capacity_zone_coordinates_valid(jsonb) from public, anon, authenticated, service_role;

create or replace function private.validate_capacity_zone_geometry()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_type text;
begin
  if new.geometry is null then return new; end if;
  if jsonb_typeof(new.geometry) <> 'object' or jsonb_typeof(new.geometry -> 'coordinates') <> 'array' then
    raise exception 'Capacity zone geometry must be a GeoJSON geometry object';
  end if;
  v_type := new.geometry ->> 'type';
  if v_type is null
     or (new.zone_type = 'access_path' and v_type not in ('LineString', 'MultiLineString'))
     or (new.zone_type <> 'access_path' and v_type not in ('Polygon', 'MultiPolygon')) then
    raise exception 'Capacity zone geometry type does not match its zone type';
  end if;
  if not private.capacity_zone_coordinates_valid(new.geometry -> 'coordinates') then
    raise exception 'Capacity zone coordinates must use valid longitude/latitude values';
  end if;
  return new;
end
$$;
revoke all on function private.validate_capacity_zone_geometry() from public, anon, authenticated, service_role;
create trigger validate_capacity_zone_geometry
before insert or update of geometry, zone_type on public.site_capacity_zones
for each row execute function private.validate_capacity_zone_geometry();

create policy capacity_zones_active_gatekeeper_read
on public.site_capacity_zones for select to authenticated
using (
  private.user_has_site_role(site_id, 'gatekeeper')
  and exists (
    select 1
    from public.site_gatekeeper_duties d
    join public.tourism_sites s on s.id = d.site_id
    where d.site_id = site_capacity_zones.site_id
      and d.status in ('scheduled', 'active')
      and d.duty_date = (now() at time zone s.timezone)::date
      and d.shift_start_at <= now() and d.shift_end_at > now()
      and (
        d.primary_gatekeeper_id = (select auth.uid())
        or exists (
          select 1 from public.site_gatekeeper_duty_support support
          where support.duty_id = d.id and support.gatekeeper_id = (select auth.uid())
        )
      )
  )
);

create or replace function private.enforce_attendance_event()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_entered integer;
  v_exited integer;
  v_booked integer;
  v_approved_limit integer;
  v_current_occupancy bigint;
  v_site_timezone text;
begin
  new.gatekeeper_id := (select auth.uid());
  new.duty_assignment_id := private.require_active_gatekeeper_duty(new.site_id);
  select visitor_count into v_booked from public.bookings where id = new.booking_id and site_id = new.site_id;
  if v_booked is null then raise exception 'Booking does not belong to this destination'; end if;
  new.visitor_count := coalesce(new.visitor_count, v_booked);
  if new.visitor_count <= 0 then raise exception 'Attendance count must be positive'; end if;
  if new.action = 'entry' and new.visitor_count <> v_booked then
    raise exception 'A ticket arrival must match the booking visitor count';
  end if;
  if new.action = 'entry' then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(new.site_id::text));
    select timezone into v_site_timezone from public.tourism_sites where id = new.site_id;
    select l.visitor_limit into v_approved_limit
    from public.site_approved_visitor_limits l
    where l.site_id = new.site_id and l.status = 'active'
      and l.effective_from <= (now() at time zone v_site_timezone)::date
      and (l.effective_to is null or l.effective_to >= (now() at time zone v_site_timezone)::date)
    order by l.effective_from desc, l.approved_at desc limit 1;
    if v_approved_limit is not null then
      select greatest(coalesce(sum(case when action = 'entry' then visitor_count else -visitor_count end), 0), 0)
      into v_current_occupancy from public.attendance_logs where site_id = new.site_id;
      if v_current_occupancy + new.visitor_count > v_approved_limit then
        raise exception 'Approved visitor limit reached; admission cannot be recorded';
      end if;
    end if;
  elsif new.action = 'exit' then
    select coalesce(sum(visitor_count) filter (where action = 'entry'), 0),
           coalesce(sum(visitor_count) filter (where action = 'exit'), 0)
      into v_entered, v_exited from public.attendance_logs where booking_id = new.booking_id;
    if new.visitor_count > v_entered - v_exited then
      raise exception 'Departure count exceeds recorded visitors currently inside';
    end if;
  end if;
  return new;
end
$$;

revoke all on function private.enforce_attendance_event() from public, anon, authenticated, service_role;

create or replace function private.enforce_walk_in_duty()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_site_timezone text;
  v_approved_limit integer;
  v_current_occupancy bigint;
begin
  if new.booking_source = 'walk_in' then
    new.walk_in_duty_assignment_id := private.require_active_gatekeeper_duty(new.site_id);
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(new.site_id::text));
    select timezone into v_site_timezone from public.tourism_sites where id = new.site_id;
    select l.visitor_limit into v_approved_limit
    from public.site_approved_visitor_limits l
    where l.site_id = new.site_id and l.status = 'active'
      and l.effective_from <= (now() at time zone v_site_timezone)::date
      and (l.effective_to is null or l.effective_to >= (now() at time zone v_site_timezone)::date)
    order by l.effective_from desc, l.approved_at desc limit 1;
    if v_approved_limit is not null then
      select greatest(coalesce(sum(case when action = 'entry' then visitor_count else -visitor_count end), 0), 0)
      into v_current_occupancy from public.attendance_logs where site_id = new.site_id;
      if v_current_occupancy + coalesce(new.visitor_count, new.adult_count + new.child_count) > v_approved_limit then
        raise exception 'Approved visitor limit reached; walk-in cannot be admitted';
      end if;
    end if;
  end if;
  return new;
end
$$;

revoke all on function private.enforce_walk_in_duty() from public, anon, authenticated, service_role;
