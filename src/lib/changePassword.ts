import type { SupabaseClient, User } from '@supabase/supabase-js';

type PasswordAuth = Pick<SupabaseClient['auth'], 'signInWithPassword' | 'updateUser'>;
type RecoveryAuth = Pick<SupabaseClient['auth'], 'getSession' | 'exchangeCodeForSession' | 'updateUser'>;

export async function completePasswordReset(auth: RecoveryAuth, code: string | null, newPassword: string): Promise<void> {
  let { data: { session }, error } = await auth.getSession();
  if (error) throw error;
  if (!session && code) {
    const result = await auth.exchangeCodeForSession(code);
    if (result.error) throw result.error;
    session = result.data.session;
  }
  if (!session) throw new Error('Password reset session is missing. Request a new reset link and open it in the same browser.');
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
