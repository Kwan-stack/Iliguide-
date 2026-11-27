begin;
select plan(26);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at)
values
  ('11000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'updates-admin-a@example.invalid', '', now()),
  ('11000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'updates-office@example.invalid', '', now()),
  ('11000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'updates-gatekeeper@example.invalid', '', now()),
  ('11000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'updates-admin-b@example.invalid', '', now()),
  ('11000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'updates-visitor@example.invalid', '', now());

update public.profiles set role = 'site_admin' where id in ('11000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000004');
update public.profiles set role = 'tourism_office' where id = '11000000-0000-4000-8000-000000000002';
update public.profiles set role = 'gatekeeper' where id = '11000000-0000-4000-8000-000000000003';
update public.profiles set role = 'visitor' where id = '11000000-0000-4000-8000-000000000005';

insert into public.management_organizations (id, name, authority, created_by)
values
  ('21000000-0000-4000-8000-000000000001', 'Updates Site A', 'private_site', '11000000-0000-4000-8000-000000000002'),
  ('21000000-0000-4000-8000-000000000002', 'Updates Site B', 'private_site', '11000000-0000-4000-8000-000000000002');

insert into public.tourism_sites (id, name, slug, management_organization_id, status)
values
  ('31000000-0000-4000-8000-000000000001', 'Updates Destination A', 'updates-destination-a', '21000000-0000-4000-8000-000000000001', 'published'),
  ('31000000-0000-4000-8000-000000000002', 'Updates Destination B', 'updates-destination-b', '21000000-0000-4000-8000-000000000002', 'published'),
  ('31000000-0000-4000-8000-000000000003', 'Updates Office Destination', 'updates-office-destination', '00000000-0000-4000-8000-000000000001', 'published'),
  ('31000000-0000-4000-8000-000000000004', 'Unpublished Destination', 'unpublished-updates-destination', '21000000-0000-4000-8000-000000000001', 'draft');

insert into public.staff_assignments (profile_id, site_id, staff_role)
values
  ('11000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', 'site_admin'),
  ('11000000-0000-4000-8000-000000000003', '31000000-0000-4000-8000-000000000001', 'gatekeeper'),
  ('11000000-0000-4000-8000-000000000004', '31000000-0000-4000-8000-000000000002', 'site_admin');

insert into public.site_announcements (site_id, title, body, category, status, published_at, expires_at)
values
  ('31000000-0000-4000-8000-000000000001', 'A draft', 'Private draft', 'general', 'draft', now() - interval '1 day', null),
  ('31000000-0000-4000-8000-000000000001', 'A published', 'Public update', 'safety', 'published', now() - interval '1 day', null),
  ('31000000-0000-4000-8000-000000000001', 'A expired', 'Expired update', 'general', 'published', now() - interval '3 days', now() - interval '1 day'),
  ('31000000-0000-4000-8000-000000000001', 'A future', 'Not published yet', 'general', 'published', now() + interval '1 day', null),
  ('31000000-0000-4000-8000-000000000002', 'B draft', 'Private draft', 'general', 'draft', now() - interval '1 day', null),
  ('31000000-0000-4000-8000-000000000002', 'B published', 'Public update', 'general', 'published', now() - interval '1 day', null),
  ('31000000-0000-4000-8000-000000000003', 'Office published', 'Public update', 'general', 'published', now() - interval '1 day', null),
  ('31000000-0000-4000-8000-000000000004', 'Unpublished site update', 'Not public', 'general', 'published', now() - interval '1 day', null);

set local role anon;
select is((select count(*)::integer from public.site_announcements where site_id = '31000000-0000-4000-8000-000000000001'), 1, 'Anonymous visitors see only active published updates');
select is((select count(*)::integer from public.site_announcements where title = 'A expired'), 0, 'Anonymous visitors cannot read expired updates');
select is((select count(*)::integer from public.site_announcements where title = 'A future'), 0, 'Anonymous visitors cannot read future updates');
select is((select count(*)::integer from public.site_announcements where title = 'A draft'), 0, 'Anonymous visitors cannot read drafts');
select is((select count(*)::integer from public.site_announcements where site_id = '31000000-0000-4000-8000-000000000002'), 1, 'Published updates remain public for private destinations');
select is((select count(*)::integer from public.site_announcements where site_id = '31000000-0000-4000-8000-000000000004'), 0, 'Anonymous visitors cannot read updates for unpublished destinations');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000001', true);
select ok(private.can_manage_site('31000000-0000-4000-8000-000000000001'), 'Site Admin can manage assigned destination updates');
select is((select count(*)::integer from public.site_announcements where site_id = '31000000-0000-4000-8000-000000000001'), 4, 'Site Admin can manage assigned drafts and published updates');
select ok(not private.can_manage_site('31000000-0000-4000-8000-000000000002'), 'Site Admin cannot manage another destination');
select is((select count(*)::integer from public.site_announcements where title = 'B draft'), 0, 'Site Admin cannot read another destination drafts');
select throws_ok($$insert into public.site_announcements (site_id, title, body) values ('31000000-0000-4000-8000-000000000002', 'Unauthorized', 'Denied')$$, '42501', null, 'Site Admin cannot publish to an unassigned destination');
select lives_ok($$insert into public.site_announcements (site_id, title, body, status) values ('31000000-0000-4000-8000-000000000001', 'Authorized draft', 'Managed by Site Admin', 'draft')$$, 'Site Admin can save a draft for an assigned destination');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000002', true);
select ok(not private.can_manage_site('31000000-0000-4000-8000-000000000001'), 'Tourism Office cannot manage private destination updates');
select ok(private.can_manage_site('31000000-0000-4000-8000-000000000003'), 'Tourism Office can manage its destination updates');
select throws_ok($$insert into public.site_announcements (site_id, title, body) values ('31000000-0000-4000-8000-000000000001', 'Unauthorized', 'Denied')$$, '42501', null, 'Tourism Office cannot publish to a private destination');
select lives_ok($$insert into public.site_announcements (site_id, title, body, status) values ('31000000-0000-4000-8000-000000000003', 'Office draft', 'Managed by Tourism Office', 'draft')$$, 'Tourism Office can save a draft for its destination');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000003', true);
select ok(not private.can_manage_site('31000000-0000-4000-8000-000000000001'), 'Gatekeeper cannot manage destination updates');
select is((select count(*)::integer from public.site_announcements where site_id = '31000000-0000-4000-8000-000000000001'), 1, 'Gatekeeper can see public updates only');
select throws_ok($$insert into public.site_announcements (site_id, title, body) values ('31000000-0000-4000-8000-000000000001', 'Unauthorized', 'Denied')$$, '42501', null, 'Gatekeeper cannot publish destination updates');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000004', true);
select ok(private.can_manage_site('31000000-0000-4000-8000-000000000002'), 'Second Site Admin can manage their assigned destination');
select is((select count(*)::integer from public.site_announcements where title = 'A draft'), 0, 'Second Site Admin cannot read another destination drafts');
select ok(not private.can_manage_site('31000000-0000-4000-8000-000000000001'), 'Second Site Admin cannot manage the first destination');
select throws_ok($$insert into public.site_announcements (site_id, title, body) values ('31000000-0000-4000-8000-000000000001', 'Unauthorized', 'Denied')$$, '42501', null, 'Second Site Admin cannot publish to another destination');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000005', true);
select ok(not private.can_manage_site('31000000-0000-4000-8000-000000000001'), 'Visitor cannot manage destination updates');
select is((select count(*)::integer from public.site_announcements where site_id = '31000000-0000-4000-8000-000000000001'), 1, 'Visitor can read only public destination updates');
select throws_ok($$insert into public.site_announcements (site_id, title, body) values ('31000000-0000-4000-8000-000000000001', 'Unauthorized', 'Denied')$$, '42501', null, 'Visitor cannot publish destination updates');

select * from finish();
rollback;
