/**
 * voice/logPure — zero-import journal-line builders (node-testable).
 *
 * A completed voice turn becomes one timestamped notes line. Transcript
 * and reply are truncated — the Timeline shows what was discussed, never
 * a full verbatim record. Appending trims oldest lines past the cap so a
 * chatterbox day can never breach the backend notes limit.
 */

export const VOICE_NOTES_CAP = 3500;

const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

/**
 * One journal line for a completed turn. Pure and deterministic given its
 * inputs (tests pin the shape, never patient data).
 */
export function buildVoiceNoteLine(transcript: string, reply: string, clock: string): string {
  return `[${clock} Voice turn] You: "${clip(transcript.trim(), 200)}" · HealthGraph: "${clip(reply.trim(), 200)}"`;
}

/** Append a line to existing notes, trimming oldest lines past the cap. */
export function appendVoiceNote(existingNotes: string | null | undefined, line: string): string {
  const prev = (existingNotes ?? '').split('\n').filter((l) => l.trim() !== '');
  const next = [...prev, line];
  let out = next.join('\n');
  while (out.length > VOICE_NOTES_CAP && next.length > 1) {
    next.shift();
    out = next.join('\n');
  }
  return out.slice(0, VOICE_NOTES_CAP);
}
