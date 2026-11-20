-- Daily gatekeeper accountability, measured capacity records, and attendance-derived occupancy.
-- No assessment or configured daily booking cap becomes an approved visitor limit automatically.

create table public.site_gatekeeper_duties (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.tourism_sites(id) on delete cascade,
  duty_date date not null,
  shift_start_at timestamptz not null,
  shift_end_at timestamptz not null,
  primary_gatekeeper_id uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'active', 'completed', 'cancelled', 'replaced')),
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  effective_at timestamptz not null default now(),
  ended_at timestamptz,
  change_reason text,
  replaced_by_assignment_id uuid references public.site_gatekeeper_duties(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (shift_end_at > shift_start_at),
  check (ended_at is null or ended_at >= effective_at)
);
create index site_gatekeeper_duties_site_time_idx
  on public.site_gatekeeper_duties(site_id, shift_start_at, shift_end_at);
create index site_gatekeeper_duties_primary_time_idx
  on public.site_gatekeeper_duties(primary_gatekeeper_id, shift_start_at, shift_end_at);

create table public.site_gatekeeper_duty_support (
  duty_id uuid not null references public.site_gatekeeper_duties(id) on delete cascade,
  gatekeeper_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (duty_id, gatekeeper_id)
);
create index site_gatekeeper_duty_support_gatekeeper_idx
  on public.site_gatekeeper_duty_support(gatekeeper_id, duty_id);

