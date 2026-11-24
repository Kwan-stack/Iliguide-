import { useEffect, useMemo, useRef, useState } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { CalendarDays, Clock3, Layers, Map as MapIcon, MapPin, RefreshCw, Users } from 'lucide-react';
import { capacityStatus, formatCapacityPercent, isScheduledOpen, operatingStatus } from '../lib/capacity';
import type { LiveOccupancy, Site, SiteCapacityForDate, Slot } from '../lib/iliguide';
import { useLiveCapacity } from '../lib/useLiveCapacity';
import { usePlannedCapacity } from '../lib/usePlannedCapacity';
import OccupancyPanel from './OccupancyPanel';
import './DestinationMap.css';
import './DestinationLocator.css';

type Mode = 'live' | 'planned';
type MapLevel = 'available' | 'moderate' | 'critical' | 'full' | 'unavailable' | 'unknown';
type MapStatus = { level: MapLevel; label: string; percent: number | null; limit: number | null; count: number | null; spaces: number | null; basis: string; fitsGroup: boolean; slotCapacity: number | null };
type Props = { sites: Site[]; audience?: 'visitor' | 'staff'; openSite?: (site: Site) => void; bookSite?: (site: Site, preferredStart?: string) => void; visitDate?: string; setVisitDate?: (date: string) => void; visitorCount?: number; setVisitorCount?: (count: number) => void };
const located = (site: Site) => site.latitude != null && site.longitude != null
  && Number.isFinite(site.latitude) && Number.isFinite(site.longitude)
  && Math.abs(site.latitude) <= 90 && Math.abs(site.longitude) <= 180;
const todayManila = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
const dateAfter = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const slotKey = (slot: Pick<Slot, 'starts_at' | 'ends_at'>) => `${slot.starts_at.slice(0, 5)}|${slot.ends_at.slice(0, 5)}`;
const timeText = (value: string) => new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(new Date(`1970-01-01T${value.slice(0, 5)}:00Z`));

function classify(percent: number, occupancy?: LiveOccupancy | SiteCapacityForDate | null): MapLevel {
  if (percent >= 100) return 'full';
  if (percent >= (occupancy?.almost_threshold_percent ?? 85)) return 'critical';
  if (percent >= (occupancy?.near_threshold_percent ?? 70)) return 'moderate';
  return 'available';
}

