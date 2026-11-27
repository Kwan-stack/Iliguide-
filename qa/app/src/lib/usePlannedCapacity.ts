import { useEffect, useState } from 'react';
import { loadSiteCapacityForDate, loadSlots, type SiteCapacityForDate, type Slot } from './iliguide';

export type PlannedCapacity = { capacity: SiteCapacityForDate | null; slots: Slot[] };

export function usePlannedCapacity(siteIds: string[], date: string, refreshAt: string | null) {
  const key = siteIds.join(',');
  const [rows, setRows] = useState<Record<string, PlannedCapacity>>({});
  const [state, setState] = useState<'loading' | 'ready' | 'stale' | 'unavailable'>('loading');

  useEffect(() => {
    let active = true;
    if (!key) { setRows({}); setState('ready'); return () => { active = false; }; }
    setState((current) => current === 'ready' || current === 'stale' ? 'stale' : 'loading');
    const ids = key.split(',');
    void Promise.all(ids.map(async (id) => {
      const [capacity, slots] = await Promise.allSettled([
        loadSiteCapacityForDate(id, date), loadSlots(id, date, date),
      ]);
      const previous = rows[id];
      const previousCapacity = previous?.capacity?.visit_date === date ? previous.capacity : null;
      const previousSlots = previous?.slots.every((slot) => slot.slot_date === date) ? previous.slots : [];
      return [id, {
        capacity: capacity.status === 'fulfilled' ? capacity.value : previousCapacity,
        slots: slots.status === 'fulfilled' ? slots.value : previousSlots,
        failed: capacity.status === 'rejected' || slots.status === 'rejected',
      }] as const;
    })).then((results) => {
      if (!active) return;
      setRows(Object.fromEntries(results.map(([id, row]) => [id, { capacity: row.capacity, slots: row.slots }])));
      const failed = results.some(([, row]) => row.failed);
      const hasPreviousData = results.some(([, row]) => row.capacity != null || row.slots.length > 0);
      setState(failed ? (hasPreviousData ? 'stale' : 'unavailable') : 'ready');
    });
    return () => { active = false; };
  }, [key, date, refreshAt]);

  return { rows, state };
}
