import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/capacity.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { capacityStatus, operatingStatus } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const occupancy = (count, limit = 100) => ({ current_visitor_count: count, approved_visitor_limit: limit });

test('crowd levels use raw recorded occupancy and keep 95% distinct from the approved maximum', () => {
  assert.deepEqual([0, 69, 70, 84, 85, 94, 95, 100, 110].map((count) => capacityStatus(occupancy(count)).level),
    ['available', 'available', 'near', 'near', 'almost', 'almost', 'critical', 'critical', 'critical']);
  assert.equal(capacityStatus(occupancy(95)).percent, 95);
  assert.equal(capacityStatus(occupancy(110)).percent, 110);
  assert.equal(capacityStatus(occupancy(1, null)).level, 'unconfigured');
  assert.equal(capacityStatus(null).level, 'unknown');
});

test('site thresholds override defaults without rounding across a boundary', () => {
  const row = { ...occupancy(849, 1000), near_threshold_percent: 60, almost_threshold_percent: 85, critical_threshold_percent: 90 };
  assert.equal(capacityStatus(row).level, 'near');
  assert.equal(capacityStatus({ ...row, current_visitor_count: 900 }).level, 'critical');
});

test('operating status respects hours, exceptions and closures', () => {
  const site = { status: 'published', timezone: 'Asia/Manila', operating_hours: [{ weekday: 0, opens_at: '07:00:00', closes_at: '17:00:00', is_closed: false }], operating_exceptions: [], closures: [] };
  const now = new Date('2026-11-22T02:00:00Z');
  assert.equal(operatingStatus(site, now), 'Open now');
  assert.equal(operatingStatus({ ...site, operating_exceptions: [{ exception_date: '2026-11-22', is_closed: true, opens_at: null, closes_at: null }] }, now), 'Closed now');
  assert.equal(operatingStatus({ ...site, closures: [{ starts_on: '2026-11-22', ends_on: '2026-11-22', starts_at: null, ends_at: null }] }, now), 'Closed now');
});
