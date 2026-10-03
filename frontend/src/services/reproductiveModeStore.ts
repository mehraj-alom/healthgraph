/**
 * reproductiveModeStore.ts — AsyncStorage persistence for reproductive modes.
 *
 * Device-only like the cycle data it accompanies (cycle tracking never
 * syncs): three versioned keys holding the mode, the pregnancy anchor
 * (LMP or due date), and the ovulation-test log. Validation lives in
 * reproductiveModes.ts; this file only reads and writes JSON.
 *
 * Never imported by node tests (native storage import); covered by tsc
 * and the contract tests in reproductiveModes.test.mts.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  REPRODUCTIVE_MODE_KEY,
  OVULATION_TESTS_KEY,
  normalizeMode,
  normalizeOvulationTest,
  type OvulationTest,
  type ReproductiveMode,
} from './reproductiveModes';

export const MODE_ANCHOR_KEY = 'hg:reproductive-anchor:v1';

export interface StoredAnchor {
  patientId: string;
  lmp: string | null;
  due: string | null;
}

export interface StoredOvulationTests {
  patientId: string;
  tests: OvulationTest[];
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function cleanDay(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const day = raw.slice(0, 10);
  return DAY_RE.test(day) ? day : null;
}

export async function getMode(patientId: string): Promise<ReproductiveMode> {
  try {
    const raw = await AsyncStorage.getItem(REPRODUCTIVE_MODE_KEY);
    if (raw === null) return 'standard';
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return 'standard';
    return normalizeMode((parsed as Record<string, unknown>).mode);
  } catch {
    return 'standard';
  }
}

export async function setMode(patientId: string, mode: unknown): Promise<ReproductiveMode> {
  const clean = normalizeMode(mode);
  await AsyncStorage.setItem(REPRODUCTIVE_MODE_KEY, JSON.stringify({ patientId, mode: clean })).catch(
    () => {},
  );
  return clean;
}

export async function getAnchor(patientId: string): Promise<StoredAnchor> {
  const fallback: StoredAnchor = { patientId, lmp: null, due: null };
  try {
    const raw = await AsyncStorage.getItem(MODE_ANCHOR_KEY);
    if (raw === null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return fallback;
    const r = parsed as Record<string, unknown>;
    return { patientId, lmp: cleanDay(r.lmp), due: cleanDay(r.due) };
  } catch {
    return fallback;
  }
}

export async function setAnchor(
  patientId: string,
  input: { lmp?: unknown; due?: unknown },
): Promise<StoredAnchor> {
  const out: StoredAnchor = { patientId, lmp: cleanDay(input.lmp), due: cleanDay(input.due) };
  await AsyncStorage.setItem(MODE_ANCHOR_KEY, JSON.stringify(out)).catch(() => {});
  return out;
}

export async function getOvulationTests(patientId: string): Promise<StoredOvulationTests> {
  const fallback: StoredOvulationTests = { patientId, tests: [] };
  try {
    const raw = await AsyncStorage.getItem(OVULATION_TESTS_KEY);
    if (raw === null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return fallback;
    const list = (parsed as Record<string, unknown>).tests;
    if (!Array.isArray(list)) return fallback;
    const tests: OvulationTest[] = [];
    for (const item of list) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
      const r = item as Record<string, unknown>;
      try {
        const clean = normalizeOvulationTest({ day: r.day, result: r.result });
        if (!tests.some((t) => t.day === clean.day)) tests.push(clean);
      } catch {
        // Corrupt rows are dropped, never crash the store.
      }
    }
    return { patientId, tests };
  } catch {
    return fallback;
  }
}

export async function addOvulationTest(
  patientId: string,
  input: { day: unknown; result: unknown },
): Promise<StoredOvulationTests> {
  const clean = normalizeOvulationTest(input);
  const current = await getOvulationTests(patientId);
  const next = current.tests.filter((t) => t.day !== clean.day);
  next.push(clean);
  next.sort((a, b) => (a.day < b.day ? -1 : 1));
  const out: StoredOvulationTests = { patientId, tests: next };
  await AsyncStorage.setItem(OVULATION_TESTS_KEY, JSON.stringify(out)).catch(() => {});
  return out;
}
