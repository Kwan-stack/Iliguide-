import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Activity, ArrowDownToLine, ChevronLeft, ChevronRight, Clock3, FileText, Search, ShieldCheck, X } from 'lucide-react';
import { exportCsv, type Site } from '../lib/iliguide';
import { supabase } from '../lib/supabase';
import './ActivityAuditPage.css';

type EventRow = {
  event_key: string; created_at: string; event_type: string; categories: string[]; destination: string;
  destination_ids: string[] | null; destination_names: string[] | null; actor: string; actor_role: string | null;
  booking_reference: string | null; successful: boolean; change_count: number;
  changes: Array<{ event_type: string; category: string; entity_type: string; entity_id: string | null; action: string;
    previous_values: Record<string, unknown>; updated_values: Record<string, unknown>; metadata: Record<string, unknown>; outcome: string }>;
  search_text: string;
};
type Period = 'today' | '7' | '30' | 'custom';
const PAGE_SIZE = 20;
const categories = ['Booking', 'Attendance', 'Payment', 'Carrying capacity', 'Scheduling', 'Staff management', 'Destination management', 'Announcements', 'Feedback', 'Security', 'System operations'];
const visitorCategories = ['Booking', 'Attendance', 'Payment'];
const adminCategories = ['Carrying capacity', 'Scheduling', 'Staff management', 'Destination management', 'Announcements', 'Feedback'];
const eventNames: Record<string, string> = {
  booking_created: 'Booking created', booking_confirmed: 'Booking confirmed', booking_cancelled: 'Booking cancelled', booking_expired: 'Booking expired',
  booking_record_updated: 'Booking record updated', booking_status_updated: 'Booking status updated', payment_submitted: 'Payment submitted',
  payment_recorded: 'Payment recorded', payment_verified: 'Payment verified', payment_rejected: 'Payment rejected', payment_status_updated: 'Payment status updated',
  payment_record_created: 'Payment recorded', refund_recorded: 'Refund recorded', refund_status_updated: 'Refund status updated',
  ticket_issued: 'Ticket issued', visitor_checked_in: 'Visitor checked in', visitor_checked_out: 'Visitor checked out', visit_completed: 'Visit completed',
  attendance_recorded: 'Attendance recorded', booking_cancellation_reviewed: 'Cancellation request reviewed',
  capacity_assessment_reviewed: 'Capacity assessment reviewed', capacity_assessment_updated: 'Capacity assessment updated',
  capacity_limit_updated: 'Capacity limit updated', capacity_zone_updated: 'Capacity zone updated', capacity_configuration_updated: 'Capacity settings updated',
  operating_hours_updated: 'Operating hours updated', scheduling_configuration_updated: 'Schedule settings updated', booking_schedule_updated: 'Booking schedule updated',
  booking_slot_closed: 'Booking slot closed', booking_slot_reopened: 'Booking slot reopened', destination_closed: 'Destination closed', destination_reopened: 'Destination reopened',
  destination_created: 'Destination created', destination_removed: 'Destination removed', destination_updated: 'Destination information updated',
  destination_photo_removed: 'Destination photo removed', destination_photo_updated: 'Destination photo updated', gatekeeper_assigned: 'Gatekeeper assigned',
  gatekeeper_reassigned: 'Gatekeeper reassigned', gatekeeper_assignment_removed: 'Gatekeeper assignment removed', staff_invitation_created: 'Staff invitation created',
  staff_account_activated: 'Staff account activated', staff_invitation_updated: 'Staff invitation updated', staff_account_updated: 'Staff account updated',
  account_created: 'Account created', account_information_updated: 'Account information updated', announcement_published: 'Destination advisory published',
  announcement_drafted: 'Destination advisory drafted', announcement_updated: 'Destination advisory updated', announcement_removed: 'Destination advisory removed',
  feedback_submitted: 'Feedback submitted', feedback_moderated: 'Feedback moderated', feedback_updated: 'Feedback updated', gatekeeper_duty_updated: 'Gatekeeper duty updated',
  gatekeeper_duty_support_updated: 'Gatekeeper duty support updated', visitor_eligibility_reviewed: 'Visitor eligibility reviewed',
  historical_record_updated: 'Historical record updated', system_record_updated: 'System record updated',
};
const fieldNames: Record<string, string> = {
  booking_status: 'Booking status', payment_status: 'Payment status', visitor_count: 'Visitors', adult_count: 'Adults', child_count: 'Children',
  total_amount: 'Amount', currency: 'Currency', payment_method: 'Payment method', provider: 'Payment channel', booking_source: 'Booking type',
  capacity: 'Capacity', daily_capacity: 'Daily capacity', visitor_limit: 'Visitor limit', slot_date: 'Visit date', starts_at: 'Starts', ends_at: 'Ends',
  status: 'Status', weekday: 'Weekday', opens_at: 'Opens', closes_at: 'Closes', is_closed: 'Closed', name: 'Name', category: 'Category',
  adult_fee: 'Adult fee', child_fee: 'Child fee', max_per_booking: 'Maximum per booking', title: 'Title', published_at: 'Published at', expires_at: 'Expires at',
  role: 'Role', account_status: 'Account status', staff_role: 'Staff role', is_active: 'Active', primary_gatekeeper_id: 'Primary gatekeeper',
  staff_member: 'Staff member', previous_destination: 'Previous destination', updated_destination: 'Updated destination', image_changed: 'Image changed',
  duty_date: 'Duty date', shift_start_at: 'Shift starts', shift_end_at: 'Shift ends', rating: 'Rating', review_status: 'Review status',
  reason: 'Reason', assigned_gatekeeper: 'Assigned gatekeeper', previous_gatekeeper: 'Previous gatekeeper', updated_gatekeeper: 'Updated gatekeeper',
  estimated_capacity: 'Estimated capacity', near_threshold_percent: 'Near-capacity threshold', almost_threshold_percent: 'Almost-full threshold', critical_threshold_percent: 'Full threshold',
  request_status: 'Request status', verification_status: 'Verification status', action: 'Action',
};
const phDate = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const dateOffset = (days: number) => { const date = new Date(`${phDate(new Date())}T12:00:00+08:00`); date.setUTCDate(date.getUTCDate() + days); return phDate(date); };
const phTimestamp = (value: string) => new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const dateStart = (date: string) => `${date}T00:00:00+08:00`;
const dateEnd = (date: string) => `${date}T23:59:59.999+08:00`;
const titleCase = (value: string) => value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const formatValue = (value: unknown) => value == null || value === '' ? 'Not recorded' : typeof value === 'boolean' ? value ? 'Yes' : 'No' : typeof value === 'object' ? JSON.stringify(value) : String(value);

