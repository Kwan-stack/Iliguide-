begin;
select plan(64);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at)
values
  ('81000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'qr-office@example.invalid', '', now()),
  ('81000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'qr-gatekeeper@example.invalid', '', now()),
  ('81000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'qr-visitor@example.invalid', '', now());
update public.profiles set role = 'tourism_office' where id = '81000000-0000-4000-8000-000000000001';
update public.profiles set role = 'gatekeeper' where id = '81000000-0000-4000-8000-000000000002';
update public.profiles set role = 'visitor' where id = '81000000-0000-4000-8000-000000000003';

insert into public.tourism_sites (id, name, slug, management_organization_id)
values ('82000000-0000-4000-8000-000000000001', 'Attendance Test Destination', 'attendance-test-destination', '00000000-0000-4000-8000-000000000001');
insert into public.site_images (site_id, storage_path, image_role, alt_text)
values ('82000000-0000-4000-8000-000000000001', 'attendance-test/cover.jpg', 'cover', 'Test destination');
update public.tourism_sites set status = 'published' where id = '82000000-0000-4000-8000-000000000001';
insert into public.site_settings (site_id, adult_fee, child_fee, daily_capacity, max_per_booking)
values ('82000000-0000-4000-8000-000000000001', 50, 50, 20, 20);
insert into public.site_operating_hours (site_id, weekday, opens_at, closes_at)
values ('82000000-0000-4000-8000-000000000001', extract(dow from (now() at time zone 'Asia/Manila')::date)::smallint, '00:00', '23:59:59.999999');
insert into public.staff_assignments (profile_id, site_id, staff_role)
values ('81000000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000001', 'gatekeeper');
insert into public.site_slots (id, site_id, slot_date, starts_at, ends_at, capacity, status)
values
  ('83000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', (now() at time zone 'Asia/Manila')::date, '00:00', '23:59:59.999999', 20, 'open'),
  ('83000000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000001', (now() at time zone 'Asia/Manila')::date - 1, '00:00', '23:59:59.999999', 20, 'open');
insert into public.bookings (
  id, booking_reference, site_id, slot_id, visitor_name, visitor_email,
  adult_count, child_count, pwd_count, total_amount, payment_status, booking_status, qr_token_hash
) values (
  '84000000-0000-4000-8000-000000000001', 'ILG-ATTENDANCE-ONLINE',
  '82000000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000001',
  'Test Visitor', 'qr-visitor@example.invalid', 4, 0, 2, 200, 'paid', 'confirmed',
  extensions.digest(convert_to('attendance-ticket', 'UTF8'), 'sha256')
);
insert into public.reservation_visitors (id, booking_id, sequence_number, visitor_type, full_name, address)
values
  ('84100000-0000-4000-8000-000000000001', '84000000-0000-4000-8000-000000000001', 1, 'adult', 'Visitor One', 'Test address'),
  ('84100000-0000-4000-8000-000000000002', '84000000-0000-4000-8000-000000000001', 2, 'adult', 'Visitor Two', 'Test address'),
  ('84100000-0000-4000-8000-000000000003', '84000000-0000-4000-8000-000000000001', 3, 'adult', 'Visitor Three', 'Test address'),
  ('84100000-0000-4000-8000-000000000004', '84000000-0000-4000-8000-000000000001', 4, 'adult', 'Visitor Four', 'Test address');
insert into public.bookings (
  id, booking_reference, site_id, slot_id, visitor_name, visitor_email,
  adult_count, child_count, total_amount, payment_status, booking_status
) values (
  '84000000-0000-4000-8000-000000000002', 'ILG-ATTENDANCE-OVERNIGHT',
  '82000000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000002',
  'Overnight Test Visitor', 'qr-visitor@example.invalid', 1, 0, 50, 'paid', 'confirmed'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);
insert into public.site_approved_visitor_limits (site_id, visitor_limit, effective_from, policy_reference, approved_by)
values ('82000000-0000-4000-8000-000000000001', 8, (now() at time zone 'Asia/Manila')::date, 'Synthetic pgTAP capacity', '81000000-0000-4000-8000-000000000001');
select is((public.site_capacity_for_date('82000000-0000-4000-8000-000000000001', (now() at time zone 'Asia/Manila')::date)->>'reserved_visitor_count')::integer, 4,
  'Date capacity counts online visitors who have not checked in');
select is((public.site_capacity_for_date('82000000-0000-4000-8000-000000000001', (now() at time zone 'Asia/Manila')::date)->>'projected_visitor_count')::integer, 4,
  'Projected capacity excludes reservations from current occupancy');
select is((public.site_capacity_for_date('82000000-0000-4000-8000-000000000001', (now() at time zone 'Asia/Manila')::date)->>'remaining_bookable_capacity')::integer, 16,
  'Date capacity reports the shared remaining daily booking capacity');
select ok(not (public.site_capacity_for_date('82000000-0000-4000-8000-000000000001', (now() at time zone 'Asia/Manila')::date) ? 'visitor_name'),
  'Public date capacity contains no visitor contact records');
insert into public.site_gatekeeper_duties (site_id, duty_date, shift_start_at, shift_end_at, primary_gatekeeper_id, status)
values (
  '82000000-0000-4000-8000-000000000001', (now() at time zone 'Asia/Manila')::date,
  ((now() at time zone 'Asia/Manila')::date::timestamp at time zone 'Asia/Manila'),
  (((now() at time zone 'Asia/Manila')::date + 1)::timestamp at time zone 'Asia/Manila'),
  '81000000-0000-4000-8000-000000000002', 'active'
);
reset role;

select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000002', true);
create temporary table attendance_walkin on commit drop as
select * from public.register_walk_in_with_visitors(
  '82000000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000001',
  'Synthetic Walk-in', 7, 0, 0, 'walkin@example.invalid', null, '[]'::jsonb
);
create temporary table capacity_revision_before on commit drop as
select revision from public.site_capacity_changes where site_id = '82000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from public.attendance_participants('ILG-ATTENDANCE-ONLINE', '82000000-0000-4000-8000-000000000001')), 4, 'Assigned gatekeeper sees individual booking participants');
select is((select result from public.scan_ticket(
  '84000000-0000-4000-8000-000000000001', extensions.digest(convert_to('attendance-ticket', 'UTF8'), 'sha256'),
  '82000000-0000-4000-8000-000000000001', '{}'::jsonb)), 'entry_confirmation_required', 'A valid QR scan requests entry confirmation');
select is((select result from public.scan_ticket(
  '84000000-0000-4000-8000-000000000001', extensions.digest(convert_to('wrong-ticket', 'UTF8'), 'sha256'),
  '82000000-0000-4000-8000-000000000001', '{}'::jsonb)), 'invalid', 'A QR token with the wrong hash is rejected');
select is((select result from public.manual_scan_ticket('ILG-ATTENDANCE-OVERNIGHT', '82000000-0000-4000-8000-000000000001')),
  'outside_window', 'A past booking cannot create a new admission');
select throws_ok($$select * from public.manual_scan_ticket('ILG-ATTENDANCE-ONLINE', '82999999-0000-4000-8000-000000000001')$$,
  'P0001', 'Gatekeeper access denied', 'An unassigned destination scan is denied');
select throws_ok($$select * from public.confirm_ticket_attendance(
  '84000000-0000-4000-8000-000000000001', extensions.digest(convert_to('attendance-ticket', 'UTF8'), 'sha256'),
  '82000000-0000-4000-8000-000000000001', 'entry', 5, '85000000-0000-4000-8000-000000000001', '{}'::jsonb)$$,
  'P0001', 'Admission count exceeds visitors remaining on this booking', 'Entry count cannot exceed the booking group');
select throws_ok($$select * from public.confirm_ticket_attendance(
  '84000000-0000-4000-8000-000000000001', extensions.digest(convert_to('attendance-ticket', 'UTF8'), 'sha256'),
  '82000000-0000-4000-8000-000000000001', 'entry', 2, '85000000-0000-4000-8000-000000000010', '{}'::jsonb,
  array['84100000-0000-4000-8000-000000000001'::uuid, '84100000-0000-4000-8000-000000000001'::uuid])$$,
  'P0001', 'Visitor selection contains duplicates', 'A participant cannot be counted twice in one attendance event');
select throws_ok($$select * from public.confirm_ticket_attendance(
  '84000000-0000-4000-8000-000000000001', extensions.digest(convert_to('attendance-ticket', 'UTF8'), 'sha256'),
  '82000000-0000-4000-8000-000000000001', 'entry', 1, '85000000-0000-4000-8000-000000000011', '{}'::jsonb,
  array['84100000-0000-4000-8000-000000000099'::uuid])$$,
  'P0001', 'Selected visitors are no longer eligible for this action', 'Only visitors on this booking can enter');
select lives_ok($$select * from public.confirm_ticket_attendance(
  '84000000-0000-4000-8000-000000000001', extensions.digest(convert_to('attendance-ticket', 'UTF8'), 'sha256'),
  '82000000-0000-4000-8000-000000000001', 'entry', 2, '85000000-0000-4000-8000-000000000002', '{}'::jsonb,
  array['84100000-0000-4000-8000-000000000001'::uuid, '84100000-0000-4000-8000-000000000002'::uuid])$$,
  'Two actual arrivals are recorded for the four-person booking');
select is((select count(*)::integer from public.reservation_visitors where booking_id = '84000000-0000-4000-8000-000000000001' and check_in_status = 'checked_in'), 2, 'Only selected participants become checked in');
select throws_ok($$select * from public.confirm_ticket_attendance(
  '84000000-0000-4000-8000-000000000001', extensions.digest(convert_to('attendance-ticket', 'UTF8'), 'sha256'),
  '82000000-0000-4000-8000-000000000001', 'entry', 1, '85000000-0000-4000-8000-000000000012', '{}'::jsonb,
  array['84100000-0000-4000-8000-000000000001'::uuid])$$,
  'P0001', 'Selected visitors are no longer eligible for this action', 'A visitor already inside cannot be admitted twice');
select is((public.site_capacity_snapshot('82000000-0000-4000-8000-000000000001')->>'current_visitor_count')::bigint, 2::bigint, 'Current occupancy counts admitted visitors only');
select is((public.site_capacity_for_date('82000000-0000-4000-8000-000000000001', (now() at time zone 'Asia/Manila')::date)->>'reserved_visitor_count')::integer, 2,
  'Checked-in visitors leave the unarrived reservation count');
select is((public.site_capacity_for_date('82000000-0000-4000-8000-000000000001', (now() at time zone 'Asia/Manila')::date)->>'projected_visitor_count')::integer, 4,
  'Projection counts onsite and unarrived visitors once each');
select is((public.site_capacity_snapshot('82000000-0000-4000-8000-000000000001')->>'arrivals_today')::bigint, 2::bigint, 'Arrivals today counts the two admitted visitors');
select is((select result from public.confirm_ticket_attendance(
  '84000000-0000-4000-8000-000000000001', extensions.digest(convert_to('attendance-ticket', 'UTF8'), 'sha256'),
  '82000000-0000-4000-8000-000000000001', 'entry', 2, '85000000-0000-4000-8000-000000000002', '{}'::jsonb,
  array['84100000-0000-4000-8000-000000000001'::uuid, '84100000-0000-4000-8000-000000000002'::uuid])),
  'entry_recorded', 'A replayed idempotency key returns the original successful result');
select is((public.site_capacity_snapshot('82000000-0000-4000-8000-000000000001')->>'current_visitor_count')::bigint, 2::bigint, 'Idempotent entry replay does not duplicate occupancy');
select is((select result from public.scan_ticket(
  '84000000-0000-4000-8000-000000000001', extensions.digest(convert_to('attendance-ticket', 'UTF8'), 'sha256'),
  '82000000-0000-4000-8000-000000000001', '{}'::jsonb)), 'attendance_confirmation_required', 'Partial entry offers another arrival or a checkout');
select is((select count(*)::integer from public.attendance_logs where booking_id = (select booking_id from attendance_walkin)), 0, 'Walk-in registration alone creates no attendance event');
select is((public.site_capacity_snapshot('82000000-0000-4000-8000-000000000001')->>'expected_visitor_count')::bigint, 4::bigint, 'Expected visitors include the online group, not the registered walk-in');
select is((select result from public.manual_scan_ticket((select booking_reference from attendance_walkin), '82000000-0000-4000-8000-000000000001')),
  'entry_confirmation_required', 'A registered walk-in still requires explicit admission confirmation');
select throws_ok($$select * from public.confirm_manual_attendance(
  (select booking_reference from attendance_walkin), '82000000-0000-4000-8000-000000000001',
  'entry', 7, '85000000-0000-4000-8000-000000000003', '{}'::jsonb)$$,
  'P0001', 'Approved visitor limit reached; admission cannot be recorded', 'Configured capacity blocks an over-limit group');
select lives_ok($$select * from public.confirm_ticket_attendance(
  '84000000-0000-4000-8000-000000000001', extensions.digest(convert_to('attendance-ticket', 'UTF8'), 'sha256'),
  '82000000-0000-4000-8000-000000000001', 'entry', 2, '85000000-0000-4000-8000-000000000004', '{}'::jsonb,
  array['84100000-0000-4000-8000-000000000003'::uuid, '84100000-0000-4000-8000-000000000004'::uuid])$$,
  'Remaining visitors may enter while earlier group members are still inside');
select is((public.site_capacity_snapshot('82000000-0000-4000-8000-000000000001')->>'current_visitor_count')::bigint, 4::bigint, 'Second partial admission raises occupancy to four');
select lives_ok($$select * from public.confirm_ticket_attendance(
  '84000000-0000-4000-8000-000000000001', extensions.digest(convert_to('attendance-ticket', 'UTF8'), 'sha256'),
  '82000000-0000-4000-8000-000000000001', 'exit', 1, '85000000-0000-4000-8000-000000000005', '{}'::jsonb,
  array['84100000-0000-4000-8000-000000000001'::uuid])$$,
  'Partial group checkout records one departure');
select is((select check_in_status from public.reservation_visitors where id = '84100000-0000-4000-8000-000000000001'), 'checked_out', 'Checkout marks only the selected participant as departed');
select is((public.site_capacity_snapshot('82000000-0000-4000-8000-000000000001')->>'current_visitor_count')::bigint, 3::bigint, 'Partial checkout reduces occupancy by one');
select is((public.site_capacity_snapshot('82000000-0000-4000-8000-000000000001')->>'departures_today')::bigint, 1::bigint, 'Departures today counts the confirmed exit');
select is((select result from public.confirm_ticket_attendance(
  '84000000-0000-4000-8000-000000000001', extensions.digest(convert_to('attendance-ticket', 'UTF8'), 'sha256'),
  '82000000-0000-4000-8000-000000000001', 'exit', 1, '85000000-0000-4000-8000-000000000005', '{}'::jsonb,
  array['84100000-0000-4000-8000-000000000001'::uuid])),
  'exit_recorded', 'A repeated checkout idempotency key returns its original result');
select is((public.site_capacity_snapshot('82000000-0000-4000-8000-000000000001')->>'current_visitor_count')::bigint, 3::bigint, 'Repeated checkout does not change occupancy twice');
select throws_ok($$select * from public.confirm_ticket_attendance(
  '84000000-0000-4000-8000-000000000001', extensions.digest(convert_to('attendance-ticket', 'UTF8'), 'sha256'),
  '82000000-0000-4000-8000-000000000001', 'exit', 4, '85000000-0000-4000-8000-000000000006', '{}'::jsonb,
  array['84100000-0000-4000-8000-000000000001'::uuid, '84100000-0000-4000-8000-000000000002'::uuid,
    '84100000-0000-4000-8000-000000000003'::uuid, '84100000-0000-4000-8000-000000000004'::uuid])$$,
  'P0001', 'Departure count exceeds recorded visitors currently inside', 'Checkout cannot exceed active group attendance');
select lives_ok($$select * from public.confirm_ticket_attendance(
  '84000000-0000-4000-8000-000000000001', extensions.digest(convert_to('attendance-ticket', 'UTF8'), 'sha256'),
  '82000000-0000-4000-8000-000000000001', 'exit', 3, '85000000-0000-4000-8000-000000000007', '{}'::jsonb,
  array['84100000-0000-4000-8000-000000000002'::uuid, '84100000-0000-4000-8000-000000000003'::uuid,
    '84100000-0000-4000-8000-000000000004'::uuid])$$,
  'Final online group checkout completes the visit');
select is((select booking_status::text from public.bookings where id = '84000000-0000-4000-8000-000000000001'), 'completed', 'Booking completes after every admitted visitor checks out');
select is((select result from public.scan_ticket(
  '84000000-0000-4000-8000-000000000001', extensions.digest(convert_to('attendance-ticket', 'UTF8'), 'sha256'),
  '82000000-0000-4000-8000-000000000001', '{}'::jsonb)), 'completed', 'A completed ticket cannot start another visit');
select throws_ok($$select * from public.confirm_ticket_attendance(
  '84000000-0000-4000-8000-000000000001', extensions.digest(convert_to('attendance-ticket', 'UTF8'), 'sha256'),
  '82000000-0000-4000-8000-000000000001', 'entry', 1, '85000000-0000-4000-8000-000000000008', '{}'::jsonb)$$,
  'P0001', 'Visit already completed', 'Completed booking cannot be admitted again');
select is((public.site_capacity_snapshot('82000000-0000-4000-8000-000000000001')->>'current_visitor_count')::bigint, 0::bigint, 'Fully checked-out group leaves zero visitors inside');
select is((public.site_capacity_snapshot('82000000-0000-4000-8000-000000000001')->>'expected_visitor_count')::bigint, 4::bigint, 'PWD classification does not add another expected visitor');
select is((public.site_capacity_snapshot('82000000-0000-4000-8000-000000000001')->>'approved_visitor_limit')::integer, 8, 'Capacity snapshot uses the configured approved limit');
select ok((select revision > (select revision from capacity_revision_before) from public.site_capacity_changes where site_id = '82000000-0000-4000-8000-000000000001'), 'Attendance changes increment the Realtime revision');

select lives_ok($$select * from public.confirm_manual_attendance(
  (select booking_reference from attendance_walkin), '82000000-0000-4000-8000-000000000001',
  'entry', 7, '85000000-0000-4000-8000-000000000009', '{}'::jsonb)$$,
  'Walk-in admission is recorded only after confirmation');
select is((public.site_capacity_snapshot('82000000-0000-4000-8000-000000000001')->>'current_visitor_count')::bigint, 7::bigint, 'Confirmed walk-in entry increases occupancy');
select is((public.site_capacity_snapshot('82000000-0000-4000-8000-000000000001')->>'expected_visitor_count')::bigint, 4::bigint, 'Walk-in admission remains excluded from expected online visitors');
select is((public.site_capacity_snapshot('82000000-0000-4000-8000-000000000001')->>'arrivals_today')::bigint, 11::bigint, 'Arrivals today combines confirmed online and walk-in admissions');
select lives_ok($$select * from public.confirm_manual_attendance(
  (select booking_reference from attendance_walkin), '82000000-0000-4000-8000-000000000001',
  'exit', 3, '85000000-0000-4000-8000-00000000000a', '{}'::jsonb)$$,
  'Walk-in checkout supports a partial group departure');
select is((public.site_capacity_snapshot('82000000-0000-4000-8000-000000000001')->>'current_visitor_count')::bigint, 4::bigint, 'Partial walk-in checkout leaves four inside');
select lives_ok($$select * from public.confirm_manual_attendance(
  (select booking_reference from attendance_walkin), '82000000-0000-4000-8000-000000000001',
  'exit', 4, '85000000-0000-4000-8000-00000000000b', '{}'::jsonb)$$,
  'Final walk-in checkout completes its group');
select is((select booking_status::text from public.bookings where id = (select booking_id from attendance_walkin)), 'completed', 'Walk-in booking completes after checkout');

reset role;
insert into public.attendance_logs (booking_id, site_id, gatekeeper_id, action, visitor_count, scanned_at, idempotency_key)
values (
  '84000000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000001',
  '81000000-0000-4000-8000-000000000002', 'entry', 1,
  (((now() at time zone 'Asia/Manila')::date - 1)::timestamp + time '12:00') at time zone 'Asia/Manila',
  '85000000-0000-4000-8000-00000000000c'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000002', true);
select is((select result from public.manual_scan_ticket('ILG-ATTENDANCE-OVERNIGHT', '82000000-0000-4000-8000-000000000001')),
  'checkout_confirmation_required', 'An active visit remains eligible for checkout after its booking day');
select is((public.site_capacity_snapshot('82000000-0000-4000-8000-000000000001')->>'current_visitor_count')::bigint, 1::bigint, 'Active occupancy persists across the Manila date boundary');
select is((public.site_capacity_snapshot('82000000-0000-4000-8000-000000000001')->>'arrivals_today')::bigint, 11::bigint, 'Yesterday entry does not inflate today arrivals');
select lives_ok($$select * from public.confirm_manual_attendance(
  'ILG-ATTENDANCE-OVERNIGHT', '82000000-0000-4000-8000-000000000001',
  'exit', 1, '85000000-0000-4000-8000-00000000000d', '{}'::jsonb)$$,
  'An overnight active visitor can check out after the visit window');
select is((public.site_capacity_snapshot('82000000-0000-4000-8000-000000000001')->>'current_visitor_count')::bigint, 0::bigint, 'Overnight checkout clears active occupancy');
select is((public.site_capacity_snapshot('82000000-0000-4000-8000-000000000001')->>'arrivals_today')::bigint, 11::bigint, 'Prior-day arrival remains outside today total');
select is((public.site_capacity_snapshot('82000000-0000-4000-8000-000000000001')->>'departures_today')::bigint, 12::bigint, 'Overnight checkout increments today departures');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000003', true);
select is((public.site_capacity_snapshot('82000000-0000-4000-8000-000000000001')->>'current_visitor_count')::bigint, 0::bigint, 'Visitor portal reads the same aggregated occupancy');
select is((select current_visitor_count from public.site_live_occupancy('82000000-0000-4000-8000-000000000001')), 0::bigint, 'Public live occupancy matches the shared snapshot');
select is((public.site_capacity_snapshot('82000000-0000-4000-8000-000000000001')->>'arrivals_today')::bigint, 11::bigint, 'Visitor portal reads the shared Manila arrival total');
select is((public.site_capacity_snapshot('82000000-0000-4000-8000-000000000001')->>'departures_today')::bigint, 12::bigint, 'Visitor portal reads the shared Manila departure total');
select throws_ok($$select * from public.confirm_manual_attendance(
  'ILG-ATTENDANCE-ONLINE', '82000000-0000-4000-8000-000000000001',
  'entry', 1, '85000000-0000-4000-8000-00000000000e', '{}'::jsonb)$$,
  'P0001', 'Gatekeeper access denied', 'Visitors cannot create attendance events');
select throws_ok($$insert into public.attendance_logs (booking_id, site_id, gatekeeper_id, action, visitor_count, idempotency_key)
  values ('84000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001',
  '81000000-0000-4000-8000-000000000003', 'entry', 1, '85000000-0000-4000-8000-00000000000f')$$,
  '42501', null, 'Visitors cannot insert their own attendance rows');

select * from finish();
rollback;
