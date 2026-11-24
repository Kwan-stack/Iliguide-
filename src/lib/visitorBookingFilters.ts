import type { Booking } from './iliguide';

export type BookingTab = 'all' | 'upcoming' | 'pending' | 'completed' | 'cancelled';
type BookingFilter = { tab: BookingTab; query: string; dateFrom: string; dateTo?: string; sortOrder: 'newest' | 'oldest'; today: string };

export function matchesBookingTab(booking: Booking, tab: BookingTab, today: string): boolean {
  if (tab === 'all') return true;
  if (tab === 'upcoming') return booking.booking_status === 'confirmed' && booking.slot_date >= today;
  if (tab === 'pending') return ['awaiting_payment', 'needs_resolution'].includes(booking.booking_status);
  if (tab === 'completed') return booking.booking_status === 'completed';
  return ['cancelled', 'expired'].includes(booking.booking_status);
}

export function filterVisitorBookings(bookings: Booking[], filter: BookingFilter): Booking[] {
  const query = filter.query.trim().toLowerCase();
  return bookings.filter((booking) => matchesBookingTab(booking, filter.tab, filter.today)
    && (!query || (booking.site_name + ' ' + booking.booking_reference).toLowerCase().includes(query))
    && (!filter.dateFrom || booking.slot_date >= filter.dateFrom)
    && (!filter.dateTo || booking.slot_date <= filter.dateTo))
    .sort((a, b) => (filter.sortOrder === 'newest' ? -1 : 1) * ((Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0)));
}
