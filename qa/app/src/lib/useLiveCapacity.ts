import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { db, loadLiveOccupancy, type LiveOccupancy } from './iliguide';

export function useLiveCapacity(siteIds: string[]) {
  const key = siteIds.join(',');
  const channelId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [rows, setRows] = useState<Record<string, LiveOccupancy | null>>({});
  const [state, setState] = useState<'loading' | 'ready' | 'stale' | 'unavailable'>('loading');
  const [realtimeState, setRealtimeState] = useState<'connecting' | 'connected' | 'reconnecting' | 'disconnected'>('connecting');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++requestVersion.current;
    if (!key) { setRows({}); setState('ready'); return; }
    try {
      const results = await Promise.all(key.split(',').map(async (id) => [id, await loadLiveOccupancy(id)] as const));
      if (request !== requestVersion.current) return;
      setRows(Object.fromEntries(results));
      setUpdatedAt(new Date().toISOString());
      setState('ready');
    } catch {
      if (request !== requestVersion.current) return;
      setState((previous) => previous === 'ready' || previous === 'stale' ? 'stale' : 'unavailable');
    }
  }, [key]);

  useEffect(() => {
    setRows({}); setUpdatedAt(null); setState('loading');
    setRealtimeState(key ? 'connecting' : 'disconnected');
    void refresh();
    if (!key) return () => { requestVersion.current++; };
    const timer = window.setInterval(() => void refresh(), 15000);
    const channel = db().channel(`capacity:${key}:${channelId}`).on('postgres_changes', {
      event: '*', schema: 'public', table: 'site_capacity_changes',
    }, (change) => { if (key.split(',').includes(String(change.new && 'site_id' in change.new ? change.new.site_id : ''))) void refresh(); })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') { setRealtimeState('connected'); void refresh(); }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setRealtimeState('reconnecting');
          setState((previous) => previous === 'ready' ? 'stale' : previous);
        }
      });
    return () => { requestVersion.current++; window.clearInterval(timer); void db().removeChannel(channel); };
  }, [key, refresh, channelId]);
  return { rows, state, realtimeState, updatedAt, refresh };
}
