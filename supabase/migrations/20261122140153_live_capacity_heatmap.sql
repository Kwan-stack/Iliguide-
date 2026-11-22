-- Public Realtime payloads contain only a destination ID and revision; visitor records stay private.
create table public.site_capacity_rules (
  site_id uuid primary key references public.tourism_sites(id) on delete cascade,
  near_threshold_percent smallint not null default 70,
  almost_threshold_percent smallint not null default 85,
  critical_threshold_percent smallint not null default 95,
  restrict_at_warning boolean not null default false,
  updated_at timestamptz not null default now(),
  check (near_threshold_percent between 1 and 98
    and near_threshold_percent < almost_threshold_percent
    and almost_threshold_percent < critical_threshold_percent
    and critical_threshold_percent <= 100)
);
alter table public.site_capacity_rules enable row level security;
create policy capacity_rules_manager_read on public.site_capacity_rules for select to authenticated
  using (private.can_manage_site(site_id));
create policy capacity_rules_manager_write on public.site_capacity_rules for all to authenticated
  using (private.can_manage_site(site_id)) with check (private.can_manage_site(site_id));
grant select, insert, update, delete on public.site_capacity_rules to authenticated;
create trigger capacity_rules_updated_at before update on public.site_capacity_rules
  for each row execute function private.set_updated_at();
create trigger audit_capacity_rules after insert or update or delete on public.site_capacity_rules
  for each row execute function private.audit_row_change();

create or replace function public.site_capacity_snapshot(p_site_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select to_jsonb(o) || pg_catalog.jsonb_build_object(
    'near_threshold_percent', coalesce(r.near_threshold_percent,
      case when lim.approaching_threshold_percent < 85 then lim.approaching_threshold_percent end, 70),
    'almost_threshold_percent', coalesce(r.almost_threshold_percent, 85),
    'critical_threshold_percent', coalesce(r.critical_threshold_percent, 95),
    'restrict_at_warning', coalesce(r.restrict_at_warning, false)
  )
  from public.site_live_occupancy(p_site_id) o
  left join public.site_capacity_rules r on r.site_id = o.site_id
  left join public.tourism_sites s on s.id = o.site_id
  left join lateral (
    select l.approaching_threshold_percent from public.site_approved_visitor_limits l
    where l.site_id = o.site_id and l.status = 'active'
      and l.effective_from <= (now() at time zone s.timezone)::date
      and (l.effective_to is null or l.effective_to >= (now() at time zone s.timezone)::date)
    order by l.effective_from desc, l.approved_at desc limit 1
  ) lim on true
$$;
revoke all on function public.site_capacity_snapshot(uuid) from public;
grant execute on function public.site_capacity_snapshot(uuid) to anon, authenticated;

create table public.site_capacity_changes (
  site_id uuid primary key references public.tourism_sites(id) on delete cascade,
  revision bigint not null default 1,
  updated_at timestamptz not null default now()
);
alter table public.site_capacity_changes enable row level security;
create policy capacity_changes_published_read on public.site_capacity_changes for select to anon, authenticated
  using (exists (select 1 from public.tourism_sites s where s.id = site_id and s.status = 'published'));
grant select on public.site_capacity_changes to anon, authenticated;
alter publication supabase_realtime add table public.site_capacity_changes;

create table public.site_capacity_alerts (
  id bigint generated always as identity primary key,
  site_id uuid not null references public.tourism_sites(id) on delete cascade,
  crowd_level text not null check (crowd_level in ('available', 'near', 'almost', 'critical')),
  recorded_occupancy bigint not null check (recorded_occupancy >= 0),
  created_at timestamptz not null default now()
);
create index site_capacity_alerts_site_recent_idx on public.site_capacity_alerts(site_id, id desc);
alter table public.site_capacity_alerts enable row level security;
create policy capacity_alerts_staff_read on public.site_capacity_alerts for select to authenticated
  using (private.can_work_site(site_id));
grant select on public.site_capacity_alerts to authenticated;

-- Serialize exits as well as entries before the existing attendance validation runs.
create function private.a_lock_attendance_site()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(new.site_id::text));
  return new;
end
$$;
revoke all on function private.a_lock_attendance_site() from public, anon, authenticated, service_role;
create trigger a_lock_attendance_site before insert on public.attendance_logs
  for each row execute function private.a_lock_attendance_site();

create function private.enforce_warning_entry_policy()
returns trigger language plpgsql security definer set search_path = '' as $$
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
      and l.effective_from <= (now() at time zone s.timezone)::date
      and (l.effective_to is null or l.effective_to >= (now() at time zone s.timezone)::date)
    order by l.effective_from desc, l.approved_at desc limit 1
  ) l on true
  where s.id = new.site_id;
  if v_limit is null then return new; end if;
  select greatest(coalesce(sum(case when action = 'entry' then visitor_count else -visitor_count end), 0), 0)
    into v_occupancy from public.attendance_logs where site_id = new.site_id;
  if v_occupancy + new.visitor_count > pg_catalog.floor(v_limit::numeric * v_threshold / 100) then
    raise exception 'Configured crowd warning entry restriction reached';
  end if;
  return new;
end
$$;
revoke all on function private.enforce_warning_entry_policy() from public, anon, authenticated, service_role;
-- Run after enforce_attendance_event fills visitor_count from the validated booking.
create trigger z_enforce_warning_entry_policy before insert on public.attendance_logs
  for each row execute function private.enforce_warning_entry_policy();

create function private.touch_capacity_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_site_id uuid;
  v_snapshot jsonb;
  v_percent numeric;
  v_level text;
  v_previous text;
begin
  v_site_id := case when tg_op = 'DELETE' then old.site_id else new.site_id end;
  insert into public.site_capacity_changes(site_id) values (v_site_id)
  on conflict (site_id) do update set revision = site_capacity_changes.revision + 1, updated_at = now();
  v_snapshot := public.site_capacity_snapshot(v_site_id);
  if v_snapshot is null or (v_snapshot->>'approved_visitor_limit') is null then return null; end if;
  v_percent := (v_snapshot->>'current_visitor_count')::numeric / (v_snapshot->>'approved_visitor_limit')::numeric * 100;
  v_level := case when v_percent >= (v_snapshot->>'critical_threshold_percent')::numeric then 'critical'
    when v_percent >= (v_snapshot->>'almost_threshold_percent')::numeric then 'almost'
    when v_percent >= (v_snapshot->>'near_threshold_percent')::numeric then 'near'
    else 'available' end;
  select crowd_level into v_previous from public.site_capacity_alerts
    where site_id = v_site_id order by id desc limit 1;
  if v_level is distinct from v_previous then
    insert into public.site_capacity_alerts(site_id, crowd_level, recorded_occupancy)
      values (v_site_id, v_level, (v_snapshot->>'current_visitor_count')::bigint);
  end if;
  return null;
end
$$;
revoke all on function private.touch_capacity_change() from public, anon, authenticated, service_role;
create trigger attendance_capacity_change after insert or update or delete on public.attendance_logs
  for each row execute function private.touch_capacity_change();
create trigger approved_limit_capacity_change after insert or update or delete on public.site_approved_visitor_limits
  for each row execute function private.touch_capacity_change();
create trigger capacity_rules_change after insert or update or delete on public.site_capacity_rules
  for each row execute function private.touch_capacity_change();
