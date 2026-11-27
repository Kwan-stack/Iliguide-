import { createContext, useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { ArrowRight, Bell, Check, LogOut, Menu, ShieldCheck, X } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { gatekeeperPath } from '../lib/gatekeeperRoutes';
import { supabase } from '../lib/supabase';
import type { Profile } from '../lib/iliguide';
import './StaffWorkspaceShell.css';

type StaffRole = Extract<Profile['role'], 'tourism_office' | 'site_admin' | 'gatekeeper'>;
type Props = {
  role: StaffRole;
  homePath: string;
  userId: string;
  siteSlug?: string;
  toast: string;
  dataError: string;
  onRetry: () => void;
  onSignOut: () => void;
  children: ReactNode;
};

type Notice = { id: string; title: string; message: string; notification_type: string; created_at: string; read_at: string | null };
const gatekeeperNoticeTypes = ['reservation_received', 'payment_verification'];
export const OfficeMobileNavigation = createContext<{ open: boolean; setOpen: (open: boolean) => void }>({ open: false, setOpen: () => {} });
export const OfficeNotificationCounts = createContext<{ paymentVerificationUnread: number }>({ paymentVerificationUnread: 0 });

const roleLabel: Record<StaffRole, string> = {
  tourism_office: 'Tourism Office', site_admin: 'Site administrator', gatekeeper: 'Gatekeeper',
};

export function StaffWorkspaceShell({ role, homePath, userId, siteSlug, toast, dataError, onRetry, onSignOut, children }: Props) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [paymentVerificationUnread, setPaymentVerificationUnread] = useState(0);
  return <OfficeMobileNavigation.Provider value={{ open: mobileNavOpen, setOpen: setMobileNavOpen }}><OfficeNotificationCounts.Provider value={{ paymentVerificationUnread }}><div className={`office-app-shell office-app-${role}`}>
    <header className="office-app-topbar">
      <button type="button" className="office-app-menu" aria-label={mobileNavOpen ? 'Close navigation' : 'Open navigation'} aria-controls="staff-mobile-navigation" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen((open) => !open)}>{mobileNavOpen ? <X size={19}/> : <Menu size={19}/>}</button>
      <Link className="office-app-brand" to={homePath} aria-label="Iliguide staff workspace">
        <span className="office-app-brand-lockup"><img src="/iliguide-staff-logo.png" alt="Iliguide"/><small>OFFICE WORKSPACE</small></span>
      </Link>
      <div className="office-app-actions">
        {role === 'gatekeeper' && siteSlug && <GatekeeperNotifications userId={userId} siteSlug={siteSlug} setPaymentVerificationUnread={setPaymentVerificationUnread}/>}
        <span className="office-app-role" aria-label={roleLabel[role]} title={roleLabel[role]}><ShieldCheck size={15}/>{roleLabel[role]}</span>
        <button className="office-app-signout" aria-label="Log out" title="Log out" onClick={onSignOut}><LogOut size={15}/><span>Log out</span></button>
      </div>
    </header>
    {dataError && <div className="office-app-error" role="status"><ShieldCheck size={16}/><span>{dataError}</span><button onClick={onRetry}>Retry</button></div>}
    <main className="office-app-main">{children}</main>
    {toast && <div className="toast" role="status"><Check size={16}/>{toast}</div>}
  </div></OfficeNotificationCounts.Provider></OfficeMobileNavigation.Provider>;
}

function GatekeeperNotifications({ userId, siteSlug, setPaymentVerificationUnread }: { userId: string; siteSlug: string; setPaymentVerificationUnread: Dispatch<SetStateAction<number>> }) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    const client = supabase;
    if (!client) return;
    const channel = client.channel(`gatekeeper-notifications-${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, ({ new: row }) => {
        if (!active) return;
        const notice = row as Notice;
        if (!gatekeeperNoticeTypes.includes(notice.notification_type)) return;
        setNotices((current) => [notice, ...current.filter((item) => item.id !== notice.id)].slice(0, 10));
        setUnread((current) => current + 1);
        if (notice.notification_type === 'payment_verification') setPaymentVerificationUnread((current) => current + 1);
      }).subscribe();
    void Promise.all([
      client.from('notifications').select('id,title,message,notification_type,created_at,read_at').eq('user_id', userId).in('notification_type', gatekeeperNoticeTypes).order('created_at', { ascending: false }).limit(10),
      client.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', userId).in('notification_type', gatekeeperNoticeTypes).is('read_at', null),
      client.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('notification_type', 'payment_verification').is('read_at', null),
    ]).then(([list, count, paymentCount]) => {
      if (!active) return;
      if (list.error || count.error || paymentCount.error) { setError('Notifications could not load.'); return; }
      setError('');
      const rows = (list.data ?? []) as Notice[];
      setNotices((current) => [...rows, ...current.filter((item) => !rows.some((row) => row.id === item.id))].slice(0, 10));
      setUnread((current) => Math.max(current, count.count ?? 0));
      setPaymentVerificationUnread((current) => Math.max(current, paymentCount.count ?? 0));
    });
    return () => { active = false; void client.removeChannel(channel); };
  }, [userId, setPaymentVerificationUnread]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, [open]);

  const openNotice = (notice: Notice) => {
    if (!notice.read_at && supabase) {
      const readAt = new Date().toISOString();
      setNotices((current) => current.map((item) => item.id === notice.id ? { ...item, read_at: readAt } : item));
      setUnread((current) => Math.max(0, current - 1));
      if (notice.notification_type === 'payment_verification') setPaymentVerificationUnread((current) => Math.max(0, current - 1));
      void supabase.from('notifications').update({ read_at: readAt }).eq('id', notice.id).eq('user_id', userId)
        .then(({ error: updateError }) => { if (updateError) setError('Could not mark notification as read.'); });
    }
    setOpen(false);
    navigate(gatekeeperPath(siteSlug, notice.notification_type === 'payment_verification' ? 'Payment verification' : 'Reservations'));
  };

  return <div className="office-notifications" ref={root}>
    <button type="button" className="office-notifications-trigger" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open} aria-controls="office-notifications-panel" onClick={() => setOpen((value) => !value)}>
      <Bell size={18}/>{unread > 0 && <span className="office-notifications-count">{unread > 99 ? '99+' : unread}</span>}
    </button>
    {open && <section className="office-notifications-panel" id="office-notifications-panel" aria-label="Notifications" aria-live="polite">
      <header><div><b>Notifications</b><small>{unread} unread</small></div><button type="button" aria-label="Close notifications" onClick={() => setOpen(false)}><X size={16}/></button></header>
      {error && <p className="office-notifications-error" role="status">{error}</p>}
      {!notices.length ? <p className="office-notifications-empty">No notifications yet.</p> : <ul>{notices.map((notice) => <li key={notice.id}>
        <button type="button" className={notice.read_at ? 'is-read' : ''} onClick={() => openNotice(notice)}>
          <span className="office-notifications-item-title"><b>{notice.title}</b>{!notice.read_at && <i aria-label="Unread"/>}</span>
          <span>{notice.message}</span>
          <time dateTime={notice.created_at}>{new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' }).format(new Date(notice.created_at))}</time>
        </button>
      </li>)}</ul>}
      <Link to={gatekeeperPath(siteSlug, 'Reservations')} onClick={() => setOpen(false)}>View reservations <ArrowRight size={14}/></Link>
    </section>}
  </div>;
}
