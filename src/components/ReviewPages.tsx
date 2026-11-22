import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowDownToLine, CheckCircle2, Flag, History, MessageSquareText, RefreshCw, Search, Star, X } from 'lucide-react';
import { db, exportCsv, type Profile, type Site } from '../lib/iliguide';
import './ReviewPages.css';

export type ReviewRow = {
  id: string; booking_id: string; site_id: string; rating: number; category: string; comment: string;
  review_status: 'pending' | 'published' | 'hidden'; created_at: string; moderation_note?: string | null;
};
type ReviewReport = { id: string; review_id: string; reason: string; details: string; status: string; created_at: string };
type HistoryRow = { id: string; actor_id: string | null; old_status: string; new_status: string; note: string | null; created_at: string };
export const reviewCategories = [
  ['overall_experience', 'Overall experience'], ['cleanliness', 'Cleanliness'], ['facilities', 'Facilities'],
  ['staff_service', 'Staff & service'], ['safety', 'Safety'], ['accessibility', 'Accessibility'],
] as const;
const categoryLabel = (value: string) => reviewCategories.find(([key]) => key === value)?.[1] ?? 'Overall experience';
const dateText = (value: string) => new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeZone: 'Asia/Manila' }).format(new Date(value));
const reportLabel = (value: string) => ({ inaccurate: 'Inaccurate', inappropriate: 'Inappropriate', spam: 'Spam', other: 'Other' }[value] ?? value);

export function ReviewComposer({ bookingId, siteName, existing, onClose, onSaved, notify }: {
  bookingId: string; siteName: string; existing?: ReviewRow; onClose: () => void; onSaved: () => void; notify: (message: string) => void;
}) {
  const [rating, setRating] = useState(existing?.rating ?? 5);
  const [category, setCategory] = useState(existing?.category ?? 'overall_experience');
  const [comment, setComment] = useState(existing?.comment ?? '');
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusable = dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])');
    (focusable?.[0] ?? dialog)?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = dialog.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])');
      if (!focusable.length) { event.preventDefault(); dialog.focus(); return; }
      if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable[focusable.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === focusable[focusable.length - 1]) { event.preventDefault(); focusable[0].focus(); }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => { document.removeEventListener('keydown', handleKeyDown); previous?.focus(); };
  }, []);
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true);
    try {
      const { error } = existing
        ? await db().rpc('update_visitor_review', { p_review_id: existing.id, p_rating: rating, p_category: category, p_comment: comment.trim() })
        : await db().rpc('submit_visitor_review', { p_booking_id: bookingId, p_rating: rating, p_category: category, p_comment: comment.trim() });
      if (error) throw error;
      notify(existing ? 'Review updated. It will appear after moderation.' : 'Review submitted for moderation.'); onSaved();
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not save your review.'); }
    finally { setBusy(false); }
  };
  return <div className="review-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} tabIndex={-1} className="review-dialog" role="dialog" aria-modal="true" aria-labelledby="review-dialog-title">
      <div className="review-dialog-heading"><div><span className="eyebrow"><span className="eyebrow-line"/> VERIFIED VISIT</span><h2 id="review-dialog-title">{existing ? 'Edit your review' : 'Write a review'}</h2><p>{siteName}</p></div><button type="button" className="icon-btn" aria-label="Close review form" onClick={onClose}><X size={18}/></button></div>
      <form onSubmit={(event) => void save(event)}>
        <fieldset className="review-rating-picker"><legend>Your rating</legend><div>{[1, 2, 3, 4, 5].map((value) => <button type="button" key={value} aria-label={`${value} star${value > 1 ? 's' : ''}`} aria-pressed={rating === value} onClick={() => setRating(value)}><Star size={27} fill={value <= rating ? 'currentColor' : 'none'}/></button>)}</div><small>{rating} out of 5</small></fieldset>
        <label>Review category<select value={category} onChange={(event) => setCategory(event.target.value)}>{reviewCategories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Your feedback <span className="field-hint">Optional</span><textarea value={comment} onChange={(event) => setComment(event.target.value)} maxLength={500} rows={5} placeholder="Share helpful details about your visit."/></label>
        <div className="review-form-meta"><small>Only visitors with a completed visit can review. Reviews appear after destination moderation.</small><span>{comment.length}/500</span></div>
        <div className="review-dialog-actions"><button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>Cancel</button><button className="btn btn-primary" disabled={busy}>{busy ? 'Submitting…' : existing ? 'Save review' : 'Submit review'}</button></div>
      </form>
    </section>
  </div>;
}

