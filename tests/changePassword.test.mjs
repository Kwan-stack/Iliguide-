import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/changePassword.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { changePassword } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const user = { id: 'current-user', email: 'user@example.com' };

test('validates new password and confirmation before authentication', async () => {
  let signIns = 0;
  const auth = { signInWithPassword: async () => { signIns++; return {}; }, updateUser: async () => ({}) };
  await assert.rejects(changePassword(auth, user, 'current123', 'short', 'short'), /at least 8 characters/);
  await assert.rejects(changePassword(auth, user, 'current123', 'newpassword', 'differentpassword'), /do not match/);
  await assert.rejects(changePassword(auth, user, 'current123', 'current123', 'current123'), /different from your current/);
  assert.equal(signIns, 0);
});

test('rejects an incorrect current password without updating', async () => {
  let updates = 0;
  const auth = {
    signInWithPassword: async () => ({ data: { user: null }, error: { message: 'Invalid login credentials' } }),
    updateUser: async () => { updates++; return {}; },
  };
  await assert.rejects(changePassword(auth, user, 'wrongpass', 'newpassword', 'newpassword'), /Current password is incorrect/);
  assert.equal(updates, 0);
});

test('updates only the currently authenticated user after password verification', async () => {
  let updatedPassword;
  const auth = {
    signInWithPassword: async ({ email, password }) => ({ data: { user }, error: null, email, password }),
    updateUser: async ({ password }) => { updatedPassword = password; return { error: null }; },
  };
  await changePassword(auth, user, 'current123', 'newpassword', 'newpassword');
  assert.equal(updatedPassword, 'newpassword');
});

test('does not update if authentication resolves to another user', async () => {
  let updates = 0;
  const auth = {
    signInWithPassword: async () => ({ data: { user: { id: 'other-user' } }, error: null }),
    updateUser: async () => { updates++; return { error: null }; },
  };
  await assert.rejects(changePassword(auth, user, 'current123', 'newpassword', 'newpassword'), /does not match this account/);
  assert.equal(updates, 0);
});
