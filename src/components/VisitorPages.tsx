import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { ArrowDownToLine, ArrowRight, CalendarDays, Clock3, Heart, LogOut, Search, ShieldCheck, Ticket as TicketIcon, UserRound, BadgeCheck } from 'lucide-react';
import type { User } from '@supabase/supabase-js';
import { db, dateLabel, exportCsv, invokeFunction, loadOwnBookings, money, timeLabel, type Booking, type Profile, type Site, type Ticket, type TravelerProfile } from '../lib/iliguide';
import { supabase } from '../lib/supabase';
import { filterVisitorBookings, matchesBookingTab, type BookingTab } from '../lib/visitorBookingFilters';
import { paymentStatusLabel } from '../lib/paymentStatus';
import { useSilentLoad } from '../lib/useSilentLoad';

const ticketReady = (booking: Booking) => ['paid', 'not_required'].includes(booking.payment_status)
  && ['confirmed', 'completed'].includes(booking.booking_status);

type Page = 'Bookings' | 'Tickets' | 'Account';
type Notice = { id: string; title: string; message: string; created_at: string; read_at: string | null };
type SupportRequest = { id: string; booking_id: string | null; subject: string; message: string; status: string; staff_response: string | null; created_at: string; updated_at: string };
type Props = {
  page: Page;
  user: User | null;
  profile: Profile | null;
  booking: Booking | null;
  ticket: Ticket | null;
  guestAccessToken: string;
  onTicket: (booking: Booking, code: string) => void;
  notify: (message: string) => void;
  reloadUser: () => void;
  go: (page: 'Bookings' | 'Tickets' | 'Account') => void;
  onSignOut: () => void;
  configured: boolean;
  sites: Site[];
  savedSiteIds: string[];
  travelers: TravelerProfile[];
  onToggleSavedSite: (siteId: string) => void;
  onOpenSite: (site: Site) => void;
  onLogin: () => void;
  onPasswordReset: () => void;
};

