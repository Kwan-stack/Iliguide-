import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/changePassword.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { changePassword, completePasswordReset } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const user = { id: 'current-user', email: 'user@example.com' };

test('exchanges a PKCE callback code before updating', async () => {
  let updatedPassword;
  let recoveryUser;
  const auth = {
    getSession: async () => ({ data: { session: null }, error: null }),
    exchangeCodeForSession: async (code) => ({ data: { session: { access_token: 'valid', user }, code }, error: null }),
    updateUser: async ({ password }) => { updatedPassword = password; return { error: null }; },
  };
  await completePasswordReset(auth, 'callback-code', 'newpassword', null, null, (userId) => { recoveryUser = userId; });
  assert.equal(recoveryUser, user.id);
  assert.equal(updatedPassword, 'newpassword');
});

test('verifies a recovery token hash before updating when no session exists yet', async () => {
  let verified;
  let updatedPassword;
  const auth = {
    getSession: async () => { throw new Error('must verify token hash first'); },
    verifyOtp: async (params) => { verified = params; return { data: { session: { access_token: 'valid', user } }, error: null }; },
    exchangeCodeForSession: async () => { throw new Error('should not exchange'); },
    updateUser: async ({ password }) => { updatedPassword = password; return { error: null }; },
  };
  await completePasswordReset(auth, null, 'newpassword', 'recovery-token-hash');
  assert.deepEqual(verified, { token_hash: 'recovery-token-hash', type: 'recovery' });
  assert.equal(updatedPassword, 'newpassword');
});

test('validates a fresh token hash even when a prior recovery session marker exists', async () => {
  let verified = false;
  const auth = {
    getSession: async () => { throw new Error('must validate the new link'); },
    verifyOtp: async () => { verified = true; return { data: { session: { access_token: 'valid', user } }, error: null }; },
    updateUser: async () => ({ error: null }),
  };
  await completePasswordReset(auth, null, 'newpassword', 'fresh-token', user.id);
  assert.equal(verified, true);
});

test('rejects an invalid recovery token hash without updating', async () => {
  let updates = 0;
  const auth = {
    getSession: async () => ({ data: { session: null }, error: null }),
    verifyOtp: async () => ({ data: { session: null }, error: new Error('otp_expired') }),
    exchangeCodeForSession: async () => { throw new Error('should not exchange'); },
    updateUser: async () => { updates++; return { error: null }; },
  };
  await assert.rejects(completePasswordReset(auth, null, 'newpassword', 'expired-token-hash'), /invalid or has expired/);
  assert.equal(updates, 0);
});

test('rejects a normal signed-in session without recovery proof', async () => {
  let updates = 0;
  const auth = {
    getSession: async () => ({ data: { session: { access_token: 'ordinary-session', user } }, error: null }),
    updateUser: async () => { updates++; return { error: null }; },
  };
  await assert.rejects(completePasswordReset(auth, null, 'newpassword'), /invalid or has expired/);
  assert.equal(updates, 0);
});

test('requires the marked recovery session to belong to the same user', async () => {
  let updates = 0;
  const auth = {
    getSession: async () => ({ data: { session: { access_token: 'session', user } }, error: null }),
    updateUser: async () => { updates++; return { error: null }; },
  };
  await assert.rejects(completePasswordReset(auth, null, 'newpassword', null, 'different-user'), /Could not verify this password reset link/);
  assert.equal(updates, 0);
});

test('uses a previously validated recovery session after refresh', async () => {
  let updatedPassword;
  const auth = {
    getSession: async () => ({ data: { session: { access_token: 'recovery-session', user } }, error: null }),
    updateUser: async ({ password }) => { updatedPassword = password; return { error: null }; },
  };
  await completePasswordReset(auth, null, 'newpassword', null, user.id);
  assert.equal(updatedPassword, 'newpassword');
});

test('rejects a short reset password before consuming the recovery token', async () => {
  let verifications = 0;
  const auth = {
    getSession: async () => ({ data: { session: null }, error: null }),
    verifyOtp: async () => { verifications++; return { data: { session: null }, error: null }; },
    updateUser: async () => ({ error: null }),
  };
  await assert.rejects(completePasswordReset(auth, null, 'shortpw', 'recovery-token-hash'), /at least 8 characters/);
  assert.equal(verifications, 0);
});

test('shows a friendly reset-link error when PKCE verification fails', async () => {
  let updates = 0;
  const auth = {
    getSession: async () => ({ data: { session: null }, error: null }),
    exchangeCodeForSession: async () => ({ data: { session: null }, error: new Error('PKCE code verifier not found in storage') }),
    updateUser: async () => { updates++; return { error: null }; },
  };
  await assert.rejects(
    completePasswordReset(auth, 'callback-code', 'newpassword'),
    { message: 'Could not verify this password reset link. Request a new link to continue.' },
  );
  assert.equal(updates, 0);
});

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
