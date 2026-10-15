/**
 * consent.ts — explicit Health Connect consent record (GDPR Art. 7 / Art. 9).
 *
 * Health data is a special category: consent must be explicit, specific,
 * informed, and as easy to withdraw as to give. Defaults are denied —
 * nothing authorizes an import until the user grants it against the current
 * disclosure text version. Storage is injected through a port so this module
 * stays free of native imports and fully unit-testable.
 */

import type { HcDataType } from './records';
import type { HealthConnectAdapter } from './capability';

export const CONSENT_STORAGE_KEY = 'hg:health-connect-consent:v1';
export const CONSENT_TEXT_VERSION = 'v1';

export interface ConsentStoragePort {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
}

export interface ConsentRecord {
  granted: boolean;
  grantedAt: string;
  revokedAt: string | null;
  textVersion: string;
  dataTypes: HcDataType[];
  source: 'settings';
}

const KNOWN_TYPES: HcDataType[] = ['steps', 'sleep', 'exercise', 'weight', 'distance'];

function isConsentRecord(raw: unknown): raw is ConsentRecord {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false;
  const r = raw as Record<string, unknown>;
  return (
    typeof r.granted === 'boolean' &&
    typeof r.grantedAt === 'string' &&
    Number.isFinite(Date.parse(r.grantedAt)) &&
    (r.revokedAt === null || (typeof r.revokedAt === 'string' && Number.isFinite(Date.parse(r.revokedAt)))) &&
    typeof r.textVersion === 'string' &&
    Array.isArray(r.dataTypes) &&
    (r.dataTypes as unknown[]).every((t) => KNOWN_TYPES.includes(t as HcDataType)) &&
    r.source === 'settings'
  );
}

export async function readConsent(storage: ConsentStoragePort): Promise<ConsentRecord | null> {
  try {
    const raw = await storage.getItem(CONSENT_STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return isConsentRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function grantConsent(
  storage: ConsentStoragePort,
  dataTypes: HcDataType[],
): Promise<ConsentRecord> {
  const clean = [...new Set(dataTypes)].filter((t) => KNOWN_TYPES.includes(t));
  const record: ConsentRecord = {
    granted: true,
    grantedAt: new Date().toISOString(),
    revokedAt: null,
    textVersion: CONSENT_TEXT_VERSION,
    dataTypes: clean,
    source: 'settings',
  };
  await storage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(record));
  return record;
}

export async function revokeConsent(storage: ConsentStoragePort): Promise<ConsentRecord> {
  const previous = await readConsent(storage);
  const record: ConsentRecord = {
    granted: false,
    grantedAt: previous?.grantedAt ?? new Date().toISOString(),
    revokedAt: new Date().toISOString(),
    textVersion: previous?.textVersion ?? CONSENT_TEXT_VERSION,
    dataTypes: previous?.dataTypes ?? [],
    source: 'settings',
  };
  await storage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(record));
  return record;
}

/** Import runs only on fresh explicit consent AND a ready adapter. */
export async function canImport(
  storage: ConsentStoragePort,
  adapter: { isAvailable: () => boolean },
): Promise<boolean> {
  const record = await readConsent(storage);
  return (
    record !== null &&
    record.granted === true &&
    record.textVersion === CONSENT_TEXT_VERSION &&
    adapter.isAvailable()
  );
}
