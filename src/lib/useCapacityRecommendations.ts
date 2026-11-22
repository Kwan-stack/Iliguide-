import { useEffect, useState } from 'react';
import { loadSlots, type LiveOccupancy, type Site } from './iliguide';
import { capacityStatus, isScheduledOpen } from './capacity';

export function useCapacityRecommendations(site: Site, sites: Site[], rows: Record<string, LiveOccupancy | null>, date: string, visitors: number) {
  const [recommendations, setRecommendations] = useState<Site[]>([]);
  const [loading, setLoading] = useState(false);
  const ids = sites.map((item) => item.id).join(',');
  const occupancyKey = sites.map((item) => `${item.id}:${rows[item.id]?.current_visitor_count ?? ''}:${rows[item.id]?.approved_visitor_limit ?? ''}:${rows[item.id]?.estimated_live_capacity ?? ''}:${rows[item.id]?.near_threshold_percent ?? ''}`).join(',');
  useEffect(() => {
    let active = true;
    const selected = capacityStatus(rows[site.id]);
    if (!['near', 'almost', 'critical'].includes(selected.level)) { setRecommendations([]); setLoading(false); return; }
    const candidates = sites.filter((item) => {
      const crowd = capacityStatus(rows[item.id]);
      return item.id !== site.id && item.status === 'published' && item.fee_information_confirmed
        && visitors > 0 && visitors <= item.max_per_booking
        && crowd.level === 'available' && crowd.percent !== null
        && selected.percent !== null && crowd.percent < selected.percent;
    });
    setLoading(true);
    void Promise.all(candidates.map(async (item) => {
      try {
        const slots = await loadSlots(item.id, date, date);
        return slots.some((slot) => slot.slot_date === date && slot.status === 'open'
          && slot.remaining_capacity >= visitors && isScheduledOpen(item, date, slot.starts_at.slice(0, 5))
          && (date > new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())
            || slot.ends_at.slice(0, 5) > new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()))) ? item : null;
      } catch { return null; }
    })).then((results) => {
      if (!active) return;
      setRecommendations(results.filter((item): item is Site => item !== null).sort((a, b) => {
        const category = Number(b.category === site.category) - Number(a.category === site.category);
        if (category) return category;
        const crowd = (capacityStatus(rows[a.id]).percent ?? 100) - (capacityStatus(rows[b.id]).percent ?? 100);
        if (crowd) return crowd;
        if (site.latitude != null && site.longitude != null && a.latitude != null && a.longitude != null && b.latitude != null && b.longitude != null) {
          const distance = (item: Site) => (item.latitude! - site.latitude!) ** 2 + (item.longitude! - site.longitude!) ** 2;
          return distance(a) - distance(b);
        }
        return a.name.localeCompare(b.name);
      }));
      setLoading(false);
    });
    return () => { active = false; };
  }, [site.id, ids, occupancyKey, date, visitors]);
  return { recommendations, loading };
}
