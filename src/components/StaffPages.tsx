import { Fragment, useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Activity, ArrowDownToLine, ArrowLeft, ArrowRight, BookOpen, Building2, CalendarClock, CalendarDays, Camera, ChartNoAxesCombined, Check, History, ImagePlus, LayoutDashboard, MapPin, MapPinned, Plus, Printer, RefreshCw, ScanLine, ShieldCheck, Ticket as TicketIcon, Users, UserRound, X, type LucideIcon } from 'lucide-react';
import type { User } from '@supabase/supabase-js';
import { db, dateLabel, exportCsv, invokeFunction, loadLiveOccupancy, loadMyActiveGatekeeperDuty, loadSlots, money, timeLabel, type GatekeeperDuty, type LiveOccupancy, type Profile, type Site, type Slot, type StaffAssignment } from '../lib/iliguide';
import { emptyVisitorInformation, requiredVisitorFields, resizeVisitorInformation, visitorInformationComplete, visitorInformationPayload } from '../lib/visitorInformation';
import { bookingContactError } from '../lib/bookingValidation';
import { paymentStatusLabel } from '../lib/paymentStatus';
import { useSilentLoad } from '../lib/useSilentLoad';
import { VisitorInformationForm } from './VisitorInformationForm';
import DestinationMap from './DestinationMap';
import type { GatekeeperPage } from '../lib/gatekeeperRoutes';
import './DutyRoster.css';
import './CancellationReview.css';

type Role = Profile['role'];
type Page = GatekeeperPage | 'Slots and closures' | 'Staff and accounts' | 'Sites and staff' | 'Duty roster';
type Props = {
  page: Page; role: Role; sites: Site[]; siteId: string; setSiteId: (value: string) => void;
  assignments: StaffAssignment[]; notify: (message: string) => void; busy: boolean;
  setBusy: (value: boolean) => void; refresh: () => void; go: (page: Page) => void;
  user: User | null;
};
const phToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const phTime = () => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
const currentSlots = (rows: Slot[]) => {
  const now = phTime();
  return rows.filter((slot) => slot.slot_date === phToday() && slot.status === 'open' && slot.remaining_capacity > 0 && slot.starts_at.slice(0, 5) <= now && slot.ends_at.slice(0, 5) > now);
};
const localStart = (day: string) => new Date(day + 'T00:00:00+08:00').toISOString();
const localEnd = (day: string) => new Date(day + 'T23:59:59.999+08:00').toISOString();

export function StaffPages(props: Props) {
  const staffScopeKey = `${props.user?.id ?? 'staff'}:${props.role}:${props.siteId}`;
  if (props.role === 'gatekeeper') {
    if (!assignedGatekeeperSite(props)) return <StaffConsole {...props}><section className="dashboard-page"><div className="empty-card"><ShieldCheck size={30}/><h3>No destination assigned</h3><p>Gatekeeper access stays disabled until the Tourism Office assigns exactly one active destination.</p></div></section></StaffConsole>;
    let content = <AccessNotice/>;
    if (props.page === 'Overview') content = <OverviewPage {...props}/>;
    if (props.page === 'Reservations') content = <ReservationsPage {...props}/>;
    if (props.page === 'Visitor Management' || props.page === 'Visitor Logbook') content = <VisitorLogbookPage {...props}/>;
    if (props.page === 'Scan and exit') content = <ScannerPage {...props}/>;
    if (props.page === 'Walk-in registration') content = <WalkInPage {...props}/>;
    if (props.page === 'Capacity map') content = <CapacityMapPage {...props}/>;
    if (props.page === 'Duty details') content = <DutyDetailsPage {...props}/>;
    if (props.page === 'Reports') content = <ReportsPage {...props}/>;
    if (props.page === 'Activity') content = <ActivityPage {...props}/>;
    return <StaffConsole {...props}><GatekeeperDutyGate {...props} content={<Fragment key={staffScopeKey}>{content}</Fragment>}/></StaffConsole>;
  }
  let content: ReactNode = <OverviewPage {...props}/>;
  if (props.page === 'Scan and exit' || props.page === 'Walk-in registration') content = <AccessNotice/>;
  else if (props.page === 'Slots and closures') content = props.role === 'site_admin' || props.role === 'tourism_office' ? <SchedulePage {...props}/> : <AccessNotice/>;
  else if (props.page === 'Staff and accounts') content = props.role === 'site_admin' || props.role === 'tourism_office' ? <PeoplePage {...props}/> : <AccessNotice/>;
  else if (props.page === 'Reports') content = props.role === 'site_admin' || props.role === 'tourism_office' ? <ReportsPage {...props}/> : <AccessNotice/>;
  else if (props.page === 'Sites and staff') content = props.role === 'tourism_office' ? <SitesPage {...props}/> : <AccessNotice/>;
  else if (props.page === 'Duty roster') content = props.role === 'site_admin' || props.role === 'tourism_office' ? <DutyRosterPage {...props}/> : <AccessNotice/>;
  else if (props.page === 'Capacity map') content = <CapacityMapPage {...props}/>;
  else if (props.page === 'Visitor Logbook') content = props.role === 'site_admin' || props.role === 'tourism_office' ? <VisitorLogbookPage {...props}/> : <AccessNotice/>;
  else if (props.page === 'Activity') content = props.role === 'tourism_office' ? <ActivityPage {...props}/> : <AccessNotice/>;
  return <StaffConsole {...props}><Fragment key={staffScopeKey}>{content}</Fragment></StaffConsole>;
}

function StaffConsole(props: Props & { children: ReactNode }) {
  const items: Array<[string, Page, LucideIcon]> = props.role === 'gatekeeper'
    ? [['Dashboard', 'Overview', LayoutDashboard], ['Reservations', 'Reservations', CalendarDays], ['Visitors', 'Visitor Management', Users], ['Check-in', 'Scan and exit', ScanLine], ['Walk-ins', 'Walk-in registration', TicketIcon], ['Daily logbook', 'Visitor Logbook', BookOpen], ['Capacity map', 'Capacity map', MapPinned], ['Reports', 'Reports', ChartNoAxesCombined], ['Activity', 'Activity', History], ['Today’s duty', 'Duty details', CalendarClock]]
    : props.role === 'tourism_office'
      ? [['Overview', 'Overview', LayoutDashboard], ['Duty roster', 'Duty roster', CalendarClock], ['Destinations & staff', 'Sites and staff', Building2], ['Operating hours & slots', 'Slots and closures', CalendarDays], ['Staff & accounts', 'Staff and accounts', Users], ['Visitor logbook', 'Visitor Logbook', BookOpen], ['Capacity map', 'Capacity map', MapPinned], ['Reports', 'Reports', ChartNoAxesCombined], ['Activity', 'Activity', History]]
      : [['Overview', 'Overview', LayoutDashboard], ['Operating hours & slots', 'Slots and closures', CalendarDays], ['Staff & accounts', 'Staff and accounts', Users], ['Visitor logbook', 'Visitor Logbook', BookOpen], ['Capacity map', 'Capacity map', MapPinned], ['Duty roster', 'Duty roster', CalendarClock], ['Reports', 'Reports', ChartNoAxesCombined]];
  const roleName = props.role === 'tourism_office' ? 'Tourism Office' : props.role === 'site_admin' ? 'Site administrator' : 'Site gatekeeper';
  const userName = String(props.user?.user_metadata?.full_name ?? props.user?.email ?? 'Staff account');
  return <div className={'staff-console staff-console-' + props.role}>
    <aside className="staff-sidebar"><div className="staff-sidebar-label"><span className="eyebrow"><span className="eyebrow-line"/> {roleName.toUpperCase()}</span><p>Operations workspace</p></div>
      <nav className="staff-sidebar-nav" aria-label={`${roleName} navigation`}>{items.map(([label, target, Icon]) => <button key={target} className={props.page === target ? 'active' : ''} aria-current={props.page === target ? 'page' : undefined} onClick={() => props.go(target)}><Icon size={17}/><span>{label}</span></button>)}</nav>
      <div className="staff-sidebar-account"><span className="staff-account-icon"><UserRound size={17}/></span><span><b>{userName}</b><small>{props.user?.email ?? roleName}</small></span></div>
    </aside>
    <div className="staff-console-main"><nav className="staff-mobile-nav" aria-label={`${roleName} navigation`}>{items.map(([label, target, Icon]) => <button key={target} className={props.page === target ? 'active' : ''} aria-current={props.page === target ? 'page' : undefined} onClick={() => props.go(target)}><Icon size={15}/>{label}</button>)}</nav>{props.children}</div>
  </div>;
}

function GatekeeperDutyGate(props: Props & { content: ReactNode }) {
  const site = assignedGatekeeperSite(props);
  const [duty, setDuty] = useState<GatekeeperDuty | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'locked' | 'unavailable'>('loading');
  useEffect(() => {
    let active = true;
    if (!site) { setState('locked'); return () => { active = false; }; }
    setState('loading');
    void loadMyActiveGatekeeperDuty(site.id).then((row) => {
      if (!active) return;
      setDuty(row);
      setState(row ? 'ready' : 'locked');
    }).catch(() => { if (active) setState('unavailable'); });
    return () => { active = false; };
  }, [site?.id]);
  return <>
    {state === 'loading' && <section className="dashboard-page section-wrap"><div className="empty-card"><ShieldCheck size={30}/><h3>Checking gatekeeper duty</h3><p>Loading the active duty roster for this destination.</p></div></section>}
    {state === 'unavailable' && <section className="dashboard-page section-wrap"><div className="empty-card"><ShieldCheck size={30}/><h3>Duty roster setup is unavailable</h3><p>Apply the latest database migration, then create an active duty roster entry.</p></div></section>}
    {state === 'locked' && <>{props.page === 'Duty details' ? props.content : <section className="dashboard-page"><div className="empty-card"><ShieldCheck size={30}/><h3>Gatekeeper duty required</h3><p>Your account is active, but you are not assigned as gatekeeper for this destination and shift. Contact your supervisor.</p><button className="btn btn-outline" onClick={() => props.go('Duty details')}>View assigned duty</button></div></section>}</>}
    {state === 'ready' && <><section className="duty-context"><ShieldCheck size={17}/><span><b>{site?.name}</b><small>{props.user?.email}</small> · {duty?.duty_role === 'primary' ? 'Primary Responsible Gatekeeper' : 'Support Gatekeeper'} · Primary: {duty?.primary_gatekeeper_name} · {new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium' }).format(new Date(duty!.duty_date + 'T00:00:00+08:00'))} · Ends {new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' }).format(new Date(duty!.shift_end_at))}</span></section>{props.content}</>}
  </>;
}

function assignedGatekeeperSite(props: Props) {
  const assigned = props.assignments.filter((assignment) => assignment.staff_role === 'gatekeeper' && assignment.is_active);
  return assigned.length === 1 && assigned[0].site_id === props.siteId
    ? props.sites.find((site) => site.id === props.siteId) : undefined;
}

function SiteSelector({ sites, siteId, setSiteId }: Pick<Props, 'sites' | 'siteId' | 'setSiteId'>) {
  return <select aria-label="Active destination" value={siteId} onChange={(event) => setSiteId(event.target.value)}>
    {!sites.length && <option value="">No assigned destinations</option>}
    {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
  </select>;
}

function OverviewPage(props: Props) {
  const [rows, setRows] = useState<Array<Record<string, any>>>([]);
  const [todayMetrics, setTodayMetrics] = useState<Record<string, any> | null>(null);
  const [liveOccupancy, setLiveOccupancy] = useState<LiveOccupancy | null>(null);
  const [totalReservations, setTotalReservations] = useState(0);
  const [upcoming, setUpcoming] = useState<Array<Record<string, any>>>([]);
  const [activity, setActivity] = useState<Array<Record<string, any>>>([]);
  const monthStart = phToday().slice(0, 8) + '01';
  const isGatekeeper = props.role === 'gatekeeper';
  const site = isGatekeeper ? assignedGatekeeperSite(props) : props.sites.find((item) => item.id === props.siteId);
  const [loading, finishLoading] = useSilentLoad(`${props.user?.id ?? 'staff'}:${props.role}:${site?.id ?? props.siteId}:${monthStart}`);
  const refresh = useCallback(async () => {
    try {
      if (isGatekeeper) {
        if (!site) throw new Error('No single active destination assignment. Ask the Tourism Office to resolve the assignment.');
        const today = phToday();
        const horizon = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + 7 * 86400000));
        const [daily, total, reservations, events, occupancy] = await Promise.all([
          db().from('site_visit_daily_metrics').select('*').eq('site_id', site.id).eq('report_date', today).maybeSingle(),
          db().from('bookings').select('id', { count: 'exact', head: true }).eq('site_id', site.id).neq('booking_status', 'expired'),
          db().from('bookings').select('id,booking_reference,visitor_name,visitor_count,booking_status,site_slots!inner(slot_date,starts_at)')
            .eq('site_id', site.id).gte('site_slots.slot_date', today).lte('site_slots.slot_date', horizon)
            .in('booking_status', ['confirmed', 'awaiting_payment']).order('created_at').limit(12),
          db().from('audit_logs').select('id,action,entity_type,created_at').eq('site_id', site.id)
            .order('created_at', { ascending: false }).limit(8),
          loadLiveOccupancy(site.id).catch(() => null),
        ]);
        for (const result of [daily, total, reservations, events]) if (result.error) throw result.error;
        setTodayMetrics(daily.data ?? null);
        setTotalReservations(total.count ?? 0);
        setUpcoming((reservations.data ?? []) as Array<Record<string, any>>);
        setActivity(events.data ?? []);
        setLiveOccupancy(occupancy);
      } else {
        let query = db().from('booking_daily_metrics')
          .select('site_id, report_date, booking_count, visitor_count, walk_in_count, online_count, paid_revenue')
          .gte('report_date', monthStart).lte('report_date', phToday());
        if (props.siteId && props.role !== 'tourism_office') query = query.eq('site_id', props.siteId);
        const { data, error } = await query.order('report_date', { ascending: true });
        if (error) throw error;
        setRows((data ?? []) as Array<Record<string, any>>);
      }
    } catch (error) {
      props.notify(error instanceof Error ? error.message : 'Could not load workspace metrics.');
    } finally { finishLoading(); }
  }, [finishLoading, isGatekeeper, monthStart, props.notify, props.role, props.siteId, site?.id]);
  useEffect(() => { void refresh(); }, [refresh]);
  const metric = (key: string) => rows.reduce((sum, row) => sum + Number(row[key] ?? 0), 0);
  const lastDays = rows.slice(-14);
  const maxVisitors = Math.max(1, ...lastDays.map((row) => Number(row.visitor_count ?? 0)));
  return <section className={'dashboard-page section-wrap' + (isGatekeeper ? ' gatekeeper-overview' : '')}>
    <div className="dash-header"><div><span className="eyebrow"><span className="eyebrow-line"/> {props.role.replace('_', ' ').toUpperCase()}</span>
      <h1>{isGatekeeper ? <>{site?.name ?? 'Gatekeeper'} <em>dashboard.</em></> : props.role === 'tourism_office' ? <>Tourism <em>network.</em></> : <>Site <em>overview.</em></>}
      </h1><p>{isGatekeeper ? 'Destination operations · ' + phToday()
        : 'Live records for ' + (props.role === 'tourism_office' ? 'all accessible destinations.' : site?.name ?? 'your assigned destination.')}</p></div>
      <div className="header-actions">{!isGatekeeper && <SiteSelector {...props}/>}<button className="btn btn-outline" onClick={() => void refresh()}><RefreshCw size={15}/> Refresh</button></div></div>
    {isGatekeeper ? <><div className="stats-grid">{[
      [totalReservations, 'Total reservations'],
      [todayMetrics?.booking_count ?? 0, 'Today’s reservations'],
      [todayMetrics?.expected_visitor_count ?? 0, 'Expected visitors today'],
      [liveOccupancy?.current_visitor_count ?? '—', 'Estimated currently inside'],
      [liveOccupancy?.arrivals_today ?? '—', 'Recorded arrivals today'],
      [liveOccupancy?.departures_today ?? '—', 'Recorded departures today'],
      [Math.max(0, Number(todayMetrics?.expected_visitor_count ?? 0) - Number(todayMetrics?.checked_in_visitor_count ?? 0)), 'Not yet checked in'],
      [todayMetrics?.pending_booking_count ?? 0, 'Awaiting payment'],
      [todayMetrics?.confirmed_booking_count ?? 0, 'Confirmed'],
      [todayMetrics?.cancelled_booking_count ?? 0, 'Cancelled'],
    ].map(([value, label]) => <div key={String(label)}><b>{loading ? '…' : value}</b><small>{label}</small></div>)}</div>
      {liveOccupancy && <p className="report-note"><ShieldCheck size={15}/> Occupancy estimate uses recorded arrivals minus departures. {liveOccupancy.last_recorded_at ? `Last attendance event: ${new Date(liveOccupancy.last_recorded_at).toLocaleString()}.` : 'No attendance event recorded yet.'}</p>}
      <div className="dashboard-grid"><div className="arrivals-card"><div className="card-heading"><span><small>UPCOMING · ASSIGNED DESTINATION</small><h3>Reservations</h3></span><button className="link-btn" onClick={() => props.go('Reservations')}>View all <ArrowRight size={14}/></button></div>
      {loading && <div className="empty-inline">Loading reservations…</div>}
        {!loading && !upcoming.length && <div className="empty-inline">No upcoming reservations for this destination.</div>}
        {!loading && upcoming.map((booking) => { const slot = Array.isArray(booking.site_slots) ? booking.site_slots[0] : booking.site_slots; return <div className="arrival-row" key={booking.id}>
          <span className="arrival-initial">{String(booking.visitor_name ?? '?').slice(0, 1).toUpperCase()}</span>
          <span><b>{booking.visitor_name}</b><small>{booking.booking_reference} · {dateLabel(slot?.slot_date)} · {slot?.starts_at ? timeLabel(slot.starts_at) : ''} · {booking.visitor_count} visitors</small></span>
          <span className="status-tag">{String(booking.booking_status).replace(/_/g, ' ')}</span>
        </div>; })}
      </div><div className="activity-card"><div className="card-heading"><span><small>RECENT CHANGES</small><h3>Destination activity</h3></span><Activity size={18}/></div>
        {loading && <div className="empty-inline">Loading activity…</div>}
        {!loading && !activity.length && <div className="empty-inline">No activity recorded yet.</div>}
        {!loading && activity.map((event) => <div className="audit-row" key={event.id}><span><b>{String(event.action).replace(/_/g, ' ')}</b><small>{event.entity_type}</small></span><time>{new Date(event.created_at).toLocaleTimeString()}</time></div>)}
      </div></div>
    </> : <><div className="stats-grid">{[
      [metric('visitor_count').toLocaleString(), 'Visitors this month'],
      [metric('online_count').toLocaleString(), 'Online bookings'],
      [metric('walk_in_count').toLocaleString(), 'Walk-in bookings'],
    ].map(([value, label]) => <div key={label}><b>{loading ? '…' : value}</b><small>{label}</small></div>)}</div>
      <div className="dashboard-grid"><div className="chart-card"><div className="card-heading"><span><small>RECORDED VISITS · ASIA/MANILA</small><h3>Visitor activity</h3></span><CalendarDays size={18}/></div>
        {!loading && lastDays.length ? <div className="bar-chart">{lastDays.map((row) => <div className="bar-column" key={row.report_date}><i style={{ height: (Number(row.visitor_count) / maxVisitors * 100) + '%' }}/><small>{String(row.report_date).slice(8)}</small></div>)}</div>
          : <div className="empty-inline">{loading ? 'Loading records…' : 'No booking records for this month.'}</div>}
        <p className="report-note"><ShieldCheck size={15}/> Counts come from confirmed database records and are scoped by staff permissions.</p></div>
        <div className="activity-card"><div className="card-heading"><span><small>WORKSPACE</small><h3>Quick actions</h3></span><Activity size={18}/></div>
          {props.role === 'tourism_office' ? <><button className="quick-row" onClick={() => props.go('Sites and staff')}><MapPin size={17}/> Manage destinations <ArrowRight size={14}/></button><button className="quick-row" onClick={() => props.go('Reports')}><ArrowDownToLine size={17}/> Export reports <ArrowRight size={14}/></button></>
            : <><button className="quick-row" onClick={() => props.go('Slots and closures')}><CalendarDays size={17}/> Manage visit slots <ArrowRight size={14}/></button><button className="quick-row" onClick={() => props.go('Staff and accounts')}><Users size={17}/> Staff & accounts <ArrowRight size={14}/></button></>}</div></div>
    </>}
  </section>;
}

