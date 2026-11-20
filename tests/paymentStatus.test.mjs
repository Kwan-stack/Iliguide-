import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/paymentStatus.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { paymentStatusLabel } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('shows positive admission estimates as not collected online', () => {
  assert.equal(paymentStatusLabel('not_required', 180), 'not collected online');
});

test('shows zero admission fees as payment not required', () => {
  assert.equal(paymentStatusLabel('not_required', 0), 'not required');
});

test('formats other payment states', () => {
  assert.equal(paymentStatusLabel('awaiting_payment', 180), 'awaiting payment');
});