export function VisitorPages(props: Props) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const bookingScope = `${props.user?.id ?? 'visitor'}:${props.configured}`;
  const previousBookingScope = useRef(bookingScope);
  const [loading, finishLoading] = useSilentLoad(bookingScope);
  const [cancellationReason, setCancellationReason] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [bookingTab, setBookingTab] = useState<BookingTab>('all');
  const [bookingSearch, setBookingSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [expandedBooking, setExpandedBooking] = useState('');

  useEffect(() => {
    if (previousBookingScope.current !== bookingScope) {
      setBookings([]);
      previousBookingScope.current = bookingScope;
    }
    if (!props.user || !props.configured) { setBookings([]); finishLoading(); return; }
    let active = true;
    void loadOwnBookings()
      .then((rows) => { if (active) setBookings(rows); })
      .catch((error) => { if (active) props.notify(error instanceof Error ? error.message : 'Could not load bookings.'); })
      .finally(() => { if (active) finishLoading(); });
    return () => { active = false; };
  }, [bookingScope, props.user?.id, props.configured, props.booking?.booking_status, finishLoading]);

  const requestCancel = async (booking = props.booking, token = props.guestAccessToken) => {
    if (!booking) return;
    setActionBusy(true);
    try {
      const { data: requestId, error } = await db().rpc('request_cancellation', {
        p_booking_id: booking.booking_id,
        p_guest_access_token: token || null,
        p_reason: cancellationReason.trim(),
      });
      if (error) throw error;
      if (requestId && booking.visitor_email) void invokeFunction('send-booking-email', {
        booking_reference: booking.booking_reference,
        event: 'cancellation_requested',
        request_id: requestId,
        guest_access_token: token || undefined,
      }).catch(() => props.notify('Cancellation request was submitted, but its email could not be sent.'));
      props.notify('Cancellation request submitted for the destination team to review.');
      setCancellationReason('');
    } catch (error) {
      props.notify(error instanceof Error ? error.message : 'Could not submit the cancellation request.');
    } finally { setActionBusy(false); }
  };
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
  const tabCounts: Record<BookingTab, number> = {
    all: loading ? 0 : bookings.length,
    upcoming: loading ? 0 : bookings.filter((booking) => matchesBookingTab(booking, 'upcoming', today)).length,
    pending: loading ? 0 : bookings.filter((booking) => matchesBookingTab(booking, 'pending', today)).length,
    completed: loading ? 0 : bookings.filter((booking) => matchesBookingTab(booking, 'completed', today)).length,
    cancelled: loading ? 0 : bookings.filter((booking) => matchesBookingTab(booking, 'cancelled', today)).length,
  };
  const visibleBookings = loading ? [] : filterVisitorBookings(bookings, { tab: bookingTab, query: bookingSearch, dateFrom, dateTo, sortOrder, today });

  if (props.page === 'Account') return <AccountPage {...props} bookings={loading ? [] : bookings} bookingsLoading={loading}/>;
  return <section className="dashboard-page section-wrap">
    <div className="dash-header"><div><span className="eyebrow"><span className="eyebrow-line"/> VISITOR ACCOUNT</span>
      <h1>{props.page === 'Tickets' ? <>Your <em>ticket.</em></> : <>Your plans, <em>all here.</em></>}</h1>
      <p>{props.page === 'Tickets' ? 'A ticket is available after your reservation is confirmed.' : 'Review reservations made with your visitor account.'}</p>
    </div>{props.user && <button className="btn btn-outline" onClick={() => void exportCsv('iliguide-bookings.csv', bookings as unknown as Array<Record<string, unknown>>)} disabled={loading || !bookings.length}><ArrowDownToLine size={15}/> Export bookings</button>}</div>
    <p className="config-note">Reservations and tickets here do not grant admission at the destination.</p>
    {props.booking && <BookingRecord booking={props.booking} token={props.guestAccessToken} onTicket={props.onTicket}
      cancellationReason={cancellationReason} setCancellationReason={setCancellationReason}
      onCancel={requestCancel} cancelBusy={actionBusy}/>}
    {props.page === 'Tickets' && props.ticket && props.booking && <TicketView booking={props.booking} ticket={props.ticket} notify={props.notify}/>}
    <div className="bookings-list-heading"><h2>My bookings</h2><span>{loading ? 'Loading…' : bookings.length + ' records'}</span></div>
    {!props.user && <div className="empty-card"><UserRound size={30}/><h3>Sign in to see your bookings</h3><p>Reservations are linked to your visitor account.</p><button className="btn btn-primary" onClick={props.onLogin}>Log in <ArrowRight size={15}/></button></div>}
    {props.user && !bookings.length && !loading && <div className="empty-card"><CalendarDays size={30}/><h3>No bookings on this account</h3><p>When you book while signed in, the current reservation will appear here.</p></div>}
    {props.user && !!bookings.length && <>
      <div className="booking-tabs" role="group" aria-label="Filter bookings">{(['all', 'upcoming', 'pending', 'completed', 'cancelled'] as BookingTab[]).map((tab) =>
        <button key={tab} className={bookingTab === tab ? 'active' : ''} aria-pressed={bookingTab === tab} onClick={() => setBookingTab(tab)}>{tab[0].toUpperCase() + tab.slice(1)} <span>{tabCounts[tab]}</span></button>)}</div>
      <div className="booking-filters"><label className="booking-search"><Search size={15}/><input value={bookingSearch} onChange={(event) => setBookingSearch(event.target.value)} placeholder="Search place or reference" aria-label="Search bookings"/></label>
        <label>Visit from<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)}/></label>
        <label>Visit to<input type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => setDateTo(event.target.value)}/></label>
        <label>Sort<select value={sortOrder} onChange={(event) => setSortOrder(event.target.value as 'newest' | 'oldest')}><option value="newest">Newest</option><option value="oldest">Oldest</option></select></label></div>
      {visibleBookings.map((item) => <article className="booking-record" key={item.booking_id}><div className="booking-record-icon"><CalendarDays size={19}/></div>
      <div className="booking-record-main"><span className="booking-reference">{item.booking_reference}</span><h3>{item.site_name}</h3>
        <p>{dateLabel(item.slot_date)} · {timeLabel(item.starts_at)} – {timeLabel(item.ends_at)} · {item.visitor_count} visitors</p>
        <small>{money(item.total_amount)} estimated · {paymentStatusLabel(item.payment_status, item.total_amount)} · {item.booking_status.replace('_', ' ')}</small></div>
      <span className="status-tag">{item.booking_status.replace('_', ' ')}</span>
      <button className="link-btn" aria-expanded={expandedBooking === item.booking_id} onClick={() => setExpandedBooking(expandedBooking === item.booking_id ? '' : item.booking_id)}>{expandedBooking === item.booking_id ? 'Hide details' : 'View details'}</button>
      {ticketReady(item) &&
        <button className="btn btn-outline" onClick={() => props.onTicket(item, '')}>Open ticket <TicketIcon size={15}/></button>}
      {expandedBooking === item.booking_id && <div className="booking-record-expanded"><BookingRecord booking={item} token="" onTicket={props.onTicket}
        cancellationReason={cancellationReason} setCancellationReason={setCancellationReason}
        onCancel={() => void requestCancel(item, '')} cancelBusy={actionBusy}/></div>}</article>)}
      {!visibleBookings.length && <div className="empty-inline">No bookings match these filters.</div>}
    </>}
  </section>;
}

