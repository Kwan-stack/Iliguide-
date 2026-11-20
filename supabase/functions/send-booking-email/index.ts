import { sendBookingEmail } from '../_shared/email.ts';
import { authenticatedUser, clients, json, preflight } from '../_shared/http.ts';

Deno.serve(async (req) => {
  const options = preflight(req);
  if (options) return options;
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const body = await req.json();
    const reference = String(body.booking_reference ?? '').trim().toUpperCase();
    const event = String(body.event ?? '');
    const token = body.guest_access_token ? String(body.guest_access_token) : null;
    const requestId = body.request_id ? String(body.request_id) : undefined;
    if (!reference || !['confirmed', 'payment_failed', 'cancellation_requested', 'cancellation_decided'].includes(event)) {
      return json({ error: 'Invalid email request' }, 400);
    }
    const { admin, user } = clients(req);
    if (!await authenticatedUser(req, user)) return json({ error: 'Sign in to access this booking' }, 401);
    let bookingId: string;
    if (event === 'cancellation_decided') {
      if (!requestId) return json({ error: 'A cancellation request is required' }, 400);
      const { data: request, error: requestError } = await user.from('cancellation_requests')
        .select('id,booking_id').eq('id', requestId).single();
      if (requestError || !request) return json({ error: 'Cancellation access could not be verified' }, 403);
      const { data: booking, error: bookingError } = await admin.from('bookings')
        .select('id,booking_reference').eq('id', request.booking_id).single();
      if (bookingError || booking?.booking_reference !== reference) return json({ error: 'Booking access could not be verified' }, 403);
      bookingId = request.booking_id;
    } else {
      const { data, error } = await user.rpc('lookup_booking', { p_booking_reference: reference, p_guest_access_token: token });
      const booking = data?.[0];
      if (error || !booking) return json({ error: 'Booking access could not be verified' }, 403);
      bookingId = booking.booking_id;
    }
    const result = await sendBookingEmail(admin, bookingId, event as 'confirmed' | 'payment_failed' | 'cancellation_requested' | 'cancellation_decided', requestId);
    return json(result);
  } catch (error) {
    console.error('send-booking-email', error instanceof Error ? error.message : error);
    return json({ error: 'Could not send booking email' }, 502);
  }
});
