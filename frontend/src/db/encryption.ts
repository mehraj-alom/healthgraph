/**
 * Database encryption key management.
 *
 * SECURITY NOTES:
 * - Database is encrypted at rest via SQLCipher (AES-256).
 * - SecureStore protects the database key using iOS Keychain / Android Keystore.
 * - SQLCipher does NOT protect data in process memory.
 * - Rooted/jailbroken devices remain outside the protection boundary.
 * - Debug logging must NOT contain health data or encryption keys.
 * - The key DOES cross the JS/native boundary when PRAGMA key is executed.
 *   This is inherent to SQLCipher's API design. Key exposure is minimized by
 *   retrieving from SecureStore, passing to PRAGMA immediately, then discarding.
 */

import * as SecureStore from 'expo-secure-store';
import { getRandomBytes } from 'expo-crypto';

/**
 * SecureStore key name for the database encryption key.
 * Constant to prevent accidental changes.
 */
const SECURE_STORE_KEY = 'medgraph_sqlite_key_v1';

/**
 * SQLCipher key format: 64-character hex string (256-bit key).
 * SQLCipher expects the key as a hex-encoded string via PRAGMA key.
 */
const KEY_LENGTH_BYTES = 32;
const KEY_LENGTH_HEX = KEY_LENGTH_BYTES * 2;

/**
 * Generate a cryptographically secure random 256-bit key.
 * Returns a 64-character hex string suitable for SQLCipher PRAGMA key.
 *
 * Uses expo-crypto getRandomBytes() which is available across all platforms
 * (Hermes on Android/iOS, and web). This is the Expo-native cryptographic API.
 */
export async function generateDatabaseKey(): Promise<string> {
  const bytes = getRandomBytes(KEY_LENGTH_BYTES);

  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // Defensive check — should never fail
  if (hex.length !== KEY_LENGTH_HEX) {
    throw new Error(
      `Generated key has unexpected length: ${hex.length} (expected ${KEY_LENGTH_HEX})`
    );
  }

  return hex;
}

/**
 * Retrieve the existing database encryption key from SecureStore.
 * Returns null if no key exists (first launch).
 */
export async function getDatabaseKey(): Promise<string | null> {
  return SecureStore.getItemAsync(SECURE_STORE_KEY);
}

/**
 * Get or create the database encryption key.
 * On first call: generates a new key, stores it in SecureStore, returns it.
 * On subsequent calls: retrieves and returns the existing key.
 */
export async function getOrCreateDatabaseKey(): Promise<string> {
  const existing = await getDatabaseKey();
  if (existing) {
    // Validate key format
    if (existing.length !== KEY_LENGTH_HEX || !/^[0-9a-f]+$/.test(existing)) {
      throw new Error(
        'Stored database key has invalid format. ' +
          'The key may be corrupted. Manual intervention required.'
      );
    }
    return existing;
  }

  const newKey = await generateDatabaseKey();
  await SecureStore.setItemAsync(SECURE_STORE_KEY, newKey);
  return newKey;
}

/**
 * Build the SQLCipher PRAGMA key command.
 *
 * SQLCipher PRAGMA key accepts a hex string directly.
 * The key is passed as a string literal. To prevent SQL injection,
 * we validate the key format strictly before interpolation.
 *
 * SECURITY: The key string IS visible in the JS layer during this call.
 * This is inherent to SQLCipher's PRAGMA-based API.
 * The key is discarded from JS scope after this function returns.
 */
export function buildPragmaKeyCommand(key: string): string {
  // Strict validation: must be exactly 64 hex characters
  if (key.length !== KEY_LENGTH_HEX || !/^[0-9a-f]+$/.test(key)) {
    throw new Error('Invalid database key format for PRAGMA');
  }

  // SQLCipher accepts hex keys directly when prefixed with "x'"
  // This avoids any string escaping issues
  return `PRAGMA key = "x'${key}'"`;
}

/**
 * Delete the database key from SecureStore.
 * WARNING: This will make the encrypted database permanently unreadable.
 * Only use for explicit database reset.
 */
export async function deleteDatabaseKey(): Promise<void> {
  await SecureStore.deleteItemAsync(SECURE_STORE_KEY);
}
