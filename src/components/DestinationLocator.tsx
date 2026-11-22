import { useEffect, useMemo, useRef, useState } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Layers, MapPin, RefreshCw } from 'lucide-react';
import { capacityHeatOpacity, capacityStatus, formatCapacityPercent, operatingStatus } from '../lib/capacity';
import type { Site } from '../lib/iliguide';
import { useLiveCapacity } from '../lib/useLiveCapacity';
import OccupancyPanel from './OccupancyPanel';
import './DestinationMap.css';
import './DestinationLocator.css';

type Props = { sites: Site[]; openSite: (site: Site) => void; bookSite: (site: Site) => void; visitDate: string; setVisitDate: (date: string) => void; visitorCount: number };
const located = (site: Site) => site.latitude != null && site.longitude != null
  && Number.isFinite(site.latitude) && Number.isFinite(site.longitude)
  && Math.abs(site.latitude) <= 90 && Math.abs(site.longitude) <= 180;

export default function DestinationLocator({ sites, openSite, bookSite, visitDate, setVisitDate, visitorCount }: Props) {
  const mappedSites = useMemo(() => sites.filter((site) => site.status === 'published' && located(site)), [sites]);
  const [selectedId, setSelectedId] = useState('');
  const [heatMode, setHeatMode] = useState(true);
  const [mobileView, setMobileView] = useState<'map' | 'details'>('map');
  const selected = mappedSites.find((site) => site.id === selectedId) ?? mappedSites[0];
  const feed = useLiveCapacity(mappedSites.map((site) => site.id));
  const mapNode = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.LayerGroup | null>(null);
  const openRef = useRef(openSite);
  openRef.current = openSite;

  useEffect(() => {
    if (!mapNode.current || !mappedSites.length) return;
    const map = L.map(mapNode.current, { scrollWheelZoom: false });
    L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    }).addTo(map);
    const bounds = L.latLngBounds(mappedSites.map((site) => [site.latitude!, site.longitude!] as L.LatLngTuple));
    map.fitBounds(bounds.pad(.3), { maxZoom: 14 });
    const layers = L.layerGroup().addTo(map);
    mapRef.current = map;
    layersRef.current = layers;
    const resize = window.setTimeout(() => map.invalidateSize(), 100);
    return () => { window.clearTimeout(resize); map.remove(); mapRef.current = null; layersRef.current = null; };
  }, [mappedSites]);

  useEffect(() => {
    const layers = layersRef.current;
    if (!layers) return;
    layers.clearLayers();
    mappedSites.forEach((site) => {
      const position: L.LatLngTuple = [site.latitude!, site.longitude!];
      const occupancy = feed.state === 'ready' || feed.state === 'stale' ? feed.rows[site.id] : null;
      const status = capacityStatus(occupancy);
      if (heatMode && status.percent != null && !['unknown', 'unconfigured'].includes(status.level)) L.marker(position, {
        icon: L.divIcon({ className: `site-heat site-heat-${status.level}`, html: `<span style="--heat-opacity:${capacityHeatOpacity(status.percent)}"></span>`, iconSize: [112, 112], iconAnchor: [56, 56] }), interactive: false,
      }).addTo(layers);
      const marker = L.marker(position, {
        icon: L.divIcon({ className: `capacity-pin capacity-pin-${status.level}${site.id === selected?.id ? ' capacity-pin-selected' : ''}`, html: '<span></span>', iconSize: [27, 36], iconAnchor: [13, 32] }),
        title: `${site.name}: ${status.label}`, alt: `${site.name} destination`, keyboard: true,
      }).addTo(layers);
      const popup = document.createElement('div');
      const name = document.createElement('strong'); name.textContent = site.name;
      const count = document.createElement('p'); count.textContent = occupancy
        ? `${occupancy.current_visitor_count} / ${status.limit ?? 'capacity not configured'} ${status.basis === 'estimated' ? 'provisional map estimate' : 'approved maximum'}${status.percent != null ? ` · ${formatCapacityPercent(status.percent)}` : ''}`
        : 'Capacity Data Unavailable';
      const level = document.createElement('p'); level.textContent = `${status.label} · ${operatingStatus(site)}`;
      const button = document.createElement('button'); button.type = 'button'; button.textContent = 'View Destination';
      button.addEventListener('click', () => openRef.current(site));
      popup.append(name, count, level, button);
      marker.bindPopup(popup).on('click', () => { setSelectedId(site.id); setMobileView('details'); });
    });
  }, [mappedSites, feed.rows, feed.state, heatMode, selected?.id]);

  useEffect(() => { if (mobileView === 'map') window.setTimeout(() => mapRef.current?.invalidateSize(), 80); }, [mobileView]);

  return <section className="destination-locator section-wrap">
    <div className="section-heading"><div><span className="eyebrow"><span className="eyebrow-line"/> LIVE DESTINATION CAPACITY</span><h1>Explore the <em>capacity map.</em></h1><p>Destination-level attendance, updated as arrivals and departures are recorded.</p></div></div>
    {!mappedSites.length ? <div className="empty-state"><MapPin size={32}/><h3>Map locations are not available yet</h3><p>Published destinations need recorded coordinates to appear here.</p></div> : <>
      <div className="locator-mobile-switch" role="group" aria-label="Map or destination details"><button aria-pressed={mobileView === 'map'} onClick={() => setMobileView('map')}>Capacity map</button><button aria-pressed={mobileView === 'details'} onClick={() => setMobileView('details')}>Destination details</button></div>
      <div className="locator-layout"><div className={`locator-map-column${mobileView === 'details' ? ' locator-mobile-hidden' : ''}`}>
        <div className="locator-toolbar"><div role="group" aria-label="Map display"><button aria-pressed={heatMode} onClick={() => setHeatMode(true)}><Layers size={15}/> Capacity Heatmap</button><button aria-pressed={!heatMode} onClick={() => setHeatMode(false)}><MapPin size={15}/> Standard Markers</button></div><button onClick={() => void feed.refresh()} aria-label="Refresh capacity map"><RefreshCw size={15}/></button></div>
        <div className="locator-map" ref={mapNode} role="application" aria-label="Interactive map of destination capacity"/>
        <div className="locator-legend" aria-label="Crowd level legend"><b>Crowd level</b>{[['available', 'Available'], ['near', 'Near Capacity'], ['almost', 'Almost Full'], ['critical', 'Full / Overcrowded'], ['unknown', 'Unknown / not configured']].map(([level, label]) => <span key={level}><i className={`map-legend-level map-legend-${level}`}/>{label}</span>)}</div>
        <p className="locator-note">Capacity information is estimated from recorded visitor arrivals and departures. Individual visitor locations are not tracked. {feed.state === 'stale' ? 'Live update interrupted; refresh to retry.' : feed.state === 'unavailable' ? 'Capacity Data Unavailable.' : ''}{feed.updatedAt ? ` Last successful update: ${new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' }).format(new Date(feed.updatedAt))}.` : ''}</p>
        {sites.some((site) => site.status === 'published' && !located(site)) && <p className="locator-note">Some destinations have no recorded coordinates and are omitted from the map.</p>}
      </div><div className={`locator-details${mobileView === 'map' ? ' locator-mobile-hidden' : ''}`}>
        <div className="locator-list" aria-label="Mapped destinations">{mappedSites.map((site) => { const status = capacityStatus(feed.state === 'ready' || feed.state === 'stale' ? feed.rows[site.id] : null); return <button key={site.id} className={site.id === selected?.id ? 'selected' : ''} onClick={() => { setSelectedId(site.id); mapRef.current?.panTo([site.latitude!, site.longitude!]); }}><span className={`map-legend-level map-legend-${status.level}`}/><span><b>{site.name}</b><small>{status.label}{status.percent != null ? ` · ${Math.round(status.percent)}%` : ''}</small></span></button>; })}</div>
        {selected && <article className="locator-selected">{selected.images[0] && <img src={selected.images[0].public_url} alt={selected.images[0].alt_text || selected.name}/>}<div className="locator-selected-heading"><div><small>{selected.category} · {selected.address || 'Iligan City'}</small><h2>{selected.name}</h2></div><button className="btn btn-outline btn-sm" onClick={() => openSite(selected)}>View Destination</button></div><OccupancyPanel site={selected} sites={sites} onOpen={openSite} onBook={bookSite} visitDate={visitDate} setVisitDate={setVisitDate} visitorCount={visitorCount}/></article>}
      </div></div>
    </>}
  </section>;
}