const RESERVATION_PAGE_SIZE = 25;
const safeBookingSearch = (value: string) => value.trim().replace(/[^a-zA-Z0-9\s@._-]/g, '').slice(0, 80);

function ReservationsPage(props: Props) {
  const [rows, setRows] = useState<Array<Record<string, any>>>([]);
  const [search, setSearch] = useState('');
  const [visitDate, setVisitDate] = useState('');
  const [status, setStatus] = useState('all');
  const [paymentStatus, setPaymentStatus] = useState('all');
  const [page, setPage] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [total, setTotal] = useState(0);
  const site = assignedGatekeeperSite(props);
  const [loading, finishLoading] = useSilentLoad(`${props.user?.id ?? 'staff'}:${props.role}:${site?.id ?? 'unassigned'}`);
  const [refreshing, setRefreshing] = useState(false);
  const queryKey = `${site?.id ?? 'unassigned'}:${visitDate}:${status}:${paymentStatus}:${search}:${page}`;
  const [loadedQueryKey, setLoadedQueryKey] = useState('');
  const resultsCurrent = loadedQueryKey === queryKey;
  useEffect(() => {
    let active = true;
    if (!site) { setRows([]); setTotal(0); setLoadedQueryKey(queryKey); setRefreshing(false); finishLoading(); return () => { active = false; }; }
    setRefreshing(true);
    void (async () => {
      let query = db().from('bookings').select(
        'id,booking_reference,visitor_name,visitor_count,adult_count,child_count,booking_status,payment_status,booking_source,created_at,site_slots!inner(slot_date,starts_at,ends_at),reservation_visitors(id,sequence_number,visitor_type,full_name,address,gender,nationality,check_in_status,checked_in_at)',
        { count: 'exact' },
      ).eq('site_id', site.id);
      if (visitDate) query = query.eq('site_slots.slot_date', visitDate);
      if (status !== 'all') query = query.eq('booking_status', status);
      if (paymentStatus !== 'all') query = query.eq('payment_status', paymentStatus);
      const term = safeBookingSearch(search);
      if (term) query = query.or(`booking_reference.ilike.%${term}%,visitor_name.ilike.%${term}%`);
      const { data, count, error } = await query.order('created_at', { ascending: false })
        .range(page * RESERVATION_PAGE_SIZE, (page + 1) * RESERVATION_PAGE_SIZE - 1);
      if (error) throw error;
      if (active) { setRows((data ?? []) as Array<Record<string, any>>); setTotal(count ?? 0); setLoadedQueryKey(queryKey); }
    })().catch((error) => { if (active) props.notify(error instanceof Error ? error.message : 'Could not load destination reservations.'); })
      .finally(() => { if (active) { setRefreshing(false); finishLoading(); } });
    return () => { active = false; };
  }, [finishLoading, page, paymentStatus, props.notify, queryKey, refreshKey, search, site?.id, status, visitDate]);
  const updateFilter = (setter: (value: string) => void) => (value: string) => { setPage(0); setter(value); };
  const pageCount = Math.max(1, Math.ceil(total / RESERVATION_PAGE_SIZE));
  return <section className="dashboard-page section-wrap"><div className="dash-header"><div>
    <span className="eyebrow"><span className="eyebrow-line"/> {site?.name ?? 'DESTINATION'} · RESERVATIONS</span>
    <h1>Reservation <em>records.</em></h1><p>Search and review bookings assigned to this destination.</p>
  </div><button className="btn btn-outline" onClick={() => setRefreshKey((current) => current + 1)} aria-label="Refresh reservations"><RefreshCw size={15}/> Refresh</button></div>
    {!site && <div className="empty-card"><ShieldCheck size={28}/><h3>No destination assigned</h3><p>Ask the Tourism Office to assign this Gatekeeper to exactly one destination.</p></div>}
    {site && <><div className="gatekeeper-filters">
      <label>Booking reference or contact name<input value={search} onChange={(event) => updateFilter(setSearch)(event.target.value)} placeholder="Search bookings"/></label>
      <label>Visit date<input type="date" value={visitDate} onChange={(event) => updateFilter(setVisitDate)(event.target.value)}/></label>
      <label>Booking status<select value={status} onChange={(event) => updateFilter(setStatus)(event.target.value)}><option value="all">All statuses</option><option value="awaiting_payment">Awaiting payment</option><option value="confirmed">Confirmed</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option><option value="expired">Expired</option><option value="needs_resolution">Needs resolution</option></select></label>
      <label>Payment status<select value={paymentStatus} onChange={(event) => updateFilter(setPaymentStatus)(event.target.value)}><option value="all">All payment states</option><option value="not_required">Not collected online</option><option value="pending">Pending</option><option value="paid">Paid</option><option value="failed">Failed</option><option value="expired">Expired</option><option value="refunded">Refunded</option></select></label>
    </div>
    <div className="table-toolbar" aria-busy={refreshing || !resultsCurrent}><span>{loading ? 'Loading…' : refreshing ? 'Updating reservations…' : resultsCurrent ? `${total} destination reservations` : 'Showing previous results'}</span><span>Page {page + 1} of {pageCount}</span></div>
    {!loading && !refreshing && resultsCurrent && !rows.length && <div className="empty-inline">No bookings match these filters.</div>}
    {loading && <div className="empty-inline" role="status">Loading reservations…</div>}
    {!loading && !!rows.length && <div className="table-card gatekeeper-bookings-table" aria-busy={refreshing || !resultsCurrent}><table><thead><tr><th>Reference</th><th>Booking contact</th><th>Visit</th><th>Visitors</th><th>Status</th><th>Created</th></tr></thead>
      <tbody>{rows.map((booking) => { const slot = Array.isArray(booking.site_slots) ? booking.site_slots[0] : booking.site_slots; const visitors = booking.reservation_visitors ?? [];
        return <tr key={booking.id}><td><b>{booking.booking_reference}</b><small>{booking.booking_source.replace('_', ' ')}</small></td>
          <td>{booking.visitor_name}</td><td>{dateLabel(slot?.slot_date)}<small>{slot?.starts_at ? timeLabel(slot.starts_at) : ''}</small></td>
          <td>{booking.visitor_count}<small>{booking.adult_count} adults · {booking.child_count} children</small>
            <details className="booking-visitors"><summary>Visitor list ({visitors.length})</summary><div>{visitors.map((visitor: Record<string, any>) => <article key={visitor.id}>
              <b>{visitor.full_name}</b><small>{visitor.visitor_type} · {visitor.address}</small>
              {requiredVisitorFields(site.slug).includes('gender') && <small>Gender: {visitor.gender ?? '—'}</small>}
              {requiredVisitorFields(site.slug).includes('nationality') && <small>Nationality: {visitor.nationality ?? '—'}</small>}
              <small>{visitor.check_in_status === 'checked_in' ? 'Checked in' : 'Not checked in'}</small>
            </article>)}</div></details></td>
          <td><span className="status-tag">{String(booking.booking_status).replace(/_/g, ' ')}</span><small>{paymentStatusLabel(String(booking.payment_status), Number(booking.total_amount))}</small></td>
          <td>{new Date(booking.created_at).toLocaleString()}</td></tr>;
      })}</tbody></table></div>}
    <div className="staff-quick"><button className="btn btn-outline" disabled={loading || refreshing || !resultsCurrent || page === 0} onClick={() => setPage((current) => current - 1)}><ArrowLeft size={15}/> Previous</button>
      <button className="btn btn-outline" disabled={loading || refreshing || !resultsCurrent || page + 1 >= pageCount} onClick={() => setPage((current) => current + 1)}>Next <ArrowRight size={15}/></button></div></>}
  </section>;
}

function AccessNotice() {
  return <section className="dashboard-page section-wrap"><div className="empty-card"><ShieldCheck size={30}/><h3>This page is not available to this staff role</h3><p>Access follows the role and destination assignments linked to your account.</p></div></section>;
}

