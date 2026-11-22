import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/operatingHours.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { applyOperatingHoursTemplate } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const week = (closed = [0, 6]) => Array.from({ length: 7 }, (_, weekday) => ({
  weekday, opens_at: weekday === 1 ? '07:00' : '', closes_at: weekday === 1 ? '17:00' : '', is_closed: closed.includes(weekday),
}));

test('weekday shortcut copies Monday hours and leaves weekend unchanged', () => {
  const result = applyOperatingHoursTemplate(week(), [1, 2, 3, 4, 5]);
  assert.deepEqual(result.slice(1, 6).map(({ opens_at, closes_at, is_closed }) => [opens_at, closes_at, is_closed]), Array(5).fill(['07:00', '17:00', false]));
  assert.equal(result[0].is_closed, true);
  assert.equal(result[6].is_closed, true);
});

test('all-days shortcut opens Sunday and all remaining days', () => {
  const result = applyOperatingHoursTemplate(week(), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(result.map(({ weekday, opens_at, closes_at, is_closed }) => [weekday, opens_at, closes_at, is_closed]), Array.from({ length: 7 }, (_, weekday) => [weekday, '07:00', '17:00', false]));
});

test('shortcut refuses to invent hours when every target day is closed', () => {
  assert.equal(applyOperatingHoursTemplate(week([0, 1, 2, 3, 4, 5, 6]), [0, 1, 2, 3, 4, 5, 6]), null);
});