function statusFor(site: Site, mode: Mode, live: LiveOccupancy | null, planned: SiteCapacityForDate | null, slots: Slot[], date: string, selectedSlot: string, groupSize: number): MapStatus {
  const unknown: MapStatus = { level: 'unknown', label: 'Capacity Unavailable', percent: null, limit: null, count: null, spaces: null, basis: 'unknown', fitsGroup: false, slotCapacity: null };
  const unavailable = (label = 'Unavailable'): MapStatus => ({ ...unknown, level: 'unavailable', label });
  if (site.status !== 'published') return unavailable('Inactive');

  if (mode === 'live') {
    if (!live || !Number.isFinite(live.current_visitor_count)) return unknown;
    const capacity = capacityStatus(live);
    if (capacity.limit == null || !Number.isFinite(capacity.limit) || capacity.limit <= 0) {
      return { ...unknown, label: 'Capacity Not Configured', count: live.current_visitor_count };
    }
    const percent = live.current_visitor_count * 100 / capacity.limit;
    const level = classify(percent, live);
    return { level, label: levelName(level), percent, limit: capacity.limit, count: live.current_visitor_count,
      spaces: Math.max(0, capacity.limit - live.current_visitor_count), basis: capacity.basis, fitsGroup: true, slotCapacity: null };
  }

  const time = selectedSlot === 'any' ? undefined : selectedSlot.split('|')[0];
  if (!isScheduledOpen(site, date, time)) return unavailable('Closed for selected schedule');
  if (!planned) return unknown;
  const capacity = planned;
  const capacityInfo = capacityStatus({ ...capacity, current_visitor_count: capacity.projected_visitor_count });
  if (capacityInfo.limit == null || !Number.isFinite(capacityInfo.limit) || capacityInfo.limit <= 0) return unknown;
  const eligibleSlots = slots.filter((slot) => slot.status === 'open' && (selectedSlot === 'any' || slotKey(slot) === selectedSlot));
  if (!eligibleSlots.length) return unavailable(selectedSlot === 'any' ? 'No open booking slots' : 'No matching booking slot');
  const selectedSlotRecord = eligibleSlots.sort((a, b) => b.remaining_capacity - a.remaining_capacity)[0];
  const slotCapacity = selectedSlotRecord.capacity;
  const slotSpaces = selectedSlotRecord.remaining_capacity;
  const spaces = Math.max(0, Math.min(capacity.remaining_bookable_capacity, slotSpaces));
  const percent = selectedSlot === 'any' ? capacity.projected_visitor_count * 100 / capacityInfo.limit
    : slotCapacity > 0 ? (slotCapacity - slotSpaces) * 100 / slotCapacity : null;
  const level: MapLevel = spaces === 0 ? 'full' : percent == null ? 'unknown' : classify(percent, capacity);
  const fitsGroup = spaces >= groupSize;
  const displayedLevel = spaces === 0 ? 'full' : fitsGroup ? level : 'unavailable';
  return { level: displayedLevel, label: displayedLevel === 'unavailable' ? 'No slot fits your group' : levelName(displayedLevel), percent,
    limit: selectedSlot === 'any' ? capacityInfo.limit : slotCapacity, count: selectedSlot === 'any' ? capacity.projected_visitor_count : slotCapacity - slotSpaces,
    spaces, basis: selectedSlot === 'any' ? capacityInfo.basis : 'slot', fitsGroup, slotCapacity };
}

function levelName(level: MapLevel) {
  return ({ available: 'Available', moderate: 'Moderate', critical: 'Critical', full: 'Full', unavailable: 'Unavailable', unknown: 'Capacity Unavailable' })[level];
}

