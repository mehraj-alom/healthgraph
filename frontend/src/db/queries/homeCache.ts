/**
 * Local-first repository for HomeCache data.
 *
 * Migrates HomeCache from AsyncStorage to encrypted SQLite.
 *
 * Strategy:
 *   - profile_cache: Compact table for PatientProfile (display_name, phone, height, weight)
 *   - daily_metrics_cache: JSON blob for DailyMetrics (2 min TTL)
 *   - trends_cache: JSON blob for TrendsResponse (10 min TTL)
 *   - bodyState, documents, medications: Already in dedicated tables (Steps 7, 10, 11)
 *
 * Maps to:
 *   - services/homeCache.ts (replaces AsyncStorage storage)
 *   - hooks/useCachedQuery.ts (primary consumer)
 */

import type { SQLiteDatabase } from 'expo-sqlite';
import { getDatabase } from '../connection';
import type { PatientProfile, TrendsResponse } from '@/types';

// DailyMetrics is defined in hooks/useDailyMetrics.ts
interface DailyMetrics {
  latest_vitals: Array<{ concept_id: string | null; display_name: string; value: number | null; unit: string | null; event_time: string }>;
  today_wellbeing: { overall_wellbeing: number | null; energy_level: number | null; stress_level: number | null; event_time: string } | null;
  latest_pain: { severity: number; pain_type: string | null; event_time: string } | null;
  latest_sleep: { duration_minutes: number; sleep_quality: number | null; awakenings: number | null; event_time: string } | null;
  today_activity: { duration_minutes: number; calories_burned: number | null; activity_count: number; event_time: string } | null;
  recent_daily_logs: Array<{ log_date: string; event_count: number; categories: string[] }>;
}

// ============================================================================
// TTL values (matching original homeCache.ts)
// ============================================================================

export const CACHE_TTL = {
  profile: 10 * 60 * 1000, // 10 minutes
  dailyMetrics: 2 * 60 * 1000, // 2 minutes
  trends: 10 * 60 * 1000, // 10 minutes
} as const;

// ============================================================================
// READ — Profile
// ============================================================================

export async function getProfileCache(
  patientId: string,
): Promise<{ data: PatientProfile | null; cachedAt: number }> {
  const db = await getDatabase();

  const row = await db.getFirstAsync<{
    display_name: string | null;
    phone_number: string | null;
    height_cm: number | null;
    weight_kg: number | null;
    cached_at: string;
  }>(
    `
    SELECT display_name, phone_number, height_cm, weight_kg, cached_at
    FROM profile_cache
    WHERE patient_id = ?
    `,
    [patientId],
  );

  if (!row) return { data: null, cachedAt: 0 };

  return {
    data: {
      display_name: row.display_name,
      phone_number: row.phone_number,
      height_cm: row.height_cm,
      weight_kg: row.weight_kg,
    },
    cachedAt: new Date(row.cached_at).getTime(),
  };
}

// ============================================================================
// WRITE — Profile
// ============================================================================

export async function setProfileCache(
  patientId: string,
  profile: PatientProfile,
): Promise<void> {
  const db = await getDatabase();

  await db.runAsync(
    `
    INSERT INTO profile_cache (patient_id, display_name, phone_number, height_cm, weight_kg, cached_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(patient_id) DO UPDATE SET
      display_name = excluded.display_name,
      phone_number = excluded.phone_number,
      height_cm = excluded.height_cm,
      weight_kg = excluded.weight_kg,
      cached_at = datetime('now')
    `,
    [
      patientId,
      profile.display_name,
      profile.phone_number,
      profile.height_cm,
      profile.weight_kg,
    ],
  );
}

// ============================================================================
// READ — Daily Metrics
// ============================================================================

export async function getDailyMetricsCache(
  patientId: string,
): Promise<{ data: DailyMetrics | null; cachedAt: number }> {
  const db = await getDatabase();

  const row = await db.getFirstAsync<{
    metrics_json: string;
    cached_at: string;
  }>(
    `
    SELECT metrics_json, cached_at
    FROM daily_metrics_cache
    WHERE patient_id = ?
    `,
    [patientId],
  );

  if (!row) return { data: null, cachedAt: 0 };

  try {
    return {
      data: JSON.parse(row.metrics_json) as DailyMetrics,
      cachedAt: new Date(row.cached_at).getTime(),
    };
  } catch {
    return { data: null, cachedAt: 0 };
  }
}

