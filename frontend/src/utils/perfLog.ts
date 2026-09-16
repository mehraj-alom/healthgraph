/**
 * Lightweight development-only performance timing.
 *
 * perfStart(tag) captures a timestamp; calling the returned function logs
 * `[Perf] <tag> ms=<n> <extra>` in __DEV__ builds and is a strict no-op in
 * production (no timers, no string building, no log retention).
 *
 * Privacy: tags and durations only. NEVER pass health data, payloads,
 * tokens, keys, identifiers, frames, or document contents as `extra`.
 */
export function perfStart(tag: string): (extra?: string) => void {
  if (!__DEV__) {
    return () => {};
  }
  const t0 = Date.now();
  return (extra?: string) => {
    const ms = Date.now() - t0;
    console.log(`[Perf] ${tag} ms=${ms}${extra ? ` ${extra}` : ''}`);
  };
}