type ScanResult = { result: string; booking_reference: string | null; visitor_name: string | null; visitor_count: number; entered_at: string | null; exited_at: string | null };
function ScannerPage(props: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const lockRef = useRef(false);
  const [manual, setManual] = useState('');
  const [cameraOn, setCameraOn] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [scanError, setScanError] = useState('');
  const [scanBusy, setScanBusy] = useState(false);
  const site = props.sites.find((item) => item.id === props.siteId);

  const processToken = useCallback(async (token: string) => {
    if (!props.siteId || lockRef.current) return;
    lockRef.current = true;
    setScanBusy(true);
    setScanError('');
    try {
      const payload = await invokeFunction<{ result: ScanResult }>('scan-ticket', { token, site_id: props.siteId });
      setResult(payload.result);
    } catch (error) {
      setScanError(error instanceof Error ? error.message : 'Ticket scan could not be recorded.');
    } finally {
      setScanBusy(false);
      controlsRef.current?.stop();
      controlsRef.current = null;
      setCameraOn(false);
      window.setTimeout(() => { lockRef.current = false; }, 1200);
    }
  }, [props.siteId]);

  const startCamera = async () => {
    if (!videoRef.current) return;
    setScanError('');
    setResult(null);
    try {
      const { BrowserQRCodeReader } = await import('@zxing/browser');
      const reader = new BrowserQRCodeReader();
      controlsRef.current = await reader.decodeFromVideoDevice(undefined, videoRef.current, (decoded) => {
        if (decoded && !lockRef.current) void processToken(decoded.getText());
      });
      setCameraOn(true);
    } catch (error) {
      setScanError(error instanceof Error ? error.message : 'Camera access is unavailable. Use manual booking reference lookup.');
    }
  };
  const stopCamera = () => { controlsRef.current?.stop(); controlsRef.current = null; setCameraOn(false); };
  useEffect(() => () => { controlsRef.current?.stop(); }, []);
  const manualLookup = async (event: FormEvent) => {
    event.preventDefault();
    if (!manual.trim() || !props.siteId) return;
    setScanBusy(true); setScanError(''); setResult(null);
    try {
      const { data, error } = await db().rpc('manual_scan_ticket', {
        p_booking_reference: manual.trim(),
        p_site_id: props.siteId,
        p_device: { user_agent: navigator.userAgent.slice(0, 240), method: 'manual' },
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as ScanResult;
      setResult(row);
    } catch (error) { setScanError(error instanceof Error ? error.message : 'Could not look up this booking.'); }
    finally { setScanBusy(false); }
  };

  return <section className="dashboard-page section-wrap"><div className="dash-header"><div><span className="eyebrow"><span className="eyebrow-line"/> {site?.name ?? 'GATEKEEPER'} · SCAN & EXIT</span><h1>One scan at a <em>time.</em></h1><p>Camera scans verify signed tickets. Manual lookup records the same entry or exit action.</p></div></div>
    {!props.siteId && <div className="empty-card"><ShieldCheck size={30}/><h3>No site assignment</h3><p>Ask the Tourism Office to assign your gatekeeper account.</p></div>}
    {!!props.siteId && <div className="scan-layout"><article className="scan-card"><div className="scan-mode"><button className={!manual ? 'active' : ''} onClick={() => { setManual(''); setScanError(''); }}>Camera</button><button className={manual ? 'active' : ''} onClick={() => { stopCamera(); setManual(' '); setScanError(''); }}>Manual reference</button></div>
      <div className="camera-box"><video ref={videoRef} muted playsInline className={cameraOn ? 'scanner-video visible' : 'scanner-video'}/>{!cameraOn && <div className="camera-placeholder"><Camera size={31}/><p>Point the camera at the visitor’s QR ticket.</p><small>Camera permission is requested only after you start the scanner.</small></div>}</div>
      <div className="scan-controls">{cameraOn ? <button className="btn btn-outline" onClick={stopCamera}><X size={15}/> Stop camera</button>
        : <button className="btn btn-primary" onClick={() => void startCamera()} disabled={!props.siteId}><Camera size={15}/> Start camera</button>}
        <span>{site?.name ?? 'Select a site'}</span></div>
      {Boolean(manual.trim()) && <form className="manual-scan-form" onSubmit={(event) => void manualLookup(event)}><label>Booking reference<input value={manual} onChange={(event) => setManual(event.target.value)} autoFocus placeholder="ILG-…" autoCapitalize="characters"/></label><button className="btn btn-primary" disabled={scanBusy}>{scanBusy ? 'Checking…' : 'Record scan'} <ArrowRight size={15}/></button></form>}
      {scanError && <p className="form-error" role="alert">{scanError}</p>}
    </article><article className="scan-result-card"><div className="card-heading"><span><small>SCAN RESULT</small><h3>Entry & exit record</h3></span><ShieldCheck size={19}/></div>
      {!result && !scanError && <div className="empty-inline">A scan result will appear here after the server validates the ticket.</div>}
      {result && <div className="scan-result"><span className={result.result.includes('recorded') ? 'scan-result-icon success' : 'scan-result-icon'}>{result.result.includes('recorded') ? <Check size={23}/> : <ShieldCheck size={23}/>}</span>
        <strong>{scanLabel(result.result)}</strong><p>{result.visitor_name || 'Ticket details unavailable'}</p>
        {result.booking_reference && <small>{result.booking_reference} · {result.visitor_count} visitors</small>}
        {result.entered_at && <small>Entry: {new Date(result.entered_at).toLocaleString()}</small>}
        {result.exited_at && <small>Exit: {new Date(result.exited_at).toLocaleString()}</small>}
        <button className="btn btn-outline" onClick={() => { setResult(null); setScanError(''); }}>Scan another ticket</button></div>}
    </article></div>}
  </section>;
}

function scanLabel(result: string) {
  return ({ entry_recorded: 'Entry recorded', exit_recorded: 'Exit recorded', completed: 'Visit already completed',
    invalid: 'Ticket is invalid', unpaid_or_inactive: 'Booking is unpaid or inactive', outside_window: 'Outside the visit time window' } as Record<string, string>)[result] ?? result.replace(/_/g, ' ');
}

type Hour = { weekday: number; opens_at: string; closes_at: string; is_closed: boolean };
const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function SchedulePage(props: Props) {
  const [hours, setHours] = useState<Hour[]>(dayNames.map((_, weekday) => ({ weekday, opens_at: '', closes_at: '', is_closed: true })));
  const [slots, setSlots] = useState<Array<Record<string, any>>>([]);
  const [closures, setClosures] = useState<Array<Record<string, any>>>([]);
  const [slotForm, setSlotForm] = useState({ date: phToday(), starts_at: '', ends_at: '', capacity: '' });
  const [closureForm, setClosureForm] = useState({ starts_on: phToday(), ends_on: phToday(), reason: '' });
  const [loading, finishLoading] = useSilentLoad(`${props.user?.id ?? 'staff'}:${props.role}:${props.siteId}`);
  const [saving, setSaving] = useState(false);
  const refresh = useCallback(async () => {
    if (!props.siteId) {
      setHours(dayNames.map((_, weekday) => ({ weekday, opens_at: '', closes_at: '', is_closed: true })));
      setSlots([]); setClosures([]); finishLoading(); return;
    }
    try {
      const [hourResult, slotResult, closureResult] = await Promise.all([
        db().from('site_operating_hours').select('weekday,opens_at,closes_at,is_closed').eq('site_id', props.siteId).order('weekday'),
        db().from('site_slots').select('id,slot_date,starts_at,ends_at,capacity,status').eq('site_id', props.siteId).gte('slot_date', phToday()).order('slot_date').order('starts_at').limit(120),
        db().from('site_closures').select('id,starts_on,ends_on,starts_at,ends_at,reason').eq('site_id', props.siteId).gte('ends_on', phToday()).order('starts_on').limit(60),
      ]);
      if (hourResult.error) throw hourResult.error;
      if (slotResult.error) throw slotResult.error;
      if (closureResult.error) throw closureResult.error;
      const stored = new Map((hourResult.data ?? []).map((row) => [row.weekday, row]));
      setHours(dayNames.map((_, weekday) => {
        const row = stored.get(weekday);
        return row ? { weekday, opens_at: String(row.opens_at ?? '').slice(0, 5), closes_at: String(row.closes_at ?? '').slice(0, 5), is_closed: row.is_closed }
          : { weekday, opens_at: '', closes_at: '', is_closed: true };
      }));
      setSlots(slotResult.data ?? []);
      setClosures(closureResult.data ?? []);
    } catch (error) { props.notify(error instanceof Error ? error.message : 'Could not load site schedule.'); }
    finally { finishLoading(); }
  }, [finishLoading, props.notify, props.siteId]);
  useEffect(() => { void refresh(); }, [refresh]);

  const changeHour = (weekday: number, change: Partial<Hour>) => setHours((current) =>
    current.map((row) => row.weekday === weekday ? { ...row, ...change } : row));
  const saveHours = async () => {
    if (hours.some((row) => !row.is_closed && (!row.opens_at || !row.closes_at || row.closes_at <= row.opens_at))) {
      props.notify('Enter valid opening and closing times for every open day.'); return;
    }
    setSaving(true);
    try {
      const rows = hours.map((row) => ({
        site_id: props.siteId, weekday: row.weekday, is_closed: row.is_closed,
        opens_at: row.is_closed ? null : row.opens_at,
        closes_at: row.is_closed ? null : row.closes_at,
      }));
      const { error } = await db().from('site_operating_hours').upsert(rows, { onConflict: 'site_id,weekday' });
      if (error) throw error;
      props.notify('Weekly operating hours saved.');
      await refresh();
    } catch (error) { props.notify(error instanceof Error ? error.message : 'Could not save weekly hours.'); }
    finally { setSaving(false); }
  };
  const addSlot = async (event: FormEvent) => {
    event.preventDefault();
    if (!props.siteId || !slotForm.starts_at || !slotForm.ends_at || Number(slotForm.capacity) < 1) return;
    setSaving(true);
    try {
      const { error } = await db().from('site_slots').insert({
        site_id: props.siteId, slot_date: slotForm.date, starts_at: slotForm.starts_at,
        ends_at: slotForm.ends_at, capacity: Number(slotForm.capacity), created_by: props.user?.id,
      });
      if (error) throw error;
      props.notify('Visit slot added. Booking requests will check its operating hours and remaining capacity.');
      setSlotForm({ ...slotForm, starts_at: '', ends_at: '', capacity: '' });
      await refresh();
    } catch (error) { props.notify(error instanceof Error ? error.message : 'Could not add the visit slot.'); }
    finally { setSaving(false); }
  };
  const addClosure = async (event: FormEvent) => {
    event.preventDefault();
    if (!props.siteId || !closureForm.reason.trim()) return;
    setSaving(true);
    try {
      const { error } = await db().from('site_closures').insert({
        site_id: props.siteId, starts_on: closureForm.starts_on, ends_on: closureForm.ends_on,
        reason: closureForm.reason.trim(), created_by: props.user?.id,
      });
      if (error) throw error;
      props.notify('Closure saved. New booking holds will respect this date range.');
      setClosureForm({ ...closureForm, reason: '' });
      await refresh();
    } catch (error) { props.notify(error instanceof Error ? error.message : 'Could not add the closure.'); }
    finally { setSaving(false); }
  };
  const toggleSlot = async (slot: Record<string, any>) => {
    const next = slot.status === 'open' ? 'closed' : 'open';
    const { error } = await db().from('site_slots').update({ status: next }).eq('id', slot.id);
    if (error) props.notify(error.message);
    else { props.notify('Slot status updated.'); await refresh(); }
  };
  const site = props.sites.find((item) => item.id === props.siteId);
  return <section className="dashboard-page section-wrap"><div className="dash-header"><div><span className="eyebrow"><span className="eyebrow-line"/> SITE ADMINISTRATION</span><h1>Hours that work <em>for you.</em></h1><p>Manage published hours, date-specific capacity, and closure notices{site ? ' for ' + site.name : ''}.</p></div>
    <div className="header-actions"><SiteSelector {...props}/><button className="btn btn-outline" onClick={() => void refresh()}><RefreshCw size={15}/></button></div></div>
    {!props.siteId && <div className="empty-card"><MapPin size={28}/><h3>No assigned destination</h3><p>Ask the Tourism Office to assign a site administrator account.</p></div>}
    {!!props.siteId && <><div className="schedule-card"><div className="schedule-head"><span><small>PHILIPPINE TIME · ASIA/MANILA</small><h3>Weekly operating hours</h3></span><button className="btn btn-primary" disabled={loading || saving} onClick={() => void saveHours()}>{saving ? 'Saving…' : 'Save hours'} <Check size={15}/></button></div>
      {loading ? <div className="empty-inline" role="status">Loading current operating hours…</div> : hours.map((hour) => <div className="schedule-row" key={hour.weekday}><label className="day-switch"><input type="checkbox" checked={!hour.is_closed} onChange={(event) => changeHour(hour.weekday, { is_closed: !event.target.checked })}/>{dayNames[hour.weekday]}</label>
        {hour.is_closed ? <span className="closed-label">Closed</span> : <><input type="time" value={hour.opens_at} onChange={(event) => changeHour(hour.weekday, { opens_at: event.target.value })}/><span>to</span><input type="time" value={hour.closes_at} onChange={(event) => changeHour(hour.weekday, { closes_at: event.target.value })}/></>}
      </div>)}</div>
      <div className="schedule-card"><div className="schedule-head"><span><small>DATE-SPECIFIC CAPACITY</small><h3>Add a visit slot</h3></span></div>
        <form className="slot-admin-form" onSubmit={(event) => void addSlot(event)}><label>Date<input type="date" min={phToday()} value={slotForm.date} onChange={(event) => setSlotForm({ ...slotForm, date: event.target.value })} required/></label>
          <label>Starts<input type="time" value={slotForm.starts_at} onChange={(event) => setSlotForm({ ...slotForm, starts_at: event.target.value })} required/></label>
          <label>Ends<input type="time" value={slotForm.ends_at} onChange={(event) => setSlotForm({ ...slotForm, ends_at: event.target.value })} required/></label>
          <label>Capacity<input type="number" min="1" max="100000" value={slotForm.capacity} onChange={(event) => setSlotForm({ ...slotForm, capacity: event.target.value })} required/></label>
          <button className="btn btn-primary" disabled={loading || saving}>{saving ? 'Saving…' : 'Add slot'} <Plus size={15}/></button></form>
        {!slots.length && <div className="empty-inline">{loading ? 'Loading…' : 'No upcoming slots have been added.'}</div>}
        {!loading && <div className="table-card"><table><thead><tr><th>Date</th><th>Time</th><th>Capacity</th><th>Status</th><th/></tr></thead><tbody>{slots.map((slot) => <tr key={slot.id}>
          <td>{dateLabel(slot.slot_date)}</td><td>{timeLabel(slot.starts_at)} – {timeLabel(slot.ends_at)}</td><td>{slot.capacity}</td><td><span className={slot.status === 'open' ? 'status-tag paid' : 'status-tag'}>{slot.status}</span></td>
          <td><button className="link-btn" onClick={() => void toggleSlot(slot)}>{slot.status === 'open' ? 'Close' : 'Open'}</button></td></tr>)}</tbody></table></div>}
      </div>
      <div className="schedule-card"><div className="schedule-head"><span><small>SPECIAL DATES</small><h3>Closures</h3></span></div>
        <form className="closure-admin-form" onSubmit={(event) => void addClosure(event)}><label>From<input type="date" min={phToday()} value={closureForm.starts_on} onChange={(event) => setClosureForm({ ...closureForm, starts_on: event.target.value })} required/></label>
          <label>Through<input type="date" min={closureForm.starts_on} value={closureForm.ends_on} onChange={(event) => setClosureForm({ ...closureForm, ends_on: event.target.value })} required/></label>
          <label>Reason<input value={closureForm.reason} onChange={(event) => setClosureForm({ ...closureForm, reason: event.target.value })} maxLength={500} required/></label>
          <button className="btn btn-outline" disabled={loading || saving}>{saving ? 'Saving…' : 'Add closure'} <Plus size={15}/></button></form>
        {!loading && !closures.length && <div className="empty-inline">No future closures recorded.</div>}
        {!loading && closures.map((closure) => <div className="closure-row" key={closure.id}><span className="closure-date">{String(closure.starts_on).slice(5, 7)}<br/><b>{String(closure.starts_on).slice(8, 10)}</b></span><span><b>{dateLabel(closure.starts_on)}{closure.ends_on !== closure.starts_on ? ' – ' + dateLabel(closure.ends_on) : ''}</b><small>{closure.reason}</small></span><button className="link-btn" onClick={async () => { const { error } = await db().from('site_closures').delete().eq('id', closure.id); if (error) props.notify(error.message); else await refresh(); }}>Remove</button></div>)}
      </div></>}
  </section>;
}

function PeoplePage(props: Props) {
  const [cancellations, setCancellations] = useState<Array<Record<string, any>>>([]);
  const [supportRequests, setSupportRequests] = useState<Array<Record<string, any>>>([]);
  const [supportReplies, setSupportReplies] = useState<Record<string, string>>({});
  const [staff, setStaff] = useState<Array<Record<string, any>>>([]);
  const [staffLoadError, setStaffLoadError] = useState('');
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('gatekeeper');
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});
  const siteIds = props.role === 'tourism_office' ? props.sites.map((site) => site.id) : [props.siteId].filter(Boolean);
  const [loading, finishLoading] = useSilentLoad(`${props.user?.id ?? 'staff'}:${props.role}:${siteIds.join(',')}`);
  const [actionBusy, setActionBusy] = useState(false);
  const refresh = useCallback(async () => {
    if (!siteIds.length && props.role !== 'tourism_office') {
      setCancellations([]); setStaff([]); setSupportRequests([]); finishLoading(); return;
    }
    const errors: string[] = [];
    const [cancellationLoad, staffLoad] = await Promise.allSettled([
        db().from('cancellation_requests').select('id,booking_id,site_id,reason,request_status,created_at,decision_note,booking:bookings(booking_reference,visitor_name,total_amount,payment_status),tourism_sites(name)')
          .in('site_id', siteIds).order('created_at', { ascending: false }).limit(100),
        db().from('staff_assignments').select('id,profile_id,site_id,staff_role,is_active,profiles!staff_assignments_profile_id_fkey(full_name,email),tourism_sites(name)')
          .in('site_id', siteIds).order('created_at', { ascending: false }).limit(100),
      ]);
    const cancellationResult = cancellationLoad.status === 'fulfilled' ? cancellationLoad.value : null;
    if (cancellationResult && !cancellationResult.error) setCancellations(cancellationResult.data ?? []);
    else {
      setCancellations([]);
      errors.push('Cancellation requests: ' + (cancellationResult?.error.message ?? String(cancellationLoad.status === 'rejected' ? cancellationLoad.reason : 'load failed')));
    }
    const staffResult = staffLoad.status === 'fulfilled' ? staffLoad.value : null;
    if (staffResult && !staffResult.error) { setStaff(staffResult.data ?? []); setStaffLoadError(''); }
    else {
      setStaff([]);
      const message = staffResult?.error.message ?? String(staffLoad.status === 'rejected' ? staffLoad.reason : 'load failed');
      setStaffLoadError(message);
      errors.push('Staff assignments: ' + message);
    }
    if (props.role === 'tourism_office') {
      try {
        const { data, error } = await db().from('support_requests').select('id,user_id,booking_id,subject,message,status,staff_response,created_at,profiles(full_name,email),booking:bookings(booking_reference,site:tourism_sites(name))')
          .order('created_at', { ascending: false }).limit(100);
        if (error) throw error;
        setSupportRequests(data ?? []);
      } catch (error) {
        setSupportRequests([]);
        errors.push('Support requests: ' + (error instanceof Error ? error.message : typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : String(error)));
      }
    } else setSupportRequests([]);
    if (errors.length) props.notify(errors.join(' · '));
    finishLoading();
  }, [finishLoading, props.notify, props.role, siteIds.join(',')]);
  useEffect(() => { void refresh(); }, [refresh]);

  const invite = async (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim() || (inviteRole !== 'tourism_office' && !props.siteId)) { props.notify('Enter the staff email and choose a site.'); return; }
    props.setBusy(true);
    try {
      const result = await invokeFunction<{ existing_account: boolean }>('invite-staff', {
        email: email.trim(), staff_role: inviteRole, site_id: inviteRole === 'tourism_office' ? null : props.siteId,
      });
      props.notify(result.existing_account ? 'Existing account was assigned the selected staff role and destination.' : 'Staff invitation sent by Supabase Auth email.');
      setEmail('');
      await refresh();
    } catch (error) { props.notify(error instanceof Error ? error.message : 'Could not invite staff.'); }
    finally { props.setBusy(false); }
  };
  const decideCancellation = async (request: Record<string, any>, approve: boolean) => {
    setActionBusy(true);
    try {
      const { error } = await db().rpc('review_cancellation', {
        p_request_id: request.id, p_approve: approve, p_note: decisionNotes[request.id]?.trim() || null,
      });
      if (error) throw error;
      setDecisionNotes((current) => { const next = { ...current }; delete next[request.id]; return next; });
      const booking = Array.isArray(request.booking) ? request.booking[0] : request.booking;
      if (booking?.booking_reference) void invokeFunction('send-booking-email', {
        booking_reference: booking.booking_reference, event: 'cancellation_decided', request_id: request.id,
      }).catch(() => props.notify('Cancellation decision was saved, but its email could not be sent.'));
      props.notify(approve
        ? 'Cancellation approved. No payment or refund was processed.'
        : 'Cancellation declined.');
      await refresh();
    } catch (error) { props.notify(error instanceof Error ? error.message : 'Could not review this cancellation.'); }
    finally { setActionBusy(false); }
  };
  const updateSupportRequest = async (request: Record<string, any>, status: string) => {
    setActionBusy(true);
    try {
      const response = supportReplies[request.id] ?? request.staff_response ?? '';
      const { error } = await db().from('support_requests').update({ status, staff_response: response.trim() || null }).eq('id', request.id);
      if (error) throw error;
      props.notify('Support request updated.');
      await refresh();
    } catch (error) { props.notify(error instanceof Error ? error.message : 'Could not update the support request.'); }
    finally { setActionBusy(false); }
  };
  const disableAssignment = async (assignment: Record<string, any>) => {
    setActionBusy(true);
    try {
      const { error } = await db().from('staff_assignments').update({ is_active: false }).eq('id', assignment.id);
      if (error) props.notify(error.message);
      else { props.notify('Site staff assignment disabled.'); await refresh(); }
    } finally { setActionBusy(false); }
  };
  return <section className="dashboard-page section-wrap"><div className="dash-header"><div><span className="eyebrow"><span className="eyebrow-line"/> SITE ADMINISTRATION</span><h1>People & <em>access.</em></h1><p>Manage destination assignments, cancellation requests, and visitor support. Payments are not processed here.</p></div>
    <div className="header-actions">{props.role === 'tourism_office' && <SiteSelector {...props}/>}<button className="btn btn-outline" onClick={() => void refresh()}><RefreshCw size={15}/></button></div></div>
    {props.role === 'site_admin' && <div className="workspace-panel-select"><label>Active destination <SiteSelector {...props}/></label></div>}
    <div className="schedule-card"><div className="schedule-head"><span><small>ROLE-BASED ACCESS</small><h3>Invite a team member</h3></span><Users size={18}/></div>
      <form className="invite-form" onSubmit={(event) => void invite(event)}><label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254}/></label>
        <label>Staff role<select value={inviteRole} onChange={(event) => setInviteRole(event.target.value)}><option value="gatekeeper">Gatekeeper</option>{props.role === 'tourism_office' && <><option value="site_admin">Site administrator</option><option value="tourism_office">Tourism Office</option></>}</select></label>
        {inviteRole !== 'tourism_office' && props.role === 'tourism_office' && <label>Destination<SiteSelector {...props}/></label>}
        <button className="btn btn-primary" disabled={props.busy || !props.siteId && inviteRole !== 'tourism_office'}>{props.busy ? 'Sending…' : 'Send invitation'} <ArrowRight size={15}/></button>
      </form>
      <div className="table-card"><table><thead><tr><th>Staff member</th><th>Destination</th><th>Role</th><th>Access</th><th/></tr></thead><tbody>
        {!loading && staff.map((assignment) => { const person = Array.isArray(assignment.profiles) ? assignment.profiles[0] : assignment.profiles; const site = Array.isArray(assignment.tourism_sites) ? assignment.tourism_sites[0] : assignment.tourism_sites; return <tr key={assignment.id}>
          <td>{person?.full_name || person?.email || assignment.profile_id}</td><td>{site?.name ?? '—'}</td><td>{assignment.staff_role.replace('_', ' ')}</td>
          <td><span className={assignment.is_active ? 'status-tag paid' : 'status-tag'}>{assignment.is_active ? 'Active' : 'Disabled'}</span></td>
          <td>{assignment.is_active && (props.role === 'tourism_office' || assignment.staff_role === 'gatekeeper') && <button className="link-btn" disabled={actionBusy} onClick={() => void disableAssignment(assignment)}>Disable</button>}</td>
        </tr>; })}
        {loading && <tr><td colSpan={5}>Loading staff…</td></tr>}
        {!loading && !staff.length && <tr><td colSpan={5}>{staffLoadError ? 'Could not load assignments: ' + staffLoadError : 'No site staff assignments.'}</td></tr>}
      </tbody></table></div>
    </div>
    <SiteImagesManager {...props}/>
    <div className="schedule-card"><div className="schedule-head"><span><small>BOOKING CANCELLATIONS</small><h3>Cancellation requests</h3></span><ShieldCheck size={18}/></div>
      {loading && <div className="empty-inline">Loading cancellation requests…</div>}
      {!loading && cancellations.map((request) => { const booking = Array.isArray(request.booking) ? request.booking[0] : request.booking; const site = Array.isArray(request.tourism_sites) ? request.tourism_sites[0] : request.tourism_sites; return <div className="request-row" key={request.id}>
        <div><b>{booking?.visitor_name || booking?.booking_reference || 'Booking'} · {site?.name}</b><small>{request.reason}</small><small>{new Date(request.created_at).toLocaleString()} · {request.request_status}</small></div>
        {request.request_status === 'pending' && <><label className="request-decision-note">Decision note <span className="field-optional">optional</span><textarea value={decisionNotes[request.id] ?? ''} onChange={(event) => setDecisionNotes((current) => ({ ...current, [request.id]: event.target.value }))} maxLength={1000} rows={2}/></label><div className="request-actions"><button className="btn btn-primary" disabled={actionBusy} onClick={() => void decideCancellation(request, true)}>Approve</button><button className="btn btn-outline" disabled={actionBusy} onClick={() => void decideCancellation(request, false)}>Decline</button></div></>}
      </div>; })}
      {!loading && !cancellations.length && <div className="empty-inline">No cancellation requests.</div>}
    </div>
    {props.role === 'tourism_office' && <div className="schedule-card"><div className="schedule-head"><span><small>VISITOR HELP</small><h3>Support requests</h3></span><Users size={18}/></div>
      {loading && <div className="empty-inline">Loading support requests…</div>}
      {!loading && !supportRequests.length && <div className="empty-inline">No support requests.</div>}
      {!loading && supportRequests.map((request) => { const person = Array.isArray(request.profiles) ? request.profiles[0] : request.profiles; const booking = Array.isArray(request.booking) ? request.booking[0] : request.booking; const site = Array.isArray(booking?.site) ? booking.site[0] : booking?.site; return <article className="support-staff-row" key={request.id}><div><b>{request.subject}</b><small>{person?.full_name || person?.email || 'Visitor'} · {booking?.booking_reference || 'No booking'}{site?.name ? ' · ' + site.name : ''}</small><p>{request.message}</p></div><label>Status<select value={request.status} onChange={(event) => void updateSupportRequest(request, event.target.value)} disabled={actionBusy}><option value="received">Received</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select></label><label>Reply<textarea value={supportReplies[request.id] ?? request.staff_response ?? ''} onChange={(event) => setSupportReplies((current) => ({ ...current, [request.id]: event.target.value }))} maxLength={4000} rows={3}/></label><button className="btn btn-outline" disabled={actionBusy} onClick={() => void updateSupportRequest(request, request.status)}>Save reply</button></article>; })}
    </div>}
  </section>;
}

