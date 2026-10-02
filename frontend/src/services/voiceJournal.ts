/**
 * voiceJournal.ts — free-form voice journal pure contract.
 *
 * Turns accumulate verbatim: no paraphrasing, no summarizing, no parsing
 * into fields here (unparseable speech is kept as text, never guessed).
 * Saving appends to the day's notes through the existing daily-log merge
 * path with a hard character cap shared with the notes field.
 *
 * Zero imports: safe for node unit tests.
 */

/** Maximum recording turns per journal entry (12 s each, same as check-in). */
export const MAX_JOURNAL_TURNS = 10;

/** Maximum transcript characters accepted per entry. */
export const MAX_TRANSCRIPT_CHARS = 12000;

/** Maximum notes characters stored per day (mirrors the notes field). */
export const MAX_NOTES_CHARS = 4000;

const TRUNCATION_MARKER = '… [truncated]';

/** Join recorded turns verbatim; empty turns are dropped, never stored. */
export function joinTurns(turns: readonly string[]): string {
  return turns
    .map((t) => (typeof t === 'string' ? t.trim() : ''))
    .filter((t) => t.length > 0)
    .join(' ');
}

/** A transcript is usable when it says something and fits the entry cap. */
export function validateTranscript(text: string): { ok: boolean; reason: string } {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return { ok: false, reason: 'empty' };
  }
  if (text.length > MAX_TRANSCRIPT_CHARS) {
    return { ok: false, reason: 'too-long' };
  }
  return { ok: true, reason: '' };
}

/**
 * Append a journal transcript to existing notes. Blank transcripts append
 * nothing; existing notes are never cut — the new transcript takes only
 * the room that is left, with an explicit marker when it does not all fit.
 * When even the separator and marker do not fit, the day is full and the
 * existing notes are returned unchanged.
 */
export function buildNotesAppend(existingNotes: string | null, transcript: string): string {
  const clean = typeof transcript === 'string' ? transcript.trim() : '';
  if (clean.length === 0) return existingNotes ?? '';
  const base = typeof existingNotes === 'string' && existingNotes.trim().length > 0 ? existingNotes : '';
  if (base.length === 0) {
    return clean.length <= MAX_NOTES_CHARS
      ? clean
      : `${clean.slice(0, MAX_NOTES_CHARS - TRUNCATION_MARKER.length)}${TRUNCATION_MARKER}`;
  }
  const head = `${base}\n\n`;
  const room = MAX_NOTES_CHARS - head.length - TRUNCATION_MARKER.length;
  if (room <= 0) return base;
  if (head.length + clean.length <= MAX_NOTES_CHARS) return `${head}${clean}`;
  return `${head}${clean.slice(0, room)}${TRUNCATION_MARKER}`;
}
