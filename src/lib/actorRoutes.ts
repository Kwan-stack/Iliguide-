import type { GatekeeperPage } from './gatekeeperRoutes';

export type AccountRole = 'visitor' | 'gatekeeper' | 'site_admin' | 'tourism_office';
export type AppPage =
  | 'Landing' | 'Discover' | 'Destinations' | 'Destination' | 'Destination map' | 'How it works'
  | 'Bookings' | 'Tickets' | 'Account' | 'Booking' | 'Payment' | 'Booking confirmation'
  | 'Visitor login' | 'Staff login' | GatekeeperPage | 'Slots and closures' | 'Schedule & Operations'
  | 'Activity' | 'Staff and accounts' | 'Sites and staff' | 'Duty roster' | 'Payment verification' | 'Payment settings' | 'Feedback & Reviews';

const staffPages: AppPage[] = [
  'Overview', 'Reservations', 'Visitor Management', 'Scan and exit', 'Walk-in registration',
  'Visitor Logbook', 'Capacity map', 'Duty details', 'Reports', 'Activity',
  'Slots and closures', 'Schedule & Operations', 'Staff and accounts', 'Sites and staff', 'Duty roster', 'Payment verification', 'Payment settings', 'Feedback & Reviews', 'Change password',
];

export function staffPageForRole(role: AccountRole, page: AppPage): AppPage {
  if (role === 'visitor') return staffPages.includes(page) ? 'Discover' : page;
  if (role === 'gatekeeper') {
    return ['Overview', 'Reservations', 'Visitor Management', 'Scan and exit', 'Walk-in registration', 'Visitor Logbook', 'Capacity map', 'Duty details', 'Reports', 'Payment verification', 'Change password'].includes(page) ? page : 'Overview';
  }
  if (role === 'tourism_office' && page === 'Payment verification') return 'Overview';
  if (role === 'tourism_office' && ['Slots and closures', 'Duty roster'].includes(page)) return 'Schedule & Operations';
  if (!staffPages.includes(page)) return 'Overview';
  if (role === 'site_admin' && ['Sites and staff', 'Activity'].includes(page)) return 'Overview';
  if (['Scan and exit', 'Walk-in registration', 'Visitor Management', 'Duty details'].includes(page)) return 'Overview';
  return page;
}
