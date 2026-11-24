import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/visitorPlanning.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const planning = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

const booking = (booking_id, slot_date, booking_status = 'confirmed', ends_at = '17:00:00') => ({
  booking_id, slot_date, booking_status, ends_at, starts_at: '07:00:00',
  payment_status: 'not_required',
});

test('upcoming visits exclude cancelled, expired, completed, and already-ended reservations', () => {
  const rows = [
    booking('future', '2026-11-25'),
    booking('today', '2026-11-23'),
    booking('past', '2026-11-22'),
    booking('cancelled', '2026-11-24', 'cancelled'),
    booking('expired', '2026-11-24', 'expired'),
    booking('completed', '2026-11-24', 'completed'),
    booking('ended', '2026-11-23', 'confirmed', '08:00:00'),
    { ...booking('hold-expired', '2026-11-24', 'awaiting_payment'), hold_expires_at: '2026-11-23T00:00:00+08:00' },
    { ...booking('hold-valid', '2026-11-24', 'awaiting_payment'), hold_expires_at: '2026-11-23T12:00:00+08:00' },
  ];
  assert.deepEqual(planning.upcomingBookings(rows, '2026-11-23', '09:00').map((row) => row.booking_id), ['today', 'hold-valid', 'future']);
});

test('nearest upcoming visit sorts by date then start time', () => {
  const rows = [booking('late', '2026-11-24', 'confirmed', '18:00:00'), booking('early', '2026-11-24', 'confirmed', '08:00:00')];
  rows[0].starts_at = '12:00:00';
  rows[1].starts_at = '07:00:00';
  assert.equal(planning.nextUpcomingBooking(rows, '2026-11-23', '09:00').booking_id, 'early');
  assert.equal(planning.nextUpcomingBooking([], '2026-11-23', '09:00'), null);
});

test('QR ticket eligibility follows confirmed booking and payment rules', () => {
  assert.equal(planning.canIssueVisitorTicket(booking('free', '2026-11-23')), true);
  assert.equal(planning.canIssueVisitorTicket({ ...booking('paid', '2026-11-23'), payment_status: 'paid' }), true);
  assert.equal(planning.canIssueVisitorTicket({ ...booking('pending', '2026-11-23'), payment_status: 'pending' }), false);
  assert.equal(planning.canIssueVisitorTicket({ ...booking('cancelled', '2026-11-23'), booking_status: 'cancelled' }), false);
});