function SiteImagesManager(props: Props) {
  const [alt, setAlt] = useState('');
  const [busy, setBusy] = useState(false);
  const site = props.sites.find((item) => item.id === props.siteId);
  const atImageLimit = !!site && site.images.length >= 3;
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !site) return;
    if (site.images.length >= 3) { props.notify('A destination can have at most 3 photos.'); event.target.value = ''; return; }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      props.notify('Choose a JPEG, PNG, or WebP image under 5 MiB.'); event.target.value = ''; return;
    }
    setBusy(true);
    const path = site.id + '/' + crypto.randomUUID() + '.' + file.type.split('/')[1].replace('jpeg', 'jpg');
    try {
      const { error: storageError } = await db().storage.from('tourism-site-images')
        .upload(path, file, { contentType: file.type, upsert: false });
      if (storageError) throw storageError;
      const { error } = await db().from('site_images').insert({
        site_id: site.id, storage_path: path, image_role: 'gallery',
        alt_text: alt.trim() || site.name, created_by: props.user?.id,
      });
      if (error) {
        await db().storage.from('tourism-site-images').remove([path]);
        throw error;
      }
      setAlt('');
      props.notify('Destination image uploaded.');
      props.refresh();
    } catch (error) { props.notify(error instanceof Error ? error.message : 'Could not upload this destination image.'); }
    finally { setBusy(false); event.target.value = ''; }
  };
  const remove = async (image: Site['images'][number]) => {
    if (site?.status === 'published' && site.images.length <= 1) {
      props.notify('Published destinations must keep at least one photo.'); return;
    }
    const { error } = await db().from('site_images').delete().eq('id', image.id);
    if (error) { props.notify(error.message); return; }
    const result = await db().storage.from('tourism-site-images').remove([image.storage_path]);
    if (result.error) props.notify('Image record removed. The stored file could not be removed: ' + result.error.message);
    else props.notify('Destination image removed.');
    props.refresh();
  };
  return <div className="schedule-card"><div className="schedule-head"><span><small>DESTINATION MEDIA</small><h3>Photos {site ? '· ' + site.name : ''}</h3></span><ImagePlus size={18}/></div>
    {!site && <div className="empty-inline">Select an assigned destination to manage its photos.</div>}
      {site && <><div className="image-manager-grid">{site.images.map((image) => <div className="managed-image" key={image.id}><img src={image.public_url} alt={image.alt_text || site.name}/><span>{image.alt_text || site.name}</span><button aria-label="Remove image" title={site.status === 'published' && site.images.length <= 1 ? 'Published destinations must keep at least one photo' : 'Remove image'} disabled={site.status === 'published' && site.images.length <= 1} onClick={() => void remove(image)}><X size={14}/></button></div>)}
      {!site.images.length && <div className="empty-inline">No destination photos uploaded.</div>}</div>
      <div className="image-upload-row"><label>Photo description<input value={alt} onChange={(event) => setAlt(event.target.value)} maxLength={250} placeholder={site.name}/></label>
        <label className="btn btn-outline image-pick">{busy ? 'Uploading…' : atImageLimit ? 'Photo limit reached' : 'Add photo'}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || atImageLimit} onChange={(event) => void upload(event)}/></label>
      </div><p className="field-hint">{site.images.length}/3 photos · JPEG, PNG, or WebP · maximum 5 MiB each. Published destinations keep at least one photo.</p></>}
  </div>;
}

type VisitorLogbookRecord = {
  id: string; sequence_number: number; visitor_type: string; full_name: string; address: string;
  gender: string | null; nationality: string | null; check_in_status: string; checked_in_at: string | null;
  booking: { site_id: string; booking_reference: string; booking_status: string; site_slots: { slot_date: string; starts_at: string } };
};

function VisitorLogbookPage(props: Props) {
  const [visitDate, setVisitDate] = useState(phToday());
  const [nameQuery, setNameQuery] = useState('');
  const [referenceQuery, setReferenceQuery] = useState('');
  const [visitorType, setVisitorType] = useState('all');
  const [checkInStatus, setCheckInStatus] = useState('all');
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [records, setRecords] = useState<VisitorLogbookRecord[]>([]);
  const isGatekeeper = props.role === 'gatekeeper';
  const isVisitorManagement = props.page === 'Visitor Management';
  const site = isGatekeeper ? assignedGatekeeperSite(props) : props.sites.find((item) => item.id === props.siteId);
  const [loading, finishLoading] = useSilentLoad(`${props.user?.id ?? 'staff'}:${props.role}:${site?.id ?? 'unassigned'}`);
  const [refreshing, setRefreshing] = useState(false);
  const queryKey = `${site?.id ?? 'unassigned'}:${visitDate}:${visitorType}:${checkInStatus}:${nameQuery}:${referenceQuery}:${page}`;
  const [loadedQueryKey, setLoadedQueryKey] = useState('');
  const resultsCurrent = loadedQueryKey === queryKey;
  useEffect(() => {
    let active = true;
    if (!site || !visitDate) { setRecords([]); setTotal(0); setLoadedQueryKey(queryKey); setRefreshing(false); finishLoading(); return () => { active = false; }; }
    setRefreshing(true);
    void (async () => {
      let request = db().from('reservation_visitors').select(
        'id,sequence_number,visitor_type,full_name,address,gender,nationality,check_in_status,checked_in_at,booking:bookings!inner(site_id,booking_reference,booking_status,site_slots!inner(slot_date,starts_at))',
        { count: 'exact' },
      ).eq('booking.site_id', site.id).eq('booking.site_slots.slot_date', visitDate)
        .in('booking.booking_status', ['confirmed', 'completed']);
      if (visitorType !== 'all') request = request.eq('visitor_type', visitorType);
      if (checkInStatus !== 'all') request = request.eq('check_in_status', checkInStatus);
      const name = safeBookingSearch(nameQuery);
      const reference = safeBookingSearch(referenceQuery);
      if (name) request = request.ilike('full_name', `%${name}%`);
      if (reference) request = request.ilike('booking.booking_reference', `%${reference}%`);
      const { data, count, error } = await request.order('booking_id').order('sequence_number')
        .range(page * 50, page * 50 + 49);
      if (error) throw error;
      if (active) { setRecords((data ?? []) as unknown as VisitorLogbookRecord[]); setTotal(count ?? 0); setLoadedQueryKey(queryKey); }
    })().catch((error) => { if (active) props.notify(error instanceof Error ? error.message : 'Could not load visitor records.'); })
      .finally(() => { if (active) { setRefreshing(false); finishLoading(); } });
    return () => { active = false; };
  }, [checkInStatus, finishLoading, nameQuery, page, props.notify, queryKey, referenceQuery, site?.id, visitDate, visitorType]);
  const fields = site ? requiredVisitorFields(site.slug) : [];
  const columns = ['Name', 'Booking reference', 'Visit date', 'Visitor type',
    ...fields.filter((field) => field !== 'fullName').map((field) => ({ address: 'Address', gender: 'Gender', nationality: 'Nationality' }[field])),
    'Check-in status', 'Checked in at'];
  const csvRows = records.map((record) => ({ Name: record.full_name, 'Booking reference': record.booking.booking_reference,
    'Visit date': record.booking.site_slots.slot_date, 'Visitor type': record.visitor_type,
    ...Object.fromEntries(fields.filter((field) => field !== 'fullName').map((field) => [
      ({ address: 'Address', gender: 'Gender', nationality: 'Nationality' }[field]),
      ({ address: record.address, gender: record.gender ?? '', nationality: record.nationality ?? '' }[field as 'address' | 'gender' | 'nationality']),
    ])), 'Check-in status': record.check_in_status, 'Checked in at': record.checked_in_at ?? '' }));
  const pageCount = Math.max(1, Math.ceil(total / 50));
  return <section className="dashboard-page section-wrap visitor-logbook"><div className="dash-header"><div><span className="eyebrow"><span className="eyebrow-line"/> {site?.name ?? 'DESTINATION OPERATIONS'}</span>
    <h1>{isVisitorManagement ? <>Visitor <em>records.</em></> : <>Visitor <em>logbook.</em></>}</h1>
    <p>Confirmed and completed reservations. Group scans update each visitor in that booking.</p></div>
    <div className="header-actions">{!isGatekeeper && <SiteSelector {...props}/>}<label className="month-picker">Visit date<input type="date" value={visitDate} onChange={(event) => { setPage(0); setVisitDate(event.target.value); }}/></label>
      <button className="btn btn-outline" disabled={loading || refreshing || !resultsCurrent || !records.length} onClick={() => void exportCsv(`visitor-logbook-${site?.slug ?? 'site'}-${visitDate}.csv`, csvRows)}><ArrowDownToLine size={15}/> Export CSV</button>
      <button className="btn btn-outline" disabled={loading || refreshing || !resultsCurrent || !records.length} onClick={() => window.print()}><Printer size={15}/> Print</button></div></div>
    <div className="visitor-logbook-toolbar"><label>Visitor name<input value={nameQuery} onChange={(event) => { setPage(0); setNameQuery(event.target.value); }} placeholder="Search by name"/></label>
      <label>Booking reference<input value={referenceQuery} onChange={(event) => { setPage(0); setReferenceQuery(event.target.value); }} placeholder="Search reference"/></label>
      <label>Visitor type<select value={visitorType} onChange={(event) => { setPage(0); setVisitorType(event.target.value); }}><option value="all">All visitors</option><option value="adult">Adults</option><option value="child">Children</option></select></label>
      <label>Check-in status<select value={checkInStatus} onChange={(event) => { setPage(0); setCheckInStatus(event.target.value); }}><option value="all">All statuses</option><option value="not_checked_in">Not checked in</option><option value="checked_in">Checked in</option></select></label>
      <span aria-live="polite">{site?.name ?? 'No assigned destination'} · {dateLabel(visitDate)} · {loading ? 'Loading…' : refreshing ? 'Updating records…' : resultsCurrent ? `${total} visitors` : 'Showing previous results'}</span></div>
    {!site && <div className="empty-inline">No single destination assignment is available.</div>}
    {site && !loading && !refreshing && resultsCurrent && !records.length && <div className="empty-inline">No visitor records match this destination, date, and filters.</div>}
    {loading && <div className="empty-inline">Loading visitor records…</div>}
    {site && !loading && records.length > 0 && <div className="table-card visitor-logbook-table" aria-busy={refreshing || !resultsCurrent}><table><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
      <tbody>{records.map((record) => <tr key={record.id}><td>{record.full_name}</td><td>{record.booking.booking_reference}</td>
        <td>{dateLabel(record.booking.site_slots.slot_date)}<small>{timeLabel(record.booking.site_slots.starts_at)}</small></td><td>{record.visitor_type}</td>
        {fields.filter((field) => field !== 'fullName').map((field) => <td key={field}>{({ address: record.address, gender: record.gender, nationality: record.nationality }[field] ?? '—')}</td>)}
        <td><span className={record.check_in_status === 'checked_in' ? 'status-tag paid' : 'status-tag'}>{record.check_in_status.replace(/_/g, ' ')}</span></td>
        <td>{record.checked_in_at ? new Date(record.checked_in_at).toLocaleTimeString() : '—'}</td></tr>)}</tbody></table></div>}
    {site && <div className="staff-quick"><button className="btn btn-outline" disabled={loading || refreshing || !resultsCurrent || page === 0} onClick={() => setPage((current) => current - 1)}><ArrowLeft size={15}/> Previous</button>
      <span>Page {page + 1} of {pageCount}</span><button className="btn btn-outline" disabled={loading || refreshing || !resultsCurrent || page + 1 >= pageCount} onClick={() => setPage((current) => current + 1)}>Next <ArrowRight size={15}/></button></div>}
    <p className="report-note"><ShieldCheck size={15}/> RLS limits records to the visitor, assigned destination team, or Tourism Office.</p>
  </section>;
}

