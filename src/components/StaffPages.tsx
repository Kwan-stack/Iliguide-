import { Fragment, useCallback, useContext, useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Activity, ArrowDownToLine, ArrowLeft, ArrowRight, BadgeCheck, BookOpen, Building2, CalendarClock, CalendarDays, Camera, ChartNoAxesCombined, Check, ChevronLeft, ChevronRight, Clock3, CreditCard, FileText, History, Image as ImageIcon, ImagePlus, KeyRound, LayoutDashboard, MapPin, MapPinned, Megaphone, MessageSquareText, Pencil, Plus, Printer, RefreshCw, ScanLine, ShieldCheck, Ticket as TicketIcon, Users, UserRound, X, type LucideIcon } from 'lucide-react';
import type { User } from '@supabase/supabase-js';
import { calculateBookingTotal, db, dateLabel, exportCsv, invokeFunction, loadMyActiveGatekeeperDuty, loadSlots, money, monthDateRange, timeLabel, timestampTimeLabel, type GatekeeperDuty, type Profile, type Site, type Slot, type StaffAssignment } from '../lib/iliguide';
import { emptyVisitorInformation, requiredVisitorFields, resizeVisitorInformation, visitorInformationComplete, visitorInformationPayload } from '../lib/visitorInformation';
import { bookingContactError } from '../lib/bookingValidation';
import { applyOperatingHoursTemplate } from '../lib/operatingHours';
import { paymentStatusLabel } from '../lib/paymentStatus';
import { useSilentLoad } from '../lib/useSilentLoad';
import { VisitorInformationForm } from './VisitorInformationForm';
import { ChangePasswordForm } from './ChangePasswordForm';
import { OfficeMobileNavigation } from './StaffWorkspaceShell';
import { TimePicker } from './TimePicker';
import DestinationMap from './DestinationMap';
import DestinationLocator from './DestinationLocator';
import type { GatekeeperPage } from '../lib/gatekeeperRoutes';
import './DutyRoster.css';
import './CancellationReview.css';
import type { ManualPaymentSettings } from './VisitorBookingFlow';
import { DutyDetailsPage, DutyRosterPage } from './DutyRosterCalendar';
import { capacityStatus, formatCapacityPercent } from '../lib/capacity';
import { useLiveCapacity } from '../lib/useLiveCapacity';
import { FeedbackManagementPage } from './ReviewPages';
import { DestinationAnnouncementsPage } from './DestinationAnnouncements';

type Role = Profile['role'];
type Page = GatekeeperPage | 'Activity' | 'Slots and closures' | 'Schedule & Operations' | 'Staff and accounts' | 'Sites and staff' | 'Duty roster' | 'Payment verification' | 'Payment settings' | 'Feedback & Reviews' | 'Destination updates';
const attendanceVisitorCount = (row: Record<string, any>) => {
  const booking = Array.isArray(row.booking) ? row.booking[0] : row.booking;
  const registrationOnlyWalkIn = booking?.booking_source === 'walk_in'
    && row.scanned_at === booking.created_at && Object.keys(row.device_information ?? {}).length === 0;
  return registrationOnlyWalkIn ? 0 : Number(booking?.visitor_count ?? 0);
};
type Props = {
  page: Page; role: Role; sites: Site[]; siteId: string; setSiteId: (value: string) => void;
  assignments: StaffAssignment[]; notify: (message: string) => void; busy: boolean;
  setBusy: (value: boolean) => void; refresh: () => void; go: (page: Page, tab?: 'duty' | 'hours' | 'capacity') => void;
  user: User | null;
};
const phToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const phTime = () => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
const currentSlots = (rows: Slot[]) => {
  const now = phTime();
  return rows.filter((slot) => slot.slot_date === phToday() && slot.status === 'open' && slot.remaining_capacity > 0 && slot.starts_at.slice(0, 5) <= now && slot.ends_at.slice(0, 5) > now);
};

export function StaffPages(props: Props) {
  const staffScopeKey = `${props.user?.id ?? 'staff'}:${props.role}:${props.siteId}`;
  if (props.page === 'Change password') return <StaffConsole {...props}><ChangePasswordPage {...props}/></StaffConsole>;
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
    if (props.page === 'Payment verification') content = <ManualPaymentVerificationPage {...props}/>;
    return <StaffConsole {...props}><GatekeeperDutyGate {...props} content={<Fragment key={staffScopeKey}>{content}</Fragment>}/></StaffConsole>;
  }
  let content: ReactNode = <OverviewPage {...props}/>;
  if (props.page === 'Scan and exit' || props.page === 'Walk-in registration') content = <AccessNotice/>;
  else if (props.page === 'Slots and closures') content = props.role === 'site_admin' || props.role === 'tourism_office' ? <SchedulePage {...props}/> : <AccessNotice/>;
  else if (props.page === 'Schedule & Operations') content = props.role === 'tourism_office' || props.role === 'site_admin' ? <ScheduleOperationsPage {...props}/> : <AccessNotice/>;
  else if (props.page === 'Staff and accounts') content = props.role === 'site_admin' || props.role === 'tourism_office' ? <PeoplePage {...props}/> : <AccessNotice/>;
  else if (props.page === 'Reports') content = props.role === 'site_admin' || props.role === 'tourism_office' ? <ReportsPage {...props}/> : <AccessNotice/>;
  else if (props.page === 'Sites and staff') content = props.role === 'tourism_office' || props.role === 'site_admin' ? <SitesPage {...props}/> : <AccessNotice/>;
  else if (props.page === 'Duty roster') content = props.role === 'site_admin' || props.role === 'tourism_office' ? <DutyRosterPage {...props}/> : <AccessNotice/>;
  else if (props.page === 'Payment verification') content = props.role === 'site_admin' ? <ManualPaymentVerificationPage {...props}/> : <AccessNotice/>;
  else if (props.page === 'Payment settings') content = props.role === 'tourism_office' || props.role === 'site_admin' ? <PaymentSettingsPage {...props}/> : <AccessNotice/>;
  else if (props.page === 'Feedback & Reviews') content = props.role === 'tourism_office' || props.role === 'site_admin' ? <FeedbackManagementPage role={props.role} sites={props.sites} notify={props.notify}/> : <AccessNotice/>;
  else if (props.page === 'Destination updates') content = props.role === 'tourism_office' || props.role === 'site_admin' ? <DestinationAnnouncementsPage role={props.role} sites={props.sites} user={props.user} notify={props.notify}/> : <AccessNotice/>;
  else if (props.page === 'Capacity map') content = <CapacityMapPage {...props}/>;
  else if (props.page === 'Visitor Logbook') content = props.role === 'site_admin' || props.role === 'tourism_office' ? <VisitorLogbookPage {...props}/> : <AccessNotice/>;
  else if (props.page === 'Activity') content = props.role === 'tourism_office' || props.role === 'site_admin' ? <ActivityPage {...props}/> : <AccessNotice/>;
  return <StaffConsole {...props}><Fragment key={staffScopeKey}>{content}</Fragment></StaffConsole>;
}

function StaffConsole(props: Props & { children: ReactNode }) {
  const mobileNavigation = useContext(OfficeMobileNavigation);
  const items: Array<[string, Page, LucideIcon]> = props.role === 'gatekeeper'
    ? [['Dashboard', 'Overview', LayoutDashboard], ['Reservations', 'Reservations', CalendarDays], ['Visitors', 'Visitor Management', Users], ['Check-in', 'Scan and exit', ScanLine], ['Walk-ins', 'Walk-in registration', TicketIcon], ['Payment verification', 'Payment verification', BadgeCheck], ['Daily logbook', 'Visitor Logbook', BookOpen], ['Capacity map', 'Capacity map', MapPinned], ['Reports', 'Reports', ChartNoAxesCombined], ['Today’s duty', 'Duty details', CalendarClock]]
    : props.role === 'tourism_office' || props.role === 'site_admin'
      ? [['Overview', 'Overview', LayoutDashboard], ['Schedule & Operations', 'Schedule & Operations', CalendarClock], ['Destinations & staff', 'Sites and staff', Building2], ['Staff & accounts', 'Staff and accounts', Users], ['Destination updates', 'Destination updates', Megaphone], ...(props.role === 'site_admin' ? [['Payment verification', 'Payment verification', BadgeCheck] as [string, Page, LucideIcon]] : []), ['Payment settings', 'Payment settings', CreditCard], ['Feedback & Reviews', 'Feedback & Reviews', MessageSquareText], ['Visitor logbook', 'Visitor Logbook', BookOpen], ['Capacity map', 'Capacity map', MapPinned], ['Reports', 'Reports', ChartNoAxesCombined], ['Activity', 'Activity', History]]
      : [];
  items.push(['Account & security', 'Change password', KeyRound]);
  const roleName = props.role === 'tourism_office' ? 'Tourism Office' : props.role === 'site_admin' ? 'Site administrator' : 'Site gatekeeper';
  const userName = String(props.user?.user_metadata?.full_name ?? props.user?.email ?? 'Staff account');
  return <div className={'staff-console staff-console-' + props.role}>
    <aside className="staff-sidebar"><div className="staff-sidebar-label"><span className="eyebrow"><span className="eyebrow-line"/> {roleName.toUpperCase()}</span><p>Operations workspace</p></div>
      <nav className="staff-sidebar-nav" aria-label={`${roleName} navigation`}>{items.map(([label, target, Icon]) => <button key={target} className={props.page === target ? 'active' : ''} aria-current={props.page === target ? 'page' : undefined} onClick={() => props.go(target)}><Icon size={17}/><span>{label}</span></button>)}</nav>
      <div className="staff-sidebar-account"><span className="staff-account-icon"><UserRound size={17}/></span><span><b>{userName}</b><small>{props.user?.email ?? roleName}</small></span></div>
    </aside>
    <div className="staff-console-main"><nav className={mobileNavigation.open ? 'staff-mobile-nav open' : 'staff-mobile-nav'} aria-label={`${roleName} navigation`}>{items.map(([label, target, Icon]) => <button key={target} className={props.page === target ? 'active' : ''} aria-current={props.page === target ? 'page' : undefined} onClick={() => { mobileNavigation.setOpen(false); props.go(target); }}><Icon size={15}/>{label}</button>)}</nav>{props.children}</div>
  </div>;
}

function ChangePasswordPage(props: Props) {
  const [account, setAccount] = useState<{ full_name: string; email: string | null; role: Role; account_status: string } | null>(null);
  useEffect(() => {
    if (!props.user) { setAccount(null); return; }
    let active = true;
    void db().from('profiles').select('full_name,email,role,account_status').eq('id', props.user.id).maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) props.notify(error.message);
        else setAccount(data as typeof account);
      });
    return () => { active = false; };
  }, [props.user?.id, props.notify]);
  const roleLabel = props.role === 'tourism_office' ? 'Tourism Office' : props.role === 'site_admin' ? 'Site administrator' : 'Gatekeeper';
  return <section className="dashboard-page section-wrap"><div className="dash-header"><div><span className="eyebrow"><span className="eyebrow-line"/> ACCOUNT</span><h1>Account & <em>security.</em></h1><p>Review your account details and change the password used to sign in.</p></div>
      <button className="btn btn-outline" onClick={() => props.go('Overview')}>Back to workspace</button></div>
    <div className="schedule-card"><div className="schedule-head"><span><small>ACCOUNT INFORMATION</small><h3>Your account</h3></span><UserRound size={18}/></div>
      <div className="staff-account-details"><div><small>Full name</small><b>{account?.full_name || props.user?.user_metadata?.full_name || 'Name not available'}</b></div><div><small>Email</small><b>{props.user?.email || account?.email || 'Email not available'}</b></div><div><small>Account role</small><b>{roleLabel}</b></div><div><small>Status</small><b>{account?.account_status ?? 'Loading…'}</b></div></div>
    </div>
    <div className="schedule-card"><div className="schedule-head"><span><small>SECURE YOUR ACCOUNT</small><h3>Password and security</h3></span><KeyRound size={18}/></div>
      {props.user ? <ChangePasswordForm user={props.user} notify={props.notify}/> : <div className="empty-inline" role="alert">Sign in to change your password.</div>}
    </div>
  </section>;
}

function GatekeeperDutyGate(props: Props & { content: ReactNode }) {
  const site = assignedGatekeeperSite(props);
  const [duty, setDuty] = useState<GatekeeperDuty | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'scheduled' | 'completed' | 'locked' | 'unavailable'>('loading');
  useEffect(() => {
    let active = true;
    if (!site) { setState('locked'); return () => { active = false; }; }
    setState('loading');
    const refresh = () => void loadMyActiveGatekeeperDuty(site.id).then((row) => {
      if (!active) return;
      setDuty(row);
      setState(!row ? 'locked' : ['on_duty', 'active'].includes(row.effective_status) ? 'ready'
        : row.effective_status === 'scheduled_today' ? 'scheduled' : 'completed');
    }).catch(() => { if (active) setState('unavailable'); });
    refresh();
    const interval = window.setInterval(refresh, 60000);
    return () => { active = false; window.clearInterval(interval); };
  }, [site?.id]);
  const dutyLabel = state === 'ready' ? 'On Duty' : state === 'scheduled' ? 'Scheduled Today' : 'Duty completed';
  const context = duty && <section className="duty-context"><ShieldCheck size={17}/><span><b>{site?.name}</b><small>{props.user?.email}</small> · {duty.duty_role === 'primary' ? 'Primary Gatekeeper' : 'Support Gatekeeper'} · {new Intl.DateTimeFormat('en-PH', { timeZone: site?.timezone || 'Asia/Manila', dateStyle: 'medium' }).format(new Date(duty.duty_date + 'T00:00:00+08:00'))} · {timestampTimeLabel(duty.shift_start_at, site?.timezone)}–{timestampTimeLabel(duty.shift_end_at, site?.timezone)}</span><b className={'duty-on-status' + (state === 'ready' ? '' : ' duty-scheduled-status')}>{dutyLabel}</b></section>;
  return <>
    {state === 'loading' && <section className="dashboard-page section-wrap"><div className="empty-card"><ShieldCheck size={30}/><h3>Checking gatekeeper duty</h3><p>Loading the active duty roster for this destination.</p></div></section>}
    {state === 'unavailable' && <section className="dashboard-page section-wrap"><div className="empty-card"><ShieldCheck size={30}/><h3>Duty roster setup is unavailable</h3><p>Apply the latest database migration, then create an active duty roster entry.</p></div></section>}
    {state === 'locked' && <>{props.page === 'Duty details' ? props.content : <section className="dashboard-page"><div className="empty-card"><ShieldCheck size={30}/><h3>Gatekeeper duty required</h3><p>Your account is active, but you are not assigned as gatekeeper for this destination and shift. Contact your supervisor.</p><button className="btn btn-outline" onClick={() => props.go('Duty details')}>View assigned duty</button></div></section>}</>}
    {state === 'ready' && <>{context}{props.content}</>}
    {state === 'scheduled' && <>{context}{props.page === 'Duty details' ? props.content : <DutyAccessNotice title="Scheduled Today" text="Operational access starts at the assigned opening time. Duty assignment does not record physical presence." onView={() => props.go('Duty details')}/>}</>}
    {state === 'completed' && <>{context}{props.page === 'Duty details' ? props.content : <DutyAccessNotice title="Duty window ended" text="This scheduled shift has ended. Attendance is recorded only through the check-in process." onView={() => props.go('Duty details')}/>}</>}
  </>;
}

