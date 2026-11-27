import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { ArrowDownToLine, ArrowRight, CalendarDays, Clock3, Heart, LogOut, Search, ShieldCheck, Ticket as TicketIcon, UserRound, BadgeCheck } from 'lucide-react';
import type { User } from '@supabase/supabase-js';
import { db, dateLabel, invokeFunction, isValidOptionalPhone, loadOwnBookings, money, timeLabel, timestampTimeLabel, type Booking, type Profile, type Site, type Ticket, type TravelerProfile } from '../lib/iliguide';
import { supabase } from '../lib/supabase';
import { ChangePasswordForm } from './ChangePasswordForm';
import { filterVisitorBookings, matchesBookingTab, type BookingTab } from '../lib/visitorBookingFilters';
import { bookingStatusLabel, paymentStatusLabel } from '../lib/paymentStatus';
import { canIssueVisitorTicket } from '../lib/visitorPlanning';
import { useSilentLoad } from '../lib/useSilentLoad';
import { ReviewComposer, type ReviewRow } from './ReviewPages';


type Page = 'Bookings' | 'Tickets' | 'Account';
type Notice = { id: string; title: string; message: string; notification_type: string; created_at: string; read_at: string | null };
type SupportRequest = { id: string; booking_id: string | null; subject: string; message: string; status: string; staff_response: string | null; created_at: string; updated_at: string };
type Props = {
  page: Page;
  reviewOnly: boolean;
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
  onPayment: (reference: string) => void;
  onConfirmation: (reference: string) => void;
  onPasswordReset: () => void;
};