export function DestinationReviews({ siteId, isVisitor, notify }: { siteId: string; isVisitor: boolean; notify: (message: string) => void }) {
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [summary, setSummary] = useState({ review_count: 0, average_rating: 0 });
  const [reported, setReported] = useState<Set<string>>(new Set());
  const [reporting, setReporting] = useState('');
  const [reason, setReason] = useState('inappropriate');
  const [details, setDetails] = useState('');
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true; setLoading(true); setRows([]); setSummary({ review_count: 0, average_rating: 0 }); setReported(new Set());
    void (async () => {
      const [reviewResult, metricResult] = await Promise.all([
        db().from('reviews').select('id,booking_id,site_id,rating,category,comment,review_status,created_at')
          .eq('site_id', siteId).eq('review_status', 'published').order('created_at', { ascending: false }).limit(100),
        db().from('site_review_metrics').select('review_count,average_rating').eq('site_id', siteId).maybeSingle(),
      ]);
      if (reviewResult.error) throw reviewResult.error;
      if (metricResult.error) throw metricResult.error;
      let ownReports: string[] = [];
      if (isVisitor) {
        const { data, error } = await db().from('review_reports').select('review_id');
        if (error) throw error;
        ownReports = (data ?? []).map((row) => row.review_id);
      }
      if (active) {
        setRows((reviewResult.data ?? []) as ReviewRow[]);
        setSummary({ review_count: Number(metricResult.data?.review_count ?? 0), average_rating: Number(metricResult.data?.average_rating ?? 0) });
        setReported(new Set(ownReports)); setLoading(false);
      }
    })().catch((error) => { if (active) { notify(error instanceof Error ? error.message : 'Could not load destination reviews.'); setLoading(false); } });
    return () => { active = false; };
  }, [siteId, isVisitor, refresh, notify]);
  const report = async (event: FormEvent, reviewId: string) => {
    event.preventDefault();
    try {
      const { error } = await db().rpc('submit_review_report', { p_review_id: reviewId, p_reason: reason, p_details: details.trim() });
      if (error) throw error;
      notify('Report sent to the destination team.'); setReporting(''); setDetails(''); setRefresh((value) => value + 1);
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not send this report.'); }
  };
  return <section className="destination-reviews" aria-labelledby="destination-reviews-title"><div className="destination-reviews-heading"><div><span className="eyebrow"><span className="eyebrow-line"/> VISITOR FEEDBACK</span><h2 id="destination-reviews-title">Ratings &amp; reviews</h2></div><div className="review-score"><Star size={19} fill="currentColor"/><b>{summary.average_rating ? summary.average_rating.toFixed(1) : '—'}</b><span>{summary.review_count} published reviews</span></div></div>
    {loading ? <p className="empty-inline">Loading reviews…</p> : rows.length ? <div className="destination-review-list">{rows.map((row) => <article className="destination-review" key={row.id}><div className="destination-review-top"><span className="review-avatar"><CheckCircle2 size={18}/></span><div><b>Verified visitor</b><small>{dateText(row.created_at)} · {categoryLabel(row.category)}</small></div><span className="review-stars" aria-label={`${row.rating} out of 5 stars`}>{'★'.repeat(row.rating)}<span>{'★'.repeat(5 - row.rating)}</span></span></div>
      {row.comment && <p>{row.comment}</p>}{isVisitor && <div className="review-report-action">{reported.has(row.id) ? <small>Report received</small> : <><button type="button" className="link-btn" aria-expanded={reporting === row.id} onClick={() => setReporting(reporting === row.id ? '' : row.id)}><Flag size={14}/> Report review</button>{reporting === row.id && <form onSubmit={(event) => void report(event, row.id)}><label>Reason<select value={reason} onChange={(event) => setReason(event.target.value)}><option value="inappropriate">Inappropriate</option><option value="inaccurate">Inaccurate</option><option value="spam">Spam</option><option value="other">Other</option></select></label><label>Details (optional)<textarea value={details} onChange={(event) => setDetails(event.target.value)} maxLength={1000} rows={2}/></label><div><button type="button" className="btn btn-outline" onClick={() => setReporting('')}>Cancel</button><button className="btn btn-outline">Send report</button></div></form>}</>}</div>}</article>)}</div> : <div className="empty-inline">No published reviews yet. Reviews from completed visits will appear here.</div>}
  </section>;
}

