begin;
select plan(27);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at)
values
  ('91000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'feedback-site-admin@example.invalid', '', now()),
  ('91000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'feedback-office@example.invalid', '', now()),
  ('91000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'feedback-gatekeeper@example.invalid', '', now()),
  ('91000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'feedback-visitor@example.invalid', '', now()),
  ('91000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'feedback-other-visitor@example.invalid', '', now());

update public.profiles set role = 'site_admin', account_status = 'active' where id = '91000000-0000-4000-8000-000000000001';
update public.profiles set role = 'tourism_office', account_status = 'active' where id = '91000000-0000-4000-8000-000000000002';
update public.profiles set role = 'gatekeeper', account_status = 'active' where id = '91000000-0000-4000-8000-000000000003';
update public.profiles set role = 'visitor', account_status = 'active' where id = '91000000-0000-4000-8000-000000000004';
update public.profiles set role = 'visitor', account_status = 'active' where id = '91000000-0000-4000-8000-000000000005';

insert into public.management_organizations (id, name, authority, created_by)
values ('92000000-0000-4000-8000-000000000001', 'Feedback private site', 'private_site', '91000000-0000-4000-8000-000000000002');
insert into public.management_organization_members (organization_id, profile_id, is_active)
values ('92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', true);
insert into public.tourism_sites (id, name, slug, management_organization_id, status)
values
  ('93000000-0000-4000-8000-000000000001', 'Private Test Destination', 'private-feedback-test', '92000000-0000-4000-8000-000000000001', 'published'),
  ('93000000-0000-4000-8000-000000000002', 'Office Test Destination', 'office-feedback-test', '00000000-0000-4000-8000-000000000001', 'published');
insert into public.staff_assignments (profile_id, site_id, staff_role, is_active)
values ('91000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', 'site_admin', true);
insert into public.site_slots (id, site_id, slot_date, starts_at, ends_at, capacity)
values
  ('94000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', current_date, '08:00', '09:00', 10),
  ('94000000-0000-4000-8000-000000000002', '93000000-0000-4000-8000-000000000001', current_date, '09:00', '10:00', 10),
  ('94000000-0000-4000-8000-000000000003', '93000000-0000-4000-8000-000000000001', current_date, '10:00', '11:00', 10),
  ('94000000-0000-4000-8000-000000000004', '93000000-0000-4000-8000-000000000002', current_date, '08:00', '09:00', 10),
  ('94000000-0000-4000-8000-000000000005', '93000000-0000-4000-8000-000000000002', current_date, '09:00', '10:00', 10);
insert into public.bookings (id, booking_reference, visitor_id, site_id, slot_id, visitor_name, visitor_email, adult_count, total_amount, payment_status, booking_status)
values
  ('95000000-0000-4000-8000-000000000001', 'FB-COMPLETED-TEST', '91000000-0000-4000-8000-000000000004', '93000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', 'Feedback Visitor', 'feedback-visitor@example.invalid', 1, 0, 'paid', 'completed'),
  ('95000000-0000-4000-8000-000000000002', 'FB-CONFIRMED-TEST', '91000000-0000-4000-8000-000000000004', '93000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000002', 'Feedback Visitor', 'feedback-visitor@example.invalid', 1, 0, 'paid', 'confirmed'),
  ('95000000-0000-4000-8000-000000000003', 'FB-NEW-REVIEW-TEST', '91000000-0000-4000-8000-000000000004', '93000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000003', 'Feedback Visitor', 'feedback-visitor@example.invalid', 1, 0, 'paid', 'completed'),
  ('95000000-0000-4000-8000-000000000004', 'FB-OFFICE-PUBLISHED-TEST', '91000000-0000-4000-8000-000000000004', '93000000-0000-4000-8000-000000000002', '94000000-0000-4000-8000-000000000004', 'Feedback Visitor', 'feedback-visitor@example.invalid', 1, 0, 'paid', 'completed'),
  ('95000000-0000-4000-8000-000000000005', 'FB-OFFICE-PENDING-TEST', '91000000-0000-4000-8000-000000000005', '93000000-0000-4000-8000-000000000002', '94000000-0000-4000-8000-000000000005', 'Other Feedback Visitor', 'feedback-other-visitor@example.invalid', 1, 0, 'paid', 'confirmed'),
  ('95000000-0000-4000-8000-000000000006', 'FB-PRIVATE-PENDING-TEST', '91000000-0000-4000-8000-000000000005', '93000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000002', 'Other Feedback Visitor', 'feedback-other-visitor@example.invalid', 1, 0, 'paid', 'confirmed');
insert into public.reviews (id, booking_id, visitor_id, site_id, rating, category, comment, review_status)
values
  ('96000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000004', '93000000-0000-4000-8000-000000000001', 5, 'overall_experience', 'Private published review', 'published'),
  ('96000000-0000-4000-8000-000000000002', '95000000-0000-4000-8000-000000000006', '91000000-0000-4000-8000-000000000005', '93000000-0000-4000-8000-000000000001', 3, 'cleanliness', 'Private pending review', 'pending'),
  ('96000000-0000-4000-8000-000000000003', '95000000-0000-4000-8000-000000000004', '91000000-0000-4000-8000-000000000004', '93000000-0000-4000-8000-000000000002', 4, 'overall_experience', 'Office published review', 'published'),
  ('96000000-0000-4000-8000-000000000004', '95000000-0000-4000-8000-000000000005', '91000000-0000-4000-8000-000000000005', '93000000-0000-4000-8000-000000000002', 2, 'safety', 'Office pending review', 'pending');

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from public.reviews where site_id = '93000000-0000-4000-8000-000000000001'), 0, 'Tourism Office cannot read private-site reviews');
select is((select count(*)::integer from public.reviews where site_id = '93000000-0000-4000-8000-000000000002'), 2, 'Tourism Office sees all statuses for its destinations');
select ok(not private.can_manage_site('93000000-0000-4000-8000-000000000001'), 'Tourism Office cannot manage private destination');
select throws_ok($$select public.moderate_review('96000000-0000-4000-8000-000000000001', 'hidden', '')$$, 'P0001', 'Destination access required', 'Tourism Office cannot moderate private-site feedback');
select throws_ok($$update public.reviews set review_status = 'hidden' where id = '96000000-0000-4000-8000-000000000001'$$, '42501', null, 'Direct review updates are revoked');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000004', true);
select is((select count(*)::integer from public.reviews where review_status = 'published'), 2, 'Visitors see published reviews across public destinations');
select is((select count(*)::integer from public.reviews where site_id = '93000000-0000-4000-8000-000000000001' and review_status = 'pending'), 0, 'Visitors cannot read another visitor pending review');
select lives_ok($$select public.submit_review_report('96000000-0000-4000-8000-000000000001', 'inappropriate', 'Test report')$$, 'Visitors can report a published review');
select is((select count(*)::integer from public.review_reports where review_id = '96000000-0000-4000-8000-000000000001'), 1, 'Visitor can read own review report');
select lives_ok($$select public.submit_visitor_review('95000000-0000-4000-8000-000000000003', 4, 'cleanliness', 'Completed visit feedback')$$, 'Completed visitor can submit verified feedback');
select is((select count(*)::integer from public.reviews where booking_id = '95000000-0000-4000-8000-000000000003' and review_status = 'pending'), 1, 'New review awaits moderation');
select lives_ok($$select public.update_visitor_review((select id from public.reviews where booking_id = '95000000-0000-4000-8000-000000000003' and review_status = 'pending'), 4, 'facilities', 'Updated completed visit feedback')$$, 'Visitor can edit own review');
select is((select count(*)::integer from public.reviews where booking_id = '95000000-0000-4000-8000-000000000003' and category = 'facilities' and rating = 4), 1, 'Review edit preserves ownership and updates content');
select throws_ok($$select public.submit_visitor_review('95000000-0000-4000-8000-000000000002', 5, 'overall_experience', '')$$, 'P0001', 'A completed visit is required to review', 'Confirmed booking cannot submit a review');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.reviews where site_id = '93000000-0000-4000-8000-000000000001'), 3, 'Site Admin sees all reviews for assigned destination');
select is((select count(*)::integer from public.reviews where site_id = '93000000-0000-4000-8000-000000000002'), 0, 'Site Admin cannot read Tourism Office reviews');
select ok(private.can_manage_site('93000000-0000-4000-8000-000000000001'), 'Site Admin can manage assigned private destination');
select ok(not private.can_manage_site('93000000-0000-4000-8000-000000000002'), 'Site Admin cannot manage Tourism Office destination');
select lives_ok($$select public.moderate_review('96000000-0000-4000-8000-000000000001', 'hidden', 'Policy test')$$, 'Site Admin can moderate assigned feedback');
select is((select count(*)::integer from public.review_moderation_history where review_id = '96000000-0000-4000-8000-000000000001'), 1, 'Moderation action is recorded in history');
select is((select count(*)::integer from public.review_reports where review_id = '96000000-0000-4000-8000-000000000001'), 1, 'Site Admin can view reports for assigned destination');
select throws_ok($$select public.moderate_review('96000000-0000-4000-8000-000000000003', 'hidden', '')$$, 'P0001', 'Destination access required', 'Site Admin cannot moderate Tourism Office feedback');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000003', true);
select is((select count(*)::integer from public.reviews), 0, 'Gatekeepers cannot read visitor feedback');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from public.review_reports where review_id = '96000000-0000-4000-8000-000000000001'), 0, 'Tourism Office cannot read private-site reports');

reset role;
set local role anon;
select is((select count(*)::integer from public.reviews where review_status = 'published'), 1, 'Anonymous visitors see public published reviews');
select is((select count(*)::integer from public.reviews where review_status <> 'published'), 0, 'Anonymous visitors cannot see moderated reviews');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000004', true);
select throws_ok($$select public.submit_review_report('96000000-0000-4000-8000-000000000001', 'spam', '')$$, 'P0001', 'Published review not found', 'Visitor cannot report a hidden review');

select * from finish();
rollback;
