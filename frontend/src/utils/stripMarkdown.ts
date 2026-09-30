/**
 * stripMarkdown — client-side safety net for AI answer text.
 *
 * Chat bubbles render raw <Text> (no markdown renderer), so any literal
 * `**`, `#`, list marker, or backtick from the model is visible garbage.
 * The backend bans markdown in the synthesis prompt AND strips stragglers
 * server-side — this mirrors that so a stale backend can never show
 * formatting characters to the patient.
 */
export function stripMarkdown(text: string): string {
  if (!text) return text;
  let out = text;
  out = out.replace(/\*\*(.+?)\*\*/g, '$1');
  out = out.replace(/__(.+?)__/g, '$1');
  out = out.replace(/\*([^*]+)\*/g, '$1');
  out = out.replace(/^\s*#{1,6}\s*/gm, '');
  out = out.replace(/^\s*[-*•]\s+/gm, '');
  out = out.replace(/^\s*\d+[.)]\s+/gm, '');
  out = out.replace(/`(.+?)`/g, '$1');
  out = out.split('***').join('').split('**').join('').split('__').join('');
  out = out.replace(/[ \t]{2,}/g, ' ');
  out = out.replace(/\n{3,}/g, '\n\n');
  return out.trim();
}
