/**
 * progressGraph.ts — illustrative onboarding progress model (pure).
 *
 * This artwork is NOT data: fixed abstract points trending upward across
 * seven labeled days, with no units and no metric attached (explicitly no
 * HRV, heart rate, weight, or calories). The UI reveals points left to
 * right; this module computes which points are visible and the SVG path
 * through them. Zero imports: node-testable.
 */

/** Abstract progress heights (0..1), generally upward with a natural wiggle. */
export const PROGRESS_VALUES: readonly number[] = [0.16, 0.3, 0.24, 0.46, 0.56, 0.52, 0.8];

export const PROGRESS_DAYS: readonly string[] = [
  'Day 1',
  'Day 2',
  'Day 3',
  'Day 4',
  'Day 5',
  'Day 6',
  'Day 7',
];

export interface ProgressPoint {
  x: number;
  y: number;
  label: string;
}

/**
 * Map values into pixel space (y down). A single revealed point still
 * yields a usable dot position.
 */
export function layoutProgressPoints(
  values: readonly number[],
  width: number,
  height: number,
  padX = 8,
): ProgressPoint[] {
  const n = values.length;
  return values.map((v, i) => {
    const clamped = Math.max(0, Math.min(1, v));
    return {
      x: n === 1 ? width / 2 : padX + (i / (n - 1)) * (width - padX * 2),
      y: height - clamped * height,
      label: PROGRESS_DAYS[i] ?? `Day ${i + 1}`,
    };
  });
}

/**
 * Points revealed so far for a left-to-right draw (count excludes the
 * always-visible origin anchor handling — callers slice then draw).
 */
export function revealedPoints(
  points: readonly ProgressPoint[],
  count: number,
): ProgressPoint[] {
  if (count <= 0) return [];
  return points.slice(0, Math.min(count, points.length));
}

/** SVG path through the points (empty string when nothing to draw). */
export function progressPath(points: readonly ProgressPoint[]): string {
  if (points.length === 0) return '';
  const [first, ...rest] = points;
  let d = `M ${round(first.x)} ${round(first.y)}`;
  for (const p of rest) d += ` L ${round(p.x)} ${round(p.y)}`;
  return d;
}

/** Area fill under the line, closed to the baseline. */
export function progressAreaPath(
  points: readonly ProgressPoint[],
  height: number,
): string {
  if (points.length === 0) return '';
  const line = progressPath(points);
  const last = points[points.length - 1];
  const first = points[0];
  return `${line} L ${round(last.x)} ${round(height)} L ${round(first.x)} ${round(height)} Z`;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
