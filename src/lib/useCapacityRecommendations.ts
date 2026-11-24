import { useEffect, useState } from 'react';
import { loadSiteCapacityForDate, type Site, type SiteCapacityForDate } from './iliguide';
import { isScheduledOpen, scheduledCapacityStatus } from './capacity';

export type CapacityRecommendation = { site: Site; capacity: SiteCapacityForDate };

export function useCapacityRecommendations(site: Site, sites: Site[], selected: SiteCapacityForDate | null, date: string, visitors: number, refreshAt: string | null) {
  const [recommendations, setRecommendations] = useState<CapacityRecommendation[]>([]);
  const [recommendationsKey, setRecommendationsKey] = useState('');
  const [loading, setLoading] = useState(false);
  const queryKey = `${site.id}:${date}:${visitors}`;
  const selectedStatus = scheduledCapacityStatus(selected);
  const selectedKey = selected ? `${selected.projected_visitor_count}:${selected.remaining_bookable_capacity}:${selected.max_slot_remaining}:${selected.approved_visitor_limit}:${selected.estimated_live_capacity}:${selected.capacity_estimate}:${selected.almost_threshold_percent}:${selected.critical_threshold_percent}` : '';
  const sitesKey = sites.map((item) => `${item.id}:${item.category}:${item.latitude}:${item.longitude}:${item.status}:${item.fee_information_confirmed}:${item.max_per_booking}`).join(',');

  useEffect(() => {
    let active = true;
    const selectedIsFull = Boolean(selected && (selected.remaining_bookable_capacity < visitors || selected.max_slot_remaining < visitors));
    if (!selected || (!selectedIsFull && selectedStatus.level !== 'critical') || visitors < 1) {
      setRecommendations([]); setRecommendationsKey(queryKey); setLoading(false); return;
    }
    const candidates = sites.filter((item) => item.id !== site.id && item.status === 'published'
      && item.fee_information_confirmed && visitors <= item.max_per_booking && isScheduledOpen(item, date));
    setLoading(true);
    void Promise.all(candidates.map(async (item) => {
      try {
        const capacity = await loadSiteCapacityForDate(item.id, date);
        if (!capacity || capacity.max_slot_remaining < visitors || capacity.remaining_bookable_capacity < visitors) return null;
        const status = scheduledCapacityStatus(capacity);
        return status.percent != null && status.percent < 100 && status.level !== 'critical'
          && (selectedStatus.percent == null || status.percent < selectedStatus.percent)
          ? { site: item, capacity } : null;
      } catch { return null; }
    })).then((results) => {
      if (!active) return;
      setRecommendationsKey(queryKey);
      setRecommendations(results.filter((item): item is CapacityRecommendation => item !== null).sort((a, b) => {
        const category = Number(b.site.category === site.category) - Number(a.site.category === site.category);
        if (category) return category;
        const crowd = (scheduledCapacityStatus(a.capacity).percent ?? 100) - (scheduledCapacityStatus(b.capacity).percent ?? 100);
        if (crowd) return crowd;
        if (site.latitude != null && site.longitude != null && a.site.latitude != null && a.site.longitude != null && b.site.latitude != null && b.site.longitude != null) {
          const distance = (item: Site) => (item.latitude! - site.latitude!) ** 2 + (item.longitude! - site.longitude!) ** 2;
          return distance(a.site) - distance(b.site);
        }
        return a.site.name.localeCompare(b.site.name);
      }));
      setLoading(false);
    });
    return () => { active = false; };
  }, [site.id, site.category, site.latitude, site.longitude, sitesKey, selectedKey, selectedStatus.level, selectedStatus.percent, date, visitors, refreshAt]);

  return { recommendations: recommendationsKey === queryKey ? recommendations : [], loading };
}
