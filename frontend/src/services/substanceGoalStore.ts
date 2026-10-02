/**
 * substanceGoalStore.ts — AsyncStorage persistence for substance goals.
 *
 * Goals are device-only like the entries they govern (substance tracking
 * never syncs): one versioned key holding per-patient goals. Validation
 * lives in substanceGoals.ts; this file only reads and writes JSON.
 *
 * Never imported by node tests (native storage import); covered by tsc
 * and the contract tests in substanceGoals.test.mts.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { GOALS_STORAGE_KEY, normalizeGoal, type SubstanceGoal } from './substanceGoals';

export interface StoredSubstanceGoals {
  patientId: string;
  alcohol: SubstanceGoal;
  tobacco: SubstanceGoal;
}

const DEFAULTS: Omit<StoredSubstanceGoals, 'patientId'> = {
  alcohol: { category: 'alcohol', mode: 'track' },
  tobacco: { category: 'tobacco', mode: 'track' },
};

function normalizeStored(raw: unknown, patientId: string): StoredSubstanceGoals {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { patientId, ...structuredCloneDefaults() };
  }
  const r = raw as Record<string, unknown>;
  return {
    patientId,
    alcohol: normalizeGoal({ ...(typeof r.alcohol === 'object' && r.alcohol !== null ? r.alcohol : {}), category: 'alcohol' }),
    tobacco: normalizeGoal({ ...(typeof r.tobacco === 'object' && r.tobacco !== null ? r.tobacco : {}), category: 'tobacco' }),
  };
}

function structuredCloneDefaults(): Omit<StoredSubstanceGoals, 'patientId'> {
  return {
    alcohol: { ...DEFAULTS.alcohol },
    tobacco: { ...DEFAULTS.tobacco },
  };
}

export async function getSubstanceGoals(patientId: string): Promise<StoredSubstanceGoals> {
  try {
    const raw = await AsyncStorage.getItem(GOALS_STORAGE_KEY);
    if (raw === null) return { patientId, ...structuredCloneDefaults() };
    return normalizeStored(JSON.parse(raw), patientId);
  } catch {
    return { patientId, ...structuredCloneDefaults() };
  }
}

export async function setSubstanceGoal(patientId: string, goal: SubstanceGoal): Promise<StoredSubstanceGoals> {
  const current = await getSubstanceGoals(patientId);
  const clean = normalizeGoal({ ...goal, category: goal.category });
  const next: StoredSubstanceGoals = {
    patientId,
    alcohol: goal.category === 'alcohol' ? clean : current.alcohol,
    tobacco: goal.category === 'tobacco' ? clean : current.tobacco,
  };
  await AsyncStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(next)).catch(() => {});
  return next;
}
