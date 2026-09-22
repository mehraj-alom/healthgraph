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