create table public.site_capacity_assessments (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.tourism_sites(id) on delete cascade,
  methodology text not null check (length(trim(methodology)) between 2 and 500),
  inputs jsonb not null default '{}'::jsonb check (jsonb_typeof(inputs) = 'object'),
  estimated_capacity integer check (estimated_capacity is null or estimated_capacity > 0),
  assessment_date date not null default current_date,
  status text not null default 'draft'
    check (status in ('draft', 'needs_review', 'reviewed', 'approved_for_operational_use', 'archived')),
  assumptions text not null default '',
  source_reference text not null default '',
  assessed_by uuid references public.profiles(id) on delete set null,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index site_capacity_assessments_site_status_date_idx
  on public.site_capacity_assessments(site_id, status, assessment_date desc);

create table public.site_capacity_zones (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.tourism_sites(id) on delete cascade,
  assessment_id uuid references public.site_capacity_assessments(id) on delete set null,
  name text not null check (length(trim(name)) between 2 and 120),
  zone_type text not null check (zone_type in ('usable', 'restricted', 'access_path')),
  geometry jsonb check (geometry is null or jsonb_typeof(geometry) in ('object', 'array')),
  plan_reference text not null default '',
  measured_area numeric(12,2) check (measured_area is null or measured_area >= 0),
  area_unit text not null default 'square_meters'
    check (area_unit in ('square_meters', 'square_feet', 'other')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index site_capacity_zones_site_idx on public.site_capacity_zones(site_id, zone_type);

create table public.site_approved_visitor_limits (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.tourism_sites(id) on delete cascade,
  visitor_limit integer not null check (visitor_limit > 0),
  effective_from date not null,
  effective_to date,
  supporting_assessment_id uuid references public.site_capacity_assessments(id) on delete set null,
  policy_reference text not null default '',
  approved_by uuid not null references public.profiles(id) on delete restrict,
  approved_at timestamptz not null default now(),
  status text not null default 'active' check (status in ('active', 'replaced', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);
create unique index site_approved_visitor_limits_one_active_start_uidx
  on public.site_approved_visitor_limits(site_id, effective_from) where status = 'active';
create index site_approved_visitor_limits_lookup_idx
  on public.site_approved_visitor_limits(site_id, effective_from, effective_to) where status = 'active';

create or replace function private.set_capacity_review_actor()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_table_name = 'site_capacity_assessments' then
    if tg_op = 'INSERT' then new.assessed_by := (select auth.uid()); end if;
    if new.status in ('reviewed', 'approved_for_operational_use')
       and (tg_op = 'INSERT' or old.status is distinct from new.status) then
      if not private.user_has_role('tourism_office') then
        raise exception 'Tourism Office approval is required for a reviewed capacity assessment';
      end if;
      new.reviewed_by := (select auth.uid());
      new.reviewed_at := now();
    end if;
  elsif tg_table_name = 'site_approved_visitor_limits' then
    if not private.user_has_role('tourism_office') then
      raise exception 'Tourism Office approval is required for visitor limits';
    end if;
    if tg_op = 'INSERT' then
      new.approved_by := (select auth.uid());
      new.approved_at := now();
    end if;
  end if;
  return new;
end
$$;
revoke all on function private.set_capacity_review_actor() from public, anon, authenticated, service_role;
create trigger set_capacity_assessment_actor
before insert or update of status on public.site_capacity_assessments
for each row execute function private.set_capacity_review_actor();
create trigger set_approved_limit_actor
before insert on public.site_approved_visitor_limits
for each row execute function private.set_capacity_review_actor();

create or replace function private.validate_capacity_zone()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.assessment_id is not null and not exists (
    select 1 from public.site_capacity_assessments a where a.id = new.assessment_id and a.site_id = new.site_id
  ) then raise exception 'Capacity zone must reference an assessment for the same destination'; end if;
  return new;
end
$$;
revoke all on function private.validate_capacity_zone() from public, anon, authenticated, service_role;
create trigger validate_capacity_zone
before insert or update of site_id, assessment_id on public.site_capacity_zones
for each row execute function private.validate_capacity_zone();

alter table public.attendance_logs
  add column duty_assignment_id uuid references public.site_gatekeeper_duties(id) on delete restrict,
  add column visitor_count integer;

update public.attendance_logs a
set visitor_count = b.visitor_count
from public.bookings b
where b.id = a.booking_id and a.visitor_count is null;

alter table public.attendance_logs
  alter column visitor_count set not null,
  add constraint attendance_logs_visitor_count_check check (visitor_count > 0);
drop index if exists public.attendance_one_exit_uidx;
create index attendance_booking_exit_idx on public.attendance_logs(booking_id, scanned_at) where action = 'exit';

alter table public.bookings
  add column walk_in_duty_assignment_id uuid references public.site_gatekeeper_duties(id) on delete restrict;

create or replace function private.is_active_gatekeeper_for_site(p_gatekeeper_id uuid, p_site_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    join public.staff_assignments a on a.profile_id = p.id
    where p.id = p_gatekeeper_id
      and p.role = 'gatekeeper' and p.account_status = 'active'
      and a.site_id = p_site_id and a.staff_role = 'gatekeeper' and a.is_active
  )
$$;

create or replace function private.validate_gatekeeper_duty()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_timezone text;
begin
  perform pg_advisory_xact_lock(hashtext(new.site_id::text));
  perform pg_advisory_xact_lock(hashtext(new.primary_gatekeeper_id::text));
  if not private.is_active_gatekeeper_for_site(new.primary_gatekeeper_id, new.site_id) then
    raise exception 'Primary gatekeeper must be active and eligible for this destination';
  end if;
  select timezone into v_timezone from public.tourism_sites where id = new.site_id;
  if new.duty_date <> (new.shift_start_at at time zone v_timezone)::date then
    raise exception 'Duty date must match the shift start date in the destination timezone';
  end if;
  if (select auth.uid()) is not null and new.primary_gatekeeper_id = (select auth.uid()) then
    raise exception 'Gatekeepers cannot create or assign their own duty roster entry';
  end if;
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
  if tg_op = 'INSERT' then new.assigned_by := (select auth.uid()); end if;
  return new;
end
$$;
revoke all on function private.is_active_gatekeeper_for_site(uuid, uuid), private.validate_gatekeeper_duty() from public, anon, authenticated, service_role;

create trigger validate_gatekeeper_duty
before insert or update of site_id, duty_date, shift_start_at, shift_end_at, primary_gatekeeper_id, status
on public.site_gatekeeper_duties for each row execute function private.validate_gatekeeper_duty();
create trigger site_gatekeeper_duties_updated_at
before update on public.site_gatekeeper_duties for each row execute function private.set_updated_at();

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
    where d.id <> v_duty.id and d.status in ('scheduled', 'active')
      and tstzrange(d.shift_start_at, d.shift_end_at, '[)') && tstzrange(v_duty.shift_start_at, v_duty.shift_end_at, '[)')
      and (d.primary_gatekeeper_id = new.gatekeeper_id or s.gatekeeper_id = new.gatekeeper_id)
  ) then raise exception 'This gatekeeper already has an overlapping duty assignment'; end if;
  return new;
end
$$;
revoke all on function private.validate_gatekeeper_duty_support() from public, anon, authenticated, service_role;
create trigger validate_gatekeeper_duty_support
before insert or update on public.site_gatekeeper_duty_support
for each row execute function private.validate_gatekeeper_duty_support();

create or replace function private.require_active_gatekeeper_duty(p_site_id uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_ids uuid[];
begin
  select array_agg(d.id order by d.shift_start_at desc) into v_ids
  from public.site_gatekeeper_duties d
  join public.profiles p on p.id = (select auth.uid())
  join public.staff_assignments a on a.profile_id = p.id and a.site_id = d.site_id
    and a.staff_role = 'gatekeeper' and a.is_active
  where d.site_id = p_site_id and d.status in ('scheduled', 'active')
    and d.shift_start_at <= now() and d.shift_end_at > now()
    and p.role = 'gatekeeper' and p.account_status = 'active'
    and (d.primary_gatekeeper_id = p.id or exists (
      select 1 from public.site_gatekeeper_duty_support s
      where s.duty_id = d.id and s.gatekeeper_id = p.id
    ));
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception 'Your account is active, but you are not assigned as gatekeeper for this destination and shift. Contact your supervisor.';
  end if;
  if array_length(v_ids, 1) <> 1 then
    raise exception 'Conflicting gatekeeper duty assignments. Contact your supervisor.';
  end if;
  return v_ids[1];
end
$$;
revoke all on function private.require_active_gatekeeper_duty(uuid) from public, anon, authenticated, service_role;

create or replace function private.enforce_attendance_event()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_entered integer; v_exited integer; v_booked integer;
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
  if new.action = 'exit' then
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
create trigger enforce_attendance_event
before insert on public.attendance_logs for each row execute function private.enforce_attendance_event();

create or replace function private.enforce_walk_in_duty()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.booking_source = 'walk_in' then
    new.walk_in_duty_assignment_id := private.require_active_gatekeeper_duty(new.site_id);
  end if;
  return new;
end
$$;
revoke all on function private.enforce_walk_in_duty() from public, anon, authenticated, service_role;
create trigger enforce_walk_in_duty
before insert on public.bookings for each row execute function private.enforce_walk_in_duty();

create or replace function private.daily_capacity_remaining(p_site_id uuid, p_date date, p_exclude_booking_id uuid default null)
returns integer language sql volatile security definer set search_path = ''
as $$
  select ss.daily_capacity - (
    select coalesce(sum(b.visitor_count), 0)::integer
    from public.bookings b
    join public.site_slots s on s.id = b.slot_id
    where b.site_id = p_site_id and s.slot_date = p_date
      and b.id is distinct from p_exclude_booking_id
      and (b.booking_status in ('confirmed', 'completed')
        or (b.booking_status = 'awaiting_payment' and b.hold_expires_at > now()))
  )
  from public.site_settings ss where ss.site_id = p_site_id
$$;
revoke all on function private.daily_capacity_remaining(uuid, date, uuid) from public, anon, authenticated, service_role;

create or replace function public.site_live_occupancy(p_site_id uuid)
returns table (
  site_id uuid,
  current_visitor_count bigint,
  arrivals_today bigint,
  departures_today bigint,
  last_recorded_at timestamptz,
  calculated_at timestamptz,
  approved_visitor_limit integer,
  capacity_estimate integer
)
language sql stable security definer set search_path = ''
as $$
  with site as (
    select id, timezone from public.tourism_sites
    where id = p_site_id and status = 'published'
  ), bounds as (
    select s.*, ((now() at time zone s.timezone)::date::timestamp at time zone s.timezone) as day_start
    from site s
  ), attendance as (
    select a.* from public.attendance_logs a join bounds b on b.id = a.site_id
  ), counts as (
    select coalesce(sum(case when action = 'entry' then visitor_count else -visitor_count end), 0)::bigint as current_count,
      coalesce(sum(visitor_count) filter (where action = 'entry' and scanned_at >= (select day_start from bounds)), 0)::bigint as arrivals,
      coalesce(sum(visitor_count) filter (where action = 'exit' and scanned_at >= (select day_start from bounds)), 0)::bigint as departures,
      max(scanned_at) as last_recorded_at
    from attendance
  )
  select b.id, greatest(c.current_count, 0), c.arrivals, c.departures, c.last_recorded_at, now(),
    lim.visitor_limit, assessment.estimated_capacity
  from bounds b cross join counts c
  left join lateral (
    select l.visitor_limit from public.site_approved_visitor_limits l
    where l.site_id = b.id and l.status = 'active'
      and l.effective_from <= (now() at time zone b.timezone)::date
      and (l.effective_to is null or l.effective_to >= (now() at time zone b.timezone)::date)
    order by l.effective_from desc, l.approved_at desc limit 1
  ) lim on true
  left join lateral (
    select a.estimated_capacity from public.site_capacity_assessments a
    where a.site_id = b.id and a.status in ('reviewed', 'approved_for_operational_use')
      and a.estimated_capacity is not null
    order by a.assessment_date desc, a.created_at desc limit 1
  ) assessment on true
$$;
revoke all on function public.site_live_occupancy(uuid) from public;
grant execute on function public.site_live_occupancy(uuid) to anon, authenticated;

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
    case when d.shift_start_at <= now() and d.shift_end_at > now() then 'active' else d.status end
  from public.site_gatekeeper_duties d
  join public.profiles p on p.id = (select auth.uid())
  join public.profiles primary_profile on primary_profile.id = d.primary_gatekeeper_id
  where d.site_id = p_site_id and d.status in ('scheduled', 'active')
    and d.shift_start_at <= now() and d.shift_end_at > now()
    and p.role = 'gatekeeper' and p.account_status = 'active'
    and (d.primary_gatekeeper_id = p.id or exists (
      select 1 from public.site_gatekeeper_duty_support s where s.duty_id = d.id and s.gatekeeper_id = p.id
    ))
$$;
revoke all on function public.my_active_gatekeeper_duty(uuid) from public, anon;
grant execute on function public.my_active_gatekeeper_duty(uuid) to authenticated;

create or replace function public.create_gatekeeper_duty(
  p_site_id uuid, p_duty_date date, p_shift_start_at timestamptz, p_shift_end_at timestamptz,
  p_primary_gatekeeper_id uuid, p_support_gatekeeper_ids uuid[] default '{}'::uuid[]
)
returns uuid language plpgsql security invoker set search_path = ''
as $$
declare v_duty_id uuid;
begin
  if not private.can_manage_site(p_site_id) then raise exception 'Destination management access denied'; end if;
  if p_support_gatekeeper_ids is null then p_support_gatekeeper_ids := '{}'::uuid[]; end if;
  if p_primary_gatekeeper_id = any(p_support_gatekeeper_ids) then
    raise exception 'Primary gatekeeper cannot also be a support gatekeeper';
  end if;
  if cardinality(p_support_gatekeeper_ids) <> cardinality(array(select distinct unnest(p_support_gatekeeper_ids))) then
    raise exception 'Each support gatekeeper can be assigned only once';
  end if;
  insert into public.site_gatekeeper_duties(
    site_id, duty_date, shift_start_at, shift_end_at, primary_gatekeeper_id
  ) values (
    p_site_id, p_duty_date, p_shift_start_at, p_shift_end_at, p_primary_gatekeeper_id
  ) returning id into v_duty_id;
  insert into public.site_gatekeeper_duty_support(duty_id, gatekeeper_id)
  select v_duty_id, support_id from unnest(p_support_gatekeeper_ids) as support_id;
  return v_duty_id;
end
$$;
revoke all on function public.create_gatekeeper_duty(uuid, date, timestamptz, timestamptz, uuid, uuid[]) from public, anon;
grant execute on function public.create_gatekeeper_duty(uuid, date, timestamptz, timestamptz, uuid, uuid[]) to authenticated;

alter table public.site_gatekeeper_duties enable row level security;
alter table public.site_gatekeeper_duty_support enable row level security;
alter table public.site_capacity_assessments enable row level security;
alter table public.site_capacity_zones enable row level security;
alter table public.site_approved_visitor_limits enable row level security;

create policy gatekeeper_duties_read_manager_or_member on public.site_gatekeeper_duties for select to authenticated
using (private.can_manage_site(site_id) or primary_gatekeeper_id = (select auth.uid()) or exists (
  select 1 from public.site_gatekeeper_duty_support s where s.duty_id = id and s.gatekeeper_id = (select auth.uid())
));
create policy gatekeeper_duties_manage on public.site_gatekeeper_duties for all to authenticated
using (private.can_manage_site(site_id)) with check (private.can_manage_site(site_id));
create policy gatekeeper_duty_support_read_manager_or_member on public.site_gatekeeper_duty_support for select to authenticated
using (exists (select 1 from public.site_gatekeeper_duties d where d.id = duty_id and (
  private.can_manage_site(d.site_id) or d.primary_gatekeeper_id = (select auth.uid()) or gatekeeper_id = (select auth.uid())
)));
create policy gatekeeper_duty_support_manage on public.site_gatekeeper_duty_support for all to authenticated
using (exists (select 1 from public.site_gatekeeper_duties d where d.id = duty_id and private.can_manage_site(d.site_id)))
with check (exists (select 1 from public.site_gatekeeper_duties d where d.id = duty_id and private.can_manage_site(d.site_id)));
create policy capacity_assessments_manager_read on public.site_capacity_assessments for select to authenticated using (private.can_manage_site(site_id));
create policy capacity_assessments_manager_write on public.site_capacity_assessments for all to authenticated
using (private.can_manage_site(site_id)) with check (private.can_manage_site(site_id));
create policy capacity_zones_manager_read on public.site_capacity_zones for select to authenticated using (private.can_manage_site(site_id));
create policy capacity_zones_manager_write on public.site_capacity_zones for all to authenticated
using (private.can_manage_site(site_id)) with check (private.can_manage_site(site_id));
create policy approved_limits_manager_read on public.site_approved_visitor_limits for select to authenticated using (private.can_manage_site(site_id));
create policy approved_limits_office_write on public.site_approved_visitor_limits for all to authenticated
using (private.user_has_role('tourism_office')) with check (private.user_has_role('tourism_office'));

create trigger site_capacity_assessments_updated_at before update on public.site_capacity_assessments for each row execute function private.set_updated_at();
create trigger site_capacity_zones_updated_at before update on public.site_capacity_zones for each row execute function private.set_updated_at();
create trigger site_approved_visitor_limits_updated_at before update on public.site_approved_visitor_limits for each row execute function private.set_updated_at();
create trigger audit_gatekeeper_duties after insert or update or delete on public.site_gatekeeper_duties for each row execute function private.audit_row_change();
create trigger audit_capacity_assessments after insert or update or delete on public.site_capacity_assessments for each row execute function private.audit_row_change();
create trigger audit_capacity_zones after insert or update or delete on public.site_capacity_zones for each row execute function private.audit_row_change();
create trigger audit_approved_limits after insert or update or delete on public.site_approved_visitor_limits for each row execute function private.audit_row_change();

grant select, insert, update, delete on public.site_gatekeeper_duties, public.site_gatekeeper_duty_support,
  public.site_capacity_assessments, public.site_capacity_zones, public.site_approved_visitor_limits to authenticated;
