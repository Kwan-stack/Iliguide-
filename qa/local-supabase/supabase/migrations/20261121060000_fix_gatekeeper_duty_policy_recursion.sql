create or replace function private.can_read_gatekeeper_duty(
  p_duty_id uuid,
  p_support_gatekeeper_id uuid default null
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.site_gatekeeper_duties d
    where d.id = p_duty_id
      and (
        private.can_manage_site(d.site_id)
        or d.primary_gatekeeper_id = (select auth.uid())
        or (p_support_gatekeeper_id is null and exists (
          select 1
          from public.site_gatekeeper_duty_support s
          where s.duty_id = d.id and s.gatekeeper_id = (select auth.uid())
        ))
        or p_support_gatekeeper_id = (select auth.uid())
      )
  )
$$;
revoke all on function private.can_read_gatekeeper_duty(uuid, uuid) from public, anon;
grant execute on function private.can_read_gatekeeper_duty(uuid, uuid) to authenticated;

drop policy gatekeeper_duties_read_manager_or_member on public.site_gatekeeper_duties;
create policy gatekeeper_duties_read_manager_or_member on public.site_gatekeeper_duties for select to authenticated
using (private.can_read_gatekeeper_duty(id));

drop policy gatekeeper_duty_support_read_manager_or_member on public.site_gatekeeper_duty_support;
create policy gatekeeper_duty_support_read_manager_or_member on public.site_gatekeeper_duty_support for select to authenticated
using (private.can_read_gatekeeper_duty(duty_id, gatekeeper_id));
