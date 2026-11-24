import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Megaphone, RefreshCw } from 'lucide-react';
import { db } from '../lib/iliguide';
import type { Site } from '../lib/iliguide';
import './VisitorPlanningHub.css';
import './VisitorAnnouncements.css';

type Row = { id: string; announcement_group_id: string; site_id: string; title: string; body: string; body_preview: string; category: string; published_at: string; updated_at: string; expires_at: string | null };
type Announcement = Omit<Row, 'site_id'> & { siteIds: string[] };
const pageSize = 30;
const categories = ['general', 'operating_hours', 'closure', 'booking', 'safety', 'guideline'];
const categoryNames: Record<string, string> = { general: 'General update', operating_hours: 'Operating hours', closure: 'Closure', booking: 'Booking', safety: 'Site advisory', guideline: 'Visitor guidelines' };
const categoryName = (value: string) => categoryNames[value] ?? 'General update';
const dateLabel = (value: string) => new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium' }).format(new Date(value));
const announcementRows = (rows: Row[]): Announcement[] => {
  const groups = new Map<string, Announcement>();
  for (const { site_id, ...row } of rows) {
    const key = row.announcement_group_id || row.id;
    const group = groups.get(key);
    if (group) {
      if (!group.siteIds.includes(site_id)) group.siteIds.push(site_id);
    } else groups.set(key, { ...row, siteIds: [site_id] });
  }
  return [...groups.values()];
};

