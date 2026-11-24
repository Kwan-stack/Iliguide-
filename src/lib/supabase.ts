import { createClient } from '@supabase/supabase-js';

const RECOVERY_USER_KEY = 'iliguide.auth.recovery-user-id';

export function getPasswordRecoveryUserId(): string | null {
  try { return typeof window === 'undefined' ? null : window.sessionStorage.getItem(RECOVERY_USER_KEY); }
  catch { return null; }
}

export function rememberPasswordRecoveryUser(userId: string): void {
  try { if (typeof window !== 'undefined') window.sessionStorage.setItem(RECOVERY_USER_KEY, userId); }
  catch { /* session storage may be unavailable */ }
}

export function clearPasswordRecoveryUser(): void {
  try { if (typeof window !== 'undefined') window.sessionStorage.removeItem(RECOVERY_USER_KEY); }
  catch { /* session storage may be unavailable */ }
}

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const publishableKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined;
export const supabaseConfigured = Boolean(url && publishableKey);
export const supabase = supabaseConfigured ? createClient(url!, publishableKey!, {
  auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true, flowType: 'pkce' },
}) : null;

supabase?.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY' && session?.user.id) rememberPasswordRecoveryUser(session.user.id);
  if (event === 'SIGNED_OUT') clearPasswordRecoveryUser();
});
