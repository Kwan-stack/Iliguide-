import type { NavigateFunction } from 'react-router-dom';
import type { AccountRole } from './actorRoutes';
import { staffPortalPath } from './appRoutes';
import { gatekeeperPath } from './gatekeeperRoutes';

export type HistoryStateLike = { idx?: unknown } | null | undefined;

/**
 * Returns true only when the browser has an internal SPA history entry
 * created within this app session (React Router stores a numeric `idx` > 0).
 * Prevents fresh tabs, bookmarked links, or QR-code landings from getting
 * trapped or exiting the application when invoking a standalone back/close action.
 */
export function hasInternalNavigationHistory(
  historyState?: HistoryStateLike,
  historyLength?: number,
): boolean {
  const state = historyState !== undefined
    ? historyState
    : (typeof window !== 'undefined' ? (window.history.state as HistoryStateLike) : null);
  if (state && typeof state === 'object' && typeof state.idx === 'number') {
    return state.idx > 0;
  }
  const length = historyLength !== undefined
    ? historyLength
    : (typeof window !== 'undefined' ? window.history.length : 0);
  if (typeof document !== 'undefined' && typeof window !== 'undefined' && document.referrer) {
    try {
      return length > 1 && new URL(document.referrer).origin === window.location.origin;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Resolves a safe home route for a standalone page close/back fallback.
 * Signed-in accounts fall back to their role's home route; signed-out visitors fall back to `/`.
 */
export function resolveSafeHomePath(
  role?: AccountRole | null,
  gatekeeperSiteSlug?: string | null,
  signedOutFallback = '/',
): string {
  if (!role) return signedOutFallback;
  if (role === 'visitor') return '/discover';
  if (role === 'gatekeeper') {
    return gatekeeperSiteSlug ? gatekeeperPath(gatekeeperSiteSlug, 'Overview') : '/gatekeeper/access';
  }
  return staffPortalPath(role, 'Overview');
}

/**
 * Safely exits a standalone full-page flow (such as `/staff/login` or password recovery):
 * navigates back ONLY if internal SPA navigation history exists; otherwise replaces with `fallbackPath`.
 * Never use this for modals/dialogs/drawers — overlays must strictly call their own `onClose` handler.
 */
export function safeNavigateBack(
  navigate: NavigateFunction,
  fallbackPath = '/',
  historyState?: HistoryStateLike,
): void {
  if (hasInternalNavigationHistory(historyState)) {
    navigate(-1);
    return;
  }
  navigate(fallbackPath, { replace: true });
}