function filtered(query: any, options: { siteId: string; category: string; search: string; from: string; to: string }): any {
  let result = query;
  if (options.siteId) result = result.contains('destination_ids', [options.siteId]);
  if (options.category) result = result.contains('categories', [options.category]);
  if (options.search.trim()) result = result.ilike('search_text', `%${options.search.trim().replace(/[%_,]/g, ' ')}%`);
  if (options.from) result = result.gte('created_at', dateStart(options.from));
  if (options.to) result = result.lte('created_at', dateEnd(options.to));
  return result;
}

export function ActivityAuditPage({ sites }: { sites: Site[] }) {
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [siteId, setSiteId] = useState('');
  const [category, setCategory] = useState('');
  const [period, setPeriod] = useState<Period>('today');
  const [customFrom, setCustomFrom] = useState(phDate(new Date()));
  const [customTo, setCustomTo] = useState(phDate(new Date()));
  const [ascending, setAscending] = useState(false);
  const [page, setPage] = useState(0);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [selected, setSelected] = useState<EventRow | null>(null);
  const [total, setTotal] = useState(0);
  const [visitorCount, setVisitorCount] = useState(0);
  const [adminCount, setAdminCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const connectedRef = useRef(false);
  const drawerRef = useRef<HTMLElement | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const dateRange = useMemo(() => period === 'today' ? [phDate(new Date()), phDate(new Date())]
    : period === '7' ? [dateOffset(-6), phDate(new Date())] : period === '30' ? [dateOffset(-29), phDate(new Date())]
      : [customFrom, customTo], [period, customFrom, customTo]);
  const filters = useMemo(() => ({ siteId, category, search: appliedSearch, from: dateRange[0], to: dateRange[1] }), [siteId, category, appliedSearch, dateRange]);
  const reload = useCallback(() => setRefreshKey((value) => value + 1), []);

  useEffect(() => { const timer = window.setTimeout(() => setAppliedSearch(search), 250); return () => window.clearTimeout(timer); }, [search]);
  useEffect(() => { setPage(0); }, [siteId, category, appliedSearch, period, customFrom, customTo, ascending]);
  useEffect(() => {
    let active = true;
    const client = supabase;
    if (!client) { setEvents([]); setError('Supabase is not configured.'); setLoading(false); return; }
    setLoading(true); setError('');
    const base = () => filtered(client.from('activity_log_events').select('*', { count: 'exact', head: true }), filters);
    const pageQuery = filtered(client.from('activity_log_events').select('*'), filters).order('created_at', { ascending }).order('event_key', { ascending }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    const visitorQuery = filtered(client.from('activity_log_events').select('event_key', { count: 'exact', head: true }), filters).overlaps('categories', visitorCategories);
    const adminQuery = filtered(client.from('activity_log_events').select('event_key', { count: 'exact', head: true }), filters).overlaps('categories', adminCategories);
    void Promise.all([pageQuery, base(), visitorQuery, adminQuery]).then(([rows, all, visitors, admins]) => {
      if (!active) return;
      const failure = rows.error ?? all.error ?? visitors.error ?? admins.error;
      if (failure) throw failure;
      setEvents((rows.data ?? []) as EventRow[]); setTotal(all.count ?? 0); setVisitorCount(visitors.count ?? 0); setAdminCount(admins.count ?? 0);
    }).catch((cause) => { if (active) { setEvents([]); setError(cause instanceof Error ? cause.message : 'Could not load activity.'); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [filters, page, ascending, refreshKey]);

  useEffect(() => {
    if (!supabase) return;
    let eventTimer = 0;
    const channel = supabase.channel('tourism-office-activity-audit')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'audit_logs' }, () => {
        window.clearTimeout(eventTimer);
        eventTimer = window.setTimeout(reload, 180);
      })
      .subscribe((status) => { connectedRef.current = status === 'SUBSCRIBED'; setConnected(connectedRef.current); });
    const fallback = window.setInterval(() => { if (!connectedRef.current) reload(); }, 30_000);
    return () => { window.clearTimeout(eventTimer); window.clearInterval(fallback); connectedRef.current = false; void supabase?.removeChannel(channel); };
  }, [reload]);

  useEffect(() => {
    if (!selected) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    drawerRef.current?.querySelector<HTMLElement>('button')?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelected(null);
      if (event.key === 'Tab' && drawerRef.current) {
        const focusable = [...drawerRef.current.querySelectorAll<HTMLElement>('button, a, input, select, textarea, [tabindex]:not([tabindex="-1"])')];
        if (!focusable.length) return;
        if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable[focusable.length - 1].focus(); }
        else if (!event.shiftKey && document.activeElement === focusable[focusable.length - 1]) { event.preventDefault(); focusable[0].focus(); }
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', closeOnEscape); };
  }, [selected]);

  const loadAll = async () => {
    if (!supabase || !total) return;
    setExporting(true);
    try {
      const rows: EventRow[] = [];
      for (let offset = 0; offset < total; offset += 500) {
        const result = await filtered(supabase.from('activity_log_events').select('*'), filters)
          .order('created_at', { ascending }).order('event_key', { ascending }).range(offset, Math.min(offset + 499, total - 1));
        if (result.error) throw result.error;
        rows.push(...(result.data as EventRow[] ?? []));
      }
      return rows;
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not export activity.'); return null; }
    finally { setExporting(false); }
  };
  const exportCsvAll = async () => {
    const rows = await loadAll();
    if (!rows) return;
    await exportCsv(`iliguide-activity-${phDate(new Date())}.csv`, rows.map((event) => ({
        Activity: eventNames[event.event_type] ?? titleCase(event.event_type), Category: event.categories.join(', '), Destination: event.destination,
        'Performed by': event.actor, Role: event.actor_role ?? 'Not recorded', 'Booking reference': event.booking_reference ?? 'Not recorded',
        'Date and time (Asia/Manila)': phTimestamp(event.created_at), Outcome: event.successful ? 'Successful' : 'Rejected',
        Details: event.changes.map((change) => `${change.category}: ${JSON.stringify(change.previous_values)} → ${JSON.stringify(change.updated_values)}`).join(' | '),
      })));
  };
  const exportPdf = async () => {
    const rows = await loadAll();
    if (!rows) return;
    try {
      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
      const margin = 42, width = pdf.internal.pageSize.getWidth() - margin * 2;
      let y = 48;
      const write = (value: string, size = 9, bold = false) => {
        pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(size);
        const lines = pdf.splitTextToSize(value, width);
        if (y + lines.length * (size + 4) > pdf.internal.pageSize.getHeight() - margin) { pdf.addPage(); y = margin; }
        pdf.text(lines, margin, y); y += lines.length * (size + 4);
      };
      write('Illiguide · Activity & Audit Log', 16, true); write(`Exported ${phTimestamp(new Date().toISOString())} · Asia/Manila`, 8); y += 12;
      for (const event of rows) {
        write(eventNames[event.event_type] ?? titleCase(event.event_type), 11, true);
        write(`${event.categories.join(', ')} · ${event.destination} · ${phTimestamp(event.created_at)} · ${event.actor}${event.actor_role ? ` (${titleCase(event.actor_role)})` : ''}`);
        if (event.booking_reference) write(`Booking: ${event.booking_reference}`);
        for (const change of event.changes) {
          const fields = [...new Set([...Object.keys(change.previous_values), ...Object.keys(change.updated_values)])]
            .filter((key) => JSON.stringify(change.previous_values[key]) !== JSON.stringify(change.updated_values[key]));
          for (const key of fields) write(`${fieldNames[key] ?? titleCase(key)}: ${formatValue(change.previous_values[key])} → ${formatValue(change.updated_values[key])}`, 8);
          for (const [key, value] of Object.entries(change.metadata ?? {})) if (value != null) write(`${fieldNames[key] ?? titleCase(key)}: ${formatValue(value)}`, 8);
        }
        write(`Outcome: ${event.successful ? 'Successful' : 'Rejected'}`, 8); y += 9;
      }
      pdf.save(`iliguide-activity-${phDate(new Date())}.pdf`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not export activity PDF.'); }
  };

  return <section className="dashboard-page section-wrap activity-audit-page">
    <div className="dash-header"><div><span className="eyebrow"><span className="eyebrow-line"/> TOURISM OFFICE · MONITORING</span><h1>Activity &amp; <em>Audit Log</em></h1><p>Monitor transactions, staff actions, and operational changes across destinations.</p></div>
      <div className="activity-audit-export"><button className="btn btn-outline" onClick={() => void exportCsvAll()} disabled={loading || exporting || total === 0}><ArrowDownToLine size={15}/>{exporting ? 'Preparing…' : 'Export CSV'}</button><button className="btn btn-outline" onClick={() => void exportPdf()} disabled={loading || exporting || total === 0}><FileText size={15}/>{exporting ? 'Preparing…' : 'Export PDF'}</button></div></div>
    <div className="activity-audit-metrics" aria-live="polite"><Metric icon={<Activity/>} label="Total activities" value={total} loading={loading || Boolean(error)}/><Metric icon={<Clock3/>} label="Visitor transactions" value={visitorCount} loading={loading || Boolean(error)}/><Metric icon={<ShieldCheck/>} label="Administrative actions" value={adminCount} loading={loading || Boolean(error)}/></div>
    <section className="activity-audit-card" aria-label="Activity history">
      <div className="activity-audit-filters"><label className="activity-audit-search"><Search size={16}/><span className="sr-only">Search activities</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search activities, booking reference, actor…"/></label>
        <label><span className="sr-only">Destination</span><select value={siteId} onChange={(event) => setSiteId(event.target.value)}><option value="">All destinations</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
        <label><span className="sr-only">Activity category</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">All activities</option>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span className="sr-only">Date range</span><select value={period} onChange={(event) => setPeriod(event.target.value as Period)}><option value="today">Today</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="custom">Custom range</option></select></label>
        {period === 'custom' && <div className="activity-audit-dates"><label><span className="sr-only">From date</span><input type="date" value={customFrom} max={customTo} onChange={(event) => setCustomFrom(event.target.value)}/></label><span>to</span><label><span className="sr-only">To date</span><input type="date" value={customTo} min={customFrom} onChange={(event) => setCustomTo(event.target.value)}/></label></div>}
        <label><span className="sr-only">Sort order</span><select value={ascending ? 'oldest' : 'newest'} onChange={(event) => setAscending(event.target.value === 'oldest')}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
        <button className="activity-audit-clear" onClick={() => { setSearch(''); setSiteId(''); setCategory(''); setPeriod('today'); setCustomFrom(phDate(new Date())); setCustomTo(phDate(new Date())); setAscending(false); }}>Clear filters</button>
      </div>
      <div className="activity-audit-context"><span>{siteId ? sites.find((site) => site.id === siteId)?.name ?? 'Selected destination' : 'All destinations'} · {period === 'today' ? 'Today' : `${dateRange[0]} to ${dateRange[1]}`}</span><span className={connected ? 'activity-live' : 'activity-offline'}><i/>{connected ? 'Live updates on' : 'Reconnecting'}</span></div>
      {error && <p className="activity-audit-error" role="alert">Could not load this activity data. {error}</p>}
      {loading ? <div className="activity-audit-empty" role="status">Loading activity…</div> : !error && events.length === 0 ? <div className="activity-audit-empty">No recorded activities match these filters.</div> : !error && <>
        <div className="activity-audit-table-wrap"><table className="activity-audit-table"><thead><tr><th>Activity</th><th>Destination</th><th>Performed by</th><th>Date and time</th><th><span className="sr-only">Details</span></th></tr></thead><tbody>
          {events.map((event) => <tr key={event.event_key}><td><b>{eventNames[event.event_type] ?? titleCase(event.event_type)}</b><small>{event.categories.join(' · ')}</small></td><td>{event.destination}</td><td>{event.actor}<small>{event.actor_role ? titleCase(event.actor_role) : 'Role not recorded'}</small></td><td><time dateTime={event.created_at}>{phTimestamp(event.created_at)}</time></td><td><button className="activity-audit-detail" onClick={() => setSelected(event)} aria-label={`View details: ${eventNames[event.event_type] ?? titleCase(event.event_type)}`}>View</button></td></tr>)}
        </tbody></table></div>
        <div className="activity-audit-pagination"><span>Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total} activities</span><div><button onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={page === 0} aria-label="Previous page"><ChevronLeft size={16}/></button><span>Page {page + 1} of {Math.max(1, Math.ceil(total / PAGE_SIZE))}</span><button onClick={() => setPage((value) => value + 1)} disabled={(page + 1) * PAGE_SIZE >= total} aria-label="Next page"><ChevronRight size={16}/></button></div></div>
      </>}
      <p className="activity-audit-note"><ShieldCheck size={15}/> Successful changes recorded with their transaction. System/security events count in Total only. Older records may have limited details.</p>
    </section>
    {selected && <div className="activity-audit-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><aside ref={drawerRef} className="activity-audit-drawer" role="dialog" aria-modal="true" aria-labelledby="activity-detail-title"><header><div><small>ACTIVITY DETAILS</small><h2 id="activity-detail-title">{eventNames[selected.event_type] ?? titleCase(selected.event_type)}</h2></div><button type="button" onClick={() => setSelected(null)} aria-label="Close details"><X size={19}/></button></header>
      <span className={selected.successful ? 'activity-outcome-success' : 'activity-outcome-rejected'}>{selected.successful ? 'Successful transaction' : 'Rejected'}</span>
      <dl className="activity-detail-grid"><dt>Category</dt><dd>{selected.categories.join(', ')}</dd><dt>Date and time</dt><dd>{phTimestamp(selected.created_at)} · Asia/Manila</dd><dt>Destination</dt><dd>{selected.destination}</dd><dt>Performed by</dt><dd>{selected.actor}</dd><dt>Actor role</dt><dd>{selected.actor_role ? titleCase(selected.actor_role) : 'Not recorded'}</dd>{selected.booking_reference && <><dt>Booking reference</dt><dd>{selected.booking_reference}</dd></>}</dl>
      {selected.changes.map((change, index) => <section className="activity-change-detail" key={`${change.entity_type}-${change.entity_id ?? index}`}><h3>{change.category}</h3>
        {Object.keys(change.previous_values).length > 0 || Object.keys(change.updated_values).length > 0 ? <div className="activity-value-list">{[...new Set([...Object.keys(change.previous_values), ...Object.keys(change.updated_values)])].filter((key) => JSON.stringify(change.previous_values[key]) !== JSON.stringify(change.updated_values[key])).map((key) => <div key={key}><b>{fieldNames[key] ?? titleCase(key)}</b><span>{formatValue(change.previous_values[key])} <span aria-hidden="true">→</span> {formatValue(change.updated_values[key])}</span></div>)}</div> : <p>Change details not recorded.</p>}
        {Object.entries(change.metadata ?? {}).filter(([key]) => key !== 'visit_date' && key !== 'starts_at' && key !== 'ends_at').map(([key, value]) => <p key={key}><b>{fieldNames[key] ?? titleCase(key)}:</b> {formatValue(value)}</p>)}
        {Boolean(change.metadata?.visit_date) && <p><b>Scheduled visit:</b> {formatValue(change.metadata.visit_date)} {change.metadata.starts_at ? `· ${formatValue(change.metadata.starts_at)}–${formatValue(change.metadata.ends_at)}` : ''}</p>}
      </section>)}
      <p className="activity-audit-note"><ShieldCheck size={15}/> Read-only record. Operational changes happen in their original modules.</p>
    </aside></div>}
  </section>;
}

function Metric({ icon, label, value, loading }: { icon: ReactNode; label: string; value: number; loading: boolean }) {
  return <article><span>{icon}</span><small>{label}</small><b>{loading ? '—' : value.toLocaleString()}</b></article>;
}