function ReportsPage(props: Props) {
  const [metrics, setMetrics] = useState<Array<Record<string, any>>>([]);
  const [audit, setAudit] = useState<Array<Record<string, any>>>([]);
  const [month, setMonth] = useState(phToday().slice(0, 7));
  const siteIds = props.role === 'tourism_office' ? props.sites.map((site) => site.id) : [props.siteId].filter(Boolean);
  const reportKey = `${props.user?.id ?? 'staff'}:${props.role}:${siteIds.join(',')}:${month}`;
  const [loading, finishLoading] = useSilentLoad(reportKey);
  const [loadedReportKey, setLoadedReportKey] = useState('');
  const reportCurrent = loadedReportKey === reportKey;
  const refresh = useCallback(async () => {
    if (!siteIds.length) { setMetrics([]); setAudit([]); setLoadedReportKey(reportKey); finishLoading(); return; }
    const start = month + '-01';
    const [year, monthNumber] = month.split('-').map(Number);
    const end = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
    try {
      let metricQuery = props.role === 'gatekeeper'
        ? db().from('site_visit_daily_metrics').select('site_id,report_date,booking_count,pending_booking_count,confirmed_booking_count,cancelled_booking_count,expected_visitor_count,adult_count,child_count,checked_in_visitor_count')
        : db().from('booking_daily_metrics').select('site_id,report_date,booking_count,visitor_count,walk_in_count,online_count');
      metricQuery = metricQuery.gte('report_date', start).lte('report_date', end);
      let auditQuery = db().from('audit_logs').select('id,actor_id,site_id,action,entity_type,entity_id,created_at')
        .gte('created_at', localStart(start)).lte('created_at', localEnd(end)).order('created_at', { ascending: false }).limit(200);
      if (props.role !== 'tourism_office') {
        metricQuery = metricQuery.eq('site_id', props.siteId);
        auditQuery = auditQuery.eq('site_id', props.siteId);
      } else if (siteIds.length) {
        metricQuery = metricQuery.in('site_id', siteIds);
        auditQuery = auditQuery.in('site_id', siteIds);
      }
      const [metricResult, auditResult] = await Promise.all([metricQuery.order('report_date'), auditQuery]);
      if (metricResult.error) throw metricResult.error;
      if (auditResult.error) throw auditResult.error;
      setMetrics(metricResult.data ?? []);
      setAudit(auditResult.data ?? []);
      setLoadedReportKey(reportKey);
    } catch (error) { props.notify(error instanceof Error ? error.message : 'Could not load the report.'); }
    finally { finishLoading(); }
  }, [finishLoading, month, props.notify, props.role, props.siteId, reportKey, siteIds.join(',')]);
  useEffect(() => { void refresh(); }, [refresh]);
  const summary = (key: string) => metrics.reduce((sum, row) => sum + Number(row[key] ?? 0), 0);
  const siteName = (id: string) => props.sites.find((site) => site.id === id)?.name ?? id;
  const gatekeeperStats = props.role === 'gatekeeper';
  return <section className="dashboard-page section-wrap"><div className="dash-header"><div><span className="eyebrow"><span className="eyebrow-line"/> {props.role === 'tourism_office' ? 'TOURISM OFFICE · NETWORK REPORT' : gatekeeperStats ? 'GATEKEEPER · DESTINATION REPORT' : 'SITE ADMIN · DESTINATION REPORT'}</span>
    <h1>{gatekeeperStats ? <>Track visitor <em>trends.</em></> : <>See the recorded <em>picture.</em></>}</h1><p>{gatekeeperStats ? 'Visit-date counts for your assigned destination only.' : 'Activity counts come from booking records. Fee amounts are estimates; payments are not processed here.'}</p></div>
    <div className="header-actions"><label className="month-picker">Month<input type="month" value={month} onChange={(event) => setMonth(event.target.value)}/></label>
      {props.role === 'tourism_office' && <SiteSelector {...props}/>}<button className="btn btn-outline" disabled={loading || !reportCurrent || !metrics.length} onClick={() => void exportCsv('iliguide-report-' + month + '.csv', metrics.map((row) => ({ ...row, site_name: siteName(row.site_id) })))}><ArrowDownToLine size={15}/> Export</button></div></div>
    <div className="stats-grid">{(gatekeeperStats
      ? [[summary('expected_visitor_count').toLocaleString(), 'Expected visitors'], [summary('checked_in_visitor_count').toLocaleString(), 'Checked in'], [summary('adult_count').toLocaleString(), 'Adults'], [summary('child_count').toLocaleString(), 'Children']]
      : [[summary('visitor_count').toLocaleString(), 'Visitors'], [summary('online_count').toLocaleString(), 'Online bookings'], [summary('walk_in_count').toLocaleString(), 'Walk-ins']])
      .map(([value, label]) => <div key={label}><b>{loading || !reportCurrent ? '…' : value}</b><small>{label}</small></div>)}</div>
    <div className="report-grid"><div className="chart-card"><div className="card-heading"><span><small>{gatekeeperStats ? 'VISIT DATE · ' + month : 'BY DESTINATION · ' + month}</small><h3>{gatekeeperStats ? 'Daily visitor counts' : 'Recorded activity'}</h3></span></div>
      {!reportCurrent && <div className="empty-inline">{loading ? 'Loading report…' : 'Report data for this period is unavailable.'}</div>}
      {reportCurrent && !loading && !metrics.length && <div className="empty-inline">No booking records for this reporting period.</div>}
       <div className="table-card"><table><thead><tr>{gatekeeperStats
         ? <><th>Date</th><th>Reservations</th><th>Expected</th><th>Checked in</th><th>Adults</th><th>Children</th><th>Awaiting</th><th>Confirmed</th><th>Cancelled</th></>
         : <><th>Date</th><th>Destination</th><th>Visitors</th><th>Online</th><th>Walk-in</th></>}</tr></thead>
         <tbody>{reportCurrent && !loading && metrics.map((row, index) => <tr key={row.site_id + row.report_date + index}>{gatekeeperStats
           ? <><td>{dateLabel(row.report_date)}</td><td>{row.booking_count}</td><td>{row.expected_visitor_count}</td><td>{row.checked_in_visitor_count}</td><td>{row.adult_count}</td><td>{row.child_count}</td><td>{row.pending_booking_count}</td><td>{row.confirmed_booking_count}</td><td>{row.cancelled_booking_count}</td></>
           : <><td>{dateLabel(row.report_date)}</td><td>{siteName(row.site_id)}</td><td>{row.visitor_count}</td><td>{row.online_count}</td><td>{row.walk_in_count}</td></>}</tr>)}</tbody></table></div>
    </div><div className="chart-card"><div className="card-heading"><span><small>RECORDED CHANGES</small><h3>Audit activity</h3></span><ShieldCheck size={17}/></div>
      {!reportCurrent && <div className="empty-inline">{loading ? 'Loading audit history…' : 'Audit data for this period is unavailable.'}</div>}
      {reportCurrent && !loading && !audit.length && <div className="empty-inline">No audit events in this period.</div>}
      {reportCurrent && !loading && audit.map((row) => <div className="audit-row" key={row.id}><span><b>{row.action.replace(/_/g, ' ')}</b><small>{row.entity_type} · {siteName(row.site_id)}</small></span><time>{new Date(row.created_at).toLocaleString()}</time></div>)}
    </div></div>
    <p className="report-note"><ShieldCheck size={15}/> Reports are scoped by row level security. A zero count means no matching rows were recorded.</p>
  </section>;
}

function ActivityPage(props: Props) {
  const [events, setEvents] = useState<Array<Record<string, any>>>([]);
  const site = assignedGatekeeperSite(props);
  const [loading, finishLoading] = useSilentLoad(`${props.user?.id ?? 'staff'}:${props.role}:${site?.id ?? 'unassigned'}`);
  useEffect(() => {
    let active = true;
    if (!site) { setEvents([]); finishLoading(); return () => { active = false; }; }
    void (async () => {
      const { data, error } = await db().from('audit_logs').select('id,action,entity_type,entity_id,created_at')
        .eq('site_id', site.id).order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      if (active) setEvents(data ?? []);
    })().catch((error) => { if (active) props.notify(error instanceof Error ? error.message : 'Could not load destination activity.'); })
      .finally(() => { if (active) finishLoading(); });
    return () => { active = false; };
  }, [finishLoading, props.notify, site?.id]);
  return <section className="dashboard-page section-wrap"><div className="dash-header"><div><span className="eyebrow"><span className="eyebrow-line"/> {site?.name ?? 'DESTINATION'} · ACTIVITY</span>
    <h1>Recorded <em>activity.</em></h1><p>Booking and check-in changes recorded for this destination.</p></div></div>
    {!site && <div className="empty-inline">No single destination assignment is available.</div>}
    {loading && <div className="empty-inline">Loading activity…</div>}
    {!loading && !events.length && <div className="empty-inline">No destination activity recorded yet.</div>}
    <div className="activity-card">{!loading && events.map((event) => <div className="audit-row" key={event.id}><span><b>{String(event.action).replace(/_/g, ' ')}</b><small>{event.entity_type} · {String(event.entity_id).slice(0, 8)}</small></span>
      <time>{new Date(event.created_at).toLocaleString()}</time></div>)}</div>
    <p className="report-note"><ShieldCheck size={15}/> This feed uses the protected audit log. Gatekeepers cannot modify these records.</p>
  </section>;
}

