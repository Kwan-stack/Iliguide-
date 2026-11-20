import type { AppPage } from './actorRoutes';
import { isGatekeeperPath, parseGatekeeperRoute } from './gatekeeperRoutes';

export const VISITOR_LOGIN_PATH = '/login';
export const STAFF_LOGIN_PATH = '/staff/login';

export const workspaceRoutePaths: Partial<Record<AppPage, string>> = {
  Overview: '/workspace', Reservations: '/workspace/reservations',
  'Visitor Management': '/workspace/visitors', 'Visitor Logbook': '/workspace/visitor-logbook',
  'Scan and exit': '/workspace/scan', 'Walk-in registration': '/workspace/walk-ins',
  'Capacity map': '/workspace/capacity', 'Duty details': '/workspace/duty',
  Reports: '/workspace/reports', Activity: '/workspace/activity',
  'Slots and closures': '/workspace/schedule', 'Staff and accounts': '/workspace/team',
  'Sites and staff': '/workspace/sites', 'Duty roster': '/workspace/duty-roster',
};

export const visitorRoutePaths: Partial<Record<AppPage, string>> = {
  Landing: '/', Discover: '/discover', Destinations: '/destinations', 'Destination map': '/map',
  'How it works': '/how-it-works', Bookings: '/bookings', Tickets: '/tickets', Account: '/account',
  'Visitor login': VISITOR_LOGIN_PATH, 'Staff login': STAFF_LOGIN_PATH,
};

export function pageFromPath(pathname: string): AppPage {
  const gatekeeper = parseGatekeeperRoute(pathname);
  if (gatekeeper) return gatekeeper.page;
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === VISITOR_LOGIN_PATH) return 'Visitor login';
  if (path === STAFF_LOGIN_PATH) return 'Staff login';
  if (path === '/destinations') return 'Destinations';
  if (path.startsWith('/gatekeeper/')) return 'Overview';
  const workspace = Object.entries(workspaceRoutePaths).find(([, value]) => value === path)?.[0] as AppPage | undefined;
  if (workspace) return workspace;
  if (path.startsWith('/workspace/')) return 'Overview';
  if (path.startsWith('/destinations/')) return 'Destination';
  return (Object.entries(visitorRoutePaths).find(([, value]) => value === path)?.[0] as AppPage | undefined) ?? 'Landing';
}

export function destinationSlugFromPath(pathname: string): string {
  const match = pathname.match(/^\/destinations\/([^/]+)\/?$/);
  if (!match) return '';
  try { return decodeURIComponent(match[1]); } catch { return ''; }
}

export function isWorkspacePath(pathname: string): boolean {
  return pathname === '/workspace' || pathname.startsWith('/workspace/');
}

export function isAuthPath(pathname: string): boolean {
  return pathname === VISITOR_LOGIN_PATH || pathname === STAFF_LOGIN_PATH;
}

export function canShowVisitorAuthModal(pathname: string): boolean {
  return pathname !== STAFF_LOGIN_PATH && !isWorkspacePath(pathname) && !isGatekeeperPath(pathname);
}

export function isKnownAppPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  return path === '/'
    || isAuthPath(path)
    || path === '/destinations'
    || Boolean(destinationSlugFromPath(path))
    || Object.values(workspaceRoutePaths).includes(path)
    || path.startsWith('/workspace/')
    || Object.values(visitorRoutePaths).includes(path)
    || isGatekeeperPath(path);
}

function safeInternalPath(candidate: string | null | undefined): string {
  if (!candidate || !candidate.startsWith('/') || candidate.startsWith('//')) return '';
  try {
    const parsed = new URL(candidate, 'https://iliguide.invalid');
    return parsed.origin === 'https://iliguide.invalid' ? parsed.pathname : '';
  } catch { return ''; }
}

export function visitorReturnPath(candidate: string | null | undefined): string {
  const path = safeInternalPath(candidate);
  if (path === '/' || path === '/discover' || path === '/destinations' || ['/map', '/how-it-works', '/bookings', '/tickets', '/account'].includes(path)) return path;
  return destinationSlugFromPath(path) ? path : '/';
}

export function visitorAuthDismissPath(candidate: string | null | undefined): string {
  if (candidate == null) return '/discover';
  const path = safeInternalPath(candidate);
  if (!path) return '/discover';
  if (path === '/') return '/';
  const returnPath = visitorReturnPath(path);
  return returnPath === '/' ? '/discover' : returnPath;
}

export function staffReturnPath(candidate: string | null | undefined): string {
  const path = safeInternalPath(candidate);
  if (path === '/gatekeeper/access' || parseGatekeeperRoute(path)) return path;
  if (isWorkspacePath(path)) return path;
  return '';
}

export function authSuccessPath(audience: 'visitor' | 'staff', candidate?: string | null): string {
  return audience === 'staff'
    ? staffReturnPath(candidate) || '/workspace'
    : candidate == null ? '/discover' : visitorReturnPath(candidate);
}

export function visitorLoginUrl(returnTo?: string): string {
  if (returnTo == null) return VISITOR_LOGIN_PATH;
  const next = visitorReturnPath(returnTo);
  return `${VISITOR_LOGIN_PATH}?next=${encodeURIComponent(next)}`;
}

export function staffLoginUrl(returnTo?: string): string {
  const next = staffReturnPath(returnTo);
  return next ? `${STAFF_LOGIN_PATH}?next=${encodeURIComponent(next)}` : STAFF_LOGIN_PATH;
}
