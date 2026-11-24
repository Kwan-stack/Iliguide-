-- Include confirmed online bookings in the live expectation count.
create or replace function public.site_capacity_snapshot(p_site_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
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
  left join public.tourism_sites s on s.id = o.site_id
  left join lateral (
    select l.approaching_threshold_percent from public.site_approved_visitor_limits l
    where l.site_id = o.site_id and l.status = 'active'
      and l.effective_from <= (now() at time zone s.timezone)::date
      and (l.effective_to is null or l.effective_to >= (now() at time zone s.timezone)::date)
    order by l.effective_from desc, l.approved_at desc limit 1
  ) lim on true
  left join lateral (
    select coalesce(sum(b.visitor_count), 0)::bigint as visitor_count
    from public.bookings b join public.site_slots sl on sl.id = b.slot_id
    where b.site_id = o.site_id and b.booking_source = 'online'
      and b.booking_status in ('confirmed', 'completed')
      and b.payment_status in ('paid', 'not_required')
      and sl.slot_date = (now() at time zone s.timezone)::date
  ) expected on true
  where private.can_read_site_data(o.site_id)
$$;

-- Realtime subscribers refresh snapshots immediately after payment approval.
create function private.notify_booking_capacity_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_site_id uuid;
begin
  if tg_op = 'UPDATE' and old.site_id is distinct from new.site_id then
    insert into public.site_capacity_changes(site_id) values (old.site_id)
    on conflict (site_id) do update
      set revision = public.site_capacity_changes.revision + 1, updated_at = now();
  end if;
  if tg_op = 'DELETE' then v_site_id := old.site_id; else v_site_id := new.site_id; end if;
  insert into public.site_capacity_changes(site_id) values (v_site_id)
  on conflict (site_id) do update
    set revision = public.site_capacity_changes.revision + 1, updated_at = now();
  return null;
end
$$;
revoke all on function private.notify_booking_capacity_change() from public, anon, authenticated, service_role;
drop trigger if exists booking_capacity_revision on public.bookings;
create trigger booking_capacity_revision after insert or update or delete on public.bookings
  for each row execute function private.notify_booking_capacity_change();

notify pgrst, 'reload schema';
