/** Max characters shown for a first name in compact headers. */
export const FIRST_NAME_MAX = 8;

/**
 * First token of a name (cuts at the first space), truncated to
 * FIRST_NAME_MAX characters. Empty when there is no usable name.
 *
 * Dependency-free on purpose — imported by screens that must not join the
 * api/AuthContext module cycle.
 */
export function formatFirstName(raw: string | null | undefined): string {
  const first = (raw ?? '').trim().split(/\s+/)[0] ?? '';
  return first.slice(0, FIRST_NAME_MAX);
}
