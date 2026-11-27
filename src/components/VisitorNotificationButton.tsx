import { useEffect, useRef, useState } from 'react';
import { Bell, RefreshCw } from 'lucide-react';
import { db } from '../lib/iliguide';
import './VisitorNotificationButton.css';

type Notice = { id: string; title: string; message: string; notification_type: string; created_at: string; read_at: string | null };

export function VisitorNotificationButton({ userId, configured, notify, onOpenBookings }: { userId: string; configured: boolean; notify: (message: string) => void; onOpenBookings: () => void }) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(configured);
  const [error, setError] = useState(false);
  const [liveError, setLiveError] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [reload, setReload] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const unread = notices.filter((notice) => !notice.read_at).length;

  useEffect(() => {
    if (!configured) { setNotices([]); setLoading(false); setError(false); setLiveError(false); return; }
    let active = true;
    setNotices([]); setLoading(true); setError(false); setLiveError(false);
    const load = async () => {
      try {
        const { data, error: queryError } = await db().from('notifications').select('id,title,message,notification_type,created_at,read_at')
          .eq('user_id', userId).order('created_at', { ascending: false }).limit(30);
        if (queryError) throw queryError;
        if (active) {
          setNotices((current) => [...(data ?? []) as Notice[], ...current]
            .filter((notice, index, all) => all.findIndex((item) => item.id === notice.id) === index)
            .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 30));
          setError(false);
        }
      } catch { if (active) setError(true); }
      finally { if (active) setLoading(false); }
    };
    void load();
    const channel = db().channel(`visitor-header-notifications-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, (payload) => {
        const notice = payload.new as Notice;
        if (!active) return;
        if (payload.eventType === 'INSERT') {
          setNotices((current) => [notice, ...current.filter((item) => item.id !== notice.id)].slice(0, 30));
          notify(notice.title);
        } else if (payload.eventType === 'UPDATE') setNotices((current) => current.map((item) => item.id === notice.id ? { ...item, read_at: notice.read_at } : item));
      }).subscribe((status) => {
        if (active) setLiveError(status === 'CHANNEL_ERROR' || status === 'TIMED_OUT');
      });
    const timer = window.setInterval(() => void load(), 60_000);
    window.addEventListener('focus', load);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', load); void db().removeChannel(channel); };
  }, [userId, configured, reload, notify]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => { document.removeEventListener('mousedown', closeOutside); document.removeEventListener('keydown', closeOnEscape); };
  }, [open]);

  const markRead = async (notice: Notice) => {
    if (notice.read_at) return;
    try {
      const { error: updateError } = await db().from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', userId).eq('id', notice.id).is('read_at', null);
      if (updateError) { notify('Could not mark notification as read.'); return; }
      setReload((value) => value + 1);
    } catch { notify('Could not mark notification as read.'); }
  };
  const markAllRead = async () => {
    if (markingAll || unread === 0) return;
    setMarkingAll(true);
    const readAt = new Date().toISOString();
    try {
      const { error: updateError } = await db().from('notifications').update({ read_at: readAt }).eq('user_id', userId).is('read_at', null);
      if (updateError) { notify('Could not mark notifications as read.'); return; }
      setReload((value) => value + 1);
    } catch { notify('Could not mark notifications as read.'); }
    finally { setMarkingAll(false); }
  };

  return <div className="visitor-notification-menu" ref={root}>
    <button type="button" className="profile-nav-btn notification-nav-btn" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open} aria-controls={open ? 'visitor-notification-panel' : undefined} onClick={() => setOpen((value) => !value)}>
      <span className="profile-nav-icon"><Bell size={18}/>{unread > 0 && <span className="notification-count">{unread > 9 ? '9+' : unread}</span>}</span>
    </button>
    {open && <section id="visitor-notification-panel" className="visitor-notification-panel" aria-label="Notifications">
      <header><span><b>Notifications</b><small>{unread ? `${unread} unread` : 'You’re all caught up'}</small></span><button type="button" disabled={markingAll || unread === 0} onClick={() => void markAllRead()}>{markingAll ? 'Marking…' : 'Mark all read'}</button></header>
      {loading && <p className="notification-panel-state" role="status">Loading notifications…</p>}
      {!loading && error && <p className="notification-panel-state" role="alert">Could not load notifications.<button type="button" onClick={() => setReload((value) => value + 1)}><RefreshCw size={14}/> Retry</button></p>}
      {!loading && liveError && <p className="notification-live-error" role="status">Live connection paused. Checking for updates every minute.<button type="button" onClick={() => setReload((value) => value + 1)}><RefreshCw size={13}/> Reconnect</button></p>}
      {!loading && !error && !notices.length && <p className="notification-panel-state">No notifications yet.</p>}
      {!loading && notices.length > 0 && <div className="visitor-notification-list">{notices.map((notice) => <button type="button" key={notice.id} className={notice.read_at ? 'visitor-notification-row' : 'visitor-notification-row unread'} onClick={() => { void markRead(notice); setOpen(false); if (notice.notification_type === 'review_request') onOpenBookings(); }}>
        <span><b>{notice.title}</b><small>{notice.message}</small><time>{new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(notice.created_at))}</time></span>{!notice.read_at && <i aria-label="Unread"/>}
      </button>)}</div>}
    </section>}
  </div>;
}
