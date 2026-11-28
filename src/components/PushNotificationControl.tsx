import { useEffect, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { db } from '../lib/iliguide';
import { supabase } from '../lib/supabase';
import './PushNotificationControl.css';

function applicationServerKey(value: string) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

export async function deactivatePushSubscription(userId: string) {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration('/');
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  await db().from('push_subscriptions').update({ active: false, updated_at: new Date().toISOString() }).eq('user_id', userId).eq('endpoint', subscription.endpoint);
}

export function PushNotificationControl({ userId }: { userId: string }) {
  const [supported, setSupported] = useState(false);
  const [publicKey, setPublicKey] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    const sync = async () => {
      try {
        if (!supabase) { setSupported(false); return; }
        const { data: config, error } = await supabase.functions.invoke<{ publicKey: string }>('push-config');
        if (error || !config?.publicKey) { setSupported(false); return; }
        if (!active) return;
        setPublicKey(config.publicKey);
        const available = Boolean('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window);
        if (!active) return;
        setSupported(available);
        if (!available || Notification.permission !== 'granted') { setEnabled(false); return; }
        const registration = await navigator.serviceWorker.getRegistration('/');
        const subscription = await registration?.pushManager.getSubscription();
        if (!subscription) { if (active) setEnabled(false); return; }
        const { data } = await db().from('push_subscriptions').select('id').eq('user_id', userId).eq('endpoint', subscription.endpoint).eq('active', true).maybeSingle();
        if (active) setEnabled(Boolean(data));
      } catch { if (active) { setSupported(false); setEnabled(false); } }
    };
    void sync();
    return () => { active = false; };
  }, [userId]);

  const toggle = async () => {
    if (!supported || busy) return;
    setBusy(true); setMessage('');
    try {
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const { data } = await db().from('push_subscriptions').select('id').eq('user_id', userId).eq('endpoint', subscription.endpoint).eq('active', true).maybeSingle();
        if (data) {
          const { error } = await db().from('push_subscriptions').update({ active: false, updated_at: new Date().toISOString() }).eq('id', data.id);
          if (error) throw error;
          await subscription.unsubscribe();
          setEnabled(false);
          setMessage('Push notifications turned off for this device.');
        } else {
          const { error } = await db().from('push_subscriptions').upsert({ user_id: userId, endpoint: subscription.endpoint, subscription: subscription.toJSON(), active: true, updated_at: new Date().toISOString() }, { onConflict: 'user_id,endpoint' });
          if (error) throw error;
          setEnabled(true);
          setMessage('Push notifications enabled on this device.');
        }
      } else {
        if (Notification.permission !== 'granted') {
          const permission = await Notification.requestPermission();
          if (permission !== 'granted') { setMessage(permission === 'denied' ? 'Allow notifications in your browser settings to enable push.' : 'Notification permission was not granted.'); return; }
        }
        subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(publicKey!) });
        const { error } = await db().from('push_subscriptions').upsert({ user_id: userId, endpoint: subscription.endpoint, subscription: subscription.toJSON(), active: true, updated_at: new Date().toISOString() }, { onConflict: 'user_id,endpoint' });
        if (error) { await subscription.unsubscribe(); throw error; }
        setEnabled(true);
        setMessage('Push notifications enabled on this device.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not update push notifications.');
    } finally { setBusy(false); }
  };

  if (!supported) return null;
  return <div className="push-notification-control">
    <button type="button" className="push-notification-toggle" onClick={() => void toggle()} disabled={busy} aria-label={enabled ? 'Turn off push notifications' : 'Enable push notifications'} title={enabled ? 'Push notifications enabled' : 'Enable push notifications'}>
      {enabled ? <Bell size={16}/> : <BellOff size={16}/>}<span className="push-notification-label">{enabled ? 'Push on' : 'Enable push'}</span>
    </button>
    {message && <span role="status" className="push-notification-message">{message}</span>}
  </div>;
}
