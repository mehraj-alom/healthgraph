import * as SecureStore from 'expo-secure-store';
import type { Persistence } from 'firebase/auth';
import { joinParts, parseCount, splitValue, staleIndices, toChunkKey, toStoreKey } from './secureChunks';

/**
 * SecureStore-backed Firebase Auth persistence.
 *
 * Firebase tokens previously lived in plaintext AsyncStorage while the
 * patient_id and database key used Keychain/Keystore-backed SecureStore.
 * This closes that gap: auth state now persists behind the same hardware
 * backing.
 *
 * Firebase requires each persistence entry to be a CLASS DEFINITION with an
 * empty constructor (it instantiates via `new`, see getReactNativePersistence
 * in @firebase/auth) — passing a plain object crashes startup with
 * "expected a class definition". Hence this factory returns a class whose
 * closure captures SecureStore, mirroring Firebase's own implementation
 * (probe set/remove in _isAvailable, JSON round-trip, no-op listeners).
 *
 * SecureStore values cap at 2048 bytes, so blobs are chunked (see
 * secureChunks.ts). Firebase keys (`firebase:authUser:<key>:[DEFAULT]`)
 * contain colons/brackets SecureStore rejects, so every key is encoded
 * via encodeStorageKey first — deterministic and collision-free.
 *
 * One-time effect of switching: existing sessions persisted in
 * AsyncStorage are not migrated — users sign in once more.
 */

const PREFIX = 'hg_fbauth_';
const PROBE_KEY = `${PREFIX}probe`;

async function readCount(key: string): Promise<number> {
  try {
    return parseCount(await SecureStore.getItemAsync(toStoreKey(PREFIX, key)));
  } catch {
    return 0;
  }
}

async function readAll(key: string): Promise<string | null> {
  const count = await readCount(key);
  if (count === 0) return null;
  const parts: (string | null)[] = [];
  for (let i = 0; i < count; i++) {
    try {
      parts.push(await SecureStore.getItemAsync(toChunkKey(PREFIX, key, i)));
    } catch {
      return null;
    }
  }
  return joinParts(parts);
}

async function writeAll(key: string, value: string): Promise<void> {
  const previous = await readCount(key);
  const parts = splitValue(value);
  await SecureStore.setItemAsync(toStoreKey(PREFIX, key), String(parts.length));
  for (let i = 0; i < parts.length; i++) {
    await SecureStore.setItemAsync(toChunkKey(PREFIX, key, i), parts[i]);
  }
  for (const i of staleIndices(previous, parts.length)) {
    try {
      await SecureStore.deleteItemAsync(toChunkKey(PREFIX, key, i));
    } catch {
      // Best-effort stale-chunk cleanup.
    }
  }
}

async function removeAll(key: string): Promise<void> {
  const previous = await readCount(key);
  for (let i = 0; i < previous; i++) {    try {
      await SecureStore.deleteItemAsync(toChunkKey(PREFIX, key, i));
    } catch {
      // Best-effort.
    }
  }
  try {
    await SecureStore.deleteItemAsync(toStoreKey(PREFIX, key));
  } catch {
    // Already absent.
  }
}

export interface SecureStorePersistenceInstance {
  readonly type: 'LOCAL';
  _isAvailable(): Promise<boolean>;
  _set(key: string, value: unknown): Promise<void>;
  _get<T>(key: string): Promise<T | null>;
  _remove(key: string): Promise<void>;
  _addListener(_key: string, _listener: () => void): void;
  _removeListener(_key: string, _listener: () => void): void;
}

export type SecureStorePersistenceClass = new () => SecureStorePersistenceInstance;

/**
 * Returns a persistence class closing over SecureStore, shaped exactly
 * like Firebase's own getReactNativePersistence majority: empty
 * constructor, LOCAL type (static + instance), availability probe,
 * JSON value round-trip, unsupported listeners as no-ops.
 */
export function getSecureStorePersistence(): SecureStorePersistenceClass {
  const SecureStorePersistence = class {
    static type = 'LOCAL' as const;
    readonly type = 'LOCAL' as const;

    async _isAvailable(): Promise<boolean> {
      try {
        await SecureStore.setItemAsync(PROBE_KEY, '1');
        await SecureStore.deleteItemAsync(PROBE_KEY);
        return true;
      } catch {
        return false;
      }
    }

    _set(key: string, value: unknown): Promise<void> {
      return writeAll(key, JSON.stringify(value));
    }

    async _get<T>(key: string): Promise<T | null> {
      const json = await readAll(key);
      return json == null ? null : (JSON.parse(json) as T);
    }

    _remove(key: string): Promise<void> {
      return removeAll(key);
    }

    _addListener(): void {
      // Listeners are not supported for SecureStore storage.
    }

    _removeListener(): void {
      // Listeners are not supported for SecureStore storage.
    }
  };
  return SecureStorePersistence as unknown as SecureStorePersistenceClass;
}

/** Firebase-typed alias for the initializeAuth dependency slot. */
export function secureStorePersistenceForAuth(): Persistence {
  return getSecureStorePersistence() as unknown as Persistence;
}
