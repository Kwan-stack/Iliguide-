import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/visitorBookingFilters.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { filterVisitorBookings, matchesBookingTab } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const booking = (overrides = {}) => ({
  booking_status: 'confirmed', slot_date: '2026-11-20', site_name: 'Tinago Falls',
  booking_reference: 'ILG-123', created_at: '2026-11-10T00:00:00Z', ...overrides,
});

test('groups upcoming, pending, completed, cancelled, and expired bookings', () => {
  const today = '2026-11-17';
  assert.equal(matchesBookingTab(booking(), 'upcoming', today), true);
  assert.equal(matchesBookingTab(booking({ slot_date: today }), 'upcoming', today), true);
  assert.equal(matchesBookingTab(booking({ slot_date: '2026-11-16' }), 'upcoming', today), false);
  assert.equal(matchesBookingTab(booking({ booking_status: 'awaiting_payment' }), 'pending', today), true);
  assert.equal(matchesBookingTab(booking({ booking_status: 'needs_resolution' }), 'pending', today), true);
  assert.equal(matchesBookingTab(booking({ booking_status: 'completed' }), 'completed', today), true);
  assert.equal(matchesBookingTab(booking({ booking_status: 'expired' }), 'cancelled', today), true);
});

test('searches and date-filters bookings, sorted by creation date', () => {
  const rows = [
    booking({ booking_reference: 'ILG-OLD', created_at: '2026-11-01T00:00:00Z' }),
    booking({ site_name: 'Mimbalot Falls', slot_date: '2026-11-25', created_at: '2026-11-12T00:00:00Z' }),
  ];
  const filters = { tab: 'all', query: 'falls', dateFrom: '2026-11-20', dateTo: '2026-11-30', today: '2026-11-17' };
  assert.deepEqual(filterVisitorBookings(rows, { ...filters, sortOrder: 'newest' }).map((item) => item.site_name), ['Mimbalot Falls', 'Tinago Falls']);
  assert.deepEqual(filterVisitorBookings(rows, { ...filters, sortOrder: 'oldest' }).map((item) => item.site_name), ['Tinago Falls', 'Mimbalot Falls']);
  assert.deepEqual(filterVisitorBookings(rows, { ...filters, query: 'Sikyop', sortOrder: 'newest' }), []);
});
