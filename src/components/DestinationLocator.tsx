import { lazy, Suspense, useMemo, useState } from 'react';
import { MapPin } from 'lucide-react';
import type { Site } from '../lib/iliguide';
import './DestinationLocator.css';

const DestinationMap = lazy(() => import('./DestinationMap'));
type Props = { sites: Site[]; openSite: (site: Site) => void };

export default function DestinationLocator({ sites, openSite }: Props) {
  const mappedSites = useMemo(() => sites.filter((site) => site.latitude !== null && site.longitude !== null), [sites]);
  const [selectedId, setSelectedId] = useState(mappedSites[0]?.id ?? '');
  const selected = mappedSites.find((site) => site.id === selectedId) ?? mappedSites[0];

  return <section className="destination-locator section-wrap">
    <div className="section-heading"><div><span className="eyebrow"><span className="eyebrow-line"/> DESTINATION LOCATOR</span><h1>Find your <em>next stop.</em></h1>
      <p>Select a destination to view its recorded location on satellite imagery.</p></div></div>
    {!mappedSites.length ? <div className="empty-state"><MapPin size={32}/><h3>Map locations are not available yet</h3><p>Destination teams can add coordinates in the staff workspace.</p></div>
      : <div className="locator-layout"><div className="locator-list" aria-label="Mapped destinations">
        {mappedSites.map((site) => <button key={site.id} className={site.id === selected?.id ? 'selected' : ''} onClick={() => setSelectedId(site.id)}>
          <MapPin size={17}/><span><b>{site.name}</b><small>{site.address || 'Address not provided'}</small></span></button>)}
      </div><div className="locator-map">
        <Suspense fallback={<div className="destination-map-placeholder" role="status">Loading interactive map…</div>}><DestinationMap site={selected} compact/></Suspense>
        <div className="locator-map-actions"><span><MapPin size={16}/>{selected.name}</span><button className="btn btn-primary btn-sm" onClick={() => openSite(selected)}>View details</button></div>
      </div></div>}
  </section>;
}
