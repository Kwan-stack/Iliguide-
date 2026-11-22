import { useEffect, useRef } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ArrowUpRight, Layers, MapPin } from 'lucide-react';
import { type LiveOccupancy, type Site } from '../lib/iliguide';
import { capacityHeatOpacity, capacityStatus, formatCapacityPercent } from '../lib/capacity';
import { useLiveCapacity } from '../lib/useLiveCapacity';
import './DestinationMap.css';

type CapacityZone = {
  id: string;
  name: string;
  zone_type: string;
  estimated_capacity?: number | null;
  geometry?: unknown;
};

type Props = {
  site: Site;
  zones?: CapacityZone[];
  occupancy?: LiveOccupancy | null;
  compact?: boolean;
};

const noZones: CapacityZone[] = [];

function popupContent(zone: CapacityZone) {
  const content = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = zone.name;
  content.append(title);
  if (zone.estimated_capacity != null) {
    const detail = document.createElement('div');
    detail.textContent = `Estimated capacity: ${zone.estimated_capacity} · informational`;
    content.append(detail);
  }
  return content;
}

function zoneGeometry(value: unknown): Parameters<typeof L.geoJSON>[0] | null {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== 'object' || !('type' in parsed) || !('coordinates' in parsed)) return null;
    const type = (parsed as { type: string }).type;
    if (!['Polygon', 'MultiPolygon', 'LineString', 'MultiLineString'].includes(type)) return null;
    return parsed as Parameters<typeof L.geoJSON>[0];
  } catch {
    return null;
  }
}