function BookingRecord({ booking, token, onTicket, cancellationReason, setCancellationReason, onCancel, cancelBusy }: {
  booking: Booking; token: string; onTicket: (booking: Booking, token: string) => void;
  cancellationReason: string; setCancellationReason: (value: string) => void; onCancel: () => void; cancelBusy: boolean;
}) {
  const canCancel = booking.booking_status === 'confirmed' && booking.cancellation_cutoff_at
    && new Date(booking.cancellation_cutoff_at).getTime() > Date.now();
  return <article className="booking-detail-card">
    <div className="booking-detail-head"><div><span className="eyebrow"><span className="eyebrow-line"/> BOOKING {booking.booking_reference}</span><h2>{booking.site_name}</h2>
      <p>{dateLabel(booking.slot_date)} · {timeLabel(booking.starts_at)} – {timeLabel(booking.ends_at)}</p></div>
      <span className={booking.payment_status === 'paid' ? 'status-tag paid' : 'status-tag'}>{booking.booking_status.replace('_', ' ')} · {paymentStatusLabel(booking.payment_status, booking.total_amount)}</span></div>
    <div className="booking-detail-facts"><span><small>VISITORS</small><b>{booking.adult_count} adults, {booking.child_count} children{booking.pwd_count ? `, ${booking.pwd_count} PWD` : ''}</b></span>
      <span><small>{booking.payment_status === 'not_required' ? 'ESTIMATED FEES' : 'TOTAL'}</small><b>{money(booking.total_amount)}</b></span><span><small>REFERENCE</small><b>{booking.booking_reference}</b></span></div>
    {booking.payment_status === 'not_required' && <p className="config-note">Fees are estimates; no payment was collected.</p>}
    {booking.booking_status === 'awaiting_payment' && <p className="config-note"><Clock3 size={16}/> This reservation is not confirmed and will expire when its hold ends.</p>}
    {ticketReady(booking) &&
      <button className="btn btn-primary" onClick={() => onTicket(booking, token)}>View QR ticket <TicketIcon size={16}/></button>}
    {canCancel && <div className="inline-action"><label>Cancellation reason<input value={cancellationReason} onChange={(event) => setCancellationReason(event.target.value)} maxLength={1000} placeholder="Tell the destination team why you need to cancel"/></label>
      <button className="btn btn-outline" disabled={cancelBusy || !cancellationReason.trim()} onClick={onCancel}>Request cancellation</button></div>}
  </article>;
}

