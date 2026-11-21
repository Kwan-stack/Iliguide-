import type { GatekeeperPage } from './gatekeeperRoutes';

export type AccountRole = 'visitor' | 'gatekeeper' | 'site_admin' | 'tourism_office';
export type AppPage =
  | 'Landing' | 'Discover' | 'Destinations' | 'Destination' | 'Destination map' | 'How it works'
  | 'Bookings' | 'Tickets' | 'Account' | 'Visitor login' | 'Staff login' | GatekeeperPage | 'Slots and closures'
  | 'Activity' | 'Staff and accounts' | 'Sites and staff' | 'Duty roster';

const staffPages: AppPage[] = [
  'Overview', 'Reservations', 'Visitor Management', 'Scan and exit', 'Walk-in registration',
  'Visitor Logbook', 'Capacity map', 'Duty details', 'Reports', 'Activity',
  'Slots and closures', 'Staff and accounts', 'Sites and staff', 'Duty roster', 'Change password',
];

export function staffPageForRole(role: AccountRole, page: AppPage): AppPage {
  if (role === 'visitor') return staffPages.includes(page) ? 'Discover' : page;
  if (role === 'gatekeeper') {
    return ['Overview', 'Reservations', 'Visitor Management', 'Scan and exit', 'Walk-in registration', 'Visitor Logbook', 'Capacity map', 'Duty details', 'Reports', 'Change password'].includes(page) ? page : 'Overview';
  }
  if (!staffPages.includes(page)) return 'Overview';
  if (role === 'site_admin' && ['Sites and staff', 'Activity'].includes(page)) return 'Overview';
  if (['Scan and exit', 'Walk-in registration', 'Visitor Management', 'Duty details'].includes(page)) return 'Overview';
  return page;
}
