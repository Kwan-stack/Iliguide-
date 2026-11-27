import { createContext, useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { ArrowRight, Bell, Check, LogOut, Menu, ShieldCheck, X } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { gatekeeperPath } from '../lib/gatekeeperRoutes';
import { supabase } from '../lib/supabase';
import { loadMyActiveGatekeeperDuty, pendingManualPaymentQuery, type Profile } from '../lib/iliguide';
import './StaffWorkspaceShell.css';

type StaffRole = Extract<Profile['role'], 'tourism_office' | 'site_admin' | 'gatekeeper'>;
type Props = {
  role: StaffRole;
  homePath: string;
  userId: string;
  siteSlug?: string;
  siteId?: string;
  toast: string;
  dataError: string;
  onRetry: () => void;
  onSignOut: () => void;
  children: ReactNode;
};

type Notice = { id: string; booking_id: string | null; title: string; message: string; notification_type: string; created_at: string; read_at: string | null };
const gatekeeperNoticeTypes = ['reservation_received', 'payment_verification'];
export const OfficeMobileNavigation = createContext<{ open: boolean; setOpen: (open: boolean) => void }>({ open: false, setOpen: () => {} });
export const OfficeNotificationCounts = createContext<{ paymentVerificationPending: number }>({ paymentVerificationPending: 0 });

const roleLabel: Record<StaffRole, string> = {
  tourism_office: 'Tourism Office', site_admin: 'Site administrator', gatekeeper: 'Gatekeeper',
};

export function StaffWorkspaceShell({ role, homePath, userId, siteSlug, siteId, toast, dataError, onRetry, onSignOut, children }: Props) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [paymentVerificationPending, setPaymentVerificationPending] = useState(0);
  useEffect(() => { if (role !== 'gatekeeper' || !siteId || !siteSlug) setPaymentVerificationPending(0); }, [role, siteId, siteSlug]);
  return <OfficeMobileNavigation.Provider value={{ open: mobileNavOpen, setOpen: setMobileNavOpen }}><OfficeNotificationCounts.Provider value={{ paymentVerificationPending }}><div className={`office-app-shell office-app-${role}`}>
    <header className="office-app-topbar">
      <button type="button" className="office-app-menu" aria-label={mobileNavOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen((open) => !open)}>{mobileNavOpen ? <X size={19}/> : <Menu size={19}/>}</button>
      <Link className="office-app-brand" to={homePath} aria-label="Iliguide staff workspace">
        <span className="office-app-brand-lockup"><img src="/iliguide-staff-logo.png" alt="Iliguide"/><small>OFFICE WORKSPACE</small></span>
      </Link>
      <div className="office-app-actions">
        {role === 'gatekeeper' && siteSlug && siteId && <GatekeeperNotifications userId={userId} siteId={siteId} siteSlug={siteSlug} setPaymentVerificationPending={setPaymentVerificationPending}/>}
        <span className="office-app-role" aria-label={roleLabel[role]} title={roleLabel[role]}><ShieldCheck size={15}/>{roleLabel[role]}</span>
        <button className="office-app-signout" aria-label="Log out" title="Log out" onClick={onSignOut}><LogOut size={15}/><span>Log out</span></button>
      </div>
    </header>
    {dataError && <div className="office-app-error" role="status"><ShieldCheck size={16}/><span>{dataError}</span><button onClick={onRetry}>Retry</button></div>}
    <main className="office-app-main">{children}</main>
    {toast && <div className="toast" role="status"><Check size={16}/>{toast}</div>}
  </div></OfficeNotificationCounts.Provider></OfficeMobileNavigation.Provider>;
}

