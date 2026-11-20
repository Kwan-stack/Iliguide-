import { useState, type FormEvent } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { changePassword } from '../lib/changePassword';
import './ChangePasswordForm.css';

type Props = { user: User; notify: (message: string) => void };

export function ChangePasswordForm({ user, notify }: Props) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [busy, setBusy] = useState(false);

  const submitChangePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase) { notify('Supabase is not configured.'); return; }

    setBusy(true);
    try {
      await changePassword(supabase.auth, user, currentPassword, newPassword, confirmPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setShowPasswords(false);
      notify('Password changed.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not change password.');
    } finally { setBusy(false); }
  };

  return <div className="change-password-form">
    <p>Verify your current password. New passwords must be at least 8 characters.</p>
    <form onSubmit={(event) => void submitChangePassword(event)}>
      <label>Current password<input type={showPasswords ? 'text' : 'password'} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" required disabled={busy}/></label>
      <label>New password<input type={showPasswords ? 'text' : 'password'} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" minLength={8} required disabled={busy}/></label>
      <label>Confirm new password<input type={showPasswords ? 'text' : 'password'} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={8} required disabled={busy}/></label>
      <div className="change-password-actions"><button className="link-btn" type="button" aria-pressed={showPasswords} onClick={() => setShowPasswords((shown) => !shown)}>{showPasswords ? 'Hide passwords' : 'Show passwords'}</button>
        <button className="btn btn-primary" type="submit" disabled={busy || !currentPassword || !newPassword || !confirmPassword}>{busy ? 'Updating…' : 'Save changes'}</button></div>
    </form>
  </div>;
}
