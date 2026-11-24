import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { RealtimeChannel, User } from '@supabase/supabase-js';
import { ArrowRight, BadgeCheck, CalendarDays, Clock3, Compass, MapPinned, Megaphone, MessageSquareText, RefreshCw, Ticket as TicketIcon, Users } from 'lucide-react';
import { canIssueVisitorTicket, upcomingBookings } from '../lib/visitorPlanning';
import { db, dateLabel, loadOwnBookings, timeLabel, type Booking, type Site } from '../lib/iliguide';
import { bookingStatusLabel, isFreeRegistration, paymentStatusLabel } from '../lib/paymentStatus';
import './VisitorPlanningHub.css';
import './VisitorAnnouncements.css';

type Page = 'Destinations' | 'Destination map' | 'Bookings' | 'Tickets';
type Announcement = { id: string; site_id: string; announcement_group_id: string; title: string; body_preview: string; category: string; published_at: string; expires_at: string | null };
type Update = { id: string; siteIds: string[]; title: string; bodyPreview: string; category: string; publishedAt: string };

const publishedDate = (value: string) => new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium' }).format(new Date(value));
const todayPh = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
const nowTimePh = () => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());

export function VisitorPlanningHub({ sites, user, visitorActive, configured, ticketBusy, onGo, onLogin, onTicket, onRateReview, children }: {
  sites: Site[]; user: User | null; visitorActive: boolean; configured: boolean; ticketBusy: boolean;
  onGo: (page: Page) => void; onLogin: (returnTo: string) => void; onTicket: (booking: Booking) => void;
  onRateReview: () => void; children?: ReactNode;
}) {
  const location = useLocation();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [bookingError, setBookingError] = useState(false);
  const [bookingReload, setBookingReload] = useState(0);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [updatesLoading, setUpdatesLoading] = useState(false);
  const [updatesError, setUpdatesError] = useState(false);
  const [updatesReload, setUpdatesReload] = useState(0);
  const siteIds = useMemo(() => sites.map((site) => site.id), [sites]);
  const siteKey = siteIds.join(',');
  const siteById = useMemo(() => new Map(sites.map((site) => [site.id, site])), [sites]);
  const upcoming = useMemo(() => upcomingBookings(bookings, todayPh(), nowTimePh()), [bookings]);
  const nextVisit = useMemo(() => upcoming.reduce<Booking | null>((latest, booking) =>
    !latest || booking.created_at > latest.created_at ? booking : latest, null), [upcoming]);
  const nextVisitSite = nextVisit ? siteById.get(nextVisit.site_id) : undefined;

  useEffect(() => {
    if (!user || !visitorActive || !configured) {
      setBookings([]); setBookingLoading(false); setBookingError(false); return;
    }
    let active = true;
    setBookings([]); setBookingLoading(true); setBookingError(false);
    void loadOwnBookings().then((rows) => {
      if (active) setBookings(rows);
    }).catch(() => {
      if (active) { setBookings([]); setBookingError(true); }
    }).finally(() => { if (active) setBookingLoading(false); });
    return () => { active = false; };
  }, [user?.id, visitorActive, configured, bookingReload]);

  useEffect(() => {
    if (!configured || !siteKey) {
      setAnnouncements([]); setUpdatesLoading(false); setUpdatesError(false); return;
    }
    let active = true;
    setAnnouncements([]); setUpdatesLoading(true); setUpdatesError(false);
    const load = async () => {
      try {
        const now = new Date().toISOString();
        const { data, error } = await db().from('site_announcements')
          .select('id,site_id,announcement_group_id,title,body_preview,category,published_at,expires_at')
          .in('site_id', siteIds).eq('status', 'published').lte('published_at', now)
          .or(`expires_at.is.null,expires_at.gt.${now}`)
          .order('published_at', { ascending: false }).order('announcement_group_id').limit(150);
        if (error) throw error;
        if (active) { setAnnouncements((data ?? []) as Announcement[]); setUpdatesError(false); }
      } catch {
        if (active) setUpdatesError(true);
      } finally { if (active) setUpdatesLoading(false); }
    };
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    let channel: RealtimeChannel | null = null;
    try {
      channel = db().channel('visitor-site-announcements')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'site_announcements' }, () => void load())
        .subscribe();
    } catch { /* The timed refresh remains available if Realtime cannot start. */ }
    return () => {
      active = false;
      window.clearInterval(timer);
      if (channel) void db().removeChannel(channel);
    };
  }, [configured, siteKey, updatesReload]);

  const updates = useMemo(() => {
    const grouped = new Map<string, Update>();
    for (const announcement of announcements) {
      if (!siteById.has(announcement.site_id)) continue;
      const group = announcement.announcement_group_id || announcement.id;
      const update = grouped.get(group);
      if (update) {
        if (!update.siteIds.includes(announcement.site_id)) update.siteIds.push(announcement.site_id);
      } else grouped.set(group, { id: announcement.id, siteIds: [announcement.site_id], title: announcement.title, bodyPreview: announcement.body_preview, category: announcement.category, publishedAt: announcement.published_at });
    }
    return [...grouped.values()];
  }, [announcements, siteById]);
  const openPrivate = (page: 'Bookings' | 'Tickets') => visitorActive ? onGo(page) : onLogin(page === 'Tickets' ? '/tickets' : '/bookings');

  return <section className="visitor-planning section-wrap" aria-labelledby="visitor-planning-title">
    <div className="visitor-planning-top">
      <div className="visitor-planning-intro"><span className="eyebrow"><span className="eyebrow-line"/> PLAN YOUR VISIT</span>
        <h2 id="visitor-planning-title">Plan, Reserve,<br/>and <em>Explore Iligan.</em></h2>
        <p>Find destinations, check availability, secure your visit, and get ready for your next adventure.</p>
        <button className="btn btn-primary" type="button" onClick={() => document.getElementById('destinations')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Explore Destinations</button>
      </div>
      <div className="visitor-planning-actions" aria-label="Visitor actions">
        <button className="visitor-planning-action" onClick={() => onGo('Destinations')}><CalendarDays/><span><b>Book a Visit</b><small>Reserve your visit at your chosen destination.</small></span><ArrowRight/></button>
        <button className="visitor-planning-action" onClick={() => openPrivate('Tickets')}><TicketIcon/><span><b>My QR Tickets</b><small>Access and present your booking QR code.</small></span><ArrowRight/></button>
        <button className="visitor-planning-action" onClick={() => onGo('Destination map')}><MapPinned/><span><b>Capacity Map</b><small>Check recorded crowd levels and find less crowded spots.</small></span><ArrowRight/></button>
        <button className="visitor-planning-action" onClick={onRateReview}><MessageSquareText/><span><b>Rate &amp; Give Feedback</b><small>Review completed visits and share your experience.</small></span><ArrowRight/></button>
      </div>
    </div>

    {children}

    <div className="visitor-overview">
      <section className="visitor-overview-card visitor-upcoming" aria-labelledby="upcoming-visit-title">
        <div className="visitor-overview-heading"><CalendarDays/><div><h3 id="upcoming-visit-title">Your Upcoming Visit</h3><p>Your most recently booked upcoming visit.</p></div>
          {visitorActive && <button type="button" className="visitor-refresh" aria-label="Refresh upcoming visits" onClick={() => setBookingReload((value) => value + 1)}><RefreshCw size={16}/></button>}</div>
        {!visitorActive ? <div className="visitor-upcoming-empty"><p>{user ? 'Upcoming reservations require an active visitor account.' : 'Sign in to see reservations linked to your visitor account.'}</p>{!user && <button className="btn btn-outline" onClick={() => onLogin('/bookings')}>Sign in <ArrowRight size={15}/></button>}</div>
          : !configured ? <div className="visitor-upcoming-empty" role="status"><p>Your booking connection is unavailable right now.</p></div>
          : bookingLoading ? <div className="visitor-planning-skeleton" role="status" aria-label="Loading your upcoming visit"><i/><i/><i/></div>
          : bookingError ? <div className="visitor-upcoming-empty" role="status"><p>Could not load your bookings.</p><button className="btn btn-outline" onClick={() => setBookingReload((value) => value + 1)}>Try again <RefreshCw size={14}/></button></div>
          : nextVisit ? <>
            <article className="visitor-upcoming-booking">
              {nextVisitSite?.images[0] ? <img src={nextVisitSite.images[0].public_url} alt={nextVisitSite.images[0].alt_text || nextVisit.site_name}/> : <span className="visitor-upcoming-placeholder" aria-hidden="true"><Compass size={24}/></span>}
              <div className="visitor-upcoming-details"><span className="visitor-booking-reference">{nextVisit.booking_reference}</span><h4>{nextVisit.site_name}</h4>
                <span><CalendarDays size={15}/>{dateLabel(nextVisit.slot_date)}</span>
                {nextVisit.starts_at && nextVisit.ends_at && <span><Clock3 size={15}/>{timeLabel(nextVisit.starts_at)}–{timeLabel(nextVisit.ends_at)}</span>}
                <span><Users size={15}/>{nextVisit.visitor_count} visitor{nextVisit.visitor_count === 1 ? '' : 's'}</span>
                <span className="visitor-registration-status"><BadgeCheck size={15}/>{isFreeRegistration(nextVisit.payment_status, nextVisit.total_amount) ? 'Free reservation' : paymentStatusLabel(nextVisit.payment_status, nextVisit.total_amount)}</span>
              </div>
              <span className={`visitor-booking-state visitor-state-${nextVisit.booking_status}`}>{bookingStatusLabel(nextVisit.booking_status, nextVisit.payment_method, nextVisit.manual_payment_status)}</span>
              <div className="visitor-upcoming-buttons"><button className="btn btn-outline" onClick={() => onGo('Bookings')}>View My Booking <ArrowRight size={14}/></button>
                {canIssueVisitorTicket(nextVisit) && <button className="btn btn-primary" disabled={ticketBusy} onClick={() => onTicket(nextVisit)}><TicketIcon size={15}/>{ticketBusy ? 'Opening…' : 'View QR Ticket'}</button>}
              </div>
            </article>
            {upcoming.length > 1 && <button className="visitor-view-all" onClick={() => onGo('Bookings')}>View all {upcoming.length} upcoming bookings <ArrowRight size={14}/></button>}
            {!canIssueVisitorTicket(nextVisit) && <p className="visitor-ticket-note">A QR ticket appears after this reservation meets its confirmation rules.</p>}
          </> : <div className="visitor-upcoming-empty"><CalendarDays size={28}/><b>No upcoming visits yet.</b><p>Explore destinations and reserve your next adventure.</p><button className="btn btn-outline" onClick={() => onGo('Destinations')}>Find a Destination <ArrowRight size={15}/></button></div>}
      </section>
      <section id="destination-updates" className="visitor-overview-card visitor-updates" aria-labelledby="destination-updates-title">
        <div className="visitor-overview-heading"><Megaphone/><div><h3 id="destination-updates-title">Destination Updates</h3><p>Announcements and important updates from destinations.</p></div>
          <button type="button" className="visitor-refresh" aria-label="Refresh destination announcements" onClick={() => setUpdatesReload((value) => value + 1)}><RefreshCw size={16}/></button></div>
        {updatesLoading && !updates.length ? <div className="visitor-planning-skeleton" role="status" aria-label="Loading destination announcements"><i/><i/><i/></div>
          : updates.length ? <><div className="visitor-update-list">{updates.slice(0, 3).map((item) => {
            return <article className={`visitor-update visitor-update-${item.category}`} key={item.id}>
              <span className="visitor-update-icon"><Megaphone size={19}/></span>
              <span className="visitor-update-copy"><b>{item.title}</b><span>{item.bodyPreview}</span><small className="visitor-update-date">Published {publishedDate(item.publishedAt)}</small><Link className="visitor-update-link" to={`/announcements/${encodeURIComponent(item.id)}`} state={{ from: `${location.pathname}#destination-updates` }}>See Details <ArrowRight size={14}/></Link></span>
            </article>;
          })}</div>{updates.length > 3 && <Link className="visitor-view-all visitor-updates-all" to="/announcements">View All Updates <ArrowRight size={14}/></Link>}</>
          : updatesError ? <div className="visitor-updates-empty" role="status"><p>Destination announcements are temporarily unavailable.</p><button className="link-btn" onClick={() => setUpdatesReload((value) => value + 1)}>Try again <RefreshCw size={14}/></button></div>
            : <div className="visitor-updates-empty"><p>No destination updates are available at the moment.</p></div>}
      </section>
    </div>
  </section>;
}
