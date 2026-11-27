-- Model site management by organization, and scope Site Admin access to both
-- an organization membership and an active destination assignment.
create type public.site_management_authority as enum ('tourism_office', 'private_site');

create table public.management_organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 160),
  authority public.site_management_authority not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index management_organizations_one_tourism_office_uidx
  on public.management_organizations(authority) where authority = 'tourism_office';

insert into public.management_organizations (id, name, authority)
values ('00000000-0000-4000-8000-000000000001', 'Iligan City Tourism Office', 'tourism_office');

alter table public.tourism_sites
  add column management_organization_id uuid not null
  default '00000000-0000-4000-8000-000000000001'
  references public.management_organizations(id) on delete restrict;
create index tourism_sites_management_organization_idx
  on public.tourism_sites(management_organization_id);

create table public.management_organization_members (
  organization_id uuid not null references public.management_organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  is_active boolean not null default true,
  assigned_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, profile_id)
);
create index management_org_members_profile_idx
  on public.management_organization_members(profile_id, is_active);

create or replace function private.refresh_site_admin_organization_member(
  p_profile_id uuid,
  p_organization_id uuid,
  p_assigned_by uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.staff_assignments a
    join public.tourism_sites s on s.id = a.site_id
    where a.profile_id = p_profile_id
      and s.management_organization_id = p_organization_id
      and a.staff_role = 'site_admin'
      and a.is_active
  ) then
    insert into public.management_organization_members as m (
      organization_id, profile_id, is_active, assigned_by
    ) values (p_organization_id, p_profile_id, true, p_assigned_by)
    on conflict (organization_id, profile_id) do update
      set is_active = true,
          assigned_by = coalesce(excluded.assigned_by, m.assigned_by),
          updated_at = now();
  else
    update public.management_organization_members
    set is_active = false, updated_at = now()
    where organization_id = p_organization_id and profile_id = p_profile_id;
  end if;
end
$$;

create or replace function private.sync_site_admin_organization_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_organization_id uuid;
  v_new_organization_id uuid;
begin
  if tg_op = 'UPDATE' or tg_op = 'DELETE' then
    if old.staff_role = 'site_admin' then
      select s.management_organization_id into v_old_organization_id
      from public.tourism_sites s where s.id = old.site_id;
      if v_old_organization_id is not null then
        perform private.refresh_site_admin_organization_member(old.profile_id, v_old_organization_id, null);
      end if;
    end if;
  end if;

  if tg_op = 'INSERT' or tg_op = 'UPDATE' then
    if new.staff_role = 'site_admin' then
      select s.management_organization_id into v_new_organization_id
      from public.tourism_sites s where s.id = new.site_id;
      if v_new_organization_id is not null then
        perform private.refresh_site_admin_organization_member(new.profile_id, v_new_organization_id, new.assigned_by);
      end if;
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

create trigger staff_assignments_sync_management_membership
after insert or update or delete on public.staff_assignments
for each row execute function private.sync_site_admin_organization_membership();

create or replace function private.sync_site_admin_memberships_after_site_management_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid;
begin
  if old.management_organization_id is not distinct from new.management_organization_id then return new; end if;
  for v_profile_id in
    select a.profile_id
    from public.staff_assignments a
    where a.site_id = new.id and a.staff_role = 'site_admin'
  loop
    perform private.refresh_site_admin_organization_member(v_profile_id, old.management_organization_id, null);
    perform private.refresh_site_admin_organization_member(v_profile_id, new.management_organization_id, null);
  end loop;
  return new;
end
$$;

create trigger tourism_sites_sync_management_membership
after update of management_organization_id on public.tourism_sites
for each row execute function private.sync_site_admin_memberships_after_site_management_change();

-- Preserve existing Site Admin assignments. Existing destinations stay under
-- Tourism Office authority until an authorized office administrator changes them.
insert into public.management_organization_members (organization_id, profile_id, is_active, assigned_by)
select distinct s.management_organization_id, a.profile_id, true, null::uuid
from public.staff_assignments a
join public.tourism_sites s on s.id = a.site_id
where a.staff_role = 'site_admin' and a.is_active
on conflict (organization_id, profile_id) do update
  set is_active = true, updated_at = now();

create or replace function private.can_manage_site(p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tourism_sites s
    join public.management_organizations o on o.id = s.management_organization_id
    where s.id = p_site_id
      and (
        (o.authority = 'tourism_office' and private.user_has_role('tourism_office'))
        or (
          o.authority = 'private_site'
          and private.user_has_role('site_admin')
          and private.user_has_site_role(p_site_id, 'site_admin')
          and exists (
            select 1 from public.management_organization_members m
            where m.organization_id = o.id
              and m.profile_id = (select auth.uid())
              and m.is_active
          )
        )
      )
  )