export function FeedbackManagementPage({ role, sites, notify }: { role: Profile['role']; sites: Site[]; notify: (message: string) => void }) {
  const isOffice = role === 'tourism_office';
  const [selectedSite, setSelectedSite] = useState(isOffice ? 'all' : sites[0]?.id ?? '');
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [reports, setReports] = useState<ReviewReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [rating, setRating] = useState('all');
  const [status, setStatus] = useState('all');
  const [period, setPeriod] = useState('30');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState('');
  const [historyId, setHistoryId] = useState('');
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (isOffice && selectedSite !== 'all' && !sites.some((site) => site.id === selectedSite)) setSelectedSite('all');
    else if (!isOffice && !sites.some((site) => site.id === selectedSite)) setSelectedSite(sites[0]?.id ?? '');
  }, [isOffice, selectedSite, sites]);
  const siteIds = useMemo(() => isOffice && selectedSite === 'all' ? sites.map((site) => site.id) : sites.some((site) => site.id === selectedSite) ? [selectedSite] : [], [isOffice, selectedSite, sites]);
  const siteNames = useMemo(() => new Map(sites.map((site) => [site.id, site.name])), [sites]);
  useEffect(() => {
    let active = true; setLoading(true); setRows([]); setReports([]);
    void (async () => {
      const loaded: ReviewRow[] = [];
      if (siteIds.length) for (let offset = 0; ; offset += 500) {
        const { data, error } = await db().from('reviews').select('id,booking_id,site_id,rating,category,comment,review_status,created_at,moderation_note')
          .in('site_id', siteIds).order('created_at', { ascending: false }).range(offset, offset + 499);
        if (error) throw error;
        loaded.push(...((data ?? []) as ReviewRow[]));
        if (!data || data.length < 500) break;
      }
      const loadedReports: ReviewReport[] = [];
      for (let start = 0; start < loaded.length; start += 500) {
        const ids = loaded.slice(start, start + 500).map((row) => row.id);
        for (let offset = 0; ; offset += 500) {
          const { data, error } = await db().from('review_reports').select('id,review_id,reason,details,status,created_at')
            .in('review_id', ids).order('created_at', { ascending: false }).range(offset, offset + 499);
          if (error) throw error;
          loadedReports.push(...((data ?? []) as ReviewReport[]));
          if (!data || data.length < 500) break;
        }
      }
      if (active) { setRows(loaded); setReports(loadedReports); setLoading(false); }
    })().catch((error) => { if (active) { notify(error instanceof Error ? error.message : 'Could not load feedback.'); setRows([]); setReports([]); setLoading(false); } });
    return () => { active = false; };
  }, [siteIds, refresh, notify]);
  const reportGroups = useMemo(() => {
    const groups = new Map<string, ReviewReport[]>();
    reports.forEach((report) => groups.set(report.review_id, [...(groups.get(report.review_id) ?? []), report]));
    return groups;
  }, [reports]);
  const cutoff = period === 'all' ? 0 : Date.now() - Number(period) * 86400000;
  const periodRows = rows.filter((row) => new Date(row.created_at).getTime() >= cutoff);
  const published = periodRows.filter((row) => row.review_status === 'published');
  const average = published.length ? published.reduce((sum, row) => sum + row.rating, 0) / published.length : 0;
  const pendingReports = reports.filter((report) => report.status === 'pending' && new Date(report.created_at).getTime() >= cutoff);
  const query = search.trim().toLowerCase();
  const visibleRows = periodRows.filter((row) => (rating === 'all' || row.rating === Number(rating))
    && (status === 'all' || row.review_status === status || status === 'reported' && (reportGroups.get(row.id) ?? []).some((report) => report.status === 'pending'))
    && (!query || `${siteNames.get(row.site_id) ?? ''} ${row.comment} ${categoryLabel(row.category)}`.toLowerCase().includes(query)))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const distribution = [5, 4, 3, 2, 1].map((stars) => published.filter((row) => row.rating === stars).length);
  const distributionTotal = distribution.reduce((sum, count) => sum + count, 0);
  const colors = ['#008d8b', '#40aa8a', '#8dc94b', '#f4b844', '#df6252'];
  let percent = 0;
  const ring = distribution.map((count, index) => { const start = percent; percent += distributionTotal ? count / distributionTotal * 100 : 0; return `${colors[index]} ${start}% ${percent}%`; }).join(', ');
  const weekGroups = new Map<number, ReviewRow[]>();
  published.forEach((row) => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(row.created_at));
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    const localDay = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day));
    const monday = localDay - ((new Date(localDay).getUTCDay() + 6) % 7) * 86400000;
    const week = Math.floor(monday / 604800000);
    weekGroups.set(week, [...(weekGroups.get(week) ?? []), row]);
  });
  const trend = [...weekGroups.entries()].sort(([a], [b]) => a - b).slice(-8).map(([week, values]) => ({
    label: new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', timeZone: 'Asia/Manila' }).format(new Date(week * 604800000)),
    value: values.reduce((sum, row) => sum + row.rating, 0) / values.length,
  }));
  const linePoints = trend.map((point, index) => `${trend.length < 2 ? 300 : 24 + index * 552 / (trend.length - 1)},${164 - (point.value - 1) * 32}`).join(' ');
  const moderate = async (row: ReviewRow, nextStatus: 'published' | 'hidden') => {
    setBusyId(row.id);
    try {
      const { error } = await db().rpc('moderate_review', { p_review_id: row.id, p_status: nextStatus, p_note: notes[row.id]?.trim() ?? '' });
      if (error) throw error;
      setNotes((current) => ({ ...current, [row.id]: '' })); setRefresh((value) => value + 1); notify(nextStatus === 'hidden' ? 'Review hidden.' : 'Review published.');
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not moderate this review.'); }
    finally { setBusyId(''); }
  };
  const resolveReport = async (report: ReviewReport, resolution: 'actioned' | 'dismissed') => {
    setBusyId(report.id);
    try {
      const { error } = await db().rpc('resolve_review_report', { p_report_id: report.id, p_status: resolution, p_note: notes[report.review_id]?.trim() ?? '' });
      if (error) throw error;
      setNotes((current) => ({ ...current, [report.review_id]: '' })); setRefresh((value) => value + 1); notify(resolution === 'actioned' ? 'Report marked actioned.' : 'Report dismissed.');
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not resolve this report.'); }
    finally { setBusyId(''); }
  };
  const toggleHistory = async (reviewId: string) => {
    if (historyId === reviewId) { setHistoryId(''); return; }
    setHistoryId(reviewId); setHistory([]);
    const { data, error } = await db().from('review_moderation_history').select('id,actor_id,old_status,new_status,note,created_at').eq('review_id', reviewId).order('created_at', { ascending: false });
    if (error) { notify(error.message); return; }
    setHistory((data ?? []) as HistoryRow[]);
  };
  const exportRows = visibleRows.map((row) => ({ destination: siteNames.get(row.site_id) ?? '', date: row.created_at, rating: row.rating,
    category: categoryLabel(row.category), status: row.review_status, comment: row.comment, reports: (reportGroups.get(row.id) ?? []).length }));
  return <section className="dashboard-page section-wrap feedback-page"><div className="dash-header"><div><span className="eyebrow"><span className="eyebrow-line"/> DESTINATION EXPERIENCE</span><h1>Feedback &amp; <em>reviews.</em></h1><p>{isOffice ? 'Manage feedback for Tourism Office destinations.' : 'Review visitor feedback for your assigned destination.'}</p></div><div className="feedback-header-actions">{(isOffice || sites.length > 1) && <label className="feedback-destination-filter">Destination<select aria-label="Feedback destination" value={selectedSite} onChange={(event) => setSelectedSite(event.target.value)}>{isOffice && <option value="all">All Destinations</option>}{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>}<button className="btn btn-outline" onClick={() => setRefresh((value) => value + 1)}><RefreshCw size={15}/> Refresh</button><button className="btn btn-outline" disabled={loading || !exportRows.length} onClick={() => void exportCsv('iliguide-feedback.csv', exportRows)}><ArrowDownToLine size={15}/> Export</button></div></div>
    {!sites.length ? <div className="empty-card"><MessageSquareText size={28}/><h3>No managed destinations</h3><p>Feedback access follows the destinations assigned to your account.</p></div> : <>
      <div className="feedback-stat-grid"><article><span className="review-score"><Star size={18} fill="currentColor"/><b>{average ? average.toFixed(1) : '—'}</b> / 5</span><small>Average rating</small></article><article><b>{loading ? '…' : periodRows.length}</b><small>Total reviews</small></article><article><b>{loading ? '…' : published.length}</b><small>Published</small></article><article><b>{loading ? '…' : pendingReports.length}</b><small>Open reports</small></article></div>
      <div className="feedback-analytics"><article className="feedback-chart-card"><div className="card-heading"><span><small>RATINGS</small><h3>Rating distribution</h3></span></div><div className="rating-distribution"><div className="rating-donut" style={{ background: `conic-gradient(${ring || '#e7eff2 0 100%'})` }}><span><b>{distributionTotal}</b><small>reviews</small></span></div><div className="rating-bars">{distribution.map((count, index) => <div key={5 - index}><span>{5 - index} <Star size={12} fill="currentColor"/></span><i><b style={{ width: `${distributionTotal ? count / distributionTotal * 100 : 0}%`, background: colors[index] }}/></i><small>{count}</small></div>)}</div></div></article>
        <article className="feedback-chart-card"><div className="card-heading"><span><small>PUBLISHED REVIEWS</small><h3>Average rating trend</h3></span></div>{trend.length ? <><svg className="feedback-trend-chart" viewBox="0 0 600 205" role="img" aria-label="Average weekly review rating over time"><path d="M24 36H576M24 100H576M24 164H576"/><polyline points={linePoints}/>{trend.map((point, index) => { const x = trend.length < 2 ? 300 : 24 + index * 552 / (trend.length - 1); const y = 164 - (point.value - 1) * 32; return <g key={point.label}><circle cx={x} cy={y} r="4"><title>{point.label}: {point.value.toFixed(1)} stars</title></circle>{trend.length < 7 || index % 2 === 0 || index === trend.length - 1 ? <text x={x} y="194" textAnchor="middle">{point.label}</text> : null}</g>; })}</svg><div className="trend-axis-labels"><span>5.0</span><span>3.0</span><span>1.0</span></div></> : <p className="empty-inline">Published reviews will build this trend.</p>}</article></div>
      <section className="feedback-list-panel"><div className="feedback-list-heading"><div><span className="eyebrow"><span className="eyebrow-line"/> MODERATION WORKSPACE</span><h2>Visitor reviews</h2></div><span>{loading ? 'Loading…' : `${visibleRows.length} shown`}</span></div>
        <div className="feedback-filters"><label className="feedback-search"><Search size={15}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search reviews" aria-label="Search reviews"/></label><label>Rating<select value={rating} onChange={(event) => setRating(event.target.value)}><option value="all">All ratings</option>{[5, 4, 3, 2, 1].map((value) => <option key={value} value={value}>{value} stars</option>)}</select></label><label>Status<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option><option value="pending">Pending</option><option value="published">Published</option><option value="hidden">Hidden</option><option value="reported">Reported</option></select></label><label>Period<select value={period} onChange={(event) => setPeriod(event.target.value)}><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="all">All time</option></select></label></div>
        {loading ? <p className="empty-inline">Loading scoped feedback…</p> : !visibleRows.length ? <p className="empty-inline">No reviews match these filters.</p> : <div className="feedback-review-list">{visibleRows.map((row) => { const rowReports = reportGroups.get(row.id) ?? []; const openReports = rowReports.filter((report) => report.status === 'pending'); return <article className="feedback-review" key={row.id}><div className="feedback-review-header"><div><span className="review-stars" aria-label={`${row.rating} out of 5 stars`}>{'★'.repeat(row.rating)}<span>{'★'.repeat(5 - row.rating)}</span></span><b>{siteNames.get(row.site_id) ?? 'Destination'}</b><small>{dateText(row.created_at)} · {categoryLabel(row.category)}</small></div><span className={`feedback-status feedback-status-${row.review_status}`}>{row.review_status}</span></div>{row.comment && <p>{row.comment}</p>}
          {!!rowReports.length && <div className="feedback-reports"><b><Flag size={14}/> {openReports.length} open report{openReports.length === 1 ? '' : 's'}</b>{rowReports.map((report) => <div className="feedback-report" key={report.id}><span>{reportLabel(report.reason)}{report.details && ` · ${report.details}`}</span><small>{report.status} · {dateText(report.created_at)}</small>{report.status === 'pending' && <div><button type="button" className="link-btn" disabled={Boolean(busyId)} onClick={() => void resolveReport(report, 'dismissed')}>Dismiss</button><button type="button" className="link-btn" disabled={Boolean(busyId)} onClick={() => void resolveReport(report, 'actioned')}>Mark actioned</button></div>}</div>)}</div>}
          <div className="feedback-review-actions"><label className="feedback-note">Moderator note<input value={notes[row.id] ?? ''} onChange={(event) => setNotes((current) => ({ ...current, [row.id]: event.target.value }))} maxLength={1000} placeholder="Optional note"/></label>{row.review_status === 'published' ? <button className="btn btn-outline" disabled={Boolean(busyId)} onClick={() => void moderate(row, 'hidden')}>Hide review</button> : <button className="btn btn-primary" disabled={Boolean(busyId)} onClick={() => void moderate(row, 'published')}>{row.review_status === 'hidden' ? 'Restore review' : 'Publish review'}</button>}<button type="button" className="link-btn" aria-expanded={historyId === row.id} onClick={() => void toggleHistory(row.id)}><History size={14}/> History</button></div>
          {historyId === row.id && <div className="feedback-history">{history.length ? history.map((entry) => <p key={entry.id}><b>{entry.old_status} → {entry.new_status}</b><span>{dateText(entry.created_at)}{entry.note ? ` · ${entry.note}` : ''}</span></p>) : <small>No moderation actions recorded.</small>}</div>}
        </article>; })}</div>}
      </section>
    </>}
  </section>;
}
