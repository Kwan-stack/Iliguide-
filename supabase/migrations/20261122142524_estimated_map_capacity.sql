alter table public.site_capacity_rules
  add column estimated_live_capacity integer check (estimated_live_capacity is null or estimated_live_capacity > 0),
  add column estimate_basis text;

create or replace function public.site_capacity_snapshot(p_site_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
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
$$;

insert into public.site_capacity_rules(site_id, estimated_live_capacity, estimate_basis)
select s.id,
  case s.slug
    when 'tinago-falls' then 576
    when 'timoga-cold-springs' then 150
    when 'mimbalot-falls' then 80
    when 'sikyop-agri-tourism-adventure' then 80
  end,
  case s.slug
    when 'tinago-falls' then 'Provisional school-project map proxy from the published 576-per-side daily recommendation; not a simultaneous-occupancy limit.'
    when 'timoga-cold-springs' then 'Provisional school-project map proxy from existing daily booking capacity (150); not a simultaneous-occupancy limit.'
    when 'mimbalot-falls' then 'Provisional school-project map proxy from existing daily booking capacity (80); not a simultaneous-occupancy limit.'
    when 'sikyop-agri-tourism-adventure' then 'Provisional school-project map proxy from existing daily booking capacity (80); not a simultaneous-occupancy limit.'
  end
from public.tourism_sites s
where s.slug in ('tinago-falls', 'timoga-cold-springs', 'mimbalot-falls', 'sikyop-agri-tourism-adventure')
on conflict (site_id) do update set
  estimated_live_capacity = excluded.estimated_live_capacity,
  estimate_basis = excluded.estimate_basis,
  updated_at = now();
