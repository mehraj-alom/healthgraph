/**
 * familyWatch.ts — user-invited family missed-dose alerts (v1, local-first).
 *
 * The patient invites a contact (name + phone, device-only) and links
 * medications. When a linked dose is missed, the patient's phone shows a
 * card with a patient-tapped "notify" action that opens the system SMS
 * composer — the message is sent by the patient, never automatically.
 * No server, no push tokens, no stored medical data beyond the device.
 * The invite IS the consent: deleting the contact revokes it.
 *
 * Deliberate v1 boundaries: no automatic delivery to family phones, no
 * background evaluation, no medical advice in the message text. Pinned
 * by tests in familyWatch.test.mts.
 *
 * Zero imports: safe for node unit tests.
 */

export const WATCH_CONTACTS_KEY = 'hg:medication-watch:v1';

export interface WatchContact {
  contactId: string;
  name: string;
  phone: string;
}

export interface WatchLink {
  contactId: string;
  medicationIds: string[];
}

export interface DoseSlot {
  medicationId: string;
  medicationName: string;
  day: string;
  time: string;
}

export interface TakenRef {
  medicationId: string;
  day: string;
  time: string;
}

export interface MissedDose {
  medicationId: string;
  medicationName: string;
  day: string;
  time: string;
}

const PHONE_RE = /^\+?[0-9]{7,15}$/;

/** Patient-entered contact; junk throws so the store never persists it. */
export function normalizeWatchContact(raw: {
  name: unknown;
  phone: unknown;
  contactId?: unknown;
}): WatchContact {
  if (typeof raw.name !== 'string' || raw.name.trim() === '') {
    throw new Error('contact needs a name');
  }
  const digits = typeof raw.phone === 'string' ? raw.phone.replace(/[\s\-().]/g, '') : '';
  if (!PHONE_RE.test(digits)) {
    throw new Error('contact needs a valid phone number');
  }
  const contactId =
    typeof raw.contactId === 'string' && raw.contactId !== '' ? raw.contactId : `wc-${Date.now()}`;
  return { contactId, name: raw.name.trim().slice(0, 100), phone: digits };
}

/** Contact-to-medication link; empty or junk links throw. */
export function normalizeWatchLink(raw: { contactId: unknown; medicationIds: unknown }): WatchLink {
  if (typeof raw.contactId !== 'string' || raw.contactId === '') {
    throw new Error('link needs a contact');
  }
  if (!Array.isArray(raw.medicationIds) || raw.medicationIds.length === 0) {
    throw new Error('link needs at least one medication');
  }
  const ids = raw.medicationIds.map((id) => (typeof id === 'string' ? id.trim() : ''));
  if (ids.some((id) => id === '')) {
    throw new Error('link has an invalid medication id');
  }
  return { contactId: raw.contactId, medicationIds: [...new Set(ids)] };
}

function slotDate(slot: DoseSlot): number | null {
  const ms = new Date(`${slot.day}T${slot.time}:00`).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Slots whose scheduled time plus the grace window has passed with no
 * matching taken event. Pure and deterministic for the given now.
 */
export function missedDoses(
  schedule: readonly DoseSlot[],
  taken: readonly TakenRef[],
  nowIso: string,
  graceMinutes: number,
): MissedDose[] {
  const now = new Date(nowIso).getTime();
  if (!Number.isFinite(now)) return [];
  const takenKeys = new Set(taken.map((t) => `${t.medicationId}|${t.day}|${t.time}`));
  const graceMs = Math.max(0, graceMinutes) * 60000;
  const out: MissedDose[] = [];
  for (const slot of schedule) {
    const at = slotDate(slot);
    if (at === null || now < at + graceMs) continue;
    if (takenKeys.has(`${slot.medicationId}|${slot.day}|${slot.time}`)) continue;
    out.push({
      medicationId: slot.medicationId,
      medicationName: slot.medicationName,
      day: slot.day,
      time: slot.time,
    });
  }
  return out;
}

/**
 * SMS text for the patient-tapped notify action. Names the missed
 * medication and time — no instructions, no advice, no names beyond
 * the recipient (the sender is "your family member" so no profile
 * lookup is needed).
 */
export function buildWatchMessage(input: {
  contactName: string;
  medicationName: string;
  time: string;
}): string {
  return (
    `Hi ${input.contactName}, HealthGraph: ` +
    `${input.medicationName} at ${input.time} was missed. ` +
    `Sent from your family member's phone — not automatic.`
  );
}
