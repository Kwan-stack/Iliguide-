drop trigger if exists site_capacity_rules_capacity_change on public.site_capacity_rules;
revoke all on function private.site_capacity_for_date(uuid, date) from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
