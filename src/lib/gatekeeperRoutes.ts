export type GatekeeperPage =
  | 'Overview'
  | 'Reservations'
  | 'Visitor Management'
  | 'Scan and exit'
  | 'Walk-in registration'
  | 'Visitor Logbook'
  | 'Capacity map'
  | 'Duty details'
  | 'Reports'
  | 'Activity';

const pageBySection: Record<string, GatekeeperPage> = {
  dashboard: 'Overview',
  reservations: 'Reservations',
  visitors: 'Visitor Management',
  'check-in': 'Scan and exit',
  'walk-ins': 'Walk-in registration',
  logbook: 'Visitor Logbook',
  'capacity-map': 'Capacity map',
  duty: 'Duty details',
  reports: 'Reports',
  activity: 'Activity',
};

const sectionByPage = Object.fromEntries(
  Object.entries(pageBySection).map(([section, page]) => [page, section]),
) as Record<GatekeeperPage, string>;

export function parseGatekeeperRoute(pathname: string): { siteSlug: string; page: GatekeeperPage } | null {
  const match = pathname.match(/^\/gatekeeper\/([^/]+)(?:\/([^/]+))?\/?$/);
  if (!match) return null;
  const page = pageBySection[match[2] || 'dashboard'];
  return page ? { siteSlug: match[1], page } : null;
}

export function gatekeeperPath(siteSlug: string, page: GatekeeperPage): string {
  return `/gatekeeper/${encodeURIComponent(siteSlug)}/${sectionByPage[page]}`;
}

export function isGatekeeperPath(pathname: string): boolean {
  return pathname === '/gatekeeper' || pathname.startsWith('/gatekeeper/');
}
