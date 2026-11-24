alter table public.site_demo_payment_settings
  alter column gcash_account_name set default 'Destination Demo Account',
  alter column maya_account_name set default 'Destination Demo Account';

update public.site_demo_payment_settings p
set gcash_account_name = case when p.gcash_account_name = 'Illiguide Demo Tourism Office'
      then 'Timoga Cold Springs Demo Account' else p.gcash_account_name end,
    maya_account_name = case when p.maya_account_name = 'Illiguide Demo Tourism Office'
      then 'Timoga Cold Springs Demo Account' else p.maya_account_name end
from public.tourism_sites s
where s.id = p.site_id and s.slug = 'timoga-cold-springs'
  and (p.gcash_account_name = 'Illiguide Demo Tourism Office'
    or p.maya_account_name = 'Illiguide Demo Tourism Office');

create or replace function private.initialize_site_demo_payment_settings()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.site_demo_payment_settings (
    site_id, gcash_account_name, gcash_account_identifier, maya_account_name, maya_account_identifier
  ) values (
    new.id,
    new.name || ' Demo Account',
    'DEMO-GCASH-' || upper(substr(replace(new.id::text, '-', ''), 1, 8)),
    new.name || ' Demo Account',
    'DEMO-MAYA-' || upper(substr(replace(new.id::text, '-', ''), 1, 8))
  ) on conflict (site_id) do nothing;
  return new;
end
$$;