function TicketView({ booking, ticket, notify }: { booking: Booking; ticket: Ticket; notify: (message: string) => void }) {
  const download = () => {
    const svg = document.querySelector('.ticket-qr svg');
    if (!svg) return;
    const qrUrl = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml;charset=utf-8' }));
    const qrImage = new Image();
    qrImage.onload = () => {
      URL.revokeObjectURL(qrUrl);
      const canvas = document.createElement('canvas');
      canvas.width = 1200; canvas.height = 820;
      const context = canvas.getContext('2d');
      if (!context) { notify('Could not create the ticket image.'); return; }
      const roundRect = (x: number, y: number, width: number, height: number, radius: number, fill: string, stroke?: string) => {
        context.beginPath(); context.roundRect(x, y, width, height, radius); context.fillStyle = fill; context.fill();
        if (stroke) { context.strokeStyle = stroke; context.lineWidth = 2; context.stroke(); }
      };
      const text = (value: string, x: number, y: number, font: string, color: string) => {
        context.font = font; context.fillStyle = color; context.fillText(value, x, y);
      };
      const card = (label: string, value: string, x: number, y: number, width: number) => {
        roundRect(x, y, width, 92, 12, '#f5f8fa', '#e0e8ec');
        text(label.toUpperCase(), x + 18, y + 28, '700 13px Arial, sans-serif', '#71828b');
        text(value, x + 18, y + 64, '700 22px Arial, sans-serif', '#1b2935');
      };
      roundRect(0, 0, 1200, 820, 0, '#f2f6f7');
      roundRect(38, 38, 1124, 744, 26, '#ffffff', '#dce5ea');
      context.save(); context.beginPath(); context.roundRect(38, 38, 1124, 160, 26); context.clip();
      const gradient = context.createLinearGradient(38, 38, 1162, 198); gradient.addColorStop(0, '#006f93'); gradient.addColorStop(1, '#007da4');
      context.fillStyle = gradient; context.fillRect(38, 38, 1124, 160); context.restore();
      roundRect(80, 77, 48, 48, 14, '#ffffff');
      text('I', 97, 110, '800 31px Arial, sans-serif', '#006f93');
      text('ILIGUIDE', 146, 91, '800 15px Arial, sans-serif', '#d7f2ee');
      text('VISITOR RESERVATION TICKET', 146, 126, '700 26px Arial, sans-serif', '#ffffff');
      const status = booking.payment_status === 'not_required' ? 'CONFIRMED' : 'PAID · CONFIRMED';
      roundRect(866, 84, 238, 42, 21, '#ffffff');
      text(status, 887, 111, '700 14px Arial, sans-serif', '#006f93');
      text('DESTINATION', 84, 248, '700 13px Arial, sans-serif', '#006f93');
      context.font = '800 38px Arial, sans-serif'; context.fillStyle = '#1b2935';
      const titleWords = booking.site_name.split(/\s+/); let titleLine = '', titleY = 301;
      for (const word of titleWords) {
        const candidate = titleLine ? titleLine + ' ' + word : word;
        if (context.measureText(candidate).width > 680 && titleLine) { context.fillText(titleLine, 84, titleY); titleLine = word; titleY += 43; }
        else titleLine = candidate;
      }
      if (titleLine) context.fillText(titleLine, 84, titleY);
      text('VISITOR', 84, 370, '700 12px Arial, sans-serif', '#71828b');
      text(ticket.booking.visitor_name, 84, 400, '700 20px Arial, sans-serif', '#1b2935');
      text('BOOKING REFERENCE', 420, 370, '700 12px Arial, sans-serif', '#71828b');
      text(booking.booking_reference, 420, 400, '700 20px Arial, sans-serif', '#1b2935');
      card('Visit date', dateLabel(ticket.booking.slot_date), 84, 438, 330);
      card('Entry time', timeLabel(ticket.booking.starts_at) + ' – ' + timeLabel(ticket.booking.ends_at), 434, 438, 330);
      card('Visitors', String(ticket.booking.visitor_count), 84, 548, 330);
      card(booking.payment_status === 'not_required' ? 'Estimated fee' : 'Admission', money(ticket.booking.total_amount), 434, 548, 330);
      roundRect(812, 230, 306, 438, 18, '#ffffff', '#dce5ea');
      context.drawImage(qrImage, 847, 265, 236, 236);
      text('PRIVATE BOOKING QR', 872, 535, '700 14px Arial, sans-serif', '#006f93');
      text('Contains a secure ticket token.', 856, 565, '14px Arial, sans-serif', '#526471');
      text('Not valid for destination admission.', 838, 591, '14px Arial, sans-serif', '#526471');
      context.strokeStyle = '#dce5ea'; context.lineWidth = 2; context.beginPath(); context.moveTo(84, 690); context.lineTo(1118, 690); context.stroke();
      text(booking.payment_status === 'not_required' ? 'Reservation record · No payment collected' : 'Reservation record', 84, 728, '700 14px Arial, sans-serif', '#526471');
      text('ILIGUIDE · ILIGAN CITY', 84, 755, '700 12px Arial, sans-serif', '#8797a2');
      canvas.toBlob((blob) => {
        if (!blob) { notify('Could not save the ticket image.'); return; }
        const pngUrl = URL.createObjectURL(blob);
        const anchor = document.createElement('a'); anchor.href = pngUrl;
        anchor.download = booking.booking_reference + '-ticket.png'; anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(pngUrl), 1000);
      }, 'image/png');
    };
    qrImage.onerror = () => { URL.revokeObjectURL(qrUrl); notify('Could not prepare the ticket QR image.'); };
    qrImage.src = qrUrl;
  };
  return <article className="ticket-card ticket-card-live"><div className="ticket-left"><span className={booking.payment_status === 'paid' ? 'status-tag paid' : 'status-tag'}>{booking.payment_status === 'not_required' ? 'CONFIRMED' : 'PAID · CONFIRMED'}</span><h2>{booking.site_name}</h2>
    <p>Present this QR code to the gatekeeper when you arrive.</p><div className="ticket-divider"/>
    <div className="ticket-data"><span>BOOKING REFERENCE<b>{booking.booking_reference}</b></span><span>VISITOR NAME<b>{ticket.booking.visitor_name}</b></span>
      <span>VISITOR COUNT<b>{ticket.booking.visitor_count}</b></span><span>VISIT DATE<b>{dateLabel(ticket.booking.slot_date)}</b></span>
      <span>ENTRY TIME<b>{timeLabel(ticket.booking.starts_at)}</b></span><span>{booking.payment_status === 'not_required' ? 'ESTIMATED FEE' : 'ADMISSION'}<b>{money(ticket.booking.total_amount)}</b></span></div></div>
    <div className="ticket-qr"><QRCodeSVG value={ticket.token} size={188} level="H" includeMargin aria-label="Secure Iliguide entry ticket QR code"/>
      <small>This private QR code contains an opaque signed ticket token, not visitor contact information.</small>
      <button className="btn btn-outline" onClick={download}><ArrowDownToLine size={15}/> Download PNG</button></div></article>;
}