function GatekeeperNotifications({ userId, siteId, siteSlug, setPaymentVerificationPending }: { userId: string; siteId: string; siteSlug: string; setPaymentVerificationPending: Dispatch<SetStateAction<number>> }) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    const client = supabase;
    if (!client) return;
    setNotices([]); setUnread(0); setPaymentVerificationPending(0); setError('');
    let channel: ReturnType<typeof client.channel> | null = null;
    let timer = 0;
    let refreshTimer = 0;
    let refreshing = false;
    let refreshAgain = false;
    const clearOperational = async () => {
      if (active) { setNotices([]); setUnread(0); setPaymentVerificationPending(0); }
      if (channel) { await client.removeChannel(channel); channel = null; }
    };
    const refresh = async () => {
      if (refreshing) { refreshAgain = true; return; }
      refreshing = true;
      do {
        refreshAgain = false;
        try {
          const duty = await loadMyActiveGatekeeperDuty(siteId);
          if (!active) return;
          if (!duty || !['on_duty', 'active'].includes(duty.effective_status)) {
            await clearOperational();
            setError('');
            continue;
          }
          const [list, count, payments] = await Promise.all([
            client.from('notifications').select('id,booking_id,title,message,notification_type,created_at,read_at').eq('user_id', userId).in('notification_type', gatekeeperNoticeTypes).order('created_at', { ascending: false }).limit(50),
            client.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', userId).in('notification_type', gatekeeperNoticeTypes).is('read_at', null),
            pendingManualPaymentQuery('id,booking:bookings!payments_booking_id_fkey!inner(site_id,booking_status)', siteId, true),
          ]);
          if (!active) return;
          if (list.error || count.error || payments.error) throw list.error ?? count.error ?? payments.error;
          setNotices(((list.data ?? []) as Notice[]).slice(0, 10));
          setUnread(count.count ?? 0);
          setPaymentVerificationPending(payments.count ?? payments.data?.length ?? 0);
          setError('');
          if (!channel) {
            const refreshLater = () => {
              if (refreshTimer) return;
              refreshTimer = window.setTimeout(() => { refreshTimer = 0; void refresh(); }, 200);
            };
            channel = client.channel(`gatekeeper-work-${userId}-${siteId}`)
              .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, refreshLater)
              .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, refreshLater)
              .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: `site_id=eq.${siteId}` }, refreshLater)
              .on('postgres_changes', { event: '*', schema: 'public', table: 'site_gatekeeper_duties', filter: `primary_gatekeeper_id=eq.${userId}` }, refreshLater)
              .on('postgres_changes', { event: '*', schema: 'public', table: 'site_gatekeeper_duty_support', filter: `gatekeeper_id=eq.${userId}` }, refreshLater)
              .subscribe();
          }
        } catch {
          if (active) setError('Notifications could not load.');
          await clearOperational();
        }
      } while (active && refreshAgain);
      refreshing = false;
    };
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const onOnline = () => void refresh();
    void refresh();
    timer = window.setInterval(() => void refresh(), 15000);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    return () => { active = false; window.clearInterval(timer); window.clearTimeout(refreshTimer); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('online', onOnline); if (channel) void client.removeChannel(channel); setPaymentVerificationPending(0); };
  }, [siteId, userId, refreshVersion, setPaymentVerificationPending]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, [open]);

  const openNotice = async (notice: Notice) => {
    if (!supabase) return;
    try {
      const duty = await loadMyActiveGatekeeperDuty(siteId);
      if (!duty || !['on_duty', 'active'].includes(duty.effective_status)) {
        setNotices([]); setUnread(0); setPaymentVerificationPending(0); setError('This duty shift is no longer active.');
        return;
      }
      if (!notice.read_at) {
        const readAt = new Date().toISOString();
        const { data, error: updateError } = await supabase.from('notifications').update({ read_at: readAt }).eq('id', notice.id).eq('user_id', userId).is('read_at', null).select('id').maybeSingle();
        if (updateError) throw updateError;
        if (!data) setRefreshVersion((value) => value + 1);
        else { setNotices((current) => current.map((item) => item.id === notice.id ? { ...item, read_at: readAt } : item)); setUnread((current) => Math.max(0, current - 1)); }
      }
      setOpen(false);
      navigate(gatekeeperPath(siteSlug, notice.notification_type === 'payment_verification' ? 'Payment verification' : 'Reservations'));
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not open this notification.'); }
  };

  const markAllRead = async () => {
    if (!supabase || busy || unread === 0) return;
    setBusy(true); setError('');
    try {
      const duty = await loadMyActiveGatekeeperDuty(siteId);
      if (!duty || !['on_duty', 'active'].includes(duty.effective_status)) throw new Error('This duty shift is no longer active.');
      const { error: updateError } = await supabase.from('notifications').update({ read_at: new Date().toISOString() })
        .eq('user_id', userId).in('notification_type', gatekeeperNoticeTypes).is('read_at', null);
      if (updateError) throw updateError;
      setRefreshVersion((value) => value + 1);
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not mark notifications as read.'); }
    finally { setBusy(false); }
  };

  return <div className="office-notifications" ref={root}>
    <button type="button" className="office-notifications-trigger" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open} aria-controls="office-notifications-panel" onClick={() => setOpen((value) => !value)}>
      <Bell size={18}/>{unread > 0 && <span className="office-notifications-count">{unread > 99 ? '99+' : unread}</span>}
    </button>
    {open && <section className="office-notifications-panel" id="office-notifications-panel" aria-label="Notifications" aria-live="polite">
      <header><div><b>Notifications</b><small>{unread} unread</small></div><div className="office-notifications-header-actions"><button type="button" className="office-notifications-mark-read" disabled={busy || unread === 0} onClick={() => void markAllRead()}>{busy ? 'Marking…' : 'Mark all as read'}</button></div></header>
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
