import webpush from 'npm:web-push@3.6.7';
import { clients, json, preflight } from '../_shared/http.ts';

const equalSecret = (left: string, right: string) => {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return mismatch === 0;
};

Deno.serve(async (req) => {
  const options = preflight(req);
  if (options) return options;
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const dispatchSecret = Deno.env.get('PUSH_DISPATCH_SECRET');
  const vapidPublicKey = Deno.env.get('PUSH_VAPID_PUBLIC_KEY');
  const vapidPrivateKey = Deno.env.get('PUSH_VAPID_PRIVATE_KEY');
  const vapidSubject = Deno.env.get('PUSH_VAPID_SUBJECT');
  if (!dispatchSecret || !vapidPublicKey || !vapidPrivateKey || !vapidSubject) return json({ error: 'Push service is not configured' }, 503);
  if (!equalSecret(req.headers.get('x-push-dispatch-secret') ?? '', dispatchSecret)) return json({ error: 'Unauthorized' }, 401);

  try {
    const body = await req.json();
    const notificationId = typeof body.notification_id === 'string' ? body.notification_id : '';
    if (!/^[0-9a-f-]{36}$/i.test(notificationId)) return json({ error: 'Invalid notification id' }, 400);
    const { admin } = clients();
    const { data: notice, error: noticeError } = await admin.from('notifications').select('user_id,title').eq('id', notificationId).maybeSingle();
    if (noticeError) throw noticeError;
    if (!notice) return json({ skipped: true });
    const { data: subscriptions, error: subscriptionsError } = await admin.from('push_subscriptions')
      .select('id,subscription').eq('user_id', notice.user_id).eq('active', true);
    if (subscriptionsError) throw subscriptionsError;

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
    const payload = JSON.stringify({ title: notice.title, body: 'You have a new Illiguide update. Open the app to view it.' });
    let sent = 0;
    let failed = 0;
    await Promise.all((subscriptions ?? []).map(async (row) => {
      try {
        await webpush.sendNotification(row.subscription, payload, { TTL: 60 });
        sent += 1;
        await admin.from('push_delivery_attempts').insert({ notification_id: notificationId, user_id: notice.user_id, subscription_id: row.id, status: 'accepted', provider_status: 201 });
      } catch (error) {
        failed += 1;
        const status = (error as { statusCode?: number }).statusCode;
        await admin.from('push_delivery_attempts').insert({ notification_id: notificationId, user_id: notice.user_id, subscription_id: row.id, status: status === 404 || status === 410 ? 'expired' : 'failed', provider_status: status ?? null });
        if (status === 404 || status === 410) {
          await admin.from('push_subscriptions').update({ active: false, updated_at: new Date().toISOString() }).eq('id', row.id);
        } else console.error('push delivery failed', status ?? 'unknown');
      }
    }));
    return json({ sent, failed });
  } catch (error) {
    console.error('dispatch-push', error instanceof Error ? error.message : error);
    return json({ error: 'Could not dispatch push notification' }, 500);
  }
});
