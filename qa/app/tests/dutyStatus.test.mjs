import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/dutyStatus.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { dutyWindowStatus } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('duty status follows the assigned shift window, not the assignment date alone', () => {
  const start = Date.parse('2026-11-23T07:00:00+08:00');
  const end = Date.parse('2026-11-23T17:00:00+08:00');
  assert.equal(dutyWindowStatus(new Date(start).toISOString(), new Date(end).toISOString(), start - 1), 'Scheduled Today');
  assert.equal(dutyWindowStatus(new Date(start).toISOString(), new Date(end).toISOString(), start), 'On Duty');
  assert.equal(dutyWindowStatus(new Date(start).toISOString(), new Date(end).toISOString(), end), 'Completed');
});
