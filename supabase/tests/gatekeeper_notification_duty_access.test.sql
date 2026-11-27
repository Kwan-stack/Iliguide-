begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
grant usage on schema extensions to public;
select extensions.plan(15);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at)
values
  ('91000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'notify-active@example.invalid', '', now()),
  ('91000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'notify-off-duty@example.invalid', '', now()),
  ('91000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'notify-upcoming@example.invalid', '', now());
update public.profiles set role = 'gatekeeper', account_status = 'active'
where id in ('91000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000003');

insert into public.tourism_sites (id, name, slug, management_organization_id, timezone)
values
  ('92000000-0000-4000-8000-000000000001', 'Notification Site A', 'notify-site-a', '00000000-0000-4000-8000-000000000001', 'Asia/Manila'),
  ('92000000-0000-4000-8000-000000000002', 'Notification Site B', 'notify-site-b', '00000000-0000-4000-8000-000000000001', 'Asia/Manila');
insert into public.site_settings (site_id, adult_fee, child_fee, daily_capacity, max_per_booking)
values ('92000000-0000-4000-8000-000000000001', 50, 50, 20, 20), ('92000000-0000-4000-8000-000000000002', 50, 50, 20, 20);
insert into public.site_operating_hours (site_id, weekday, opens_at, closes_at)
values
  ('92000000-0000-4000-8000-000000000001', extract(dow from (now() at time zone 'Asia/Manila')::date)::smallint, '00:00', '23:59:59.999999'),
  ('92000000-0000-4000-8000-000000000002', extract(dow from (now() at time zone 'Asia/Manila')::date)::smallint, '00:00', '23:59:59.999999');
insert into public.staff_assignments (profile_id, site_id, staff_role, is_active)
values
  ('91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', 'gatekeeper', true),
  ('91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000002', 'gatekeeper', true),
  ('91000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000001', 'gatekeeper', true),
  ('91000000-0000-4000-8000-000000000003', '92000000-0000-4000-8000-000000000001', 'gatekeeper', true),
  ('91000000-0000-4000-8000-000000000003', '92000000-0000-4000-8000-000000000002', 'gatekeeper', true);
insert into public.site_slots (id, site_id, slot_date, starts_at, ends_at, capacity, status)
values
  ('93000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', (now() at time zone 'Asia/Manila')::date, '00:00', '23:59:59.999999', 10, 'open'),
  ('93000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000002', (now() at time zone 'Asia/Manila')::date, '00:00', '23:59:59.999999', 10, 'open');
insert into public.bookings (id, booking_reference, site_id, slot_id, visitor_name, visitor_email, adult_count, child_count, total_amount, payment_status, booking_status, qr_token_hash, hold_expires_at)
values
  ('94000000-0000-4000-8000-000000000001', 'ILG-NOTIFY-A', '92000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', 'Visitor A', 'notify-visitor@example.invalid', 1, 0, 50, 'pending', 'awaiting_payment', extensions.digest(convert_to('notify-a', 'UTF8'), 'sha256'), now() + interval '1 day'),
  ('94000000-0000-4000-8000-000000000002', 'ILG-NOTIFY-B', '92000000-0000-4000-8000-000000000002', '93000000-0000-4000-8000-000000000002', 'Visitor B', 'notify-visitor@example.invalid', 1, 0, 50, 'pending', 'awaiting_payment', extensions.digest(convert_to('notify-b', 'UTF8'), 'sha256'), now() + interval '1 day');
insert into public.site_gatekeeper_duties (site_id, duty_date, shift_start_at, shift_end_at, primary_gatekeeper_id, status)
values
  ('92000000-0000-4000-8000-000000000001', (now() at time zone 'Asia/Manila')::date,
    ((now() at time zone 'Asia/Manila')::date::timestamp at time zone 'Asia/Manila'),
    (((now() at time zone 'Asia/Manila')::date + 1)::timestamp at time zone 'Asia/Manila'), '91000000-0000-4000-8000-000000000001', 'active'),
  ('92000000-0000-4000-8000-000000000002', (now() at time zone 'Asia/Manila')::date,
    (now() + interval '1 hour'), (now() + interval '3 hours'), '91000000-0000-4000-8000-000000000003', 'scheduled');
insert into public.payments (id, booking_id, provider, payment_mode, payment_application, payment_status, amount, transaction_reference, proof_storage_path, proof_submitted_at, payment_deadline)
values ('96000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', 'manual', 'demo', 'gcash', 'pending_verification', 50, 'DEMO-NOTIFY-001', '94000000-0000-4000-8000-000000000001/proof.png', now(), now() + interval '1 day');
insert into public.notifications (id, user_id, booking_id, title, message, notification_type)
values
  ('95000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000002', 'Other site', 'Other site notice', 'reservation_received');

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select extensions.is(private.has_active_gatekeeper_duty('92000000-0000-4000-8000-000000000001'), true, 'active duty passes server authorization');
select extensions.is((select count(*)::integer from public.notifications where user_id = '91000000-0000-4000-8000-000000000001'), 1, 'only active destination notifications are visible');
update public.notifications set read_at = now() where id = '95000000-0000-4000-8000-000000000001';
reset role;
select extensions.is((select count(*)::integer from public.notifications where id = '95000000-0000-4000-8000-000000000001' and read_at is null), 1, 'bulk read cannot update another destination notice');
set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select extensions.is((select count(*)::integer from public.payments p join public.bookings b on b.id = p.booking_id where b.site_id = '92000000-0000-4000-8000-000000000001' and p.payment_status = 'pending_verification'), 1, 'active duty sees its pending payment task');
update public.notifications set read_at = now() where user_id = '91000000-0000-4000-8000-000000000001' and notification_type = 'payment_verification';
select extensions.is((select count(*)::integer from public.notifications where user_id = '91000000-0000-4000-8000-000000000001' and read_at is null), 0, 'reading notification clears unread count');
select extensions.is((select count(*)::integer from public.payments p join public.bookings b on b.id = p.booking_id where b.site_id = '92000000-0000-4000-8000-000000000001' and p.payment_status = 'pending_verification'), 1, 'reading does not clear pending payment task');
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000002', true);
select extensions.is(private.has_active_gatekeeper_duty('92000000-0000-4000-8000-000000000001'), false, 'off-duty account fails server authorization');
select extensions.is((select count(*)::integer from public.notifications where user_id = '91000000-0000-4000-8000-000000000002'), 0, 'off-duty notifications are hidden by RLS');
select extensions.throws_ok($$select public.review_manual_payment('96000000-0000-4000-8000-000000000001', true, null)$$, '42501', 'You cannot review payments for this destination', 'off-duty Gatekeeper cannot resolve a payment');
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000003', true);
select extensions.is(private.has_active_gatekeeper_duty('92000000-0000-4000-8000-000000000002'), false, 'upcoming shift cannot access operational notices');
reset role;
update public.notifications set read_at = null where user_id = '91000000-0000-4000-8000-000000000001' and notification_type = 'payment_verification';
update public.bookings set booking_status = 'cancelled', hold_expires_at = null where id = '94000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select extensions.throws_ok($$select public.review_manual_payment('96000000-0000-4000-8000-000000000001', true, null)$$, 'P0001', 'Demo payment booking is no longer awaiting verification', 'cancelled booking cannot be reviewed');
reset role;
update public.bookings set booking_status = 'awaiting_payment', hold_expires_at = now() + interval '1 day' where id = '94000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select extensions.lives_ok($$select public.review_manual_payment('96000000-0000-4000-8000-000000000001', true, null)$$, 'active Gatekeeper can resolve a destination payment');
select extensions.is((select count(*)::integer from public.payments p join public.bookings b on b.id = p.booking_id where b.site_id = '92000000-0000-4000-8000-000000000001' and p.payment_status = 'pending_verification'), 0, 'successful verification clears pending payment count');
select extensions.is((select count(*)::integer from public.notifications where user_id = '91000000-0000-4000-8000-000000000001' and notification_type = 'payment_verification' and read_at is null), 1, 'resolving payment does not mark its notification read');
update public.notifications set read_at = now() where user_id = '91000000-0000-4000-8000-000000000001' and notification_type = 'payment_verification' and resolved_at is not null;
select extensions.is((select count(*)::integer from public.notifications where user_id = '91000000-0000-4000-8000-000000000001' and notification_type = 'payment_verification' and read_at is null), 0, 'mark all read updates a resolved notice');

reset role;
select * from extensions.finish();
rollback;
