begin;
select plan(15);

select has_column('public', 'audit_logs', 'transaction_id', 'Audit rows retain their transaction identifier');
select has_column('public', 'audit_logs', 'event_type', 'Audit rows have a business event type');
select has_column('public', 'audit_logs', 'previous_values', 'Audit rows retain safe previous values');
select has_column('public', 'audit_logs', 'updated_values', 'Audit rows retain safe updated values');
select has_view('public', 'activity_log_events', 'Activity view groups business events');
select has_policy('public', 'audit_logs', 'audit_logs_tourism_office_read', 'Only Tourism Office reads central audit history');
select ok((select reloptions @> array['security_invoker=true'] from pg_class where oid = 'public.activity_log_events'::regclass), 'Activity view respects caller row policies');
select ok(not has_table_privilege('authenticated', 'public.audit_logs', 'insert'), 'Staff cannot insert audit rows directly');
select ok(not has_table_privilege('authenticated', 'public.audit_logs', 'update'), 'Staff cannot edit audit rows');
select ok(not has_table_privilege('authenticated', 'public.audit_logs', 'delete'), 'Staff cannot delete audit rows');
select ok(private.activity_snapshot('bookings', '{"booking_reference":"ACTIVITY-TEST","visitor_email":"private@example.invalid"}'::jsonb) ? 'booking_reference', 'Safe booking reference is captured');
select ok(not (private.activity_snapshot('bookings', '{"booking_reference":"ACTIVITY-TEST","visitor_email":"private@example.invalid"}'::jsonb) ? 'visitor_email'), 'Visitor contact details are excluded from snapshots');

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at)
values
  ('a8100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'audit-visitor@example.invalid', '', now()),
  ('a8100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'audit-office@example.invalid', '', now());
update public.profiles set role = 'tourism_office' where id = 'a8100000-0000-4000-8000-000000000002';

insert into public.audit_logs (action, entity_type, entity_id, transaction_id, event_type, category, event_priority, previous_values, updated_values, metadata, outcome, search_text)
values
  ('insert', 'bookings', 'a8200000-0000-4000-8000-000000000001', txid_current() + 9000000, 'booking_created', 'Booking', 40, '{}'::jsonb, '{"visitor_count":2}'::jsonb, '{}'::jsonb, 'success', 'booking created'),
  ('update', 'bookings', 'a8200000-0000-4000-8000-000000000001', txid_current() + 9000000, 'booking_confirmed', 'Booking', 70, '{"booking_status":"awaiting_payment"}'::jsonb, '{"booking_status":"confirmed"}'::jsonb, '{}'::jsonb, 'success', 'booking confirmed');

select is((select change_count from public.activity_log_events where event_key = 'tx:' || (txid_current() + 9000000)::text), 2, 'Related rows appear as one grouped transaction');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a8100000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.activity_log_events where event_key = 'tx:' || (txid_current() + 9000000)::text), 0, 'Visitors cannot read activity history');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a8100000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from public.activity_log_events where event_key = 'tx:' || (txid_current() + 9000000)::text), 1, 'Tourism Office can read the grouped transaction');

select * from finish();
rollback;
