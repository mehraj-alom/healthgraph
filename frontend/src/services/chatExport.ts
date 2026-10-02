/**
 * chatExport.ts — conversation export text builder (zero imports).
 *
 * Turns the on-screen turns into labeled plain text for the OS share
 * sheet: a header with the export date and message count, one labeled
 * block per content turn, and a trust footer. Nothing is uploaded —
 * the screen hands the text to Share.share and the OS takes it from
 * there. Node-testable.
 */

export interface ExportableTurn {
  role: string;
  content: unknown;
  timestamp?: Date | string | number | null;
}

const DEFAULT_MAX_CHARS = 100_000;

function cleanContent(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function fmtTime(value: Date | string | number | null | undefined): string | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function fmtDay(value: Date): string {
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return `${months[value.getMonth()]} ${value.getDate()}, ${value.getFullYear()}`;
}

/**
 * Labeled export text, or null when no user/assistant content exists.
 * Oversized exports keep the newest turns within maxChars and mark the
 * cut — oldest trimmed first, newest always kept whole.
 */
export function buildChatExport(
  turns: ReadonlyArray<ExportableTurn>,
  opts?: { exportedAt?: Date; maxChars?: number },
): string | null {
  const blocks: string[] = [];
  for (const t of turns) {
    if (t.role !== 'user' && t.role !== 'assistant') continue;
    const content = cleanContent(t.content);
    if (content === null) continue;
    const who = t.role === 'user' ? 'You' : 'Assistant';
    const time = fmtTime(t.timestamp);
    blocks.push(`${who}${time ? ` (${time})` : ''}:\n${content}`);
  }
  if (blocks.length === 0) return null;

  const exportedAt = opts?.exportedAt instanceof Date ? opts.exportedAt : new Date();
  const header =
    `HealthGraph chat export · ${fmtDay(exportedAt)}\n` +
    `${blocks.length} ${blocks.length === 1 ? 'message' : 'messages'}\n---`;
  const footer =
    '---\nExported from your HealthGraph chat. Personal notes — share only with people you trust.';

  const maxChars =
    typeof opts?.maxChars === 'number' && Number.isFinite(opts.maxChars) && opts.maxChars > 0
      ? Math.floor(opts.maxChars)
      : DEFAULT_MAX_CHARS;

  let kept = blocks;
  let trimmed = false;
  let body = blocks.join('\n\n');
  while (kept.length > 1 && `${header}\n\n${body}\n\n${footer}`.length > maxChars) {
    kept = kept.slice(1);
    trimmed = true;
    body = kept.join('\n\n');
  }
  // A single long turn wider than the cap still exports whole — cutting
  // mid-message would invent a boundary the user never saw.
  const prefix = trimmed ? '[earlier messages trimmed]\n\n' : '';
  return `${header}\n\n${prefix}${body}\n\n${footer}`;
}
