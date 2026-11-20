import { useEffect, useState } from 'react';
import { AlertTriangle, Users } from 'lucide-react';
import { loadLiveOccupancy, type LiveOccupancy, type Site } from '../lib/iliguide';
import './OccupancyPanel.css';

type Props = { site: Site; sites: Site[]; onOpen: (site: Site) => void };

const stamp = (value: string) => new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila',
}).format(new Date(value));

export default function OccupancyPanel({ site, sites, onOpen }: Props) {
  const [occupancy, setOccupancy] = useState<LiveOccupancy | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');

  useEffect(() => {
    let mounted = true;
    setState('loading');
    void loadLiveOccupancy(site.id).then((row) => {
      if (!mounted) return;
      setOccupancy(row);
      setState(row ? 'ready' : 'unavailable');
    }).catch(() => { if (mounted) setState('unavailable'); });
    return () => { mounted = false; };
  }, [site.id]);

  if (state === 'loading') return <section className="occupancy-panel" aria-busy="true"><small>RECORDED SITE STATUS</small><p>Loading recorded attendance…</p></section>;
  if (state === 'unavailable') return <section className="occupancy-panel"><small>RECORDED SITE STATUS</small><p>Occupancy information is not available yet.</p></section>;
  if (!occupancy) return <section className="occupancy-panel"><small>RECORDED SITE STATUS</small><p>Occupancy information is not available yet.</p></section>;

  const limitReached = occupancy.approved_visitor_limit !== null && occupancy.current_visitor_count >= occupancy.approved_visitor_limit;
  const percent = occupancy.approved_visitor_limit ? Math.min(100, Math.round(occupancy.current_visitor_count / occupancy.approved_visitor_limit * 100)) : null;
  const alternatives = limitReached ? sites.filter((item) => item.id !== site.id).slice(0, 3) : [];
  return <section className="occupancy-panel">
    <small>RECORDED SITE STATUS</small>
    <div className="occupancy-number"><Users size={22}/><span><b>{occupancy.current_visitor_count}</b><em>estimated visitors currently inside</em></span></div>
    <div className="occupancy-breakdown"><span><b>{occupancy.arrivals_today}</b> arrivals today</span><span><b>{occupancy.departures_today}</b> departures today</span></div>
    {occupancy.approved_visitor_limit !== null ? <><div className="occupancy-progress" aria-label={`${percent}% of the approved visitor limit`}><i style={{ width: `${percent}%` }}/></div>
      <p>{percent}% of approved limit ({occupancy.approved_visitor_limit})</p></>
      : occupancy.capacity_estimate !== null ? <p>Physical estimate: {occupancy.capacity_estimate}. Operational visitor limit not confirmed.</p>
        : <p>Operational visitor limit not confirmed.</p>}
    <p className="occupancy-update">{occupancy.last_recorded_at ? <>Last recorded arrival or departure: {stamp(occupancy.last_recorded_at)}.</> : 'No attendance events recorded yet.'}</p>
    <p className="occupancy-source">Count is estimated from recorded arrivals and departures.</p>
    {limitReached && <div className="occupancy-limit"><AlertTriangle size={17}/><span>This destination has reached its approved visitor limit for the current period.</span></div>}
    {!!alternatives.length && <div className="occupancy-alternatives"><b>Other destinations</b>{alternatives.map((item) => <button key={item.id} onClick={() => onOpen(item)}>{item.name}<span>Check schedule</span></button>)}</div>}
  </section>;
}
