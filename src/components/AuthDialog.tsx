import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Eye, EyeOff, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { completePasswordReset } from '../lib/changePassword';
import './AuthPages.css';

export type AuthMode = 'login' | 'signup' | 'forgot' | 'reset' | null;

type Props = {
  mode: AuthMode;
  onClose: () => void;
  onSuccess?: () => void;
  onMode: (mode: AuthMode) => void;
  initialVisitor: { name: string; email: string; phone: string };
  redirectTo: string;
  audience?: 'visitor' | 'staff';
  presentation?: 'dialog' | 'page';
};

export function AuthDialog({ mode, onClose, onSuccess = onClose, onMode, initialVisitor, redirectTo, audience = 'visitor', presentation = 'dialog' }: Props) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  useEffect(() => {
    setEmail((current) => current || initialVisitor.email);
    if (mode !== 'signup') setAwaitingConfirmation(false);
    if (mode === 'signup') {
      const [given = '', ...family] = initialVisitor.name.trim().split(/\s+/);
      setFirstName((current) => current || given);
      setLastName((current) => current || family.join(' '));
      setPhone((current) => current || initialVisitor.phone);
    }
  }, [initialVisitor, mode]);

  useEffect(() => {
    if (audience === 'staff' && mode === 'signup') onMode('login');
  }, [audience, mode, onMode]);

  if (!mode) return null;
  const title = mode === 'signup' && awaitingConfirmation ? 'Check your email.' : {
    login: 'Good to see you.',
    signup: 'Make it yours.',
    forgot: 'Reset your password.',
    reset: audience === 'staff' ? 'Set your staff password.' : 'Choose a new password.',
  }[mode];

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    if (mode === 'signup' && !awaitingConfirmation && password !== confirmPassword) {
      setError('Passwords do not match.');
      setBusy(false);
      return;
    }
    if (!supabase) {
      setError('Add the Supabase project URL and publishable key to .env.local first.');
      setBusy(false);
      return;
    }
    try {
      if (mode === 'login') {
        const { error: loginError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (loginError) throw loginError;
        onSuccess();
      } else if (mode === 'signup' && awaitingConfirmation) {
        const { error: resendError } = await supabase.auth.resend({
          type: 'signup', email: email.trim(), options: { emailRedirectTo: redirectTo },
        });
        if (resendError) throw resendError;
        setNotice('A new confirmation email has been sent.');
      } else if (mode === 'signup') {
        const { data, error: signupError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: redirectTo,
            data: {
              full_name: [firstName.trim(), lastName.trim()].filter(Boolean).join(' '),
              phone: phone.trim() || null,
              terms_accepted_at: new Date().toISOString(),
              terms_version: '2026-11-17',
            },
          },
        });
        if (signupError) throw signupError;
        if (data.session) onSuccess();
        else { setAwaitingConfirmation(true); setNotice('If this address is new, check your inbox for a confirmation link. If no email arrives, try logging in or resetting your password.'); }
      } else if (mode === 'forgot') {
        const resetRedirect = audience === 'staff'
          ? new URL('/staff/login', window.location.origin)
          : new URL(redirectTo);
        resetRedirect.searchParams.set('mode', 'reset');
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: resetRedirect.toString(),
        });
        if (resetError) throw resetError;
        setNotice('If an account uses that email, Supabase will send a password reset link.');
      } else {
        await completePasswordReset(supabase.auth, new URLSearchParams(window.location.search).get('code'), newPassword);
        const callbackUrl = new URL(window.location.href);
        if (callbackUrl.searchParams.has('code')) {
          callbackUrl.searchParams.delete('code');
          window.history.replaceState(window.history.state, '', callbackUrl.toString());
        }
        setNewPassword('');
        setPassword('');
        onSuccess();
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Authentication failed. Try again.';
      if (mode === 'login' && message === 'Invalid login credentials') {
        setPassword('');
        setShowPassword(false);
        setError('Email or password does not match. Use “Forgot password?” to set a new password.');
      } else setError(message);
    } finally {
      setBusy(false);
    }
  };

  const card = <section className={presentation === 'page' ? 'auth-page-card' : 'modal auth-modal'} role={presentation === 'dialog' ? 'dialog' : undefined} aria-modal={presentation === 'dialog' ? 'true' : undefined} aria-labelledby="auth-title">
      {presentation === 'dialog' && <button className="modal-close" onClick={onClose} aria-label="Close"><X size={18}/></button>}
      <span className="eyebrow"><span className="eyebrow-line"/> ILIGUIDE {audience === 'staff' ? 'STAFF ACCESS' : 'VISITOR ACCOUNT'}</span>
      <h2 id="auth-title">{title}</h2>
      <p>{mode === 'signup' && awaitingConfirmation
        ? `Check ${email} for a confirmation link. Open it, then return to this tab.`
        : mode === 'signup'
        ? 'Create a visitor account. Staff roles are granted by the Tourism Office.'
        : mode === 'login' ? audience === 'staff'
          ? 'Sign in with the account issued for your Tourism Office, site administrator, or gatekeeper role.'
          : 'Sign in to manage your visitor account, bookings, and tickets.'
        : mode === 'forgot' ? 'We will send a reset link to your email address.'
        : audience === 'staff' ? 'Choose a password to finish setting up your staff access.' : 'Set a new password for your account.'}</p>
      <form onSubmit={submit}>
        {mode === 'signup' && !awaitingConfirmation && <>
          <div className="auth-name-grid"><label><span>First name <span className="required-mark" aria-hidden="true">*</span></span><input required pattern=".*\S.*" autoComplete="given-name" value={firstName} onChange={(event) => setFirstName(event.target.value)} maxLength={60}/></label>
            <label><span>Last name <span className="required-mark" aria-hidden="true">*</span></span><input required pattern=".*\S.*" autoComplete="family-name" value={lastName} onChange={(event) => setLastName(event.target.value)} maxLength={60}/></label></div>
          <label>Phone <span className="field-optional">optional</span><input autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={40}/></label>
        </>}
        {mode !== 'reset' && <label><span>Email{mode === 'signup' && !awaitingConfirmation && <> <span className="required-mark" aria-hidden="true">*</span></>}</span><input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} readOnly={mode === 'signup' && awaitingConfirmation}/></label>}
        {mode === 'login' && <label>Password<span className="password-field"><input required type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)}/><button type="button" className="password-toggle" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={16}/> : <Eye size={16}/>}</button></span></label>}
        {mode === 'signup' && !awaitingConfirmation && <>
          <label><span>Password <span className="required-mark" aria-hidden="true">*</span></span><span className="password-field"><input required type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters"/><button type="button" className="password-toggle" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={16}/> : <Eye size={16}/>}</button></span></label>
          <label><span>Confirm password <span className="required-mark" aria-hidden="true">*</span></span><span className="password-field"><input required type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)}/><button type="button" className="password-toggle" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={16}/> : <Eye size={16}/>}</button></span></label>
          <div className="auth-policy-copy"><b>Reservation terms</b><p>Reservations record your selected destination and time. The fee shown is based on the destination’s published rates; no online payment is collected. Present the QR ticket at the destination for validation. Admission follows the destination’s current rules.</p><b>Privacy notice</b><p>Account details, reservation history, and notifications are stored to provide this service. Profile photos are optional. Pending selections and saved destinations stay in this browser. No payment details are collected.</p></div>
          <label className="auth-consent"><input required type="checkbox" checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)}/><span>I agree to the reservation terms and have read the privacy notice. <span className="required-mark" aria-hidden="true">*</span></span></label>
        </>}
        {mode === 'reset' && <label><span>New password <span className="required-mark" aria-hidden="true">*</span></span><span className="password-field"><input required type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="At least 8 characters"/><button type="button" className="password-toggle" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={16}/> : <Eye size={16}/>}</button></span></label>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {notice && <p className="form-success" role="status">{notice}</p>}
        <button className="btn btn-primary btn-wide" type="submit" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'login' ? 'Log in'
            : mode === 'signup' ? awaitingConfirmation ? 'Resend confirmation' : 'Create visitor account'
            : mode === 'forgot' ? 'Send reset link' : 'Update password'}
          {!busy && <ArrowRight size={16}/>}
        </button>
      </form>
      <div className="auth-switch">
        {mode === 'login' && <>
          <button onClick={() => onMode('forgot')}>Forgot password?</button>
          {audience === 'visitor' && <span>New here? <button onClick={() => onMode('signup')}>Create account</button></span>}
        </>}
        {mode === 'signup' && (awaitingConfirmation
          ? <><button type="button" onClick={() => { setAwaitingConfirmation(false); setNotice(''); setError(''); }}>Change details</button><span>Already have an account? <button type="button" onClick={() => onMode('login')}>Log in</button></span></>
          : <span>Already have an account? <button onClick={() => onMode('login')}>Log in</button></span>)}
        {mode === 'forgot' && <span>Remember your password? <button onClick={() => onMode('login')}>Log in</button></span>}
        {mode === 'reset' && <span><button onClick={() => onMode('login')}>Return to log in</button></span>}
      </div>
    </section>;

  if (presentation === 'page') return <section className={`auth-page auth-page-${audience}`}>
    <div className="auth-page-brand"><Link className="brand" to="/"><span className="brand-mark"><img src="/iliguide-logo.svg" alt=""/></span><span>Iliguide</span></Link>
      <p>{audience === 'staff' ? 'STAFF ACCESS' : 'VISITOR ACCOUNT'}</p></div>
    {card}
    <p className="auth-page-note">{audience === 'staff' ? 'Access follows your active role and destination assignment.' : 'Your visitor account keeps reservations and tickets together.'}</p>
  </section>;

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    {card}
  </div>;
}