type SiteDraft = {
  name: string; category: string; description: string; address: string;
  latitude: string; longitude: string;
  adult_fee: string; child_fee: string; pwd_discount_percent: string; daily_capacity: string;
  fee_information_confirmed: boolean; max_per_booking: string; cancellation_cutoff_hours: string;
};
type PendingSitePhoto = { file: File; preview: string };
const emptyDraft = (): SiteDraft => ({ name: '', category: '', description: '', address: '', latitude: '', longitude: '', adult_fee: '', child_fee: '', pwd_discount_percent: '0', daily_capacity: '', fee_information_confirmed: false, max_per_booking: '20', cancellation_cutoff_hours: '24' });
function SitesPage(props: Props) {
  const [draft, setDraft] = useState<SiteDraft>(emptyDraft());
  const [photos, setPhotos] = useState<PendingSitePhoto[]>([]);
  const previewUrls = useRef(new Set<string>());
  const [editing, setEditing] = useState('');
  const [days, setDays] = useState<number[]>([]);
  const [opens, setOpens] = useState('');
  const [closes, setCloses] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusBusy, setStatusBusy] = useState('');

  useEffect(() => () => previewUrls.current.forEach((url) => URL.revokeObjectURL(url)), []);
  const releasePhotos = (items: PendingSitePhoto[]) => items.forEach(({ preview }) => {
    URL.revokeObjectURL(preview); previewUrls.current.delete(preview);
  });
  const choosePhotos = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!selected.length) return;
    if (photos.length + selected.length > 3) { props.notify('Choose up to 3 destination photos in total.'); return; }
    const invalid = selected.find((file) => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024);
    if (invalid) { props.notify('Choose JPEG, PNG, or WebP photos under 5 MiB each.'); return; }
    const additions = selected.map((file) => ({ file, preview: URL.createObjectURL(file) }));
    additions.forEach(({ preview }) => previewUrls.current.add(preview));
    setPhotos((current) => [...current, ...additions]);
  };
  const removePendingPhoto = (preview: string) => {
    const removed = photos.find((photo) => photo.preview === preview);
    if (removed) releasePhotos([removed]);
    setPhotos((current) => current.filter((photo) => photo.preview !== preview));
  };

  const change = (key: keyof SiteDraft, value: string) => setDraft((current) => ({ ...current, [key]: value,
    ...(['adult_fee', 'child_fee', 'pwd_discount_percent'].includes(key) ? { fee_information_confirmed: false } : {}),
  }));
  const beginEdit = (site: Site) => {
    setEditing(site.id);
    setDraft({
      name: site.name, category: site.category, description: site.description, address: site.address,
      latitude: site.latitude == null ? '' : String(site.latitude), longitude: site.longitude == null ? '' : String(site.longitude),
      adult_fee: String(site.adult_fee), child_fee: String(site.child_fee),
      pwd_discount_percent: String(site.pwd_discount_percent), daily_capacity: site.daily_capacity == null ? '' : String(site.daily_capacity),
      fee_information_confirmed: site.fee_information_confirmed,
      max_per_booking: String(site.max_per_booking), cancellation_cutoff_hours: String(site.cancellation_cutoff_hours),
    });
  };
  const slugFromName = (name: string) => name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const saveSite = async (event: FormEvent) => {
    event.preventDefault();
    if (!props.user) { props.notify('Sign in with a Tourism Office account first.'); return; }
    const siteName = draft.name.trim(), category = draft.category.trim();
    if (siteName.length < 2 || siteName.length > 160 || category.length < 2 || category.length > 80) {
      props.notify('Enter a destination name and category with at least 2 characters.'); return;
    }
    if (!editing && (!photos.length || photos.length > 3)) { props.notify('Add at least 1 and no more than 3 destination photos.'); return; }
    if (!editing && photos.some(({ file }) => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024)) {
      props.notify('Choose JPEG, PNG, or WebP photos under 5 MiB each.'); return;
    }
    const adultFee = Number(draft.adult_fee), childFee = Number(draft.child_fee);
    const pwdDiscount = Number(draft.pwd_discount_percent), maxPerBooking = Number(draft.max_per_booking);
    const dailyCapacity = draft.daily_capacity.trim() ? Number(draft.daily_capacity) : null;
    if (!Number.isFinite(adultFee) || adultFee < 0 || !Number.isFinite(childFee) || childFee < 0 ||
      !Number.isInteger(maxPerBooking) || maxPerBooking < 1 || maxPerBooking > 500 ||
      !Number.isFinite(pwdDiscount) || pwdDiscount < 0 || pwdDiscount > 100 ||
      dailyCapacity !== null && (!Number.isInteger(dailyCapacity) || dailyCapacity < 1 || dailyCapacity > 100000)) {
      props.notify('Enter valid fees and booking limits.'); return;
    }
    if (pwdDiscount > 0 && adultFee !== childFee) {
      props.notify('PWD discounts require the same adult and child admission fee.'); return;
    }
    const hasLatitude = draft.latitude.trim() !== '';
    const hasLongitude = draft.longitude.trim() !== '';
    if (hasLatitude !== hasLongitude || hasLatitude && (!Number.isFinite(Number(draft.latitude)) || !Number.isFinite(Number(draft.longitude)) ||
      Math.abs(Number(draft.latitude)) > 90 || Math.abs(Number(draft.longitude)) > 180)) {
      props.notify('Enter both map coordinates within valid latitude and longitude ranges, or leave both blank.'); return;
    }
    if (!editing && (!days.length || !opens || !closes || closes <= opens)) {
      props.notify('Choose at least one operating day and valid opening hours.'); return;
    }
    if (!editing && !draft.fee_information_confirmed) { props.notify('Confirm the current admission fees before creating an official destination.'); return; }
    setLoading(true);
    let createdSiteId = editing;
    const uploadedPaths: string[] = [];
    try {
      const siteValues = {
        name: siteName, category, description: draft.description.trim(),
        address: draft.address.trim(), latitude: hasLatitude ? Number(draft.latitude) : null,
        longitude: hasLongitude ? Number(draft.longitude) : null,
      };
      if (editing) {
        const { error } = await db().from('tourism_sites').update(siteValues).eq('id', editing);
        if (error) throw error;
      } else {
        const slug = (slugFromName(siteName) || 'destination') + '-' + crypto.randomUUID().slice(0, 8);
        const { data, error } = await db().from('tourism_sites').insert({
          ...siteValues, slug, status: 'draft', created_by: props.user.id,
        }).select('id').single();
        if (error) throw error;
        createdSiteId = data.id;
      }
      const { error: settingsError } = await db().from('site_settings').upsert({
        site_id: createdSiteId,
        adult_fee: adultFee,
        child_fee: childFee,
        pwd_discount_percent: pwdDiscount,
        daily_capacity: dailyCapacity,
        fee_information_confirmed: draft.fee_information_confirmed,
        max_per_booking: Number(draft.max_per_booking),
        cancellation_cutoff_hours: Number(draft.cancellation_cutoff_hours),
        updated_by: props.user.id,
      }, { onConflict: 'site_id' });
      if (settingsError) throw settingsError;
      if (!editing) {
        const hourRows = dayNames.map((_, weekday) => ({
          site_id: createdSiteId, weekday, is_closed: !days.includes(weekday),
          opens_at: days.includes(weekday) ? opens : null,
          closes_at: days.includes(weekday) ? closes : null,
        }));
        const { error: hoursError } = await db().from('site_operating_hours').upsert(hourRows, { onConflict: 'site_id,weekday' });
        if (hoursError) throw hoursError;
        for (const [index, photo] of photos.entries()) {
          const extension = photo.file.type.split('/')[1].replace('jpeg', 'jpg');
          const path = `${createdSiteId}/${crypto.randomUUID()}.${extension}`;
          uploadedPaths.push(path);
          const { error: uploadError } = await db().storage.from('tourism-site-images')
            .upload(path, photo.file, { contentType: photo.file.type, upsert: false });
          if (uploadError) throw uploadError;
          const { error: imageError } = await db().from('site_images').insert({
            site_id: createdSiteId, storage_path: path,
            image_role: index === 0 ? 'cover' : 'gallery', sort_order: index,
            alt_text: siteName, created_by: props.user.id,
          });
          if (imageError) throw imageError;
        }
        const { error: publishError } = await db().from('tourism_sites').update({ status: 'published' })
          .eq('id', createdSiteId).select('id').single();
        if (publishError) throw publishError;
      }
      props.setSiteId(createdSiteId);
      props.notify(editing ? 'Destination details and fees saved.' : 'Official destination created and published.');
      if (!editing) { releasePhotos(photos); setPhotos([]); }
      setDraft(emptyDraft()); setEditing(''); setDays([]); setOpens(''); setCloses('');
      props.refresh();
    } catch (error) {
      const cleanupErrors: string[] = [];
      if (!editing && createdSiteId) {
        if (uploadedPaths.length) {
          const { error: storageCleanupError } = await db().storage.from('tourism-site-images').remove(uploadedPaths);
          if (storageCleanupError) cleanupErrors.push('Some uploaded photos may need manual removal.');
        }
        const { error: siteCleanupError } = await db().from('tourism_sites').delete().eq('id', createdSiteId);
        if (siteCleanupError) cleanupErrors.push('The incomplete destination record could not be removed.');
      }
      props.notify((editing ? 'Could not save destination. ' : 'Could not create the official destination. ') +
        (error instanceof Error ? error.message : 'Please retry.') + (cleanupErrors.length ? ' ' + cleanupErrors.join(' ') : ''));
      props.refresh();
    } finally { setLoading(false); }
  };
  const updateStatus = async (site: Site, next: string) => {
    setStatusBusy(site.id);
    try {
      if (next === 'published') {
        const [settingsResult, hoursResult, slotsResult, imagesResult] = await Promise.all([
          db().from('site_settings').select('site_id,fee_information_confirmed').eq('site_id', site.id).maybeSingle(),
          db().from('site_operating_hours').select('weekday').eq('site_id', site.id).eq('is_closed', false),
          db().from('site_slots').select('id').eq('site_id', site.id).eq('status', 'open').gte('slot_date', phToday()).limit(1),
          db().from('site_images').select('id').eq('site_id', site.id).limit(1),
        ]);
        if (settingsResult.error) throw settingsResult.error;
        if (hoursResult.error) throw hoursResult.error;
        if (slotsResult.error) throw slotsResult.error;
        if (imagesResult.error) throw imagesResult.error;
        if (!imagesResult.data?.length) throw new Error('Add at least one destination photo before publishing.');
        if (!settingsResult.data || !settingsResult.data.fee_information_confirmed || !hoursResult.data?.length || !slotsResult.data?.length) {
          throw new Error('Confirm current fees, set at least one open day, and add an upcoming open slot before publishing.');
        }
      }
      const { error } = await db().from('tourism_sites').update({ status: next }).eq('id', site.id);
      if (error) throw error;
      props.notify('Destination status updated to ' + next.replace('_', ' ') + '.');
      props.refresh();
    } catch (error) { props.notify(error instanceof Error ? error.message : 'Could not update destination status.'); }
    finally { setStatusBusy(''); }
  };

  const site = props.sites.find((item) => item.id === props.siteId) ?? null;
  return <section className="dashboard-page section-wrap"><div className="dash-header"><div><span className="eyebrow"><span className="eyebrow-line"/> TOURISM OFFICE · NETWORK</span>
    <h1>Places and <em>people.</em></h1><p>Create official destination records with photos, current fees, and operating hours.</p></div>
    <button className="btn btn-outline" onClick={() => props.go('Staff and accounts')}>Manage site staff <Users size={15}/></button></div>
    <div className="sites-admin-layout"><div className="sites-admin-list"><div className="card-heading"><span><small>DATABASE RECORDS</small><h3>Destinations</h3></span><span>{props.sites.length} total</span></div>
      {!props.sites.length && <div className="empty-inline">No destination records have been created.</div>}
      {props.sites.map((item) => <article className={props.siteId === item.id ? 'site-admin-row selected' : 'site-admin-row'} key={item.id}>
        <button className="site-admin-main" onClick={() => props.setSiteId(item.id)}><span><b>{item.name}</b><small>{item.address || item.category} · {item.fee_information_confirmed ? `Adult ${money(item.adult_fee)} / child ${money(item.child_fee)}` : 'Fee information needs confirmation'}</small></span><span className={'status-tag ' + (item.status === 'published' ? 'paid' : '')}>{item.status.replace('_', ' ')}</span></button>
        <div className="site-admin-actions"><button className="link-btn" onClick={() => beginEdit(item)}>Edit</button>
          <select aria-label={'Change status for ' + item.name} value={item.status} disabled={statusBusy === item.id} onChange={(event) => void updateStatus(item, event.target.value)}>
            {['draft', 'published', 'temporarily_closed', 'inactive'].map((status) => <option key={status} value={status}>{status.replace('_', ' ')}</option>)}
          </select></div>
      </article>)}
    </div>
    <div className="sites-admin-form"><form className="form-card" onSubmit={(event) => void saveSite(event)}><div className="card-heading"><span><small>{editing ? 'EDIT DESTINATION' : 'NEW DESTINATION'}</small><h3>{editing ? 'Update details' : 'Create an official site'}</h3></span><MapPin size={18}/></div>
      <label>Destination name<input required value={draft.name} onChange={(event) => change('name', event.target.value)} maxLength={160}/></label>
      <label>Category<input required value={draft.category} onChange={(event) => change('category', event.target.value)} maxLength={80} placeholder="Waterfall, spring, heritage site…"/></label>
      <label>Location or address<input value={draft.address} onChange={(event) => change('address', event.target.value)} maxLength={500}/></label>
      <div className="form-two"><label>Map latitude<input type="number" min="-90" max="90" step="any" value={draft.latitude} onChange={(event) => change('latitude', event.target.value)} placeholder="e.g. 8.23"/></label>
        <label>Map longitude<input type="number" min="-180" max="180" step="any" value={draft.longitude} onChange={(event) => change('longitude', event.target.value)} placeholder="e.g. 124.24"/></label></div>
      <p className="field-hint">Optional. Enter a verified coordinate pair to place this destination on the map.</p>
      <label>Description<textarea value={draft.description} onChange={(event) => change('description', event.target.value)} maxLength={5000} rows={4}/></label>
      {!editing && <div className="destination-photo-field" role="group" aria-labelledby="destination-photo-heading">
        <div className="destination-photo-heading"><span><b id="destination-photo-heading">Destination photos</b><small>Choose at least 1 and up to 3 photos.</small></span><span className="destination-photo-count">{photos.length}/3</span></div>
        <div className="destination-photo-grid">
          {photos.map((photo, index) => <figure className="destination-photo-preview" key={photo.preview}>
            <img src={photo.preview} alt={`Destination photo ${index + 1} preview`}/>
            <button type="button" aria-label={`Remove destination photo ${index + 1}`} onClick={() => removePendingPhoto(photo.preview)} disabled={loading}><X size={14}/></button>
            <figcaption>{index === 0 ? 'Cover photo' : `Photo ${index + 1}`}</figcaption>
          </figure>)}
          {photos.length < 3 && <label className="destination-photo-add"><ImagePlus size={20}/><span>{photos.length ? 'Add photos' : 'Choose photos'}</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple aria-label="Choose 1 to 3 destination photos" disabled={loading} onChange={choosePhotos}/>
          </label>}
        </div>
        <p className="field-hint" aria-live="polite">{photos.length ? `${photos.length} of 3 selected · The first photo is the cover.` : 'JPEG, PNG, or WebP · maximum 5 MiB each. At least one photo is required.'}</p>
      </div>}
      <div className="form-two"><label>Adult fee (PHP)<input type="number" min="0" step="0.01" required value={draft.adult_fee} onChange={(event) => change('adult_fee', event.target.value)}/></label>
        <label>Child fee (PHP)<input type="number" min="0" step="0.01" required value={draft.child_fee} onChange={(event) => change('child_fee', event.target.value)}/></label></div>
      <div className="form-two"><label>PWD discount (%)<input type="number" min="0" max="100" step="0.01" required value={draft.pwd_discount_percent} onChange={(event) => change('pwd_discount_percent', event.target.value)}/></label>
        <label>Daily visitor limit<input type="number" min="1" max="100000" step="1" value={draft.daily_capacity} onChange={(event) => change('daily_capacity', event.target.value)} placeholder="No limit"/></label></div>
      <small className="field-hint">Set a PWD discount only when adult and child admission fees match. Leave the daily limit blank if none has been approved.</small>
      <label className="checkbox-field"><input type="checkbox" checked={draft.fee_information_confirmed} onChange={(event) => setDraft((current) => ({ ...current, fee_information_confirmed: event.target.checked }))}/> I confirm these are the destination’s current admission fees.</label>
      <div className="form-two"><label>Max visitors / booking<input type="number" min="1" max="500" required value={draft.max_per_booking} onChange={(event) => change('max_per_booking', event.target.value)}/></label>
        <label>Cancellation cutoff (hours)<input type="number" min="0" max="8760" required value={draft.cancellation_cutoff_hours} onChange={(event) => change('cancellation_cutoff_hours', event.target.value)}/></label></div>
      {!editing && <><fieldset className="operating-days"><legend>Operating days</legend>{dayNames.map((day, weekday) => <label key={day}><input type="checkbox" checked={days.includes(weekday)} onChange={(event) => setDays(event.target.checked ? [...days, weekday] : days.filter((value) => value !== weekday))}/>{day.slice(0, 3)}</label>)}</fieldset>
        <div className="form-two"><label>Opens at<input type="time" value={opens} onChange={(event) => setOpens(event.target.value)} required/></label><label>Closes at<input type="time" value={closes} onChange={(event) => setCloses(event.target.value)} required/></label></div></>}
      <button className="btn btn-primary btn-wide" disabled={loading}>{loading ? 'Saving…' : editing ? 'Save destination' : 'Create official destination'} <Check size={15}/></button>
      {editing && <button type="button" className="link-btn form-cancel" onClick={() => { setEditing(''); setDraft(emptyDraft()); }}>Cancel edit</button>}
      {!editing && <p className="field-hint">Once saved, the destination appears publicly. Add visit slots so visitors can book a time.</p>}
    </form></div></div>
    {site && <><div className="workspace-panel-select"><label>Manage destination photos <SiteSelector {...props}/></label></div><SiteImagesManager {...props}/></>}
  </section>;
}

type ProfileName = { full_name: string; account_status?: string; role?: string };
type GatekeeperOption = { profile_id: string; profiles: ProfileName | ProfileName[] | null };
type DutyRow = {
  id: string; duty_date: string; shift_start_at: string; shift_end_at: string; status: string;
  primary_gatekeeper_id?: string;
  primary: ProfileName | ProfileName[] | null;
  supports: Array<{ gatekeeper_id: string; gatekeeper: ProfileName | ProfileName[] | null }>;
};
const profileName = (profile: ProfileName | ProfileName[] | null) => (Array.isArray(profile) ? profile[0] : profile)?.full_name ?? 'Gatekeeper';
function DutyRosterPanel(props: Props & { site: Site }) {
  const [gatekeepers, setGatekeepers] = useState<GatekeeperOption[]>([]);
  const [duties, setDuties] = useState<DutyRow[]>([]);
  const [form, setForm] = useState({ date: phToday(), start: '', end: '', primary: '', supports: [] as string[] });
  const [filterDate, setFilterDate] = useState(phToday());
  const [loading, finishLoading] = useSilentLoad(`${props.user?.id ?? 'staff'}:${props.site.id}:${filterDate}`);
  const [saving, setSaving] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const [staff, roster] = await Promise.all([
        db().from('staff_assignments').select('profile_id, profiles!staff_assignments_profile_id_fkey(full_name,account_status,role)')
          .eq('site_id', props.site.id).eq('staff_role', 'gatekeeper').eq('is_active', true),
        db().from('site_gatekeeper_duties').select(
          'id,duty_date,shift_start_at,shift_end_at,status,primary_gatekeeper_id,primary:profiles!site_gatekeeper_duties_primary_gatekeeper_id_fkey(full_name),supports:site_gatekeeper_duty_support(gatekeeper_id,gatekeeper:profiles(full_name))',
        ).eq('site_id', props.site.id).eq('duty_date', filterDate).order('shift_start_at').limit(100),
      ]);
      if (staff.error) throw staff.error;
      if (roster.error) throw roster.error;
      setGatekeepers((staff.data ?? []) as unknown as GatekeeperOption[]);
      setDuties((roster.data ?? []) as unknown as DutyRow[]);
    } catch (error) { props.notify(error instanceof Error ? error.message : 'Could not load the duty roster.'); }
    finally { finishLoading(); }
  }, [filterDate, finishLoading, props.notify, props.site.id]);
  useEffect(() => { void refresh(); }, [refresh]);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.primary || form.end <= form.start) { props.notify('Choose a primary gatekeeper and valid shift hours.'); return; }
    setSaving(true);
    try {
      const { error } = await db().rpc('create_gatekeeper_duty', {
        p_site_id: props.site.id,
        p_duty_date: form.date,
        p_shift_start_at: new Date(`${form.date}T${form.start}:00+08:00`).toISOString(),
        p_shift_end_at: new Date(`${form.date}T${form.end}:00+08:00`).toISOString(),
        p_primary_gatekeeper_id: form.primary,
        p_support_gatekeeper_ids: form.supports,
      });
      if (error) throw error;
      props.notify('Gatekeeper duty scheduled.');
      setForm((current) => ({ ...current, primary: '', supports: [] }));
      await refresh();
    } catch (error) { props.notify(error instanceof Error ? error.message : 'Could not schedule gatekeeper duty.'); }
    finally { setSaving(false); }
  };
  const supportOptions = gatekeepers.filter((person) => person.profile_id !== form.primary && person.profile_id !== props.user?.id);
  return <section className="duty-roster"><div className="card-heading"><span><small>DAILY ACCOUNTABILITY</small><h3>Gatekeeper duty roster</h3></span><CalendarDays size={18}/></div>
    <p className="field-hint">One primary gatekeeper is required for every shift. Support staff are optional. Times use Asia/Manila.</p>
    {!gatekeepers.length && !loading && <div className="empty-inline">Assign an active gatekeeper to this destination before scheduling a shift.</div>}
    <div className="duty-roster-filter"><label>Show roster for<input type="date" value={filterDate} onChange={(event) => setFilterDate(event.target.value)}/></label><span>{props.site.name}</span></div>
    <form className="duty-roster-form" onSubmit={(event) => void save(event)}>
      <label>Date<input type="date" min={phToday()} value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} required/></label>
      <label>Start<input type="time" value={form.start} onChange={(event) => setForm({ ...form, start: event.target.value })} required/></label>
      <label>End<input type="time" value={form.end} onChange={(event) => setForm({ ...form, end: event.target.value })} required/></label>
      <label>Primary gatekeeper<select value={form.primary} onChange={(event) => setForm({ ...form, primary: event.target.value, supports: form.supports.filter((id) => id !== event.target.value) })} required><option value="">Choose primary</option>{gatekeepers.filter((person) => person.profile_id !== props.user?.id).map((person) => <option key={person.profile_id} value={person.profile_id}>{profileName(person.profiles)}</option>)}</select></label>
      {!!supportOptions.length && <fieldset><legend>Support gatekeepers</legend>{supportOptions.map((person) => <label key={person.profile_id}><input type="checkbox" checked={form.supports.includes(person.profile_id)} onChange={(event) => setForm({ ...form, supports: event.target.checked ? [...form.supports, person.profile_id] : form.supports.filter((id) => id !== person.profile_id) })}/>{profileName(person.profiles)}</label>)}</fieldset>}
      <button className="btn btn-primary" disabled={saving || loading || !gatekeepers.length}>{saving ? 'Scheduling…' : 'Schedule duty'} <Check size={15}/></button>
    </form>
    <div className="duty-list">{loading && <div className="empty-inline">Loading roster…</div>}{!loading && !duties.length && <div className="empty-inline">No upcoming duty shifts scheduled.</div>}
      {!loading && duties.map((duty) => <article key={duty.id}><span><b>{dateLabel(duty.duty_date)}</b><small>{new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' }).format(new Date(duty.shift_start_at))} – {new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' }).format(new Date(duty.shift_end_at))}</small></span><span><b>{profileName(duty.primary)}</b><small>{duty.supports.length ? `Support: ${duty.supports.map((support) => profileName(support.gatekeeper)).join(', ')}` : 'No support staff'}</small></span><span className="status-tag">{duty.status}</span></article>)}</div>
  </section>;
}