function DutyAccessNotice({ title, text, onView }: { title: string; text: string; onView: () => void }) {
  return <section className="dashboard-page"><div className="empty-card"><ShieldCheck size={30}/><h3>{title}</h3><p>{text}</p><button className="btn btn-outline" onClick={onView}>View assigned duty</button></div></section>;
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
  const [attendanceRows, setAttendanceRows] = useState<Array<{ site_id: string; scanned_at: string; visitor_count: number }>>([]);
  const [monthDate, setMonthDate] = useState(() => phToday().slice(0, 7));
  const [selectedYear, setSelectedYear] = useState(() => Number(phToday().slice(0, 4)));
  const [availableYears, setAvailableYears] = useState<number[]>([Number(phToday().slice(0, 4))]);
  const [yearlyBookingRows, setYearlyBookingRows] = useState<Array<{ site_id: string; report_date: string; visitor_count: number }>>([]);
  const [visibleSites, setVisibleSites] = useState<string[]>([]);
  const [networkSiteId, setNetworkSiteId] = useState('all');
  const [todayMetrics, setTodayMetrics] = useState<Record<string, any> | null>(null);
  const [totalReservations, setTotalReservations] = useState(0);
  const [upcoming, setUpcoming] = useState<Array<Record<string, any>>>([]);
  const [gatekeeperAttendance, setGatekeeperAttendance] = useState<Array<{ scanned_at: string; visitor_count: number }>>([]);
  const requestVersion = useRef(0);
  const monthStart = `${monthDate}-01`;
  const monthEnd = new Date(Number(monthDate.slice(0, 4)), Number(monthDate.slice(5, 7)), 0).getDate();
  const isGatekeeper = props.role === 'gatekeeper';
  const site = isGatekeeper ? assignedGatekeeperSite(props) : props.sites.find((item) => item.id === props.siteId);
  const capacityFeed = useLiveCapacity(isGatekeeper && site ? [site.id] : []);
  const liveOccupancy = site && capacityFeed.state === 'ready' ? capacityFeed.rows[site.id] ?? null : null;
  const todayBookingCount = Number(todayMetrics?.booking_count ?? 0);
  const dashboardSites = props.role === 'tourism_office' ? props.sites.filter((item) => networkSiteId === 'all' || item.id === networkSiteId) : site ? [site] : [];
  const siteScope = props.role === 'tourism_office' ? props.sites.map((item) => item.id).join(',') : site?.id ?? props.siteId;
  const [loading, finishLoading] = useSilentLoad(`${props.user?.id ?? 'staff'}:${props.role}:${siteScope}:${networkSiteId}:${networkSiteId === 'all' ? selectedYear : monthStart}`);
  const refresh = useCallback(async () => {
    const request = ++requestVersion.current;
    try {
      if (isGatekeeper) {
        if (!site) throw new Error('No single active destination assignment. Ask the Tourism Office to resolve the assignment.');
        const today = phToday();
        const horizon = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + 7 * 86400000));
        const monthStartAt = new Date(`${monthStart}T00:00:00+08:00`).toISOString();
        const monthEndAt = new Date(Date.parse(`${monthDate}-${String(monthEnd).padStart(2, '0')}T00:00:00+08:00`) + 86400000).toISOString();
        const [daily, total, reservations, attendance] = await Promise.all([
          db().from('site_visit_daily_metrics').select('*').eq('site_id', site.id).eq('report_date', today).maybeSingle(),
          db().from('bookings').select('id', { count: 'exact', head: true }).eq('site_id', site.id).neq('booking_status', 'expired'),
          db().from('bookings').select('id,booking_reference,visitor_name,visitor_count,booking_status,site_slots!inner(slot_date,starts_at)')
            .eq('site_id', site.id).gte('site_slots.slot_date', today).lte('site_slots.slot_date', horizon)
            .in('booking_status', ['confirmed', 'awaiting_payment']).order('created_at').limit(12),
          db().from('attendance_logs').select('scanned_at,device_information,booking:bookings!attendance_logs_booking_id_fkey(visitor_count,booking_source,created_at)')
            .eq('site_id', site.id).eq('action', 'entry')
            .gte('scanned_at', monthStartAt).lt('scanned_at', monthEndAt).order('scanned_at').limit(2000),
        ]);
        for (const result of [daily, total, reservations, attendance]) if (result.error) throw result.error;
        if (request !== requestVersion.current) return;
        setTodayMetrics(daily.data ?? null);
        setTotalReservations(total.count ?? 0);
        setUpcoming((reservations.data ?? []) as Array<Record<string, any>>);
        setGatekeeperAttendance((attendance.data ?? []).map((row: any) => ({ scanned_at: row.scanned_at, visitor_count: attendanceVisitorCount(row) })));
      } else {
        let query = db().from('booking_daily_metrics')
          .select('site_id, report_date, booking_count, visitor_count, walk_in_count, online_count, paid_revenue')
          .gte('report_date', monthStart).lte('report_date', monthDate === phToday().slice(0, 7) ? phToday() : `${monthDate}-${String(monthEnd).padStart(2, '0')}`);
        if (props.siteId && props.role !== 'tourism_office') query = query.eq('site_id', props.siteId);
        const attendanceQuery = db().from('attendance_logs').select('site_id,scanned_at,device_information,booking:bookings!attendance_logs_booking_id_fkey(visitor_count,booking_source,created_at)')
          .eq('action', 'entry')
          .gte('scanned_at', new Date(`${monthStart}T00:00:00+08:00`).toISOString())
          .lt('scanned_at', new Date(Date.parse(`${monthDate}-${String(monthEnd).padStart(2, '0')}T00:00:00+08:00`) + 86400000).toISOString());
        if (props.siteId && props.role !== 'tourism_office') attendanceQuery.eq('site_id', props.siteId);
        if (props.role === 'tourism_office' && networkSiteId !== 'all') {
          query = query.eq('site_id', networkSiteId);
          attendanceQuery.eq('site_id', networkSiteId);
        }
        const metrics = await query.order('report_date', { ascending: true });
        if (metrics.error) throw metrics.error;
        let yearlyRows: Array<{ site_id: string; report_date: string; expected_visitor_count: number }> = [];
        let years: number[] = [];
        if (props.role === 'tourism_office' && networkSiteId === 'all' && props.sites.length) {
          const siteIds = props.sites.map((item) => item.id);
          for (let offset = 0; ; offset += 1000) {
            const page = await db().from('site_visit_daily_metrics').select('site_id,report_date,expected_visitor_count')
              .in('site_id', siteIds).gte('report_date', `${selectedYear}-01-01`).lt('report_date', `${selectedYear + 1}-01-01`)
              .order('report_date').range(offset, offset + 999);
            if (page.error) throw page.error;
            yearlyRows.push(...(page.data ?? []) as typeof yearlyRows);
            if ((page.data?.length ?? 0) < 1000) break;
          }
          const seenYears = new Set<number>();
          for (let offset = 0; ; offset += 1000) {
            const page = await db().from('site_visit_daily_metrics').select('report_date')
              .in('site_id', siteIds).gt('expected_visitor_count', 0).order('report_date').range(offset, offset + 999);
            if (page.error) throw page.error;
            for (const row of page.data ?? []) seenYears.add(Number(String(row.report_date).slice(0, 4)));
            if ((page.data?.length ?? 0) < 1000) break;
          }
          years = [...seenYears].sort((a, b) => b - a);
        }
        const attendanceRows: Array<Record<string, any>> = [];
        for (let offset = 0; ; offset += 1000) {
          const page = await attendanceQuery.order('scanned_at').range(offset, offset + 999);
          if (page.error) throw page.error;
          attendanceRows.push(...(page.data ?? []) as typeof attendanceRows);
          if ((page.data?.length ?? 0) < 1000) break;
        }
        if (request !== requestVersion.current) return;
        setRows((metrics.data ?? []) as Array<Record<string, any>>);
        setYearlyBookingRows(yearlyRows.map((row) => ({ site_id: row.site_id, report_date: row.report_date, visitor_count: Number(row.expected_visitor_count ?? 0) })));
        if (years.length) setAvailableYears(years);
        setAttendanceRows(attendanceRows.map((row) => ({ site_id: row.site_id, scanned_at: row.scanned_at, visitor_count: attendanceVisitorCount(row) })));
      }
    } catch (error) {
      if (request === requestVersion.current) props.notify(error instanceof Error ? error.message : 'Could not load workspace metrics.');
    } finally { if (request === requestVersion.current) finishLoading(); }
  }, [finishLoading, isGatekeeper, monthDate, monthEnd, monthStart, networkSiteId, props.notify, props.role, props.siteId, props.sites, selectedYear, site?.id, siteScope]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { setVisibleSites(dashboardSites.map((item) => item.id)); }, [dashboardSites.map((item) => item.id).join(',')]);
  const metric = (key: string) => rows.reduce((sum, row) => sum + Number(row[key] ?? 0), 0);
  const gatekeeperDailyCounts = Array.from({ length: monthEnd }, (_, index) => gatekeeperAttendance.filter((row) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date(row.scanned_at)) === `${monthDate}-${String(index + 1).padStart(2, '0')}`).reduce((sum, row) => sum + row.visitor_count, 0));
  const gatekeeperDailyMax = Math.max(1, ...gatekeeperDailyCounts);
  const monthlyVisitors = attendanceRows.reduce((sum, row) => sum + row.visitor_count, 0);
  const reportMonthDate = rows.filter((row) => String(row.report_date).startsWith(monthDate));
  const weeklyBookings = Array.from({ length: Math.ceil(monthEnd / 7) }, (_, index) => ({ week: index + 1, count: reportMonthDate.filter((row) => Math.floor((Number(String(row.report_date).slice(8)) - 1) / 7) === index).reduce((sum, row) => sum + Number(row.booking_count ?? 0), 0) }));
  const monthlyBookingSeries = dashboardSites.map((destination) => ({
    site: destination,
    counts: Array.from({ length: 12 }, (_, month) => yearlyBookingRows.filter((row) => row.site_id === destination.id && Number(row.report_date.slice(5, 7)) === month + 1).reduce((sum, row) => sum + row.visitor_count, 0)),
  }));
  const monthlyBookingMax = Math.max(0, ...monthlyBookingSeries.flatMap((series) => series.counts));
  const monthlyBookingAxisMax = monthlyBookingMax || 1;
  const monthlyBookingTicks = monthlyBookingMax === 0 ? [0] : [...new Set(Array.from({ length: 5 }, (_, index) => Math.round(monthlyBookingMax * index / 4)))];
  const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return <section className={'dashboard-page section-wrap' + (isGatekeeper ? ' gatekeeper-overview' : '')}>
    <div className="dash-header"><div><span className="eyebrow"><span className="eyebrow-line"/> {props.role.replace('_', ' ').toUpperCase()}</span>
      <h1>{isGatekeeper ? <>{site?.name ?? 'Gatekeeper'} <em>Dashboard</em></> : props.role === 'tourism_office' ? <>Tourism <em>network.</em></> : <>Site <em>overview.</em></>}
      </h1><p>{isGatekeeper ? 'Destination operations · ' + phToday()
        : 'Live records for ' + (props.role === 'tourism_office' ? (dashboardSites.length === props.sites.length ? 'all accessible destinations.' : dashboardSites[0]?.name ?? 'the selected destination.') : site?.name ?? 'your assigned destination.')}</p></div>
      <div className="header-actions">{!isGatekeeper && (props.role === 'tourism_office' ? <select aria-label="Destination filter" value={networkSiteId} onChange={(event) => setNetworkSiteId(event.target.value)}><option value="all">All</option>{props.sites.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : <SiteSelector {...props}/>)}{props.role === 'tourism_office' && networkSiteId === 'all' ? <label className="dashboard-month-filter">Year<select aria-label="Report year" value={selectedYear} onChange={(event) => setSelectedYear(Number(event.target.value))}>{[...new Set([selectedYear, ...availableYears])].sort((a, b) => b - a).map((year) => <option key={year} value={year}>{year}</option>)}</select></label> : <label className="dashboard-month-filter">Month<input type="month" value={monthDate} onChange={(event) => event.target.value && setMonthDate(event.target.value)}/></label>}<button className="btn btn-outline" onClick={() => void refresh()}><RefreshCw size={15}/> Refresh</button></div></div>
    {isGatekeeper ? <>
      <div className="stats-grid gatekeeper-primary-stats">{([
        { value: liveOccupancy?.current_visitor_count ?? '—', label: 'Currently inside', Icon: Users },
        { value: liveOccupancy?.expected_visitor_count ?? 0, label: 'Expected visitors today', Icon: CalendarDays },
        { value: liveOccupancy?.arrivals_today ?? '—', label: 'Arrivals today', Icon: ArrowRight },
        { value: liveOccupancy?.departures_today ?? '—', label: 'Departures today', Icon: ArrowLeft },
      ] as { value: string | number; label: string; Icon: LucideIcon }[]).map(({ value, label, Icon }) => <div key={label}><Icon size={19}/><small>{label}</small><b>{loading ? '…' : value}</b>{label === 'Expected visitors today' && todayMetrics && <span className="gatekeeper-stat-context">{todayBookingCount} reservation{todayBookingCount === 1 ? '' : 's'} scheduled today</span>}</div>)}</div>
      {(() => {
        const crowd = capacityStatus(liveOccupancy);
        const current = liveOccupancy?.current_visitor_count;
        const limit = crowd.limit;
        const percent = crowd.percent;
        const warning = crowd.level === 'near' ? 'Visitor occupancy is increasing. Monitor incoming visitors.'
          : crowd.level === 'almost' ? 'The destination is approaching maximum capacity. Prepare to limit entry and advise visitors about alternatives.'
            : crowd.level === 'critical' ? 'Critical capacity warning. Follow the destination’s configured entry restrictions and safety procedures.' : null;
        return <div className="gatekeeper-dashboard-grid"><div className="gatekeeper-capacity-stack"><section className="capacity-live-card"><div className="card-heading"><span><small>LIVE DESTINATION CAPACITY</small><h3>{site?.name}</h3></span><span className={`capacity-state capacity-level-${crowd.level}`}>{crowd.label}</span></div>
          <p className="capacity-total"><b>{current == null ? '—' : current.toLocaleString()}</b> / {limit == null ? 'Capacity Not Configured' : limit.toLocaleString()} <span>visitors</span></p>
          {percent != null && limit != null && <><div className="capacity-progress" role="progressbar" aria-label="Recorded occupancy" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, percent)}><i className={`capacity-progress-${crowd.level}`} style={{ width: `${Math.min(100, percent)}%` }}/></div><div className="capacity-meta"><b>{formatCapacityPercent(percent)} occupied</b><span>{Math.max(0, limit - current!)} spaces remaining</span></div></>}
          {warning && <p className="capacity-warning" role="status">{warning}{percent != null && percent < 100 && crowd.level === 'critical' ? crowd.basis === 'estimate' ? ' This is a provisional estimate.' : ' Approved maximum not yet reached.' : ''}</p>}
          <p className="daily-booking-capacity">{capacityFeed.state === 'stale' ? 'Live update interrupted. ' : ''}Last successful update: {capacityFeed.updatedAt ? new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' }).format(new Date(capacityFeed.updatedAt)) : 'Unavailable'}.</p>
        </section><section className="arrivals-card"><div className="card-heading"><span><small>UPCOMING · ASSIGNED DESTINATION</small><h3>Reservations</h3></span><button className="link-btn" onClick={() => props.go('Reservations')}>View all <ArrowRight size={14}/></button></div>
          {loading && <div className="empty-inline">Loading reservations…</div>}
          {!loading && !upcoming.length && <div className="empty-inline">No upcoming reservations for this destination.</div>}
          {!loading && upcoming.map((booking) => { const slot = Array.isArray(booking.site_slots) ? booking.site_slots[0] : booking.site_slots; return <div className="arrival-row" key={booking.id}>
            <span className="arrival-initial">{String(booking.visitor_name ?? '?').slice(0, 1).toUpperCase()}</span>
            <span><b>{booking.visitor_name}</b><small>{booking.booking_reference} · {dateLabel(slot?.slot_date)} · {slot?.starts_at ? timeLabel(slot.starts_at) : ''} · {booking.visitor_count} visitors</small></span>
            <span className="status-tag">{String(booking.booking_status).replace(/_/g, ' ')}</span>
          </div>; })}
        </section></div><section className="quick-actions-card"><div className="card-heading"><span><small>QUICK ACTIONS</small><h3>Visitor operations</h3></span><Activity size={18}/></div><div className="gatekeeper-actions"><button className="gatekeeper-action-primary" onClick={() => props.go('Scan and exit')}><ScanLine/>Scan check-in</button><button onClick={() => props.go('Scan and exit')}><ArrowLeft/>Record check-out</button><button onClick={() => props.go('Walk-in registration')}><TicketIcon/>Walk-in visitor</button><button onClick={() => props.go('Reservations')}><CalendarDays/>Reservations</button><button onClick={() => props.go('Visitor Logbook')}><History/>Attendance log</button><button onClick={() => props.go('Capacity map')}><MapPinned/>Capacity map</button></div></section></div>; })()}
      {site && <DestinationMap site={site} occupancy={liveOccupancy}/>}
      <div className="gatekeeper-dashboard-grid gatekeeper-chart-row"><section className="chart-card"><div className="card-heading"><span><small>RECORDED ATTENDANCE · ASIA/MANILA</small><h3>Visitor activity</h3></span><CalendarDays size={18}/></div>{loading ? <div className="empty-inline">Loading attendance…</div> : gatekeeperAttendance.length ? <><div className="gatekeeper-trend-chart" style={{ gridTemplateColumns: `repeat(${monthEnd}, minmax(3px, 1fr))` }} role="img" aria-label={`Daily checked-in visitors at ${site?.name} for ${monthDate}`}>{gatekeeperDailyCounts.map((count, i) => { const day = i + 1; return <div key={day} title={`${day}: ${count} visitors`}><i style={{ height: `${count / gatekeeperDailyMax * 100}%` }}/>{(day === 1 || day % 5 === 0 || day === monthEnd) && <small>{day}</small>}</div>; })}</div><p className="report-note">Daily visitor count from recorded ticket check-ins for this destination.</p></> : <div className="empty-inline">No visitor attendance recorded for this month.</div>}</section></div>
      <section className="schedule-card gatekeeper-operations"><div className="card-heading"><span><small>TODAY’S OPERATIONS</small><h3>Reservation summary</h3></span><CalendarClock size={18}/></div><div className="gatekeeper-operation-metrics">{[[todayMetrics?.booking_count ?? 0, 'Today’s reservations'], [Math.max(0, Number(todayMetrics?.expected_visitor_count ?? 0) - Number(todayMetrics?.checked_in_visitor_count ?? 0)), 'Not yet checked in'], [todayMetrics?.pending_booking_count ?? 0, 'Awaiting payment'], [todayMetrics?.confirmed_booking_count ?? 0, 'Confirmed'], [todayMetrics?.cancelled_booking_count ?? 0, 'Cancelled'], [totalReservations, 'Total reservations']].map(([value, label]) => <div key={String(label)}><b>{loading ? '…' : value}</b><small>{label}</small></div>)}</div></section>
    </> : <><div className="stats-grid">{[
      [(props.role === 'tourism_office' ? monthlyVisitors : metric('visitor_count')).toLocaleString(), 'Visitors this month'],
      [metric('online_count').toLocaleString(), 'Online bookings'],
      [metric('walk_in_count').toLocaleString(), 'Walk-in bookings'],
    ].map(([value, label]) => <div key={label}><b>{loading ? '…' : value}</b><small>{label}</small></div>)}</div>
      <div className="dashboard-grid"><div className="chart-card"><div className="card-heading"><span><small>SCHEDULED BOOKINGS · ASIA/MANILA</small><h3>{props.role === 'tourism_office' && networkSiteId === 'all' ? 'Monthly Booking Activity by Destination' : 'Weekly Booking Activity'}</h3></span><CalendarDays size={18}/></div>
        {props.role === 'tourism_office' && networkSiteId === 'all' ? loading ? <div className="empty-inline">Loading booking activity…</div> : !dashboardSites.length ? <div className="empty-inline">No destinations available.</div> : <>
          <div className="network-chart-scroll"><svg className="network-visitor-chart" viewBox="0 0 720 280" role="img" aria-label={`Monthly number of people booked by destination for ${selectedYear}`}>
            {monthlyBookingTicks.map((value) => { const y = 218 - value / monthlyBookingAxisMax * 178; return <g key={value}><line x1="48" x2="704" y1={y} y2={y} className="network-chart-grid"/><text x="38" y={y + 4} textAnchor="end" className="network-chart-label">{value}</text></g>; })}
            {monthLabels.map((month, index) => { const x = 48 + index * 656 / 11; return <text key={month} x={x} y="243" textAnchor="middle" className="network-chart-label">{month}</text>; })}
            <text x="376" y="270" textAnchor="middle" className="network-chart-label">Month</text><text x="12" y="129" textAnchor="middle" transform="rotate(-90 12 129)" className="network-chart-label">Number of People Booking</text>
            {monthlyBookingSeries.map((series, seriesIndex) => { const color = ['#087fa4', '#36a275', '#e17832', '#d6a52f'][seriesIndex % 4]; const points = series.counts.map((value, index) => `${48 + index * 656 / 11},${218 - value / monthlyBookingAxisMax * 178}`).join(' '); return visibleSites.includes(series.site.id) && <g key={series.site.id}><polyline points={points} fill="none" stroke={color} strokeWidth="2.5"/>{series.counts.map((value, index) => <circle key={monthLabels[index]} cx={48 + index * 656 / 11} cy={218 - value / monthlyBookingAxisMax * 178} r="3" fill={color}><title>{`${monthLabels[index]} ${selectedYear} · ${series.site.name}: ${value} people booked`}</title></circle>)}</g>; })}
          </svg></div><div className="network-chart-legend">{monthlyBookingSeries.map((series, index) => <button key={series.site.id} aria-pressed={visibleSites.includes(series.site.id)} onClick={() => setVisibleSites((current) => current.includes(series.site.id) ? current.filter((id) => id !== series.site.id) : [...current, series.site.id])} style={{ opacity: visibleSites.includes(series.site.id) ? 1 : .45 }}><i style={{ background: ['#087fa4', '#36a275', '#e17832', '#d6a52f'][index % 4] }}/>{series.site.name}</button>)}</div>
          <p className="report-note"><ShieldCheck size={15}/> Monthly totals count visitors in confirmed or completed bookings by scheduled visit date. Cancelled and pending bookings are excluded{monthlyBookingMax === 0 ? `; no valid bookings recorded in ${selectedYear}.` : '.'}</p></> : loading ? <div className="empty-inline">Loading weekly bookings…</div> : <><div className="network-weekly-chart">{weeklyBookings.map((week) => { const max = Math.max(1, ...weeklyBookings.map((item) => item.count)); return <div key={week.week}><i style={{ height: `${Math.max(2, week.count / max * 100)}%` }} title={`Week ${week.week}: ${week.count} bookings`}/><small>Week {week.week}</small><b>{week.count}</b></div>; })}</div><p className="report-note">Bookings grouped by reservation date for {monthDate}.</p></>}
        {props.role !== 'tourism_office' && <p className="report-note"><ShieldCheck size={15}/> Counts come from confirmed database records and are scoped by staff permissions.</p>}</div>
        <div className="activity-card"><div className="card-heading"><span><small>WORKSPACE</small><h3>Quick actions</h3></span><Activity size={18}/></div>
          {props.role === 'tourism_office' ? <><button className="quick-row" onClick={() => props.go('Sites and staff')}><MapPin size={17}/> Manage destinations <ArrowRight size={14}/></button><button className="quick-row" onClick={() => props.go('Reports')}><ArrowDownToLine size={17}/> Export reports <ArrowRight size={14}/></button></>
            : <><button className="quick-row" onClick={() => props.go(props.role === 'site_admin' ? 'Schedule & Operations' : 'Slots and closures', 'capacity')}><CalendarDays size={17}/> Manage visit slots <ArrowRight size={14}/></button><button className="quick-row" onClick={() => props.go('Staff and accounts')}><Users size={17}/> Staff & accounts <ArrowRight size={14}/></button></>}</div></div>
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
  const [paymentBusy, setPaymentBusy] = useState('');
  const [pwdReviewBusy, setPwdReviewBusy] = useState('');
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
        'id,booking_reference,visitor_name,visitor_count,adult_count,child_count,total_amount,payment_method,booking_status,payment_status,booking_source,created_at,site_slots!inner(slot_date,starts_at,ends_at),reservation_visitors(id,sequence_number,visitor_type,full_name,address,gender,nationality,check_in_status,checked_in_at,reservation_pwd_verifications!reservation_pwd_verifications_reservation_visitor_id_fkey(id,disability_category,image_path,verification_status,review_reason,delete_after)),payments(provider,payment_application,payment_mode,payment_status)',
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
  const recordOnsitePayment = async (booking: Record<string, any>) => {
    if (!window.confirm(`Confirm ${money(Number(booking.total_amount))} payment was collected onsite for ${booking.booking_reference}?`)) return;
    setPaymentBusy(booking.id);
    try {
      const { error } = await db().rpc('record_onsite_payment', { p_booking_id: booking.id });
      if (error) throw error;
      props.notify('Simulated onsite payment recorded.');
      setRefreshKey((current) => current + 1);
    } catch (error) { props.notify(error instanceof Error ? error.message : 'Could not record onsite payment.'); }
    finally { setPaymentBusy(''); }
  };
  const viewPwdId = async (path: string) => {
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    try {
      const { data, error } = await db().storage.from('pwd-id-documents').createSignedUrl(path, 60);
      if (error || !data?.signedUrl) throw error ?? new Error('Could not open the private PWD ID photo.');
      if (tab) tab.location.href = data.signedUrl;
      else props.notify('Allow pop-ups to view this private PWD ID photo.');
    } catch (error) { tab?.close(); props.notify(error instanceof Error ? error.message : 'Could not open the private PWD ID photo.'); }
  };
  const reviewPwd = async (record: Record<string, any>, status: 'verified' | 'rejected') => {
    const reason = status === 'rejected' ? window.prompt('Reason for rejecting this PWD document?') : null;
    if (status === 'rejected' && !reason?.trim()) return;
    if (status === 'verified' && !window.confirm('Confirm the presented PWD ID matches this visitor?')) return;
    setPwdReviewBusy(record.id);
    try {
      const { error } = await db().rpc('review_pwd_verification', { p_verification_id: record.id, p_status: status, p_reason: reason });
      if (error) throw error;
      props.notify(status === 'verified' ? 'PWD ID marked verified.' : 'PWD ID marked rejected.');
      setRefreshKey((current) => current + 1);
    } catch (error) { props.notify(error instanceof Error ? error.message : 'Could not update PWD verification.'); }
    finally { setPwdReviewBusy(''); }
  };
  const deleteExpiredPwd = async (record: Record<string, any>) => {
    if (!window.confirm('Delete this expired PWD ID photo and verification record?')) return;
    setPwdReviewBusy(record.id);
    try {
      const { error: fileError } = await db().storage.from('pwd-id-documents').remove([record.image_path]);
      if (fileError) throw fileError;
      const { error } = await db().rpc('delete_expired_pwd_verification', { p_verification_id: record.id });
      if (error) throw error;
      props.notify('Expired PWD ID photo and record deleted.');
      setRefreshKey((current) => current + 1);
    } catch (error) { props.notify(error instanceof Error ? error.message : 'Could not delete the expired PWD document.'); }
    finally { setPwdReviewBusy(''); }
  };
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
      <label>Payment status<select value={paymentStatus} onChange={(event) => updateFilter(setPaymentStatus)(event.target.value)}><option value="all">All payment states</option><option value="not_required">No payment recorded / required</option><option value="pending">Pending</option><option value="paid">Paid</option><option value="failed">Failed</option><option value="expired">Expired</option><option value="refunded">Refunded</option></select></label>
    </div>
    <div className="table-toolbar" aria-busy={refreshing || !resultsCurrent}><span>{loading ? 'Loading…' : refreshing ? 'Updating reservations…' : resultsCurrent ? `${total} destination reservations` : 'Showing previous results'}</span><span>Page {page + 1} of {pageCount}</span></div>
    {!loading && !refreshing && resultsCurrent && !rows.length && <div className="empty-inline">No bookings match these filters.</div>}
    {loading && <div className="empty-inline" role="status">Loading reservations…</div>}
    {!loading && !!rows.length && <div className="table-card gatekeeper-bookings-table" aria-busy={refreshing || !resultsCurrent}><table><thead><tr><th>Reference</th><th>Booking contact</th><th>Visit</th><th>Visitors</th><th>Payment</th><th>Status</th><th>Created</th></tr></thead>
      <tbody>{rows.map((booking) => { const slot = Array.isArray(booking.site_slots) ? booking.site_slots[0] : booking.site_slots; const visitors = booking.reservation_visitors ?? []; const payment = Array.isArray(booking.payments) ? booking.payments[0] : booking.payments; const demoPaid = booking.payment_status === 'paid' && payment?.payment_mode === 'demo'; const walkIn = booking.booking_source === 'walk_in'; const paid = booking.payment_status === 'paid' || payment?.payment_status === 'paid'; const paymentMethodLabel = walkIn ? payment?.provider === 'cash' ? paid ? 'Paid with cash' : 'Cash' : payment?.provider === 'manual' && payment.payment_application ? `${paid ? 'Paid online through' : 'Online through'} ${payment.payment_application === 'gcash' ? 'GCash' : 'Maya'}` : payment?.provider === 'onsite' ? 'Paid onsite' : 'Payment method not recorded' : booking.payment_method === 'onsite' ? 'Pay onsite' : 'Online'; const paymentStateLabel = demoPaid ? 'Demo paid' : walkIn && !payment ? 'No payment record' : paymentStatusLabel(String(booking.payment_status), Number(booking.total_amount));
        return <tr key={booking.id}><td><b>{booking.booking_reference}</b><small>{booking.booking_source.replace('_', ' ')}</small></td>
          <td>{booking.visitor_name}</td><td>{dateLabel(slot?.slot_date)}<small>{slot?.starts_at ? timeLabel(slot.starts_at) : ''}</small></td>
          <td>{booking.visitor_count}<small>{booking.adult_count} adults · {booking.child_count} children</small>
            <details className="booking-visitors"><summary>Visitor list ({visitors.length})</summary><div>{visitors.map((visitor: Record<string, any>) => { const pwd = Array.isArray(visitor.reservation_pwd_verifications) ? visitor.reservation_pwd_verifications[0] : visitor.reservation_pwd_verifications; return <article key={visitor.id}>
              <b>{visitor.full_name}</b><small>{visitor.visitor_type} · {visitor.address}</small>
              {requiredVisitorFields(site.slug).includes('gender') && <small>Gender: {visitor.gender ?? '—'}</small>}
              {requiredVisitorFields(site.slug).includes('nationality') && <small>Nationality: {visitor.nationality ?? '—'}</small>}
              {pwd && <><small>PWD discount claimed · {pwd.disability_category.replace(/_/g, ' ')} · {String(pwd.verification_status).replace(/_/g, ' ')}</small>{pwd.review_reason && <small>Review reason: {pwd.review_reason}</small>}<small>Private ID retained through {dateLabel(pwd.delete_after)}.</small>
                <button className="link-btn" onClick={() => void viewPwdId(pwd.image_path)}>View private PWD ID</button>
                {pwd.verification_status === 'pending_verification' && <span className="pwd-review-actions"><button className="btn btn-outline btn-sm" disabled={Boolean(pwdReviewBusy)} onClick={() => void reviewPwd(pwd, 'verified')}>Verify ID</button><button className="btn btn-outline btn-sm" disabled={Boolean(pwdReviewBusy)} onClick={() => void reviewPwd(pwd, 'rejected')}>{pwdReviewBusy === pwd.id ? 'Saving…' : 'Reject'}</button></span>}
                {(props.role === 'tourism_office' || props.role === 'site_admin') && pwd.delete_after <= new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date()) && <button className="link-btn" disabled={Boolean(pwdReviewBusy)} onClick={() => void deleteExpiredPwd(pwd)}>{pwdReviewBusy === pwd.id ? 'Deleting…' : 'Delete expired ID'}</button>}</>}
              <small>{visitor.check_in_status === 'checked_in' ? 'Checked in' : 'Not checked in'}</small>
            </article>; })}</div></details></td>
          <td>{paymentMethodLabel}<small>{money(Number(booking.total_amount))} · {paymentStateLabel}</small>{booking.payment_method === 'onsite' && booking.payment_status === 'pending' && booking.booking_status === 'confirmed' && <button className="link-btn" disabled={Boolean(paymentBusy)} onClick={() => void recordOnsitePayment(booking)}>{paymentBusy === booking.id ? 'Recording…' : 'Record simulated payment'}</button>}</td>
          <td><span className="status-tag">{String(booking.booking_status).replace(/_/g, ' ')}</span><small>{paymentStateLabel}</small></td>
          <td>{new Date(booking.created_at).toLocaleString()}</td></tr>;
      })}</tbody></table></div>}
    <div className="staff-quick"><button className="btn btn-outline" disabled={loading || refreshing || !resultsCurrent || page === 0} onClick={() => setPage((current) => current - 1)}><ArrowLeft size={15}/> Previous</button>
      <button className="btn btn-outline" disabled={loading || refreshing || !resultsCurrent || page + 1 >= pageCount} onClick={() => setPage((current) => current + 1)}>Next <ArrowRight size={15}/></button></div></>}
  </section>;
}

