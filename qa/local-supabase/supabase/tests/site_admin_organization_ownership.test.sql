begin;
select plan(17);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at)
values
  ('10000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'site-admin-test@example.invalid', '', now()),
  ('10000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'office-test@example.invalid', '', now()),
  ('10000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'gatekeeper-test@example.invalid', '', now()),
  ('10000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'other-site-admin-test@example.invalid', '', now()),
  ('10000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'visitor-test@example.invalid', '', now());

update public.profiles set role = 'site_admin' where id = '10000000-0000-4000-8000-000000000001';
update public.profiles set role = 'tourism_office' where id = '10000000-0000-4000-8000-000000000002';
update public.profiles set role = 'gatekeeper' where id = '10000000-0000-4000-8000-000000000003';
update public.profiles set role = 'site_admin' where id = '10000000-0000-4000-8000-000000000004';
update public.profiles set role = 'visitor' where id = '10000000-0000-4000-8000-000000000005';

insert into public.management_organizations (id, name, authority, created_by)
values
  ('20000000-0000-4000-8000-000000000001', 'Private Site A', 'private_site', '10000000-0000-4000-8000-000000000002'),
  ('20000000-0000-4000-8000-000000000002', 'Private Site B', 'private_site', '10000000-0000-4000-8000-000000000002');

insert into public.tourism_sites (id, name, slug, management_organization_id)
values
  ('30000000-0000-4000-8000-000000000001', 'Private Destination A', 'private-destination-a', '20000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000002', 'Private Destination B', 'private-destination-b', '20000000-0000-4000-8000-000000000002');
insert into public.tourism_sites (id, name, slug, management_organization_id, status)
values ('30000000-0000-4000-8000-000000000003', 'Tourism Office Destination', 'tourism-office-destination', '00000000-0000-4000-8000-000000000001', 'published');
update public.tourism_sites set status = 'published' where id in (
  '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002'
);

insert into public.staff_assignments (profile_id, site_id, staff_role)
values
  ('10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'site_admin'),
  ('10000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000001', 'gatekeeper');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select ok(private.can_manage_site('30000000-0000-4000-8000-000000000001'), 'Site Admin can manage assigned destination');
select ok(not private.can_manage_site('30000000-0000-4000-8000-000000000002'), 'Site Admin cannot manage unassigned destination');
select is((select count(*)::integer from public.tourism_sites where id = '30000000-0000-4000-8000-000000000001'), 1, 'Site Admin can read assigned destination');
select is((select count(*)::integer from public.tourism_sites where id = '30000000-0000-4000-8000-000000000002'), 0, 'Site Admin cannot read unassigned destination');
select throws_ok(
  $$update public.tourism_sites set management_organization_id = '20000000-0000-4000-8000-000000000002' where id = '30000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'Site Admin cannot change destination ownership directly'
);
select throws_ok(
  $$select public.assign_site_management_organization('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', null)$$,
  '42501', 'Tourism Office access is required to change destination management.', 'Site Admin cannot use ownership RPC'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select ok(not private.can_manage_site('30000000-0000-4000-8000-000000000002'), 'Tourism Office cannot manage a private destination');
select ok(private.can_manage_site('30000000-0000-4000-8000-000000000003'), 'Tourism Office still manages its own destination');
select is((select count(*)::integer from public.tourism_sites where id = '30000000-0000-4000-8000-000000000001'), 0, 'Tourism Office cannot read a private destination');
select is((select count(*)::integer from public.tourism_sites where id = '30000000-0000-4000-8000-000000000003'), 1, 'Tourism Office can read its destination');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select ok(not private.can_manage_site('30000000-0000-4000-8000-000000000001'), 'Gatekeeper cannot manage destinations');
select ok(private.can_work_site('30000000-0000-4000-8000-000000000001'), 'Gatekeeper can work at assigned destination');
select ok(private.can_read_site_data('30000000-0000-4000-8000-000000000001'), 'Gatekeeper can read assigned destination');
select is((select count(*)::integer from public.tourism_sites where id = '30000000-0000-4000-8000-000000000002'), 0, 'Gatekeeper cannot read an unassigned destination');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
select ok(not private.can_manage_site('30000000-0000-4000-8000-000000000001'), 'Other Site Admin cannot manage Timoga');
select is((select count(*)::integer from public.tourism_sites where id = '30000000-0000-4000-8000-000000000001'), 0, 'Other Site Admin cannot read Timoga');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);
select ok(private.can_read_site_data('30000000-0000-4000-8000-000000000001'), 'Visitor can still read published Timoga');

select * from finish();
rollback;