function DutyRosterPage(props: Props) {
  const site = props.sites.find((item) => item.id === props.siteId);
  return <section className="dashboard-page section-wrap"><div className="dash-header"><div><span className="eyebrow"><span className="eyebrow-line"/> OPERATIONS · STAFF COVERAGE</span><h1>Duty <em>roster.</em></h1><p>Assign one primary gatekeeper and optional support for each site shift.</p></div><label className="staff-site-picker">Destination<SiteSelector {...props}/></label></div>
    {site ? <DutyRosterPanel {...props} site={site}/> : <div className="empty-card"><CalendarClock size={28}/><h3>No destination available</h3><p>Assign this account to a destination before managing its duty roster.</p></div>}
  </section>;
}

function DutyDetailsPage(props: Props) {
  const site = assignedGatekeeperSite(props);
  const [duties, setDuties] = useState<DutyRow[]>([]);
  const [loading, finishLoading] = useSilentLoad(`${props.user?.id ?? 'staff'}:${props.role}:${site?.id ?? 'unassigned'}`);
  useEffect(() => {
    let active = true;
    if (!site) { setDuties([]); finishLoading(); return () => { active = false; }; }
    void (async () => {
      try {
        const { data, error } = await db().from('site_gatekeeper_duties').select('id,duty_date,shift_start_at,shift_end_at,status,primary_gatekeeper_id,primary:profiles!site_gatekeeper_duties_primary_gatekeeper_id_fkey(full_name),supports:site_gatekeeper_duty_support(gatekeeper_id,gatekeeper:profiles(full_name))')
          .eq('site_id', site.id).gte('duty_date', phToday()).in('status', ['scheduled', 'active']).order('shift_start_at').limit(30);
        if (error) throw error;
        if (active) setDuties((data ?? []) as unknown as DutyRow[]);
      } catch (error) { if (active) props.notify(error instanceof Error ? error.message : 'Could not load your duty details.'); }
      finally { if (active) finishLoading(); }
    })();
    return () => { active = false; };
  }, [finishLoading, props.notify, site?.id]);
  const assigned = (duty: DutyRow) => duty.primary_gatekeeper_id === props.user?.id
    ? 'Primary gatekeeper' : duty.supports.some((support) => support.gatekeeper_id === props.user?.id) ? 'Support gatekeeper' : 'Site shift';
  return <section className="dashboard-page section-wrap"><div className="dash-header"><div><span className="eyebrow"><span className="eyebrow-line"/> GATEKEEPER · ASSIGNMENTS</span><h1>Your duty <em>details.</em></h1><p>Upcoming shifts for {site?.name ?? 'your assigned destination'}.</p></div></div>
    <div className="duty-details-list">{loading && <div className="empty-inline">Loading assignments…</div>}{!loading && !duties.length && <div className="empty-card"><CalendarClock size={28}/><h3>No upcoming shifts</h3><p>Ask the Tourism Office to add you to a scheduled shift.</p></div>}
      {duties.map((duty) => <article key={duty.id}><div className="duty-date-tile"><b>{new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', day: '2-digit' }).format(new Date(duty.duty_date + 'T00:00:00+08:00'))}</b><small>{new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short' }).format(new Date(duty.duty_date + 'T00:00:00+08:00'))}</small></div><div><span className="status-tag">{assigned(duty)}</span><h3>{new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'full' }).format(new Date(duty.duty_date + 'T00:00:00+08:00'))}</h3><p>{new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' }).format(new Date(duty.shift_start_at))} – {new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' }).format(new Date(duty.shift_end_at))} · Asia/Manila</p><small>Primary: {profileName(duty.primary)} · {duty.supports.length ? `Support: ${duty.supports.map((item) => profileName(item.gatekeeper)).join(', ')}` : 'No support gatekeeper'}</small></div><span className="status-tag">{duty.status}</span></article>)}</div>
  </section>;
}

function CapacityMapPage(props: Props) {
  const gatekeeper = props.role === 'gatekeeper';
  const site = props.sites.find((item) => item.id === props.siteId);
  const [occupancy, setOccupancy] = useState<LiveOccupancy | null>(null);
  const [zones, setZones] = useState<CapacityZoneRow[]>([]);
  const [warningThreshold, setWarningThreshold] = useState<number | null>(null);
  const [loading, finishLoading] = useSilentLoad(`${props.user?.id ?? 'staff'}:${props.role}:${site?.id ?? 'unselected'}`);
  useEffect(() => {
    let active = true;
    if (!site) { setOccupancy(null); setZones([]); setWarningThreshold(null); finishLoading(); return () => { active = false; }; }
    setOccupancy(null); setZones([]); setWarningThreshold(null);
    void Promise.all([
      loadLiveOccupancy(site.id),
      db().from('site_capacity_zones').select('id,name,zone_type,measured_area,area_unit,estimated_capacity,plan_reference,geometry').eq('site_id', site.id).order('zone_type').order('name'),
      db().from('site_approved_visitor_limits').select('approaching_threshold_percent,effective_from,effective_to').eq('site_id', site.id).eq('status', 'active').lte('effective_from', phToday()).order('effective_from', { ascending: false }).limit(20),
    ]).then(([live, zoneResult, limitResult]) => {
      if (zoneResult.error) throw zoneResult.error;
      if (limitResult.error) throw limitResult.error;
      if (active) {
        setOccupancy(live);
        setZones((zoneResult.data ?? []) as typeof zones);
        const today = phToday();
        const activeLimit = limitResult.data?.find((row) => row.effective_to == null || row.effective_to >= today);
        setWarningThreshold(activeLimit?.approaching_threshold_percent ?? null);
      }
    })
      .catch((error) => { if (active) props.notify(error instanceof Error ? error.message : 'Could not load capacity data.'); })
      .finally(() => { if (active) finishLoading(); });
    return () => { active = false; };
  }, [finishLoading, gatekeeper, props.notify, site?.id]);
  const approvedLimit = occupancy?.approved_visitor_limit;
  const atLimit = approvedLimit != null && (occupancy?.current_visitor_count ?? 0) >= approvedLimit;
  const limitPercent = approvedLimit ? Math.min(100, Math.round((occupancy?.current_visitor_count ?? 0) / approvedLimit * 100)) : null;
  const approachingLimit = !atLimit && limitPercent != null && warningThreshold != null && limitPercent >= warningThreshold;
  const remaining = approvedLimit == null ? null : Math.max(0, approvedLimit - (occupancy?.current_visitor_count ?? 0));
  const capacityStatus = site?.status !== 'published' ? 'Closed / restricted' : atLimit ? 'At approved limit' : approachingLimit ? 'Approaching limit' : approvedLimit == null ? 'Limit not approved' : 'Below approved limit';
  return <section className="dashboard-page section-wrap"><div className="dash-header"><div><span className="eyebrow"><span className="eyebrow-line"/> OPERATIONS · SITE CAPACITY</span><h1>Capacity <em>map.</em></h1><p>Live attendance and verified site-location records for {site?.name ?? 'the selected destination'}.</p></div>{!gatekeeper && <label className="staff-site-picker">Destination<SiteSelector {...props}/></label>}</div>
    {!site ? <div className="empty-card"><MapPinned size={28}/><h3>No destination selected</h3><p>Select a site assigned to your staff account.</p></div> : loading ? <div className="empty-card" role="status"><MapPinned size={28}/><h3>Loading capacity data</h3><p>Getting the records for {site.name}.</p></div> : <><div className="capacity-status-card"><div className={'capacity-status-label ' + (atLimit || site.status !== 'published' ? 'warning' : approachingLimit || approvedLimit == null ? 'informational' : 'available')}><span className="status-dot"/>{capacityStatus}</div>
        {approvedLimit != null ? <><div className="capacity-status-headline"><b>{loading ? '—' : occupancy?.current_visitor_count ?? '—'}</b><span>estimated visitors currently inside</span><strong>{remaining ?? '—'} remaining</strong></div><div className="capacity-progress" role="img" aria-label={`${limitPercent}% of approved visitor limit`}><i style={{ width: `${limitPercent}%` }}/></div><div className="capacity-progress-label"><span>{limitPercent}% of approved visitor limit</span><span>Limit: {approvedLimit}</span></div></>
          : <p>No operational limit is approved. Physical estimates remain informational and do not determine admission status.</p>}
        {atLimit && <div className="capacity-limit-alert"><ShieldCheck size={18}/><span>Approved visitor limit reached. New ticket arrivals and walk-in admissions will be rejected by the database.</span></div>}
        {approachingLimit && <p className="field-hint">Occupancy reached the configured warning threshold of {warningThreshold}%. Approved limit remains {approvedLimit} visitors.</p>}
        {site.status !== 'published' && <div className="capacity-limit-alert"><ShieldCheck size={18}/><span>This destination is not published. Follow the site’s approved closure procedure.</span></div>}
        <div className="capacity-live-grid">{[['Currently onsite', occupancy?.current_visitor_count], ['Arrivals today', occupancy?.arrivals_today], ['Departures today', occupancy?.departures_today], ['Physical estimate', occupancy?.capacity_estimate]].map(([label, value]) => <article key={String(label)}><small>{label}{label === 'Physical estimate' ? ' · informational' : ''}</small><b>{loading ? '—' : value ?? 'Not recorded'}</b></article>)}</div>
        <p className="field-hint">Physical estimate and approved visitor limit are separate. No per-zone occupancy is inferred from the site-wide count.</p>
        <p className="field-hint">Calculated {occupancy?.calculated_at ? new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(occupancy.calculated_at)) : 'not available'} · last attendance event {occupancy?.last_recorded_at ? new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(occupancy.last_recorded_at)) : 'none recorded'} · Asia/Manila</p>
      </div>
      <section className="capacity-map-zones"><div className="card-heading"><span><small>GIS SITE PLAN · NORTH UP</small><h3>Site boundaries and attendance</h3></span><MapPinned size={18}/></div><DestinationMap site={site} zones={zones} occupancy={occupancy}/><p className="field-hint">Approved GeoJSON boundaries are drawn over satellite imagery. Heat uses site-wide occupancy only; visitor positions and per-zone counts are not collected or inferred.</p>{!!zones.length && <div className="capacity-zone-records">{zones.map((zone) => <article key={zone.id}><span><b>{zone.name}</b><small>{zone.zone_type.replace('_', ' ')} · {zone.measured_area == null ? 'Area not measured' : `${zone.measured_area} ${zone.area_unit.replace('_', ' ')}`}</small></span><b>{zone.estimated_capacity == null ? 'No zone estimate' : `${zone.estimated_capacity} estimated visitors`}</b></article>)}</div>}</section>
    </>}
    {site && !gatekeeper && <CapacityPanel key={site.id} {...props} site={site} canSetApprovedLimit={props.role === 'tourism_office'}/>}
  </section>;
}

type CapacityAssessmentRow = { id: string; methodology: string; estimated_capacity: number | null; assessment_date: string; status: string };
type ZoneGeometry = { type: 'Polygon' | 'MultiPolygon' | 'LineString' | 'MultiLineString'; coordinates: any };
type CapacityZoneRow = { id: string; name: string; zone_type: string; measured_area: number | null; area_unit: string; estimated_capacity: number | null; plan_reference: string; geometry?: unknown };
type ApprovedLimitRow = { id: string; visitor_limit: number; effective_from: string; effective_to: string | null; status: string; approaching_threshold_percent: number | null };
const isPosition = (value: unknown): value is number[] => Array.isArray(value) && value.length >= 2
  && value.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))
  && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;
const geometryPaths = (geometry: ZoneGeometry): number[][][] => geometry.type === 'Polygon' ? geometry.coordinates
  : geometry.type === 'MultiPolygon' ? geometry.coordinates.flat()
    : geometry.type === 'LineString' ? [geometry.coordinates]
      : geometry.coordinates;
function parseZoneGeometry(value: string, zoneType: string): ZoneGeometry | null {
  if (!value.trim()) return null;
  if (value.length > 200000) throw new Error('GeoJSON geometry must be under 200 KB.');
  let geometry: unknown;
  try { geometry = JSON.parse(value); } catch { throw new Error('Enter valid GeoJSON geometry.'); }
  if (!geometry || typeof geometry !== 'object' || !('type' in geometry) || !('coordinates' in geometry)) throw new Error('Use GeoJSON Geometry with type and coordinates.');
  const candidate = geometry as { type: string; coordinates: unknown };
  const allowed = zoneType === 'access_path' ? ['LineString', 'MultiLineString'] : ['Polygon', 'MultiPolygon'];
  if (!allowed.includes(candidate.type) || !Array.isArray(candidate.coordinates)) throw new Error(zoneType === 'access_path' ? 'Access paths need LineString or MultiLineString GeoJSON.' : 'Visitor zones need Polygon or MultiPolygon GeoJSON.');
  const valueTyped = candidate as ZoneGeometry;
  const paths = geometryPaths(valueTyped);
  if (!paths.length || paths.some((path) => path.length < (zoneType === 'access_path' ? 2 : 4) || path.some((position) => !isPosition(position)))) throw new Error('Geometry needs valid longitude/latitude coordinates and complete paths.');
  if (zoneType !== 'access_path' && paths.some((ring) => ring[0][0] !== ring[ring.length - 1]?.[0] || ring[0][1] !== ring[ring.length - 1]?.[1])) throw new Error('Each polygon ring must end where it starts.');
  return valueTyped;
}

