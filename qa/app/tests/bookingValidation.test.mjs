import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/bookingValidation.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { bookingContactError } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('requires a usable name and one contact method', () => {
  assert.match(bookingContactError(' ', '', ''), /booking name/);
  assert.match(bookingContactError('Visitor', '', ''), /at least one contact method/);
  assert.equal(bookingContactError(' Visitor ', 'visitor@example.com', ''), null);
});

test('rejects malformed email or phone input', () => {
  assert.match(bookingContactError('Visitor', 'not-an-email', '+639171234567'), /valid email/);
  assert.match(bookingContactError('Visitor', '', 'letters only'), /7 to 15 digits/);
});

test('accepts a valid phone-only booking contact', () => {
  assert.equal(bookingContactError('Visitor', '', '+63 917 123 4567'), null);
});
