import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/adminCancellation.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const {
  ADMIN_CANCELLATION_CATEGORIES,
  isValidAdminCancellationCategory,
  validateAdminCancellationInput,
  canAdminCancelBooking,
  isAdminCancelledBooking,
  formatCancellationDetail,
  isScanWithinCooldown,
} = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('exposes all required City Tourism Office cancellation categories', () => {
  assert.deepEqual(ADMIN_CANCELLATION_CATEGORIES, [
    'Weather Condition',
    'Safety Advisory',
    'Site Maintenance',
    'Capacity Override',
    'Other',
  ]);
  assert.equal(isValidAdminCancellationCategory('Weather Condition'), true);
  assert.equal(isValidAdminCancellationCategory('Safety Advisory'), true);
  assert.equal(isValidAdminCancellationCategory('Unknown Reason'), false);
});

test('validates admin cancellation inputs cleanly', () => {
  assert.equal(validateAdminCancellationInput('Weather Condition', ''), null);
  assert.equal(
    validateAdminCancellationInput('Safety Advisory', 'Flash flood advisory at Tinago Falls'),
    null,
  );
  assert.match(validateAdminCancellationInput('Invalid', 'note') ?? '', /valid cancellation reason/i);
  assert.match(validateAdminCancellationInput('Other', 'x'.repeat(1001)) ?? '', /1,000 characters/i);
});

test('allows admin cancellation only on active confirmed or awaiting_payment bookings', () => {
  assert.equal(canAdminCancelBooking({ booking_status: 'confirmed' }), true);
  assert.equal(canAdminCancelBooking({ booking_status: 'awaiting_payment' }), true);
  assert.equal(canAdminCancelBooking({ booking_status: 'cancelled' }), false);
  assert.equal(canAdminCancelBooking({ booking_status: 'completed' }), false);
  assert.equal(canAdminCancelBooking({ booking_status: 'expired' }), false);
  assert.equal(canAdminCancelBooking(null), false);
});

test('identifies admin-cancelled bookings and formats category + custom note', () => {
  assert.equal(
    isAdminCancelledBooking({
      booking_status: 'cancelled',
      cancellation_category: 'Weather Condition',
      cancellation_reason: 'Heavy rainfall advisory',
    }),
    true,
  );
  assert.equal(
    isAdminCancelledBooking({
      booking_status: 'cancelled',
      cancellation_category: null,
      cancellation_reason: null,
      cancelled_by: null,
      cancelled_at: null,
    }),
    false,
  );
  assert.equal(
    isAdminCancelledBooking({
      booking_status: 'confirmed',
      cancellation_category: 'Weather Condition',
    }),
    false,
  );
  assert.equal(
    formatCancellationDetail('Weather Condition', 'Heavy rainfall at Tinago Falls'),
    'Weather Condition — Heavy rainfall at Tinago Falls',
  );
  assert.equal(formatCancellationDetail('Safety Advisory', ''), 'Safety Advisory');
  assert.equal(formatCancellationDetail('', ''), 'Cancelled by City Tourism Office');
});

test('enforces QR scanner cooldown window to prevent duplicate rapid scans', () => {
  const start = 1_700_000_000_000;
  // Immediate re-scan of same token is blocked
  assert.equal(isScanWithinCooldown('tok-1', start, 'tok-1', start + 500), true);
  // Different token inside short global cooldown (1.8s) is blocked
  assert.equal(isScanWithinCooldown('tok-1', start, 'tok-2', start + 1000), true);
  // Different token after global cooldown (1.8s) is allowed
  assert.equal(isScanWithinCooldown('tok-1', start, 'tok-2', start + 2000), false);
  // Same token inside same-token cooldown (3.5s) is still blocked
  assert.equal(isScanWithinCooldown('tok-1', start, 'tok-1', start + 2500), true);
  // Same token after same-token cooldown (3.5s) is allowed again
  assert.equal(isScanWithinCooldown('tok-1', start, 'tok-1', start + 4000), false);
});
