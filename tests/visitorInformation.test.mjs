import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/visitorInformation.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { completedVisitorCount, emptyVisitorInformation, parseVisitorInformation, pwdVisitorInformationComplete, requiredVisitorFields, resizeVisitorInformation, visitorInformationComplete, visitorInformationPayload } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('uses destination-specific visitor fields', () => {
  assert.deepEqual(requiredVisitorFields('tinago-falls'), ['fullName', 'address', 'gender']);
  assert.deepEqual(requiredVisitorFields('mimbalot-falls'), ['fullName', 'address', 'gender', 'nationality']);
  assert.deepEqual(requiredVisitorFields('sikyop-agri-tourism-adventure'), ['fullName', 'address', 'gender']);
  assert.deepEqual(requiredVisitorFields('timoga-cold-springs'), ['fullName', 'address']);
});

test('resizes groups while preserving entered rows and validating every person', () => {
  const visitors = emptyVisitorInformation(3);
  visitors[0] = { fullName: 'Ada', address: 'Address 1', gender: 'female', nationality: '' };
  visitors[1] = { fullName: 'Ben', address: 'Address 2', gender: 'male', nationality: '' };
  assert.equal(completedVisitorCount(visitors, 'tinago-falls'), 2);
  assert.equal(visitorInformationComplete(visitors, 'tinago-falls'), false);
  assert.equal(resizeVisitorInformation(visitors, 2)[1].fullName, 'Ben');
  assert.equal(resizeVisitorInformation(visitors, 4)[3].fullName, '');
  assert.equal(visitorInformationComplete(resizeVisitorInformation(visitors, 2), 'tinago-falls'), true);
});

test('creates one clean database payload per adult and child', () => {
  const visitors = [
    { fullName: 'Adult', address: 'Home 1', gender: 'female', nationality: 'Filipino' },
    { fullName: 'Child', address: 'Home 2', gender: 'male', nationality: 'Filipino' },
  ];
  assert.deepEqual(visitorInformationPayload(visitors, 'mimbalot-falls'), [
    { full_name: 'Adult', address: 'Home 1', gender: 'female', nationality: 'Filipino' },
    { full_name: 'Child', address: 'Home 2', gender: 'male', nationality: 'Filipino' },
  ]);
  assert.deepEqual(visitorInformationPayload(visitors, 'timoga-cold-springs'), [
    { full_name: 'Adult', address: 'Home 1' }, { full_name: 'Child', address: 'Home 2' },
  ]);
  assert.equal(parseVisitorInformation(JSON.stringify(visitors), 2).length, 2);
  assert.equal(parseVisitorInformation(JSON.stringify(visitors), 1), null);
});

test('PWD claims match the selected count and require category and photo', () => {
  const visitors = emptyVisitorInformation(2);
  visitors[0] = { ...visitors[0], isPwd: true, disabilityCategory: 'visual', pwdIdPhoto: { name: 'id.png' } };
  assert.equal(pwdVisitorInformationComplete(visitors, 1, true), true);
  assert.equal(pwdVisitorInformationComplete(visitors, 2, true), false);
  assert.equal(pwdVisitorInformationComplete([{ ...visitors[0], pwdIdPhoto: null }, visitors[1]], 1, true), false);
  assert.equal(pwdVisitorInformationComplete([{ ...visitors[0], disabilityCategory: '' }, visitors[1]], 1, true), false);
  assert.equal(pwdVisitorInformationComplete(visitors, 0, false), true);
  assert.equal(pwdVisitorInformationComplete(emptyVisitorInformation(2), 0, false), true);
});
