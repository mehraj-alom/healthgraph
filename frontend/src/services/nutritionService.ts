import axios from 'axios';

import { api } from '@/services/api';
import { getCachedPatientId } from '@/services/patientIdentity';
import {
  getDailyLogDetail as dbGetDailyLogDetail,
  upsertDailyLog as dbUpsertDailyLog,
  getPendingMutationId as dbGetPendingMutationId,
  reconcileDailyLogGroupId as dbReconcileDailyLogGroupId,
} from '@/db/queries/dailyLogs';
import type {
  DailyCheckInDetail,
  DailyCheckInRequest,
  DailyCheckInResponse,
} from '@/types';
// Pure meal classification (screens/FoodScan/mealTypes has zero imports, so
// no layer cycle: the scan UI and this pipeline share one definition).
import { isMealType, stripMealPrefix } from '@/screens/FoodScan/mealTypes';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ─── Frozen API contract (POST /api/v1/nutrition/analyze) ────────────────────

export type FoodScanConfidence = 'low' | 'med' | 'high';

export interface FoodScanItem {
  label: string;
  grams: number;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  confidence: FoodScanConfidence;
  /** Retail barcode when the item came from a barcode scan (else absent). */
  barcode?: string;
}

export interface FoodScanResult {
  items: FoodScanItem[];
  total_kcal: number;
  confidence: FoodScanConfidence;
  note: string;
}

function mimeForUri(uri: string): string {
  const lower = uri.split('?')[0].toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.heic') || lower.endsWith('.heif')) return 'image/heic';
  return 'image/jpeg';
}

function nameForUri(uri: string): string {
  const lower = uri.split('?')[0].toLowerCase();
  if (lower.endsWith('.png')) return 'meal.png';
  if (lower.endsWith('.webp')) return 'meal.webp';
  if (lower.endsWith('.heic') || lower.endsWith('.heif')) return 'meal.heic';
  return 'meal.jpg';
}

/**
 * POST a meal photo as multipart `photo` and return the calorie estimate.
 * Mirrors the documents upload path: FormData with a { uri, name, type }
 * part, and NO manual Content-Type so Axios generates the boundary.
 */
export async function analyzePhoto(uri: string): Promise<FoodScanResult> {
  const formData = new FormData();
  formData.append('photo', {
    uri,
    name: nameForUri(uri),
    type: mimeForUri(uri),
  } as unknown as Blob);

  // Do NOT set Content-Type manually — Axios must generate the multipart
  // boundary automatically (same rule as documents.ts uploads).
  const response = await api.getClient().post<FoodScanResult>(
    '/api/v1/nutrition/analyze',
    formData,
    { timeout: 120000 },
  );
  const data = response.data;
  if (!data || !Array.isArray(data.items) || typeof data.total_kcal !== 'number') {
    throw new Error('The photo could not be analyzed. Please try again.');
  }
  return data;
}

export function analyzeErrorMessage(error: unknown): string {
  if (!axios.isAxiosError(error)) {
    return error instanceof Error && error.message
      ? error.message
      : 'The photo could not be analyzed. Please try again.';
  }
  if (error.code === 'ECONNABORTED') return 'The request timed out. Please try again.';
  if (error.response?.status === 401) return 'Your session has expired. Please sign in again.';
  if (error.response?.status === 413) return 'That photo is too large. Try a smaller one.';
  if (error.response?.status === 422) {
    const detail = (error.response.data as { detail?: unknown } | undefined)?.detail;
    return typeof detail === 'string' ? detail : 'That photo could not be read. Try another one.';
  }
  if (error.response?.status === 404) return 'Food scanning is not enabled on the server yet. Please update the app backend and try again.';
  if ((error.response?.status ?? 0) >= 500) {
    return 'Calorie estimation is unavailable right now. Please try again shortly.';
  }
  if (error.code === 'ERR_NETWORK' || error.response == null) {
    return 'You appear to be offline. Reconnect and try again.';
  }
  return 'The photo could not be analyzed. Please try again.';
}