function AccountPage(props: Props & { bookings: Booking[]; bookingsLoading: boolean }) {
  const [accountTab, setAccountTab] = useState<'profile' | 'travelers' | 'saved' | 'notifications' | 'support'>('profile');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState(props.profile?.phone ?? '');
  const [email, setEmail] = useState(props.user?.email ?? '');
  const [notices, setNotices] = useState<Notice[]>([]);
  const [supportRequests, setSupportRequests] = useState<SupportRequest[]>([]);
  const [supportSubject, setSupportSubject] = useState('Booking question');
  const [supportMessage, setSupportMessage] = useState('');
  const [supportBookingId, setSupportBookingId] = useState('');
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [travelerName, setTravelerName] = useState('');
  const [travelerEmail, setTravelerEmail] = useState('');
  const [travelerPhone, setTravelerPhone] = useState('');
  const [editingTravelerId, setEditingTravelerId] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  const [securityBusy, setSecurityBusy] = useState(false);
  const [accountBusy, setAccountBusy] = useState(false);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
  const upcomingCount = props.bookings.filter((item) => item.booking_status === 'confirmed' && item.slot_date >= today).length;
  const pendingCount = props.bookings.filter((item) => ['awaiting_payment', 'needs_resolution'].includes(item.booking_status)).length;
  const completedCount = props.bookings.filter((item) => item.booking_status === 'completed').length;
  const savedSites = props.sites.filter((site) => props.savedSiteIds.includes(site.id));
  const accountTabs = [
    { id: 'profile', label: 'Profile information' }, { id: 'travelers', label: 'Travelers' },
    { id: 'saved', label: 'Saved places' },
    { id: 'notifications', label: 'Notifications' }, { id: 'support', label: 'Support' },
  ] as const;
  useEffect(() => {
    const [given = '', ...family] = (props.profile?.full_name ?? '').trim().split(/\s+/);
    setFirstName(given);
    setLastName(family.join(' '));
    setPhone(props.profile?.phone ?? '');
    setEmail(props.user?.email ?? '');
  }, [props.profile?.id, props.profile?.full_name, props.profile?.phone, props.user?.email]);
  useEffect(() => {
    if (!props.user || !props.configured) { setNotices([]); return; }
    let active = true;
    void (async () => {
      try {
        const { data, error } = await db().from('notifications').select('id,title,message,created_at,read_at')
          .eq('user_id', props.user!.id).order('created_at', { ascending: false }).limit(30);
        if (error) throw error;
        if (active) setNotices((data ?? []) as Notice[]);
        const [supportResult, preferenceResult] = await Promise.all([
          db().from('support_requests').select('id,booking_id,subject,message,status,staff_response,created_at,updated_at')
            .eq('user_id', props.user!.id).order('created_at', { ascending: false }).limit(50),
          db().from('notification_preferences').select('promotional_announcements').eq('user_id', props.user!.id).maybeSingle(),
        ]);
        for (const result of [supportResult, preferenceResult]) if (result.error) throw result.error;
        if (active) {
          setSupportRequests((supportResult.data ?? []) as SupportRequest[]);
          setMarketingOptIn(preferenceResult.data?.promotional_announcements ?? false);
        }
        const path = props.profile?.avatar_path;
        if (path) {
          const result = await db().storage.from('visitor-avatars').createSignedUrl(path, 3600);
          if (active && result.data?.signedUrl) setAvatarUrl(result.data.signedUrl);
        }
      } catch (error) { if (active) props.notify(error instanceof Error ? error.message : 'Could not load account activity.'); }
    })();
    return () => { active = false; };
  }, [props.user?.id, props.profile?.avatar_path, props.configured]);
  const save = async () => {
    if (!props.user) { props.notify('Sign in to update your account.'); return; }
    const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
    if (!firstName.trim() || !lastName.trim() || fullName.length > 120) { props.notify('Enter first and last names, up to 120 characters total.'); return; }
    if (phone.trim() && phone.trim().length < 7) { props.notify('Enter a valid phone number or leave it blank.'); return; }
    setBusy(true);
    try {
      const { error } = await db().from('profiles').update({ full_name: fullName, phone: phone.trim() || null }).eq('id', props.user.id);
      if (error) throw error;
      props.reloadUser();
      props.notify('Profile saved.');
    } catch (error) { props.notify(error instanceof Error ? error.message : 'Could not save profile.'); }
    finally { setBusy(false); }
  };
  const updateEmail = async () => {
    if (!supabase || !email.trim() || email.trim().toLowerCase() === props.user?.email?.toLowerCase()) return;
    setEmailBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ email: email.trim() }, { emailRedirectTo: window.location.origin });
      if (error) throw error;
      props.notify('Check your email to confirm the address change.');
    } catch (error) { props.notify(error instanceof Error ? error.message : 'Could not request the email change.'); }
    finally { setEmailBusy(false); }
  };
  const uploadAvatar = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !props.user) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
      props.notify('Choose a JPEG, PNG, or WebP image under 2 MiB.'); return;
    }
    setBusy(true);
    try {
      const extension = file.type.split('/')[1].replace('jpeg', 'jpg');
      const path = props.user.id + '/' + crypto.randomUUID() + '.' + extension;
      const { error: uploadError } = await db().storage.from('visitor-avatars').upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
      const { error } = await db().from('profiles').update({ avatar_path: path }).eq('id', props.user.id);
      if (error) throw error;
      const result = await db().storage.from('visitor-avatars').createSignedUrl(path, 3600);
      setAvatarUrl(result.data?.signedUrl ?? '');
      props.reloadUser();
      props.notify('Profile photo updated.');
    } catch (error) { props.notify(error instanceof Error ? error.message : 'Could not upload the profile photo.'); }
    finally { setBusy(false); event.target.value = ''; }
  };
  const markRead = async (notice: Notice) => {
    if (notice.read_at) return;
    const now = new Date().toISOString();
    const { error } = await db().from('notifications').update({ read_at: now }).eq('id', notice.id).eq('user_id', props.user?.id);
    if (error) { props.notify(error.message); return; }
    setNotices((current) => current.map((item) => item.id === notice.id ? { ...item, read_at: now } : item));
  };
  const resendVerification = async () => {
    if (!supabase || !props.user?.email) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.resend({ type: 'signup', email: props.user.email, options: { emailRedirectTo: window.location.origin } });
      if (error) throw error;
      props.notify('Verification email sent.');
    } catch (error) { props.notify(error instanceof Error ? error.message : 'Could not send the verification email.'); }
    finally { setBusy(false); }
  };
  const changePassword = async () => {
    if (!supabase || !props.user?.email) return;
    if (newPassword.length < 8) { props.notify('New password must be at least 8 characters.'); return; }
    if (newPassword !== confirmNewPassword) { props.notify('New passwords do not match.'); return; }
    setSecurityBusy(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: props.user.email, password: currentPassword });
      if (signInError) throw signInError;
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setCurrentPassword(''); setNewPassword(''); setConfirmNewPassword('');
      props.notify('Password changed.');
    } catch (error) { props.notify(error instanceof Error ? error.message : 'Could not change password.'); }
    finally { setSecurityBusy(false); }
  };
  const saveTraveler = async () => {
    if (!props.user) return;
    const fullName = travelerName.trim();
    if (fullName.length < 2 || fullName.length > 120) { props.notify('Traveler name must be 2–120 characters.'); return; }
    if (travelerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(travelerEmail.trim())) { props.notify('Enter a valid traveler email.'); return; }
    setAccountBusy(true);
    try {
      const values = { full_name: fullName, email: travelerEmail.trim() || null, phone: travelerPhone.trim() || null };
      const result = editingTravelerId
        ? await db().from('traveler_profiles').update(values).eq('id', editingTravelerId).eq('user_id', props.user.id)
        : await db().from('traveler_profiles').insert({ ...values, user_id: props.user.id });
      if (result.error) throw result.error;
      setTravelerName(''); setTravelerEmail(''); setTravelerPhone(''); setEditingTravelerId('');
      props.reloadUser(); props.notify(editingTravelerId ? 'Traveler updated.' : 'Traveler saved.');
    } catch (error) { props.notify(error instanceof Error ? error.message : 'Could not save traveler.'); }
    finally { setAccountBusy(false); }
  };
  const removeTraveler = async (id: string) => {
    if (!window.confirm('Remove this saved traveler?')) return;
    setAccountBusy(true);
    try {
      const { error } = await db().from('traveler_profiles').delete().eq('id', id).eq('user_id', props.user?.id);
      if (error) throw error;
      props.reloadUser(); props.notify('Traveler removed.');
    } catch (error) { props.notify(error instanceof Error ? error.message : 'Could not remove traveler.'); }
    finally { setAccountBusy(false); }
  };
  const saveNotificationPreferences = async (enabled: boolean) => {
    if (!props.user) return;
    const previous = marketingOptIn;
    setMarketingOptIn(enabled);
    const { error } = await db().from('notification_preferences').upsert({ user_id: props.user.id, promotional_announcements: enabled });
    if (error) { setMarketingOptIn(previous); props.notify(error.message); }
  };
  const submitSupport = async (event: FormEvent) => {
    event.preventDefault();
    const subject = supportSubject.trim(), message = supportMessage.trim();
    if (subject.length < 3 || message.length < 10 || message.length > 4000) { props.notify('Add a subject and a message between 10 and 4,000 characters.'); return; }
    setAccountBusy(true);
    try {
      const { data, error } = await db().from('support_requests').insert({
        user_id: props.user?.id, booking_id: supportBookingId || null, subject, message,
      }).select('id,booking_id,subject,message,status,staff_response,created_at,updated_at').single();
      if (error) throw error;
      setSupportRequests((current) => [data as SupportRequest, ...current]);
      setSupportMessage(''); setSupportBookingId('');
      props.notify('Support request sent. Track its status below.');
    } catch (error) { props.notify(error instanceof Error ? error.message : 'Could not send the support request.'); }
    finally { setAccountBusy(false); }
  };
  if (!props.user) return <section className="dashboard-page section-wrap"><div className="dash-header"><div><span className="eyebrow"><span className="eyebrow-line"/> YOUR ACCOUNT</span><h1>A little more <em>personal.</em></h1></div></div>
    <div className="empty-card"><UserRound size={30}/><h3>Sign in to manage your profile</h3><p>Your reservations and tickets are linked to your visitor account.</p><button className="btn btn-primary" onClick={props.onLogin}>Log in <ArrowRight size={15}/></button></div></section>;
  return <section className="dashboard-page section-wrap visitor-account-page">
    <div className="dash-header"><div><span className="eyebrow"><span className="eyebrow-line"/> VISITOR ACCOUNT</span><h1>Your account, <em>your plans.</em></h1><p>Manage your details, saved travelers, reservations, and visitor activity.</p></div></div>
    {!props.user.email_confirmed_at && <div className="verification-prompt account-verification"><span>Email not verified. Confirm it to secure your account.</span><button className="link-btn" disabled={busy} onClick={() => void resendVerification()}>{busy ? 'Sending…' : 'Resend verification link'}</button></div>}
    <div className="account-shortcuts"><button className="btn btn-outline" onClick={() => props.go('Bookings')}><CalendarDays size={15}/> My bookings <b>{props.bookingsLoading ? '…' : props.bookings.length}</b></button><button className="btn btn-outline" onClick={() => props.go('Tickets')}><TicketIcon size={15}/> My tickets</button>
      <span className="account-quick-stat"><b>{props.bookingsLoading ? '…' : upcomingCount}</b> upcoming</span><span className="account-quick-stat"><b>{props.bookingsLoading ? '…' : completedCount}</b> completed</span><span className="account-quick-stat"><b>{props.bookingsLoading ? '…' : pendingCount}</b> pending</span></div>
    <div className="profile-workspace">
      <aside className="profile-management-panel"><div className="profile-panel-heading"><span>ACCOUNT MANAGEMENT</span><ShieldCheck size={16}/></div>
        <div className="profile-photo-preview">{avatarUrl ? <img src={avatarUrl} alt="Profile photo"/> : <UserRound size={42}/>}</div>
        <div className="profile-identity"><b>{props.profile?.full_name || props.user.email}</b><small>{props.user.email}</small><span className={props.user.email_confirmed_at ? 'verified-label' : 'verification-pending'}><BadgeCheck size={13}/>{props.user.email_confirmed_at ? 'Email verified' : 'Verification pending'}</span></div>
        <label className="profile-upload-control"><span>Upload profile photo</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void uploadAvatar(event)}/><small>JPEG, PNG, WebP · up to 2 MiB</small></label>
        <details className="profile-security-panel" open><summary>Password and security</summary><p>Change your password using your current password.</p>
          <label>Current password<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password"/></label>
          <label>New password<input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={8} autoComplete="new-password"/></label>
          <label>Confirm new password<input type="password" value={confirmNewPassword} onChange={(event) => setConfirmNewPassword(event.target.value)} autoComplete="new-password"/></label>
          <button className="btn btn-primary profile-password-submit" disabled={securityBusy || !currentPassword || !newPassword || !confirmNewPassword} onClick={() => void changePassword()}>{securityBusy ? 'Updating…' : 'Change password'}</button>
          <button className="link-btn" onClick={props.onPasswordReset}>Forgot password?</button>
        </details>
        <button className="btn btn-outline profile-logout" onClick={props.onSignOut}><LogOut size={15}/> Log out</button>
      </aside>
      <div className="profile-content-panel">
        <nav className="account-section-tabs" aria-label="Visitor account sections">{accountTabs.map((tab) => <button key={tab.id} className={accountTab === tab.id ? 'active' : ''} aria-pressed={accountTab === tab.id} onClick={() => setAccountTab(tab.id)}>{tab.label}{tab.id === 'saved' && <span>{savedSites.length}</span>}{tab.id === 'travelers' && <span>{props.travelers.length}</span>}{tab.id === 'notifications' && <span>{notices.filter((item) => !item.read_at).length}</span>}</button>)}</nav>
        <div className="account-tab-panel">
          {accountTab === 'profile' && <section className="profile-tab-content"><div className="profile-tab-heading"><div><span className="eyebrow"><span className="eyebrow-line"/> PERSONAL INFORMATION</span><h2>Profile information</h2><p>Keep your visitor contact details current for reservations and account updates.</p></div><span className={props.user.email_confirmed_at ? 'verified-label' : 'verification-pending'}><BadgeCheck size={14}/>{props.user.email_confirmed_at ? 'Verified' : 'Needs verification'}</span></div>
            <div className="profile-form-grid"><label>First name<input value={firstName} onChange={(event) => setFirstName(event.target.value)} maxLength={60} autoComplete="given-name" required/></label><label>Last name<input value={lastName} onChange={(event) => setLastName(event.target.value)} maxLength={60} autoComplete="family-name" required/></label>
              <label className="profile-form-wide">Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} autoComplete="email"/><small>Changing this address requires email confirmation.</small></label>
              {email.trim().toLowerCase() !== props.user.email?.toLowerCase() && <button className="btn btn-outline profile-form-wide profile-email-update" disabled={emailBusy || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())} onClick={() => void updateEmail()}>{emailBusy ? 'Sending…' : 'Send confirmation link'}</button>}
              <label className="profile-form-wide">Phone number<input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={40} autoComplete="tel"/><small>Used for booking contact when needed.</small></label>
            </div><div className="profile-form-actions"><button className="btn btn-primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save changes'} <ArrowRight size={15}/></button></div>
          </section>}
          {accountTab === 'travelers' && <section className="profile-tab-content"><div className="profile-tab-heading"><div><span className="eyebrow"><span className="eyebrow-line"/> BOOKING DETAILS</span><h2>Traveler profiles</h2><p>Save contact details for people you book for. Only your account can access them.</p></div></div>
            <div className="traveler-form"><label>Full name<input value={travelerName} onChange={(event) => setTravelerName(event.target.value)} maxLength={120} autoComplete="name"/></label><label>Email<input type="email" value={travelerEmail} onChange={(event) => setTravelerEmail(event.target.value)} maxLength={254} autoComplete="email"/></label><label>Phone<input type="tel" value={travelerPhone} onChange={(event) => setTravelerPhone(event.target.value)} maxLength={40} autoComplete="tel"/></label><button className="btn btn-primary" disabled={accountBusy || !travelerName.trim()} onClick={() => void saveTraveler()}>{editingTravelerId ? 'Update traveler' : 'Save traveler'}</button>{editingTravelerId && <button className="link-btn" onClick={() => { setEditingTravelerId(''); setTravelerName(''); setTravelerEmail(''); setTravelerPhone(''); }}>Cancel edit</button>}</div>
            {!props.travelers.length && <div className="empty-inline">No saved travelers yet.</div>}{props.travelers.map((traveler) => <div className="saved-site-row traveler-row" key={traveler.id}><span><b>{traveler.full_name}</b><small>{[traveler.email, traveler.phone].filter(Boolean).join(' · ') || 'No contact details'}</small></span><button className="link-btn" onClick={() => { setEditingTravelerId(traveler.id); setTravelerName(traveler.full_name); setTravelerEmail(traveler.email ?? ''); setTravelerPhone(traveler.phone ?? ''); }}>Edit</button><button className="link-btn" disabled={accountBusy} onClick={() => void removeTraveler(traveler.id)}>Remove</button></div>)}
          </section>}
          {accountTab === 'saved' && <section className="profile-tab-content"><div className="profile-tab-heading"><div><span className="eyebrow"><span className="eyebrow-line"/> YOUR COLLECTION</span><h2>Saved places</h2><p>Open a destination to review its current prices and availability.</p></div><span>{savedSites.length} saved</span></div>
            {!savedSites.length && <div className="empty-inline">Tap a destination’s heart to save it. Guest saves stay on this browser and sync after sign-in.</div>}{savedSites.map((site) => <div className="saved-site-row" key={site.id}><span className="saved-site-image">{site.images[0] ? <img src={site.images[0].public_url} alt=""/> : <Heart size={16}/>}</span><span><b>{site.name}</b><small>{site.category} · {site.fee_information_confirmed ? `Adult ${money(site.adult_fee)}` : 'Admission fees not published'}</small></span><button className="link-btn" onClick={() => props.onOpenSite(site)}>View destination</button><button className="link-btn" aria-label={'Remove ' + site.name + ' from saved places'} onClick={() => props.onToggleSavedSite(site.id)}>Remove</button></div>)}
          </section>}
          {accountTab === 'notifications' && <section className="profile-tab-content"><div className="profile-tab-heading"><div><span className="eyebrow"><span className="eyebrow-line"/> ACCOUNT ACTIVITY</span><h2>Notifications</h2><p>Booking and account updates are essential messages. Promotional announcements are optional.</p></div><span>{notices.filter((item) => !item.read_at).length} unread</span></div>
            <label className="preference-toggle"><input type="checkbox" checked={marketingOptIn} onChange={(event) => void saveNotificationPreferences(event.target.checked)}/> Promotional announcements</label>
            {!notices.length && <div className="empty-inline">No account notifications.</div>}{notices.map((notice) => <button className={notice.read_at ? 'notification-row' : 'notification-row unread'} key={notice.id} onClick={() => void markRead(notice)}><span><b>{notice.title}</b><small>{notice.message}</small><time>{new Date(notice.created_at).toLocaleString()}</time></span>{!notice.read_at && <i/>}</button>)}
          </section>}
          {accountTab === 'support' && <section className="profile-tab-content"><div className="profile-tab-heading"><div><span className="eyebrow"><span className="eyebrow-line"/> VISITOR HELP</span><h2>Customer support</h2><p>Send a booking question or concern and check its status here.</p></div></div>
            <div className="support-faq"><details><summary>How do I find a booking?</summary><p>Sign in with the visitor account used to reserve, then open My bookings.</p></details><details><summary>When is a ticket available?</summary><p>After the reservation is confirmed. Present its QR code at the destination for gate validation. Admission remains subject to the destination’s current rules.</p></details><details><summary>How do I change or cancel a reservation?</summary><p>Open the reservation in My bookings and submit a request when the option is available.</p></details></div>
            <form className="support-form" onSubmit={(event) => void submitSupport(event)}><label>Topic<select value={supportSubject} onChange={(event) => setSupportSubject(event.target.value)}><option>Booking question</option><option>Complaint or concern</option><option>Account help</option><option>Other</option></select></label><label>Related booking<select value={supportBookingId} onChange={(event) => setSupportBookingId(event.target.value)}><option value="">No booking reference</option>{props.bookings.map((booking) => <option key={booking.booking_id} value={booking.booking_id}>{booking.booking_reference} · {booking.site_name}</option>)}</select></label><label>Message<textarea value={supportMessage} onChange={(event) => setSupportMessage(event.target.value)} minLength={10} maxLength={4000} rows={4} required/></label><button className="btn btn-primary" disabled={accountBusy || supportMessage.trim().length < 10}>Send support request</button></form>
            <h3 className="support-history-title">Your support requests</h3>{!supportRequests.length && <div className="empty-inline">No requests yet.</div>}{supportRequests.map((request) => { const booking = props.bookings.find((item) => item.booking_id === request.booking_id); return <div className="support-request-row" key={request.id}><div><b>{request.subject}</b><span className="status-tag">{request.status.replace('_', ' ')}</span><small>{booking ? booking.booking_reference + ' · ' : ''}{new Date(request.created_at).toLocaleString()}</small><p>{request.message}</p>{request.staff_response && <blockquote>{request.staff_response}</blockquote>}</div></div>; })}
          </section>}
        </div>
      </div>
    </div>
  </section>;
}
