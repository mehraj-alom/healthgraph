/**
 * demoSession.ts — sandbox demo enter/exit (RN only, native imports).
 *
 * Entry is only ever offered while signed out (Onboarding), so a demo
 * session provably has no Firebase user, no token, and no backend row:
 * every server call fails closed and every SQLite read scopes to the
 * demo patient through the identity override. Exit wipes all demo rows.
 *
 * Never imported by node tests (native imports); covered by tsc and the
 * contract tests in demo.test.mts.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { setDemoOverride } from './patientIdentity';
import { DEMO_FLAG_KEY, DEMO_PATIENT_ID, normalizeDemoFlag } from './demoMode';
import { seedDemoPatient } from './demoSeed';
import { deletePatientLocalData } from '@/db/queries/patientErase';
import { requestDataRefresh } from './dataRefresh';

/** True when a demo session is active on this device. */
export async function isDemoMode(): Promise<boolean> {
  try {
    return normalizeDemoFlag(await AsyncStorage.getItem(DEMO_FLAG_KEY));
  } catch {
    return false;
  }
}

/**
 * Enter the sandbox: flag on, identity shadow on, deterministic seed.
 * A previous partial seed is wiped first so re-entry is idempotent.
 */
export async function enterDemoMode(): Promise<void> {
  await AsyncStorage.setItem(DEMO_FLAG_KEY, JSON.stringify(true)).catch(() => {});
  setDemoOverride(DEMO_PATIENT_ID);
  try {
    await deletePatientLocalData(DEMO_PATIENT_ID);
  } catch {
    // Best-effort: a fresh device has nothing to wipe.
  }
  await seedDemoPatient(DEMO_PATIENT_ID);
  requestDataRefresh();
}

/**
 * Exit the sandbox: wipe every demo row, drop the flag and the shadow.
 * Real SecureStore identity underneath is never touched.
 */
export async function exitDemoMode(): Promise<void> {
  try {
    await deletePatientLocalData(DEMO_PATIENT_ID);
  } finally {
    setDemoOverride(null);
    await AsyncStorage.removeItem(DEMO_FLAG_KEY).catch(() => {});
    requestDataRefresh();
  }
}
