/**
 * substancePledgeStore.ts — AsyncStorage persistence for pledges + savings.
 *
 * Device-only like the goals they accompany (substance tracking never
 * syncs): two versioned keys holding per-patient rows. Validation lives
 * in substancePledge.ts; this file only reads and writes JSON.
 *
 * Never imported by node tests (native storage import); covered by tsc
 * and the contract tests in substancePledge.test.mts.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  PLEDGE_STORAGE_KEY,
  SAVINGS_STORAGE_KEY,
  normalizePledge,
  normalizeSavingsPlan,
  type NormalizedPledge,
  type PledgeCategory,
  type SavingsPlan,
} from './substancePledge';

export interface StoredPledges {
  patientId: string;
  pledges: NormalizedPledge[];
}

export type StoredSavings = {
  patientId: string;
} & Record<PledgeCategory, SavingsPlan | null>;

function storedPledges(patientId: string, pledges: NormalizedPledge[]): StoredPledges {
  return { patientId, pledges };
}

function storedSavings(
  patientId: string,
  alcohol: SavingsPlan | null,
  tobacco: SavingsPlan | null,
): StoredSavings {
  return { patientId, alcohol, tobacco };
}

function normalizePledgeList(raw: unknown): NormalizedPledge[] {
  if (!Array.isArray(raw)) return [];
  const out: NormalizedPledge[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
    const r = item as Record<string, unknown>;
    try {
      const clean = normalizePledge({ category: r.category, day: r.day, reason: r.reason });
      if (!out.some((p) => p.category === clean.category && p.day === clean.day)) {
        out.push(clean);
      }
    } catch {
      // Corrupt rows are dropped, never crash the store.
    }
  }
  return out;
}

function normalizePlan(raw: unknown, category: PledgeCategory): SavingsPlan | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  try {
    const clean = normalizeSavingsPlan({
      category,
      amountPerDay: r.amountPerDay,
      currency: r.currency,
    });
    if (clean.category !== category) return null;
    return clean;
  } catch {
    return null;
  }
}

export async function getPledges(patientId: string): Promise<StoredPledges> {
  try {
    const raw = await AsyncStorage.getItem(PLEDGE_STORAGE_KEY);
    if (raw === null) return storedPledges(patientId, []);
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return storedPledges(patientId, []);
    }
    const list = (parsed as Record<string, unknown>).pledges;
    return storedPledges(patientId, normalizePledgeList(list));
  } catch {
    return storedPledges(patientId, []);
  }
}

export async function addPledge(
  patientId: string,
  input: { category: unknown; day: unknown; reason?: unknown },
): Promise<StoredPledges> {
  const clean = normalizePledge(input);
  const current = await getPledges(patientId);
  const next = current.pledges.filter((p) => !(p.category === clean.category && p.day === clean.day));
  next.push(clean);
  const out = storedPledges(patientId, next);
  await AsyncStorage.setItem(PLEDGE_STORAGE_KEY, JSON.stringify(out)).catch(() => {});
  return out;
}

export async function getSavings(patientId: string): Promise<StoredSavings> {
  const fallback = storedSavings(patientId, null, null);
  try {
    const raw = await AsyncStorage.getItem(SAVINGS_STORAGE_KEY);
    if (raw === null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return fallback;
    const r = parsed as Record<string, unknown>;
    return storedSavings(patientId, normalizePlan(r.alcohol, 'alcohol'), normalizePlan(r.tobacco, 'tobacco'));
  } catch {
    return fallback;
  }
}

export async function setSavingsPlan(
  patientId: string,
  input: { category: unknown; amountPerDay: unknown; currency?: unknown },
): Promise<StoredSavings> {
  const clean = normalizeSavingsPlan(input);
  const current = await getSavings(patientId);
  const out =
    clean.category === 'alcohol'
      ? storedSavings(patientId, clean, current.tobacco)
      : storedSavings(patientId, current.alcohol, clean);
  await AsyncStorage.setItem(SAVINGS_STORAGE_KEY, JSON.stringify(out)).catch(() => {});
  return out;
}
