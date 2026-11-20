import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const gatekeeperSource = await readFile(new URL('../src/lib/gatekeeperRoutes.ts', import.meta.url), 'utf8');
const gatekeeperCompiled = ts.transpileModule(gatekeeperSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const gatekeeperUrl = `data:text/javascript;base64,${Buffer.from(gatekeeperCompiled).toString('base64')}`;
const source = (await readFile(new URL('../src/lib/appRoutes.ts', import.meta.url), 'utf8'))
  .replace("from './gatekeeperRoutes'", `from '${gatekeeperUrl}'`);
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const routes = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('visitor and staff sign-in have distinct entry routes', () => {
  assert.equal(routes.pageFromPath('/login'), 'Visitor login');
  assert.equal(routes.pageFromPath('/staff/login'), 'Staff login');
  assert.equal(routes.visitorLoginUrl('/destinations/tinago-falls'), '/login?next=%2Fdestinations%2Ftinago-falls');
  assert.equal(routes.visitorLoginUrl('/discover'), '/login?next=%2Fdiscover');
  assert.equal(routes.visitorLoginUrl('/'), '/login?next=%2F');
  assert.equal(routes.visitorLoginUrl('/destinations'), '/login?next=%2Fdestinations');
  assert.equal(routes.visitorLoginUrl(), '/login');
  assert.equal(routes.staffLoginUrl('/workspace/reservations'), '/staff/login?next=%2Fworkspace%2Freservations');
});

test('sign-in return routes allow only local routes for the matching audience', () => {
  assert.equal(routes.visitorReturnPath('/bookings'), '/bookings');
  assert.equal(routes.visitorReturnPath('/workspace'), '/');
  assert.equal(routes.visitorReturnPath('https://example.com'), '/');
  assert.equal(routes.visitorReturnPath('//example.com'), '/');
  assert.equal(routes.visitorReturnPath('/discover'), '/discover');
  assert.equal(routes.visitorReturnPath('/destinations'), '/destinations');
  assert.equal(routes.visitorAuthDismissPath(null), '/discover');
  assert.equal(routes.visitorAuthDismissPath('/'), '/');
  assert.equal(routes.visitorAuthDismissPath('/destinations'), '/destinations');
  assert.equal(routes.visitorAuthDismissPath('/workspace'), '/discover');
  assert.equal(routes.visitorAuthDismissPath('https://example.com'), '/discover');
  assert.equal(routes.pageFromPath(routes.visitorAuthDismissPath(null)), 'Discover');
  assert.equal(routes.pageFromPath(routes.visitorAuthDismissPath('/')), 'Landing');
  assert.equal(routes.staffReturnPath('/workspace/team'), '/workspace/team');
  assert.equal(routes.staffReturnPath('/gatekeeper/tinago-falls/check-in'), '/gatekeeper/tinago-falls/check-in');
  assert.equal(routes.staffReturnPath('/account'), '');
});

test('successful staff sign-in returns to its workspace, never the visitor home', () => {
  assert.equal(routes.authSuccessPath('staff', '/workspace/team'), '/workspace/team');
  assert.equal(routes.authSuccessPath('staff', '/'), '/workspace');
  assert.equal(routes.authSuccessPath('staff', 'https://example.com'), '/workspace');
  assert.equal(routes.authSuccessPath('visitor', '/bookings'), '/bookings');
  assert.equal(routes.authSuccessPath('visitor'), '/discover');
  assert.equal(routes.authSuccessPath('visitor', '/workspace'), '/');
});

test('password recovery returns to the matching account portal', () => {
  assert.equal(routes.passwordRecoveryPath('visitor'), '/login?mode=reset');
  assert.equal(routes.passwordRecoveryPath('gatekeeper'), '/staff/login?mode=reset');
  assert.equal(routes.passwordRecoveryPath('site_admin'), '/staff/login?mode=reset');
  assert.equal(routes.passwordRecoveryPath('tourism_office'), '/staff/login?mode=reset');
});

test('visitor auth modal never opens over staff sign-in or workspace routes', () => {
  assert.equal(routes.canShowVisitorAuthModal('/'), true);
  assert.equal(routes.canShowVisitorAuthModal('/login'), true);
  assert.equal(routes.canShowVisitorAuthModal('/staff/login'), false);
  assert.equal(routes.canShowVisitorAuthModal('/workspace/reservations'), false);
  assert.equal(routes.canShowVisitorAuthModal('/gatekeeper/tinago-falls/check-in'), false);
});

test('route matching resolves workspace and destination pages', () => {
  assert.equal(routes.visitorRoutePaths.Discover, '/discover');
  assert.equal(routes.visitorRoutePaths.Destinations, '/destinations');
  assert.equal(routes.pageFromPath('/workspace/reservations'), 'Reservations');
  assert.equal(routes.pageFromPath('/workspace/account/password'), 'Change password');
  assert.equal(routes.pageFromPath('/workspace/unrecognized'), 'Overview');
  assert.equal(routes.pageFromPath('/discover'), 'Discover');
  assert.equal(routes.pageFromPath('/destinations'), 'Destinations');
  assert.equal(routes.pageFromPath('/destinations/tinago-falls'), 'Destination');
  assert.equal(routes.destinationSlugFromPath('/destinations/tinago-falls'), 'tinago-falls');
  assert.equal(routes.isKnownAppPath('/destinations/tinago-falls'), true);
  assert.equal(routes.isKnownAppPath('/not-a-route'), false);
});
