import { useEffect, useState } from 'react';
import { loadSiteCapacityForDate, loadSlots, type Site, type SiteCapacityForDate } from './iliguide';
import { isScheduledOpen, scheduledCapacityStatus } from './capacity';

export type CapacityRecommendation = { site: Site; capacity: SiteCapacityForDate; availableSpaces: number; utilizationPercent: number; applicableCapacity: number };

export function useCapacityRecommendations(site: Site, sites: Site[], selected: SiteCapacityForDate | null, date: string, visitors: number, refreshAt: string | null, force = false, preferredStart?: string) {
  const [recommendations, setRecommendations] = useState<CapacityRecommendation[]>([]);
  const [recommendationsKey, setRecommendationsKey] = useState('');
  const [loading, setLoading] = useState(false);
  const queryKey = `${site.id}:${date}:${visitors}:${preferredStart ?? ''}`;
  const selectedStatus = scheduledCapacityStatus(selected);
  const selectedKey = selected ? `${selected.projected_visitor_count}:${selected.remaining_bookable_capacity}:${selected.max_slot_remaining}:${selected.approved_visitor_limit}:${selected.estimated_live_capacity}:${selected.capacity_estimate}:${selected.almost_threshold_percent}:${selected.critical_threshold_percent}` : '';
  const sitesKey = sites.map((item) => `${item.id}:${item.category}:${item.latitude}:${item.longitude}:${item.status}:${item.fee_information_confirmed}:${item.max_per_booking}`).join(',');

  useEffect(() => {
    let active = true;
    const selectedIsFull = Boolean(selected && (selected.remaining_bookable_capacity < visitors || selected.max_slot_remaining < visitors));
    if (!selected || (!selectedIsFull && selectedStatus.level !== 'critical' && !force) || visitors < 1) {
      setRecommendations([]); setRecommendationsKey(queryKey); setLoading(false); return;
    }
    const [start, end] = preferredStart?.split('|') ?? [];
    const candidates = sites.filter((item) => item.id !== site.id && item.status === 'published'
      && item.fee_information_confirmed && visitors <= item.max_per_booking && isScheduledOpen(item, date, start));
    setLoading(true);
    void Promise.all(candidates.map(async (item) => {
      try {
        const [capacity, slots] = await Promise.all([
          loadSiteCapacityForDate(item.id, date), preferredStart ? loadSlots(item.id, date, date) : Promise.resolve([]),
        ]);
        if (!capacity || capacity.max_slot_remaining < visitors || capacity.remaining_bookable_capacity < visitors) return null;
        const matchingSlot = preferredStart ? slots.find((slot) => slot.starts_at.slice(0, 5) === start && (!end || slot.ends_at.slice(0, 5) === end) && slot.remaining_capacity >= visitors) : null;
        if (preferredStart && !matchingSlot) return null;
        const availableSpaces = Math.min(capacity.max_slot_remaining, capacity.remaining_bookable_capacity, matchingSlot?.remaining_capacity ?? Number.MAX_SAFE_INTEGER);
        if (availableSpaces < visitors) return null;
        const status = scheduledCapacityStatus(capacity);
        const dailyLimit = capacity.approved_visitor_limit ?? capacity.estimated_live_capacity ?? capacity.capacity_estimate;
        const applicableCapacity = matchingSlot?.capacity ?? dailyLimit ?? 0;
        const utilizationPercent = applicableCapacity > 0
          ? (matchingSlot ? applicableCapacity - availableSpaces : capacity.projected_visitor_count) * 100 / applicableCapacity
          : status.percent;
        const threshold = matchingSlot ? 85 : capacity.almost_threshold_percent ?? 85;
        return utilizationPercent != null && applicableCapacity > 0 && utilizationPercent < threshold
          ? { site: item, capacity, availableSpaces, utilizationPercent, applicableCapacity } : null;
      } catch { return null; }
    })).then((results) => {
      if (!active) return;
      setRecommendationsKey(queryKey);
      const eligible = results.filter((item): item is CapacityRecommendation => item !== null);
      const distanceKm = (candidate: Site) => {
        if ([site.latitude, site.longitude, candidate.latitude, candidate.longitude].some((value) => value == null)) return null;
        const radians = (value: number) => value * Math.PI / 180;
        const dLat = radians(candidate.latitude! - site.latitude!);
        const dLon = radians(candidate.longitude! - site.longitude!);
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(site.latitude!)) * Math.cos(radians(candidate.latitude!)) * Math.sin(dLon / 2) ** 2;
        return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      };
      const distances = eligible.map(({ site: candidate }) => distanceKm(candidate)).filter((value): value is number => value != null);
      const maxDistance = Math.max(...distances, 1);
      setRecommendations(eligible.map((item) => {
        const limit = item.applicableCapacity;
        const spaces = item.availableSpaces;
        const capacityScore = limit > 0 ? Math.min(1, spaces / limit) : 0;
        const distance = distanceKm(item.site);
        const proximityScore = distance == null ? .5 : 1 - Math.min(1, distance / maxDistance);
        const similarityScore = item.site.category === site.category ? 1 : 0;
        const scheduleScore = isScheduledOpen(item.site, date, start) ? 1 : 0;
        return { ...item, score: .4 * capacityScore + .25 * proximityScore + .2 * similarityScore + .15 * scheduleScore };
      }).sort((a, b) => b.score - a.score || a.site.name.localeCompare(b.site.name)).slice(0, 3));
      setLoading(false);
    });
    return () => { active = false; };
  }, [site.id, site.category, site.latitude, site.longitude, sitesKey, selectedKey, selectedStatus.level, selectedStatus.percent, date, visitors, refreshAt, force, preferredStart]);

  return { recommendations: recommendationsKey === queryKey ? recommendations : [], loading };
}
