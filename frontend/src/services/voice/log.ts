/**
 * voice/log — completed voice turns become journal lines in today's daily
 * log, through the SAME offline-first save sequence as meals (local SQLite
 * mirror → server POST/PUT → reconcile → sync-engine retry).
 *
 * No new tables, no new endpoints: a turn appends one timestamped line to
 * the day's `notes` (capped, oldest lines trimmed first). Transcript and
 * reply are truncated — the Timeline shows what was discussed, never a
 * full verbatim record. Nothing is logged unless the turn completed
 * (transcript + reply both present).
 */

import { getCachedPatientId } from '@/services/patientIdentity';
import { getDailyLogDetail as dbGetDailyLogDetail } from '@/db/queries/dailyLogs';
import {
  detailToRequest,
  persistDailyLog,
  preservedNutritionBlock,
} from '@/services/nutritionService';
import type { DailyCheckInDetail } from '@/types';
import { appendVoiceNote, buildVoiceNoteLine, VOICE_NOTES_CAP } from './logPure';
import { todayKeyLocal } from '@/utils/dayKey';

export { VOICE_NOTES_CAP };

function todayLocal(): string {
  return todayKeyLocal();
}

function clockNow(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

export async function logVoiceTurn(
  transcript: string,
  reply: string,
): Promise<{ groupId: string; serverSaved: boolean } | null> {
  if (!transcript.trim() || !reply.trim()) return null;
  const patientId = getCachedPatientId();
  if (!patientId) {
    throw new Error('Your session has expired. Please sign in again.');
  }
  const logDate = todayLocal();
  let existing: DailyCheckInDetail | null = null;
  try {
    existing = await dbGetDailyLogDetail(patientId, logDate);
  } catch {
    existing = null;
  }
  const line = buildVoiceNoteLine(transcript, reply, clockNow());
  const notes = appendVoiceNote(existing?.notes ?? null, line);
  // Rebuild the FULL day payload (PUT replaces all events): nutrition and
  // every other section pass through untouched; only notes gain the line.
  const payload = detailToRequest(existing, logDate, preservedNutritionBlock(existing), notes);
  return persistDailyLog(payload, existing);
}
