import { authenticatedUser, clients, json, preflight } from '../_shared/http.ts';

Deno.serve(async (req) => {
  const options = preflight(req);
  if (options) return options;
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  const publicKey = Deno.env.get('PUSH_VAPID_PUBLIC_KEY');
  if (!publicKey) return json({ error: 'Push notifications are not configured' }, 503);
  try {
    const { user } = clients(req);
    if (!await authenticatedUser(req, user)) return json({ error: 'Sign in to configure push notifications' }, 401);
    return json({ publicKey });
  } catch (error) {
    console.error('push-config', error instanceof Error ? error.message : error);
    return json({ error: 'Could not load push notification settings' }, 503);
  }
});
