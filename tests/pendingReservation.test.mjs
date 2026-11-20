import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/pendingReservation.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { parsePendingReservation } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const now = Date.parse('2026-11-17T00:00:00Z');
const pending = {
  siteId: '00000000-0000-4000-8000-000000000001',
  date: '2026-11-18',
  slotId: '00000000-0000-4000-8000-000000000002',
  party: { adults: 2, children: 1, pwd: 1 },
  savedAt: now,
};

test('restores valid reservation data', () => {
  assert.deepEqual(parsePendingReservation(JSON.stringify(pending), '2026-11-17', now), pending);
});

test('rejects expired, past-date, and invalid party data', () => {
  assert.equal(parsePendingReservation(JSON.stringify({ ...pending, savedAt: now - 8 * 86400000 }), '2026-11-17', now), null);
  assert.equal(parsePendingReservation(JSON.stringify({ ...pending, date: '2026-11-16' }), '2026-11-17', now), null);
  assert.equal(parsePendingReservation(JSON.stringify({ ...pending, party: { adults: 1, children: 0, pwd: 2 } }), '2026-11-17', now), null);
});
