/**
 * strength.ts — strength set logging (device-only, local-first).
 *
 * One row per set: exercise name, weight + unit (kg/lb), reps, time.
 * Volume sums weight×reps per exercise (pounds convert to kilograms);
 * estimated 1RM uses Epley, labeled estimate everywhere it surfaces.
 * PRs are best estimates per exercise. Descriptive counts only — no
 * fitness judgments, never causal.
 *
 * Node-testable by design: logic takes an explicit database handle and
 * this module has zero runtime imports (production entry points resolve
 * the encrypted database lazily).
 */

export type StrengthUnit = 'kg' | 'lb';

export interface StrengthSet {
  entry_id: string;
  patient_id: string;
  exercise: string;
  weight_value: number;
  weight_unit: StrengthUnit;
  reps: number;
  /** ISO datetime of the set. */
  occurred_at: string;
  created_at: string;
}

export interface StrengthDb {
  getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]>;
  runAsync(sql: string, ...params: unknown[]): Promise<{ changes: unknown }>;
}

export interface NewStrengthSet {
  exercise: string;
  weight_value: number;
  weight_unit: StrengthUnit;
  reps: number;
  occurred_at: string;
}

const LB_TO_KG = 0.45359237;

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function cleanText(value: unknown, max: number): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

/** Validate + normalize a new set (throws on invalid input, never stores). */
export function normalizeStrengthInput(input: {
  exercise: unknown;
  weight_value: unknown;
  weight_unit: unknown;
  reps: unknown;
  occurred_at: unknown;
}): NewStrengthSet {
  const exercise = cleanText(input.exercise, 80);
  if (!exercise) {
    throw new Error('Name the exercise.');
  }
  const weight = input.weight_value;
  if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0 || weight > 1000) {
    throw new Error('Enter a weight above zero.');
  }
  const unit = typeof input.weight_unit === 'string' ? input.weight_unit.trim().toLowerCase() : '';
  if (unit !== 'kg' && unit !== 'lb') {
    throw new Error('Choose kg or lb.');
  }
  const reps = input.reps;
  if (typeof reps !== 'number' || !Number.isInteger(reps) || reps <= 0 || reps > 1000) {
    throw new Error('Enter whole reps above zero.');
  }
  const occurredAt =
    input.occurred_at instanceof Date
      ? input.occurred_at.toISOString()
      : typeof input.occurred_at === 'string'
        ? input.occurred_at
        : '';
  if (!occurredAt || Number.isNaN(new Date(occurredAt).getTime())) {
    throw new Error('A valid date and time is required.');
  }
  return { exercise, weight_value: weight, weight_unit: unit, reps, occurred_at: occurredAt };
}

/** Weight in kilograms regardless of entered unit. */
export function weightKg(weightValue: number, weightUnit: StrengthUnit): number {
  return weightUnit === 'lb' ? weightValue * LB_TO_KG : weightValue;
}

export interface StrengthSetInput {
  exercise: unknown;
  weight_value: unknown;
  weight_unit: unknown;
  reps: unknown;
}

/**
 * Total volume (kg) per exercise: Σ weight×reps. Skips malformed rows —
 * garbage never inflates a total.
 */
export function exerciseVolume(sets: ReadonlyArray<StrengthSetInput>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of sets) {
    if (typeof s.exercise !== 'string' || !s.exercise.trim()) continue;
    if (typeof s.weight_value !== 'number' || !Number.isFinite(s.weight_value) || s.weight_value <= 0) continue;
    if (s.weight_unit !== 'kg' && s.weight_unit !== 'lb') continue;
    if (typeof s.reps !== 'number' || !Number.isInteger(s.reps) || s.reps <= 0) continue;
    const key = s.exercise.trim();
    out[key] = Math.round(((out[key] ?? 0) + weightKg(s.weight_value, s.weight_unit) * s.reps) * 100) / 100;
  }
  return out;
}

/**
 * Estimated one-rep max via Epley (weight × (1 + reps/30)), rounded to
 * 2 decimals. Singles return the weight. Null on bad input — always
 * surfaced as an estimate, never a claim.
 */
export function estimateOneRepMax(weightValue: number, reps: number): number | null {
  if (
    typeof weightValue !== 'number' ||
    !Number.isFinite(weightValue) ||
    weightValue <= 0 ||
    typeof reps !== 'number' ||
    !Number.isInteger(reps) ||
    reps <= 0
  ) {
    return null;
  }
  if (reps === 1) return weightValue;
  return Math.round(weightValue * (1 + reps / 30) * 100) / 100;
}

/** Best estimated 1RM (kg) per exercise from real sets only. */
export function personalRecords(sets: ReadonlyArray<StrengthSetInput>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of sets) {
    if (typeof s.exercise !== 'string' || !s.exercise.trim()) continue;
    if (typeof s.weight_value !== 'number' || typeof s.reps !== 'number') continue;
    if (s.weight_unit !== 'kg' && s.weight_unit !== 'lb') continue;
    const est = estimateOneRepMax(weightKg(s.weight_value, s.weight_unit), s.reps);
    if (est === null) continue;
    const key = s.exercise.trim();
    if (out[key] === undefined || est > out[key]) out[key] = est;
  }
  return out;
}

export async function insertStrengthSetDb(
  db: StrengthDb,
  patientId: string,
  input: NewStrengthSet,
): Promise<string> {
  const entryId = randomId();
  await db.runAsync(
    `INSERT INTO strength_sets
       (entry_id, patient_id, exercise, weight_value, weight_unit, reps, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    entryId,
    patientId,
    input.exercise,
    input.weight_value,
    input.weight_unit,
    input.reps,
    input.occurred_at,
  );
  return entryId;
}

export async function deleteStrengthSetDb(
  db: StrengthDb,
  patientId: string,
  entryId: string,
): Promise<boolean> {
  const r = await db.runAsync(
    'DELETE FROM strength_sets WHERE entry_id = ? AND patient_id = ?',
    entryId,
    patientId,
  );
  return Number(r.changes ?? 0) > 0;
}

export async function listStrengthSetsDb(
  db: StrengthDb,
  patientId: string,
  limit = 200,
): Promise<StrengthSet[]> {
  return db.getAllAsync<StrengthSet>(
    'SELECT * FROM strength_sets WHERE patient_id = ? ORDER BY occurred_at DESC LIMIT ?',
    patientId,
    Math.max(1, Math.min(500, Math.floor(limit))),
  );
}

// ---------------------------------------------------------------------------
// Production entry points (lazy connection)
// ---------------------------------------------------------------------------

async function getDb(): Promise<StrengthDb> {
  const { getDatabase } = await import('@/db/connection');
  return (await getDatabase()) as unknown as StrengthDb;
}

export async function insertStrengthSet(
  patientId: string,
  input: NewStrengthSet,
): Promise<string> {
  return insertStrengthSetDb(await getDb(), patientId, input);
}

export async function deleteStrengthSet(
  patientId: string,
  entryId: string,
): Promise<boolean> {
  return deleteStrengthSetDb(await getDb(), patientId, entryId);
}

export async function listStrengthSets(
  patientId: string,
  limit = 200,
): Promise<StrengthSet[]> {
  return listStrengthSetsDb(await getDb(), patientId, limit);
}
