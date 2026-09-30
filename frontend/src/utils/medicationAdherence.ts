/**
 * medicationAdherence.ts — pure adherence, refill, and safety math.
 *
 * Adherence: taken vs scheduled over a trailing window. Expected doses come
 * from the frequency (PRN / CUSTOM have no schedule → no percentage, shown
 * as "as needed"). Refill: doses left from the recorded supply minus TAKEN
 * events since the supply started, over the daily rate. Safety: duplicate
 * therapy, polypharmacy, low adherence, and refill-soon flags. No imports:
 * unit-testable and UI-agnostic.
 */
import type { Medication, MedicationTakenEvent } from '@/types';

export const DOSES_PER_DAY: Record<string, number | null> = {
  ONCE_DAILY: 1,
  TWICE_DAILY: 2,
  THREE_TIMES_DAILY: 3,
  FOUR_TIMES_DAILY: 4,
  EVERY_MORNING: 1,
  EVERY_EVENING: 1,
  EVERY_NIGHT: 1,
  EVERY_8_HOURS: 3,
  EVERY_12_HOURS: 2,
  WEEKLY: 1 / 7,
  AS_NEEDED: null,
  CUSTOM: null,
};

export interface Adherence {
  percent: number | null;
  taken: number;
  expected: number;
  windowDays: number;
}

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

export function dosesPerDay(frequency: string | null | undefined): number | null {
  if (!frequency) return null;
  return DOSES_PER_DAY[frequency] ?? null;
}

/** Adherence over the trailing windowDays (default 7). */
export function computeAdherence(
  med: Pick<Medication, 'frequency' | 'start_date'>,
  events: Pick<MedicationTakenEvent, 'taken_at' | 'status'>[],
  windowDays = 7,
  now: Date = new Date(),
): Adherence {
  const rate = dosesPerDay(med.frequency);
  if (rate == null) return { percent: null, taken: 0, expected: 0, windowDays };
  const end = startOfDay(now).getTime() + 24 * 3600 * 1000;
  let start = end - windowDays * 24 * 3600 * 1000;
  if (med.start_date) {
    const s = startOfDay(new Date(`${med.start_date}T12:00:00`)).getTime();
    if (!Number.isNaN(s)) start = Math.max(start, s);
  }
  const days = Math.max(0, (end - start) / (24 * 3600 * 1000));
  const expected = rate * days;
  let taken = 0;
  for (const e of events) {
    if (e.status !== 'TAKEN') continue;
    const t = new Date(e.taken_at).getTime();
    if (!Number.isNaN(t) && t >= start && t < end) taken += 1;
  }
  if (expected <= 0) return { percent: null, taken, expected: 0, windowDays };
  return { percent: Math.min(100, Math.round((taken / expected) * 100)), taken, expected: Math.round(expected), windowDays };
}

export interface Refill {
  dosesLeft: number;
  daysLeft: number | null;
  out: boolean;
  warn: boolean;
}

/** Refill countdown. Null when the supply or the daily rate is unknown. */
export function computeRefill(
  med: Pick<Medication, 'frequency' | 'start_date' | 'supply_quantity' | 'supply_started_on'>,
  events: Pick<MedicationTakenEvent, 'taken_at' | 'status' | 'dose_taken'>[],
  now: Date = new Date(),
): Refill | null {
  if (med.supply_quantity == null) return null;
  const rate = dosesPerDay(med.frequency);
  const anchor = med.supply_started_on ?? med.start_date;
  const anchorMs = anchor ? startOfDay(new Date(`${anchor}T12:00:00`)).getTime() : 0;
  let used = 0;
  for (const e of events) {
    if (e.status !== 'TAKEN') continue;
    const t = new Date(e.taken_at).getTime();
    if (Number.isNaN(t)) continue;
    if (!Number.isNaN(anchorMs) && t < anchorMs) continue;
    used += e.dose_taken != null && Number.isFinite(e.dose_taken) && e.dose_taken > 0 ? e.dose_taken : 1;
  }
  const dosesLeft = med.supply_quantity - used;
  if (rate == null || rate <= 0) {
    return { dosesLeft, daysLeft: null, out: dosesLeft <= 0, warn: dosesLeft <= 0 };
  }
  const daysLeft = dosesLeft / rate;
  void now;
  return { dosesLeft, daysLeft, out: daysLeft <= 0, warn: daysLeft <= 7 };
}

export interface SafetyFlag {
  kind: 'duplicate' | 'polypharmacy' | 'low-adherence' | 'refill-soon' | 'refill-out';
  text: string;
  medicationIds: string[];
}

function normName(med: Pick<Medication, 'name' | 'generic_name'>): string {
  return (med.generic_name || med.name).trim().toLowerCase();
}

/** Cross-medication safety flags over the active list. */
export function safetyFlags(
  meds: Pick<Medication, 'medication_id' | 'name' | 'generic_name' | 'frequency' | 'start_date' | 'supply_quantity' | 'supply_started_on'>[],
  eventsByMed: Record<string, Pick<MedicationTakenEvent, 'taken_at' | 'status' | 'dose_taken'>[]>,
  now: Date = new Date(),
): SafetyFlag[] {
  const flags: SafetyFlag[] = [];
  const active = meds;

  // Duplicate therapy: same ingredient under two names.
  const byIngredient = new Map<string, typeof active>();
  for (const m of active) {
    const key = normName(m);
    if (!key) continue;
    const arr = byIngredient.get(key) ?? [];
    arr.push(m);
    byIngredient.set(key, arr);
  }
  for (const group of byIngredient.values()) {
    if (group.length > 1) {
      flags.push({
        kind: 'duplicate',
        text: `Same ingredient in ${group.map((g) => g.name).join(' + ')} — confirm with your doctor or pharmacist.`,
        medicationIds: group.map((g) => g.medication_id),
      });
    }
  }

  // Polypharmacy: 5+ active medicines deserve a professional review.
  if (active.length >= 5) {
    flags.push({
      kind: 'polypharmacy',
      text: `${active.length} active medicines — worth a pharmacist review for interactions.`,
      medicationIds: active.map((m) => m.medication_id),
    });
  }

  for (const m of active) {
    const events = eventsByMed[m.medication_id] ?? [];
    const adh = computeAdherence(m, events, 7, now);
    if (adh.percent != null && adh.expected >= 3 && adh.percent < 80) {
      flags.push({
        kind: 'low-adherence',
        text: `${m.name}: ${adh.percent}% taken this week (${adh.taken}/${adh.expected} doses).`,
        medicationIds: [m.medication_id],
      });
    }
    const refill = computeRefill(m, events, now);
    if (refill) {
      if (refill.out) {
        flags.push({ kind: 'refill-out', text: `${m.name} looks out of supply — refill now.`, medicationIds: [m.medication_id] });
      } else if (refill.warn && refill.daysLeft != null) {
        flags.push({
          kind: 'refill-soon',
          text: `${m.name} runs out in ~${Math.max(1, Math.ceil(refill.daysLeft))} day(s).`,
          medicationIds: [m.medication_id],
        });
      }
    }
  }
  return flags;
}
