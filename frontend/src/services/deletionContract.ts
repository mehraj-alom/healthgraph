/**
 * deletionContract.ts — pure deletion response/error contract (testable).
 *
 * Two guarantees the UI depends on:
 *
 * 1. Report validation: the local wipe must never run on (and the UI must
 *    never describe) a garbage/empty response. Any report implies the
 *    authoritative PostgreSQL phase committed (PG failures surface as
 *    thrown errors, never reports), so validation gates the wipe.
 *
 * 2. Honest failure copy: a 404 on these endpoints means the DEPLOYED
 *    backend predates the erasure routes — not a broken connection. Any
 *    other failure keeps the existing connection copy.
 *
 * Zero imports: safe for node unit tests.
 */

export type ErasureStatus = 'completed' | 'partial';

export interface ErasureReportLike {
  status?: unknown;
}

/**
 * Validate a deletion response body. Returns the verified status, or throws
 * (caller must wipe nothing and report failure).
 */
export function validateErasureReport(report: unknown): ErasureStatus {
  if (
    report !== null &&
    typeof report === 'object' &&
    ((report as ErasureReportLike).status === 'completed' ||
      (report as ErasureReportLike).status === 'partial')
  ) {
    return (report as { status: ErasureStatus }).status;
  }
  throw new Error(
    'The server returned an unexpected deletion response. Nothing was deleted.',
  );
}

/** Extract an HTTP status from any axios-shaped error without importing axios. */
export function deletionStatusOf(error: unknown): number | undefined {
  const status = (error as { response?: { status?: unknown } } | null)?.response?.status;
  return typeof status === 'number' ? status : undefined;
}

/**
 * True for timeout/network-style failures where the server may already
 * have committed the erasure (axios aborts do not cancel server work).
 * Callers must offer reconcile-and-retry, never claim "nothing happened".
 */
export function isTimeoutLikeError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === 'ECONNABORTED' || code === 'ERR_NETWORK' || code === 'ETIMEDOUT') {
    return true;
  }
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /timeout|timed out|network error|network request failed/i.test(msg);
}

/**
 * User-facing failure copy for a deletion error. A 404 here is precise:
 * these routes did not exist on the server that answered, so the user
 * needs a backend update — not another retry against their connection.
 */
export function deletionFailureMessage(
  error: unknown,
  operation: 'data' | 'account',
): string {
  if (deletionStatusOf(error) === 404) {
    return operation === 'account'
      ? 'Account deletion is not available on this server version yet. ' +
        'Update the backend and try again — nothing was deleted.'
      : 'Data deletion is not available on this server version yet. ' +
        'Update the backend and try again — nothing was deleted.';
  }
  return 'Nothing was deleted. Check your connection and try again.';
}

/**
 * Destructive-confirmation contract (DeleteConfirmSheet). Exact,
 * case-sensitive match; the 20s countdown is a client-side safeguard —
 * the backend remains the authorization boundary.
 */
export const DELETE_CONFIRM_PHRASE = 'DELETE';
export const DELETE_COUNTDOWN_SECONDS = 20;

/** Exact, case-sensitive match. Empty/whitespace input never matches. */
export function isDeleteConfirmed(input: string): boolean {
  return input === DELETE_CONFIRM_PHRASE;
}

export function countdownLabel(secondsLeft: number): string {
  return secondsLeft > 0 ? `Wait ${secondsLeft}s…` : 'Delete now';
}
