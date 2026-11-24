import { authenticatedUser, clients, constantTimeEqual, hmacSha256, json, preflight } from '../_shared/http.ts';

Deno.serve(async (req) => {
  const options = preflight(req);
  if (options) return options;
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const { user } = clients(req);
    const actor = await authenticatedUser(req, user);
    if (!actor) return json({ error: 'Staff sign-in is required' }, 401);
    const signingSecret = Deno.env.get('TICKET_SIGNING_SECRET');
    if (!signingSecret || signingSecret.length < 32) return json({ error: 'Ticket scanning is not configured' }, 503);

    const body = await req.json();
    const token = String(body.token ?? '');
    const siteId = String(body.site_id ?? '');
    const match = /^ILG1\.([0-9a-f-]{36})\.([0-9a-f]{64})$/i.exec(token);
    if (!match || !/^[0-9a-f-]{36}$/i.test(siteId)) return json({ error: 'Invalid ticket' }, 400);
    const expected = await hmacSha256(signingSecret, match[1].toLowerCase());
    if (!constantTimeEqual(match[2].toLowerCase(), expected)) return json({ error: 'Invalid ticket signature' }, 400);

    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    const hashHex = Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const device = { user_agent: (req.headers.get('user-agent') ?? '').slice(0, 240) };
    let data: unknown;
    let error: { message: string } | null;
    if (body.action !== undefined) {
      if (!['entry', 'exit'].includes(body.action) || !Number.isSafeInteger(body.visitor_count) || body.visitor_count < 1
          || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(body.idempotency_key ?? ''))
          || !Array.isArray(body.visitor_ids ?? []) || (body.visitor_ids ?? []).some((id: unknown) => typeof id !== 'string'
            || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) {
        return json({ error: 'Invalid attendance confirmation' }, 400);
      }
      const result = await user.rpc('confirm_ticket_attendance', {
        p_booking_id: match[1].toLowerCase(), p_token_hash: '\\x' + hashHex,
        p_site_id: siteId, p_action: body.action, p_visitor_count: body.visitor_count,
        p_idempotency_key: body.idempotency_key, p_device: device, p_visitor_ids: body.visitor_ids ?? [],
      });
      data = result.data;
      error = result.error;
    } else {
      const result = await user.rpc('scan_ticket', {
        p_booking_id: match[1].toLowerCase(), p_token_hash: '\\x' + hashHex,
        p_site_id: siteId, p_device: device,
      });
      data = result.data;
      error = result.error;
    }
    if (error) {
      console.error('scan authorization error', error.message);
      return json({ error: body.action === undefined ? 'This gatekeeper cannot scan tickets for that site' : error.message }, body.action === undefined ? 403 : 400);
    }
    return json({ result: Array.isArray(data) ? data[0] : data });
  } catch (error) {
    console.error('scan-ticket', error);
    return json({ error: 'Could not scan ticket' }, 500);
  }
});