const emptyManualPaymentSettings: ManualPaymentSettings = {
  demo_mode: true, payment_window_minutes: 15,
  gcash_enabled: true, gcash_account_name: 'Destination Demo Account', gcash_account_identifier: 'DEMO-GCASH-001',
  maya_enabled: true, maya_account_name: 'Destination Demo Account', maya_account_identifier: 'DEMO-MAYA-001',
  onsite_instructions: 'Present your booking reference at the destination entrance and complete payment with the authorized Gatekeeper.',
};

function PaymentSettingsPage(props: Props) {
  const [settings, setSettings] = useState<ManualPaymentSettings>(emptyManualPaymentSettings);
  const [saved, setSaved] = useState<ManualPaymentSettings>(emptyManualPaymentSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const siteId = props.sites.some((site) => site.id === props.siteId) ? props.siteId : props.sites[0]?.id ?? '';
  useEffect(() => {
    let active = true;
    if (!siteId) { setSettings(emptyManualPaymentSettings); setSaved(emptyManualPaymentSettings); setLoading(false); return; }
    setLoading(true);
    void (async () => {
      try {
        const [globalResult, siteResult] = await Promise.all([
          db().from('tourism_payment_settings').select('demo_mode,payment_window_minutes').eq('id', true).maybeSingle(),
          db().from('site_demo_payment_settings').select('gcash_enabled,gcash_account_name,gcash_account_identifier,maya_enabled,maya_account_name,maya_account_identifier,onsite_instructions').eq('site_id', siteId).maybeSingle(),
        ]);
        if (!active) return;
        if (globalResult.error || siteResult.error) props.notify(globalResult.error?.message ?? siteResult.error?.message ?? 'Could not load payment settings.');
        else {
          const demoAccountName = `${props.sites.find((site) => site.id === siteId)?.name ?? 'Destination'} Demo Account`;
          const next = { ...emptyManualPaymentSettings,
            gcash_account_name: demoAccountName, maya_account_name: demoAccountName,
            gcash_account_identifier: `DEMO-GCASH-${siteId.replace(/-/g, '').slice(0, 8).toUpperCase()}`,
            maya_account_identifier: `DEMO-MAYA-${siteId.replace(/-/g, '').slice(0, 8).toUpperCase()}`,
            ...globalResult.data, ...siteResult.data,
          } as ManualPaymentSettings;
          if (next.gcash_account_name === 'Illiguide Demo Tourism Office') next.gcash_account_name = demoAccountName;
          if (next.maya_account_name === 'Illiguide Demo Tourism Office') next.maya_account_name = demoAccountName;
          setSettings(next); setSaved(next);
        }
      } catch (error) {
        if (active) props.notify(error instanceof Error ? error.message : 'Could not load payment settings.');
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [props.notify, siteId]);
  const change = <K extends keyof ManualPaymentSettings>(key: K, value: ManualPaymentSettings[K]) => setSettings((current) => ({ ...current, [key]: value }));
  const save = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true);
    try {
      if (!siteId) throw new Error('Choose a destination before saving payment settings.');
      const { error } = await db().from('site_demo_payment_settings').upsert({
        site_id: siteId, gcash_enabled: settings.gcash_enabled, gcash_account_name: settings.gcash_account_name.trim(),
        gcash_account_identifier: settings.gcash_account_identifier.trim().toUpperCase(),
        maya_enabled: settings.maya_enabled, maya_account_name: settings.maya_account_name.trim(),
        maya_account_identifier: settings.maya_account_identifier.trim().toUpperCase(),
        onsite_instructions: settings.onsite_instructions.trim(), updated_by: props.user?.id,
      }, { onConflict: 'site_id' });
      if (error) throw error;
      const normalized = { ...settings, gcash_account_identifier: settings.gcash_account_identifier.trim().toUpperCase(), maya_account_identifier: settings.maya_account_identifier.trim().toUpperCase() };
      setSettings(normalized); setSaved(normalized); props.notify('Payment settings saved.');
    } catch (error) { props.notify(error instanceof Error ? error.message : 'Could not save payment settings.'); }
    finally { setSaving(false); }
  };
  return <section className="dashboard-page section-wrap"><div className="dash-header"><div><h1>Payment <em>settings.</em></h1><p>Configure fictional payment options for each destination.</p></div>
    {props.role === 'tourism_office' && <label className="payment-site-picker">Destination<select value={siteId} onChange={(event) => props.setSiteId(event.target.value)}>{props.sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>}</div>
    {loading ? <div className="empty-inline" role="status">Loading payment settings…</div> : !siteId ? <div className="empty-card"><CreditCard size={26}/><h3>No destination available</h3><p>Payment settings need an assigned destination.</p></div> : <form className="manual-payment-settings" onSubmit={(event) => void save(event)}>
      <div className="demo-payment-banner"><strong>DEMO MODE ACTIVE — NO REAL PAYMENTS</strong><span>All payment accounts, QR codes, and transactions are simulated for demonstration purposes.</span></div>
      <div className="demo-payment-settings-heading"><div><h2>{props.sites.find((site) => site.id === siteId)?.name ?? 'Destination'} payment methods</h2><p>Identifiers must start with the matching DEMO prefix. These QR codes cannot accept money.</p></div><span className="demo-window"><Clock3 size={16}/> {settings.payment_window_minutes} minutes to complete payment</span></div>
      <div className="demo-payment-settings-grid">
        <DemoPaymentMethodSettings method="gcash" settings={settings} change={change}/>
        <DemoPaymentMethodSettings method="maya" settings={settings} change={change}/>
      </div>
      <label>Onsite payment instructions<textarea rows={3} maxLength={1000} required value={settings.onsite_instructions} onChange={(event) => change('onsite_instructions', event.target.value)}/><small>Shown on visitor booking confirmation. Gatekeepers record onsite demo collections.</small></label>
      <div className="demo-payment-actions"><button type="button" className="btn btn-outline" disabled={saving} onClick={() => setSettings(saved)}>Discard changes</button><button className="btn btn-primary" disabled={saving || !settings.onsite_instructions.trim()}>{saving ? 'Saving…' : 'Save settings'} <Check size={15}/></button></div>
    </form>}
  </section>;
}

function DemoPaymentMethodSettings({ method, settings, change }: {
  method: 'gcash' | 'maya'; settings: ManualPaymentSettings;
  change: <K extends keyof ManualPaymentSettings>(key: K, value: ManualPaymentSettings[K]) => void;
}) {
  const [showQr, setShowQr] = useState(true);
  const label = method === 'gcash' ? 'GCash' : 'Maya';
  const enabledKey = `${method}_enabled` as 'gcash_enabled' | 'maya_enabled';
  const nameKey = `${method}_account_name` as 'gcash_account_name' | 'maya_account_name';
  const idKey = `${method}_account_identifier` as 'gcash_account_identifier' | 'maya_account_identifier';
  const accountId = settings[idKey];
  const qrPayload = `DEMO_ILLIGUIDE_PAYMENT\nPayment Method: ${label} Demo\nAccount ID: ${accountId}\nMode: SIMULATION_ONLY`;
  return <fieldset className="demo-payment-method">
    <legend>{label} Demo</legend>
    <div className="demo-method-heading"><span><b>{label} · Demo</b><small>Internal simulation account</small></span>
      <button type="button" role="switch" aria-checked={settings[enabledKey]} aria-label={`${settings[enabledKey] ? 'Disable' : 'Enable'} ${label} Demo`} className={'demo-method-switch' + (settings[enabledKey] ? ' enabled' : '')} onClick={() => change(enabledKey, !settings[enabledKey])}><span/></button>
    </div>
    <div className="demo-method-fields"><label>Account name<input required minLength={3} maxLength={120} pattern=".*[Dd][Ee][Mm][Oo].*" title="Use a fictional name containing ‘Demo’." value={settings[nameKey]} onChange={(event) => change(nameKey, event.target.value)}/></label>
      <label>Account identifier<input required minLength={14} maxLength={60} pattern={`DEMO-${method.toUpperCase()}-[A-Za-z0-9-]{3,40}`} title={`Use a fictional identifier beginning DEMO-${method.toUpperCase()}-.`} value={accountId} onChange={(event) => change(idKey, event.target.value)}/></label>
    </div>
    {settings[enabledKey] && <div className="demo-qr-preview"><div><strong>DEMO QR — NOT PAYABLE</strong><small>Simulation details only. No payment address or live link.</small></div>
      {showQr ? <QRCodeSVG value={qrPayload} size={132} level="M" title={`${label} demo QR code, not payable`} includeMargin/> : <span className="demo-qr-placeholder">QR preview hidden</span>}
      <button type="button" className="btn btn-outline" aria-expanded={showQr} onClick={() => setShowQr((value) => !value)}>{showQr ? 'Hide QR preview' : 'Generate Demo QR Code'}</button>
    </div>}
  </fieldset>;
}

type ManualPaymentReview = Record<string, any> & { id: string; proof_storage_path: string; payment_application: string; amount: number; transaction_reference: string; proof_submitted_at: string; payment_status: string; rejection_reason: string | null };
function ManualPaymentVerificationPage(props: Props) {
  const [rows, setRows] = useState<ManualPaymentReview[]>([]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [proofPreviews, setProofPreviews] = useState<Record<string, boolean>>({});
  const refresh = useCallback(async () => {
    let query = db().from('payments').select('id,booking_id,payment_mode,payment_application,amount,currency,payment_status,transaction_reference,proof_storage_path,proof_submitted_at,booking:bookings!payments_booking_id_fkey(booking_reference,visitor_name,visitor_email,visitor_phone,site_id,total_amount,tourism_sites(name),site_slots(slot_date,starts_at))')
      .eq('provider', 'manual').eq('payment_mode', 'demo').eq('payment_status', 'pending_verification');
    if ((props.role === 'site_admin' || props.role === 'gatekeeper') && props.siteId) query = query.eq('booking.site_id', props.siteId);
    const { data, error } = await query.order('proof_submitted_at', { ascending: true });
    if (error) throw error;
    const signed = await Promise.all((data ?? []).map(async (item: any) => {
      const { data: url, error } = await db().storage.from('manual-payment-proofs').createSignedUrl(item.proof_storage_path, 300);
      if (error) throw error;
      return { ...item, proof_url: url?.signedUrl ?? '' };
    }));
    setRows(signed as ManualPaymentReview[]);
  }, [props.role, props.siteId]);
  useEffect(() => {
    let active = true;
    const run = () => void refresh().catch((error) => { if (active) props.notify(error instanceof Error ? error.message : 'Could not load payment submissions.'); }).finally(() => { if (active) setLoading(false); });
    run(); const timer = window.setInterval(run, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [props.notify, refresh, refreshKey]);
  const review = async (row: ManualPaymentReview, approve: boolean) => {
    const reason = (reasons[row.id] ?? '').trim();
    if (!approve && !reason) { props.notify('Enter a rejection reason.'); return; }
    setBusy(row.id);
    try {
      const { error } = await db().rpc('review_manual_payment', { p_payment_id: row.id, p_approve: approve, p_rejection_reason: approve ? null : reason });
      if (error) throw error;
      const booking = Array.isArray(row.booking) ? row.booking[0] : row.booking;
      if (approve && booking?.booking_reference) void invokeFunction('send-booking-email', { booking_reference: booking.booking_reference, event: 'confirmed' })
        .catch(() => props.notify('Payment verified, but the confirmation email could not be sent.'));
      props.notify(approve ? 'Demo payment approved and booking confirmed.' : 'Demo payment rejected. Visitor notified in their account.');
      setRefreshKey((value) => value + 1);
    } catch (error) { props.notify(error instanceof Error ? error.message : 'Could not review payment.'); }
    finally { setBusy(''); }
  };
  return <section className="dashboard-page section-wrap"><div className="dash-header"><div><h1>Demo payment <em>verification.</em></h1><p>Review fictional transaction references and generated sample proof. No real money is accepted.</p></div><button className="btn btn-outline" onClick={() => setRefreshKey((value) => value + 1)}><RefreshCw size={15}/> Refresh</button></div>
    {loading && <div className="empty-inline" role="status">Loading payment submissions…</div>}
    {!loading && !rows.length && <div className="empty-card"><BadgeCheck size={26}/><h3>No payments awaiting verification</h3><p>New proof submissions appear here.</p></div>}
    <div className="manual-payment-review-list">{rows.map((row) => { const booking = Array.isArray(row.booking) ? row.booking[0] : row.booking; const site = Array.isArray(booking?.tourism_sites) ? booking.tourism_sites[0] : booking?.tourism_sites; const slot = Array.isArray(booking?.site_slots) ? booking.site_slots[0] : booking?.site_slots; const isImageProof = /\.(jpe?g|png)$/i.test(row.proof_storage_path); const proofExpanded = Boolean(proofPreviews[row.id]); return <article className="manual-payment-review" key={row.id}>
      <div><small>{booking?.booking_reference}</small><h2>{booking?.visitor_name} · {site?.name}</h2><p>{booking?.visitor_email || booking?.visitor_phone} · {slot?.slot_date} {slot?.starts_at ? timeLabel(slot.starts_at) : ''}</p></div>
      <dl><div><dt>Mode</dt><dd>DEMO · No funds transferred</dd></div><div><dt>Application</dt><dd>{row.payment_application?.toUpperCase()} · Demo</dd></div><div><dt>Simulated amount</dt><dd>{money(Number(row.amount))}</dd></div><div><dt>Demo transaction reference</dt><dd>{row.transaction_reference}</dd></div><div><dt>Submitted</dt><dd>{new Date(row.proof_submitted_at).toLocaleString()}</dd></div></dl>
      {row.proof_url && <div className="manual-payment-proof-preview">
        <button type="button" className="btn btn-outline" aria-expanded={proofExpanded} onClick={() => setProofPreviews((current) => ({ ...current, [row.id]: !current[row.id] }))}>{proofExpanded ? `Hide ${isImageProof ? 'image' : 'PDF'}` : `View ${isImageProof ? 'image' : 'PDF'}`} {isImageProof ? <ImageIcon size={15}/> : <FileText size={15}/>}</button>
        {proofExpanded && (isImageProof ? <img className="manual-payment-proof-image" src={row.proof_url} alt={`Payment proof for ${booking?.booking_reference}`}/> : <iframe className="manual-payment-proof-pdf" src={row.proof_url} title={`Payment proof for ${booking?.booking_reference}`}/>)}
      </div>}
      <label>Rejection reason<textarea value={reasons[row.id] ?? ''} onChange={(event) => setReasons((current) => ({ ...current, [row.id]: event.target.value }))} maxLength={1000} rows={2}/></label>
      <div className="manual-payment-review-actions"><button className="btn btn-outline" disabled={Boolean(busy)} onClick={() => void review(row, false)}>{busy === row.id ? 'Saving…' : 'Reject proof'}</button><button className="btn btn-primary" disabled={Boolean(busy)} onClick={() => void review(row, true)}>{busy === row.id ? 'Saving…' : 'Verify payment'} <Check size={15}/></button></div>
    </article>; })}</div>
  </section>;
}

function AccessNotice() {
  return <section className="dashboard-page section-wrap"><div className="empty-card"><ShieldCheck size={30}/><h3>This page is not available to this staff role</h3><p>Access follows the role and destination assignments linked to your account.</p></div></section>;
}

type ScanResult = { result: string; booking_reference: string | null; visitor_name: string | null; visitor_count: number; entered_at: string | null; exited_at: string | null; entered_count: number; exited_count: number; active_count: number };
type AttendanceParticipant = { visitor_id: string; full_name: string; visitor_type: string; check_in_status: 'not_checked_in' | 'checked_in' | 'checked_out' };
const attendanceLimit = (result: ScanResult, action: 'entry' | 'exit') => action === 'entry'
  ? result.visitor_count - result.entered_count : result.active_count;
function ScannerPage(props: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const lockRef = useRef(false);
  const [scanMode, setScanMode] = useState<'camera' | 'manual'>('camera');
  const [manual, setManual] = useState('');
  const [cameraOn, setCameraOn] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [attendanceCount, setAttendanceCount] = useState('1');
  const [attendanceAction, setAttendanceAction] = useState<'entry' | 'exit'>('entry');
  const [participants, setParticipants] = useState<AttendanceParticipant[]>([]);
  const [selectedVisitorIds, setSelectedVisitorIds] = useState<string[]>([]);
  const [participantsLoading, setParticipantsLoading] = useState(false);
  const [participantsFailed, setParticipantsFailed] = useState(false);
  const [pendingEventKey, setPendingEventKey] = useState('');
  const [ticketToken, setTicketToken] = useState('');
  const [manualReference, setManualReference] = useState('');
  const [scanError, setScanError] = useState('');
  const [scanBusy, setScanBusy] = useState(false);
  const site = props.sites.find((item) => item.id === props.siteId);
  const showResult = async (row: ScanResult) => {
    setResult(row);
    setParticipants([]); setSelectedVisitorIds([]); setParticipantsFailed(false);
    if (['entry_confirmation_required', 'checkout_confirmation_required', 'attendance_confirmation_required'].includes(row.result)) {
      const action = row.result === 'checkout_confirmation_required' ? 'exit' : 'entry';
      setAttendanceAction(action);
      setAttendanceCount(String(Math.max(1, attendanceLimit(row, action))));
      setPendingEventKey(crypto.randomUUID());
      if (row.booking_reference && props.siteId) {
        setParticipantsLoading(true);
        try {
          const { data, error } = await db().rpc('attendance_participants', {
            p_booking_reference: row.booking_reference, p_site_id: props.siteId,
          });
          if (error) throw error;
          const rows = Array.isArray(data) ? data as AttendanceParticipant[] : [];
          const eligible = rows.filter((visitor) => visitor.check_in_status === (action === 'entry' ? 'not_checked_in' : 'checked_in'));
          setParticipants(rows); setSelectedVisitorIds(eligible.map((visitor) => visitor.visitor_id));
          if (rows.length) setAttendanceCount(String(eligible.length));
        } catch {
          setParticipantsFailed(true);
          setScanError('Could not load this booking’s visitor list. Retry the scan.');
        } finally {
          setParticipantsLoading(false);
        }
      }
    } else setPendingEventKey('');
  };

  const processToken = useCallback(async (token: string) => {
    if (!props.siteId || lockRef.current) return;
    lockRef.current = true;
    setScanBusy(true);
    setScanError('');
    setTicketToken(token);
    setManualReference('');
    try {
      const payload = await invokeFunction<{ result: ScanResult }>('scan-ticket', { token, site_id: props.siteId });
      await showResult(payload.result);
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
    setResult(null); setTicketToken(''); setManualReference('');
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
    setTicketToken(''); setManualReference(manual.trim());
    try {
      const { data, error } = await db().rpc('manual_scan_ticket', {
        p_booking_reference: manual.trim(),
        p_site_id: props.siteId,
        p_device: { user_agent: navigator.userAgent.slice(0, 240), method: 'manual' },
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as ScanResult;
      await showResult(row);
    } catch (error) { setScanError(error instanceof Error ? error.message : 'Could not look up this booking.'); }
    finally { setScanBusy(false); }
  };
  const confirmAttendance = async (event: FormEvent) => {
    event.preventDefault();
    if (!result || !props.siteId || !pendingEventKey) return;
    const action = result.result === 'entry_confirmation_required' ? 'entry'
      : result.result === 'checkout_confirmation_required' ? 'exit' : attendanceAction;
    const max = attendanceLimit(result, action);
    const count = participants.length ? selectedVisitorIds.length : Number(attendanceCount);
    if (participantsLoading || participantsFailed) return;
    if (participants.length && count < 1) {
      setScanError('Select at least one eligible visitor.');
      return;
    }
    if (!Number.isSafeInteger(count) || count < 1 || count > max) {
      setScanError(`Enter a visitor count from 1 to ${max}.`);
      return;
    }
    setScanBusy(true); setScanError('');
    try {
      let confirmed: ScanResult;
      if (ticketToken) confirmed = (await invokeFunction<{ result: ScanResult }>('scan-ticket', {
        token: ticketToken, site_id: props.siteId, action, visitor_count: count,
        visitor_ids: participants.length ? selectedVisitorIds : [], idempotency_key: pendingEventKey,
      })).result;
      else {
        const { data, error } = await db().rpc('confirm_manual_attendance', {
          p_booking_reference: manualReference, p_site_id: props.siteId, p_action: action,
          p_visitor_count: count, p_idempotency_key: pendingEventKey,
          p_visitor_ids: participants.length ? selectedVisitorIds : [],
          p_device: { user_agent: navigator.userAgent.slice(0, 240), method: 'manual' },
        });
        if (error) throw error;
        confirmed = (Array.isArray(data) ? data[0] : data) as ScanResult;
      }
      await showResult(confirmed);
    } catch (error) { setScanError(error instanceof Error ? error.message : 'Could not record attendance.'); }
    finally { setScanBusy(false); }
  };

  const canConfirmAttendance = Boolean(result && ['entry_confirmation_required', 'checkout_confirmation_required', 'attendance_confirmation_required'].includes(result.result));
  const chooseEntryOrExit = result?.result === 'attendance_confirmation_required';
  const attendanceMax = result ? attendanceLimit(result, attendanceAction) : 0;
  const attendanceEligibleParticipants = participants.filter((visitor) => visitor.check_in_status === (attendanceAction === 'entry' ? 'not_checked_in' : 'checked_in'));

  return <section className="dashboard-page section-wrap"><div className="dash-header"><div><span className="eyebrow"><span className="eyebrow-line"/> {site?.name ?? 'GATEKEEPER'} · SCAN & EXIT</span><h1>One scan at a <em>time.</em></h1><p>Scans validate tickets. Confirm the actual visitor count to record entry or checkout.</p></div></div>
    {!props.siteId && <div className="empty-card"><ShieldCheck size={30}/><h3>No site assignment</h3><p>Ask the Tourism Office to assign your gatekeeper account.</p></div>}
    {!!props.siteId && <div className="scan-layout"><article className="scan-card"><div className="scan-mode"><button type="button" className={scanMode === 'camera' ? 'selected' : ''} aria-pressed={scanMode === 'camera'} onClick={() => { setScanMode('camera'); setManual(''); setScanError(''); }}>Camera</button><button type="button" className={scanMode === 'manual' ? 'selected' : ''} aria-pressed={scanMode === 'manual'} onClick={() => { stopCamera(); setScanMode('manual'); setScanError(''); }}>Manual reference</button></div>
      {scanMode === 'camera' && <>
        <div className="camera-box"><video ref={videoRef} muted playsInline className={cameraOn ? 'scanner-video visible' : 'scanner-video'}/>{!cameraOn && <div className="camera-placeholder"><Camera size={31}/><p>Point the camera at the visitor’s QR ticket.</p><small>Camera permission is requested only after you start the scanner.</small></div>}</div>
        <div className="scan-controls">{cameraOn ? <button type="button" className="btn btn-outline" onClick={stopCamera}><X size={15}/> Stop camera</button>
          : <button type="button" className="btn btn-primary" onClick={() => void startCamera()} disabled={!props.siteId}><Camera size={15}/> Start camera</button>}
          <span>{site?.name ?? 'Select a site'}</span></div>
      </>}
      {scanMode === 'manual' && <form className="manual-scan-form" onSubmit={(event) => void manualLookup(event)}><label>Booking reference<input value={manual} onChange={(event) => setManual(event.target.value)} autoFocus placeholder="ILG-…" autoCapitalize="characters" required/></label><button type="submit" className="btn btn-primary" disabled={scanBusy || !manual.trim()}>{scanBusy ? 'Checking…' : 'Look up booking'} <ArrowRight size={15}/></button></form>}
      {scanError && <p className="form-error" role="alert">{scanError}</p>}
    </article><article className="scan-result-card"><div className="card-heading"><span><small>SCAN RESULT</small><h3>Entry & exit record</h3></span><ShieldCheck size={19}/></div>
      {!result && !scanError && <div className="empty-inline">A scan result will appear here after the server validates the ticket.</div>}
      {result && <div className="scan-result"><span className={result.result.includes('recorded') ? 'scan-result-icon success' : 'scan-result-icon'}>{result.result.includes('recorded') ? <Check size={23}/> : <ShieldCheck size={23}/>}</span>
        <strong>{scanLabel(result.result)}</strong><p>{result.visitor_name || 'Ticket details unavailable'}</p>
        {result.booking_reference && <small>{result.booking_reference} · {result.visitor_count} booked · {result.entered_count} admitted · {result.active_count} inside</small>}
        {canConfirmAttendance && <p className="scan-confirm-hint">Ticket verified. Confirm the visitors entering now to record their check-in.</p>}
        {result.entered_at && <small>Entry: {new Date(result.entered_at).toLocaleString()}</small>}
        {result.exited_at && <small>Exit: {new Date(result.exited_at).toLocaleString()}</small>}
        {canConfirmAttendance && <form className="scan-confirm-form" onSubmit={(event) => void confirmAttendance(event)}>
          {chooseEntryOrExit && <label>Attendance action
            <select value={attendanceAction} disabled={participantsLoading} onChange={(event) => {
              const action = event.target.value as 'entry' | 'exit';
              setAttendanceAction(action);
              const eligible = participants.filter((visitor) => visitor.check_in_status === (action === 'entry' ? 'not_checked_in' : 'checked_in'));
              setSelectedVisitorIds(eligible.map((visitor) => visitor.visitor_id));
              setAttendanceCount(String(participants.length ? eligible.length : Math.max(1, attendanceLimit(result, action))));
            }}>
              <option value="entry">Record additional arrivals</option>
              <option value="exit">Confirm departures</option>
            </select>
          </label>}
          {participantsLoading ? <small>Loading visitor list…</small> : participants.length > 0 ? <fieldset className="scan-participants">
            <legend>{attendanceAction === 'entry' ? 'Select visitors entering' : 'Select visitors checking out'}</legend>
            {attendanceEligibleParticipants.map((visitor) => <label key={visitor.visitor_id}>
              <input type="checkbox" checked={selectedVisitorIds.includes(visitor.visitor_id)} disabled={scanBusy}
                onChange={(event) => {
                  const next = event.target.checked
                    ? [...selectedVisitorIds, visitor.visitor_id]
                    : selectedVisitorIds.filter((id) => id !== visitor.visitor_id);
                  setSelectedVisitorIds(next); setAttendanceCount(String(next.length));
                }}/>
              <span>{visitor.full_name}<small>{visitor.visitor_type === 'adult' ? 'Adult' : 'Child'}</small></span>
            </label>)}
            <small>{selectedVisitorIds.length} of {attendanceEligibleParticipants.length} selected.</small>
          </fieldset> : <label>{attendanceAction === 'entry' ? 'Visitors entering now' : 'Visitors checking out now'}
            <input type="number" min="1" max={attendanceMax}
              value={attendanceCount} onChange={(event) => setAttendanceCount(event.target.value)} required/>
            <small>Count-only booking. Maximum {attendanceMax}; all visitors enter or exit together.</small>
          </label>}
          <button className="btn btn-primary" type="submit" disabled={scanBusy || participantsLoading || participantsFailed || (participants.length > 0 && selectedVisitorIds.length === 0)}>{scanBusy ? 'Saving…' : attendanceAction === 'entry' ? 'Confirm ticket & check-in' : 'Confirm ticket & check-out'} <Check size={15}/></button>
        </form>}
        <button type="button" className="btn btn-outline" onClick={() => { setResult(null); setScanError(''); setTicketToken(''); setManualReference(''); setPendingEventKey(''); }}>Scan another ticket</button></div>}
    </article></div>}
  </section>;
}

function scanLabel(result: string) {
  return ({ entry_recorded: 'Check-in recorded', exit_recorded: 'Check-out recorded',
    entry_confirmation_required: 'Confirm actual visitors entering', checkout_confirmation_required: 'Confirm visitors checking out', attendance_confirmation_required: 'Choose entry or checkout', completed: 'Visit already completed',
    visitor_roster_incomplete: 'Visitor list incomplete; contact the Tourism Office',
    invalid: 'Ticket is invalid', unpaid_or_inactive: 'Booking is unpaid or inactive', outside_window: 'Outside the visit time window' } as Record<string, string>)[result] ?? result.replace(/_/g, ' ');
}

type Hour = { weekday: number; opens_at: string; closes_at: string; is_closed: boolean };
const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const scheduleMonthStart = (date: string) => date.slice(0, 7) + '-01';
const scheduleMonthEnd = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
const shiftScheduleMonth = (month: string, delta: number) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + delta, 1)).toISOString().slice(0, 7) + '-01';
const scheduleMonthLabel = (month: string) => new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(month + 'T00:00:00Z'));
function ScheduleOperationsPage(props: Props) {
  const [tab, setTab] = useState<'duty' | 'hours' | 'capacity'>(() => {
    const requested = new URLSearchParams(window.location.search).get('tab');
    return requested === 'hours' || requested === 'capacity' ? requested : 'duty';
  });
  const tabs = [['duty', 'Duty Calendar', CalendarDays], ['hours', 'Operating Hours', CalendarClock], ['capacity', 'Capacity & Booking Slots', MapPinned]] as const;
  return <section className="dashboard-page section-wrap schedule-operations-page">
    <div className="dash-header"><div><span className="eyebrow"><span className="eyebrow-line"/> TOURISM OFFICE · OPERATIONS</span><h1>Schedule & <em>Operations.</em></h1><p>Manage gatekeeper assignments, operating hours, and booking capacity by destination.</p></div>
      <label className="staff-site-picker">Destination<SiteSelector {...props}/></label></div>
    <div className="schedule-operation-tabs" role="tablist" aria-label="Schedule and operations">
      {tabs.map(([id, label, Icon]) => <button key={id} id={`schedule-tab-${id}`} type="button" role="tab" aria-selected={tab === id} aria-controls="schedule-tab-panel" tabIndex={tab === id ? 0 : -1} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><Icon size={18}/>{label}</button>)}
    </div>
    <div id="schedule-tab-panel" className="schedule-tab-panel" role="tabpanel" aria-labelledby={`schedule-tab-${tab}`}>
      {tab === 'duty' ? <DutyRosterPage key={props.siteId} {...props} embedded/> : <SchedulePage key={props.siteId} {...props} view={tab} embedded/>}
    </div>
  </section>;
}

function SchedulePage(props: Props & { view?: 'all' | 'hours' | 'capacity'; embedded?: boolean }) {
  const view = props.view ?? 'all';
  const showHours = view !== 'capacity';
  const showCapacity = view !== 'hours';
  const closedHours = () => dayNames.map((_, weekday): Hour => ({ weekday, opens_at: '', closes_at: '', is_closed: true }));
  const [hours, setHours] = useState<Hour[]>(closedHours);
  const [savedHours, setSavedHours] = useState<Hour[]>(closedHours);
  const [specialHours, setSpecialHours] = useState<Array<Record<string, any>>>([]);
  const [slots, setSlots] = useState<Array<Record<string, any>>>([]);
  const [slotAvailability, setSlotAvailability] = useState<Slot[]>([]);
  const [dailyCapacity, setDailyCapacity] = useState('');
  const [selectedSlotDate, setSelectedSlotDate] = useState(phToday());
  const [slotView, setSlotView] = useState<'day' | 'week'>('day');
  const [slotModalOpen, setSlotModalOpen] = useState(false);
  const [slotDuration, setSlotDuration] = useState('60');
  const [editingSlotId, setEditingSlotId] = useState('');
  const [closures, setClosures] = useState<Array<Record<string, any>>>([]);
  const [specialMonth, setSpecialMonth] = useState(() => scheduleMonthStart(phToday()));
  const [selectedSpecialDate, setSelectedSpecialDate] = useState(phToday());
  const [dateEditor, setDateEditor] = useState<'' | 'special' | 'closure'>('');
  const [specialForm, setSpecialForm] = useState({ date: phToday(), opens_at: '', closes_at: '', is_closed: false, reason: '' });
  const [slotForm, setSlotForm] = useState({ date: phToday(), starts_at: '', ends_at: '', capacity: '' });
  const [closureForm, setClosureForm] = useState({ starts_on: phToday(), ends_on: phToday(), reason: '' });
  const [loading, finishLoading] = useSilentLoad(`${props.user?.id ?? 'staff'}:${props.role}:${props.siteId}`);
  const [saving, setSaving] = useState(false);
  const site = props.sites.find((item) => item.id === props.siteId);
  const slotRangeEnd = new Date(Date.parse(`${selectedSlotDate}T12:00:00+08:00`) + (slotView === 'day' ? 0 : 6) * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  useEffect(() => setDailyCapacity(site?.daily_capacity == null ? '' : String(site.daily_capacity)), [site?.id, site?.daily_capacity]);
  const refresh = useCallback(async () => {
    if (!props.siteId) {
      setHours(closedHours()); setSavedHours(closedHours());
      setSpecialHours([]); setSlots([]); setClosures([]); finishLoading(); return;
    }
    try {
      const monthEnd = scheduleMonthEnd(specialMonth);
      const [hourResult, slotResult, closureResult, exceptionResult, availabilityRows] = await Promise.all([
        db().from('site_operating_hours').select('weekday,opens_at,closes_at,is_closed').eq('site_id', props.siteId).order('weekday'),
        db().from('site_slots').select('id,slot_date,starts_at,ends_at,capacity,status').eq('site_id', props.siteId).gte('slot_date', selectedSlotDate).lte('slot_date', slotRangeEnd).order('slot_date').order('starts_at'),
        db().from('site_closures').select('id,starts_on,ends_on,starts_at,ends_at,reason').eq('site_id', props.siteId).lte('starts_on', monthEnd).gte('ends_on', specialMonth).order('starts_on').limit(60),
        db().from('site_operating_exceptions').select('id,exception_date,opens_at,closes_at,is_closed,reason').eq('site_id', props.siteId).gte('exception_date', specialMonth).lte('exception_date', monthEnd).order('exception_date').limit(120),
        loadSlots(props.siteId, selectedSlotDate, slotRangeEnd),
      ]);
      if (hourResult.error) throw hourResult.error;
      if (slotResult.error) throw slotResult.error;
      if (closureResult.error) throw closureResult.error;
      if (exceptionResult.error) throw exceptionResult.error;
      const stored = new Map((hourResult.data ?? []).map((row) => [row.weekday, row]));
      const loadedHours = dayNames.map((_, weekday): Hour => {
        const row = stored.get(weekday);
        return row ? { weekday, opens_at: String(row.opens_at ?? '').slice(0, 5), closes_at: String(row.closes_at ?? '').slice(0, 5), is_closed: row.is_closed }
          : { weekday, opens_at: '', closes_at: '', is_closed: true };
      });
      setHours(loadedHours); setSavedHours(loadedHours);
      setSlots(slotResult.data ?? []);
      setSlotAvailability(availabilityRows);
      setClosures(closureResult.data ?? []);
      setSpecialHours(exceptionResult.data ?? []);
    } catch (error) { props.notify(error instanceof Error ? error.message : 'Could not load site schedule.'); }
    finally { finishLoading(); }
  }, [finishLoading, props.notify, props.siteId, selectedSlotDate, slotRangeEnd, specialMonth]);
  useEffect(() => { void refresh(); }, [refresh]);
  const slotWeekEnd = slotRangeEnd;
  const availabilityById = new Map(slotAvailability.map((slot) => [slot.slot_id, slot]));
  const visibleSlots = slots;
  const selectedDateHours = hours[new Date(`${selectedSlotDate}T12:00:00+08:00`).getDay()];
  const slotBooked = (slot: Record<string, any>) => Math.max(0, Number(slot.capacity) - (availabilityById.get(slot.id)?.remaining_capacity ?? Number(slot.capacity)));

  const changeHour = (weekday: number, change: Partial<Hour>) => setHours((current) =>
    current.map((row) => row.weekday === weekday ? { ...row, ...change } : row));
  const applyHoursTemplate = (days: number[]) => {
    const next = applyOperatingHoursTemplate(hours, days);
    if (!next) { props.notify('Set opening and closing hours on an open day first.'); return; }
    setHours(next);
  };
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
    const booked = slots.find((slot) => slot.id === editingSlotId);
    if (editingSlotId && booked && (slotForm.date !== booked.slot_date || slotForm.starts_at !== String(booked.starts_at).slice(0, 5) || slotForm.ends_at !== String(booked.ends_at).slice(0, 5)) && slotBooked(booked) > 0) {
      props.notify('This slot has reservations. Keep its date and time; handle affected bookings before moving it.'); return;
    }
    if (editingSlotId && booked && Number(slotForm.capacity) < slotBooked(booked)) { props.notify('Capacity cannot be lower than the reserved visitor count.'); return; }
    setSaving(true);
    try {
      const query = db().from('site_slots');
      const { error } = editingSlotId
        ? await query.update({ slot_date: slotForm.date, starts_at: slotForm.starts_at, ends_at: slotForm.ends_at, capacity: Number(slotForm.capacity) }).eq('id', editingSlotId)
        : await query.insert({ site_id: props.siteId, slot_date: slotForm.date, starts_at: slotForm.starts_at, ends_at: slotForm.ends_at, capacity: Number(slotForm.capacity), created_by: props.user?.id });
      if (error) throw error;
      props.notify(editingSlotId ? 'Visit slot updated.' : 'Visit slot added. Booking requests check its remaining capacity.');
      setSlotModalOpen(false); setEditingSlotId('');
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
      setDateEditor('');
      await refresh();
    } catch (error) { props.notify(error instanceof Error ? error.message : 'Could not add the closure.'); }
    finally { setSaving(false); }
  };
  const saveSpecialHours = async (event: FormEvent) => {
    event.preventDefault();
    if (!props.siteId || !specialForm.reason.trim() || (!specialForm.is_closed
      && (!specialForm.opens_at || !specialForm.closes_at || specialForm.closes_at <= specialForm.opens_at))) {
      props.notify('Enter a reason and valid special operating hours.'); return;
    }
    setSaving(true);
    try {
      const { error } = await db().from('site_operating_exceptions').upsert({
        site_id: props.siteId, exception_date: specialForm.date,
        opens_at: specialForm.is_closed ? null : specialForm.opens_at,
        closes_at: specialForm.is_closed ? null : specialForm.closes_at,
        is_closed: specialForm.is_closed, reason: specialForm.reason.trim(),
      }, { onConflict: 'site_id,exception_date' });
      if (error) throw error;
      props.notify('Special operating hours saved.');
      setSpecialForm({ date: phToday(), opens_at: '', closes_at: '', is_closed: false, reason: '' });
      setDateEditor('');
      await refresh();
    } catch (error) { props.notify(error instanceof Error ? error.message : 'Could not save special hours.'); }
    finally { setSaving(false); }
  };
  const toggleSlot = async (slot: Record<string, any>) => {
    const booked = slotBooked(slot);
    if (slot.status === 'open' && booked > 0 && !window.confirm(`${booked} visitor(s) have reservations for this slot. Close it only after arranging the affected bookings. Continue?`)) return;
    const next = slot.status === 'open' ? 'closed' : 'open';
    const { error } = await db().from('site_slots').update({ status: next }).eq('id', slot.id);
    if (error) props.notify(error.message);
    else { props.notify('Slot status updated.'); await refresh(); }
  };
  const generateSlots = async () => {
    const exception = specialHours.find((row) => row.exception_date === selectedSlotDate);
    const hoursForDate = exception ? exception.is_closed ? null : exception : selectedDateHours && !selectedDateHours.is_closed ? selectedDateHours : null;
    if (!props.siteId || !hoursForDate?.opens_at || !hoursForDate?.closes_at) { props.notify('No operating hours are configured for this date.'); return; }
    const duration = Number(slotDuration), capacity = Number(slotForm.capacity);
    if (!Number.isInteger(duration) || duration < 15 || duration > 480 || !Number.isInteger(capacity) || capacity < 1) { props.notify('Enter a slot duration from 15 to 480 minutes and a valid capacity.'); return; }
    const start = Number(hoursForDate.opens_at.slice(0, 2)) * 60 + Number(hoursForDate.opens_at.slice(3, 5));
    const end = Number(hoursForDate.closes_at.slice(0, 2)) * 60 + Number(hoursForDate.closes_at.slice(3, 5));
    const proposed = [];
    for (let minute = start; minute + duration <= end; minute += duration) {
      const time = (value: number) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}:00`;
      proposed.push({ site_id: props.siteId, slot_date: selectedSlotDate, starts_at: time(minute), ends_at: time(minute + duration), capacity, created_by: props.user?.id });
    }
    if (!proposed.length) { props.notify('Operating hours are shorter than the selected slot duration.'); return; }
    const existing = slots.filter((slot) => slot.slot_date === selectedSlotDate);
    if (proposed.some((candidate) => existing.some((slot) => candidate.starts_at < slot.ends_at && candidate.ends_at > slot.starts_at))) { props.notify('Existing slots overlap this generated schedule. No slots were added.'); return; }
    setSaving(true);
    try {
      const { error } = await db().from('site_slots').insert(proposed);
      if (error) throw error;
      props.notify(`${proposed.length} visit slots generated.`); setSlotModalOpen(false); await refresh();
    } catch (error) { props.notify(error instanceof Error ? error.message : 'Could not generate visit slots.'); }
    finally { setSaving(false); }
  };
  const saveDailyCapacity = async (event: FormEvent) => {
    event.preventDefault();
    if (!site || !props.user) return;
    const value = dailyCapacity.trim() ? Number(dailyCapacity) : null;
    if (value !== null && (!Number.isInteger(value) || value < 1 || value > 100000)) {
      props.notify('Enter a whole-number daily booking limit from 1 to 100000, or leave blank.'); return;
    }
    setSaving(true);
    try {
      const { error } = await db().from('site_settings').upsert({ site_id: site.id, daily_capacity: value, updated_by: props.user.id }, { onConflict: 'site_id' });
      if (error) throw error;
      props.notify('Daily booking limit saved.');
      props.refresh();
    } catch (error) { props.notify(error instanceof Error ? error.message : 'Could not save the daily booking limit.'); }
    finally { setSaving(false); }
  };
  const hoursDirty = JSON.stringify(hours) !== JSON.stringify(savedHours);
  const openDays = hours.filter((hour) => !hour.is_closed);
  const regularSchedules = [...new Set(openDays.map((hour) => `${hour.opens_at}|${hour.closes_at}`))];
  const regularHoursLabel = regularSchedules.length === 1
    ? `${timeLabel(openDays[0].opens_at)} – ${timeLabel(openDays[0].closes_at)}`
    : regularSchedules.length ? 'Varies by day' : 'No open days';
  const [calendarYear, calendarMonth] = specialMonth.slice(0, 7).split('-').map(Number);
  const calendarOffset = new Date(Date.UTC(calendarYear, calendarMonth - 1, 1)).getUTCDay();
  const calendarDayCount = new Date(Date.UTC(calendarYear, calendarMonth, 0)).getUTCDate();
  const calendarDates: Array<string | null> = [...Array(calendarOffset).fill(null), ...Array.from({ length: calendarDayCount }, (_, index) =>
    `${specialMonth.slice(0, 7)}-${String(index + 1).padStart(2, '0')}`)];
  const selectSpecialDate = (date: string) => {
    setSpecialMonth(scheduleMonthStart(date));
    setSelectedSpecialDate(date);
    const existing = specialHours.find((item) => item.exception_date === date);
    setSpecialForm(existing ? {
      date, opens_at: String(existing.opens_at ?? '').slice(0, 5), closes_at: String(existing.closes_at ?? '').slice(0, 5),
      is_closed: Boolean(existing.is_closed), reason: String(existing.reason ?? ''),
    } : { date, opens_at: '', closes_at: '', is_closed: false, reason: '' });
    setClosureForm((current) => ({ ...current, starts_on: date, ends_on: date }));
  };
  return <section className={props.embedded ? 'schedule-embedded' : 'dashboard-page section-wrap'}>
    {!props.embedded && <div className="dash-header"><div><span className="eyebrow"><span className="eyebrow-line"/> SITE ADMINISTRATION</span><h1>Hours that work <em>for you.</em></h1><p>Manage weekly and special operating hours, visit capacity, and closures{site ? ' for ' + site.name : ''}.</p></div>
      <div className="header-actions"><SiteSelector {...props}/><button className="btn btn-outline" onClick={() => void refresh()}><RefreshCw size={15}/></button></div></div>}
    {!props.siteId && <div className="empty-card"><MapPin size={28}/><h3>No assigned destination</h3><p>Ask the Tourism Office to assign a site administrator account.</p></div>}
    {!!props.siteId && <>{showHours && <><div className="operating-hours-layout">
      <section className="schedule-card weekly-hours-card"><div className="schedule-head"><span><small>PHILIPPINE TIME · ASIA/MANILA</small><h3>Weekly Operating Hours</h3><p>Set regular opening and closing times for each day.</p></span></div>
        <div className="operating-hours-shortcuts"><button type="button" className="btn btn-outline" disabled={loading || saving} onClick={() => applyHoursTemplate([1, 2, 3, 4, 5])}>Apply to Weekdays</button><button type="button" className="btn btn-outline" disabled={loading || saving} onClick={() => applyHoursTemplate([0, 1, 2, 3, 4, 5, 6])}>Apply to All 7 Days</button></div>
        <div className="weekly-hours-list" aria-label="Weekly operating hours">{loading ? <div className="empty-inline" role="status">Loading current operating hours…</div> : hours.map((hour) => <div className="weekly-hours-row" key={hour.weekday}>
          <b>{dayNames[hour.weekday]}</b><span className={'weekly-hours-status' + (hour.is_closed ? ' closed' : '')}>{hour.is_closed ? 'Closed' : 'Open'}</span>
          {hour.is_closed ? <span className="weekly-hours-closed">No operating hours</span> : <div className="weekly-hours-range"><TimePicker value={hour.opens_at} onChange={(opens_at) => changeHour(hour.weekday, { opens_at })}/><span>–</span><TimePicker value={hour.closes_at} onChange={(closes_at) => changeHour(hour.weekday, { closes_at })}/></div>}
          <label className="weekly-hours-switch"><input type="checkbox" aria-label={`${hour.is_closed ? 'Open' : 'Close'} ${dayNames[hour.weekday]}`} checked={!hour.is_closed} onChange={(event) => changeHour(hour.weekday, { is_closed: !event.target.checked })}/><span/></label>
        </div>)}</div>
      </section>
      <div className="operating-hours-side">
        <section className="schedule-card special-dates-card"><header className="schedule-head"><span><small>DATE OVERRIDES · ASIA/MANILA</small><h3>Special Dates & Closures</h3><p>Set custom hours or close the destination on selected dates.</p></span><CalendarDays size={20}/></header>
          <div className="special-dates-layout"><div className="special-calendar">
            <div className="special-calendar-month"><button type="button" className="btn btn-outline" aria-label="Previous month" onClick={() => selectSpecialDate(shiftScheduleMonth(specialMonth, -1))}><ChevronLeft size={17}/></button><h4>{scheduleMonthLabel(specialMonth)}</h4><button type="button" className="btn btn-outline" aria-label="Next month" onClick={() => selectSpecialDate(shiftScheduleMonth(specialMonth, 1))}><ChevronRight size={17}/></button></div>
            <div className="special-calendar-weekdays">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span key={day}>{day}</span>)}</div>
            <div className="special-calendar-grid">{calendarDates.map((date, index) => {
              if (!date) return <span key={`blank-${index}`} aria-hidden="true"/>;
              const special = specialHours.find((item) => item.exception_date === date);
              const closure = closures.find((item) => date >= item.starts_on && date <= item.ends_on);
              const marker = special ? special.is_closed ? 'closed' : 'special' : closure ? 'closed' : '';
              return <button key={date} type="button" className={[date === selectedSpecialDate ? 'selected' : '', marker].filter(Boolean).join(' ')} aria-pressed={date === selectedSpecialDate}
                aria-label={`${dateLabel(date)}${special ? special.is_closed ? ', closed' : ', special hours' : closure ? ', temporary closure' : ''}`}
                onClick={() => selectSpecialDate(date)}><span>{Number(date.slice(-2))}</span>{marker && <i aria-hidden="true"/>}</button>;
            })}</div>
          </div><div className="special-date-events">
            {loading ? <div className="empty-inline" role="status">Loading special dates…</div> : <>
              {specialHours.map((item) => <article key={item.id} className={item.is_closed ? 'closed' : ''}><span className="special-event-icon"><CalendarClock size={17}/></span><span><b>{dateLabel(item.exception_date)}</b><small>{item.is_closed ? 'Closed' : 'Special hours · ' + timeLabel(item.opens_at) + ' – ' + timeLabel(item.closes_at)}</small></span><button type="button" className="link-btn" aria-label={`Remove special hours for ${dateLabel(item.exception_date)}`} onClick={async () => { const { error } = await db().from('site_operating_exceptions').delete().eq('id', item.id); if (error) props.notify(error.message); else await refresh(); }}>Remove</button></article>)}
              {closures.map((item) => <article key={item.id} className="closed"><span className="special-event-icon"><CalendarDays size={17}/></span><span><b>{dateLabel(item.starts_on)}{item.ends_on !== item.starts_on ? ` – ${dateLabel(item.ends_on)}` : ''}</b><small>Temporary closure · {item.reason}</small></span><button type="button" className="link-btn" aria-label={`Remove closure starting ${dateLabel(item.starts_on)}`} onClick={async () => { const { error } = await db().from('site_closures').delete().eq('id', item.id); if (error) props.notify(error.message); else await refresh(); }}>Remove</button></article>)}
              {!specialHours.length && !closures.length && <div className="empty-inline">No special dates or closures this month.</div>}
            </>}
            <div className="special-date-actions"><button type="button" className="btn btn-outline" onClick={() => { const next = dateEditor === 'special' ? '' : 'special'; setDateEditor(next); selectSpecialDate(selectedSpecialDate); }}><Plus size={15}/> Add Special Date</button><button type="button" className="btn btn-outline" onClick={() => { const next = dateEditor === 'closure' ? '' : 'closure'; setDateEditor(next); selectSpecialDate(selectedSpecialDate); }}><Plus size={15}/> Add Temporary Closure</button></div>
          </div></div>
          {dateEditor === 'special' && <form className="special-date-form" onSubmit={(event) => void saveSpecialHours(event)}><h4>Special date details</h4>
            <label>Date<input type="date" min={phToday()} value={specialForm.date} onChange={(event) => { setSpecialForm({ ...specialForm, date: event.target.value }); setSelectedSpecialDate(event.target.value); setSpecialMonth(scheduleMonthStart(event.target.value)); }} required/></label>
            {!specialForm.is_closed && <><label>Opens<TimePicker value={specialForm.opens_at} onChange={(opens_at) => setSpecialForm({ ...specialForm, opens_at })} required/></label><label>Closes<TimePicker value={specialForm.closes_at} onChange={(closes_at) => setSpecialForm({ ...specialForm, closes_at })} required/></label></>}
            <label className="special-hours-closed"><input type="checkbox" checked={specialForm.is_closed} onChange={(event) => setSpecialForm({ ...specialForm, is_closed: event.target.checked })}/> Closed all day</label>
            <label>Reason<input value={specialForm.reason} onChange={(event) => setSpecialForm({ ...specialForm, reason: event.target.value })} maxLength={500} required/></label>
            <button className="btn btn-primary" disabled={loading || saving}>{saving ? 'Saving…' : 'Save Special Date'} <Check size={15}/></button></form>}
          {dateEditor === 'closure' && <form className="special-date-form" onSubmit={(event) => void addClosure(event)}><h4>Temporary closure details</h4>
            <label>From<input type="date" min={phToday()} value={closureForm.starts_on} onChange={(event) => setClosureForm({ ...closureForm, starts_on: event.target.value, ends_on: closureForm.ends_on < event.target.value ? event.target.value : closureForm.ends_on })} required/></label>
            <label>Through<input type="date" min={closureForm.starts_on} value={closureForm.ends_on} onChange={(event) => setClosureForm({ ...closureForm, ends_on: event.target.value })} required/></label>
            <label>Reason<input value={closureForm.reason} onChange={(event) => setClosureForm({ ...closureForm, reason: event.target.value })} maxLength={500} required/></label>
            <button className="btn btn-primary" disabled={loading || saving}>{saving ? 'Saving…' : 'Save Closure'} <Check size={15}/></button></form>}
        </section>
        <section className="schedule-card schedule-summary"><div className="schedule-head"><span><small>WEEKLY SCHEDULE</small><h3>Schedule Summary</h3></span><CalendarDays size={19}/></div>
          <div className="schedule-summary-metrics"><div><CalendarClock size={19}/><span><small>Operating Days</small><b>{openDays.length} days / week</b></span></div><div><CalendarClock size={19}/><span><small>Regular Hours</small><b>{regularHoursLabel}</b></span></div></div>
        </section>
      </div>
    </div><div className="schedule-settings-actions"><button type="button" className="btn btn-outline" disabled={loading || saving || !hoursDirty} onClick={() => setHours(savedHours)}>Discard Changes</button><button type="button" className="btn btn-primary" disabled={loading || saving || !hoursDirty} onClick={() => void saveHours()}>{saving ? 'Saving…' : 'Save Operating Hours'} <Check size={15}/></button></div></>}{showCapacity && <>
      {(props.role === 'tourism_office' || props.role === 'site_admin') && site && <div className="schedule-card"><div className="schedule-head"><span><small>VISITOR BOOKING AVAILABILITY</small><h3>Daily booking limit</h3></span></div>
        <form className="slot-admin-form" onSubmit={(event) => void saveDailyCapacity(event)}><label>Visitors per day<input type="number" min="1" max="100000" step="1" value={dailyCapacity} onChange={(event) => setDailyCapacity(event.target.value)} placeholder="No configured limit"/></label><span className="field-hint">Shared across this destination’s booking slots. Leave blank for no configured daily limit.</span><button className="btn btn-primary" disabled={loading || saving}>{saving ? 'Saving…' : 'Save daily limit'} <Check size={15}/></button></form>
      </div>}
      <section className="schedule-card slot-calendar"><header className="slot-calendar-head"><span><small>DATE-SPECIFIC CAPACITY</small><h3>Capacity & Booking Slots</h3><p>Manage visitor availability by date and time.</p></span><div><button className={'btn btn-outline' + (slotView === 'day' ? ' selected' : '')} onClick={() => setSlotView('day')}>Day</button><button className={'btn btn-outline' + (slotView === 'week' ? ' selected' : '')} onClick={() => setSlotView('week')}>Week</button></div></header>
        <div className="slot-date-bar"><label>Selected date<input type="date" min={phToday()} value={selectedSlotDate} onChange={(event) => { setSelectedSlotDate(event.target.value); setSlotForm((current) => ({ ...current, date: event.target.value })); }}/></label><strong>{dateLabel(selectedSlotDate)}{slotView === 'week' ? ` – ${dateLabel(slotWeekEnd)}` : ''}</strong><div><button className="btn btn-outline" onClick={() => { const shift = slotView === 'day' ? 1 : 7; setSelectedSlotDate(new Date(Date.parse(`${selectedSlotDate}T12:00:00+08:00`) + shift * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })); }}>Next {slotView}</button></div></div>
        <div className="slot-summary-grid"><article><b>{visibleSlots.length}</b><small>Time slots</small></article><article><b>{visibleSlots.filter((slot) => slot.status === 'open').reduce((sum, slot) => sum + Number(slot.capacity), 0)}</b><small>Open capacity</small></article><article><b>{visibleSlots.filter((slot) => slot.status === 'open').reduce((sum, slot) => sum + (availabilityById.get(slot.id)?.remaining_capacity ?? Number(slot.capacity)), 0)}</b><small>Spaces remaining</small></article><article><b>{visibleSlots.filter((slot) => slot.status === 'closed').length}</b><small>Closed slots</small></article></div>
        <div className="slot-calendar-actions"><button className="btn btn-primary" onClick={() => { setEditingSlotId(''); setSlotForm({ date: selectedSlotDate, starts_at: '', ends_at: '', capacity: dailyCapacity || '' }); setSlotModalOpen(true); }}><Plus size={15}/> Add slot</button><label>Duration<select value={slotDuration} onChange={(event) => setSlotDuration(event.target.value)}><option value="30">30 minutes</option><option value="60">1 hour</option><option value="90">90 minutes</option><option value="120">2 hours</option></select></label><button className="btn btn-outline" onClick={() => void generateSlots()} disabled={saving || loading}>Generate daily slots</button></div>
        {loading ? <div className="empty-inline" role="status">Loading slots…</div> : !visibleSlots.length ? <div className="empty-inline">No slots for this {slotView}. Add a slot or generate from operating hours.</div> : <div className="table-card"><table><thead><tr>{slotView === 'week' && <th>Date</th>}<th>Time</th><th>Booked / Capacity</th><th>Availability</th><th>Status</th><th>Actions</th></tr></thead><tbody>{visibleSlots.map((slot) => { const availability = availabilityById.get(slot.id); const booked = slotBooked(slot); const remaining = availability?.remaining_capacity ?? Number(slot.capacity); return <tr key={slot.id}>{slotView === 'week' && <td>{dateLabel(slot.slot_date)}</td>}<td>{timeLabel(slot.starts_at)} – {timeLabel(slot.ends_at)}</td><td>{booked} / {slot.capacity}<small>{remaining} remaining</small></td><td><div className="slot-availability-track" role="progressbar" aria-label={`${booked} of ${slot.capacity} visitors booked`} aria-valuemin={0} aria-valuemax={Number(slot.capacity)} aria-valuenow={booked}><i style={{ width: `${Math.min(100, booked / Math.max(1, Number(slot.capacity)) * 100)}%` }}/></div></td><td><span className={slot.status === 'open' ? 'status-tag paid' : 'status-tag'}>{slot.status}</span></td><td><button className="link-btn" onClick={() => { setEditingSlotId(slot.id); setSlotForm({ date: slot.slot_date, starts_at: String(slot.starts_at).slice(0, 5), ends_at: String(slot.ends_at).slice(0, 5), capacity: String(slot.capacity) }); setSlotModalOpen(true); }}>Edit</button> <button className="link-btn" onClick={() => void toggleSlot(slot)}>{slot.status === 'open' ? 'Close' : 'Reopen'}</button></td></tr>; })}</tbody></table></div>}
      </section>
      {slotModalOpen && <div className="slot-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setSlotModalOpen(false); }}><section className="slot-modal" role="dialog" aria-modal="true" aria-labelledby="slot-modal-title"><header><span><small>{editingSlotId ? 'EDIT SLOT' : 'NEW AVAILABILITY'}</small><h3 id="slot-modal-title">{editingSlotId ? 'Edit visit slot' : 'Add visit slot'}</h3></span><button className="icon-btn" aria-label="Close" onClick={() => setSlotModalOpen(false)}>×</button></header><form className="slot-admin-form" onSubmit={(event) => void addSlot(event)}><label>Date<input type="date" min={phToday()} value={slotForm.date} onChange={(event) => setSlotForm({ ...slotForm, date: event.target.value })} required/></label><label>Starts<TimePicker value={slotForm.starts_at} onChange={(starts_at) => setSlotForm({ ...slotForm, starts_at })} required/></label><label>Ends<TimePicker value={slotForm.ends_at} onChange={(ends_at) => setSlotForm({ ...slotForm, ends_at })} required/></label><label>Capacity<input type="number" min="1" max="100000" value={slotForm.capacity} onChange={(event) => setSlotForm({ ...slotForm, capacity: event.target.value })} required/></label><div className="announcement-form-actions"><button type="button" className="btn btn-outline" onClick={() => setSlotModalOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : editingSlotId ? 'Save changes' : 'Add slot'}</button></div></form></section></div>}
      {site && <CapacityPanel key={site.id} {...props} site={site} canSetApprovedLimit={props.role === 'tourism_office'}/>}
      </>}
    </>}
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
  const [editingStaffId, setEditingStaffId] = useState('');
  const [editStaffName, setEditStaffName] = useState('');
  const [editStaffSiteId, setEditStaffSiteId] = useState('');
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
        db().from('staff_assignments').select('id,profile_id,site_id,staff_role,is_active,profiles!staff_assignments_profile_id_fkey(full_name,email),tourism_sites!staff_assignments_site_id_fkey(name)')
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
    if (props.role === 'tourism_office' || props.role === 'site_admin') {
      try {
        const { data, error } = await db().from('support_requests').select('id,user_id,booking_id,subject,message,status,staff_response,created_at,profiles!support_requests_user_id_fkey(full_name,email),booking:bookings!support_requests_booking_id_fkey(booking_reference,site:tourism_sites!bookings_site_id_fkey(name))')
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
  const saveStaffAssignment = async (assignment: Record<string, any>) => {
    const fullName = editStaffName.trim();
    if (!fullName || fullName.length > 120 || !props.sites.some((site) => site.id === editStaffSiteId)) {
      props.notify('Enter a name and choose a destination.');
      return;
    }
    setActionBusy(true);
    try {
      const { error } = await db().rpc('update_staff_assignment', {
        p_assignment_id: assignment.id, p_full_name: fullName, p_site_id: editStaffSiteId,
      });
      if (error) throw error;
      setEditingStaffId('');
      props.notify('Staff name and destination updated.');
      await refresh();
    } catch (error) { props.notify(error instanceof Error ? error.message : 'Could not update this staff assignment.'); }
    finally { setActionBusy(false); }
  };
  return <section className="dashboard-page section-wrap"><div className="dash-header"><div><span className="eyebrow"><span className="eyebrow-line"/> SITE ADMINISTRATION</span><h1>People & <em>access.</em></h1><p>Manage destination assignments, cancellation requests, and visitor support. Payments are not processed here.</p></div>
    <div className="header-actions">{props.role === 'tourism_office' && <SiteSelector {...props}/>}<button className="btn btn-outline" onClick={() => void refresh()}><RefreshCw size={15}/></button></div></div>
    {props.role === 'site_admin' && <div className="workspace-panel-select"><label>Active destination <SiteSelector {...props}/></label></div>}
    <div className="schedule-card"><div className="schedule-head"><span><small>ROLE-BASED ACCESS</small><h3>Invite a team member</h3></span><Users size={18}/></div>
      <form className="invite-form" onSubmit={(event) => void invite(event)}><label><span>Email address <span className="required-mark" aria-hidden="true">*</span></span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254}/></label>
        <label><span>Staff role <span className="required-mark" aria-hidden="true">*</span></span><select value={inviteRole} onChange={(event) => setInviteRole(event.target.value)}><option value="gatekeeper">Gatekeeper</option>{props.role === 'tourism_office' && <><option value="site_admin">Site administrator</option><option value="tourism_office">Tourism Office</option></>}</select></label>
        {inviteRole !== 'tourism_office' && props.role === 'tourism_office' && <label><span>Destination <span className="required-mark" aria-hidden="true">*</span></span><SiteSelector {...props}/></label>}
        <button className="btn btn-primary" disabled={props.busy || !props.siteId && inviteRole !== 'tourism_office'}>{props.busy ? 'Sending…' : 'Send invitation'} <ArrowRight size={15}/></button>
      </form>
      <div className="table-card"><table><thead><tr><th>Staff member</th><th>Destination</th><th>Role</th><th>Access</th><th/></tr></thead><tbody>
        {!loading && staff.map((assignment) => { const person = Array.isArray(assignment.profiles) ? assignment.profiles[0] : assignment.profiles; const site = Array.isArray(assignment.tourism_sites) ? assignment.tourism_sites[0] : assignment.tourism_sites; const editing = editingStaffId === assignment.id; const canEdit = props.role === 'tourism_office' || assignment.staff_role === 'gatekeeper'; return <tr key={assignment.id}>
          <td>{editing ? <input className="staff-assignment-edit-field" aria-label="Staff name" value={editStaffName} onChange={(event) => setEditStaffName(event.target.value)} maxLength={120}/> : person?.full_name || person?.email || assignment.profile_id}</td>
          <td>{editing ? <select className="staff-assignment-edit-field" aria-label="Destination" value={editStaffSiteId} onChange={(event) => setEditStaffSiteId(event.target.value)}>{props.sites.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select> : site?.name ?? '—'}</td>
          <td>{assignment.staff_role.replace('_', ' ')}</td>
          <td><span className={assignment.is_active ? 'status-tag paid' : 'status-tag'}>{assignment.is_active ? 'Active' : 'Disabled'}</span></td>
          <td>{editing ? <span className="staff-assignment-edit-actions"><button className="link-btn" disabled={actionBusy} onClick={() => void saveStaffAssignment(assignment)}>Save</button><button className="link-btn" disabled={actionBusy} onClick={() => setEditingStaffId('')}>Cancel</button></span> : <>{canEdit && <button className="link-btn" disabled={actionBusy} onClick={() => { setEditingStaffId(assignment.id); setEditStaffName(person?.full_name ?? ''); setEditStaffSiteId(assignment.site_id); }}><Pencil size={13}/> Edit</button>} {assignment.is_active && canEdit && <button className="link-btn" disabled={actionBusy} onClick={() => void disableAssignment(assignment)}>Disable</button>}</>}</td>
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
      {site && <><div className="image-manager-grid">{site.images.map((image) => <div className="managed-image" key={image.id}><img src={image.public_url} alt={image.alt_text || site.name}/><span>{image.alt_text || site.name}</span><button type="button" aria-label="Remove image" title={site.status === 'published' && site.images.length <= 1 ? 'Published destinations must keep at least one photo' : 'Remove image'} disabled={site.status === 'published' && site.images.length <= 1} onClick={() => void remove(image)}><X size={14}/></button></div>)}
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
      <span aria-live="polite">{site?.name ?? 'No assigned destination'} · {visitDate ? dateLabel(visitDate) : 'No date selected'} · {loading ? 'Loading…' : refreshing ? 'Updating records…' : resultsCurrent ? `${total} visitors` : 'Showing previous results'}</span></div>
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
  const [paymentMetrics, setPaymentMetrics] = useState<Array<Record<string, any>>>([]);
  const [month, setMonth] = useState(phToday().slice(0, 7));
  const siteIds = props.role === 'tourism_office' ? props.sites.map((site) => site.id) : [props.siteId].filter(Boolean);
  const reportKey = `${props.user?.id ?? 'staff'}:${props.role}:${siteIds.join(',')}:${month}`;
  const [loading, finishLoading] = useSilentLoad(reportKey);
  const [loadedReportKey, setLoadedReportKey] = useState('');
  const reportCurrent = loadedReportKey === reportKey;
  const refresh = useCallback(async () => {
    const range = monthDateRange(month);
    if (!siteIds.length || !range) { setMetrics([]); setPaymentMetrics([]); setLoadedReportKey(reportKey); finishLoading(); return; }
    const { start, end } = range;
    try {
      let metricQuery = props.role === 'gatekeeper'
        ? db().from('site_visit_daily_metrics').select('site_id,report_date,booking_count,pending_booking_count,confirmed_booking_count,cancelled_booking_count,expected_visitor_count,adult_count,child_count,checked_in_visitor_count')
        : db().from('booking_daily_metrics').select('site_id,report_date,booking_count,visitor_count,walk_in_count,online_count');
      metricQuery = metricQuery.gte('report_date', start).lte('report_date', end);
      let paymentQuery = db().from('booking_payment_daily_metrics').select('site_id,report_date,online_pending_count,online_paid_count,onsite_pending_count,onsite_paid_count,failed_or_expired_count')
        .gte('report_date', start).lte('report_date', end);
      if (props.role !== 'tourism_office') {
        metricQuery = metricQuery.eq('site_id', props.siteId);
        paymentQuery = paymentQuery.eq('site_id', props.siteId);
      } else if (siteIds.length) {
        metricQuery = metricQuery.in('site_id', siteIds);
        paymentQuery = paymentQuery.in('site_id', siteIds);
      }
      const [metricResult, paymentResult] = await Promise.all([metricQuery.order('report_date'), paymentQuery]);
      if (metricResult.error) throw metricResult.error;
      if (paymentResult.error) throw paymentResult.error;
      setMetrics(metricResult.data ?? []);
      setPaymentMetrics(paymentResult.data ?? []);
      setLoadedReportKey(reportKey);
    } catch (error) { props.notify(error instanceof Error ? error.message : 'Could not load the report.'); }
    finally { finishLoading(); }
  }, [finishLoading, month, props.notify, props.role, props.siteId, reportKey, siteIds.join(',')]);
  useEffect(() => { void refresh(); }, [refresh]);
  const summary = (key: string) => metrics.reduce((sum, row) => sum + Number(row[key] ?? 0), 0);
  const paymentSummary = (key: string) => paymentMetrics.reduce((sum, row) => sum + Number(row[key] ?? 0), 0);
  const siteName = (id: string) => props.sites.find((site) => site.id === id)?.name ?? id;
  const gatekeeperStats = props.role === 'gatekeeper';
  return <section className="dashboard-page section-wrap"><div className="dash-header"><div><span className="eyebrow"><span className="eyebrow-line"/> {props.role === 'tourism_office' ? 'TOURISM OFFICE · NETWORK REPORT' : gatekeeperStats ? 'GATEKEEPER · DESTINATION REPORT' : 'SITE ADMIN · DESTINATION REPORT'}</span>
    <h1>{gatekeeperStats ? <>Track visitor <em>trends.</em></> : <>See the recorded <em>picture.</em></>}</h1><p>{gatekeeperStats ? 'Visit-date counts for your assigned destination only.' : 'Activity counts come from booking records. Fee amounts are estimates; payments are not processed here.'}</p></div>
    <div className="header-actions"><label className="month-picker">Month<input type="month" value={month} onChange={(event) => { if (event.target.value) setMonth(event.target.value); }}/></label>
      {props.role === 'tourism_office' && <SiteSelector {...props}/>}<button className="btn btn-outline" disabled={loading || !reportCurrent || !metrics.length} onClick={() => void exportCsv('iliguide-report-' + month + '.csv', metrics.map((row) => ({ ...row, site_name: siteName(row.site_id) })))}><ArrowDownToLine size={15}/> Export</button></div></div>
    <div className="stats-grid">{(gatekeeperStats
      ? [[summary('expected_visitor_count').toLocaleString(), 'Expected visitors'], [summary('checked_in_visitor_count').toLocaleString(), 'Checked in'], [summary('adult_count').toLocaleString(), 'Adults'], [summary('child_count').toLocaleString(), 'Children']]
      : [[summary('visitor_count').toLocaleString(), 'Visitors'], [summary('online_count').toLocaleString(), 'Online bookings'], [summary('walk_in_count').toLocaleString(), 'Walk-ins'], [paymentSummary('online_paid_count').toLocaleString(), 'Online payments paid'], [paymentSummary('onsite_paid_count').toLocaleString(), 'Onsite payments collected'], [paymentSummary('online_pending_count').toLocaleString(), 'Online payments pending'], [paymentSummary('onsite_pending_count').toLocaleString(), 'Onsite payments due'], [paymentSummary('failed_or_expired_count').toLocaleString(), 'Failed or expired']])
      .map(([value, label]) => <div key={label}><b>{loading || !reportCurrent ? '…' : value}</b><small>{label}</small></div>)}</div>
    <div className="report-grid" style={{ gridTemplateColumns: '1fr' }}><div className="chart-card"><div className="card-heading"><span><small>{gatekeeperStats ? 'VISIT DATE · ' + month : 'BY DESTINATION · ' + month}</small><h3>{gatekeeperStats ? 'Daily visitor counts' : 'Recorded activity'}</h3></span></div>
      {!reportCurrent && <div className="empty-inline">{loading ? 'Loading report…' : 'Report data for this period is unavailable.'}</div>}
      {reportCurrent && !loading && !metrics.length && <div className="empty-inline">No booking records for this reporting period.</div>}
       <div className="table-card"><table><thead><tr>{gatekeeperStats
         ? <><th>Date</th><th>Reservations</th><th>Expected</th><th>Checked in</th><th>Adults</th><th>Children</th><th>Awaiting</th><th>Confirmed</th><th>Cancelled</th></>
         : <><th>Date</th><th>Destination</th><th>Visitors</th><th>Online</th><th>Walk-in</th></>}</tr></thead>
         <tbody>{reportCurrent && !loading && metrics.map((row, index) => <tr key={row.site_id + row.report_date + index}>{gatekeeperStats
           ? <><td>{dateLabel(row.report_date)}</td><td>{row.booking_count}</td><td>{row.expected_visitor_count}</td><td>{row.checked_in_visitor_count}</td><td>{row.adult_count}</td><td>{row.child_count}</td><td>{row.pending_booking_count}</td><td>{row.confirmed_booking_count}</td><td>{row.cancelled_booking_count}</td></>
           : <><td>{dateLabel(row.report_date)}</td><td>{siteName(row.site_id)}</td><td>{row.visitor_count}</td><td>{row.online_count}</td><td>{row.walk_in_count}</td></>}</tr>)}</tbody></table></div>
    </div></div>
    <p className="report-note"><ShieldCheck size={15}/> Reports are scoped by row level security. A zero count means no matching rows were recorded.</p>
  </section>;
}

function ActivityPage(props: Props) {
  const [events, setEvents] = useState<Array<Record<string, any>>>([]);
  const site = props.role === 'gatekeeper' ? assignedGatekeeperSite(props) : props.sites.find((item) => item.id === props.siteId);
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
    <h1>Recorded <em>activity.</em></h1><p>Booking and check-in changes recorded for this destination.</p></div>
    {props.role !== 'gatekeeper' && <div className="header-actions"><SiteSelector {...props}/></div>}</div>
    {!site && <div className="empty-inline">{props.role === 'gatekeeper' ? 'No single destination assignment is available.' : 'Select a destination to view its recorded activity.'}</div>}
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
  adult_fee: string; child_fee: string; pwd_discount_percent: string;
  fee_information_confirmed: boolean; max_per_booking: string; cancellation_cutoff_hours: string;
};
type PendingSitePhoto = { file: File; preview: string };
const emptyDraft = (): SiteDraft => ({ name: '', category: '', description: '', address: '', latitude: '', longitude: '', adult_fee: '', child_fee: '', pwd_discount_percent: '0', fee_information_confirmed: false, max_per_booking: '20', cancellation_cutoff_hours: '24' });
function SitesPage(props: Props) {
  const [draft, setDraft] = useState<SiteDraft>(emptyDraft());
  const [photos, setPhotos] = useState<PendingSitePhoto[]>([]);
  const previewUrls = useRef(new Set<string>());
  const [editing, setEditing] = useState('');
  const [addingDestination, setAddingDestination] = useState(false);
  const [editorTab, setEditorTab] = useState<'overview' | 'capacity' | 'photos' | 'management' | 'staff'>('overview');
  const [days, setDays] = useState<number[]>([]);
  const [opens, setOpens] = useState('');
  const [closes, setCloses] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusBusy, setStatusBusy] = useState('');
  const [siteStaff, setSiteStaff] = useState<Array<{ id: string; staff_role: string; name: string; email: string | null }>>([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const site = props.sites.find((item) => item.id === props.siteId) ?? null;

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
    setAddingDestination(false);
    setEditing(site.id);
    setEditorTab('overview');
    props.setSiteId(site.id);
    setDraft({
      name: site.name, category: site.category, description: site.description, address: site.address,
      latitude: site.latitude == null ? '' : String(site.latitude), longitude: site.longitude == null ? '' : String(site.longitude),
      adult_fee: String(site.adult_fee), child_fee: String(site.child_fee),
      pwd_discount_percent: String(site.pwd_discount_percent),
      fee_information_confirmed: site.fee_information_confirmed,
      max_per_booking: String(site.max_per_booking), cancellation_cutoff_hours: String(site.cancellation_cutoff_hours),
    });
  };
  useEffect(() => {
    if (site && !editing && !addingDestination) beginEdit(site);
  }, [site?.id, editing, addingDestination]);
  useEffect(() => {
    if (editorTab !== 'staff' || !site) return;
    let active = true;
    setStaffLoading(true); setSiteStaff([]);
    void (async () => {
      try {
        const { data, error } = await db().from('staff_assignments')
          .select('id,staff_role,profiles!staff_assignments_profile_id_fkey(full_name,email)')
          .eq('site_id', site.id).eq('is_active', true).order('created_at');
        if (error) throw error;
        if (active) setSiteStaff((data ?? []).map((row: any) => {
          const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
          return { id: row.id, staff_role: row.staff_role, name: profile?.full_name || profile?.email || 'Staff member', email: profile?.email ?? null };
        }));
      } catch (error) { if (active) props.notify(error instanceof Error ? error.message : 'Could not load destination staff.'); }
      finally { if (active) setStaffLoading(false); }
    })();
    return () => { active = false; };
  }, [editorTab, site?.id, props.notify]);
  const slugFromName = (name: string) => name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const saveSite = async (event: FormEvent) => {
    event.preventDefault();
    if (!props.user) { props.notify('Sign in to manage this destination.'); return; }
    if (!editing && props.role !== 'tourism_office') { props.notify('Only Tourism Office can create destinations.'); return; }
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
    if (!Number.isFinite(adultFee) || adultFee < 0 || !Number.isFinite(childFee) || childFee < 0 ||
      !Number.isInteger(maxPerBooking) || maxPerBooking < 1 || maxPerBooking > 500 ||
      !Number.isFinite(pwdDiscount) || pwdDiscount < 0 || pwdDiscount > 100) {
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
      if (!editing) {
        releasePhotos(photos); setPhotos([]); setDraft(emptyDraft()); setEditing('');
        setAddingDestination(false); setEditorTab('overview'); setDays([]); setOpens(''); setCloses('');
      }
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

  const editorTabs: Array<{ id: typeof editorTab; label: string }> = [
    { id: 'overview', label: 'Overview' }, { id: 'capacity', label: 'Capacity & Hours' }, { id: 'photos', label: 'Photos & Media' },
    ...(props.role === 'tourism_office' ? [{ id: 'management' as const, label: 'Management' }] : []),
    { id: 'staff', label: 'Staff & Assignments' },
  ];
  const visibleTabs = addingDestination ? editorTabs.slice(0, 3) : editorTabs;
  const overviewFields = () => <>
    <label>Destination name<input required value={draft.name} onChange={(event) => change('name', event.target.value)} maxLength={160}/></label>
    <label>Category<input required value={draft.category} onChange={(event) => change('category', event.target.value)} maxLength={80} placeholder="Waterfall, spring, heritage site…"/></label>
    <label>Location or address<input value={draft.address} onChange={(event) => change('address', event.target.value)} maxLength={500}/></label>
    <div className="form-two"><label>Map latitude<input type="number" min="-90" max="90" step="any" value={draft.latitude} onChange={(event) => change('latitude', event.target.value)} placeholder="e.g. 8.23"/></label>
      <label>Map longitude<input type="number" min="-180" max="180" step="any" value={draft.longitude} onChange={(event) => change('longitude', event.target.value)} placeholder="e.g. 124.24"/></label></div>
    <p className="field-hint">Optional. Enter a verified coordinate pair to place this destination on the map.</p>
    <label>Description<textarea value={draft.description} onChange={(event) => change('description', event.target.value)} maxLength={5000} rows={4}/></label>
  </>;
  const capacityFields = () => <>
    <div className="form-two"><label>Adult fee (PHP)<input type="number" min="0" step="0.01" required value={draft.adult_fee} onChange={(event) => change('adult_fee', event.target.value)}/></label>
      <label>Child fee (PHP)<input type="number" min="0" step="0.01" required value={draft.child_fee} onChange={(event) => change('child_fee', event.target.value)}/></label></div>
    <label>PWD discount (%)<input type="number" min="0" max="100" step="0.01" required value={draft.pwd_discount_percent} onChange={(event) => change('pwd_discount_percent', event.target.value)}/></label>
    <small className="field-hint">Set a PWD discount only when adult and child admission fees match.</small>
    <label className="checkbox-field"><input type="checkbox" checked={draft.fee_information_confirmed} onChange={(event) => setDraft((current) => ({ ...current, fee_information_confirmed: event.target.checked }))}/> I confirm these are the destination’s current admission fees.</label>
    <div className="form-two"><label>Max visitors / booking<input type="number" min="1" max="500" required value={draft.max_per_booking} onChange={(event) => change('max_per_booking', event.target.value)}/></label>
      <label>Cancellation cutoff (hours)<input type="number" min="0" max="8760" required value={draft.cancellation_cutoff_hours} onChange={(event) => change('cancellation_cutoff_hours', event.target.value)}/></label></div>
    {addingDestination ? <>
      <fieldset className="operating-days"><legend>Default operating days</legend>{dayNames.map((day, weekday) => <label key={day}><input type="checkbox" checked={days.includes(weekday)} onChange={(event) => setDays(event.target.checked ? [...days, weekday] : days.filter((value) => value !== weekday))}/>{day.slice(0, 3)}</label>)}</fieldset>
      <div className="form-two"><label>Opens at<TimePicker value={opens} onChange={setOpens} required/></label><label>Closes at<TimePicker value={closes} onChange={setCloses} required/></label></div>
      <p className="field-hint">Detailed hours, capacity limits, and booking slots remain editable in Schedule &amp; Operations.</p>
    </> : <div className="site-admin-crosslink"><span><b>Operating hours, capacity, and booking slots</b><small>Managed in Schedule &amp; Operations to keep visitor availability in sync.</small></span><button type="button" className="link-btn" onClick={() => props.go('Schedule & Operations')}>Open Schedule &amp; Operations <ArrowRight size={14}/></button></div>}
  </>;
  const pendingPhotoFields = () => <div className="destination-photo-field" role="group" aria-labelledby="destination-photo-heading">
    <div className="destination-photo-heading"><span><b id="destination-photo-heading">Destination photos</b><small>Choose at least 1 and up to 3 photos.</small></span><span className="destination-photo-count">{photos.length}/3</span></div>
    <div className="destination-photo-grid">{photos.map((photo, index) => <figure className="destination-photo-preview" key={photo.preview}>
      <img src={photo.preview} alt={`Destination photo ${index + 1} preview`}/>
      <button type="button" aria-label={`Remove destination photo ${index + 1}`} onClick={() => removePendingPhoto(photo.preview)} disabled={loading}><X size={14}/></button>
      <figcaption>{index === 0 ? 'Cover photo' : `Photo ${index + 1}`}</figcaption>
    </figure>)}
      {photos.length < 3 && <label className="destination-photo-add"><ImagePlus size={20}/><span>{photos.length ? 'Add photos' : 'Choose photos'}</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple aria-label="Choose 1 to 3 destination photos" disabled={loading} onChange={choosePhotos}/></label>}
    </div><p className="field-hint" aria-live="polite">{photos.length ? `${photos.length} of 3 selected · The first photo is the cover.` : 'JPEG, PNG, or WebP · maximum 5 MiB each. At least one photo is required.'}</p>
  </div>;
  const tabNav = <div className="site-editor-tabs" role="tablist" aria-label="Destination settings">{visibleTabs.map((tab) => <button key={tab.id} type="button" role="tab" id={`site-tab-${tab.id}`} aria-controls={`site-panel-${tab.id}`} aria-selected={editorTab === tab.id} tabIndex={editorTab === tab.id ? 0 : -1} className={editorTab === tab.id ? 'active' : ''} onClick={() => setEditorTab(tab.id)} onKeyDown={(event) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = visibleTabs.findIndex((item) => item.id === tab.id);
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? visibleTabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + visibleTabs.length) % visibleTabs.length;
    setEditorTab(visibleTabs[target].id);
    document.getElementById(`site-tab-${visibleTabs[target].id}`)?.focus();
  }}>{tab.label}</button>)}</div>;
  const editorContent = <>
    {editorTab === 'overview' && <div className="site-editor-panel" role="tabpanel" tabIndex={0} id="site-panel-overview" aria-labelledby="site-tab-overview">
      {addingDestination ? <div className="form-card">{overviewFields()}<div className="site-editor-actions"><button type="button" className="btn btn-primary" onClick={() => setEditorTab('capacity')}>Continue to Capacity &amp; Hours <ArrowRight size={15}/></button></div></div>
        : <form className="form-card" onSubmit={(event) => void saveSite(event)}>{overviewFields()}<div className="site-editor-actions"><button className="btn btn-primary" disabled={loading}>{loading ? 'Saving…' : 'Save changes'} <Check size={15}/></button></div></form>}
    </div>}
    {editorTab === 'capacity' && <div className="site-editor-panel" role="tabpanel" tabIndex={0} id="site-panel-capacity" aria-labelledby="site-tab-capacity">
      {addingDestination ? <div className="form-card">{capacityFields()}<div className="site-editor-actions"><button type="button" className="btn btn-primary" onClick={() => setEditorTab('photos')}>Continue to Photos <ArrowRight size={15}/></button></div></div>
        : <form className="form-card" onSubmit={(event) => void saveSite(event)}>{capacityFields()}<div className="site-editor-actions"><button className="btn btn-primary" disabled={loading}>{loading ? 'Saving…' : 'Save changes'} <Check size={15}/></button></div></form>}
    </div>}
    {editorTab === 'photos' && <div className="site-editor-panel" role="tabpanel" tabIndex={0} id="site-panel-photos" aria-labelledby="site-tab-photos">
      {addingDestination ? <form className="form-card" onSubmit={(event) => void saveSite(event)}>{pendingPhotoFields()}<p className="field-hint">Destination goes public after required details, fees, hours, and photos are saved.</p><div className="site-editor-actions"><button className="btn btn-primary" disabled={loading}>{loading ? 'Creating…' : 'Create official destination'} <Check size={15}/></button></div></form> : <SiteImagesManager {...props}/>}
    </div>}
    {!addingDestination && editorTab === 'management' && props.role === 'tourism_office' && site && <div className="site-editor-panel" role="tabpanel" tabIndex={0} id="site-panel-management" aria-labelledby="site-tab-management"><SiteManagementPanel site={site} notify={props.notify} refresh={props.refresh}/></div>}
    {!addingDestination && editorTab === 'staff' && site && <div className="site-editor-panel" role="tabpanel" tabIndex={0} id="site-panel-staff" aria-labelledby="site-tab-staff">
      <section className="schedule-card site-staff-panel"><div className="card-heading"><span><small>AUTHORIZED PERSONNEL</small><h3>{site.name} staff</h3></span><Users size={18}/></div>
        {staffLoading ? <div className="empty-inline" role="status">Loading assigned staff…</div> : !siteStaff.length ? <div className="empty-inline">No active staff assignments for this destination.</div> : <div className="site-staff-list">{siteStaff.map((member) => <article key={member.id}><span><b>{member.name}</b><small>{member.email ?? 'Email unavailable'}</small></span><span className="status-tag">{member.staff_role.replace(/_/g, ' ')}</span></article>)}</div>}
        <div className="site-staff-actions"><button type="button" className="btn btn-outline" onClick={() => props.go('Staff and accounts')}>Manage staff accounts <Users size={15}/></button><button type="button" className="btn btn-outline" onClick={() => props.go('Schedule & Operations')}>Open duty calendar <CalendarClock size={15}/></button></div>
      </section>
    </div>}
  </>;
  const pageHeading = <div className="dash-header"><div><span className="eyebrow"><span className="eyebrow-line"/> {props.role === 'tourism_office' ? 'TOURISM OFFICE · NETWORK' : 'SITE ADMINISTRATION'}</span><h1>Places and <em>people.</em></h1><p>Manage tourism destinations and assigned personnel.</p></div>{props.role === 'tourism_office' && <button className="btn btn-primary" onClick={() => { releasePhotos(photos); setPhotos([]); setDraft(emptyDraft()); setDays([]); setOpens(''); setCloses(''); setEditing(''); setAddingDestination(true); setEditorTab('overview'); }}>Add destination <Plus size={16}/></button>}</div>;
  const editorHeading = <div className="site-editor-heading"><div><small>{addingDestination ? 'NEW DESTINATION' : 'DESTINATION PROFILE'}</small><h2>{addingDestination ? 'Create an official destination' : site ? `Edit ${site.name}` : 'Loading destination…'}</h2></div>{site && <span className={'status-tag ' + (site.status === 'published' ? 'paid' : '')}>{site.status.replace('_', ' ')}</span>}</div>;
  return <section className="dashboard-page section-wrap sites-admin-page">{pageHeading}
    {addingDestination ? <main className="site-admin-create-view"><button type="button" className="link-btn site-editor-back" onClick={() => { setAddingDestination(false); setEditing(''); if (site) beginEdit(site); }}>← Back to destinations</button>{editorHeading}{tabNav}{editorContent}</main> : <div className="sites-admin-layout">
      <aside className="sites-admin-list" aria-label="Destinations"><div className="card-heading"><span><small>PLACES AND PEOPLE</small><h3>Destinations</h3></span><span>{props.sites.length} total</span></div>
        <label className="site-admin-mobile-picker">Destination<select aria-label="Select destination" value={site?.id ?? ''} onChange={(event) => { const selected = props.sites.find((item) => item.id === event.target.value); if (selected) beginEdit(selected); }}><option value="" disabled>Select destination</option>{props.sites.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <div className="site-admin-destination-list">{!props.sites.length && <div className="empty-inline">No destination records have been created.</div>}{props.sites.map((item) => <article className={site?.id === item.id ? 'site-admin-row selected' : 'site-admin-row'} key={item.id}>
          <button className="site-admin-main" aria-current={site?.id === item.id ? 'true' : undefined} onClick={() => beginEdit(item)}><span><b>{item.name}</b><small>{item.address || item.category} · {item.fee_information_confirmed ? `Adult ${money(item.adult_fee)} / child ${money(item.child_fee)}` : 'Fee information needs confirmation'}</small></span><span className={'status-tag ' + (item.status === 'published' ? 'paid' : '')}>{item.status.replace('_', ' ')}</span></button>
          <div className="site-admin-actions"><label className="field-optional">Status<select aria-label={'Change status for ' + item.name} value={item.status} disabled={statusBusy === item.id} onChange={(event) => void updateStatus(item, event.target.value)}>{['draft', 'published', 'temporarily_closed', 'inactive'].map((status) => <option key={status} value={status}>{status.replace('_', ' ')}</option>)}</select></label></div>
        </article>)}</div>
      </aside>
      {site ? <main className="sites-admin-editor">{editorHeading}{tabNav}{editorContent}</main> : <div className="empty-card site-admin-empty"><MapPin size={26}/><h3>Select a destination</h3><p>Choose a destination to edit its details, media, access, and assignments.</p></div>}
    </div>}
  </section>;
}

type ManagementOrganization = { id: string; name: string; authority: 'tourism_office' | 'private_site' };

function SiteManagementPanel({ site, notify, refresh }: { site: Site; notify: Props['notify']; refresh: Props['refresh'] }) {
  const [organizations, setOrganizations] = useState<ManagementOrganization[]>([]);
  const [organizationId, setOrganizationId] = useState(site.management_organization_id ?? '');
  const [newOrganizationName, setNewOrganizationName] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => setOrganizationId(site.management_organization_id ?? ''), [site.id, site.management_organization_id]);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { data, error } = await db().from('management_organizations').select('id,name,authority').order('name');
        if (error) throw error;
        if (active) setOrganizations((data ?? []) as ManagementOrganization[]);
      } catch (error) {
        if (active) notify(error instanceof Error ? error.message : 'Could not load management organizations.');
      }
    })();
    return () => { active = false; };
  }, [notify]);

  const assign = async (managementOrganizationId: string | null, privateOrganizationName: string | null) => {
    setLoading(true);
    try {
      const { error } = await db().rpc('assign_site_management_organization', {
        p_site_id: site.id,
        p_management_organization_id: managementOrganizationId,
        p_new_private_organization_name: privateOrganizationName,
      });
      if (error) throw error;
      notify('Destination management organization updated. Staff access remains limited to active site assignments.');
      setNewOrganizationName('');
      refresh();
      const { data, error: organizationsError } = await db().from('management_organizations').select('id,name,authority').order('name');
      if (organizationsError) throw organizationsError;
      setOrganizations((data ?? []) as ManagementOrganization[]);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not update the destination management organization.');
    } finally { setLoading(false); }
  };

  const currentOrganization = organizations.find((organization) => organization.id === site.management_organization_id);
  return <section className="form-card site-management-card">
    <div className="card-heading"><span><small>DESTINATION OWNERSHIP</small><h3>Management authority</h3></span><Building2 size={18}/></div>
    <p>Current authority: <b>{currentOrganization?.name ?? 'Tourism Office'}</b>{currentOrganization?.authority === 'private_site' ? ' · Private site administration' : ' · Tourism Office'}</p>
    <label>Assign existing organization<select value={organizationId} onChange={(event) => setOrganizationId(event.target.value)}>
      <option value="" disabled>Select management organization</option>
      {organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name} · {organization.authority === 'private_site' ? 'Private' : 'Tourism Office'}</option>)}
    </select></label>
    <button className="btn btn-outline" type="button" disabled={loading || !organizationId || organizationId === site.management_organization_id}
      onClick={() => void assign(organizationId, null)}>{loading ? 'Saving…' : 'Assign organization'}</button>
    <form className="site-management-create" onSubmit={(event) => { event.preventDefault(); void assign(null, newOrganizationName.trim()); }}>
      <label>Or create a private organization<input value={newOrganizationName} onChange={(event) => setNewOrganizationName(event.target.value)} minLength={2} maxLength={160} required placeholder="Organization name"/></label>
      <button className="btn btn-outline" type="submit" disabled={loading}>{loading ? 'Saving…' : 'Create and assign'}</button>
    </form>
    <p className="field-hint">Ownership changes only after save. Site Admin access still requires an active assignment to this destination.</p>
  </section>;
}

function CapacityMapPage(props: Props) {
  if (props.role !== 'gatekeeper') return <div className="staff-capacity-map-page">
    <DestinationLocator sites={props.sites} audience="staff"/>
    <details className="capacity-evidence-disclosure"><summary>Site capacity evidence and zone settings</summary><CapacityEvidencePage {...props}/></details>
  </div>;
  return <CapacityEvidencePage {...props}/>;
}

function CapacityEvidencePage(props: Props) {
  const gatekeeper = props.role === 'gatekeeper';
  const site = props.sites.find((item) => item.id === props.siteId);
  const capacityFeed = useLiveCapacity(site ? [site.id] : []);
  const occupancy = site && capacityFeed.state === 'ready' ? capacityFeed.rows[site.id] ?? null : null;
  const [zones, setZones] = useState<CapacityZoneRow[]>([]);
  const [loading, finishLoading] = useSilentLoad(`${props.user?.id ?? 'staff'}:${props.role}:${site?.id ?? 'unselected'}`);
  useEffect(() => {
    let active = true;
    if (!site) { setZones([]); finishLoading(); return () => { active = false; }; }
    setZones([]);
    void Promise.all([
      db().from('site_capacity_zones').select('id,name,zone_type,measured_area,area_unit,estimated_capacity,plan_reference,geometry').eq('site_id', site.id).order('zone_type').order('name'),
    ]).then(([zoneResult]) => {
      if (zoneResult.error) throw zoneResult.error;
      if (active) {
        setZones((zoneResult.data ?? []) as typeof zones);
      }
    })
      .catch((error) => { if (active) props.notify(error instanceof Error ? error.message : 'Could not load capacity data.'); })
      .finally(() => { if (active) finishLoading(); });
    return () => { active = false; };
  }, [finishLoading, props.notify, site?.id]);
  const crowd = capacityStatus(occupancy);
  const approvedLimit = occupancy?.approved_visitor_limit;
  const mapLimit = crowd.limit;
  const mapLimitLabel = crowd.basis === 'estimate' ? 'provisional daily estimate' : 'approved visitor limit';
  const atLimit = approvedLimit != null && (occupancy?.current_visitor_count ?? 0) >= approvedLimit;
  const limitPercent = crowd.percent;
  const approachingLimit = ['near', 'almost', 'critical'].includes(crowd.level) && !atLimit;
  const remaining = mapLimit == null ? null : Math.max(0, mapLimit - (occupancy?.current_visitor_count ?? 0));
  const capacityLabel = site?.status !== 'published' ? 'Closed / restricted' : crowd.label;
  return <section className="dashboard-page section-wrap"><div className="dash-header"><div><span className="eyebrow"><span className="eyebrow-line"/> OPERATIONS · SITE CAPACITY</span><h1>Capacity <em>map.</em></h1><p>Live attendance and verified site-location records for {site?.name ?? 'the selected destination'}.</p></div>{!gatekeeper && <label className="staff-site-picker">Destination<SiteSelector {...props}/></label>}</div>
    {!site ? <div className="empty-card"><MapPinned size={28}/><h3>No destination selected</h3><p>Select a site assigned to your staff account.</p></div> : loading ? <div className="empty-card" role="status"><MapPinned size={28}/><h3>Loading capacity data</h3><p>Getting the records for {site.name}.</p></div> : <><div className="capacity-status-card"><div className={'capacity-status-label ' + (atLimit || site.status !== 'published' ? 'warning' : approachingLimit || approvedLimit == null ? 'informational' : 'available')}><span className="status-dot"/>{capacityLabel}</div>
        {mapLimit != null ? <><div className="capacity-status-headline"><b>{loading ? '—' : occupancy?.current_visitor_count ?? '—'}</b><span>visitors currently inside</span><strong>{remaining ?? '—'} spaces remaining</strong></div><div className="capacity-progress" role="progressbar" aria-label={`Recorded occupancy against ${mapLimitLabel}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, limitPercent ?? 0)}><i style={{ width: `${Math.min(100, limitPercent ?? 0)}%` }}/></div><div className="capacity-progress-label"><span>{formatCapacityPercent(limitPercent ?? 0)} of {mapLimitLabel}</span><span>Limit: {mapLimit}</span></div></>
          : <p>{occupancy ? 'Capacity Not Configured. Physical estimates remain informational and do not determine admission status.' : 'Capacity Data Unavailable. Refresh to try again.'}</p>}
        {atLimit && <div className="capacity-limit-alert"><ShieldCheck size={18}/><span>Approved visitor limit reached. New ticket arrivals and walk-in admissions will be rejected by the database.</span></div>}
        {approachingLimit && <p className="field-hint">{crowd.label}: {formatCapacityPercent(limitPercent!)} recorded occupancy. {crowd.basis === 'estimate' ? 'Estimate is provisional; official approval remains unset.' : `Approved limit: ${approvedLimit} visitors.`}</p>}
        {site.status !== 'published' && <div className="capacity-limit-alert"><ShieldCheck size={18}/><span>This destination is not published. Follow the site’s approved closure procedure.</span></div>}
        <div className="capacity-live-grid">{[['Currently onsite', occupancy?.current_visitor_count], ['Arrivals today', occupancy?.arrivals_today], ['Departures today', occupancy?.departures_today], ['Provisional map estimate', occupancy?.estimated_live_capacity], ['Physical estimate', occupancy?.capacity_estimate]].map(([label, value]) => <article key={String(label)}><small>{label}{label === 'Physical estimate' || label === 'Provisional map estimate' ? ' · informational' : ''}</small><b>{loading ? '—' : value ?? 'Not recorded'}</b></article>)}</div>
        <p className="field-hint">Physical estimate and approved visitor limit are separate. No per-zone occupancy is inferred from the site-wide count.</p>
        <p className="field-hint">Last successful update {capacityFeed.updatedAt ? new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(capacityFeed.updatedAt)) : 'unavailable'} · last attendance event {occupancy?.last_recorded_at ? new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(occupancy.last_recorded_at)) : 'none recorded'} · Asia/Manila{capacityFeed.state === 'stale' ? ' · live update interrupted' : ''}</p>
      </div>
      <section className="capacity-map-zones"><div className="card-heading"><span><small>GIS SITE PLAN · NORTH UP</small><h3>Site boundaries and attendance</h3></span><MapPinned size={18}/></div><DestinationMap site={site} zones={zones} occupancy={occupancy}/><p className="field-hint">Approved GeoJSON boundaries are drawn over satellite imagery. Heat uses site-wide occupancy only; visitor positions and per-zone counts are not collected or inferred.</p>{!!zones.length && <div className="capacity-zone-records">{zones.map((zone) => <article key={zone.id}><span><b>{zone.name}</b><small>{zone.zone_type.replace('_', ' ')} · {zone.measured_area == null ? 'Area not measured' : `${zone.measured_area} ${zone.area_unit.replace('_', ' ')}`}</small></span><b>{zone.estimated_capacity == null ? 'No zone estimate' : `${zone.estimated_capacity} estimated visitors`}</b></article>)}</div>}</section>
    </>}
    {site && props.role === 'site_admin' && <CapacityPanel key={site.id} {...props} site={site}/>}
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
  const [limit, setLimit] = useState({ value: '', date: phToday(), assessmentId: '', reference: '' });
  const [rules, setRules] = useState({ near: 70, almost: 85, critical: 95, restrict: false, estimate: '', basis: '' });
  const [loading, finishLoading] = useSilentLoad(`${props.user?.id ?? 'staff'}:${props.role}:${props.site.id}`);
  const [saving, setSaving] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const [assessmentResult, zoneResult, limitResult, rulesResult] = await Promise.all([
        db().from('site_capacity_assessments').select('id,methodology,estimated_capacity,assessment_date,status').eq('site_id', props.site.id).order('assessment_date', { ascending: false }),
        db().from('site_capacity_zones').select('id,name,zone_type,measured_area,area_unit,estimated_capacity,plan_reference,geometry').eq('site_id', props.site.id).order('zone_type').order('name'),
        db().from('site_approved_visitor_limits').select('id,visitor_limit,effective_from,effective_to,status,approaching_threshold_percent').eq('site_id', props.site.id).order('effective_from', { ascending: false }),
        db().from('site_capacity_rules').select('near_threshold_percent,almost_threshold_percent,critical_threshold_percent,restrict_at_warning,estimated_live_capacity,estimate_basis').eq('site_id', props.site.id).maybeSingle(),
      ]);
      if (assessmentResult.error) throw assessmentResult.error;
      if (zoneResult.error) throw zoneResult.error;
      if (limitResult.error) throw limitResult.error;
      if (rulesResult.error) throw rulesResult.error;
      setAssessments((assessmentResult.data ?? []) as CapacityAssessmentRow[]);
      setZones((zoneResult.data ?? []) as CapacityZoneRow[]);
      setLimits((limitResult.data ?? []) as ApprovedLimitRow[]);
      const row = rulesResult.data;
      setRules({ near: row?.near_threshold_percent ?? 70, almost: row?.almost_threshold_percent ?? 85, critical: row?.critical_threshold_percent ?? 95, restrict: row?.restrict_at_warning ?? false, estimate: row?.estimated_live_capacity == null ? '' : String(row.estimated_live_capacity), basis: row?.estimate_basis ?? '' });
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
        approaching_threshold_percent: rules.near,
      });
      if (error) throw error;
      setLimit({ value: '', date: phToday(), assessmentId: '', reference: '' });
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
  const saveRules = async (event: FormEvent) => {
    event.preventDefault();
    if (!(rules.near >= 1 && rules.near < rules.almost && rules.almost < rules.critical && rules.critical <= 100)) {
      props.notify('Use increasing thresholds between 1% and 100%.'); return;
    }
    setSaving(true);
    try {
      const { error } = await db().from('site_capacity_rules').upsert({ site_id: props.site.id,
        near_threshold_percent: rules.near, almost_threshold_percent: rules.almost,
        critical_threshold_percent: rules.critical, restrict_at_warning: rules.restrict,
        estimated_live_capacity: rules.estimate ? Number(rules.estimate) : null,
        estimate_basis: rules.basis.trim() || null,
      }, { onConflict: 'site_id' });
      if (error) throw error;
      props.notify('Capacity warning settings saved.'); await refresh();
    } catch (error) { props.notify(error instanceof Error ? error.message : 'Could not save capacity warnings.'); }
    finally { setSaving(false); }
  };
  return <section className="capacity-panel"><div className="card-heading"><span><small>CAPACITY EVIDENCE</small><h3>Capacity assessments and site map</h3></span><Activity size={18}/></div>
    <p className="field-hint">Physical estimates, approved visitor limits, and daily booking capacity are separate. No visitor limit is created from an assessment automatically.</p>
    <div className="capacity-state"><span><b>{zones.length}</b> measured zone{zones.length === 1 ? '' : 's'} recorded</span><span><b>{limits.filter((row) => row.status === 'active').length}</b> active approved limit{limits.filter((row) => row.status === 'active').length === 1 ? '' : 's'}</span><span>Map geometry: {zones.some((row) => row.geometry) ? 'recorded' : 'not recorded'}</span></div>
    <div className="capacity-form-grid"><form onSubmit={(event) => void saveRules(event)}><h4>Crowd warning settings</h4><p className="field-hint">Thresholds use recorded occupancy against the approved visitor limit. The approved maximum remains separate.</p><div className="form-two"><label>Near capacity (%)<input type="number" min="1" max="98" value={rules.near} onChange={(event) => setRules({ ...rules, near: Number(event.target.value) })} required/></label><label>Almost full (%)<input type="number" min="2" max="99" value={rules.almost} onChange={(event) => setRules({ ...rules, almost: Number(event.target.value) })} required/></label></div><label>Critical warning (%)<input type="number" min="3" max="100" value={rules.critical} onChange={(event) => setRules({ ...rules, critical: Number(event.target.value) })} required/></label><label>Provisional map estimate<input type="number" min="1" value={rules.estimate} onChange={(event) => setRules({ ...rules, estimate: event.target.value })} placeholder="Not set"/></label><label>Estimate basis<input value={rules.basis} onChange={(event) => setRules({ ...rules, basis: event.target.value })} maxLength={500} placeholder="School-project planning estimate"/></label><p className="field-hint">Map display and recommendations only. Does not set or enforce an admissions limit.</p><label><input type="checkbox" checked={rules.restrict} onChange={(event) => setRules({ ...rules, restrict: event.target.checked })}/> Restrict new admissions at the critical warning threshold</label><p className="field-hint">Admissions are always blocked at the approved maximum. This option applies an earlier restriction.</p><button className="btn btn-primary" disabled={saving || loading}>Save warning settings</button></form><form onSubmit={(event) => void saveAssessment(event)}><h4>Physical capacity assessment</h4><label>Methodology<input value={assessment.methodology} onChange={(event) => setAssessment({ ...assessment, methodology: event.target.value })} placeholder="Measured usable area ÷ stated space per visitor" required maxLength={500}/></label><div className="form-two"><label>Estimated capacity<input type="number" min="1" value={assessment.estimate} onChange={(event) => setAssessment({ ...assessment, estimate: event.target.value })}/></label><label>Assessment date<input type="date" value={assessment.date} onChange={(event) => setAssessment({ ...assessment, date: event.target.value })} required/></label></div><label>Assumptions<textarea value={assessment.assumptions} onChange={(event) => setAssessment({ ...assessment, assumptions: event.target.value })} rows={2}/></label><label>Source or survey reference<input value={assessment.source} onChange={(event) => setAssessment({ ...assessment, source: event.target.value })} maxLength={500}/></label><button className="btn btn-outline" disabled={saving || loading}>Save for review</button></form>
      <form onSubmit={(event) => void saveZone(event)}><h4>Capacity-map zone</h4><label>Zone name<input value={zone.name} onChange={(event) => setZone({ ...zone, name: event.target.value })} required maxLength={120}/></label><div className="form-two"><label>Type<select value={zone.type} onChange={(event) => setZone({ ...zone, type: event.target.value, geometry: '' })}><option value="usable">Usable area</option><option value="restricted">Restricted area</option><option value="access_path">Access path</option></select></label><label>Assessment<select value={zone.assessmentId} onChange={(event) => setZone({ ...zone, assessmentId: event.target.value })}><option value="">No linked assessment</option>{assessments.map((row) => <option key={row.id} value={row.id}>{row.assessment_date} · {row.methodology}</option>)}</select></label></div><div className="form-two"><label>Measured area<input type="number" min="0" step="0.01" value={zone.area} onChange={(event) => setZone({ ...zone, area: event.target.value })}/></label><label>Estimated zone visitors<input type="number" min="1" step="1" value={zone.estimate} onChange={(event) => setZone({ ...zone, estimate: event.target.value })}/></label></div><label>Area unit<select value={zone.unit} onChange={(event) => setZone({ ...zone, unit: event.target.value })}><option value="square_meters">Square meters</option><option value="square_feet">Square feet</option><option value="other">Other</option></select></label><label>GeoJSON geometry<textarea value={zone.geometry} onChange={(event) => setZone({ ...zone, geometry: event.target.value })} maxLength={200000} placeholder={zone.type === 'access_path' ? '{"type":"LineString","coordinates":[[124.2,8.2],[124.201,8.201]]}' : '{"type":"Polygon","coordinates":[[[124.2,8.2],[124.201,8.2],[124.201,8.201],[124.2,8.2]]]}' } rows={3}/></label><small className="field-hint">Use verified longitude, latitude pairs from the approved site plan. {zone.type === 'access_path' ? 'Access paths require LineString geometry.' : 'Visitor areas require closed Polygon geometry.'}</small><label>Plan reference<input value={zone.plan} onChange={(event) => setZone({ ...zone, plan: event.target.value })} placeholder="Verified drawing, survey, or map reference" maxLength={500}/></label><button className="btn btn-outline" disabled={saving || loading}>Save zone</button></form>
      {props.canSetApprovedLimit && <form onSubmit={(event) => void saveLimit(event)}><h4>Approved visitor limit</h4><p className="field-hint">Use only after the responsible authority has approved an operational limit. Set crowd warnings above.</p><label>Approved limit<input type="number" min="1" value={limit.value} onChange={(event) => setLimit({ ...limit, value: event.target.value })} required/></label><label>Effective from<input type="date" value={limit.date} onChange={(event) => setLimit({ ...limit, date: event.target.value })} required/></label><label>Supporting assessment<select value={limit.assessmentId} onChange={(event) => setLimit({ ...limit, assessmentId: event.target.value })}><option value="">Policy or other approval</option>{assessments.map((row) => <option key={row.id} value={row.id}>{row.assessment_date} · {row.methodology}</option>)}</select></label><label>Approval reference<input value={limit.reference} onChange={(event) => setLimit({ ...limit, reference: event.target.value })} maxLength={500}/></label><button className="btn btn-primary" disabled={saving || loading}>Record approved limit</button></form>}
    </div>
    <div className="capacity-records">{loading && <div className="empty-inline">Loading capacity records…</div>}{!loading && !assessments.length && !zones.length && !limits.length && <div className="empty-inline">No physical-capacity or approved-limit records yet.</div>}
      {!!assessments.length && <article><h4>Assessments</h4>{assessments.map((row) => <div key={row.id}><span><b>{row.methodology}</b><small>{row.assessment_date} · {row.estimated_capacity ?? 'No'} estimated visitors · {row.status}</small></span>{row.status === 'draft' || row.status === 'needs_review' ? <button className="link-btn" onClick={() => void markReviewed(row.id)}>Mark reviewed</button> : null}</div>)}</article>}
      {!!zones.length && <article><h4>Zones</h4>{zones.map((row) => <div key={row.id}><span><b>{row.name}</b><small>{row.zone_type.replace('_', ' ')} · {row.measured_area == null ? 'Area not measured' : `${row.measured_area} ${row.area_unit.replace('_', ' ')}`} · {row.estimated_capacity == null ? 'No estimate' : `${row.estimated_capacity} estimated visitors`}</small></span><small>{row.plan_reference || 'No plan reference'}</small></div>)}</article>}
      {!!limits.length && <article><h4>Approved limits</h4>{limits.map((row) => <div key={row.id}><span><b>{row.visitor_limit} visitors</b><small>Effective {row.effective_from}{row.effective_to ? ` to ${row.effective_to}` : ''}</small></span><span className="status-tag">{row.status}</span></div>)}</article>}</div>
  </section>;
}

function WalkInPage(props: Props) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotId, setSlotId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'' | 'cash' | 'gcash' | 'maya'>('');
  const [form, setForm] = useState({ name: '', email: '', phone: '', adults: 1, children: 0, pwd: 0 });
  const [visitorRecords, setVisitorRecords] = useState(() => emptyVisitorInformation(1));
  const [ticketToken, setTicketToken] = useState('');
  const [ticketError, setTicketError] = useState('');
  const [reference, setReference] = useState('');
  const site = props.sites.find((item) => item.id === props.siteId);
  const [slotsLoading, finishSlotsLoading] = useSilentLoad(`${props.user?.id ?? 'staff'}:${props.siteId}`);
  const total = site
    ? calculateBookingTotal(site.adult_fee, site.child_fee, site.pwd_discount_percent, form.adults, form.children, form.pwd)
    : 0;
  const maxWalkInVisitors = site?.slug === 'sikyop-agri-tourism-adventure' ? Math.min(19, site.max_per_booking) : site?.max_per_booking ?? 20;
  const walkInReady = Boolean(site && !props.busy && !slotsLoading && slots.some((slot) => slot.slot_id === slotId) && paymentMethod && !bookingContactError(form.name, form.email, form.phone) && visitorInformationComplete(visitorRecords, site.slug));
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
    if (!paymentMethod) { props.notify('Select how the visitor paid.'); return; }
    if (!visitorInformationComplete(visitorRecords, site.slug)) { props.notify('Complete visitor information for everyone in the walk-in group.'); return; }
    const contactError = bookingContactError(form.name, form.email, form.phone);
    if (contactError) { props.notify(contactError); return; }
    props.setBusy(true);
    try {
      const { data, error } = await db().rpc('register_walk_in_with_payment', {
        p_site_id: site.id,
        p_slot_id: slotId,
        p_name: form.name.trim(),
        p_adult_count: form.adults,
        p_child_count: form.children,
        p_pwd_count: form.pwd,
        p_email: form.email.trim() || null,
        p_phone: form.phone.trim() || null,
        p_visitors: visitorInformationPayload(visitorRecords, site.slug),
        p_payment_method: paymentMethod,
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as { booking_id: string; booking_reference: string; guest_access_token: string };
      setReference(row.booking_reference);
      setTicketToken('');
      setTicketError('');
      setForm({ name: '', email: '', phone: '', adults: 1, children: 0, pwd: 0 });
      setVisitorRecords(emptyVisitorInformation(1));
      setSlotId('');
      setPaymentMethod('');
      props.notify('Walk-in and payment recorded.');
      if (form.email.trim()) void invokeFunction('send-booking-email', {
        booking_reference: row.booking_reference,
        guest_access_token: row.guest_access_token || null,
        event: 'confirmed',
      }).catch(() => props.notify('Walk-in recorded, but the confirmation email could not be sent.'));
      try {
        const result = await invokeFunction<{ token: string }>('ticket', {
          booking_reference: row.booking_reference,
          guest_access_token: row.guest_access_token || null,
        });
        setTicketToken(result.token);
      } catch {
        setTicketError('Walk-in recorded; ticket could not be generated. Use the booking reference.');
        props.notify('Walk-in recorded, but ticket generation failed.');
      }
      try {
        const refreshed = await loadSlots(site.id, phToday(), phToday());
        setSlots(currentSlots(refreshed));
      } catch {
        props.notify('Walk-in recorded, but today’s slots could not refresh.');
      }
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
      <div className="form-two"><label>Adults<input type="number" min="1" max={maxWalkInVisitors} value={form.adults} onChange={(event) => { const parsed = Number.parseInt(event.target.value, 10); const adults = Math.max(1, Math.min(maxWalkInVisitors, Number.isNaN(parsed) ? 1 : parsed)); const children = Math.min(form.children, maxWalkInVisitors - adults); setForm({ ...form, adults, children, pwd: Math.min(form.pwd, adults + children) }); }} required/></label><label>Children<input type="number" min="0" max={maxWalkInVisitors - form.adults} value={form.children} onChange={(event) => { const parsed = Number.parseInt(event.target.value, 10); const children = Math.max(0, Math.min(maxWalkInVisitors - form.adults, Number.isNaN(parsed) ? 0 : parsed)); setForm({ ...form, children, pwd: Math.min(form.pwd, form.adults + children) }); }} required/></label></div>
      {site && <VisitorInformationForm siteSlug={site.slug} adults={form.adults} children={form.children} visitors={visitorRecords}
        onChange={(index, field, value) => setVisitorRecords((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item))}/>}
      {site.pwd_discount_percent > 0 && <label>PWD visitors<input type="number" min="0" max={form.adults + form.children} value={form.pwd} onChange={(event) => { const parsed = Number.parseInt(event.target.value, 10); setForm({ ...form, pwd: Math.max(0, Math.min(form.adults + form.children, Number.isNaN(parsed) ? 0 : parsed)) }); }} required/><small>{site.pwd_discount_percent}% discount per PWD visitor. Verify eligibility at the gate.</small></label>}
      <div className="booking-total"><span>Estimated fees<small>{form.adults} adults · {form.children} children · {form.pwd} PWD · {paymentMethod ? 'Payment method selected' : 'Payment method required'}</small></span><b>{money(total)}</b></div>
      <label>Payment received through<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as typeof paymentMethod)} required><option value="">Choose payment method</option><option value="cash">Cash</option><option value="gcash">GCash (online)</option><option value="maya">Maya (online)</option></select><small>Record after receiving payment. GCash/Maya entries are demo records; this form does not verify transfers.</small></label>
      <button className="btn btn-primary btn-wide" disabled={!walkInReady}>{props.busy ? 'Saving…' : 'Record walk-in'} <Check size={16}/></button>
      <p className="secure-note"><ShieldCheck size={14}/> Visitor, payment method, and payment status save with the walk-in.</p>
    </form><article className="qr-preview"><span className="eyebrow"><span className="eyebrow-line"/> WALK-IN TICKET</span>
      {ticketToken ? <><h3>{reference}</h3><div className="ticket-qr"><QRCodeSVG value={ticketToken} size={190} level="H" includeMargin/><small>Present this QR code at the entry point for validation.</small></div>
        <button className="link-btn" onClick={() => { void navigator.clipboard.writeText(reference); props.notify('Booking reference copied.'); }}>Copy booking reference</button></>
        : ticketError ? <div className="empty-card compact-empty"><TicketIcon size={28}/><h3>{reference}</h3><p>{ticketError}</p><button className="link-btn" onClick={() => { void navigator.clipboard.writeText(reference); props.notify('Booking reference copied.'); }}>Copy booking reference</button></div>
          : <div className="empty-card compact-empty"><TicketIcon size={28}/><h3>Ticket appears after registration</h3><p>Only a walk-in successfully recorded by the database receives a ticket.</p></div>}
    </article></div>}
  </section>;
}
