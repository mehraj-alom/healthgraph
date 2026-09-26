/**
 * callMachine — medication-call UI state machine (pure, node-testable).
 *
 * SCHEDULED → RINGING → ANSWERED → CONFIRMING → TAKEN → COMPLETED
 * RINGING → DECLINED → REMIND_LATER (+ snooze rows via the existing engine)
 * Terminals: CANCELLED | EXPIRED | INTERRUPTED | STALE.
 *
 * Single-active invariant: FIRE is accepted ONLY from IDLE. Late or
 * duplicate OS callbacks (a second notification for an already-handled
 * occurrence, a snooze row superseding its parent) arrive as STALE and can
 * never resurrect or duplicate a call.
 *
 * VOICE EXTENSION POINT (not implemented): a future on-demand voice
 * session plugs in as ANSWERED → VOICE_SESSION → CONFIRMING, reusing the
 * same taken path below. Nothing here precludes it; nothing here builds it.
 */

export type CallPhase =
  | 'IDLE'
  | 'RINGING'
  | 'CONFIRMING'
  | 'TAKEN'
  | 'COMPLETED'
  | 'DECLINED'
  | 'REMIND_LATER'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'INTERRUPTED'
  | 'STALE';

export interface CallMachineState {
  phase: CallPhase;
  /** Occurrence that owns the active call; null when no call is active. */
  callId: string | null;
  /** Group members (primary first). Taken/confirmed per occurrence. */
  members: string[];
  taken: Record<string, boolean>;
  reason: string | null;
}

export type CallMachineEvent =
  | { type: 'FIRE'; callId: string; members: string[] }
  | { type: 'ANSWER' }
  | { type: 'MED_TAKEN'; occurrenceId: string }
  | { type: 'ALL_CONFIRMED' }
  | { type: 'DECLINE' }
  | { type: 'SNOOZED' }
  | { type: 'EXPIRE'; reason: string }
  | { type: 'CANCEL' }
  | { type: 'INTERRUPT' }
  | { type: 'STALE'; reason: string }
  | { type: 'RESET' };

export const INITIAL_CALL_STATE: CallMachineState = {
  phase: 'IDLE',
  callId: null,
  members: [],
  taken: {},
  reason: null,
};

const TERMINAL: CallPhase[] = ['COMPLETED', 'REMIND_LATER', 'EXPIRED', 'CANCELLED', 'INTERRUPTED', 'STALE'];

export function isCallTerminal(phase: CallPhase): boolean {
  return (TERMINAL as string[]).includes(phase);
}

export function callMachineReducer(
  state: CallMachineState,
  event: CallMachineEvent,
): CallMachineState {
  switch (event.type) {
    case 'FIRE':
      // Single-active guard: only IDLE accepts a new call. A FIRE for the
      // SAME callId while ringing is a duplicate OS callback — ignore it.
      if (state.phase !== 'IDLE') return state;
      if (event.members.length === 0) return state;
      return { phase: 'RINGING', callId: event.callId, members: event.members, taken: {}, reason: null };
    case 'ANSWER':
      if (state.phase !== 'RINGING') return state;
      return { ...state, phase: 'CONFIRMING' };
    case 'MED_TAKEN': {
      if (state.phase !== 'CONFIRMING') return state;
      if (!state.members.includes(event.occurrenceId)) return state;
      const taken = { ...state.taken, [event.occurrenceId]: true };
      const allTaken = state.members.every((m) => taken[m]);
      return { ...state, taken, phase: allTaken ? 'TAKEN' : 'CONFIRMING' };
    }
    case 'ALL_CONFIRMED':
      if (state.phase !== 'TAKEN') return state;
      return { ...state, phase: 'COMPLETED' };
    case 'DECLINE':
      if (state.phase !== 'RINGING') return state;
      return { ...state, phase: 'DECLINED' };
    case 'SNOOZED':
      if (state.phase !== 'DECLINED') return state;
      return { ...state, phase: 'REMIND_LATER' };
    case 'EXPIRE':
      if (isCallTerminal(state.phase) || state.phase === 'IDLE') return state;
      return { ...state, phase: 'EXPIRED', reason: event.reason };
    case 'CANCEL':
      if (state.phase === 'IDLE') return state;
      return { ...state, phase: 'CANCELLED' };
    case 'INTERRUPT':
      if (isCallTerminal(state.phase) || state.phase === 'IDLE') return state;
      return { ...state, phase: 'INTERRUPTED' };
    case 'STALE':
      if (state.phase === 'IDLE') return state;
      return { ...state, phase: 'STALE', reason: event.reason };
    case 'RESET':
      return INITIAL_CALL_STATE;
    default:
      return state;
  }
}

/** Live reminder-instance statuses: anything else means "already handled". */
export function isInstanceLive(status: string): boolean {
  return status === 'scheduled';
}

/** Group window: same-time meds presented as ONE call (±15 min). */
export const CALL_GROUP_WINDOW_MIN = 15;

export interface GroupCandidate {
  occurrence_id: string;
  scheduled_at: string;
  status: string;
}

/**
 * Presentation-level grouping (pure): siblings due within the window join
 * the primary's call. No engine change — each occurrence keeps its own row,
 * alarm, and taken path. Statuses other than scheduled are excluded (a
 * taken/snoozed sibling must never re-ring inside another call).
 */
export function groupDueOccurrences(
  primary: GroupCandidate,
  instances: GroupCandidate[],
  windowMin: number = CALL_GROUP_WINDOW_MIN,
): string[] {
  const base = new Date(primary.scheduled_at).getTime();
  if (!Number.isFinite(base)) return [primary.occurrence_id];
  const inWindow = instances.filter((i) => {
    if (i.occurrence_id === primary.occurrence_id) return false;
    if (!isInstanceLive(i.status)) return false;
    const t = new Date(i.scheduled_at).getTime();
    return Number.isFinite(t) && Math.abs(t - base) <= windowMin * 60_000;
  });
  inWindow.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  return [primary.occurrence_id, ...inWindow.map((i) => i.occurrence_id)];
}
