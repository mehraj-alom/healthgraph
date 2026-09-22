/**
 * medicationSchedule.ts — pure taken-event → schedule-slot matching.
 *
 * Two legitimate taken events can share one clock minute (an unscheduled
 * dose plus the scheduled one, a correction re-tap, two close doses). The
 * old code collapsed them into a first-wins HH:MM map, so the second event
 * became invisible on the schedule. These helpers keep every event and
 * prefer the one actually scheduled for the slot; no IDs or rows change.
 *
 * Zero imports: safe for node unit tests.
 */

export interface TakenSlotCandidate {
  event_id: string;
  taken_at: string;
  scheduled_for: string | null;
}

/** Local HH:MM of an ISO datetime (matches the schedule's slot format). */
export function timeOfDay(isoString: string): string | null {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return null;
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/** Group key: scheduled_for's minute when present, else taken_at's minute. */
export function takenEventMinute(event: TakenSlotCandidate): string | null {
  if (event.scheduled_for) {
    const key = timeOfDay(event.scheduled_for);
    if (key) return key;
  }
  return timeOfDay(event.taken_at);
}

/**
 * Group events by clock minute, each bucket ascending by taken_at so the
 * earliest event is first. Skips events with unparseable timestamps.
 */
export function groupTakenByMinute(
  events: TakenSlotCandidate[],
): Map<string, TakenSlotCandidate[]> {
  const byMinute = new Map<string, TakenSlotCandidate[]>();
  const sorted = [...events].sort((a, b) =>
    a.taken_at < b.taken_at ? -1 : a.taken_at > b.taken_at ? 1 : 0,
  );
  for (const event of sorted) {
    const key = takenEventMinute(event);
    if (!key) continue;
    const list = byMinute.get(key);
    if (list) list.push(event);
    else byMinute.set(key, [event]);
  }
  return byMinute;
}

/**
 * Pick the event shown for one schedule slot ('HH:MM'). Prefers the event
 * whose scheduled_for minute IS the slot (the dose taken for that slot);
 * otherwise falls back to the earliest event in the minute. Null when the
 * bucket is empty — the slot correctly shows untaken.
 */
export function matchTakenToSlot(
  candidates: TakenSlotCandidate[],
  slot: string,
): TakenSlotCandidate | null {
  if (candidates.length === 0) return null;
  for (const event of candidates) {
    if (event.scheduled_for && timeOfDay(event.scheduled_for) === slot) {
      return event;
    }
  }
  return candidates[0];
}
