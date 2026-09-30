/**
 * macroTargetStore.ts — device-only persistence for user-owned macro targets.
 *
 * Targets live in AsyncStorage per patient (same pattern as the voice
 * check-in time): no migration, no sync, wiped with app data. The screen
 * never fetches and never writes anywhere else.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ActivityBand, IntakeGoal, MacroTargets } from '@/screens/NutritionEngine/macroTargets';

export interface StoredMacroTargets {
  targets: MacroTargets;
  goal: IntakeGoal;
  activity: ActivityBand;
  ageYears: number | null;
  sex: 'female' | 'male' | null;
  savedAt: number;
}

const KEY_PREFIX = 'macro-targets-v1:';

function key(patientId: string): string {
  return `${KEY_PREFIX}${patientId}`;
}

export async function loadMacroTargets(patientId: string): Promise<StoredMacroTargets | null> {
  try {
    const raw = await AsyncStorage.getItem(key(patientId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredMacroTargets>;
    if (!parsed || typeof parsed !== 'object') return null;
    const t = (parsed.targets ?? {}) as Partial<MacroTargets>;
    const num = (v: unknown): number | null =>
      typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
    return {
      targets: { calories: num(t.calories), protein: num(t.protein), carbs: num(t.carbs), fat: num(t.fat) },
      goal: parsed.goal === 'lose' || parsed.goal === 'gain' ? parsed.goal : 'maintain',
      activity:
        parsed.activity === 'light' || parsed.activity === 'active' || parsed.activity === 'very-active'
          ? parsed.activity
          : 'moderate',
      ageYears: typeof parsed.ageYears === 'number' && Number.isFinite(parsed.ageYears) ? parsed.ageYears : null,
      sex: parsed.sex === 'female' || parsed.sex === 'male' ? parsed.sex : null,
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : 0,
    };
  } catch {
    return null;
  }
}

export async function saveMacroTargets(patientId: string, entry: StoredMacroTargets): Promise<void> {
  try {
    await AsyncStorage.setItem(key(patientId), JSON.stringify(entry));
  } catch {
    // Best-effort: the editor keeps working in-memory for the session.
  }
}
