/**
 * Cross-screen data-refresh signal (in-memory only, never persisted).
 *
 * Problem: the dashboard reads SQLite through local-state hooks
 * (useHomeStory, useMedications) that only reload on mount, focus (gated),
 * or pull-to-refresh. Saving a daily log therefore leaves the dashboard
 * showing yesterday's numbers until the next gated refetch — e.g. unticking
 * a medicine and saving still shows it taken.
 *
 * Fix: save flows call requestDataRefresh(); dashboard focus effects treat
 * a pending request as "must refetch now", bypassing the freshness gate.
 * No payloads, no health data — a boolean flag with subscribers.
 */

type Listener = () => void;

const _listeners = new Set<Listener>();
let _pending = false;

/** True when a refresh was requested since the last consumption. */
export function consumeDataRefreshRequest(): boolean {
  const was = _pending;
  _pending = false;
  return was;
}

/** Request a dashboard data refresh (e.g. after a log save). */
export function requestDataRefresh(): void {
  _pending = true;
  _listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // A broken subscriber must never break the save flow.
    }
  });
}

/** Subscribe to refresh requests. Returns an unsubscribe function. */
export function subscribeDataRefresh(listener: Listener): () => void {
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}