export function VisitorPages(props: Props) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const bookingScope = `${props.user?.id ?? 'visitor'}:${props.configured}`;
  const previousBookingScope = useRef(bookingScope);
  const [loading, finishLoading] = useSilentLoad(bookingScope);
  const [cancellationReasons, setCancellationReasons] = useState<Record<string, string>>({});
  const [bookingsReloadKey, setBookingsReloadKey] = useState(0);
  const [actionBusy, setActionBusy] = useState(false);
  const [bookingTab, setBookingTab] = useState<BookingTab>(props.reviewOnly ? 'completed' : 'all');
  const [bookingSearch, setBookingSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [expandedBooking, setExpandedBooking] = useState('');
  const focusedBooking = new URLSearchParams(window.location.search).get('booking') ?? '';
  const focusedBookingRef = useRef('');
  const [ownReviews, setOwnReviews] = useState<ReviewRow[]>([]);
  const [reviewRefresh, setReviewRefresh] = useState(0);
  const [reviewBooking, setReviewBooking] = useState<{ booking: Booking; review?: ReviewRow } | null>(null);

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
  }, [bookingScope, props.user?.id, props.configured, props.booking?.booking_status, bookingsReloadKey, finishLoading]);

  useEffect(() => {
    if (!focusedBooking || !bookings.some((booking) => booking.booking_id === focusedBooking)) return;
    setExpandedBooking(focusedBooking);
    if (focusedBookingRef.current !== focusedBooking) {
      focusedBookingRef.current = focusedBooking;
      document.getElementById(`booking-record-${focusedBooking}`)?.scrollIntoView({ block: 'nearest' });
    }
  }, [focusedBooking, bookings]);

  useEffect(() => {
    if (!props.user || !props.configured) return;
    const userId = props.user.id;
    const channel = db().channel(`visitor-booking-attendance-${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, (event) => {
        if ((event.new as { booking_id?: string | null }).booking_id) setBookingsReloadKey((key) => key + 1);
      }).subscribe();
    return () => { void db().removeChannel(channel); };
  }, [props.user?.id, props.configured]);

  const setReasonForBooking = (bookingId: string, value: string) => {
    setCancellationReasons((current) => ({ ...current, [bookingId]: value }));
  };

  useEffect(() => {
    if (!props.user || !props.configured || props.profile?.role !== 'visitor' || props.profile.account_status !== 'active') { setOwnReviews([]); return; }
    let active = true;
    void (async () => {
      const { data, error } = await db().from('reviews').select('id,booking_id,site_id,rating,category,comment,review_status,created_at')
        .eq('visitor_id', props.user!.id).order('created_at', { ascending: false }).limit(500);
      if (error) throw error;
      if (active) setOwnReviews((data ?? []) as ReviewRow[]);
    })().catch((error) => { if (active) props.notify(error instanceof Error ? error.message : 'Could not load your reviews.'); });
    return () => { active = false; };
  }, [props.user?.id, props.profile?.role, props.profile?.account_status, props.configured, props.notify, reviewRefresh]);

  const requestCancel = async (booking = props.booking, token = props.guestAccessToken) => {
    if (!booking) return;
    const reason = (cancellationReasons[booking.booking_id] ?? '').trim();
    if (!reason) return;
    setActionBusy(true);
    try {
      const { data: requestId, error } = await db().rpc('request_cancellation', {
        p_booking_id: booking.booking_id,
        p_guest_access_token: token || null,
        p_reason: reason,
      });
      if (error) throw error;
      if (requestId && booking.visitor_email) void invokeFunction('send-booking-email', {
        booking_reference: booking.booking_reference,
        event: 'cancellation_requested',
        request_id: requestId,
        guest_access_token: token || undefined,
      }).catch(() => props.notify('Cancellation request was submitted, but its email could not be sent.'));
      props.notify('Cancellation request submitted for the destination team to review.');
      setCancellationReasons((current) => {
        const next = { ...current };
        delete next[booking.booking_id];
        return next;
      });
      setBookingsReloadKey((current) => current + 1);
    } catch (error) {
      props.notify(error instanceof Error ? error.message : 'Could not submit the cancellation request.');
    } finally { setActionBusy(false); }
  };
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
  const tabCounts: Record<BookingTab, number> = {
    all: loading ? 0 : bookings.length,
    upcoming: loading ? 0 : bookings.filter((booking) => matchesBookingTab(booking, 'upcoming', today)).length,
    checked_in: loading ? 0 : bookings.filter((booking) => matchesBookingTab(booking, 'checked_in', today)).length,
    pending: loading ? 0 : bookings.filter((booking) => matchesBookingTab(booking, 'pending', today)).length,
    completed: loading ? 0 : bookings.filter((booking) => matchesBookingTab(booking, 'completed', today)).length,
    cancelled: loading ? 0 : bookings.filter((booking) => matchesBookingTab(booking, 'cancelled', today)).length,
  };
  const visibleBookings = loading ? [] : filterVisitorBookings(bookings, { tab: bookingTab, query: bookingSearch, dateFrom, sortOrder, today });
  const reviewBookings = visibleBookings.filter((item) => item.booking_status === 'completed'
    && props.profile?.role === 'visitor' && props.profile.account_status === 'active');

  useEffect(() => { setBookingTab(props.reviewOnly ? 'completed' : 'all'); }, [props.reviewOnly]);

  if (props.page === 'Account') return <AccountPage {...props} bookings={loading ? [] : bookings} bookingsLoading={loading}/>;
  return <section className="dashboard-page section-wrap">
    <div className="dash-header"><div><span className="eyebrow"><span className="eyebrow-line"/> VISITOR ACCOUNT</span>
      <h1>{props.page === 'Tickets' ? <>Your <em>ticket.</em></> : props.reviewOnly ? <>Rate &amp; <em>give feedback.</em></> : <>Your plans, <em>all here.</em></>}</h1>
      <p>{props.page === 'Tickets' ? 'A ticket is available after your reservation is confirmed.' : props.reviewOnly ? 'Choose a completed visit to review your experience.' : 'Review reservations made with your visitor account.'}</p>
    </div></div>
    <p className="config-note">Reservations and tickets here do not grant admission at the destination.</p>
    {props.booking && <BookingRecord booking={props.booking} token={props.guestAccessToken} onTicket={props.onTicket} onConfirmation={props.onConfirmation}
      cancellationReason={cancellationReasons[props.booking.booking_id] ?? ''}
      setCancellationReason={(value) => setReasonForBooking(props.booking!.booking_id, value)}
      onCancel={() => void requestCancel(props.booking, props.guestAccessToken)} cancelBusy={actionBusy}/>}
    {props.page === 'Tickets' && props.ticket && props.booking && <TicketView booking={props.booking} ticket={props.ticket} userId={props.user?.id ?? null} configured={props.configured} notify={props.notify} onConfirmation={props.onConfirmation}/>}
    <div className="bookings-list-heading"><h2>{props.reviewOnly ? 'Completed visits' : 'My bookings'}</h2><span>{loading ? 'Loading…' : props.reviewOnly ? reviewBookings.length + ' visits' : bookings.length + ' records'}</span></div>
    {!props.user && <div className="empty-card"><UserRound size={30}/><h3>{props.reviewOnly ? 'Sign in to review completed visits' : 'Sign in to see your bookings'}</h3><p>Reservations are linked to your visitor account.</p><button className="btn btn-primary" onClick={props.onLogin}>Sign in <ArrowRight size={15}/></button></div>}
    {props.user && !bookings.length && !loading && <div className="empty-card"><CalendarDays size={30}/><h3>{props.reviewOnly ? 'No completed visits to review yet' : 'No bookings on this account'}</h3><p>{props.reviewOnly ? 'After a destination records your visit as completed, it will appear here.' : 'When you book while signed in, the current reservation will appear here.'}</p></div>}
    {props.user && !!bookings.length && <>
      {!props.reviewOnly && <><div className="booking-tabs" role="group" aria-label="Filter bookings">{(['all', 'upcoming', 'checked_in', 'pending', 'completed', 'cancelled'] as BookingTab[]).map((tab) =>
        <button key={tab} className={bookingTab === tab ? 'active' : ''} aria-pressed={bookingTab === tab} onClick={() => setBookingTab(tab)}>{bookingTabLabel(tab)} <span>{tabCounts[tab]}</span></button>)}</div>
      <div className="booking-filters"><label className="booking-search"><Search size={15}/><input value={bookingSearch} onChange={(event) => setBookingSearch(event.target.value)} placeholder="Search place or reference" aria-label="Search bookings"/></label>
        <label>Visit from<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)}/></label>
        <label>Sort<select value={sortOrder} onChange={(event) => setSortOrder(event.target.value as 'newest' | 'oldest')}><option value="newest">Newest</option><option value="oldest">Oldest</option></select></label></div></>}
      {(props.reviewOnly ? reviewBookings : visibleBookings).map((item) => { const review = ownReviews.find((row) => row.booking_id === item.booking_id); return <article className="booking-record" id={`booking-record-${item.booking_id}`} key={item.booking_id}><div className="booking-record-icon"><CalendarDays size={19}/></div>
      <div className="booking-record-main"><span className="booking-reference">{item.booking_reference}</span><h3>{item.site_name}</h3>
        <p>{dateLabel(item.slot_date)} · {item.visitor_count} visitors</p>
        <small>{money(item.total_amount)} estimated · {item.payment_method === 'onsite' ? 'Pay onsite' : 'Online'} · {item.manual_payment_mode === 'demo' && item.payment_status === 'paid' ? 'demo paid' : paymentStatusLabel(item.payment_status, item.total_amount)}</small></div>
      <div className="booking-record-actions"><div className="booking-record-buttons">
        {item.manual_payment_id && item.manual_payment_status !== 'paid' && <button className="btn btn-outline" onClick={() => props.onPayment(item.booking_reference)}>{item.manual_payment_status === 'pending_verification' ? 'Payment status' : 'Complete payment'}</button>}
        <button className="link-btn" aria-expanded={expandedBooking === item.booking_id} onClick={() => setExpandedBooking(expandedBooking === item.booking_id ? '' : item.booking_id)}>{expandedBooking === item.booking_id ? 'Hide details' : 'View details'}</button>
        {item.booking_status === 'completed' && props.profile?.role === 'visitor' && props.profile.account_status === 'active' && <button className="btn btn-outline" onClick={() => setReviewBooking({ booking: item, review })}>{review ? 'View my review' : 'Write a review'}</button>}
      </div><div className="booking-record-statuses"><span className={`status-tag ${item.booking_status === 'confirmed' || item.booking_status === 'completed' ? 'paid' : ''}`}>{visitorBookingStatus(item)}</span>{review && <span className={`review-status-tag review-status-${review.review_status}`}>{review.review_status === 'pending' ? 'Review pending' : review.review_status}</span>}</div></div>
      {expandedBooking === item.booking_id && <div className="booking-record-expanded"><BookingRecord booking={item} token="" onTicket={props.onTicket} onConfirmation={props.onConfirmation}
        cancellationReason={cancellationReasons[item.booking_id] ?? ''}
        setCancellationReason={(value) => setReasonForBooking(item.booking_id, value)}
        onCancel={() => void requestCancel(item, '')} cancelBusy={actionBusy}/></div>}</article>; })}
      {!(props.reviewOnly ? reviewBookings : visibleBookings).length && <div className="empty-inline">{props.reviewOnly ? 'No completed visits are available to review yet.' : 'No bookings match these filters.'}</div>}
    </>}
    {reviewBooking && <ReviewComposer bookingId={reviewBooking.booking.booking_id} siteName={reviewBooking.booking.site_name} existing={reviewBooking.review}
      onClose={() => setReviewBooking(null)} onSaved={() => { setReviewBooking(null); setReviewRefresh((value) => value + 1); }} notify={props.notify}/>}
  </section>;
}

function BookingRecord({ booking, token, onTicket, onConfirmation, cancellationReason, setCancellationReason, onCancel, cancelBusy }: {
  booking: Booking; token: string; onTicket: (booking: Booking, token: string) => void; onConfirmation: (reference: string) => void;
  cancellationReason: string; setCancellationReason: (value: string) => void; onCancel: () => void; cancelBusy: boolean;
}) {
  const canCancel = booking.booking_status === 'confirmed' && booking.cancellation_cutoff_at
    && new Date(booking.cancellation_cutoff_at).getTime() > Date.now();
  const [attendance, setAttendance] = useState(booking.attendance ?? null);
  useEffect(() => {
    if (booking.booking_status !== 'completed' || booking.attendance) return;
    let active = true;
    void db().rpc('visitor_booking_attendance', { p_booking_id: booking.booking_id }).then(({ data, error }) => {
      if (!error && active) {
        const row = (Array.isArray(data) ? data[0] : data) as TicketAttendance | null;
        if (row) setAttendance(row);
      }
    });
    return () => { active = false; };
  }, [booking.booking_id, booking.booking_status, booking.attendance]);
  return <article className="booking-detail-card">
    <div className="booking-detail-head"><div><span className="eyebrow"><span className="eyebrow-line"/> BOOKING {booking.booking_reference}</span><h2>{booking.site_name}</h2>
      <p>{dateLabel(booking.slot_date)}</p></div>
      <span className={booking.payment_status === 'paid' ? 'status-tag paid' : 'status-tag'}>{bookingStatusLabel(booking.booking_status, booking.payment_method, booking.manual_payment_status)} · {booking.manual_payment_mode === 'demo' && booking.payment_status === 'paid' ? 'Demo paid' : paymentStatusLabel(booking.payment_status, booking.total_amount)}</span></div>
    <div className="booking-detail-facts"><span><small>VISITORS</small><b>{booking.adult_count} adults, {booking.child_count} children{booking.pwd_count ? `, ${booking.pwd_count} PWD` : ''}</b></span><span><small>PAYMENT METHOD</small><b>{booking.payment_method === 'onsite' ? 'Pay onsite' : 'Online'}</b></span>
      <span><small>{booking.payment_status === 'not_required' ? 'ESTIMATED FEES' : 'TOTAL'}</small><b>{money(booking.total_amount)}</b></span><span><small>REFERENCE</small><b>{booking.booking_reference}</b></span></div>
    {booking.booking_status === 'completed' && <div className="completed-visit-details">
      <span><small>CHECK-IN</small><b>{attendance?.entered_at ? timestampTimeLabel(attendance.entered_at) : 'Not recorded'}</b></span>
      <span><small>CHECK-OUT</small><b>{attendance?.exited_at ? timestampTimeLabel(attendance.exited_at) : 'Not recorded'}</b></span>
      <span><small>VISIT DURATION</small><b>{visitDurationLabel(attendance?.entered_at, attendance?.exited_at)}</b></span>
      <p><BadgeCheck size={16}/><span><b>Visit Completed</b>Your check-out was recorded. This ticket is no longer valid for entry or exit.</span></p>
    </div>}
    {booking.payment_method === 'onsite' && booking.payment_status === 'pending' && <p className="config-note">Pay at the destination before entry. Your QR ticket will be available after staff record payment.</p>}
    {booking.payment_status === 'not_required' && <p className="config-note">Fees are estimates; no payment was collected.</p>}
    {booking.booking_status === 'awaiting_payment' && <p className="config-note"><Clock3 size={16}/> This reservation is not confirmed and will expire when its hold ends.</p>}
    <div className="booking-detail-actions">
      {booking.payment_receipt_reference && booking.payment_status === 'paid' && <button className="btn btn-outline" onClick={() => onConfirmation(booking.booking_reference)}>View receipt</button>}
      {canIssueVisitorTicket(booking) && <button className="btn btn-primary" onClick={() => onTicket(booking, token)}>Open ticket <TicketIcon size={16}/></button>}
    </div>
    {canCancel && <div className="inline-action"><label>Cancellation reason<input value={cancellationReason} onChange={(event) => setCancellationReason(event.target.value)} maxLength={1000} placeholder="Tell the destination team why you need to cancel"/></label>
      <button className="btn btn-outline" disabled={cancelBusy || !cancellationReason.trim()} onClick={onCancel}>Request cancellation</button></div>}
  </article>;
}

type TicketAttendance = { visitor_count: number; entered_count: number; exited_count: number; active_count: number; entered_at: string | null; exited_at: string | null; booking_status: string };
function TicketView({ booking, ticket, userId, configured, notify, onConfirmation }: { booking: Booking; ticket: Ticket; userId: string | null; configured: boolean; notify: (message: string) => void; onConfirmation: (reference: string) => void }) {
  const [attendance, setAttendance] = useState<TicketAttendance | null>(null);
  useEffect(() => {
    if (!userId || !configured) return;
    let active = true;
    const refresh = async () => {
      const { data, error } = await db().rpc('visitor_booking_attendance', { p_booking_id: booking.booking_id });
      if (!error && active) setAttendance((Array.isArray(data) ? data[0] : data) as TicketAttendance | null);
    };
    const channel = db().channel(`visitor-ticket-attendance-${booking.booking_id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, (event) => {
        if ((event.new as { booking_id?: string | null }).booking_id === booking.booking_id) void refresh();
      }).subscribe((status) => { if (status === 'SUBSCRIBED') void refresh(); });
    void refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    return () => { active = false; window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh); void db().removeChannel(channel); };
  }, [booking.booking_id, configured, userId]);
  const attendanceState = attendance ? ticketAttendanceLabel(attendance) : null;
  const isCompleted = booking.booking_status === 'completed' || attendance?.booking_status === 'completed';
  const isExitOnly = Boolean(attendance?.active_count && attendance.entered_count >= attendance.visitor_count);
  const download = () => {
    const svg = document.querySelector('.ticket-qr svg');
    if (!svg) return;
    const qrUrl = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml;charset=utf-8' }));
    const qrImage = new Image();
    qrImage.onload = async () => {
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
      const card = (label: string, value: string, x: number, y: number, width: number, valueSize = 22) => {
        roundRect(x, y, width, 92, 12, '#f5f8fa', '#e0e8ec');
        text(label.toUpperCase(), x + 18, y + 28, '700 13px Arial, sans-serif', '#71828b');
        text(value, x + 18, y + 64, `700 ${valueSize}px Arial, sans-serif`, '#1b2935');
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
      const status = isExitOnly ? 'CHECKED IN · EXIT ONLY' : booking.payment_status === 'not_required' ? 'CONFIRMED' : booking.manual_payment_mode === 'demo' ? 'DEMO PAID · CONFIRMED' : 'PAID · CONFIRMED';
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
      card('Visit date', dateLabel(ticket.booking.slot_date), 84, 438, 210, 16);
      card('Visit time', `${timeLabel(ticket.booking.starts_at)} – ${timeLabel(ticket.booking.ends_at)}`, 310, 438, 210, 16);
      card('Visitors', String(ticket.booking.visitor_count), 536, 438, 210);
      card(booking.payment_status === 'not_required' ? 'Estimated fee' : 'Admission', money(ticket.booking.total_amount), 84, 548, 330);
      card('Payment method', booking.payment_method === 'onsite' ? 'Pay onsite' : 'Online payment', 434, 548, 330);
      roundRect(812, 230, 306, 438, 18, '#ffffff', '#dce5ea');
      context.drawImage(qrImage, 847, 265, 236, 236);
      text('PRIVATE BOOKING QR', 872, 535, '700 14px Arial, sans-serif', '#006f93');
      text('Secure booking lookup for gatekeeper.', 838, 565, '14px Arial, sans-serif', '#526471');
      text(isExitOnly ? 'Present this QR when leaving.' : 'Present this QR at entry.', 856, 591, '14px Arial, sans-serif', '#526471');
      context.strokeStyle = '#dce5ea'; context.lineWidth = 2; context.beginPath(); context.moveTo(84, 690); context.lineTo(1118, 690); context.stroke();
      text(booking.payment_status === 'not_required' ? 'Reservation record · No payment collected' : 'Reservation record', 84, 728, '700 14px Arial, sans-serif', '#526471');
      text('ILIGUIDE · ILIGAN CITY', 84, 755, '700 12px Arial, sans-serif', '#8797a2');
      try {
        const { jsPDF } = await import('jspdf');
        const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
        const pageWidth = pdf.internal.pageSize.getWidth(), pageHeight = pdf.internal.pageSize.getHeight();
        const scale = Math.min(pageWidth / canvas.width, pageHeight / canvas.height);
        const width = canvas.width * scale, height = canvas.height * scale;
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', (pageWidth - width) / 2, (pageHeight - height) / 2, width, height);
        pdf.save(booking.booking_reference + '-booking.pdf');
      } catch { notify('Could not export the ticket as a PDF.'); }
    };
    qrImage.onerror = () => { URL.revokeObjectURL(qrUrl); notify('Could not prepare the ticket QR image.'); };
    qrImage.src = qrUrl;
  };
  if (isCompleted) return <article className="ticket-card ticket-card-completed" aria-live="polite">
    <div className="completed-ticket-head"><div><span className="eyebrow"><span className="eyebrow-line"/> BOOKING {booking.booking_reference}</span><h2>{booking.site_name}</h2><p>{dateLabel(booking.slot_date)}</p></div>
      <div><span className="completed-ticket-badge"><BadgeCheck size={14}/> Completed</span><small>{booking.manual_payment_mode === 'demo' && booking.payment_status === 'paid' ? 'Demo paid' : paymentStatusLabel(booking.payment_status, booking.total_amount)}</small></div></div>
    <div className="ticket-data completed-ticket-data"><span><small>VISITORS</small><b>{booking.adult_count} adult{booking.adult_count === 1 ? '' : 's'}, {booking.child_count} children{booking.pwd_count ? `, ${booking.pwd_count} PWD` : ''}</b></span>
      <span><small>PAYMENT METHOD</small><b>{booking.payment_method === 'onsite' ? 'Pay onsite' : 'Online'}</b></span>
      <span><small>TOTAL</small><b>{money(booking.total_amount)}</b></span><span><small>REFERENCE</small><b>{booking.booking_reference}</b></span>
      <span><small>CHECK-IN</small><b>{attendance?.entered_at ? timestampTimeLabel(attendance.entered_at) : 'Not recorded'}</b></span>
      <span><small>CHECK-OUT</small><b>{attendance?.exited_at ? timestampTimeLabel(attendance.exited_at) : 'Not recorded'}</b></span>
      <span className="completed-duration"><small>VISIT DURATION</small><b>{visitDurationLabel(attendance?.entered_at, attendance?.exited_at)}</b></span></div>
    <div className="completed-ticket-notice"><BadgeCheck size={19}/><span><b>Visit Completed</b><small>Your check-out was successfully recorded. This ticket is no longer valid for entry or exit.</small></span></div>
    {booking.payment_status === 'paid' && booking.payment_receipt_reference && <button className="btn btn-outline completed-receipt" onClick={() => onConfirmation(booking.booking_reference)}><ArrowDownToLine size={15}/> View receipt</button>}
  </article>;
  return <article className="ticket-card ticket-card-live"><div className="ticket-left"><span className={isExitOnly ? 'status-tag paid' : booking.payment_status === 'paid' ? 'status-tag paid' : 'status-tag'}>{isExitOnly ? 'CHECKED IN · EXIT ONLY' : booking.payment_status === 'not_required' ? 'CONFIRMED' : booking.manual_payment_mode === 'demo' ? 'DEMO PAID · CONFIRMED' : 'PAID · CONFIRMED'}</span><h2>{booking.site_name}</h2>
    <p>{isExitOnly ? 'Ticket purpose: Exit only. Present this QR code when leaving.' : 'Present this QR code to the gatekeeper when you arrive.'}</p><div className="ticket-divider"/>
    {attendanceState && <section className={`ticket-attendance ticket-attendance-${attendanceState.tone}`} aria-live="polite"><b>{attendanceState.label}</b><span>{attendance?.entered_count} admitted · {attendance?.active_count} inside · {Math.max(0, (attendance?.visitor_count ?? 0) - (attendance?.entered_count ?? 0))} awaiting entry · {attendance?.exited_count} exited</span>{attendance?.entered_at && <small>First entry · {timestampTimeLabel(attendance.entered_at)}</small>}{attendance?.exited_at && <small>Latest exit · {timestampTimeLabel(attendance.exited_at)}</small>}</section>}
    <div className="ticket-data"><span>BOOKING REFERENCE<b>{booking.booking_reference}</b></span><span>VISITOR NAME<b>{ticket.booking.visitor_name}</b></span>
      <span>VISITOR COUNT<b>{ticket.booking.visitor_count}</b></span><span>VISIT DATE<b>{dateLabel(ticket.booking.slot_date)}</b></span>
      <span>{booking.payment_status === 'not_required' ? 'ESTIMATED FEE' : 'ADMISSION'}<b>{money(ticket.booking.total_amount)}</b></span></div></div>
    <div className="ticket-qr"><QRCodeSVG value={ticket.token} size={188} level="H" includeMargin aria-label="Secure Iliguide entry ticket QR code"/>
    <small>{isExitOnly ? 'This ticket is valid for check-out only.' : 'This private QR code contains an opaque signed ticket token, not visitor contact information.'}</small>
      <button className="btn btn-outline" onClick={download}><ArrowDownToLine size={15}/> Export booking</button></div></article>;
}

