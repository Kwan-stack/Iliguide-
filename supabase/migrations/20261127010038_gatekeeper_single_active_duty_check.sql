create or replace function private.has_active_gatekeeper_duty(p_site_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select count(*) = 1 and coalesce(bool_and(d.site_id = p_site_id), false)
  from public.site_gatekeeper_duties d
  join public.tourism_sites s on s.id = d.site_id
  join public.profiles p on p.id = (select auth.uid())
  join public.staff_assignments a on a.profile_id = p.id and a.site_id = d.site_id
    and a.staff_role = 'gatekeeper' and a.is_active
  where d.status in ('scheduled', 'active')
    and d.shift_start_at <= statement_timestamp() and d.shift_end_at > statement_timestamp()
    and d.duty_date = (statement_timestamp() at time zone coalesce(s.timezone, 'Asia/Manila'))::date
    and p.role = 'gatekeeper' and p.account_status = 'active'
    and (d.primary_gatekeeper_id = p.id or exists (
      select 1 from public.site_gatekeeper_duty_support ds
      where ds.duty_id = d.id and ds.gatekeeper_id = p.id
    ))
$$;
