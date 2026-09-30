/**
 * foodScans.ts — per-item food-scan breakdown (device-only, local-first).
 *
 * The daily log keeps day totals only (meals_count, calories_kcal,
 * food_label). The estimate behind each scan — food names, grams, kcal,
 * protein/carbs/fat, confidence — lands here so the timeline can show
 * exactly what the camera saw when a nutrition row is tapped.
 *
 * Device-only by design (no sync_status, no queue rows, wiped with the
 * patient row on deletion) — the UI labels this data accordingly.
 * Estimates stay estimates: nothing here is measured nutrition.
 *
 * Node-testable by design: logic takes an explicit database handle and
 * this module has zero runtime imports (production entry points resolve
 * the encrypted database lazily).
 */

export interface FoodScanItemRow {
  label: string;
  grams: number;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  confidence: string;
  /** Retail barcode when the row came from a barcode scan (else absent). */
  barcode?: string;
}

export interface FoodScanBreakdown {
  scan_id: string;
  patient_id: string;
  log_date: string;
  meal_label: string;
  meal_type: string | null;
  items: FoodScanItemRow[];
  total_kcal: number;
  confidence: string | null;
  created_at: string;
}

export interface FoodScanDb {
  getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]>;
  runAsync(sql: string, ...params: unknown[]): Promise<{ changes: unknown }>;
}

interface FoodScanItemsTableRow {
  scan_id: string;
  patient_id: string;
  log_date: string;
  meal_label: string;
  meal_type: string | null;
  items_json: string | null;
  total_kcal: number | null;
  confidence: string | null;
  created_at: string;
}

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function cleanNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function cleanItems(items: readonly unknown[]): FoodScanItemRow[] {
  const out: FoodScanItemRow[] = [];
  for (const raw of items) {
    if (raw == null || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const label = typeof r.label === 'string' && r.label.trim() ? r.label.trim().slice(0, 120) : null;
    if (!label) continue;
    out.push({
      label,
      grams: cleanNumber(r.grams),
      kcal: Math.round(cleanNumber(r.kcal)),
      protein_g: cleanNumber(r.protein_g),
      carbs_g: cleanNumber(r.carbs_g),
      fat_g: cleanNumber(r.fat_g),
      confidence: typeof r.confidence === 'string' ? r.confidence.slice(0, 16) : '',
      ...(typeof r.barcode === 'string' && /^[0-9]{8,14}$/.test(r.barcode)
        ? { barcode: r.barcode }
        : {}),
    });
  }
  return out.slice(0, 20);
}

function parseItems(json: string | null): FoodScanItemRow[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return cleanItems(parsed);
  } catch {
    return [];
  }
}

/** Persist one scan's item breakdown for a log day (never throws away). */
export async function insertFoodScanBreakdownDb(
  db: FoodScanDb,
  patientId: string,
  input: {
    logDate: string;
    mealLabel: string;
    mealType?: string | null;
    items: readonly unknown[];
    totalKcal: number;
    confidence?: string | null;
  },
): Promise<string> {
  const scanId = randomId();
  const items = cleanItems(input.items);
  await db.runAsync(
    `INSERT INTO food_scan_items
       (scan_id, patient_id, log_date, meal_label, meal_type,
        items_json, total_kcal, confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    scanId,
    patientId,
    input.logDate,
    input.mealLabel.slice(0, 250),
    input.mealType ? String(input.mealType).slice(0, 24) : null,
    JSON.stringify(items),
    Math.max(0, Math.round(input.totalKcal)),
    input.confidence ? String(input.confidence).slice(0, 16) : null,
  );
  return scanId;
}

/** Every saved scan breakdown for a log day, newest first. */
export async function listFoodScanBreakdownsDb(
  db: FoodScanDb,
  patientId: string,
  logDate: string,
): Promise<FoodScanBreakdown[]> {
  const rows = await db.getAllAsync<FoodScanItemsTableRow>(
    `SELECT scan_id, patient_id, log_date, meal_label, meal_type,
            items_json, total_kcal, confidence, created_at
       FROM food_scan_items
      WHERE patient_id = ? AND log_date = ?
      ORDER BY created_at DESC, rowid DESC`,
    patientId,
    logDate,
  );
  return rows.map((r) => ({
    scan_id: r.scan_id,
    patient_id: r.patient_id,
    log_date: r.log_date,
    meal_label: r.meal_label,
    meal_type: r.meal_type,
    items: parseItems(r.items_json),
    total_kcal: r.total_kcal ?? 0,
    confidence: r.confidence,
    created_at: r.created_at,
  }));
}

// ---------------------------------------------------------------------------
// Production entry points (lazy connection)
// ---------------------------------------------------------------------------

async function getDb(): Promise<FoodScanDb> {
  const { getDatabase } = await import('@/db/connection');
  return (await getDatabase()) as unknown as FoodScanDb;
}

export async function saveFoodScanBreakdown(
  patientId: string,
  input: {
    logDate: string;
    mealLabel: string;
    mealType?: string | null;
    items: readonly unknown[];
    totalKcal: number;
    confidence?: string | null;
  },
): Promise<string> {
  return insertFoodScanBreakdownDb(await getDb(), patientId, input);
}

export async function listFoodScanBreakdowns(
  patientId: string,
  logDate: string,
): Promise<FoodScanBreakdown[]> {
  return listFoodScanBreakdownsDb(await getDb(), patientId, logDate);
}

/** Per-day macro sums over a date range (inclusive), oldest first. */
export interface DayMacroSums {
  log_date: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

/**
 * Sum scan-breakdown macros per day. One bounded, patient-scoped query;
 * item JSON is parsed and summed in JS (never trusted as numbers).
 * Days without scans are absent from the map (missing stays missing).
 */
export async function sumMacroRangeDb(
  db: FoodScanDb,
  patientId: string,
  startDate: string,
  endDate: string,
): Promise<DayMacroSums[]> {
  const rows = await db.getAllAsync<{ log_date: string; items_json: string | null }>(
    `SELECT log_date, items_json FROM food_scan_items
      WHERE patient_id = ? AND log_date >= ? AND log_date <= ?
      ORDER BY log_date ASC`,
    patientId,
    startDate,
    endDate,
  );
  const byDay = new Map<string, DayMacroSums>();
  for (const r of rows) {
    const day = (r.log_date ?? '').slice(0, 10);
    if (!day) continue;
    let entry = byDay.get(day);
    if (!entry) {
      entry = { log_date: day, kcal: 0, protein: 0, carbs: 0, fat: 0 };
      byDay.set(day, entry);
    }
    for (const item of parseItems(r.items_json)) {
      entry.kcal += item.kcal;
      entry.protein += item.protein_g;
      entry.carbs += item.carbs_g;
      entry.fat += item.fat_g;
    }
  }
  return [...byDay.values()].sort((a, b) => (a.log_date < b.log_date ? -1 : 1));
}

/** Production entry point (lazy connection). */
export async function sumMacroRange(
  patientId: string,
  startDate: string,
  endDate: string,
): Promise<DayMacroSums[]> {
  return sumMacroRangeDb(await getDb(), patientId, startDate, endDate);
}
