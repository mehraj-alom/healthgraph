/**
 * Pure chunk helpers for SecureStore persistence (zero native imports).
 *
 * SecureStore values cap at 2048 bytes, so Firebase auth blobs are split
 * into small pieces under `key`, `key#0`, `key#1`, … with the piece count
 * stored at `key`. Joining stops at the first gap so a partial write can
 * never glue stale chunks onto fresh ones.
 */

export const CHUNK_SIZE = 1800;

export function splitValue(value: string): string[] {
  const parts: string[] = [];
  for (let i = 0; i < value.length; i += CHUNK_SIZE) {
    parts.push(value.slice(i, i + CHUNK_SIZE));
  }
  return parts;
}

export function joinParts(parts: readonly (string | null | undefined)[]): string | null {
  const out: string[] = [];
  for (const part of parts) {
    if (part == null) return null;
    out.push(part);
  }
  return out.join('');
}

/**
 * Deterministic, collision-free encoding of arbitrary Firebase keys into
 * SecureStore's allowed set: A-Z a-z 0-9 . - _
 *
 * Firebase persistence keys look like `firebase:authUser:<apiKey>:[DEFAULT]`
 * — colons and brackets, all rejected natively ("Invalid key provided to
 * SecureStore"). Every underscore AND every out-of-set character becomes a
 * `_x<hex>_` escape in a single pass, so:
 * - the output alphabet contains no bare `_`, making the encoding uniquely
 *   decodable and therefore injective: encode(a) === encode(b) implies a
 *   === b, i.e. no two distinct Firebase keys can collide;
 * - the mapping is a pure function of its input, hence stable across
 *   restarts and reinstalls (existing sessions keep working).
 */
export function encodeStorageKey(key: string): string {
  // Alternation, single pass: escape every underscore AND every character
  // outside the allowed set. (A single negated class cannot also match
  // `_`, and `_` must be escaped to keep the encoding injective.)
  return key.replace(/_|[^A-Za-z0-9._-]/g, ch => `_x${(ch.codePointAt(0) ?? 0).toString(16)}_`);
}

/** Inverse of encodeStorageKey (used by tests to prove injectivity). */
export function decodeStorageKey(encoded: string): string {
  return encoded.replace(/_x([0-9a-f]+)_/g, (_m, hex: string) =>
    String.fromCodePoint(parseInt(hex, 16)),
  );
}

/** Logical record key: namespace prefix + encoded Firebase key. */
export function toStoreKey(prefix: string, firebaseKey: string): string {
  return `${prefix}${encodeStorageKey(firebaseKey)}`;
}

/** Chunk key: record key + valid `.idx` suffix (`#` is not SecureStore-safe). */
export function toChunkKey(prefix: string, firebaseKey: string, index: number): string {
  return `${toStoreKey(prefix, firebaseKey)}.${index}`;
}

/** Parse a stored piece count. Garbage, negative, and zero all mean "none". */
export function parseCount(raw: string | null | undefined): number {
  if (raw == null) return 0;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/** Indices holding stale chunks after shrinking from previous to current. */
export function staleIndices(previousCount: number, currentCount: number): number[] {
  const out: number[] = [];
  for (let i = Math.max(0, currentCount); i < Math.max(0, previousCount); i++) {
    out.push(i);
  }
  return out;
}
