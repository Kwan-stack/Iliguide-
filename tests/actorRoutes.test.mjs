import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/actorRoutes.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { staffPageForRole } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('visitors stay on visitor pages and leave staff routes', () => {
  assert.equal(staffPageForRole('visitor', 'Overview'), 'Discover');
  assert.equal(staffPageForRole('visitor', 'Destinations'), 'Destinations');
  assert.equal(staffPageForRole('visitor', 'Destination map'), 'Destination map');
});

test('gatekeepers can use operational pages only', () => {
  assert.equal(staffPageForRole('gatekeeper', 'Scan and exit'), 'Scan and exit');
  assert.equal(staffPageForRole('gatekeeper', 'Change password'), 'Change password');
  assert.equal(staffPageForRole('gatekeeper', 'Staff and accounts'), 'Overview');
  assert.equal(staffPageForRole('gatekeeper', 'Tickets'), 'Overview');
});

test('site administrators retain assigned-site routes and cannot enter unsupported pages', () => {
  assert.equal(staffPageForRole('site_admin', 'Change password'), 'Change password');
  assert.equal(staffPageForRole('site_admin', 'Schedule & Operations'), 'Schedule & Operations');
  assert.equal(staffPageForRole('site_admin', 'Staff and accounts'), 'Staff and accounts');
  assert.equal(staffPageForRole('site_admin', 'Payment settings'), 'Payment settings');
  assert.equal(staffPageForRole('site_admin', 'Payment verification'), 'Payment verification');
  assert.equal(staffPageForRole('site_admin', 'Sites and staff'), 'Sites and staff');
  assert.equal(staffPageForRole('site_admin', 'Activity'), 'Overview');
  assert.equal(staffPageForRole('site_admin', 'Walk-in registration'), 'Overview');
  assert.equal(staffPageForRole('site_admin', 'Destinations'), 'Overview');
});

test('Tourism Office gets office pages and no visitor account pages', () => {
  assert.equal(staffPageForRole('tourism_office', 'Feedback & Reviews'), 'Feedback & Reviews');
  assert.equal(staffPageForRole('tourism_office', 'Change password'), 'Change password');
  assert.equal(staffPageForRole('tourism_office', 'Sites and staff'), 'Sites and staff');
  assert.equal(staffPageForRole('tourism_office', 'Activity'), 'Activity');
  assert.equal(staffPageForRole('tourism_office', 'Bookings'), 'Overview');
  assert.equal(staffPageForRole('tourism_office', 'Duty roster'), 'Schedule & Operations');
  assert.equal(staffPageForRole('tourism_office', 'Slots and closures'), 'Schedule & Operations');
  assert.equal(staffPageForRole('tourism_office', 'Schedule & Operations'), 'Schedule & Operations');
});

test('destination feedback stays out of Gatekeeper access', () => {
  assert.equal(staffPageForRole('site_admin', 'Feedback & Reviews'), 'Feedback & Reviews');
  assert.equal(staffPageForRole('gatekeeper', 'Feedback & Reviews'), 'Overview');
  assert.equal(staffPageForRole('visitor', 'Feedback & Reviews'), 'Discover');
});

test('destination updates are restricted to Tourism Office and assigned Site Admin routes', () => {
  assert.equal(staffPageForRole('tourism_office', 'Destination updates'), 'Destination updates');
  assert.equal(staffPageForRole('site_admin', 'Destination updates'), 'Destination updates');
  assert.equal(staffPageForRole('gatekeeper', 'Destination updates'), 'Overview');
  assert.equal(staffPageForRole('visitor', 'Destination updates'), 'Discover');
});

test('legacy schedule pages remain available to Site Admin and Gatekeeper roles stay blocked', () => {
  assert.equal(staffPageForRole('site_admin', 'Duty roster'), 'Duty roster');
  assert.equal(staffPageForRole('site_admin', 'Slots and closures'), 'Slots and closures');
  assert.equal(staffPageForRole('gatekeeper', 'Schedule & Operations'), 'Overview');
});

test('visitors cannot enter the staff password page', () => {
  assert.equal(staffPageForRole('visitor', 'Change password'), 'Discover');
});
