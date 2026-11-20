import { useEffect, useRef, useState } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.heat';
import { ArrowUpRight, Layers, MapPin } from 'lucide-react';
import { loadLiveOccupancy, type LiveOccupancy, type Site } from '../lib/iliguide';
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

type HeatLayer = L.Layer & {
  setOptions: (options: { radius: number; blur: number; maxZoom: number }) => HeatLayer;
};

type HeatLayerFactory = typeof L & {
  heatLayer: (points: Array<[number, number, number]>, options: {
    radius: number;
    blur: number;
    maxZoom: number;
    max: number;
    minOpacity: number;
    gradient: Record<number, string>;
  }) => HeatLayer;
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
  const [liveOccupancy, setLiveOccupancy] = useState<LiveOccupancy | null>(occupancy ?? null);
  const [occupancyState, setOccupancyState] = useState<'loading' | 'ready' | 'unavailable'>(occupancy === undefined ? 'loading' : occupancy ? 'ready' : 'unavailable');
  const latitude = site.latitude;
  const longitude = site.longitude;
  const approvedLimit = liveOccupancy?.approved_visitor_limit;
  const capacityEstimate = liveOccupancy?.capacity_estimate;
  const heatReference = approvedLimit != null && approvedLimit > 0 ? approvedLimit
    : capacityEstimate != null && capacityEstimate > 0 ? capacityEstimate : null;
  const heatReferenceLabel = heatReference != null && heatReference === approvedLimit ? 'approved limit' : 'physical estimate';
  const hasLocation = latitude !== null && longitude !== null
    && Number.isFinite(latitude) && Number.isFinite(longitude)
    && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;

  useEffect(() => {
    let active = true;
    if (occupancy !== undefined) {
      setLiveOccupancy(occupancy);
      setOccupancyState(occupancy ? 'ready' : 'unavailable');
      return () => { active = false; };
    }
    setLiveOccupancy(null);
    setOccupancyState('loading');
    void loadLiveOccupancy(site.id).then((row) => {
      if (active) {
        setLiveOccupancy(row);
        setOccupancyState(row ? 'ready' : 'unavailable');
      }
    }).catch(() => {
      if (active) setOccupancyState('unavailable');
    });
    return () => { active = false; };
  }, [occupancy, site.id]);

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

    const count = liveOccupancy?.current_visitor_count ?? 0;
    if (count > 0) {
      const intensity = Math.min(1, count / (heatReference ?? 100));
      const heat = (L as HeatLayerFactory).heatLayer([[latitude, longitude, intensity]], {
        radius: 1,
        blur: 1,
        maxZoom: map.getZoom(),
        max: 1,
        minOpacity: 0.2,
        gradient: { 0: '#35ad78', 0.25: '#a4c94a', 0.5: '#f0d24d', 0.75: '#f18a3d', 1: '#c93845' },
      }).addTo(overlays);
      const updateHeatFootprint = () => {
        const size = map.getSize();
        if (!size.x || !size.y) return;
        const point = map.latLngToContainerPoint([latitude, longitude]);
        const radius = Math.ceil(Math.max(
          Math.hypot(point.x, point.y), Math.hypot(size.x - point.x, point.y),
          Math.hypot(point.x, size.y - point.y), Math.hypot(size.x - point.x, size.y - point.y),
        ) * 1.05);
        heat.setOptions({ radius, blur: Math.round(radius * 0.72), maxZoom: map.getZoom() });
      };
      updateHeatFootprint();
      map.on('moveend resize', updateHeatFootprint);
      zoneLayers.forEach((layer) => layer.addTo(overlays));
      return () => { map.off('moveend resize', updateHeatFootprint); };
    }

    zoneLayers.forEach((layer) => layer.addTo(overlays));
  }, [latitude, liveOccupancy, longitude, site.id, site.name, zones]);

  const mapLink = hasLocation
    ? `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`
    : null;
  const zoneCount = zones.reduce((count, zone) => count + (zoneGeometry(zone.geometry) ? 1 : 0), 0);
  const count = liveOccupancy?.current_visitor_count ?? 0;
  const heatPercent = heatReference != null && heatReference > 0 && count > 0
    ? Math.round(count / heatReference * 100)
    : null;
  const heatScaleLabel = heatReference != null && heatReference > 0
    ? `${heatReference}+ people · ${heatReferenceLabel}`
    : '100+ people';
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
          {occupancyState === 'ready' && count > 0 && <span><i className="map-legend-heat"/>{`Approximate heat · ${count} onsite${heatPercent != null ? ` · ${heatPercent}% of ${heatReferenceLabel}` : ''}`}</span>}
          {occupancyState === 'ready' && count === 0 && <span><i className="map-legend-empty"/>No onsite attendance · heat off</span>}
          {occupancyState === 'loading' && <span><i className="map-legend-empty"/>Loading attendance</span>}
          {occupancyState === 'unavailable' && <span><i className="map-legend-empty"/>Attendance unavailable</span>}
          {!zoneCount && <span><Layers size={13}/> No approved zone boundaries recorded</span>}
        </div>
        {count > 0 && <div className="destination-heat-scale" role="img" aria-label={`Heat color is based on ${count} recorded people`}><span>Lower count</span><i/><span>{heatScaleLabel}</span></div>}
        <p className="destination-map-note">
          {occupancyState === 'ready' && count > 0 && heatReference != null && heatReference > 0
            ? `The approximate site-wide heat circle fills the map view and is centered on the destination pin. Its color reflects ${count} recorded people relative to ${liveOccupancy?.approved_visitor_limit != null ? 'the approved limit' : 'the physical estimate'} of ${heatReference}; visitor positions are not tracked.`
            : occupancyState === 'ready' && count > 0
              ? `The approximate site-wide heat circle fills the map view and is centered on the destination pin. Its color uses a 0–100-person visual scale; visitor positions are not tracked.`
            : occupancyState === 'ready'
              ? 'No onsite attendance is recorded, so the occupancy heat layer is off. Visitor positions are not tracked.'
              : occupancyState === 'loading'
                ? 'Loading recorded occupancy. The map remains available while attendance is checked.'
                : 'Recorded attendance is unavailable. The map remains focused on the destination location.'}
        </p>
      </>}
  </section>;
}