$$;

create or replace function private.can_read_site_data(p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tourism_sites s
    where s.id = p_site_id and (
      private.can_work_site(s.id)
      or (s.status = 'published' and ((select auth.uid()) is null or private.current_role() = 'visitor'))
    )
  )
$$;

revoke all on function private.can_manage_site(uuid) from public;
revoke all on function private.can_read_site_data(uuid) from public;
grant execute on function private.can_manage_site(uuid), private.can_read_site_data(uuid) to anon, authenticated, service_role;

create policy management_organizations_read on public.management_organizations
for select to authenticated
using (
  (authority = 'tourism_office' and private.user_has_role('tourism_office'))
  or exists (
    select 1 from public.management_organization_members m
    where m.organization_id = id and m.profile_id = (select auth.uid()) and m.is_active
  )
);
create policy management_organizations_manage on public.management_organizations
for all to authenticated
using (authority = 'tourism_office' and private.user_has_role('tourism_office'))
with check (authority = 'tourism_office' and private.user_has_role('tourism_office'));

alter table public.management_organizations enable row level security;
alter table public.management_organization_members enable row level security;
create policy management_organization_members_read on public.management_organization_members
for select to authenticated
using (profile_id = (select auth.uid()));

create or replace function public.assign_site_management_organization(
  p_site_id uuid,
  p_management_organization_id uuid,
  p_new_private_organization_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid := p_management_organization_id;
begin
  if private.current_role() is distinct from 'tourism_office' then
    raise exception 'Tourism Office access is required to change destination management.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.tourism_sites s
    join public.management_organizations o on o.id = s.management_organization_id
    where s.id = p_site_id and o.authority = 'tourism_office'
  ) then
    raise exception 'Only Tourism Office destinations can be transferred.' using errcode = '42501';
  end if;
  if (p_management_organization_id is null and p_new_private_organization_name is null)
     or (p_management_organization_id is not null and p_new_private_organization_name is not null) then
    raise exception 'Choose an organization or provide a new private organization name.' using errcode = '22023';
  end if;

  if p_new_private_organization_name is not null then
    if length(trim(p_new_private_organization_name)) not between 2 and 160 then
      raise exception 'Organization name must contain 2 to 160 characters.' using errcode = '22023';
    end if;
    insert into public.management_organizations (name, authority, created_by)
    values (trim(p_new_private_organization_name), 'private_site', (select auth.uid()))
    returning id into v_organization_id;
  elsif not exists (
    select 1 from public.management_organizations where id = p_management_organization_id
  ) then
    raise exception 'Management organization not found.' using errcode = '22023';
  end if;

  update public.tourism_sites
  set management_organization_id = v_organization_id
  where id = p_site_id;
  if not found then raise exception 'Destination not found.' using errcode = 'P0002'; end if;
  return v_organization_id;
end
$$;

grant select, insert, update, delete on public.management_organizations to authenticated;
grant select on public.management_organization_members to authenticated;
grant all on public.management_organizations, public.management_organization_members to service_role;
revoke all on public.management_organizations, public.management_organization_members from anon;
revoke update on public.tourism_sites from authenticated;
grant update (name, category, description, address, latitude, longitude, status)
  on public.tourism_sites to authenticated;
