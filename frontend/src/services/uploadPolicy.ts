/**
 * uploadPolicy.ts — pure upload retry/reconcile policy (zero imports).
 *
 * The backend dedups uploads by (file_hash, patient_id): retrying the
 * identical file returns the existing row instead of a duplicate, and the
 * IntegrityError race path coalesces concurrent duplicates. These helpers
 * encode exactly when a retry/reconcile is safe. Node-testable.
 */

/** Upload calls should allow slow mobile uplinks (10 minutes, not 120s). */
export const UPLOAD_TIMEOUT_MS = 600000;

/** Max upload attempts per user action: initial try + one retry. */
export const UPLOAD_MAX_ATTEMPTS = 2;

/** Only rows this fresh may be adopted after a lost response. */
export const RECONCILE_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * Whether a failed upload is safe to retry with the identical file.
 * Transport-level failures only (timeout/reset, no server verdict).
 * Any HTTP response is a server decision: never blindly retry those.
 */
export function isRetriableUploadError(err: unknown): boolean {
  const status = (err as { response?: { status?: unknown } } | null)?.response?.status;
  if (typeof status === 'number') return false;
  const code = (err as { code?: unknown } | null)?.code;
  if (
    code === 'ECONNABORTED' ||
    code === 'ERR_NETWORK' ||
    code === 'ETIMEDOUT'
  ) {
    return true;
  }
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /timeout|timed out|network error|network request failed|no response/i.test(msg);
}

export interface RecentUploadCandidate {
  document_id: string;
  created_at: string;
  status?: string;
}

const TERMINAL_UPLOAD_STATUSES = new Set(['COMPLETED', 'FAILED', 'FAILED_TRIAGE']);

/**
 * Reconcile a timed-out upload: find a just-created server row so a
 * response lost in flight becomes adoption instead of a false FAILED.
 * Prefers the youngest non-terminal row; falls back to the youngest
 * terminal row; ignores old, future-dated, and undateable rows.
 */
export function matchRecentUpload(
  docs: readonly RecentUploadCandidate[],
  nowMs: number,
  maxAgeMs = RECONCILE_MAX_AGE_MS,
): string | null {
  let best: string | null = null;
  let bestAt = -1;
  let fallback: string | null = null;
  let fallbackAt = -1;
  for (const doc of docs) {
    const at = Date.parse(doc.created_at);
    if (!Number.isFinite(at) || nowMs - at > maxAgeMs || at > nowMs + 60_000) continue;
    if (doc.status !== undefined && TERMINAL_UPLOAD_STATUSES.has(doc.status)) {
      if (at >= fallbackAt) {
        fallbackAt = at;
        fallback = doc.document_id;
      }
      continue;
    }
    if (at >= bestAt) {
      bestAt = at;
      best = doc.document_id;
    }
  }
  return best ?? fallback;
}
