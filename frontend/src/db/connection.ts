/**
 * Database connection singleton.
 *
 * SECURITY NOTES:
 * - Database is encrypted at rest via SQLCipher (AES-256).
 * - SecureStore protects the database key using iOS Keychain / Android Keystore.
 * - SQLCipher does NOT protect data in process memory.
 * - Rooted/jailbroken devices remain outside the protection boundary.
 * - Debug logging must NOT contain health data or encryption keys.
 *
 * KNOWN LIMITATIONS:
 * - SQLCipher requires EAS development build (not Expo Go).
 * - Web platform uses plain SQLite (no encryption).
 * - Key crosses JS/native boundary via PRAGMA (inherent to SQLCipher API).
 */

import { Platform } from 'react-native';
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import { getOrCreateDatabaseKey, buildPragmaKeyCommand } from './encryption';
import { runMigrations } from './migrations';

/**
 * Database filename.
 */
const DATABASE_NAME = 'medgraph.db';

/**
 * Singleton database instance.
 * Prevents multiple concurrent initialization races.
 */
let dbInstance: SQLiteDatabase | null = null;
let initializationPromise: Promise<SQLiteDatabase> | null = null;

/**
 * Verify that the database key is valid by performing a read/write test.
 * This confirms SQLCipher is operational and the key is correct.
 */
async function verifyDatabaseKey(db: SQLiteDatabase): Promise<void> {
  // Create a temporary test table
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS __encryption_verify (
      id INTEGER PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Write a test value
  await db.runAsync(
    'INSERT INTO __encryption_verify (id, value) VALUES (?, ?)',
    1,
    'test'
  );

  // Read it back
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM __encryption_verify WHERE id = 1'
  );

  if (!row || row.value !== 'test') {
    throw new Error('Database verification failed: could not read back test data');
  }

  // Clean up test table
  await db.execAsync('DROP TABLE IF EXISTS __encryption_verify;');
}

/**
 * Initialize the encrypted database connection.
 *
 * 1. Retrieve or generate encryption key from SecureStore.
 * 2. Open the database with expo-sqlite.
 * 3. Apply SQLCipher PRAGMA key.
 * 4. Verify the key is valid.
 * 5. Enable foreign keys.
 * 6. Return the database instance.
 */
async function initializeDatabase(): Promise<SQLiteDatabase> {
  console.log('[DB] DB_INIT_START');

  // Platform guard: SQLCipher not available on web
  if (Platform.OS === 'web') {
    throw new Error(
      'Encrypted SQLite is not available on web. ' +
        'Use native platform builds for encrypted database.'
    );
  }

  // Get or create the encryption key
  const key = await getOrCreateDatabaseKey();

  // Open the database
  // NOTE: SQLCipher is compiled into the native binary via app.json config.
  // The database file is created automatically if it doesn't exist.
  const db = await openDatabaseAsync(DATABASE_NAME);

  // Apply SQLCipher encryption key immediately after opening.
  // SECURITY: The key IS visible in the JS layer during this call.
  // This is inherent to SQLCipher's PRAGMA-based API.
  // The key string is discarded from JS scope after this function returns.
  const pragmaCommand = buildPragmaKeyCommand(key);
  await db.execAsync(pragmaCommand);

  // Verify the key is valid
  await verifyDatabaseKey(db);

  // Enable foreign key enforcement
  await db.execAsync('PRAGMA foreign_keys = ON;');

  // Use WAL journal mode for better concurrent read performance
  // Note: WAL is encrypted by SQLCipher automatically
  await db.execAsync('PRAGMA journal_mode = WAL;');

  // Run schema migrations BEFORE exposing the connection.
  // This is the single choke point every repository query goes through
  // (via getDatabase), so no query can run before migrations complete.
  // Migrations are idempotent and preserve existing local data.
  await runMigrations(db);

  console.log('[DB] DB_INIT_SUCCESS');
  return db;
}

/**
 * Get the singleton database connection.
 * Returns the existing connection if already initialized.
 * Prevents multiple concurrent initialization races.
 */
export async function getDatabase(): Promise<SQLiteDatabase> {
  // Return existing instance if available
  if (dbInstance) {
    return dbInstance;
  }

  // If initialization is in progress, wait for it
  if (initializationPromise) {
    return initializationPromise;
  }

  // Start new initialization
  initializationPromise = initializeDatabase()
    .then((db) => {
      dbInstance = db;
      initializationPromise = null;
      return db;
    })
    .catch((error) => {
      initializationPromise = null;
      const name = error instanceof Error ? error.name : 'unknown';
      if (__DEV__) {
        const detail = error instanceof Error ? error.message : String(error);
        console.error(`[DB] DB_INIT_FAILURE name=${name} detail=${detail}`);
      } else {
        console.error(`[DB] DB_INIT_FAILURE name=${name}`);
      }
      throw error;
    });

  return initializationPromise;
}

/**
 * Close the database connection.
 * Clears the singleton instance.
 */
export async function closeDatabase(): Promise<void> {
  if (dbInstance) {
    await dbInstance.closeAsync();
    dbInstance = null;
  }
}

/**
 * Reset the database for development purposes ONLY.
 *
 * WARNING: This permanently destroys the encrypted database and its encryption key.
 * The database will be recreated with a new key on next getDatabase() call.
 *
 * SECURITY: This function must NEVER be exposed through production UI.
 * It should only be called from development tools or test suites.
 */
export async function resetDatabaseForDevelopment(): Promise<void> {
  if (__DEV__) {
    // Close existing connection
    await closeDatabase();

    // Delete the encryption key
    const { deleteDatabaseKey } = await import('./encryption');
    await deleteDatabaseKey();

    // Delete the database file
    const { deleteDatabaseAsync } = await import('expo-sqlite');
    await deleteDatabaseAsync(DATABASE_NAME);

    // Clear singleton references
    dbInstance = null;
    initializationPromise = null;
  }
}

/**
 * Check if the database is currently initialized.
 * Useful for debugging and testing.
 */
export function isDatabaseInitialized(): boolean {
  return dbInstance !== null;
}

// ============================================================================
// Serialized transactions
// ============================================================================
// expo-sqlite executes statements on a single connection without
// transaction awareness: two concurrent withTransactionAsync() calls
// interleave (A-BEGIN, B-BEGIN, ...) and the second BEGIN fails with
// "cannot start a transaction within a transaction". After a fresh
// install every hydration (documents, daily-log, medications, ...) fires
// at once, so this race is near-certain on first launch.
//
// All repository transactions must go through this helper. It chains
// them on a promise mutex so each transaction BEGINs only after the
// previous one committed or rolled back. Callers must never nest it
// (leaf transactions only — verified: no repository transaction body
// opens another transaction).
let transactionChain: Promise<void> = Promise.resolve();

export async function withSerializedTransaction(
  db: SQLiteDatabase,
  task: () => Promise<void>,
): Promise<void> {
  // expo-sqlite types withTransactionAsync as void-returning; none of our
  // transaction bodies produce a value, so void is the honest type.
  const run: Promise<void> = transactionChain.then(
    () => db.withTransactionAsync(task),
  );
  // Swallow for chaining only — the caller still receives the real outcome.
  transactionChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