// ============================================================================
// WRITE — Daily Metrics
// ============================================================================

export async function setDailyMetricsCache(
  patientId: string,
  metrics: DailyMetrics,
): Promise<void> {
  const db = await getDatabase();

  await db.runAsync(
    `
    INSERT INTO daily_metrics_cache (patient_id, metrics_json, cached_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(patient_id) DO UPDATE SET
      metrics_json = excluded.metrics_json,
      cached_at = datetime('now')
    `,
    [patientId, JSON.stringify(metrics)],
  );
}

// ============================================================================
// READ — Trends
// ============================================================================

export async function getTrendsCache(
  patientId: string,
  days: number,
): Promise<{ data: TrendsResponse | null; cachedAt: number }> {
  const db = await getDatabase();

  const row = await db.getFirstAsync<{
    trends_json: string;
    cached_at: string;
  }>(
    `
    SELECT trends_json, cached_at
    FROM trends_cache
    WHERE patient_id = ? AND days = ?
    `,
    [patientId, days],
  );

  if (!row) return { data: null, cachedAt: 0 };

  try {
    return {
      data: JSON.parse(row.trends_json) as TrendsResponse,
      cachedAt: new Date(row.cached_at).getTime(),
    };
  } catch {
    return { data: null, cachedAt: 0 };
  }
}

// ============================================================================
// WRITE — Trends
// ============================================================================

export async function setTrendsCache(
  patientId: string,
  days: number,
  trends: TrendsResponse,
): Promise<void> {
  const db = await getDatabase();

  await db.runAsync(
    `
    INSERT INTO trends_cache (patient_id, days, trends_json, cached_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(patient_id, days) DO UPDATE SET
      trends_json = excluded.trends_json,
      cached_at = datetime('now')
    `,
    [patientId, days, JSON.stringify(trends)],
  );
}

// ============================================================================
// CLEAR — Logout / Account Switch
// ============================================================================

/**
 * Clear all cache data for a patient.
 * Called on logout or account switch.
 */
export async function clearHomeCache(patientId: string): Promise<void> {
  const db = await getDatabase();

  await db.withTransactionAsync(async () => {
    await db.runAsync(`DELETE FROM profile_cache WHERE patient_id = ?`, [patientId]);
    await db.runAsync(`DELETE FROM daily_metrics_cache WHERE patient_id = ?`, [patientId]);
    await db.runAsync(`DELETE FROM trends_cache WHERE patient_id = ?`, [patientId]);
  });
}

// ============================================================================
// LEGACY MIGRATION — AsyncStorage → SQLite
// ============================================================================

/**
 * Migrate legacy AsyncStorage HomeCache data to SQLite.
 *
 * Strategy:
 *   - Read old AsyncStorage keys (home:{uid}:profile:v1, etc.)
 *   - Parse and validate data
 *   - Write to SQLite cache tables
 *   - Remove old AsyncStorage keys
 *   - If data is malformed, skip silently (will be re-fetched from server)
 *
 * This is a one-time migration per user.
 */
export async function migrateLegacyHomeCache(
  patientId: string,
  legacyData: {
    profile?: PatientProfile;
    dailyMetrics?: DailyMetrics;
    trends?: TrendsResponse;
  },
): Promise<void> {
  const db = await getDatabase();

  await db.withTransactionAsync(async () => {
    // Migrate profile
    if (legacyData.profile) {
      await db.runAsync(
        `
        INSERT OR IGNORE INTO profile_cache (patient_id, display_name, phone_number, height_cm, weight_kg, cached_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        `,
        [
          patientId,
          legacyData.profile.display_name,
          legacyData.profile.phone_number,
          legacyData.profile.height_cm,
          legacyData.profile.weight_kg,
        ],
      );
    }

    // Migrate daily metrics
    if (legacyData.dailyMetrics) {
      await db.runAsync(
        `
        INSERT OR IGNORE INTO daily_metrics_cache (patient_id, metrics_json, cached_at)
        VALUES (?, ?, datetime('now'))
        `,
        [patientId, JSON.stringify(legacyData.dailyMetrics)],
      );
    }

    // Migrate trends
    if (legacyData.trends) {
      await db.runAsync(
        `
        INSERT OR IGNORE INTO trends_cache (patient_id, days, trends_json, cached_at)
        VALUES (?, ?, ?, datetime('now'))
        `,
        [patientId, legacyData.trends.period_days ?? 30, JSON.stringify(legacyData.trends)],
      );
    }
  });
}
