import { useCallback, useState } from 'react';

/** Shows a loader until the current data scope has completed its first request. */
export function useSilentLoad(scope: string): [boolean, () => void] {
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const finishLoading = useCallback(() => setLoadedScope(scope), [scope]);
  return [loadedScope !== scope, finishLoading];
}
