/**
 * fileEnvelope.ts — pure AES-256-CBC + HMAC-SHA256 file envelope (zero
 * native imports, safe for node unit tests).
 *
 * Cached patient files (scanned documents, profile photos) must not sit
 * as plaintext next to an encrypted database. The envelope wraps file
 * bytes: random IV per file, Encrypt-then-MAC, JSON envelope, base64.
 * Keys live in SecureStore (see fileVault.ts) — never beside the files.
 */

import { AES, Base64, CBC, Hex, HmacSHA256, Pkcs7, Utf8, WordArray } from 'crypto-es';

export const ENVELOPE_VERSION = 1;
export const SEALED_SUFFIX = '.enc';

interface Envelope {
  v: number;
  iv: string;
  ct: string;
  mac: string;
}

function keyWords(keyHex: string) {
  if (!/^[0-9a-f]{64}$/i.test(keyHex)) {
    throw new Error('Vault key must be 64 hex characters.');
  }
  return Hex.parse(keyHex);
}

function macFor(ivB64: string, ctB64: string, keyHex: string): string {
  return HmacSHA256(`${ivB64}.${ctB64}`, keyWords(keyHex)).toString(Base64);
}

function macEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Seal base64 file bytes. `ivHex` overrides randomness (tests only) —
 * production always passes 32 fresh hex chars from expo-crypto.
 */
export function sealEnvelope(plainB64: string, keyHex: string, ivHex?: string): string {
  const iv = ivHex ? Hex.parse(ivHex) : WordArray.random(16);
  const ivB64 = iv.toString(Base64);
  const encrypted = AES.encrypt(Base64.parse(plainB64), keyWords(keyHex), {
    iv,
    mode: CBC,
    padding: Pkcs7,
  });
  const ct = encrypted.ciphertext;
  if (!ct) throw new Error('Seal produced no ciphertext.');
  const ctB64 = ct.toString(Base64);
  const env: Envelope = {
    v: ENVELOPE_VERSION,
    iv: ivB64,
    ct: ctB64,
    mac: macFor(ivB64, ctB64, keyHex),
  };
  return Base64.stringify(Utf8.parse(JSON.stringify(env)));
}

/** Open a sealed envelope back to base64 file bytes. Throws on any tampering. */
export function openEnvelope(envelopeB64: string, keyHex: string): string {
  let env: Envelope;
  try {
    env = JSON.parse(Base64.parse(envelopeB64).toString(Utf8)) as Envelope;
  } catch {
    throw new Error('Sealed file is not a readable envelope.');
  }
  if (env?.v !== ENVELOPE_VERSION || typeof env.iv !== 'string' || typeof env.ct !== 'string' || typeof env.mac !== 'string') {
    throw new Error('Sealed file has an unknown envelope.');
  }
  if (!macEqual(env.mac, macFor(env.iv, env.ct, keyHex))) {
    throw new Error('Sealed file failed integrity check.');
  }
  const decrypted = AES.decrypt(
    { ciphertext: Base64.parse(env.ct) } as never,
    keyWords(keyHex),
    { iv: Base64.parse(env.iv), mode: CBC, padding: Pkcs7 },
  );
  return decrypted.toString(Base64);
}

/** Sealed cache files end in `.enc`; anything else is legacy plaintext. */
export function isSealedUri(uri: string | null | undefined): boolean {
  return typeof uri === 'string' && uri.endsWith(SEALED_SUFFIX);
}