revoke all on function public.assign_site_management_organization(uuid, uuid, text) from public, anon;
grant execute on function public.assign_site_management_organization(uuid, uuid, text) to authenticated;
revoke all on function private.refresh_site_admin_organization_member(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function private.sync_site_admin_organization_membership() from public, anon, authenticated;
revoke all on function private.sync_site_admin_memberships_after_site_management_change() from public, anon, authenticated;

create or replace function public.update_staff_assignment(
  p_assignment_id uuid,
  p_full_name text,
  p_site_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_assignment public.staff_assignments%rowtype;
begin
  if (select auth.uid()) is null
     or (private.current_role() is distinct from 'tourism_office'
         and private.current_role() is distinct from 'site_admin') then
    raise exception 'Only staff administrators can edit assignments' using errcode = '42501';
  end if;
  if p_full_name is null or length(btrim(p_full_name)) not between 1 and 120 then
    raise exception 'Name must be 1 to 120 characters' using errcode = '22023';
  end if;
  if p_site_id is null or not private.can_manage_site(p_site_id) then
    raise exception 'Choose an authorized destination' using errcode = '42501';
  end if;
  select * into v_assignment from public.staff_assignments where id = p_assignment_id for update;
  if not found then raise exception 'Staff assignment not found' using errcode = 'P0002'; end if;
  if v_assignment.staff_role <> 'gatekeeper' or not private.can_manage_site(v_assignment.site_id) then
    raise exception 'You cannot edit this staff assignment' using errcode = '42501';
  end if;
  update public.profiles set full_name = btrim(p_full_name) where id = v_assignment.profile_id;
  update public.staff_assignments set site_id = p_site_id where id = v_assignment.id;
end
$$;
revoke all on function public.update_staff_assignment(uuid, text, uuid) from public, anon;
grant execute on function public.update_staff_assignment(uuid, text, uuid) to authenticated;

drop policy if exists sites_public_read on public.tourism_sites;
create policy sites_public_read on public.tourism_sites for select
using (private.can_read_site_data(id));

drop policy if exists site_settings_public_read on public.site_settings;
create policy site_settings_public_read on public.site_settings for select to anon, authenticated
using (private.can_read_site_data(site_id));
drop policy if exists site_images_public_read on public.site_images;
create policy site_images_public_read on public.site_images for select to anon, authenticated
using (private.can_read_site_data(site_id));
drop policy if exists site_hours_public_read on public.site_operating_hours;
create policy site_hours_public_read on public.site_operating_hours for select to anon, authenticated
using (private.can_read_site_data(site_id));
drop policy if exists site_operating_exceptions_public_read on public.site_operating_exceptions;
create policy site_operating_exceptions_public_read on public.site_operating_exceptions for select to anon, authenticated
using (private.can_read_site_data(site_id));
drop policy if exists closures_public_read on public.site_closures;
create policy closures_public_read on public.site_closures for select to anon, authenticated
using (private.can_read_site_data(site_id));
drop policy if exists capacity_changes_published_read on public.site_capacity_changes;
create policy capacity_changes_published_read on public.site_capacity_changes for select to anon, authenticated
using (private.can_read_site_data(site_id));
drop policy if exists slots_public_read on public.site_slots;
create policy slots_public_read on public.site_slots for select to anon, authenticated
using ((status = 'open' and private.can_read_site_data(site_id)) or private.can_work_site(site_id));
drop policy if exists reviews_public_read on public.reviews;
create policy reviews_public_read on public.reviews for select to anon, authenticated
using (
  (review_status = 'published' and private.can_read_site_data(site_id))
  or visitor_id = (select auth.uid())
  or private.can_manage_site(site_id)
);

drop policy if exists profiles_read_own_or_staff on public.profiles;
create policy profiles_read_own_or_staff on public.profiles for select to authenticated
using (
  id = (select auth.uid())
  or exists (
    select 1 from public.staff_assignments a
    where a.profile_id = profiles.id and a.is_active and private.can_work_site(a.site_id)
  )
);
drop policy if exists staff_assignments_read on public.staff_assignments;
create policy staff_assignments_read on public.staff_assignments for select to authenticated
using (profile_id = (select auth.uid()) or private.can_manage_site(site_id));
drop policy if exists staff_assignments_insert on public.staff_assignments;
create policy staff_assignments_insert on public.staff_assignments for insert to authenticated
with check (private.can_manage_site(site_id) and staff_role = 'gatekeeper');
drop policy if exists staff_assignments_update on public.staff_assignments;
create policy staff_assignments_update on public.staff_assignments for update to authenticated
using (private.can_manage_site(site_id) and staff_role = 'gatekeeper')
with check (private.can_manage_site(site_id) and staff_role = 'gatekeeper');
drop policy if exists staff_assignments_delete on public.staff_assignments;
create policy staff_assignments_delete on public.staff_assignments for delete to authenticated
using (private.can_manage_site(site_id) and staff_role = 'gatekeeper');

drop policy if exists staff_invitations_read on public.staff_invitations;
create policy staff_invitations_read on public.staff_invitations for select to authenticated
using ((site_id is null and private.user_has_role('tourism_office')) or (site_id is not null and private.can_manage_site(site_id)));
drop policy if exists staff_invitations_insert on public.staff_invitations;
create policy staff_invitations_insert on public.staff_invitations for insert to authenticated
with check ((site_id is null and private.user_has_role('tourism_office')) or (site_id is not null and private.can_manage_site(site_id)));
drop policy if exists staff_invitations_update on public.staff_invitations;
create policy staff_invitations_update on public.staff_invitations for update to authenticated
using ((site_id is null and private.user_has_role('tourism_office')) or (site_id is not null and private.can_manage_site(site_id)))
with check ((site_id is null and private.user_has_role('tourism_office')) or (site_id is not null and private.can_manage_site(site_id)));
drop policy if exists staff_invitations_delete on public.staff_invitations;
create policy staff_invitations_delete on public.staff_invitations for delete to authenticated
using ((site_id is null and private.user_has_role('tourism_office')) or (site_id is not null and private.can_manage_site(site_id)));

drop policy if exists audit_logs_read_staff on public.audit_logs;
create policy audit_logs_read_staff on public.audit_logs for select to authenticated
using ((site_id is null and private.user_has_role('tourism_office')) or (site_id is not null and private.can_work_site(site_id)));
drop policy if exists approved_limits_office_write on public.site_approved_visitor_limits;
create policy approved_limits_office_write on public.site_approved_visitor_limits for all to authenticated
using (private.can_manage_site(site_id)) with check (private.can_manage_site(site_id));

drop policy if exists support_requests_read_owner_or_office on public.support_requests;
create policy support_requests_read_owner_or_office on public.support_requests for select to authenticated
using (
  user_id = (select auth.uid())
  or (booking_id is null and private.user_has_role('tourism_office'))
  or exists (
    select 1 from public.bookings b
    where b.id = support_requests.booking_id and private.can_work_site(b.site_id)
  )
);
drop policy if exists support_requests_update_office on public.support_requests;
create policy support_requests_update_office on public.support_requests for update to authenticated
using (
  (booking_id is null and private.user_has_role('tourism_office'))
  or exists (
    select 1 from public.bookings b
    where b.id = support_requests.booking_id and private.can_manage_site(b.site_id)
  )
)
with check (
  (booking_id is null and private.user_has_role('tourism_office'))
  or exists (
    select 1 from public.bookings b
    where b.id = support_requests.booking_id and private.can_manage_site(b.site_id)
  )
);

create or replace function public.site_live_occupancy(p_site_id uuid)
returns table (
  site_id uuid, current_visitor_count bigint, arrivals_today bigint, departures_today bigint,
  last_recorded_at timestamptz, calculated_at timestamptz, approved_visitor_limit integer, capacity_estimate integer
)
language sql stable security definer set search_path = ''
as $$
  with site as (
    select id, timezone from public.tourism_sites
    where id = p_site_id and status = 'published' and private.can_read_site_data(id)
  ), bounds as (
    select s.*, ((now() at time zone s.timezone)::date::timestamp at time zone s.timezone) as day_start from site s
  ), attendance as (
    select a.* from public.attendance_logs a join bounds b on b.id = a.site_id
  ), counts as (
    select coalesce(sum(case when action = 'entry' then visitor_count else -visitor_count end), 0)::bigint as current_count,
      coalesce(sum(visitor_count) filter (where action = 'entry' and scanned_at >= (select day_start from bounds)), 0)::bigint as arrivals,
      coalesce(sum(visitor_count) filter (where action = 'exit' and scanned_at >= (select day_start from bounds)), 0)::bigint as departures,
      max(scanned_at) as last_recorded_at from attendance
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

create or replace function public.site_capacity_snapshot(p_site_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select to_jsonb(o) || pg_catalog.jsonb_build_object(
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
  left join public.tourism_sites s on s.id = o.site_id
  left join lateral (
    select l.approaching_threshold_percent from public.site_approved_visitor_limits l
    where l.site_id = o.site_id and l.status = 'active'
      and l.effective_from <= (now() at time zone s.timezone)::date
      and (l.effective_to is null or l.effective_to >= (now() at time zone s.timezone)::date)
    order by l.effective_from desc, l.approved_at desc limit 1
  ) lim on true
  where private.can_read_site_data(o.site_id)
$$;

do $$
declare
  v_site_id constant uuid := '395fa6c5-e1d5-4e53-9577-88e2ec2e33e6';
  v_admin_id uuid;
  v_organization_id uuid;
begin
  select id into v_admin_id from public.profiles
  where lower(email) = 'ecotrack.siteadmin.demo@gov.ph'
    and role = 'site_admin' and account_status = 'active';
  if v_admin_id is null then raise exception 'The active Timoga Site Admin account was not found.'; end if;
  if not exists (select 1 from public.tourism_sites where id = v_site_id and status = 'published') then
    raise exception 'Published Timoga destination ID was not found.';
  end if;
  if exists (
    select 1 from public.staff_assignments
    where site_id = v_site_id and staff_role = 'site_admin' and is_active and profile_id <> v_admin_id
  ) then raise exception 'Timoga already has a different active Site Admin assignment.'; end if;

  insert into public.management_organizations (name, authority, created_by)
  values ('Timoga Cold Springs Administration', 'private_site', v_admin_id)
  returning id into v_organization_id;

  update public.tourism_sites set management_organization_id = v_organization_id where id = v_site_id;
  insert into public.staff_assignments (profile_id, site_id, staff_role, is_active)
  values (v_admin_id, v_site_id, 'site_admin', true)
  on conflict (profile_id, site_id) do update
    set staff_role = 'site_admin', is_active = true, updated_at = now();
end
$$;

notify pgrst, 'reload schema';
