/**
 * conceptResolver.ts — server concept UUID lookup for imports (Slice 3).
 *
 * The backend only accepts UUID concept ids on vitals, so the Health
 * Connect weight import resolves LOINC 29463-7 through the same
 * manual-log-concepts endpoint the logger uses. Unresolvable (offline,
 * missing concept, malformed rows) means weight is skipped — never the
 * bare code, which the backend rejects with 422.
 *
 * The fetcher is injected (no network imports); the positive result is
 * cached in memory for the session.
 */

export interface ManualConceptRow {
  id: unknown;
  terminology: unknown;
  code: unknown;
}

export type ConceptFetcher = () => Promise<unknown>;

let cached: string | null | undefined;

export function clearConceptCache(): void {
  cached = undefined;
}

function pickWeightId(rows: unknown): string | null {
  if (!Array.isArray(rows)) return null;
  for (const row of rows) {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) continue;
    const r = row as Record<string, unknown>;
    if (
      typeof r.id === 'string' &&
      r.id.length > 0 &&
      r.terminology === 'LOINC' &&
      r.code === '29463-7'
    ) {
      return r.id;
    }
  }
  return null;
}

/** UUID of the LOINC 29463-7 weight concept, or null when unresolvable. */
export async function resolveWeightConceptId(fetcher: ConceptFetcher): Promise<string | null> {
  if (cached !== undefined) return cached;
  try {
    cached = pickWeightId(await fetcher());
  } catch {
    cached = null;
  }
  return cached;
}

export interface NamedConceptRow {
  id: unknown;
  display_name: unknown;
  short_name: unknown;
}

/**
 * Concept id → display name map over manual-log concepts (symptom labels
 * for pattern displays and the logger alike). Malformed rows are skipped;
 * fetch failure yields an empty map, never a throw.
 */
export async function resolveConceptNames(fetcher: ConceptFetcher): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const rows = await fetcher();
    if (!Array.isArray(rows)) return out;
    for (const row of rows) {
      if (typeof row !== 'object' || row === null || Array.isArray(row)) continue;
      const r = row as Record<string, unknown>;
      if (typeof r.id !== 'string' || r.id.length === 0) continue;
      const name =
        (typeof r.display_name === 'string' && r.display_name.trim()) ||
        (typeof r.short_name === 'string' && r.short_name.trim()) ||
        '';
      if (name) out.set(r.id, name);
    }
  } catch {
    // Offline or backend hiccup: callers fall back to hiding labels.
  }
  return out;
}
