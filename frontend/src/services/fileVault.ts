/**
 * fileVault.ts — encrypted on-device file cache (RN only, native imports).
 *
 * Patient files sealed with AES-256-CBC + HMAC-SHA256 (see fileEnvelope.ts
 * for the pure envelope). One random 256-bit vault key per patient in
 * SecureStore; one random IV per file. Plaintext originals are deleted
 * after sealing (fail closed — a seal failure throws before any delete).
 *
 * Readers get short-lived decrypted temp files and must wipe them with
 * wipeFile() when done (viewer close, after share).
 */

import * as SecureStore from 'expo-secure-store';
import { getRandomBytes } from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';

import { isSealedUri, openEnvelope, SEALED_SUFFIX, sealEnvelope } from './fileEnvelope';
import { PROFILE_PHOTO_DIR } from '@/hooks/useProfilePhoto';

export { isSealedUri, SEALED_SUFFIX };

const VAULT_KEY_PREFIX = 'file-vault-key-v1:';
const DOC_CACHE_SUBDIR = 'documents/';
const TMP_PREFIX = 'vault-tmp-';

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Per-patient vault key from SecureStore (created once, 256-bit random). */
export async function getOrCreateVaultKey(patientId: string): Promise<string> {
  const storeKey = `${VAULT_KEY_PREFIX}${patientId}`;
  const existing = await SecureStore.getItemAsync(storeKey);
  if (existing && /^[0-9a-f]{64}$/i.test(existing)) return existing;
  const fresh = bytesToHex(getRandomBytes(32));
  await SecureStore.setItemAsync(storeKey, fresh);
  return fresh;
}

/**
 * Seal a cached plaintext file in place: `<uri>` → `<uri>.enc`, original
 * deleted only after the sealed copy verifies on disk. Returns the sealed
 * URI. Throws without touching the original on any failure.
 */
export async function sealCachedFile(patientId: string, plainUri: string): Promise<string> {
  const key = await getOrCreateVaultKey(patientId);
  const iv = bytesToHex(getRandomBytes(16));
  const plainB64 = await FileSystem.readAsStringAsync(plainUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const envelopeB64 = sealEnvelope(plainB64, key, iv);
  const encUri = `${plainUri}${SEALED_SUFFIX}`;
  await FileSystem.writeAsStringAsync(encUri, envelopeB64);
  const check = await FileSystem.getInfoAsync(encUri);
  if (!check.exists) {
    throw new Error('Sealed copy did not land on disk.');
  }
  await FileSystem.deleteAsync(plainUri, { idempotent: true });
  return encUri;
}

/**
 * Decrypt a sealed file to a short-lived temp file. The caller owns the
 * temp file and must wipeFile() it when done. Throws on tampering.
 */
export async function openSealedFile(patientId: string, encUri: string): Promise<string> {
  const key = await getOrCreateVaultKey(patientId);
  const envelopeB64 = await FileSystem.readAsStringAsync(encUri);
  const plainB64 = openEnvelope(envelopeB64.trim(), key);
  const base = FileSystem.documentDirectory;
  if (!base) throw new Error('On-device file storage is not available on this platform.');
  const rand = bytesToHex(getRandomBytes(8));
  const tmpUri = `${base}${DOC_CACHE_SUBDIR}${TMP_PREFIX}${Date.now()}-${rand}.bin`;
  const dirInfo = await FileSystem.getInfoAsync(`${base}${DOC_CACHE_SUBDIR}`);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(`${base}${DOC_CACHE_SUBDIR}`, { intermediates: true });
  }
  await FileSystem.writeAsStringAsync(tmpUri, plainB64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return tmpUri;
}

/** Idempotent single-file delete. */
export async function wipeFile(uri: string | null | undefined): Promise<void> {
  if (!uri) return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // Best-effort; a missing file is already the desired end state.
  }
}

/**
 * Wipe every patient file cache dir (documents, profile photos, decrypted
 * temps). Called on logout and account/data delete — files must never
 * outlive the session the way the SQLite wipe already guarantees for rows.
 */
export async function wipePatientFiles(): Promise<void> {
  const base = FileSystem.documentDirectory;
  if (!base) return;
  for (const sub of [DOC_CACHE_SUBDIR, PROFILE_PHOTO_DIR]) {
    try {
      await FileSystem.deleteAsync(`${base}${sub}`, { idempotent: true });
    } catch {
      // Best-effort per dir; one failure must not spare the other.
    }
  }
}
