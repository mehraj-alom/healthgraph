/**
 * familyWatchStore.ts — AsyncStorage persistence for watch contacts + links.
 *
 * Device-only like the medication data it accompanies: one versioned key
 * holding contacts and their medication links. Validation lives in
 * familyWatch.ts; this file only reads and writes JSON. Deleting a
 * contact revokes its invite (links are dropped with it).
 *
 * Never imported by node tests (native storage import); covered by tsc
 * and the contract tests in familyWatch.test.mts.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  WATCH_CONTACTS_KEY,
  normalizeWatchContact,
  normalizeWatchLink,
  type WatchContact,
  type WatchLink,
} from './familyWatch';

export interface StoredWatch {
  patientId: string;
  contacts: WatchContact[];
  links: WatchLink[];
}

function empty(patientId: string): StoredWatch {
  return { patientId, contacts: [], links: [] };
}

export async function getWatch(patientId: string): Promise<StoredWatch> {
  const fallback = empty(patientId);
  try {
    const raw = await AsyncStorage.getItem(WATCH_CONTACTS_KEY);
    if (raw === null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return fallback;
    const r = parsed as Record<string, unknown>;
    const contacts: WatchContact[] = [];
    if (Array.isArray(r.contacts)) {
      for (const item of r.contacts) {
        if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
        const c = item as Record<string, unknown>;
        try {
          contacts.push(normalizeWatchContact({ name: c.name, phone: c.phone, contactId: c.contactId }));
        } catch {
          // Corrupt rows are dropped, never crash the store.
        }
      }
    }
    const links: WatchLink[] = [];
    if (Array.isArray(r.links)) {
      for (const item of r.links) {
        if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
        const l = item as Record<string, unknown>;
        try {
          const clean = normalizeWatchLink({ contactId: l.contactId, medicationIds: l.medicationIds });
          if (contacts.some((c) => c.contactId === clean.contactId)) links.push(clean);
        } catch {
          // Orphaned or corrupt links are dropped.
        }
      }
    }
    return { patientId, contacts, links };
  } catch {
    return fallback;
  }
}

async function persist(out: StoredWatch): Promise<StoredWatch> {
  await AsyncStorage.setItem(WATCH_CONTACTS_KEY, JSON.stringify(out)).catch(() => {});
  return out;
}

export async function addWatchContact(
  patientId: string,
  input: { name: unknown; phone: unknown },
): Promise<StoredWatch> {
  const clean = normalizeWatchContact(input);
  const current = await getWatch(patientId);
  const contacts = current.contacts.filter((c) => c.phone !== clean.phone);
  contacts.push({ ...clean, contactId: `wc-${Date.now()}` });
  return persist({ patientId, contacts, links: current.links });
}

export async function removeWatchContact(patientId: string, contactId: string): Promise<StoredWatch> {
  const current = await getWatch(patientId);
  return persist({
    patientId,
    contacts: current.contacts.filter((c) => c.contactId !== contactId),
    links: current.links.filter((l) => l.contactId !== contactId),
  });
}

export async function setWatchLink(
  patientId: string,
  input: { contactId: unknown; medicationIds: unknown },
): Promise<StoredWatch> {
  const clean = normalizeWatchLink(input);
  const current = await getWatch(patientId);
  if (!current.contacts.some((c) => c.contactId === clean.contactId)) {
    throw new Error('unknown contact');
  }
  const links = current.links.filter((l) => l.contactId !== clean.contactId);
  links.push(clean);
  return persist({ patientId, contacts: current.contacts, links });
}
