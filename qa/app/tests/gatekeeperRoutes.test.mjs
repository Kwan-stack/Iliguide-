import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/gatekeeperRoutes.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { gatekeeperPath, isGatekeeperPath, parseGatekeeperRoute } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('destination route resolves only known gatekeeper sections', () => {
  assert.deepEqual(parseGatekeeperRoute('/gatekeeper/tinago-falls'), { siteSlug: 'tinago-falls', page: 'Overview' });
  assert.deepEqual(parseGatekeeperRoute('/gatekeeper/mimbalot-falls/reservations'), { siteSlug: 'mimbalot-falls', page: 'Reservations' });
  assert.deepEqual(parseGatekeeperRoute('/gatekeeper/sikyop-agri-tourism-adventure/logbook'), { siteSlug: 'sikyop-agri-tourism-adventure', page: 'Visitor Logbook' });
  assert.deepEqual(parseGatekeeperRoute('/gatekeeper/timoga-cold-springs/check-in'), { siteSlug: 'timoga-cold-springs', page: 'Scan and exit' });
  assert.deepEqual(parseGatekeeperRoute('/gatekeeper/tinago-falls/change-password'), { siteSlug: 'tinago-falls', page: 'Change password' });
  assert.equal(parseGatekeeperRoute('/gatekeeper/tinago-falls/unknown'), null);
});

test('gatekeeper path builder preserves the explicit destination and page', () => {
  assert.equal(gatekeeperPath('tinago-falls', 'Reports'), '/gatekeeper/tinago-falls/reports');
  assert.equal(gatekeeperPath('tinago-falls', 'Change password'), '/gatekeeper/tinago-falls/change-password');
  assert.equal(isGatekeeperPath('/gatekeeper/access'), true);
  assert.equal(isGatekeeperPath('/destinations'), false);
});
