import { useState } from 'react';
import { AlertTriangle, ArrowRight, RefreshCw, Users } from 'lucide-react';
import { capacityStatus, operatingStatus } from '../lib/capacity';
import type { Site } from '../lib/iliguide';
import { useCapacityRecommendations } from '../lib/useCapacityRecommendations';
import { useLiveCapacity } from '../lib/useLiveCapacity';
import './OccupancyPanel.css';

type Props = { site: Site; sites: Site[]; onOpen: (site: Site) => void; onBook: (site: Site) => void; visitDate: string; setVisitDate: (date: string) => void; visitorCount: number };
const stamp = (value: string) => new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila',
}).format(new Date(value));

export default function OccupancyPanel({ site, sites, onOpen, onBook, visitDate, setVisitDate, visitorCount }: Props) {
  const feed = useLiveCapacity(sites.filter((item) => item.status === 'published').map((item) => item.id));
  const occupancy = feed.rows[site.id] ?? null;
  const crowd = capacityStatus(feed.state === 'ready' || feed.state === 'stale' ? occupancy : null);
  const { recommendations, loading } = useCapacityRecommendations(site, sites, feed.state === 'ready' ? feed.rows : {}, visitDate, visitorCount);
  const [showMore, setShowMore] = useState(false);
  const messages = {
    available: 'This destination currently has available capacity.',
    near: 'This destination is getting busy. You may continue your booking or explore less crowded destinations.',
    almost: 'This destination is approaching its maximum capacity. Consider visiting another destination for a more comfortable experience.',
    critical: 'This destination is currently very crowded. Consider choosing another available destination.',
    unconfigured: 'Capacity Not Configured. Recorded attendance is shown without an occupancy percentage.',
    unknown: 'Capacity Data Unavailable. Please try refreshing.',
  };
  const limit = crowd.limit;
  const count = occupancy?.current_visitor_count;
  return <section className={`occupancy-panel occupancy-${crowd.level}`}>
    <div className="occupancy-heading"><small>LIVE DESTINATION CAPACITY</small><button type="button" onClick={() => void feed.refresh()} aria-label="Refresh capacity"><RefreshCw size={15}/></button></div>
    <div className="occupancy-status"><span className="occupancy-dot"/><b>{feed.state === 'loading' ? 'Loading recorded attendance…' : crowd.label}</b></div>
    {count != null && feed.state !== 'unavailable' && <>
      <div className="occupancy-number"><Users size={22}/><span><b>{count.toLocaleString()}</b><em>recorded visitors currently inside{limit != null ? ` / ${limit.toLocaleString()} ${crowd.basis === 'estimated' ? 'provisional map estimate' : 'approved maximum'}` : ''}</em></span></div>
      <div className="occupancy-breakdown"><span><b>{occupancy?.arrivals_today ?? 0}</b> arrivals today</span><span><b>{occupancy?.departures_today ?? 0}</b> departures today</span></div>
      {crowd.percent != null && <><div className="occupancy-progress" role="progressbar" aria-label={crowd.basis === 'estimated' ? 'Recorded occupancy against provisional map estimate' : 'Recorded occupancy against approved maximum'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(crowd.percent))}><i style={{ width: `${Math.min(100, crowd.percent)}%` }}/></div><p>{Math.round(crowd.percent)}% of {crowd.basis === 'estimated' ? 'provisional map estimate' : 'approved maximum'} · {Math.max(0, limit! - count)} {crowd.basis === 'estimated' ? 'below estimate' : 'spaces remaining'}</p></>}
    </>}
    <p className="occupancy-message">{feed.state === 'loading' ? 'Checking recorded arrivals and departures.' : messages[crowd.level]}</p>
    {crowd.level === 'critical' && crowd.percent !== null && crowd.percent < 100 && <p>{crowd.basis === 'estimated' ? 'Critical estimate-based warning; this does not restrict admission.' : 'Critical crowd warning; approved maximum has not yet been reached.'}</p>}
    {crowd.percent !== null && crowd.percent >= 100 && <div className="occupancy-limit"><AlertTriangle size={17}/><span>{crowd.basis === 'estimated' ? 'Provisional estimate reached. This advisory does not restrict admission.' : 'Approved maximum reached. New admissions are restricted.'}</span></div>}
    {crowd.basis === 'estimated' && <p className="occupancy-source">Map percentage uses a provisional estimate. It does not set booking capacity or block entry.</p>}
    {feed.state === 'stale' && <div className="occupancy-limit"><AlertTriangle size={17}/><span>Live connection interrupted. Last successful update shown below; recommendations paused.</span></div>}
    <p className="occupancy-update">{feed.updatedAt ? `Last successful update: ${stamp(feed.updatedAt)}` : 'No successful update yet.'} · {operatingStatus(site)}</p>
    <p className="occupancy-source">Estimated from recorded arrivals and departures. Individual visitor locations are not tracked.</p>
    <label className="occupancy-visit-date">Planned visit date<input type="date" value={visitDate} min={new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())} onChange={(event) => setVisitDate(event.target.value)}/></label>
    {['near', 'almost', 'critical'].includes(crowd.level) && <div className="occupancy-alternatives"><div><b>Recommended Alternative Destinations</b><p>Explore less crowded destinations that are available for your visit.</p></div>
      {loading ? <p>Checking availability for {visitDate}…</p> : recommendations.length ? <>{recommendations.slice(0, showMore ? undefined : 3).map((item) => {
        const alternative = feed.rows[item.id]!;
        const status = capacityStatus(alternative);
        return <article className="occupancy-alternative" key={item.id}>
          {item.images[0] && <img src={item.images[0].public_url} alt={item.images[0].alt_text || item.name}/>}
          <div><b>{item.name}</b><small>{item.address || 'Iligan City'} · Open on planned date</small><small>{alternative.current_visitor_count} / {status.limit} recorded onsite · {Math.round(status.percent!)}% {status.basis === 'estimated' ? 'estimated' : 'approved'} · {status.label}</small><small>Booking available for {visitDate}</small></div>
          <div className="occupancy-alternative-actions"><button type="button" onClick={() => onOpen(item)}>View Destination</button><button type="button" onClick={() => onBook(item)}>Book This Instead <ArrowRight size={14}/></button></div>
        </article>;
      })}{recommendations.length > 3 && <button type="button" className="occupancy-more" onClick={() => setShowMore(!showMore)}>{showMore ? 'Show fewer' : `View ${recommendations.length - 3} more`}</button>}</> : <p>No eligible alternative has verified booking availability for {visitDate}.</p>}
    </div>}
  </section>;
}
