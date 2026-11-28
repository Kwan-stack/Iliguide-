import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadTsModule(relativePath, replacements = {}) {
  let source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
  for (const [from, to] of Object.entries(replacements)) {
    source = source.replaceAll(from, to);
  }
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  return `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`;
}

const gatekeeperUrl = await loadTsModule('../src/lib/gatekeeperRoutes.ts');
const appRoutesUrl = await loadTsModule('../src/lib/appRoutes.ts', {
  "from './gatekeeperRoutes'": `from '${gatekeeperUrl}'`,
});
const safeNavUrl = await loadTsModule('../src/lib/safeNavigation.ts', {
  "from './appRoutes'": `from '${appRoutesUrl}'`,
  "from './gatekeeperRoutes'": `from '${gatekeeperUrl}'`,
});
const safeNav = await import(safeNavUrl);

test('hasInternalNavigationHistory only returns true when React Router history idx > 0', () => {
  assert.equal(safeNav.hasInternalNavigationHistory({ idx: 2 }), true);
  assert.equal(safeNav.hasInternalNavigationHistory({ idx: 1 }), true);
  assert.equal(safeNav.hasInternalNavigationHistory({ idx: 0 }), false);
  assert.equal(safeNav.hasInternalNavigationHistory(null, 1), false);
  assert.equal(safeNav.hasInternalNavigationHistory({}, 1), false);
});

test('resolveSafeHomePath maps each role to its safe home route or fallback when signed out', () => {
  assert.equal(safeNav.resolveSafeHomePath(null), '/');
  assert.equal(safeNav.resolveSafeHomePath(undefined, null, '/discover'), '/discover');
  assert.equal(safeNav.resolveSafeHomePath('visitor'), '/discover');
  assert.equal(safeNav.resolveSafeHomePath('tourism_office'), '/workspace');
  assert.equal(safeNav.resolveSafeHomePath('site_admin'), '/site-admin');
  assert.equal(safeNav.resolveSafeHomePath('gatekeeper', 'tinago-falls'), '/gatekeeper/tinago-falls/dashboard');
  assert.equal(safeNav.resolveSafeHomePath('gatekeeper', null), '/gatekeeper/access');
});

test('safeNavigateBack navigates -1 only when internal history exists and falls back cleanly otherwise', () => {
  const calls = [];
  const navigate = (to, options) => calls.push({ to, options });

  safeNav.safeNavigateBack(navigate, '/discover', { idx: 2 });
  assert.deepEqual(calls[0], { to: -1, options: undefined });

  safeNav.safeNavigateBack(navigate, '/discover', { idx: 0 });
  assert.deepEqual(calls[1], { to: '/discover', options: { replace: true } });

  safeNav.safeNavigateBack(navigate, '/', null);
  assert.deepEqual(calls[2], { to: '/', options: { replace: true } });
});