function ticketAttendanceLabel(state: TicketAttendance) {
  if (state.booking_status === 'completed') return { label: 'Visit Completed · Ticket inactive', tone: 'complete' };
  if (state.active_count > 0 && state.exited_count > 0) return { label: 'Partially checked out', tone: 'active' };
  if (state.active_count > 0 && state.entered_count < state.visitor_count) return { label: 'Partially checked in', tone: 'active' };
  if (state.active_count > 0) return { label: 'Checked in · Ticket ready for exit scan', tone: 'active' };
  if (state.entered_count > 0) return { label: 'Some visitors checked in · Others may still arrive', tone: 'pending' };
  return { label: 'Awaiting check-in', tone: 'pending' };
}

function bookingTabLabel(tab: BookingTab) {
  return ({ all: 'All', upcoming: 'Upcoming', checked_in: 'Checked In', pending: 'Pending', completed: 'Completed', cancelled: 'Cancelled & expired' } as const)[tab];
}

function visitorBookingStatus(booking: Booking) {
  if (booking.booking_status === 'completed') return 'Completed';
  if (booking.attendance?.active_count) return 'Checked in';
  return bookingStatusLabel(booking.booking_status, booking.payment_method, booking.manual_payment_status);
}

function visitDurationLabel(enteredAt?: string | null, exitedAt?: string | null) {
  if (!enteredAt || !exitedAt) return 'Not recorded';
  const minutes = Math.max(0, Math.floor((Date.parse(exitedAt) - Date.parse(enteredAt)) / 60_000));
  const hours = Math.floor(minutes / 60), remainder = minutes % 60;
  return [hours && `${hours} hour${hours === 1 ? '' : 's'}`, remainder && `${remainder} minute${remainder === 1 ? '' : 's'}`].filter(Boolean).join(' ') || 'Less than a minute';
}

