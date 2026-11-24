import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/capacity.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { capacityStatus, operatingStatus, scheduledCapacityStatus } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const occupancy = (count, limit = 100) => ({ current_visitor_count: count, approved_visitor_limit: limit });

test('crowd levels use raw recorded occupancy and keep 95% distinct from the approved maximum', () => {
  assert.deepEqual([0, 69, 70, 84, 85, 94, 95, 100, 110].map((count) => capacityStatus(occupancy(count)).level),
    ['available', 'available', 'near', 'near', 'almost', 'almost', 'critical', 'critical', 'critical']);
  assert.equal(capacityStatus(occupancy(95)).percent, 95);
  assert.equal(capacityStatus(occupancy(110)).percent, 110);
  assert.equal(capacityStatus(occupancy(1, null)).level, 'unconfigured');
  assert.equal(capacityStatus({ ...occupancy(1, null), estimated_live_capacity: 80 }).level, 'available');
  assert.equal(capacityStatus({ ...occupancy(1, null), estimated_live_capacity: 80 }).percent, 1.25);
  assert.equal(capacityStatus(null).level, 'unknown');
});

test('site thresholds override defaults without rounding across a boundary', () => {
  const row = { ...occupancy(849, 1000), near_threshold_percent: 60, almost_threshold_percent: 85, critical_threshold_percent: 90 };
  assert.equal(capacityStatus(row).level, 'near');
  assert.equal(capacityStatus({ ...row, current_visitor_count: 900 }).level, 'critical');
});

test('scheduled capacity includes only the projected visitor count and selected-date thresholds', () => {
  const snapshot = { ...occupancy(70), projected_visitor_count: 88, reserved_visitor_count: 18, critical_threshold_percent: 85 };
  const status = scheduledCapacityStatus(snapshot);
  assert.equal(status.percent, 88);
  assert.equal(status.level, 'critical');
  assert.equal(scheduledCapacityStatus({ ...snapshot, projected_visitor_count: 69 }).level, 'available');
});

test('operating status respects hours, exceptions and closures', () => {
  const site = { status: 'published', timezone: 'Asia/Manila', operating_hours: [{ weekday: 0, opens_at: '07:00:00', closes_at: '17:00:00', is_closed: false }], operating_exceptions: [], closures: [] };
  const now = new Date('2026-11-22T02:00:00Z');
  assert.equal(operatingStatus(site, now), 'Open now');
  assert.equal(operatingStatus({ ...site, operating_exceptions: [{ exception_date: '2026-11-22', is_closed: true, opens_at: null, closes_at: null }] }, now), 'Closed now');
  assert.equal(operatingStatus({ ...site, closures: [{ starts_on: '2026-11-22', ends_on: '2026-11-22', starts_at: null, ends_at: null }] }, now), 'Closed now');
});
