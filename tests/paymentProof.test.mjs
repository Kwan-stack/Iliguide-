import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/paymentProof.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { MAX_PAYMENT_PROOF_BYTES, validatePaymentProofPhoto } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('accepts JPG and preserves the selected filename', async () => {
  const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0x00])], 'receipt.jpeg', { type: 'image/jpeg' });
  assert.equal(await validatePaymentProofPhoto(file), file);
});

test('detects PNG bytes when mobile browser omits the MIME type', async () => {
  const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'proof.png');
  const validated = await validatePaymentProofPhoto(file);
  assert.equal(validated.name, 'proof.png');
  assert.equal(validated.type, 'image/png');
});

test('rejects unsupported data and empty files', async () => {
  await assert.rejects(validatePaymentProofPhoto(new File(['pdf'], 'proof.pdf', { type: 'application/pdf' })), /JPG, JPEG, or PNG/);
  await assert.rejects(validatePaymentProofPhoto(new File([], 'empty.jpg', { type: 'image/jpeg' })), /non-empty/);
});

test('rejects files larger than 10 MiB', async () => {
  const file = new File([new Uint8Array(MAX_PAYMENT_PROOF_BYTES + 1)], 'large.jpg', { type: 'image/jpeg' });
  await assert.rejects(validatePaymentProofPhoto(file), /up to 10 MiB/);
});