function CapacityPanel(props: Props & { site: Site; canSetApprovedLimit?: boolean }) {
  const [assessments, setAssessments] = useState<CapacityAssessmentRow[]>([]);
  const [zones, setZones] = useState<CapacityZoneRow[]>([]);
  const [limits, setLimits] = useState<ApprovedLimitRow[]>([]);
  const [assessment, setAssessment] = useState({ methodology: '', estimate: '', date: phToday(), assumptions: '', source: '' });
  const [zone, setZone] = useState({ name: '', type: 'usable', area: '', estimate: '', unit: 'square_meters', plan: '', assessmentId: '', geometry: '' });
  const [limit, setLimit] = useState({ value: '', date: phToday(), assessmentId: '', reference: '', threshold: '' });
  const [loading, finishLoading] = useSilentLoad(`${props.user?.id ?? 'staff'}:${props.role}:${props.site.id}`);
  const [saving, setSaving] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const [assessmentResult, zoneResult, limitResult] = await Promise.all([
        db().from('site_capacity_assessments').select('id,methodology,estimated_capacity,assessment_date,status').eq('site_id', props.site.id).order('assessment_date', { ascending: false }),
        db().from('site_capacity_zones').select('id,name,zone_type,measured_area,area_unit,estimated_capacity,plan_reference,geometry').eq('site_id', props.site.id).order('zone_type').order('name'),
        db().from('site_approved_visitor_limits').select('id,visitor_limit,effective_from,effective_to,status,approaching_threshold_percent').eq('site_id', props.site.id).order('effective_from', { ascending: false }),
      ]);
      if (assessmentResult.error) throw assessmentResult.error;
      if (zoneResult.error) throw zoneResult.error;
      if (limitResult.error) throw limitResult.error;
      setAssessments((assessmentResult.data ?? []) as CapacityAssessmentRow[]);
      setZones((zoneResult.data ?? []) as CapacityZoneRow[]);
      setLimits((limitResult.data ?? []) as ApprovedLimitRow[]);
    } catch (error) { props.notify(error instanceof Error ? error.message : 'Could not load capacity records.'); }
    finally { finishLoading(); }
  }, [finishLoading, props.notify, props.site.id]);
  useEffect(() => { void refresh(); }, [refresh]);
  const saveAssessment = async (event: FormEvent) => {
    event.preventDefault();
    if (assessment.methodology.trim().length < 2) { props.notify('Describe the assessment methodology.'); return; }
    setSaving(true);
    try {
      const { error } = await db().from('site_capacity_assessments').insert({
        site_id: props.site.id, methodology: assessment.methodology.trim(),
        estimated_capacity: assessment.estimate ? Number(assessment.estimate) : null,
        assessment_date: assessment.date, assumptions: assessment.assumptions.trim(), source_reference: assessment.source.trim(),
      });
      if (error) throw error;
      setAssessment({ methodology: '', estimate: '', date: phToday(), assumptions: '', source: '' });
      props.notify('Physical capacity assessment saved for review.'); await refresh();
    } catch (error) { props.notify(error instanceof Error ? error.message : 'Could not save the assessment.'); }
    finally { setSaving(false); }
  };
  const saveZone = async (event: FormEvent) => {
    event.preventDefault();
    if (!zone.name.trim()) { props.notify('Enter a zone name.'); return; }
    let geometry: ZoneGeometry | null;
    try { geometry = parseZoneGeometry(zone.geometry, zone.type); } catch (error) { props.notify(error instanceof Error ? error.message : 'Check the GeoJSON geometry.'); return; }
    setSaving(true);
    try {
      const { error } = await db().from('site_capacity_zones').insert({
        site_id: props.site.id, assessment_id: zone.assessmentId || null, name: zone.name.trim(), zone_type: zone.type,
        measured_area: zone.area ? Number(zone.area) : null, estimated_capacity: zone.estimate ? Number(zone.estimate) : null,
        area_unit: zone.unit, plan_reference: zone.plan.trim(), geometry,
      });
      if (error) throw error;
      setZone({ name: '', type: 'usable', area: '', estimate: '', unit: 'square_meters', plan: '', assessmentId: '', geometry: '' });
      props.notify('Capacity-map zone saved.'); await refresh();
    } catch (error) { props.notify(error instanceof Error ? error.message : 'Could not save the map zone.'); }
    finally { setSaving(false); }
  };
  const saveLimit = async (event: FormEvent) => {
    event.preventDefault();
    if (!limit.value || Number(limit.value) < 1) { props.notify('Enter an approved visitor limit greater than zero.'); return; }
    setSaving(true);
    try {
      const { error } = await db().from('site_approved_visitor_limits').insert({
        site_id: props.site.id, visitor_limit: Number(limit.value), effective_from: limit.date,
        supporting_assessment_id: limit.assessmentId || null, policy_reference: limit.reference.trim(),
        approaching_threshold_percent: limit.threshold ? Number(limit.threshold) : null,
      });
      if (error) throw error;
      setLimit({ value: '', date: phToday(), assessmentId: '', reference: '', threshold: '' });
      props.notify('Approved visitor limit recorded.'); await refresh();
    } catch (error) { props.notify(error instanceof Error ? error.message : 'Could not record the approved limit.'); }
    finally { setSaving(false); }
  };
  const markReviewed = async (assessmentId: string) => {
    try {
      const { error } = await db().from('site_capacity_assessments').update({ status: 'reviewed' }).eq('id', assessmentId);
      if (error) throw error;
      props.notify('Assessment marked reviewed. An approved visitor limit remains separate.'); await refresh();
    } catch (error) { props.notify(error instanceof Error ? error.message : 'Could not review this assessment.'); }
  };
  return <section className="capacity-panel"><div className="card-heading"><span><small>CAPACITY EVIDENCE</small><h3>Capacity assessments and site map</h3></span><Activity size={18}/></div>
    <p className="field-hint">Physical estimates, approved visitor limits, and daily booking capacity are separate. No visitor limit is created from an assessment automatically.</p>
    <div className="capacity-state"><span><b>{zones.length}</b> measured zone{zones.length === 1 ? '' : 's'} recorded</span><span><b>{limits.filter((row) => row.status === 'active').length}</b> active approved limit{limits.filter((row) => row.status === 'active').length === 1 ? '' : 's'}</span><span>Map geometry: {zones.some((row) => row.geometry) ? 'recorded' : 'not recorded'}</span></div>
    <div className="capacity-form-grid"><form onSubmit={(event) => void saveAssessment(event)}><h4>Physical capacity assessment</h4><label>Methodology<input value={assessment.methodology} onChange={(event) => setAssessment({ ...assessment, methodology: event.target.value })} placeholder="Measured usable area ÷ stated space per visitor" required maxLength={500}/></label><div className="form-two"><label>Estimated capacity<input type="number" min="1" value={assessment.estimate} onChange={(event) => setAssessment({ ...assessment, estimate: event.target.value })}/></label><label>Assessment date<input type="date" value={assessment.date} onChange={(event) => setAssessment({ ...assessment, date: event.target.value })} required/></label></div><label>Assumptions<textarea value={assessment.assumptions} onChange={(event) => setAssessment({ ...assessment, assumptions: event.target.value })} rows={2}/></label><label>Source or survey reference<input value={assessment.source} onChange={(event) => setAssessment({ ...assessment, source: event.target.value })} maxLength={500}/></label><button className="btn btn-outline" disabled={saving || loading}>Save for review</button></form>
      <form onSubmit={(event) => void saveZone(event)}><h4>Capacity-map zone</h4><label>Zone name<input value={zone.name} onChange={(event) => setZone({ ...zone, name: event.target.value })} required maxLength={120}/></label><div className="form-two"><label>Type<select value={zone.type} onChange={(event) => setZone({ ...zone, type: event.target.value, geometry: '' })}><option value="usable">Usable area</option><option value="restricted">Restricted area</option><option value="access_path">Access path</option></select></label><label>Assessment<select value={zone.assessmentId} onChange={(event) => setZone({ ...zone, assessmentId: event.target.value })}><option value="">No linked assessment</option>{assessments.map((row) => <option key={row.id} value={row.id}>{row.assessment_date} · {row.methodology}</option>)}</select></label></div><div className="form-two"><label>Measured area<input type="number" min="0" step="0.01" value={zone.area} onChange={(event) => setZone({ ...zone, area: event.target.value })}/></label><label>Estimated zone visitors<input type="number" min="1" step="1" value={zone.estimate} onChange={(event) => setZone({ ...zone, estimate: event.target.value })}/></label></div><label>Area unit<select value={zone.unit} onChange={(event) => setZone({ ...zone, unit: event.target.value })}><option value="square_meters">Square meters</option><option value="square_feet">Square feet</option><option value="other">Other</option></select></label><label>GeoJSON geometry<textarea value={zone.geometry} onChange={(event) => setZone({ ...zone, geometry: event.target.value })} maxLength={200000} placeholder={zone.type === 'access_path' ? '{"type":"LineString","coordinates":[[124.2,8.2],[124.201,8.201]]}' : '{"type":"Polygon","coordinates":[[[124.2,8.2],[124.201,8.2],[124.201,8.201],[124.2,8.2]]]}' } rows={3}/></label><small className="field-hint">Use verified longitude, latitude pairs from the approved site plan. {zone.type === 'access_path' ? 'Access paths require LineString geometry.' : 'Visitor areas require closed Polygon geometry.'}</small><label>Plan reference<input value={zone.plan} onChange={(event) => setZone({ ...zone, plan: event.target.value })} placeholder="Verified drawing, survey, or map reference" maxLength={500}/></label><button className="btn btn-outline" disabled={saving || loading}>Save zone</button></form>
      {props.canSetApprovedLimit && <form onSubmit={(event) => void saveLimit(event)}><h4>Approved visitor limit</h4><p className="field-hint">Use only after the responsible authority has approved an operational limit. Warning threshold is optional; leave blank to disable the approaching-limit warning.</p><label>Approved limit<input type="number" min="1" value={limit.value} onChange={(event) => setLimit({ ...limit, value: event.target.value })} required/></label><label>Approaching-limit warning (%)<input type="number" min="1" max="99" step="1" value={limit.threshold} onChange={(event) => setLimit({ ...limit, threshold: event.target.value })} placeholder="Optional, 1–99"/></label><label>Effective from<input type="date" value={limit.date} onChange={(event) => setLimit({ ...limit, date: event.target.value })} required/></label><label>Supporting assessment<select value={limit.assessmentId} onChange={(event) => setLimit({ ...limit, assessmentId: event.target.value })}><option value="">Policy or other approval</option>{assessments.map((row) => <option key={row.id} value={row.id}>{row.assessment_date} · {row.methodology}</option>)}</select></label><label>Approval reference<input value={limit.reference} onChange={(event) => setLimit({ ...limit, reference: event.target.value })} maxLength={500}/></label><button className="btn btn-primary" disabled={saving || loading}>Record approved limit</button></form>}
    </div>
    <div className="capacity-records">{loading && <div className="empty-inline">Loading capacity records…</div>}{!loading && !assessments.length && !zones.length && !limits.length && <div className="empty-inline">No physical-capacity or approved-limit records yet.</div>}
      {!!assessments.length && <article><h4>Assessments</h4>{assessments.map((row) => <div key={row.id}><span><b>{row.methodology}</b><small>{row.assessment_date} · {row.estimated_capacity ?? 'No'} estimated visitors · {row.status}</small></span>{row.status === 'draft' || row.status === 'needs_review' ? <button className="link-btn" onClick={() => void markReviewed(row.id)}>Mark reviewed</button> : null}</div>)}</article>}
      {!!zones.length && <article><h4>Zones</h4>{zones.map((row) => <div key={row.id}><span><b>{row.name}</b><small>{row.zone_type.replace('_', ' ')} · {row.measured_area == null ? 'Area not measured' : `${row.measured_area} ${row.area_unit.replace('_', ' ')}`} · {row.estimated_capacity == null ? 'No estimate' : `${row.estimated_capacity} estimated visitors`}</small></span><small>{row.plan_reference || 'No plan reference'}</small></div>)}</article>}
      {!!limits.length && <article><h4>Approved limits</h4>{limits.map((row) => <div key={row.id}><span><b>{row.visitor_limit} visitors</b><small>Effective {row.effective_from}{row.effective_to ? ` to ${row.effective_to}` : ''} · {row.approaching_threshold_percent == null ? 'No warning threshold' : `Warn at ${row.approaching_threshold_percent}%`}</small></span><span className="status-tag">{row.status}</span></div>)}</article>}</div>
  </section>;
}

function WalkInPage(props: Props) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotId, setSlotId] = useState('');
  const [form, setForm] = useState({ name: '', email: '', phone: '', adults: 1, children: 0, pwd: 0 });
  const [visitorRecords, setVisitorRecords] = useState(() => emptyVisitorInformation(1));
  const [ticketToken, setTicketToken] = useState('');
  const [reference, setReference] = useState('');
  const site = props.sites.find((item) => item.id === props.siteId);
  const [slotsLoading, finishSlotsLoading] = useSilentLoad(`${props.user?.id ?? 'staff'}:${props.siteId}`);
  const total = site ? site.adult_fee * form.adults + site.child_fee * form.children - site.adult_fee * site.pwd_discount_percent / 100 * form.pwd : 0;
  const maxWalkInVisitors = site?.slug === 'sikyop-agri-tourism-adventure' ? Math.min(19, site.max_per_booking) : site?.max_per_booking ?? 20;
  useEffect(() => {
    setVisitorRecords((current) => resizeVisitorInformation(current, form.adults + form.children));
  }, [form.adults, form.children]);
  useEffect(() => {
    if (!props.siteId) { setSlots([]); setSlotId(''); finishSlotsLoading(); return; }
    let active = true;
    void loadSlots(props.siteId, phToday(), phToday()).then((rows) => {
      if (!active) return;
      const available = currentSlots(rows);
      setSlots(available);
      setSlotId((current) => available.some((slot) => slot.slot_id === current) ? current : '');
    }).catch((error) => props.notify(error instanceof Error ? error.message : 'Could not load today’s slots.'))
      .finally(() => { if (active) finishSlotsLoading(); });
    return () => { active = false; };
  }, [finishSlotsLoading, props.siteId, props.notify]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!site || !slotId) { props.notify('Choose a current slot.'); return; }
    if (!visitorInformationComplete(visitorRecords, site.slug)) { props.notify('Complete visitor information for everyone in the walk-in group.'); return; }
    const contactError = bookingContactError(form.name, form.email, form.phone);
    if (contactError) { props.notify(contactError); return; }
    props.setBusy(true);
    try {
      const { data, error } = await db().rpc('register_walk_in_with_visitors', {
        p_site_id: site.id,
        p_slot_id: slotId,
        p_name: form.name.trim(),
        p_adult_count: form.adults,
        p_child_count: form.children,
        p_pwd_count: form.pwd,
        p_email: form.email.trim() || null,
        p_phone: form.phone.trim() || null,
        p_visitors: visitorInformationPayload(visitorRecords, site.slug),
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as { booking_id: string; booking_reference: string; guest_access_token: string };
      if (form.email.trim()) void invokeFunction('send-booking-email', {
        booking_reference: row.booking_reference,
        guest_access_token: row.guest_access_token || null,
        event: 'confirmed',
      }).catch(() => props.notify('Walk-in recorded, but the confirmation email could not be sent.'));
      const result = await invokeFunction<{ token: string }>('ticket', {
        booking_reference: row.booking_reference,
        guest_access_token: row.guest_access_token || null,
      });
      setReference(row.booking_reference);
      setTicketToken(result.token);
      props.notify('Walk-in recorded.');
      setForm({ name: '', email: '', phone: '', adults: 1, children: 0, pwd: 0 });
      const refreshed = await loadSlots(site.id, phToday(), phToday());
      setSlots(currentSlots(refreshed));
  } catch (error) { props.notify(error instanceof Error ? error.message : 'Could not register this walk-in.'); }
    finally { props.setBusy(false); }
  };
  const slotOptions = slotsLoading ? [] : slots;
  return <section className="dashboard-page section-wrap"><div className="dash-header"><div><span className="eyebrow"><span className="eyebrow-line"/> GATEKEEPER · WALK-IN ENTRY</span><h1>Welcome them <em>in.</em></h1><p>Record a walk-in for {site?.name ?? 'your assigned destination'}.</p></div></div>
    {!site && <div className="empty-card"><ShieldCheck size={30}/><h3>No site assignment</h3><p>Ask the Tourism Office to assign your gatekeeper account.</p></div>}
    {site && <div className="walkin-layout"><form className="form-card" onSubmit={(event) => void submit(event)}><div className="card-heading"><span><small>TODAY · ASIA/MANILA</small><h3>Visitor details</h3></span><Users size={18}/></div>
      <label>Visit slot<select value={slotId} onChange={(event) => setSlotId(event.target.value)} required><option value="">Choose a current slot</option>{slotOptions.map((slot) => <option value={slot.slot_id} key={slot.slot_id}>{timeLabel(slot.starts_at)} – {timeLabel(slot.ends_at)}</option>)}</select></label>
      <p className="field-hint">Daily limit: {site.daily_capacity ?? 'not set'} visitors total, shared across all times.</p>
      {slotsLoading ? <p className="field-hint" role="status">Checking today’s visit slots…</p> : !slotOptions.length && <p className="field-hint">No available slots are listed for today.</p>}
      <label>Booking contact name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required maxLength={120}/></label>
      <div className="form-two"><label>Email<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} maxLength={254}/></label><label>Phone<input type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} maxLength={40}/></label></div>
      <div className="form-two"><label>Adults<input type="number" min="1" max={maxWalkInVisitors} value={form.adults} onChange={(event) => { const adults = Math.max(1, Math.min(maxWalkInVisitors, Number(event.target.value))); const children = Math.min(form.children, maxWalkInVisitors - adults); setForm({ ...form, adults, children, pwd: Math.min(form.pwd, adults + children) }); }} required/></label><label>Children<input type="number" min="0" max={maxWalkInVisitors - form.adults} value={form.children} onChange={(event) => { const children = Math.max(0, Math.min(maxWalkInVisitors - form.adults, Number(event.target.value))); setForm({ ...form, children, pwd: Math.min(form.pwd, form.adults + children) }); }} required/></label></div>
      {site && <VisitorInformationForm siteSlug={site.slug} adults={form.adults} children={form.children} visitors={visitorRecords}
        onChange={(index, field, value) => setVisitorRecords((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item))}/>}
      {site.pwd_discount_percent > 0 && <label>PWD visitors<input type="number" min="0" max={form.adults + form.children} value={form.pwd} onChange={(event) => setForm({ ...form, pwd: Math.max(0, Math.min(form.adults + form.children, Number(event.target.value))) })} required/><small>{site.pwd_discount_percent}% discount per PWD visitor. Verify eligibility at the gate.</small></label>}
      <div className="booking-total"><span>Estimated fees<small>{form.adults} adults · {form.children} children · {form.pwd} PWD · not collected</small></span><b>{money(total)}</b></div>
      <button className="btn btn-primary btn-wide" disabled={props.busy || !slotOptions.length || !site || !visitorInformationComplete(visitorRecords, site.slug)}>{props.busy ? 'Saving…' : 'Record walk-in'} <Check size={16}/></button>
      <p className="secure-note"><ShieldCheck size={14}/> Database checks site assignment, slot time, and shared daily capacity. No payment is recorded.</p>
    </form><article className="qr-preview"><span className="eyebrow"><span className="eyebrow-line"/> WALK-IN TICKET</span>
      {ticketToken ? <><h3>{reference}</h3><div className="ticket-qr"><QRCodeSVG value={ticketToken} size={190} level="H" includeMargin/><small>Present this QR code at the entry point for validation.</small></div>
        <button className="link-btn" onClick={() => { void navigator.clipboard.writeText(reference); props.notify('Booking reference copied.'); }}>Copy booking reference</button></>
        : <div className="empty-card compact-empty"><TicketIcon size={28}/><h3>Ticket appears after registration</h3><p>Only a walk-in successfully recorded by the database receives a ticket.</p></div>}
    </article></div>}
  </section>;
}
