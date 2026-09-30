/**
 * healthGraphCache.ts — persistent stale-while-revalidate store for the
 * health graph payload.
 *
 * The server mints an opaque revision key per patient on every graph
 * mutation (see core/neo4j_client.bump_patient_graph_rev). This module
 * stores full payloads against that key in AsyncStorage:
 *
 * - Screen open: cached payload paints instantly (no network wait).
 * - Background: GET /health-graph/revision (~ms). Key match → keep cache,
 *   no heavy query. Mismatch → full fetch, replace cache + key.
 * - Refresh button: same path via refetch() — a matching key resolves
 *   from cache, so "refresh" is honest: it revalidates, not just respins.
 *
 * Cache key includes patient + query params: different filters are
 * different entries. A null server rev always forces a full fetch.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { HealthGraphData } from '@/hooks/useHealthGraph';

export interface CachedGraph {
  rev: string | null;
  data: HealthGraphData;
  savedAt: number;
}

const PREFIX = 'hg-graph-cache:v1:';

export function graphCacheKey(
  patientId: string,
  depth: number,
  limit: number,
  category: string | null | undefined,
): string {
  return `${PREFIX}${patientId}:${depth}:${limit}:${category ?? '-'}`;
}

export async function loadGraphCache(key: string): Promise<CachedGraph | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedGraph>;
    if (!parsed || typeof parsed !== 'object' || !parsed.data) return null;
    return {
      rev: typeof parsed.rev === 'string' ? parsed.rev : null,
      data: parsed.data as HealthGraphData,
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : 0,
    };
  } catch {
    return null;
  }
}

export async function saveGraphCache(key: string, entry: CachedGraph): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // Quota or serialization failure: caching is best-effort, the
    // network path still works. Never throw into the query function.
  }
}

export async function clearGraphCacheForPatient(patientId: string): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const ours = keys.filter((k) => k.startsWith(`${PREFIX}${patientId}:`));
    if (ours.length > 0) await AsyncStorage.multiRemove(ours);
  } catch {
    // Best-effort.
  }
}
