/**
 * fastingStore.ts — AsyncStorage persistence for the fasting timer.
 *
 * Device-only (fasting never syncs): one versioned key holding the
 * active fast plus bounded history. Validation lives in fasting.ts;
 * this file only reads and writes JSON.
 *
 * Never imported by node tests (native storage import); covered by tsc
 * and the contract tests in fasting.test.mts.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  FASTING_STORAGE_KEY,
  capHistory,
  normalizeFastState,
  windowHours,
  type ActiveFast,
  type FastRecord,
  type FastState,
} from './fasting';

function validIso(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(new Date(value).getTime());
}

export async function getFasting(): Promise<FastState> {
  try {
    const raw = await AsyncStorage.getItem(FASTING_STORAGE_KEY);
    if (raw === null) return { active: null, history: [] };
    return normalizeFastState(JSON.parse(raw));
  } catch {
    return { active: null, history: [] };
  }
}

async function persist(state: FastState): Promise<FastState> {
  await AsyncStorage.setItem(FASTING_STORAGE_KEY, JSON.stringify(state)).catch(() => {});
  return state;
}

/** Start a fast now (replaces any active fast). Throws on unknown window. */
export async function startFast(windowId: string, startedAt?: string): Promise<FastState> {
  if (windowHours(windowId) === null) {
    throw new Error('Choose a fasting window first.');
  }
  const start = typeof startedAt === 'string' && validIso(startedAt)
    ? startedAt
    : new Date().toISOString();
  const current = await getFasting();
  const active: ActiveFast = { windowId, startedAt: start, endedAt: null };
  return persist({ active, history: current.history });
}

export interface EndedFast {
  state: FastState;
  record: FastRecord;
}

/**
 * End the active fast: at-or-past target completes, earlier ends early.
 * Throws when no fast is active.
 */
export async function endFast(endedAt?: string): Promise<EndedFast> {
  const current = await getFasting();
  if (current.active === null) {
    throw new Error('No fast is running.');
  }
  const hours = windowHours(current.active.windowId) ?? 0;
  const end = typeof endedAt === 'string' && validIso(endedAt)
    ? endedAt
    : new Date().toISOString();
  const elapsedMs = new Date(end).getTime() - new Date(current.active.startedAt).getTime();
  const record: FastRecord = {
    windowId: current.active.windowId,
    startedAt: current.active.startedAt,
    endedAt: end,
    completed: elapsedMs >= hours * 3600 * 1000,
  };
  const state: FastState = {
    active: null,
    history: capHistory([...current.history, record]),
  };
  await persist(state);
  return { state, record };
}
