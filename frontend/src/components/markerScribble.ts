/**
 * markerScribble.ts — hand-drawn highlighter strokes (pure).
 *
 * A kid-with-a-sketchpen double stroke: one full-width wobbly pass plus
 * a shorter overlapping pass, slightly counter-tilted — deliberately
 * inconsistent, deterministic across renders (no random seeds, so the
 * shape never shimmers between frames). Used behind graph taglines both
 * in SVG (dial rim labels) and in HTML (graph card titles).
 *
 * Zero imports: safe for node unit tests.
 */

/** Highlighter yellow — the sketchpen, never a data encoding. */
export const MARKER_COLOR = '#FFD84D';

function wobble(i: number, amp: number): number {
  // Fixed pseudo-wobble per segment: uneven like a hand, stable like code.
  const pattern = [0, 1, -1, 0.5, -0.5, 1, 0, -1];
  return (pattern[i % pattern.length] ?? 0) * amp;
}

/**
 * Double marker stroke inside the box (x, y, w, h). The main pass runs
 * corner to corner with a slight downward drift; the second pass covers
 * roughly two-thirds, offset lower with a slight rise. Returns two path
 * strings plus their widths for the caller to stroke.
 */
export function scribblePaths(
  x: number,
  y: number,
  w: number,
  h: number,
): { main: string; over: string; mainWidth: number; overWidth: number } {
  const segs = 4;
  const drift = h * 0.12;
  let main = '';
  for (let i = 0; i <= segs; i++) {
    const px = x + (w * i) / segs;
    const py = y + h / 2 + (drift * i) / segs + wobble(i, h * 0.08);
    main += `${i === 0 ? 'M' : 'L'} ${px.toFixed(1)} ${py.toFixed(1)} `;
  }
  const ow = w * 0.68;
  const ox = x + w * 0.12;
  let over = '';
  for (let i = 0; i <= segs; i++) {
    const px = ox + (ow * i) / segs;
    const py = y + h * 0.72 - (drift * 0.8 * i) / segs + wobble(i + 3, h * 0.07);
    over += `${i === 0 ? 'M' : 'L'} ${px.toFixed(1)} ${py.toFixed(1)} `;
  }
  return {
    main: main.trim(),
    over: over.trim(),
    mainWidth: Math.max(2, h * 0.62),
    overWidth: Math.max(1.5, h * 0.4),
  };
}