// ─── Scanned-meal logging (existing daily-log save path, extended) ───────────

function todayLocal(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Rebuild a full DailyCheckInRequest from an existing detail so the
 * upsert (which replaces the day's events) preserves everything the user
 * already logged. Only the nutrition block is extended.
 */
function detailToRequest(
  existing: DailyCheckInDetail | null,
  logDate: string,
  nutrition: NonNullable<DailyCheckInRequest['nutrition']>,
): DailyCheckInRequest {
  const sleep =
    existing?.sleep_duration_minutes != null
      ? {
          duration_minutes: existing.sleep_duration_minutes,
          ...(existing.sleep_quality != null ? { sleep_quality: existing.sleep_quality } : {}),
          ...(existing.sleep_awakenings != null ? { awakenings: existing.sleep_awakenings } : {}),
        }
      : undefined;
  return {
    log_date: logDate,
    ...(existing?.overall_wellbeing != null ? { overall_wellbeing: existing.overall_wellbeing } : {}),
    ...(existing?.energy_level != null ? { energy_level: existing.energy_level } : {}),
    ...(existing?.stress_level != null ? { stress_level: existing.stress_level } : {}),
    ...(sleep ? { sleep } : {}),
    symptoms: (existing?.symptoms ?? [])
      .filter((s) => s.concept_id != null && s.concept_id !== '')
      .map((s) => ({
        concept_id: s.concept_id as string,
        severity: s.severity,
        ...(s.duration_minutes != null ? { duration_minutes: s.duration_minutes } : {}),
        ...(s.notes ? { notes: s.notes } : {}),
      })),
    vitals: (existing?.vitals ?? [])
      .filter((v) => v.concept_id != null && v.concept_id !== '')
      .map((v) => ({
        concept_id: v.concept_id as string,
        value: v.value,
        unit: v.unit,
      })),
    pain: (existing?.pain ?? []).map((p) => ({
      severity: p.severity,
      // Only forward well-formed UUIDs: the server FKs body_location_id to
      // body_regions, and a stale/local id would 500 the whole check-in.
      ...(p.body_location_id && UUID_PATTERN.test(p.body_location_id)
        ? { body_location_id: p.body_location_id }
        : {}),
      ...(p.pain_type ? { pain_type: p.pain_type } : {}),
    })),
    activities: (existing?.activities ?? []).map((a) => ({
      activity_type: a.activity_type,
      ...(a.duration_minutes != null ? { duration_minutes: a.duration_minutes } : {}),
      ...(a.calories_burned != null ? { calories_burned: a.calories_burned } : {}),
    })),
    medications: (existing?.medications ?? []).map((m) => ({
      medication_name: m.medication_name,
      ...(m.dosage_value != null ? { dosage_value: m.dosage_value } : {}),
      ...(m.dosage_unit ? { dosage_unit: m.dosage_unit } : {}),
    })),
    nutrition,
    ...(existing?.notes ? { notes: existing.notes } : {}),
  };
}

/**
 * Log a scanned meal into today's daily log through the EXISTING save path:
 * local SQLite mirror first (offline-first), then a direct server POST/PUT,
 * then group-id reconciliation — the same sequence VitalsLoggerScreen uses.
 *
 * Pure extension of the nutrition block: meals_count + 1, calories summed,
 * food label appended. Water / appetite and every other section are
 * preserved byte-for-byte.
 *
 * The mealType classification ("Lunch", "Snack", …) is required: a scan
 * identifies food, it never becomes a meal on its own. The type travels
 * inside the existing food_label pipeline ("<Type> — <items>") so no
 * schema or backend change is needed.
 */
export async function logScannedMeal(
  totalKcal: number,
  label: string,
  mealType?: string,
): Promise<{ groupId: string; serverSaved: boolean }> {
  const patientId = getCachedPatientId();
  if (!patientId) {
    throw new Error('Your session has expired. Please sign in again.');
  }
  const kcal = Math.max(0, Math.round(totalKcal));
  const rawLabel = label.trim().slice(0, 200) || 'Scanned meal';
  // Re-classification safe: strip a previous "<Type> — " prefix first so a
  // corrected type never stacks ("Lunch — Dinner — …").
  const unprefixed = stripMealPrefix(rawLabel);
  const cleanLabel = (
    mealType && isMealType(mealType) ? `${mealType} — ${unprefixed}` : unprefixed
  ).slice(0, 250);
  const logDate = todayLocal();

  // Read today's existing log so nothing already saved is lost.
  let existing: DailyCheckInDetail | null = null;
  try {
    existing = await dbGetDailyLogDetail(patientId, logDate);
  } catch {
    existing = null;
  }

  const prevMeals = existing?.meals_count ?? 0;
  const prevKcal = existing?.calories_kcal ?? 0;
  const prevLabel = existing?.food_label?.trim() ?? '';
  const nextLabel = prevLabel ? `${prevLabel}; ${cleanLabel}`.slice(0, 250) : cleanLabel.slice(0, 250);

  const nutrition: NonNullable<DailyCheckInRequest['nutrition']> = {
    ...(existing?.water_ml != null ? { water_ml: existing.water_ml } : {}),
    meals_count: prevMeals + 1,
    ...(existing?.appetite_level != null ? { appetite_level: existing.appetite_level } : {}),
    calories_kcal: prevKcal + kcal,
    food_label: nextLabel,
  };

  const payload = detailToRequest(existing, logDate, nutrition);

  // Step 1: local SQLite mirror (offline-first) — also enqueues the
  // sync-engine mutation.
  const groupId = await dbUpsertDailyLog(patientId, payload);

  // Step 2: direct server persistence (fire-and-forget from the user's
  // perspective — local data is already safe).
  const serverGroupId = existing?.group_id ?? null;
  const hasServerGroupId = serverGroupId != null && UUID_PATTERN.test(serverGroupId);
  const method = hasServerGroupId ? 'PUT' : 'POST';
  const path = hasServerGroupId
    ? `/api/v1/logs/daily-checkin/${serverGroupId}`
    : '/api/v1/logs/daily-checkin';
  try {
    const idempotencyKey = await dbGetPendingMutationId('daily_logs', groupId);
    const config = idempotencyKey
      ? { headers: { 'Idempotency-Key': idempotencyKey } }
      : undefined;
    try {
      const response = hasServerGroupId
        ? await api.put<DailyCheckInResponse>(path, payload, config)
        : await api.post<DailyCheckInResponse>(path, payload, config);
      if (response.group_id) {
        await dbReconcileDailyLogGroupId(groupId, response.group_id);
      }
      return { groupId: response.group_id ?? groupId, serverSaved: true };
    } catch (keyedError) {
      // 409 = this key is bound to a different payload hash server-side
      // (stale queued key after local edits). Retry once keyless so the
      // server evaluates the current payload on its own merits.
      const keyedStatus = axios.isAxiosError(keyedError) ? keyedError.response?.status : undefined;
      if (keyedStatus !== 409 || hasServerGroupId) throw keyedError;
      const response = await api.post<DailyCheckInResponse>(path, payload);
      if (response.group_id) {
        await dbReconcileDailyLogGroupId(groupId, response.group_id);
      }
      return { groupId: response.group_id ?? groupId, serverSaved: true };
    }
  } catch (error) {
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
    if (__DEV__) {
      console.warn(
        `[FoodScan] API_SYNC_FAILURE method=${method} path=${path} status=${status ?? 'none'}`,
      );
    }
    // Local save already succeeded — the sync engine retries the queued
    // mutation when connectivity returns.
    return { groupId, serverSaved: false };
  }
}
