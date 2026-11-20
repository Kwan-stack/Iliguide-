import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

type EmailEvent = 'confirmed' | 'payment_failed' | 'cancellation_requested' | 'cancellation_decided';

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

const templates: Record<EmailEvent, number> = {
  confirmed: 1,
  payment_failed: 2,
  cancellation_requested: 3,
  cancellation_decided: 4,
};

export async function sendTemplate(to: string, templateId: number, params: Record<string, string>) {
  const apiKey = Deno.env.get('BREVO_API_KEY');
  if (!apiKey) throw new Error('Brevo email is not configured');
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ to: [{ email: to }], templateId, params }),
  });
  if (!response.ok) throw new Error(`Brevo rejected email (HTTP ${response.status})`);
  const result = await response.json();
  return String(result.messageId ?? '');
}

export async function sendBookingEmail(admin: SupabaseClient, bookingId: string, event: EmailEvent, requestId?: string) {
  const { data: booking, error } = await admin.from('bookings')
    .select('id,booking_reference,visitor_name,visitor_email,visitor_count,total_amount,payment_status,booking_status,tourism_sites(name),site_slots(slot_date,starts_at)')
    .eq('id', bookingId).single();
  if (error || !booking) throw new Error(`Booking email data is unavailable: ${error?.message ?? 'missing row'}`);
  if (!booking.visitor_email) return { sent: false, reason: 'no_email' };
  if (event === 'confirmed' && (!['paid', 'not_required'].includes(booking.payment_status) || !['confirmed', 'completed'].includes(booking.booking_status))) return { sent: false, reason: 'not_confirmed' };
  if (event === 'payment_failed' && booking.payment_status !== 'failed') return { sent: false, reason: 'not_failed' };

  let eventKey: string = event;
  let decision = '';
  let note = '';
  if (event.startsWith('cancellation_')) {
    if (!requestId) return { sent: false, reason: 'missing_request' };
    const { data: request, error: requestError } = await admin.from('cancellation_requests')
      .select('id,booking_id,request_status,decision_note').eq('id', requestId).single();
    if (requestError || !request || request.booking_id !== bookingId) return { sent: false, reason: 'invalid_request' };
    if (event === 'cancellation_requested' && request.request_status !== 'pending') return { sent: false, reason: 'not_pending' };
    if (event === 'cancellation_decided' && !['approved', 'rejected'].includes(request.request_status)) return { sent: false, reason: 'not_decided' };
    eventKey = `${event}:${request.id}`;
    decision = request.request_status === 'approved' ? 'approved' : 'declined';
    note = request.decision_note || 'No additional note was provided.';
  }

  const templateId = templates[event];
  const { data: delivery, error: insertError } = await admin.from('email_deliveries')
    .insert({ booking_id: bookingId, event_key: eventKey, template_id: templateId }).select('id').single();
  if (insertError?.code === '23505') return { sent: false, reason: 'already_queued' };
  if (insertError || !delivery) throw new Error('Could not reserve email delivery');

  const site = Array.isArray(booking.tourism_sites) ? booking.tourism_sites[0] : booking.tourism_sites;
  const slot = Array.isArray(booking.site_slots) ? booking.site_slots[0] : booking.site_slots;
  const params = {
    name: escapeHtml(String(booking.visitor_name)),
    site: escapeHtml(String(site?.name ?? 'your destination')),
    reference: escapeHtml(String(booking.booking_reference)),
    date: slot?.slot_date ? new Intl.DateTimeFormat('en-PH', { dateStyle: 'long', timeZone: 'Asia/Manila' }).format(new Date(`${slot.slot_date}T12:00:00+08:00`)) : '',
    time: escapeHtml(String(slot?.starts_at ?? '').slice(0, 5)),
    visitors: String(booking.visitor_count),
    amount: `PHP ${Number(booking.total_amount).toFixed(2)}`,
    decision: escapeHtml(decision),
    note: escapeHtml(note),
  };
  try {
    const messageId = await sendTemplate(booking.visitor_email, templateId, params);
    const { error: updateError } = await admin.from('email_deliveries').update({ message_id: messageId, sent_at: new Date().toISOString() }).eq('id', delivery.id);
    if (updateError) throw new Error('Email sent but delivery status could not be saved');
    return { sent: true, messageId };
  } catch (sendError) {
    if (!(sendError instanceof Error && sendError.message.startsWith('Email sent but'))) {
      await admin.from('email_deliveries').delete().eq('id', delivery.id);
    }
    throw sendError;
  }
}
