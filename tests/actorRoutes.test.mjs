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

test('site administrators cannot enter Tourism Office only pages', () => {
  assert.equal(staffPageForRole('site_admin', 'Change password'), 'Change password');
  assert.equal(staffPageForRole('site_admin', 'Staff and accounts'), 'Staff and accounts');
  assert.equal(staffPageForRole('site_admin', 'Sites and staff'), 'Overview');
  assert.equal(staffPageForRole('site_admin', 'Activity'), 'Overview');
  assert.equal(staffPageForRole('site_admin', 'Walk-in registration'), 'Overview');
  assert.equal(staffPageForRole('site_admin', 'Destinations'), 'Overview');
});

test('Tourism Office gets office pages and no visitor account pages', () => {
  assert.equal(staffPageForRole('tourism_office', 'Change password'), 'Change password');
  assert.equal(staffPageForRole('tourism_office', 'Sites and staff'), 'Sites and staff');
  assert.equal(staffPageForRole('tourism_office', 'Activity'), 'Activity');
  assert.equal(staffPageForRole('tourism_office', 'Bookings'), 'Overview');
});

test('visitors cannot enter the staff password page', () => {
  assert.equal(staffPageForRole('visitor', 'Change password'), 'Discover');
});
