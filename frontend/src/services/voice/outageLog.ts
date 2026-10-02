/**
 * outageLog.ts — on-device voice outage markers for observability.
 *
 * When server transcription is down (MODEL_UNAVAILABLE), the check-in
 * apologizes and offers manual entry — and records a structured marker
 * here so outages are countable per device/day. Markers carry no PII:
 * kind + error code + timestamp only, never transcripts, audio, or
 * patient identifiers. Capped list, corrupt-store tolerant.
 *
 * Node-testable by design: list ops are pure over explicit arrays; the
 * AsyncStorage wrapper is lazy (production only).
 */

import type { VoiceErrorCode } from './errors';

export const OUTAGE_KIND = 'voice_stt_unavailable';
export const OUTAGE_STORE_KEY = 'voice-stt-outages-v1';
export const MAX_OUTAGES = 50;

export interface SttOutage {
  kind: typeof OUTAGE_KIND;
  code: VoiceErrorCode;
  /** ISO timestamp of the failed turn. */
  at: string;
}

/**
 * True only when server transcription itself is down. Transient turn
 * failures (timeout, garbled audio) keep retry behavior; permission and
 * audio problems are device state, not outages — none of them mark.
 */
export function isSttOutage(code: unknown): boolean {
  return code === 'MODEL_UNAVAILABLE';
}

/** Append a marker, oldest dropped past the cap. Pure. */
export function appendOutage(entries: readonly SttOutage[], entry: SttOutage): SttOutage[] {
  const next = [...entries, entry];
  return next.length > MAX_OUTAGES ? next.slice(next.length - MAX_OUTAGES) : next;
}

/** Parse a stored list; corrupt stores yield empty, never throw. Pure. */
export function parseOutageLog(raw: unknown): SttOutage[] {
  if (typeof raw !== 'string' || raw.length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: SttOutage[] = [];
    for (const item of parsed) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
      const r = item as Record<string, unknown>;
      if (r.kind !== OUTAGE_KIND || typeof r.code !== 'string' || typeof r.at !== 'string') continue;
      out.push({ kind: OUTAGE_KIND, code: r.code as VoiceErrorCode, at: r.at });
    }
    return out;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Production entry points (lazy storage)
// ---------------------------------------------------------------------------

async function readOutages(): Promise<SttOutage[]> {
  try {
    const { default: AsyncStorage } = await import('@react-native-async-storage/async-storage');
    return parseOutageLog(await AsyncStorage.getItem(OUTAGE_STORE_KEY));
  } catch {
    return [];
  }
}

/** Record an STT outage marker. Best-effort — marking never fails the UI. */
export async function markSttOutage(code: VoiceErrorCode, at?: string): Promise<void> {
  try {
    const { default: AsyncStorage } = await import('@react-native-async-storage/async-storage');
    const next = appendOutage(await readOutages(), {
      kind: OUTAGE_KIND,
      code,
      at: typeof at === 'string' && at.length > 0 ? at : new Date().toISOString(),
    });
    await AsyncStorage.setItem(OUTAGE_STORE_KEY, JSON.stringify(next)).catch(() => {});
  } catch {
    // Marking is observability, not the user flow — never throw.
  }
}

/** Stored markers, newest last. Used by future outage-review surfaces. */
export async function listSttOutages(): Promise<SttOutage[]> {
  return readOutages();
}
