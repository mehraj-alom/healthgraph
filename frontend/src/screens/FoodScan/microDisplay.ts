/**
 * microDisplay.ts — fiber/sugar/sodium display helpers (pure).
 *
 * Micros render only when USDA-matched (non-null); estimated items show
 * nothing rather than invented values. Totals sum matched items only —
 * a null anywhere does not zero the rest.
 *
 * Zero imports: safe for node unit tests.
 */

/** One item's micro line, or null when the item carries no micros. */
export function microLine(
  fiber: number | null | undefined,
  sugar: number | null | undefined,
  sodium: number | null | undefined,
): string | null {
  const parts: string[] = [];
  if (typeof fiber === 'number' && Number.isFinite(fiber)) parts.push(`Fiber ${fiber}g`);
  if (typeof sugar === 'number' && Number.isFinite(sugar)) parts.push(`Sugar ${sugar}g`);
  if (typeof sodium === 'number' && Number.isFinite(sodium)) parts.push(`Sodium ${sodium}mg`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** Sum of matched values; null when no item contributed. */
export function sumMicros(values: readonly (number | null | undefined)[]): number | null {
  const clean = values.filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v),
  );
  if (clean.length === 0) return null;
  return Math.round(clean.reduce((a, b) => a + b, 0) * 10) / 10;
}
