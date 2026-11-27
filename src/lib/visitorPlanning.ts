import type { Booking } from './iliguide';

const inactiveBookings = new Set(['cancelled', 'expired', 'completed']);

export function upcomingBookings(bookings: Booking[], today: string, nowTime: string): Booking[] {
  const now = new Date(`${today}T${nowTime}:00+08:00`).getTime();
  return bookings
    .filter((booking) => booking.slot_date >= today && !inactiveBookings.has(booking.booking_status)
      && (booking.booking_status !== 'awaiting_payment' || !booking.hold_expires_at || Date.parse(booking.hold_expires_at) > now)
      && (booking.slot_date > today || !booking.ends_at || booking.ends_at.slice(0, 5) > nowTime))
    .sort((a, b) => a.slot_date.localeCompare(b.slot_date) || (a.starts_at ?? '').localeCompare(b.starts_at ?? ''));
}

export function nextUpcomingBooking(bookings: Booking[], today: string, nowTime: string): Booking | null {
  return upcomingBookings(bookings, today, nowTime)[0] ?? null;
}

export function canIssueVisitorTicket(booking: Booking): boolean {
  return ['paid', 'not_required'].includes(booking.payment_status)
    && booking.booking_status === 'confirmed';
}
