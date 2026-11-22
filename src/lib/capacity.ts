import type { LiveOccupancy, Site } from './iliguide';

export type CrowdLevel = 'available' | 'near' | 'almost' | 'critical' | 'unconfigured' | 'unknown';

export function capacityHeatOpacity(percent: number) {
  return Math.min(.88, .6 + Math.max(0, Math.min(100, percent)) * .0028);
}

export function formatCapacityPercent(percent: number) {
  return percent > 0 && percent < 10 ? `${percent.toFixed(1)}%` : `${Math.round(percent)}%`;
}

export function capacityStatus(occupancy: LiveOccupancy | null | undefined) {
  if (!occupancy || !Number.isFinite(occupancy.current_visitor_count)) return { level: 'unknown' as CrowdLevel, percent: null, label: 'Capacity Data Unavailable', limit: null, basis: 'none' as const };
  const limit = occupancy.approved_visitor_limit ?? occupancy.estimated_live_capacity ?? null;
  const basis = occupancy.approved_visitor_limit != null ? 'approved' as const : occupancy.estimated_live_capacity != null ? 'estimated' as const : 'none' as const;
  if (limit == null || limit <= 0) return { level: 'unconfigured' as CrowdLevel, percent: null, label: 'Capacity Not Configured', limit: null, basis };
  const percent = occupancy.current_visitor_count * 100 / limit;
  const near = occupancy.near_threshold_percent ?? 70;
  const almost = occupancy.almost_threshold_percent ?? 85;
  const critical = occupancy.critical_threshold_percent ?? 95;
  const level: CrowdLevel = percent >= critical ? 'critical' : percent >= almost ? 'almost' : percent >= near ? 'near' : 'available';
  const label = { available: 'Available', near: 'Near Capacity', almost: 'Almost Full', critical: 'Full / Overcrowded' }[level];
  return { level, percent, label, limit, basis };
}

export function operatingStatus(site: Site, now = new Date()) {
  if (site.status !== 'published') return 'Closed';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: site.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map((part) => [part.type, part.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const time = `${parts.hour}:${parts.minute}`;
  const hours = openingHours(site, date);
  if (!hours) return 'Hours unavailable';
  if (hours.is_closed || !hours.opens_at || !hours.closes_at || site.closures.some((item) => date >= item.starts_on && date <= item.ends_on
    && (!item.starts_at || time >= item.starts_at.slice(0, 5))
    && (!item.ends_at || time < item.ends_at.slice(0, 5)))) return 'Closed now';
  return time >= hours.opens_at.slice(0, 5) && time < hours.closes_at.slice(0, 5) ? 'Open now' : 'Closed now';
}

export function isScheduledOpen(site: Site, date: string, time?: string) {
  if (site.status !== 'published') return false;
  const hours = openingHours(site, date);
  if (!hours || hours.is_closed || !hours.opens_at || !hours.closes_at) return false;
  if (time && (time < hours.opens_at.slice(0, 5) || time >= hours.closes_at.slice(0, 5))) return false;
  return !site.closures.some((item) => date >= item.starts_on && date <= item.ends_on
    && (!item.starts_at || !time || time >= item.starts_at.slice(0, 5))
    && (!item.ends_at || !time || time < item.ends_at.slice(0, 5)));
}

function openingHours(site: Site, date: string) {
  const exception = site.operating_exceptions.find((item) => item.exception_date === date);
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return exception ?? site.operating_hours.find((item) => item.weekday === weekday);
}
