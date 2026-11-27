import type { Session, SupabaseClient, User } from '@supabase/supabase-js';

type PasswordAuth = Pick<SupabaseClient['auth'], 'signInWithPassword' | 'updateUser'>;
type RecoveryAuth = Pick<SupabaseClient['auth'], 'getSession' | 'exchangeCodeForSession' | 'verifyOtp' | 'updateUser'>;

export async function completePasswordReset(
  auth: RecoveryAuth,
  code: string | null,
  newPassword: string,
  tokenHash: string | null = null,
  recoveryUserId: string | null = null,
  onRecoverySession?: (userId: string) => void,
): Promise<void> {
  if (newPassword.length < 8) throw new Error('New password must be at least 8 characters.');
  const invalidLink = 'This password reset link is invalid or has expired. Request a new link to continue.';
  let session: Session | null = null;
  if (tokenHash) {
    const result = await auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' });
    if (result.error) throw new Error(invalidLink);
    session = result.data.session;
  } else if (code) {
    const result = await auth.exchangeCodeForSession(code);
    if (result.error) throw new Error('Could not verify this password reset link. Request a new link to continue.');
    session = result.data.session;
  } else if (recoveryUserId) {
    const result = await auth.getSession();
    if (result.error || result.data.session?.user.id !== recoveryUserId) {
      throw new Error('Could not verify this password reset link. Request a new link to continue.');
    }
    session = result.data.session;
  } else {
    throw new Error(invalidLink);
  }
  if (!session?.user.id) throw new Error(invalidLink);
  onRecoverySession?.(session.user.id);
  const { error: updateError } = await auth.updateUser({ password: newPassword });
  if (updateError) throw updateError;
}

export async function changePassword(
  auth: PasswordAuth,
  user: Pick<User, 'id' | 'email'>,
  currentPassword: string,
  newPassword: string,
  confirmPassword: string,
): Promise<void> {
  if (!user.email) throw new Error('This account cannot change its password here.');
  if (!currentPassword) throw new Error('Enter your current password.');
  if (newPassword.length < 8) throw new Error('New password must be at least 8 characters.');
  if (newPassword !== confirmPassword) throw new Error('New passwords do not match.');
  if (newPassword === currentPassword) throw new Error('Choose a new password different from your current password.');

  const { data, error: verifyError } = await auth.signInWithPassword({ email: user.email, password: currentPassword });
  if (verifyError?.message === 'Invalid login credentials') throw new Error('Current password is incorrect.');
  if (verifyError) throw verifyError;
  if (data.user?.id !== user.id) throw new Error('Current password does not match this account.');

  const { error } = await auth.updateUser({ password: newPassword });
  if (error) throw error;
}