export default function DestinationLocator({ sites, audience = 'visitor', openSite, bookSite, visitDate: controlledDate, setVisitDate: setControlledDate, visitorCount: controlledCount, setVisitorCount: setControlledCount }: Props) {
  const mappedSites = useMemo(() => sites.filter((site) => site.status === 'published' && located(site)), [sites]);
  const [selectedId, setSelectedId] = useState('');
  const [mode, setMode] = useState<Mode>('live');
  const [heatMode, setHeatMode] = useState(true);
  const [baseMap, setBaseMap] = useState<'street' | 'satellite'>('satellite');
  const [mobileView, setMobileView] = useState<'map' | 'details'>('map');
  const [selectedSlot, setSelectedSlot] = useState('any');
  const [localDate, setLocalDate] = useState(todayManila);
  const [localCount, setLocalCount] = useState(1);
  const [destinationFilter, setDestinationFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<MapLevel | 'all'>('all');
  const [search, setSearch] = useState('');
  const visitDate = controlledDate ?? localDate;
  const setVisitDate = setControlledDate ?? setLocalDate;
  const visitorCount = controlledCount ?? localCount;
  const setVisitorCount = setControlledCount ?? setLocalCount;
  const feed = useLiveCapacity(mappedSites.map((site) => site.id));
  const planned = usePlannedCapacity(mappedSites.map((site) => site.id), visitDate, feed.updatedAt);
  const mapNode = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.LayerGroup | null>(null);
  const tileLayersRef = useRef<{ street: L.TileLayer; satellite: L.TileLayer } | null>(null);
  const openRef = useRef(openSite ?? (() => {}));
  openRef.current = openSite ?? (() => {});
  const groupSize = Math.max(1, Number.isFinite(visitorCount) ? visitorCount : 1);
  const dateMin = todayManila();
  const dateMax = dateAfter(dateMin, 62);
  const slotsByTime = useMemo(() => {
    const values = new Map<string, Slot>();
    Object.values(planned.rows).forEach(({ slots }) => slots.forEach((slot) => {
      if (slot.status === 'open' && !values.has(slotKey(slot))) values.set(slotKey(slot), slot);
    }));
    return [...values.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [planned.rows]);
  const statusById = useMemo(() => Object.fromEntries(mappedSites.map((site) => [site.id,
    statusFor(site, mode, feed.rows[site.id] ?? null, planned.rows[site.id]?.capacity ?? null, planned.rows[site.id]?.slots ?? [], visitDate, selectedSlot, groupSize),
  ])) as Record<string, MapStatus>, [mappedSites, mode, feed.rows, planned.rows, visitDate, selectedSlot, groupSize]);
  const visibleSites = useMemo(() => mappedSites.filter((site) => (destinationFilter === 'all' || site.id === destinationFilter)
    && (statusFilter === 'all' || statusById[site.id]?.level === statusFilter)
    && (!search.trim() || `${site.name} ${site.address ?? ''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))),
  [mappedSites, destinationFilter, statusFilter, search, statusById]);
  const selected = visibleSites.find((site) => site.id === selectedId) ?? visibleSites[0];

  useEffect(() => {
    if (!mapNode.current || !mappedSites.length) return;
    const map = L.map(mapNode.current, { scrollWheelZoom: false });
    const attribution = 'Tiles &copy; Esri, HERE, Garmin, Intermap, increment P Corp., GEBCO, USGS, FAO, NPS, NRCAN, GeoBase, IGN, Kadaster, Ordnance Survey, Esri Japan, METI, Esri China (Hong Kong), (c) OpenStreetMap contributors, and the GIS User Community';
    const street = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution });
    const satellite = L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    });
    const bounds = L.latLngBounds(mappedSites.map((site) => [site.latitude!, site.longitude!] as L.LatLngTuple));
    map.fitBounds(bounds.pad(.3), { maxZoom: 14 });
    const layers = L.layerGroup().addTo(map);
    mapRef.current = map;
    layersRef.current = layers;
    tileLayersRef.current = { street, satellite };
    const resize = window.setTimeout(() => map.invalidateSize(), 100);
    return () => { window.clearTimeout(resize); map.remove(); mapRef.current = null; layersRef.current = null; tileLayersRef.current = null; };
  }, [mappedSites]);

  useEffect(() => {
    const map = mapRef.current;
    const layers = tileLayersRef.current;
    if (!map || !layers) return;
    Object.values(layers).forEach((layer) => { if (map.hasLayer(layer)) map.removeLayer(layer); });
    layers[baseMap].addTo(map);
  }, [baseMap, mappedSites]);

  useEffect(() => {
    const layers = layersRef.current;
    if (!layers) return;
    layers.clearLayers();
    visibleSites.forEach((site) => {
      const status = statusById[site.id];
      const position: L.LatLngTuple = [site.latitude!, site.longitude!];
      if (heatMode && status.percent != null && !['unknown', 'unavailable'].includes(status.level)) L.marker(position, {
        icon: L.divIcon({ className: `site-heat site-heat-${status.level}`, html: '<span></span>', iconSize: [112, 112], iconAnchor: [56, 56] }), interactive: false,
      }).addTo(layers);
      const percentText = status.percent == null ? '—' : formatCapacityPercent(status.percent);
      const live = feed.rows[site.id];
      const markerText = mode === 'live' ? status.count?.toLocaleString() ?? '—' : percentText;
      const marker = L.marker(position, {
        icon: L.divIcon({ className: `capacity-pin capacity-pin-${status.level}${site.id === selected?.id ? ' capacity-pin-selected' : ''}`, html: `<span>${markerText}</span>`, iconSize: [56, 38], iconAnchor: [28, 19] }),
        title: mode === 'live'
          ? `${site.name}: ${markerText} visitors inside, ${live?.arrivals_today ?? '—'} check-ins today, ${live?.departures_today ?? '—'} check-outs today${status.percent == null ? '' : `, ${percentText} capacity used`}`
          : `${site.name}: ${status.label}${status.percent == null ? '' : `, ${percentText}`}`,
        alt: mode === 'live'
          ? `${site.name}: ${markerText} visitors inside, ${live?.arrivals_today ?? '—'} check-ins today, ${live?.departures_today ?? '—'} check-outs today`
          : `${site.name} destination, ${status.label}`, keyboard: true,
      }).addTo(layers);
      marker.bindTooltip(site.name, { direction: 'top', offset: [0, -17] });
      const popup = document.createElement('div');
      const name = document.createElement('strong'); name.textContent = site.name;
      const count = document.createElement('p');
      count.textContent = mode === 'live'
        ? `${status.count?.toLocaleString() ?? '—'} inside · ${live?.arrivals_today ?? '—'} check-ins today · ${live?.departures_today ?? '—'} check-outs today${status.limit == null ? ' · capacity unknown' : ` / ${status.limit.toLocaleString()} ${status.basis === 'estimate' ? 'estimated ' : ''}spaces`}`
        : `${status.count?.toLocaleString() ?? '—'} projected visitors${status.spaces == null ? '' : ` · ${status.spaces.toLocaleString()} spaces for ${groupSize}`}`;
      const level = document.createElement('p'); level.textContent = `${status.label}${status.percent == null ? '' : ` · ${formatCapacityPercent(status.percent)}`} · ${mode === 'live' ? operatingStatus(site) : visitDate}`;
      popup.append(name, count, level);
      if (audience === 'visitor') {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = 'View Destination';
        button.addEventListener('click', () => openRef.current(site));
        popup.append(button);
      }
      marker.bindPopup(popup).on('click', () => { setSelectedId(site.id); setMobileView('details'); });
    });
  }, [visibleSites, statusById, feed.rows, heatMode, mode, selected?.id, groupSize, visitDate, audience]);

  useEffect(() => {
    if (selected) mapRef.current?.panTo([selected.latitude!, selected.longitude!], { animate: true });
  }, [selected?.id]);

  useEffect(() => {
    if (selectedSlot !== 'any' && !slotsByTime.some(([key]) => key === selectedSlot)) setSelectedSlot('any');
  }, [slotsByTime, selectedSlot]);

  useEffect(() => { if (mobileView === 'map') window.setTimeout(() => mapRef.current?.invalidateSize(), 80); }, [mobileView]);

  const selectedStatus = selected ? statusById[selected.id] : null;
  const selectedPlanned = selected ? planned.rows[selected.id]?.capacity ?? null : null;
  const selectedOccupancy = selected ? feed.rows[selected.id] ?? null : null;
  const selectedOperating = selected ? mode === 'live' ? operatingStatus(selected) : isScheduledOpen(selected, visitDate, selectedSlot === 'any' ? undefined : selectedSlot.split('|')[0]) ? 'Open for selected schedule' : 'Closed for selected schedule' : '';
  const capacityUpdate = selectedOccupancy?.calculated_at ?? selectedPlanned?.updated_at ?? feed.updatedAt;
  const formattedUpdate = capacityUpdate ? new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' }).format(new Date(capacityUpdate)) : 'Unavailable';
  const realtimeLabel = { connecting: 'Connecting to realtime', connected: 'Realtime connected', reconnecting: 'Reconnecting · polling active', disconnected: 'Realtime unavailable' }[feed.realtimeState];
  const recommendationTime = mode === 'planned' && selectedSlot !== 'any' ? selectedSlot : undefined;
  const recommendationsRequested = Boolean(selectedStatus && (selectedStatus.level === 'critical' || selectedStatus.level === 'full'
    || (mode === 'planned' && selectedStatus.level === 'unavailable')));
  const canBookSelected = mode === 'live' || Boolean(selectedStatus?.fitsGroup && selectedStatus.level !== 'full' && selectedStatus.level !== 'unknown');

  return <section className={`destination-locator section-wrap${audience === 'staff' ? ' destination-locator-staff' : ''}`}>
    <div className="section-heading"><div><span className="eyebrow"><span className="eyebrow-line"/> LIVE + PLANNED VISITOR CAPACITY</span><h1>{audience === 'staff' ? <>Destination <em>capacity map.</em></> : <>Explore the <em>capacity map.</em></>}</h1><p>{audience === 'staff' ? 'Compare recorded attendance now with future booking availability across destinations you manage.' : 'See recorded attendance now or check booking availability for a future visit.'}</p></div></div>
    {!mappedSites.length ? <div className="empty-state"><MapPin size={32}/><h3>Map locations are not available yet</h3><p>Published destinations need recorded coordinates to appear here.</p></div> : <>
      <div className="locator-mobile-switch" role="group" aria-label="Map or destination details"><button aria-pressed={mobileView === 'map'} onClick={() => setMobileView('map')}>Capacity map</button><button aria-pressed={mobileView === 'details'} onClick={() => setMobileView('details')}>Destination details</button></div>
      <div className="locator-layout"><div className={`locator-map-column${mobileView === 'details' ? ' locator-mobile-hidden' : ''}`}>
        <div className="locator-modebar" role="group" aria-label="Capacity map mode">
          <button aria-pressed={mode === 'live'} onClick={() => setMode('live')}><MapPin size={15}/> Live Occupancy</button>
          <button aria-pressed={mode === 'planned'} onClick={() => setMode('planned')}><CalendarDays size={15}/> Planned Visit Availability</button>
        </div>
        <div className={`locator-mode-summary locator-mode-summary-${mode}`} role="status">
          {mode === 'live' ? <MapPin size={18} aria-hidden="true"/> : <CalendarDays size={18} aria-hidden="true"/>}
          <span><b>{mode === 'live' ? 'Attendance right now' : 'Availability for a future visit'}</b><small>{mode === 'live' ? 'Recorded check-ins minus check-outs. Future reservations are not included.' : 'Uses your selected date, time slot, group size, operating hours, and reservations.'}</small></span>
        </div>
        <div className={`locator-directory-filters${audience === 'staff' ? ' locator-directory-filters-staff' : ''}`}>
          {audience === 'staff' && <label><span>Destination</span><select value={destinationFilter} onChange={(event) => setDestinationFilter(event.target.value)}><option value="all">All managed destinations</option>{mappedSites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>}
          <label className="locator-search"><span>Search destinations</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by destination or location"/></label>
          {audience === 'staff' && <label><span>Capacity status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as MapLevel | 'all')}><option value="all">All statuses</option><option value="available">Available</option><option value="moderate">Moderate</option><option value="critical">Critical</option><option value="full">Full</option><option value="unavailable">Unavailable</option><option value="unknown">Unknown</option></select></label>}
        </div>
        {mode === 'planned' && <div className="locator-filters">
          <label><span><CalendarDays size={14}/> Visit date</span><input type="date" value={visitDate} min={dateMin} max={dateMax} onChange={(event) => event.target.value && setVisitDate(event.target.value)}/></label>
          <label><span><Clock3 size={14}/> Time slot</span><select value={selectedSlot} onChange={(event) => setSelectedSlot(event.target.value)}><option value="any">Any available time</option>{slotsByTime.map(([key, slot]) => <option key={key} value={key}>{timeText(slot.starts_at)}–{timeText(slot.ends_at)}</option>)}</select></label>
          <label><span><Users size={14}/> Group size</span><input type="number" min={1} max={100} value={groupSize} onChange={(event) => setVisitorCount(Math.max(1, Math.min(100, Number(event.target.value) || 1)))}/></label>
        </div>}
        <div className="locator-toolbar"><div role="group" aria-label="Map style"><button aria-pressed={baseMap === 'street'} onClick={() => setBaseMap('street')}><MapIcon size={15}/> Street</button><button aria-pressed={baseMap === 'satellite'} onClick={() => setBaseMap('satellite')}><Layers size={15}/> Satellite</button></div><div role="group" aria-label="Capacity overlay"><button aria-pressed={heatMode} onClick={() => setHeatMode(true)}>Heat zones</button><button aria-pressed={!heatMode} onClick={() => setHeatMode(false)}>Markers only</button><button onClick={() => void feed.refresh()} aria-label="Refresh capacity map"><RefreshCw size={15}/></button></div></div>
        <div className={`locator-sync locator-sync-${feed.realtimeState}`} role="status"><span className="locator-sync-dot"/>{realtimeLabel}{feed.updatedAt && <span>Last successful sync {new Intl.DateTimeFormat('en-PH', { timeStyle: 'short', timeZone: 'Asia/Manila' }).format(new Date(feed.updatedAt))}</span>}</div>
        <div className="locator-map" ref={mapNode} role="application" aria-label={`Interactive destination ${mode === 'live' ? 'live occupancy' : 'planned visit availability'} map`}/>
        <div className="locator-legend" aria-label="Capacity status legend"><b>{mode === 'live' ? 'Visitors inside · marker shows count' : 'Booking availability'}</b>{[['available', 'Available'], ['moderate', 'Moderate'], ['critical', 'Critical'], ['full', 'Full'], ['unavailable', 'Unavailable'], ['unknown', 'Unknown']].map(([level, label]) => <span key={level}><i className={`map-legend-level map-legend-${level}`}/>{label}</span>)}</div>
        <p className="locator-note">{mode === 'live' ? 'Live count uses recorded check-ins minus check-outs. Check-ins and check-outs today update each destination as attendance is recorded; future reservations are excluded.' : `Availability uses open booking slots and the selected group size for ${visitDate}. A destination without verified capacity remains unknown.`} {feed.state === 'stale' || planned.state === 'stale' ? 'Live update delayed; showing the last successful data.' : feed.state === 'unavailable' || (mode === 'planned' && planned.state === 'unavailable') ? 'Capacity data unavailable.' : ''}{formattedUpdate !== 'Unavailable' ? ` Updated ${formattedUpdate}.` : ''}</p>
        {sites.some((site) => site.status === 'published' && !located(site)) && <p className="locator-note">Some destinations have no recorded coordinates and are omitted from the map.</p>}
      </div><div className={`locator-details${mobileView === 'map' ? ' locator-mobile-hidden' : ''}`}>
        {visibleSites.length === 0 ? <div className="empty-inline">No destinations match these filters.</div> : <div className="locator-list" aria-label="Mapped destinations">{visibleSites.map((site) => { const status = statusById[site.id]; const live = feed.rows[site.id]; return <button key={site.id} className={site.id === selected?.id ? 'selected' : ''} onClick={() => { setSelectedId(site.id); mapRef.current?.panTo([site.latitude!, site.longitude!]); }}><span className={`map-legend-level map-legend-${status.level}`}/><span><b>{site.name}</b><small>{mode === 'live' ? `${status.count?.toLocaleString() ?? '—'} inside · ${live?.arrivals_today.toLocaleString() ?? '—'} check-ins · ${live?.departures_today.toLocaleString() ?? '—'} check-outs today` : `${status.label}${status.percent != null ? ` · ${formatCapacityPercent(status.percent)}` : ''}`}</small></span></button>; })}</div>}
        {selected && selectedStatus && <article className="locator-selected">
          {selected.images[0] && <img src={selected.images.find((image) => image.image_role === 'cover')?.public_url ?? selected.images[0].public_url} alt={selected.images.find((image) => image.image_role === 'cover')?.alt_text || selected.name}/>}
          <div className="locator-selected-heading"><div><small>{selected.category} · {selected.address || 'Iligan City'}</small><h2>{selected.name}</h2></div><span className={`locator-status locator-status-${selectedStatus.level}`}>{selectedStatus.label}</span></div>
          <div className="locator-selected-facts">
            {mode === 'live' ? <><div><small>Visitors currently inside</small><b>{selectedStatus.count?.toLocaleString() ?? '—'}</b></div><div><small>Check-ins today</small><b>{selectedOccupancy?.arrivals_today.toLocaleString() ?? '—'}</b></div><div><small>Check-outs today</small><b>{selectedOccupancy?.departures_today.toLocaleString() ?? '—'}</b></div><div><small>Remaining physical capacity</small><b>{selectedStatus.spaces?.toLocaleString() ?? 'Unknown'}</b></div></>
              : <><div><small>{recommendationTime ? 'Expected in selected slot' : 'Expected on selected date'}</small><b>{selectedStatus.count?.toLocaleString() ?? '—'}</b></div><div><small>{recommendationTime ? 'Spaces in this slot' : 'Spaces for your group'}</small><b>{selectedStatus.spaces?.toLocaleString() ?? 'Unknown'}</b></div><div><small>Reserved visitors</small><b>{selectedPlanned?.reserved_visitor_count.toLocaleString() ?? '—'}</b></div></>}
            <div><small>{mode === 'live' ? 'Maximum capacity' : recommendationTime ? 'Selected slot capacity' : 'Daily capacity limit'}</small><b>{selectedStatus.limit?.toLocaleString() ?? 'Not configured'}{selectedStatus.basis === 'estimate' ? ' · estimate' : ''}</b></div>
          </div>
          {selectedStatus.percent != null && <><div className="locator-progress-heading"><span>{mode === 'live' ? 'Current physical utilization' : 'Projected utilization'}</span><b>{formatCapacityPercent(selectedStatus.percent)}</b></div><div className={`locator-progress locator-progress-${selectedStatus.level}`} role="progressbar" aria-label={`${selected.name} ${mode === 'live' ? 'physical occupancy' : 'projected capacity'}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(selectedStatus.percent))}><i style={{ width: `${Math.min(100, selectedStatus.percent)}%` }}/></div></>}
          <div className="locator-selected-foot"><span>{selectedOperating}</span><span>Updated {formattedUpdate}</span></div>
          {selectedStatus.level === 'critical' && <p className="locator-warning locator-warning-critical"><b>{mode === 'live' ? 'Current physical occupancy:' : 'Projected booking utilization:'}</b> This destination is approaching its maximum visitor capacity. Consider exploring alternative destinations for a more comfortable and sustainable travel experience.</p>}
          {selectedStatus.level === 'full' && <p className="locator-warning locator-warning-full"><b>{mode === 'live' ? 'Current physical occupancy:' : 'Projected booking utilization:'}</b> This destination has reached its maximum capacity for the selected schedule. Please choose another available schedule or explore alternative destinations.</p>}
          {mode === 'planned' && selectedStatus.level === 'unavailable' && <p className="locator-warning"><b>Booking availability:</b> {selectedStatus.label}. No suitable open booking slot fits this group on the selected date.</p>}
          {selectedStatus.level === 'unknown' && <p className="locator-warning">Capacity unavailable. No reliable utilization estimate shown.</p>}
          {audience === 'visitor' && <div className="locator-selected-actions"><button type="button" className="btn btn-outline btn-sm" onClick={() => openSite?.(selected)}>View Destination</button><button type="button" className="btn btn-primary btn-sm" disabled={!canBookSelected} onClick={() => bookSite?.(selected, recommendationTime?.split('|')[0])}>Book Now</button></div>}
          <OccupancyPanel site={selected} sites={sites} onOpen={openSite ?? (() => {})} onBook={(site) => bookSite?.(site, recommendationTime?.split('|')[0])} visitDate={visitDate} setVisitDate={setVisitDate} visitorCount={groupSize} capacityView={mode} recommendationsOnly={audience === 'visitor'} recommendationTime={recommendationTime} recommendationsRequested={recommendationsRequested} liveFeed={feed} allowVisitorActions={audience === 'visitor'}/>
        </article>}
      </div></div>
    </>}
  </section>;
}
