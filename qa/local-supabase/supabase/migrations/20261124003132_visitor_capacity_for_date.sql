create function private.site_capacity_for_date(p_site_id uuid, p_visit_date date)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_timezone text;
  v_today date;
  v_live record;
  v_daily_capacity integer;
  v_daily_used integer;
  v_daily_remaining integer;
  v_reserved integer;
  v_slot_capacity integer;
  v_slot_remaining integer;
  v_max_slot_remaining integer;
  v_approved_limit integer;
  v_rules record;
  v_updated_at timestamptz;
begin
  if p_site_id is null or p_visit_date is null then return null; end if;

  select s.timezone into v_timezone from public.tourism_sites s
  where s.id = p_site_id and private.can_read_site_data(s.id);
  if not found then return null; end if;
  v_today := (now() at time zone v_timezone)::date;
  if p_visit_date < v_today or p_visit_date > v_today + 62 then return null; end if;

  select * into v_live from public.site_live_occupancy(p_site_id);
  select ss.daily_capacity into v_daily_capacity from public.site_settings ss where ss.site_id = p_site_id;
  select coalesce(sum(b.visitor_count), 0)::integer into v_daily_used
  from public.bookings b join public.site_slots sl on sl.id = b.slot_id
  where b.site_id = p_site_id and sl.slot_date = p_visit_date
    and (b.booking_status in ('confirmed', 'completed')
      or (b.booking_status = 'awaiting_payment' and b.hold_expires_at > now()));

  select coalesce(sum(greatest(b.visitor_count - coalesce(entries.visitor_count, 0), 0)), 0)::integer
  into v_reserved
  from public.bookings b join public.site_slots sl on sl.id = b.slot_id
  left join lateral (
    select coalesce(sum(a.visitor_count), 0)::integer as visitor_count
    from public.attendance_logs a
    where a.booking_id = b.id and a.action = 'entry' and a.counts_toward_occupancy
  ) entries on true
  where b.site_id = p_site_id and sl.slot_date = p_visit_date and b.booking_source = 'online'
    and (b.booking_status = 'confirmed'
      or (b.booking_status = 'awaiting_payment' and b.hold_expires_at > now()));

  with available_slots as (
    select s.id, s.capacity,
      greatest(s.capacity - coalesce(sum(b.visitor_count) filter (
        where b.booking_status in ('confirmed', 'completed')
          or (b.booking_status = 'awaiting_payment' and b.hold_expires_at > now())
      ), 0)::integer, 0) as remaining
    from public.site_slots s
    join public.tourism_sites t on t.id = s.site_id and t.status = 'published'
    left join public.bookings b on b.slot_id = s.id
    where s.site_id = p_site_id and s.slot_date = p_visit_date and s.status = 'open'
      and private.site_operating_period_allows(s.site_id, s.slot_date, s.starts_at, s.ends_at)
      and not exists (
        select 1 from public.site_closures c
        where c.site_id = s.site_id and s.slot_date between c.starts_on and c.ends_on
          and (c.starts_at is null or (c.starts_at < s.ends_at and c.ends_at > s.starts_at))
      )
      and (p_visit_date > v_today or s.ends_at > (now() at time zone v_timezone)::time)
    group by s.id
  )
  select coalesce(sum(capacity), 0)::integer, coalesce(sum(remaining), 0)::integer,
    coalesce(max(remaining), 0)::integer
  into v_slot_capacity, v_slot_remaining, v_max_slot_remaining from available_slots;

  v_daily_remaining := case when v_daily_capacity is null then null
    else greatest(v_daily_capacity - v_daily_used, 0) end;
  v_slot_remaining := least(v_slot_remaining, coalesce(v_daily_remaining, v_slot_remaining));
  v_max_slot_remaining := least(v_max_slot_remaining, coalesce(v_daily_remaining, v_max_slot_remaining));

  select l.visitor_limit into v_approved_limit from public.site_approved_visitor_limits l
  where l.site_id = p_site_id and l.status = 'active'
    and l.effective_from <= p_visit_date and (l.effective_to is null or l.effective_to >= p_visit_date)
  order by l.effective_from desc, l.approved_at desc limit 1;
  select r.near_threshold_percent, r.almost_threshold_percent, r.critical_threshold_percent,
    r.restrict_at_warning, r.estimated_live_capacity, r.estimate_basis
  into v_rules from public.site_capacity_rules r where r.site_id = p_site_id;
  select c.updated_at into v_updated_at from public.site_capacity_changes c where c.site_id = p_site_id;

  return pg_catalog.jsonb_build_object(
    'site_id', p_site_id,
    'visit_date', p_visit_date,
    'current_visitor_count', coalesce(v_live.current_visitor_count, 0),
    'projected_visitor_count', coalesce(v_reserved, 0) + case when p_visit_date = v_today then coalesce(v_live.current_visitor_count, 0) else 0 end,
    'reserved_visitor_count', coalesce(v_reserved, 0),
    'remaining_bookable_capacity', greatest(v_slot_remaining, 0),
    'max_slot_remaining', greatest(v_max_slot_remaining, 0),
    'slot_capacity', v_slot_capacity,
    'arrivals_today', coalesce(v_live.arrivals_today, 0),
    'departures_today', coalesce(v_live.departures_today, 0),
    'last_recorded_at', v_live.last_recorded_at,
    'approved_visitor_limit', v_approved_limit,
    'capacity_estimate', v_live.capacity_estimate,
    'estimated_live_capacity', v_rules.estimated_live_capacity,
    'estimate_basis', v_rules.estimate_basis,
    'near_threshold_percent', coalesce(v_rules.near_threshold_percent, 70),
    'almost_threshold_percent', coalesce(v_rules.almost_threshold_percent, 85),
    'critical_threshold_percent', coalesce(v_rules.critical_threshold_percent, 95),
    'restrict_at_warning', coalesce(v_rules.restrict_at_warning, false),
    'updated_at', v_updated_at
  );
end
$$;

revoke all on function private.site_capacity_for_date(uuid, date) from public, anon, authenticated, service_role;
grant execute on function private.site_capacity_for_date(uuid, date) to anon, authenticated;

create function public.site_capacity_for_date(p_site_id uuid, p_visit_date date)
returns jsonb language sql stable security definer set search_path = ''
as $$ select private.site_capacity_for_date(p_site_id, p_visit_date) $$;
revoke all on function public.site_capacity_for_date(uuid, date) from public;
grant execute on function public.site_capacity_for_date(uuid, date) to anon, authenticated;

create trigger site_settings_capacity_change after insert or update or delete on public.site_settings
for each row execute function private.touch_capacity_change();
create trigger site_capacity_rules_capacity_change after insert or update or delete on public.site_capacity_rules
for each row execute function private.touch_capacity_change();
create trigger operating_hours_capacity_change after insert or update or delete on public.site_operating_hours
for each row execute function private.touch_capacity_change();
create trigger operating_exceptions_capacity_change after insert or update or delete on public.site_operating_exceptions
for each row execute function private.touch_capacity_change();
create trigger site_closures_capacity_change after insert or update or delete on public.site_closures
for each row execute function private.touch_capacity_change();

notify pgrst, 'reload schema';
