import { useEffect, useState } from 'react';
import { loadSiteCapacityForDate, type SiteCapacityForDate } from './iliguide';

export function useCapacityForDate(siteId: string, date: string, refreshAt: string | null, feedState: string) {
  const [data, setData] = useState<SiteCapacityForDate | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'stale' | 'unavailable'>('loading');
  useEffect(() => {
    let active = true;
    setState((current) => current === 'ready' ? 'ready' : 'loading');
    void loadSiteCapacityForDate(siteId, date).then((row) => {
      if (!active) return;
      setData(row);
      setState(row ? 'ready' : 'unavailable');
    }).catch(() => {
      if (active) setState((current) => current === 'ready' || feedState === 'stale' ? 'stale' : 'unavailable');
    });
    return () => { active = false; };
  }, [siteId, date, refreshAt, feedState]);
  return { data, state };
}
