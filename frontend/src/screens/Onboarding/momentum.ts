/**
 * momentum.ts — seven-day momentum model (pure, testable).
 *
 * Built ONLY from actually-available local rows: logged days, measured
 * heart rates, recorded taken doses. Nothing is synthesized — a day with no
 * data is an honest empty day, and a user with no data at all gets the
 * legitimate empty state (isEmpty). The UI renders this model; it never
 * invents activity.
 */

export interface MomentumDay {
  /** YYYY-MM-DD calendar day. */
  date: string;
  /** Single-letter weekday label (locale-free, stable for tests). */
  weekday: string;
  logged: boolean;
  heartRate: number | null;
  dosesTaken: number;
  /** True when the day carries any real signal. */
  active: boolean;
}

const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function toDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Today's local calendar day key (YYYY-MM-DD). */
export function todayKey(now: Date = new Date()): string {
  return toDayKey(now);
}

function shiftDayKey(dayKey: string, deltaDays: number): string {
  const d = new Date(`${dayKey}T12:00:00`);
  d.setDate(d.getDate() + deltaDays);
  return toDayKey(d);
}

function weekdayLetter(dayKey: string): string {
  const d = new Date(`${dayKey}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return WEEKDAY_LETTERS[d.getDay()];
}

/**
 * Build the trailing 7-day strip ending on todayKey (inclusive, ascending).
 * Inputs are plain data the hook assembles from SQLite:
 * - logDates: YYYY-MM-DD days with a daily log (any prefix is day-keyed)
 * - heartByDate: day → latest measured BPM (both camera modalities)
 * - dosesByDay: day → taken-dose count
 */
export function buildMomentumWeek(
  todayKey: string,
  logDates: readonly string[],
  heartByDate: Readonly<Record<string, number>>,
  dosesByDay: Readonly<Record<string, number>>,
): MomentumDay[] {
  const logged = new Set(logDates.map((d) => d.slice(0, 10)));
  const out: MomentumDay[] = [];
  for (let i = 6; i >= 0; i--) {
    const date = shiftDayKey(todayKey, -i);
    const hr = heartByDate[date];
    const heartRate = typeof hr === 'number' && Number.isFinite(hr) ? Math.round(hr) : null;
    const dosesTaken = Math.max(0, Math.floor(dosesByDay[date] ?? 0));
    const dayLogged = logged.has(date);
    out.push({
      date,
      weekday: weekdayLetter(date),
      logged: dayLogged,
      heartRate,
      dosesTaken,
      active: dayLogged || heartRate !== null || dosesTaken > 0,
    });
  }
  return out;
}

/** True when the whole week is empty (legitimate empty-state trigger). */
export function isMomentumEmpty(days: readonly MomentumDay[]): boolean {
  return days.every((d) => !d.active);
}

/** Count of active days (0..7) for the momentum headline. */
export function momentumActiveDays(days: readonly MomentumDay[]): number {
  return days.filter((d) => d.active).length;
}