export default function VisitorAnnouncementPages({ announcementId, sites, sitesLoaded }: {
  announcementId: string; sites: Site[]; sitesLoaded: boolean;
}) {
  const location = useLocation();
  const [rows, setRows] = useState<Row[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [destinationFilter, setDestinationFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [detail, setDetail] = useState<Row | null>(null);
  const [detailState, setDetailState] = useState<'loading' | 'ready' | 'missing' | 'failed'>('loading');
  const publicSites = useMemo(() => sites.filter((site) => site.status === 'published'), [sites]);
  const siteIds = useMemo(() => publicSites.map((site) => site.id), [publicSites]);
  const siteKey = siteIds.join(',');
  const now = () => new Date().toISOString();

  useEffect(() => {
    if (announcementId || !sitesLoaded) return;
    let active = true;
    setRows([]); setOffset(0); setHasMore(false); setFailed(false); setLoading(true);
    if (!siteIds.length) { setLoading(false); return () => { active = false; }; }
    const current = now();
    void (async () => {
      try {
        const { data, error } = await db().from('site_announcements').select('id,announcement_group_id,site_id,title,body_preview,category,published_at,updated_at,expires_at')
          .in('site_id', siteIds).eq('status', 'published').lte('published_at', current)
          .or(`expires_at.is.null,expires_at.gt.${current}`).order('published_at', { ascending: false })
          .order('announcement_group_id').range(0, pageSize - 1);
        if (error) throw error;
        if (active) { const batch = (data ?? []) as Row[]; setRows(batch); setOffset(batch.length); setHasMore(batch.length === pageSize); }
      } catch { if (active) setFailed(true); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [announcementId, siteKey, sitesLoaded, reload]);

  useEffect(() => {
    if (!announcementId || !sitesLoaded) return;
    let active = true;
    setDetail(null); setDetailState('loading');
    const current = now();
    void (async () => {
      const { data, error } = await db().from('site_announcements')
        .select('id,announcement_group_id,site_id,title,body,body_preview,category,published_at,updated_at,expires_at')
        .eq('id', announcementId).eq('status', 'published').lte('published_at', current)
        .or(`expires_at.is.null,expires_at.gt.${current}`).maybeSingle();
      if (error) throw error;
      if (!data) { if (active) setDetailState('missing'); return; }
      if (active) { setDetail(data as Row); setDetailState('ready'); }
    })().catch(() => { if (active) setDetailState('failed'); });
    return () => { active = false; };
  }, [announcementId, sitesLoaded, reload]);

  const updates = useMemo(() => announcementRows(rows), [rows]);
  const filtered = updates.filter((item) => (!destinationFilter || item.siteIds.includes(destinationFilter))
    && (!categoryFilter || item.category === categoryFilter));
  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const current = now();
    try {
      const { data, error } = await db().from('site_announcements').select('id,announcement_group_id,site_id,title,body_preview,category,published_at,updated_at,expires_at')
        .in('site_id', siteIds).eq('status', 'published').lte('published_at', current)
        .or(`expires_at.is.null,expires_at.gt.${current}`).order('published_at', { ascending: false })
        .order('announcement_group_id').range(offset, offset + pageSize - 1);
      if (error) throw error;
      const batch = (data ?? []) as Row[];
      setRows((previous) => [...previous, ...batch]); setOffset((value) => value + batch.length); setHasMore(batch.length === pageSize);
    } catch { setFailed(true); }
    finally { setLoadingMore(false); }
  };

  const retry = () => setReload((value) => value + 1);
  const header = <header className="visitor-announcement-heading"><span className="eyebrow"><span className="eyebrow-line"/> ILIGAN CITY · DESTINATION NEWS</span><h1 id="updates-page-title">Destination <em>updates.</em></h1><p>Announcements and important updates from destinations.</p></header>;
  if (!announcementId) return <section className="visitor-announcement-page section-wrap" aria-labelledby="updates-page-title">
    <Link className="visitor-announcement-back" to="/discover#destination-updates"><ArrowLeft size={15}/> Back to Destination Updates</Link>
    {header}
    <div className="visitor-announcement-filters"><label>Destination<select value={destinationFilter} onChange={(event) => setDestinationFilter(event.target.value)}><option value="">All destinations</option>{publicSites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label><label>Category<select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="">All categories</option>{categories.map((category) => <option key={category} value={category}>{categoryName(category)}</option>)}</select></label><button type="button" className="visitor-refresh" aria-label="Refresh destination updates" onClick={retry} disabled={loading}><RefreshCw size={16}/></button></div>
    {loading || !sitesLoaded ? <div className="visitor-planning-skeleton" role="status" aria-label="Loading destination updates"><i/><i/><i/></div>
      : failed ? <div className="visitor-announcement-empty" role="alert"><p>Could not load destination updates.</p><button className="btn btn-outline" onClick={retry}>Retry <RefreshCw size={14}/></button></div>
      : filtered.length ? <div className="visitor-announcement-list">{filtered.map((item) => {
        return <article className="visitor-announcement-card" key={item.id}><span className="visitor-update-icon"><Megaphone size={19}/></span><div><h2>{item.title}</h2><p className="visitor-announcement-preview">{item.body_preview}</p><small className="visitor-update-date">Published {dateLabel(item.published_at)}</small><Link className="visitor-update-link" to={`/announcements/${encodeURIComponent(item.id)}`} state={{ from: '/announcements' }}>See Details <ArrowRight size={14}/></Link></div></article>;
      })}</div> : <div className="visitor-announcement-empty"><Megaphone size={25}/><p>{updates.length ? 'No updates match these filters.' : 'No destination updates are available at the moment.'}</p></div>}
    {hasMore && !loading && !failed && <button className="btn btn-outline visitor-announcement-more" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load more updates'} <ArrowRight size={14}/></button>}
  </section>;

  const back = (location.state as { from?: unknown } | null)?.from;
  const backTo = typeof back === 'string' && back.startsWith('/') && !back.startsWith('//') ? back : '/announcements';
  return <section className="visitor-announcement-page visitor-announcement-detail section-wrap">
    <Link className="visitor-announcement-back" to={backTo}><ArrowLeft size={15}/> Back to Destination Updates</Link>
    {detailState === 'loading' && <div className="visitor-planning-skeleton" role="status" aria-label="Loading announcement"><i/><i/><i/></div>}
    {detailState === 'failed' && <div className="visitor-announcement-empty" role="alert"><p>Could not load this announcement.</p><button className="btn btn-outline" onClick={retry}>Retry <RefreshCw size={14}/></button></div>}
    {detailState === 'missing' && <div className="visitor-announcement-empty"><Megaphone size={25}/><p>This announcement is no longer available.</p></div>}
    {detailState === 'ready' && detail && <article className="visitor-announcement-reading"><h1>{detail.title}</h1><div className="visitor-announcement-meta"><span>Published {dateLabel(detail.published_at)}</span>{Date.parse(detail.updated_at) > Date.parse(detail.published_at) + 60_000 && <span>Updated {dateLabel(detail.updated_at)}</span>}</div><div className="visitor-announcement-body">{detail.body}</div></article>}
  </section>;
}
