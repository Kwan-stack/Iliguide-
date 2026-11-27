alter table public.site_approved_visitor_limits
  add column if not exists approaching_threshold_percent smallint
  check (approaching_threshold_percent is null or approaching_threshold_percent between 1 and 99);

create policy approved_limits_active_gatekeeper_read
on public.site_approved_visitor_limits for select to authenticated
using (
  private.user_has_site_role(site_id, 'gatekeeper')
  and exists (
    select 1
    from public.site_gatekeeper_duties d
    join public.tourism_sites s on s.id = d.site_id
    where d.site_id = site_approved_visitor_limits.site_id
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
