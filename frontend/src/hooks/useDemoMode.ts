/**
 * useDemoMode — reactive sandbox-demo flag for navigation and banners.
 *
 * Reads the persisted flag on mount and re-reads on every data-refresh
 * broadcast (enter/exit both broadcast, so screens flip without restart).
 */
import { useCallback, useEffect, useState } from 'react';
import { isDemoMode } from '@/services/demoSession';
import { subscribeDataRefresh } from '@/services/dataRefresh';

export function useDemoMode(): { demoActive: boolean } {
  const [demoActive, setDemoActive] = useState(false);

  const reload = useCallback(() => {
    void isDemoMode()
      .then((active) => setDemoActive(active))
      .catch(() => setDemoActive(false));
  }, []);

  useEffect(() => {
    reload();
    return subscribeDataRefresh(reload);
  }, [reload]);

  return { demoActive };
}
