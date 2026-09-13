/**
 * Database schema definitions and initialization.
 *
 * This module provides:
 * - Schema constants for table names and column names.
 * - A convenience function to initialize the database with migrations.
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
 *
 * This file contains ONLY infrastructure schema definitions.
 * Application tables (medications, daily_logs, etc.) will be added in STEP 6.
 */

import type { SQLiteDatabase } from 'expo-sqlite';

import { getDatabase } from './connection';
import { runMigrations, verifySchemaVersion, CURRENT_SCHEMA_VERSION } from './migrations';

/**
 * Table names.
 * Use these constants instead of string literals to prevent typos.
 */
export const TABLES = {
  // Infrastructure
  MIGRATION_LOG: '_migration_log',
  SYNC_QUEUE: 'sync_queue',

  // Canonical health data (user-created, syncs to server)
  MEDICATIONS: 'medications',
  MEDICATION_TAKEN_EVENTS: 'medication_taken_events',
  DAILY_LOGS: 'daily_logs',
  DAILY_LOG_EVENTS: 'daily_log_events',
  OBSERVATIONS: 'observations',

  // Cache data (derived from server, read-only locally)
  BODY_STATE_SNAPSHOTS: 'body_state_snapshots',
  DOCUMENTS: 'documents',

  // On-device PPG derived measurements (offline-first, syncs derived only)
  PPG_MEASUREMENTS: 'ppg_measurements',
} as const;

/**
 * Initialize the database connection and run migrations.
 *
 * This is the main entry point for database setup.
 * Call this once when the app starts (after authentication).
 *
 * @returns The initialized database instance.
 */
export async function initializeDatabase(): Promise<SQLiteDatabase> {
  const db = await getDatabase();
  await runMigrations(db);
  await verifySchemaVersion(db);
  return db;
}

/**
 * Get the current schema version.
 * Useful for debugging and testing.
 */
export async function getCurrentSchemaVersion(): Promise<number> {
  const db = await getDatabase();
  const { getSchemaVersion } = await import('./migrations');
  return getSchemaVersion(db);
}

/**
 * Check if the database is initialized and at the correct schema version.
 * Useful for health checks.
 */
export async function isDatabaseReady(): Promise<boolean> {
  try {
    const db = await getDatabase();
    const { getSchemaVersion } = await import('./migrations');
    const version = await getSchemaVersion(db);
    return version === CURRENT_SCHEMA_VERSION;
  } catch {
    return false;
  }
}
