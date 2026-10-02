/**
 * fasting.ts — on-device fasting timer pure contract.
 *
 * Fixed window presets; one active fast at a time with ISO timestamps
 * (reload- and kill-safe: elapsed derives from now minus startedAt, no
 * background timer needed). Ending at or past the target completes;
 * ending early records early — history is never rewritten. Bounded
 * history, tolerant parsing.
 *
 * Zero imports: safe for node unit tests.
 */

export interface FastingWindow {
  id: string;
  fastHours: number;
}

export const FASTING_WINDOWS: FastingWindow[] = [
  { id: '12:12', fastHours: 12 },
  { id: '14:10', fastHours: 14 },
  { id: '16:8', fastHours: 16 },
  { id: '18:6', fastHours: 18 },
  { id: '20:4', fastHours: 20 },
];

/** Versioned AsyncStorage key (single writer is fastingStore.ts). */
export const FASTING_STORAGE_KEY = 'hg:fasting:v1';

export const FAST_HISTORY_MAX = 60;

export interface ActiveFast {
  windowId: string;
  startedAt: string;
  endedAt: string | null;
}

export interface FastRecord {
  windowId: string;
  startedAt: string;
  endedAt: string;
  completed: boolean;
}

export interface FastState {
  active: ActiveFast | null;
  history: FastRecord[];
}

export type FastPhase = 'idle' | 'fasting' | 'done';

export interface FastStatus {
  phase: FastPhase;
  elapsedMs: number;
  remainingMs: number;
  targetMs: number | null;
}

export function windowHours(windowId: string): number | null {
  const found = FASTING_WINDOWS.find((w) => w.id === windowId);
  return found ? found.fastHours : null;
}

function validIso(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(new Date(value).getTime());
}

/** Tolerant parse of stored state; garbage degrades to empty. Pure. */
export function normalizeFastState(raw: unknown): FastState {
  const fallback: FastState = { active: null, history: [] };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fallback;
  const r = raw as Record<string, unknown>;
  let active: ActiveFast | null = null;
  const a = r.active;
  if (typeof a === 'object' && a !== null && !Array.isArray(a)) {
    const ar = a as Record<string, unknown>;
    if (
      typeof ar.windowId === 'string' &&
      windowHours(ar.windowId) !== null &&
      validIso(ar.startedAt) &&
      (ar.endedAt === null || validIso(ar.endedAt))
    ) {
      active = { windowId: ar.windowId, startedAt: ar.startedAt, endedAt: ar.endedAt };
    }
  }
  const history: FastRecord[] = [];
  if (Array.isArray(r.history)) {
    for (const item of r.history) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
      const ir = item as Record<string, unknown>;
      if (
        typeof ir.windowId !== 'string' ||
        windowHours(ir.windowId) === null ||
        !validIso(ir.startedAt) ||
        !validIso(ir.endedAt) ||
        typeof ir.completed !== 'boolean'
      ) {
        continue;
      }
      history.push({
        windowId: ir.windowId,
        startedAt: ir.startedAt,
        endedAt: ir.endedAt,
        completed: ir.completed,
      });
    }
  }
  return { active, history: capHistory(history) };
}

/** Phase + remaining from the stored active fast. Pure. */
export function fastStatus(active: ActiveFast | null, nowMs: number): FastStatus {
  const idle: FastStatus = { phase: 'idle', elapsedMs: 0, remainingMs: 0, targetMs: null };
  if (active === null) return idle;
  const targetHours = windowHours(active.windowId);
  const startMs = validIso(active.startedAt) ? new Date(active.startedAt).getTime() : NaN;
  if (targetHours === null || Number.isNaN(startMs)) return idle;
  const targetMs = targetHours * 3600 * 1000;
  const elapsedMs = Math.max(0, nowMs - startMs);
  if (elapsedMs >= targetMs) {
    return { phase: 'done', elapsedMs, remainingMs: 0, targetMs };
  }
  return { phase: 'fasting', elapsedMs, remainingMs: targetMs - elapsedMs, targetMs };
}

/** Newest-last history capped at 60. Pure. */
export function capHistory(history: ReadonlyArray<FastRecord>): FastRecord[] {
  if (history.length <= FAST_HISTORY_MAX) return [...history];
  return history.slice(history.length - FAST_HISTORY_MAX);
}

/** Elapsed display as H:MM. Pure. */
export function fmtFastDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}