function AccountPage(props: Props & { bookings: Booking[]; bookingsLoading: boolean }) {
  const [accountTab, setAccountTab] = useState<'profile' | 'travelers' | 'saved' | 'notifications' | 'support' | 'security'>('profile');
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
  const [avatarUrl, setAvatarUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
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
    { id: 'security', label: 'Password and security' },
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
    const channel = db().channel(`visitor-account-notifications-${props.user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${props.user.id}` }, (payload) => {
        if (!active) return;
        const notice = payload.new as Notice;
        if (payload.eventType === 'INSERT') setNotices((current) => current.some((item) => item.id === notice.id) ? current : [notice, ...current].slice(0, 30));
        if (payload.eventType === 'UPDATE') setNotices((current) => current.map((item) => item.id === notice.id ? { ...item, read_at: notice.read_at } : item));
      }).subscribe();
    void (async () => {
      try {
        const { data, error } = await db().from('notifications').select('id,title,message,notification_type,created_at,read_at')
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
        } else if (active) {
          setAvatarUrl('');
        }
      } catch (error) { if (active) props.notify(error instanceof Error ? error.message : 'Could not load account activity.'); }
    })();
    return () => { active = false; void db().removeChannel(channel); };
  }, [props.user?.id, props.profile?.avatar_path, props.configured]);
  const save = async () => {
    if (!props.user) { props.notify('Sign in to update your account.'); return; }
    const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
    if (!firstName.trim() || !lastName.trim() || fullName.length > 120) { props.notify('Enter first and last names, up to 120 characters total.'); return; }
    if (!isValidOptionalPhone(phone)) { props.notify('Enter a valid phone number (7–15 digits) or leave it blank.'); return; }
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
          {accountTab === 'notifications' && <section className="profile-tab-content"><div className="profile-tab-heading"><div><span className="eyebrow"><span className="eyebrow-line"/> ACCOUNT ACTIVITY</span><h2>Notifications</h2><p>Booking updates and destination notices appear here. Promotional messages are optional.</p></div><span>{notices.filter((item) => !item.read_at).length} unread</span></div>
            <label className="preference-toggle"><input type="checkbox" checked={marketingOptIn} onChange={(event) => void saveNotificationPreferences(event.target.checked)}/> Promotional announcements</label>
            {!notices.length && <div className="empty-inline">No account notifications.</div>}{notices.map((notice) => <button className={notice.read_at ? 'notification-row' : 'notification-row unread'} key={notice.id} onClick={() => { void markRead(notice); if (notice.notification_type === 'review_request') props.go('Bookings'); }}><span><b>{notice.title}</b><small>{notice.message}</small><time>{new Date(notice.created_at).toLocaleString()}</time></span>{!notice.read_at && <i/>}</button>)}
          </section>}
          {accountTab === 'support' && <section className="profile-tab-content"><div className="profile-tab-heading"><div><span className="eyebrow"><span className="eyebrow-line"/> VISITOR HELP</span><h2>Customer support</h2><p>Send a booking question or concern and check its status here.</p></div></div>
            <div className="support-faq"><details><summary>How do I find a booking?</summary><p>Sign in with the visitor account used to reserve, then open My bookings.</p></details><details><summary>When is a ticket available?</summary><p>After the reservation is confirmed. Present its QR code at the destination for gate validation. Admission remains subject to the destination’s current rules.</p></details><details><summary>How do I change or cancel a reservation?</summary><p>Open the reservation in My bookings and submit a request when the option is available.</p></details></div>
            <form className="support-form" onSubmit={(event) => void submitSupport(event)}><label>Topic<select value={supportSubject} onChange={(event) => setSupportSubject(event.target.value)}><option>Booking question</option><option>Complaint or concern</option><option>Account help</option><option>Other</option></select></label><label>Related booking<select value={supportBookingId} onChange={(event) => setSupportBookingId(event.target.value)}><option value="">No booking reference</option>{props.bookings.map((booking) => <option key={booking.booking_id} value={booking.booking_id}>{booking.booking_reference} · {booking.site_name}</option>)}</select></label><label>Message<textarea value={supportMessage} onChange={(event) => setSupportMessage(event.target.value)} minLength={10} maxLength={4000} rows={4} required/></label><button className="btn btn-primary" disabled={accountBusy || supportMessage.trim().length < 10}>Send support request</button></form>
            <h3 className="support-history-title">Your support requests</h3>{!supportRequests.length && <div className="empty-inline">No requests yet.</div>}{supportRequests.map((request) => { const booking = props.bookings.find((item) => item.booking_id === request.booking_id); return <div className="support-request-row" key={request.id}><div><b>{request.subject}</b><span className="status-tag">{request.status.replace('_', ' ')}</span><small>{booking ? booking.booking_reference + ' · ' : ''}{new Date(request.created_at).toLocaleString()}</small><p>{request.message}</p>{request.staff_response && <blockquote>{request.staff_response}</blockquote>}</div></div>; })}
          </section>}
          {accountTab === 'security' && <section className="profile-tab-content"><div className="profile-tab-heading"><div><span className="eyebrow"><span className="eyebrow-line"/> ACCOUNT SECURITY</span><h2>Password and security</h2><p>Change the password used to sign in to your visitor account.</p></div></div>
            {props.user && <ChangePasswordForm user={props.user} notify={props.notify}/>}
            <button className="link-btn" onClick={props.onPasswordReset}>Forgot password?</button>
          </section>}
        </div>
      </div>
    </div>
  </section>;
}
