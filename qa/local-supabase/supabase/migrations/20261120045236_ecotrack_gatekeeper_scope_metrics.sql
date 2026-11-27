-- Keep gatekeeper access fail-closed when an account has conflicting site assignments.
create or replace function private.user_has_site_role(p_site_id uuid, p_role public.app_role)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.staff_assignments a
    join public.profiles p on p.id = a.profile_id
    where a.site_id = p_site_id and a.profile_id = (select auth.uid())
      and a.staff_role = p_role and p.role = a.staff_role
      and a.is_active and p.account_status = 'active'
      and (p_role <> 'gatekeeper' or (
        select count(*) = 1 from public.staff_assignments active_assignment
        where active_assignment.profile_id = (select auth.uid())
          and active_assignment.staff_role = 'gatekeeper' and active_assignment.is_active
      ))
  )
$$;

-- Destination-scoped visitor access; owners retain access to their own reservation records.
drop policy reservation_visitors_owner_or_manager_read on public.reservation_visitors;
create policy reservation_visitors_owner_or_staff_read
on public.reservation_visitors for select to authenticated
using (exists (
  select 1 from public.bookings b
  where b.id = reservation_visitors.booking_id
    and (b.visitor_id = (select auth.uid()) or private.can_work_site(b.site_id))
));

drop policy audit_logs_read_staff on public.audit_logs;
create policy audit_logs_read_staff on public.audit_logs for select to authenticated
using (private.user_has_role('tourism_office')
  or (site_id is not null and private.can_work_site(site_id)));

-- Existing scans are atomic per booking. Mirror the successful entry onto each visitor row.
alter table public.reservation_visitors
  add column check_in_status text not null default 'not_checked_in'
    check (check_in_status in ('not_checked_in', 'checked_in')),
  add column checked_in_at timestamptz,
  add column checked_in_by uuid references public.profiles(id) on delete set null,
  add constraint reservation_visitors_check_in_consistency check (
    (check_in_status = 'not_checked_in' and checked_in_at is null and checked_in_by is null)
    or (check_in_status = 'checked_in' and checked_in_at is not null)
  );

with first_entry as (
  select distinct on (booking_id) booking_id, scanned_at, gatekeeper_id
  from public.attendance_logs where action = 'entry'
  order by booking_id, scanned_at, id
)
update public.reservation_visitors v
set check_in_status = 'checked_in', checked_in_at = e.scanned_at, checked_in_by = e.gatekeeper_id
from first_entry e where e.booking_id = v.booking_id;

create function private.sync_visitor_check_in()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.action = 'entry' then
    update public.reservation_visitors v
    set check_in_status = 'checked_in', checked_in_at = new.scanned_at, checked_in_by = new.gatekeeper_id
    where v.booking_id = new.booking_id and v.check_in_status = 'not_checked_in'
      and exists (
        select 1 from public.bookings b
        where b.id = new.booking_id and b.site_id = new.site_id
      );
  end if;
  return new;
end
$$;
revoke all on function private.sync_visitor_check_in() from public, anon, authenticated, service_role;
create trigger sync_visitor_check_in_from_attendance
after insert on public.attendance_logs
for each row execute function private.sync_visitor_check_in();

-- Enforce destination-specific visitor data for walk-ins, too.
create function private.register_walk_in_with_visitors(
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
    if jsonb_typeof(v_person) is distinct from 'object' then
      raise exception 'Each visitor record must be an object';
    end if;
    v_name := nullif(trim(v_person ->> 'full_name'), '');
    v_address := nullif(trim(v_person ->> 'address'), '');
    v_gender := nullif(lower(trim(v_person ->> 'gender')), '');
    v_nationality := nullif(trim(v_person ->> 'nationality'), '');
    if v_name is null or length(v_name) > 120 or v_address is null or length(v_address) > 500 then
      raise exception 'Enter each visitor’s full name and complete address';
    end if;
    if v_slug = 'timoga-cold-springs' then
      if v_gender is not null or v_nationality is not null then
        raise exception 'Timoga visitor records require name and address only';
      end if;
    else
      if v_gender is null or v_gender not in ('female', 'male', 'non_binary', 'prefer_not_to_say') then
        raise exception 'Select a gender for each visitor';
      end if;
      if v_slug = 'mimbalot-falls' then
        if v_nationality is null or length(v_nationality) > 100 then
          raise exception 'Enter each Mimbalot visitor’s nationality';
        end if;
      elsif v_nationality is not null then
        raise exception 'Nationality is not collected for this destination';
      end if;
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

  insert into public.attendance_logs(booking_id, site_id, gatekeeper_id, action, device_information, visitor_count)
  values (v_booking.booking_id, p_site_id, (select auth.uid()), 'entry', '{}'::jsonb, p_adult_count + p_child_count);

  return query select v_booking.booking_id, v_booking.booking_reference,
    v_booking.total_amount, v_booking.guest_access_token;
end
$$;
revoke all on function private.register_walk_in_with_visitors(uuid, uuid, text, integer, integer, integer, text, text, jsonb)
  from public, anon, authenticated, service_role;

revoke all on function private.register_walk_in(uuid, uuid, text, integer, integer, integer, text, text)
  from public, anon, authenticated, service_role;

create function public.register_walk_in_with_visitors(
  p_site_id uuid, p_slot_id uuid, p_name text, p_adult_count integer,
  p_child_count integer, p_pwd_count integer, p_email text, p_phone text, p_visitors jsonb
)
returns table (booking_id uuid, booking_reference text, total_amount numeric, guest_access_token text)
language sql security definer set search_path = ''
as $$ select * from private.register_walk_in_with_visitors(
  p_site_id, p_slot_id, p_name, p_adult_count, p_child_count, p_pwd_count, p_email, p_phone, p_visitors
) $$;
revoke all on function public.register_walk_in_with_visitors(uuid, uuid, text, integer, integer, integer, text, text, jsonb)
  from public, anon;
grant execute on function public.register_walk_in_with_visitors(uuid, uuid, text, integer, integer, integer, text, text, jsonb)
  to authenticated;

create view public.site_visit_daily_metrics with (security_invoker = true) as
select b.site_id, sl.slot_date as report_date,
  count(*) filter (where b.booking_status <> 'expired')::bigint as booking_count,
  count(*) filter (where b.booking_status = 'awaiting_payment')::bigint as pending_booking_count,
  count(*) filter (where b.booking_status = 'confirmed')::bigint as confirmed_booking_count,
  count(*) filter (where b.booking_status = 'cancelled')::bigint as cancelled_booking_count,
  coalesce(sum(b.visitor_count) filter (where b.booking_status in ('confirmed', 'completed')), 0)::bigint as expected_visitor_count,
  coalesce(sum(b.adult_count) filter (where b.booking_status in ('confirmed', 'completed')), 0)::bigint as adult_count,
  coalesce(sum(b.child_count) filter (where b.booking_status in ('confirmed', 'completed')), 0)::bigint as child_count,
  coalesce(sum(b.visitor_count) filter (where b.booking_status in ('confirmed', 'completed') and exists (
    select 1 from public.attendance_logs a where a.booking_id = b.id and a.action = 'entry'
  )), 0)::bigint as checked_in_visitor_count
from public.bookings b
join public.site_slots sl on sl.id = b.slot_id
group by b.site_id, sl.slot_date;
revoke all on public.site_visit_daily_metrics from public, anon;
grant select on public.site_visit_daily_metrics to authenticated;
