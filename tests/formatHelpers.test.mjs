import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/formatHelpers.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const {
  calculateBookingTotal,
  dateLabel,
  escapeCsvCell,
  isValidOptionalPhone,
  money,
  monthDateRange,
  timeLabel,
} = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('calculateBookingTotal rounds to cents and guards against NaN or out-of-range PWD counts', () => {
  assert.equal(calculateBookingTotal(100, 50, 20, 2, 1, 1), 230);
  assert.equal(calculateBookingTotal(33.33, 15.15, 20, 3, 2, 1), 123.62);
  assert.equal(calculateBookingTotal(100, 50, 20, Number.NaN, 1, Number.NaN), 50);
  assert.equal(calculateBookingTotal(100, 0, 50, 1, 0, 99), 50);
  assert.equal(calculateBookingTotal(50, 25, 20, -2, -1, -1), 0);
});

test('money formats finite amounts and falls back cleanly on NaN', () => {
  assert.match(money(150), /150/);
  assert.match(money(Number.NaN), /0/);
  assert.doesNotMatch(money(Number.NaN), /NaN/);
});

test('dateLabel and timeLabel return fallback em-dash for empty or invalid values', () => {
  assert.equal(dateLabel(''), '—');
  assert.equal(dateLabel(null), '—');
  assert.equal(dateLabel('not-a-date'), '—');
  assert.match(dateLabel('2026-11-20'), /2026/);

  assert.equal(timeLabel(''), '—');
  assert.equal(timeLabel(undefined), '—');
  assert.equal(timeLabel('25:99'), '—');
  assert.equal(timeLabel('invalid'), '—');
  assert.match(timeLabel('09:30:00'), /9:30/);
});

test('escapeCsvCell neutralizes spreadsheet formula injection and escapes quotes', () => {
  assert.equal(escapeCsvCell('Tinago Falls'), '"Tinago Falls"');
  assert.equal(escapeCsvCell('He said "hi"'), '"He said ""hi"""');
  assert.equal(escapeCsvCell('=CMD|"/C calc"!A0'), '"\'=CMD|""/C calc""!A0"');
  assert.equal(escapeCsvCell('+SUM(A1:A2)'), '"\'+SUM(A1:A2)"');
  assert.equal(escapeCsvCell('-1+1'), '"\'-1+1"');
  assert.equal(escapeCsvCell('@HYPERLINK("http://evil")'), '"\'@HYPERLINK(""http://evil"")"');
});

test('monthDateRange validates YYYY-MM strings and handles leap years safely', () => {
  assert.deepEqual(monthDateRange('2024-02'), { start: '2024-02-01', end: '2024-02-29' });
  assert.deepEqual(monthDateRange('2026-02'), { start: '2026-02-01', end: '2026-02-28' });
  assert.deepEqual(monthDateRange('2026-11'), { start: '2026-11-01', end: '2026-11-30' });
  assert.equal(monthDateRange(''), null);
  assert.equal(monthDateRange('2026-13'), null);
  assert.equal(monthDateRange('invalid'), null);
});

test('isValidOptionalPhone requires 7 to 15 digits when non-empty', () => {
  assert.equal(isValidOptionalPhone(''), true);
  assert.equal(isValidOptionalPhone('   '), true);
  assert.equal(isValidOptionalPhone('+63 917 123 4567'), true);
  assert.equal(isValidOptionalPhone('-------'), false);
  assert.equal(isValidOptionalPhone('123456'), false);
  assert.equal(isValidOptionalPhone('1234567890123456'), false);
});
