/**
 * demoMode.ts — sandbox demo identity contract (pure).
 *
 * A reviewer demo runs as a synthetic patient that exists ONLY in local
 * SQLite: zero Firebase, zero backend, zero sync. The synthetic id is
 * fixed and recognizable so every layer (sync guards, erase, UI banner)
 * can name it without a database lookup.
 *
 * Zero imports: safe for node unit tests. The RN session (flag
 * persistence, seeding, wipe) lives in demoSession.ts / demoSeed.ts.
 */

/** Fixed synthetic patient id — never a backend row, never synced. */
export const DEMO_PATIENT_ID = 'demo-0000-4000-8000-000000000001';

/** AsyncStorage flag (versioned; plaintext UI pref, like pricing keys). */
export const DEMO_FLAG_KEY = 'hg:demo-mode:v1';

export function isDemoPatientId(value: unknown): value is string {
  return value === DEMO_PATIENT_ID;
}

/** Defensive flag parse: anything but an explicit true means off. */
export function normalizeDemoFlag(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') {
    try {
      return (JSON.parse(raw) as unknown) === true;
    } catch {
      return false;
    }
  }
  return false;
}