export default function DestinationMap({ site, zones = noZones, occupancy, compact = false }: Props) {
  const mapNode = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const overlayRef = useRef<L.LayerGroup | null>(null);
  const live = useLiveCapacity(occupancy === undefined ? [site.id] : []);
  const liveOccupancy = occupancy === undefined ? live.rows[site.id] ?? null : occupancy;
  const occupancyState = occupancy === undefined ? live.state : occupancy ? 'ready' : 'unavailable';
  const latitude = site.latitude;
  const longitude = site.longitude;
  const status = capacityStatus(liveOccupancy);
  const hasLocation = latitude !== null && longitude !== null
    && Number.isFinite(latitude) && Number.isFinite(longitude)
    && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;

  useEffect(() => {
    if (!hasLocation || !mapNode.current) return;
    const center: L.LatLngExpression = [latitude as number, longitude as number];
    const map = L.map(mapNode.current, { scrollWheelZoom: false, zoomControl: true }).setView(center, 16);
    L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      updateWhenIdle: true,
      attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    }).addTo(map);
    L.control.scale({ metric: true, imperial: false, maxWidth: 120 }).addTo(map);
    const marker = L.divIcon({ className: 'destination-map-marker', html: '<span></span>', iconSize: [20, 20], iconAnchor: [10, 10] });
    const markerLabel = document.createElement('strong');
    markerLabel.textContent = site.name;
    L.marker(center, { icon: marker, title: site.name, alt: `${site.name} location` }).addTo(map).bindPopup(markerLabel);
    const overlays = L.layerGroup().addTo(map);
    mapRef.current = map;
    overlayRef.current = overlays;
    const resize = window.setTimeout(() => map.invalidateSize(), 80);
    return () => {
      window.clearTimeout(resize);
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
  }, [hasLocation, latitude, longitude, site.id, site.name]);

  useEffect(() => {
    const map = mapRef.current;
    const overlays = overlayRef.current;
    if (!map || !overlays || latitude == null || longitude == null) return;
    overlays.clearLayers();
    let hasZoneBounds = false;
    const bounds = L.latLngBounds([[latitude, longitude], [latitude, longitude]]);
    const zoneLayers: L.GeoJSON[] = [];

    for (const zone of zones) {
      const geometry = zoneGeometry(zone.geometry);
      if (!geometry) continue;
      try {
        const layer = L.geoJSON(geometry);
        const restricted = zone.zone_type === 'restricted';
        const access = zone.zone_type === 'access_path';
        layer.setStyle(access
          ? { color: '#1976a2', weight: 5, opacity: 0.95 }
          : restricted
            ? { color: '#b5473d', weight: 2, fillColor: '#dc766b', fillOpacity: 0.27, dashArray: '6 5' }
            : { color: '#278a4f', weight: 2, fillColor: '#54b77a', fillOpacity: 0.22 });
        layer.eachLayer((feature) => feature.bindPopup(popupContent(zone)));
        const zoneBounds = layer.getBounds();
        if (zoneBounds.isValid()) {
          bounds.extend(zoneBounds);
          hasZoneBounds = true;
        }
        zoneLayers.push(layer);
      } catch { continue; }
    }

    if (hasZoneBounds) map.fitBounds(bounds.pad(0.2), { maxZoom: 17, animate: false });
    else map.setView([latitude, longitude], 16, { animate: false });

    const level = capacityStatus(liveOccupancy).level;
    if (liveOccupancy && status.percent != null && !['unknown', 'unconfigured'].includes(level)) L.marker([latitude, longitude], {
      icon: L.divIcon({ className: `site-heat site-heat-${level}`, html: `<span style="--heat-opacity:${capacityHeatOpacity(status.percent)}"></span>`, iconSize: [192, 192], iconAnchor: [96, 96] }),
      interactive: false,
    }).addTo(overlays);

    zoneLayers.forEach((layer) => layer.addTo(overlays));
  }, [latitude, liveOccupancy, longitude, site.id, site.name, zones]);

  const mapLink = hasLocation
    ? `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`
    : null;
  const zoneCount = zones.reduce((count, zone) => count + (zoneGeometry(zone.geometry) ? 1 : 0), 0);
  const count = liveOccupancy?.current_visitor_count;
  const coordinateSource = site.slug === 'timoga-cold-springs'
    ? { note: 'Representative pin for the Timoga springs area, using Timoga Spring Pool.', label: 'Coordinate source', url: 'https://www.lakadpilipinas.com/2013/10/timoga-springs-iligan-city.html' }
    : site.slug === 'sikyop-agri-tourism-adventure'
      ? { note: 'Approximate location reported by field research for Sikyop in Rogongon.', label: 'Research source', url: 'https://www.davaoresearchjournal.ph/index.php/main/article/download/479/252' }
      : null;

  return <section className={`destination-map${compact ? ' destination-map--compact' : ''}`} aria-label={`${site.name} GIS map`}>
    <div className="destination-map-heading">
      <div><small className="destination-map-kicker">OPEN GIS · ILIGAN CITY</small><h3>Location map</h3>{site.address && <p>{site.address}</p>}</div>
      {mapLink && <a href={mapLink} target="_blank" rel="noopener noreferrer">Open in Google Maps <ArrowUpRight size={14}/></a>}
    </div>
    {!hasLocation
      ? <p className="destination-map-message"><MapPin size={17}/> Map coordinates have not been recorded for this destination.</p>
      : <>
        <div className="destination-gis-canvas" ref={mapNode} role="application" aria-label={`Interactive satellite GIS map focused on ${site.name}`}/>
        {coordinateSource && <p className="destination-map-source-note">{coordinateSource.note} <a href={coordinateSource.url} target="_blank" rel="noopener noreferrer">{coordinateSource.label} <ArrowUpRight size={12}/></a></p>}
        <div className="destination-map-legend">
          {zoneCount > 0 && <span><i className="map-legend-zone"/>Approved site zones</span>}
          {occupancyState === 'ready' && <><span><i className={`map-legend-level map-legend-${status.level}`}/>{status.label}{status.percent != null ? ` · ${count} / ${status.limit} ${status.basis === 'estimated' ? 'provisional estimate' : 'approved limit'} (${formatCapacityPercent(status.percent)})` : ''}</span>{status.percent != null && <span><i className="map-legend-heat"/>Site-wide capacity heat</span>}</>}
          {occupancyState === 'loading' && <span><i className="map-legend-empty"/>Loading attendance</span>}
          {occupancyState === 'unavailable' && <span><i className="map-legend-empty"/>Attendance unavailable</span>}
          {!zoneCount && <span><Layers size={13}/> No approved zone boundaries recorded</span>}
        </div>
        <p className="destination-map-note">
          {occupancyState === 'ready'
              ? status.basis === 'estimated' ? 'Crowd color uses a provisional school-project map estimate, not an approved admission limit. Occupancy comes from recorded arrivals and departures; individual or zone locations are not tracked.' : 'Capacity is estimated from recorded arrivals and departures. The indicator represents the whole destination; individual visitor positions and zone occupancy are not tracked.'
              : occupancyState === 'loading'
                ? 'Loading recorded occupancy. The map remains available while attendance is checked.'
                : 'Recorded attendance is unavailable. The map remains focused on the destination location.'}
        </p>
      </>}
  </section>;
}
