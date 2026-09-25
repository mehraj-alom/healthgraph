import * as SecureStore from 'expo-secure-store';
import type { Persistence } from 'firebase/auth';

/**
 * SecureStore-backed Firebase Auth persistence.
 *
 * Firebase tokens previously lived in plaintext AsyncStorage while the
 * patient_id and database key used Keychain/Keystore-backed SecureStore.
 * This closes that gap: auth state now persists behind the same hardware
 * backing. SecureStore values cap at 2048 bytes, so values are chunked.
 *
 * One-time effect of switching: existing sessions persisted in
 * AsyncStorage are not migrated — users sign in once more.
 */

const PREFIX = 'hg_fbauth_';
const CHUNK = 1800;

async function readCount(key: string): Promise<number> {
  try {
    const raw = await SecureStore.getItemAsync(PREFIX + key);
    const parsed = raw == null ? 0 : parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

async function readAll(key: string): Promise<string | null> {
  const count = await readCount(key);
  if (count === 0) return null;
  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    try {
      const part = await SecureStore.getItemAsync(`${PREFIX}${key}#${i}`);
      if (part == null) return null;
      parts.push(part);
    } catch {
      return null;
    }
  }
  return parts.join('');
}

async function writeAll(key: string, value: string): Promise<void> {
  const previous = await readCount(key);
  const parts: string[] = [];
  for (let i = 0; i < value.length; i += CHUNK) {
    parts.push(value.slice(i, i + CHUNK));
  }
  await SecureStore.setItemAsync(PREFIX + key, String(parts.length));
  for (let i = 0; i < parts.length; i++) {
    await SecureStore.setItemAsync(`${PREFIX}${key}#${i}`, parts[i]);
  }
  for (let i = parts.length; i < previous; i++) {
    try {
      await SecureStore.deleteItemAsync(`${PREFIX}${key}#${i}`);
    } catch {
      // Best-effort stale-chunk cleanup.
    }
  }
}

async function removeAll(key: string): Promise<void> {
  const previous = await readCount(key);
  for (let i = 0; i < previous; i++) {
    try {
      await SecureStore.deleteItemAsync(`${PREFIX}${key}#${i}`);
    } catch {
      // Best-effort.
    }
  }
  try {
    await SecureStore.deleteItemAsync(PREFIX + key);
  } catch {
    // Already absent.
  }
}

export const securePersistence = {
  type: 'LOCAL',
  _isAvailable: async (): Promise<boolean> => {
    try {
      return await SecureStore.isAvailableAsync();
    } catch {
      return false;
    }
  },
  _set: (key: string, value: string): Promise<void> => writeAll(key, String(value)),
  _get: (key: string): Promise<string | null> => readAll(key),
  _remove: (key: string): Promise<void> => removeAll(key),
  _addListener: (): void => {},
  _removeListener: (): void => {},
} as unknown as Persistence;
