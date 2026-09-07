/**
 * Database migration system.
 *
 * Uses PRAGMA user_version for schema versioning.
 * Migrations are transactional, idempotent, and can be appended cleanly.
 *
 * SECURITY NOTES:
 * - Database is encrypted at rest via SQLCipher (AES-256).
 * - Migrations operate on already-decrypted data in memory.
 * - Debug logging must NOT contain health data or encryption keys.
 */

import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * Current database schema version.
 * Increment this when adding new migrations.
 */
export const CURRENT_SCHEMA_VERSION = 3;

/**
 * Migration function type.
 * Each migration receives the database instance and runs within a transaction.
 */
type MigrationFn = (db: SQLiteDatabase) => Promise<void>;

/**
 * Registry of all migrations.
 * Key is the target version number.
 * Value is the migration function that upgrades from (version - 1) to version.
 */
const migrations: Record<number, MigrationFn> = {
  /**
   * Migration 1: Create infrastructure tables.
   *
   * This migration creates the minimal infrastructure required to prove
   * the migration system works. Application tables will be added in STEP 6.
   *
   * Tables created:
   * - _migration_log: Tracks migration history for debugging.
   */
  1: async (db: SQLiteDatabase) => {
    // Migration log table for debugging and audit trail.
    // NOT a health data table — infrastructure only.
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS _migration_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version INTEGER NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now')),
        description TEXT
      );
    `);

    // Record this migration
    await db.runAsync(
      `INSERT INTO _migration_log (version, description) VALUES (?, ?)`,
      1,
      'Initial schema: migration infrastructure'
    );
  },

  /**
   * Migration 2: Create application health-data tables.
   *
   * Creates the 8 core tables for local health data:
   * - medications: Canonical medication regimen
   * - medication_taken_events: Dose-taking history
   * - daily_logs: Daily check-in groups
   * - daily_log_events: Individual events within daily logs
   * - observations: Anatomical/body observations
   * - body_state_snapshots: Materialized body state for 3D rendering (cache)
   * - documents: Document metadata cache
   * - sync_queue: Offline mutation queue
   *
   * SYNC CONVENTION:
   * All canonical tables use consistent sync fields:
   * - local_id: Local UUID for offline-created records
   * - sync_status: 'synced' | 'pending_create' | 'pending_update' | 'pending_delete'
   * - server_revision: Optimistic concurrency version from server
   */
  2: async (db: SQLiteDatabase) => {
    // =====================================================================
    // medications
    // Source of truth for patient medication regimen.
    // Maps to: models/medications.py, frontend Medication type
    // =====================================================================
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS medications (
        medication_id TEXT PRIMARY KEY,
        patient_id TEXT NOT NULL,
        name TEXT NOT NULL,
        generic_name TEXT,
        brand_name TEXT,
        strength TEXT,
        strength_unit TEXT,
        dose_amount REAL,
        dose_unit TEXT,
        route TEXT,
        frequency TEXT NOT NULL,
        scheduled_times TEXT,
        scheduled_weekdays TEXT,
        start_date TEXT,
        end_date TEXT,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        purpose TEXT,
        instructions TEXT,
        prescriber TEXT,
        prn INTEGER NOT NULL DEFAULT 0,
        reminder_enabled INTEGER NOT NULL DEFAULT 0,
        notes TEXT,
        source_document_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        local_id TEXT,
        sync_status TEXT NOT NULL DEFAULT 'synced',
        server_revision INTEGER
      );
    `);

    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS ix_medications_patient ON medications (patient_id);
      CREATE INDEX IF NOT EXISTS ix_medications_patient_status ON medications (patient_id, status);
      CREATE INDEX IF NOT EXISTS ix_medications_sync ON medications (sync_status);
    `);

    // =====================================================================
    // medication_taken_events
    // Records individual dose-taking history.
    // Maps to: models/medications.py MedicationTakenEvent
    // =====================================================================
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS medication_taken_events (
        event_id TEXT PRIMARY KEY,
        medication_id TEXT NOT NULL,
        patient_id TEXT NOT NULL,
        taken_at TEXT NOT NULL,
        scheduled_for TEXT,
        dose_taken REAL,
        dose_unit TEXT,
        status TEXT NOT NULL DEFAULT 'TAKEN',
        notes TEXT,
        clinical_event_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        local_id TEXT,
        sync_status TEXT NOT NULL DEFAULT 'synced',
        server_revision INTEGER,
        FOREIGN KEY (medication_id) REFERENCES medications (medication_id)
      );
    `);

    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS ix_med_taken_medication ON medication_taken_events (medication_id, taken_at);
      CREATE INDEX IF NOT EXISTS ix_med_taken_patient ON medication_taken_events (patient_id, taken_at);
      CREATE INDEX IF NOT EXISTS ix_med_taken_sync ON medication_taken_events (sync_status);
    `);

    // =====================================================================
    // daily_logs
    // Group-level daily check-in records.
    // Maps to: schemas/daily_logs.py DailyCheckInRequest/Response
    // The group_id is the stable identifier linking all events for a day.
    // =====================================================================
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS daily_logs (
        group_id TEXT PRIMARY KEY,
        patient_id TEXT NOT NULL,
        log_date TEXT NOT NULL,
        overall_wellbeing INTEGER,
        energy_level INTEGER,
        stress_level INTEGER,
        sleep_duration_minutes INTEGER,
        sleep_quality INTEGER,
        sleep_awakenings INTEGER,
        water_ml INTEGER,
        meals_count INTEGER,
        appetite_level INTEGER,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        local_id TEXT,
        sync_status TEXT NOT NULL DEFAULT 'synced',
        server_revision INTEGER
      );
    `);

    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS ix_daily_logs_patient ON daily_logs (patient_id);
      CREATE INDEX IF NOT EXISTS ix_daily_logs_patient_date ON daily_logs (patient_id, log_date);
      CREATE INDEX IF NOT EXISTS ix_daily_logs_sync ON daily_logs (sync_status);
    `);

    // =====================================================================
    // daily_log_events
    // Individual clinical events belonging to a daily log group.
    // Maps to: models/daily_logs/events.py payload tables
    //
    // Event types (from models/events.py EventType enum):
    // SYMPTOM, VITAL_SIGN, PAIN_LOG, SLEEP_LOG, ACTIVITY_LOG,
    // NUTRITION_LOG, MEDICATION_TAKEN, WELLBEING_LOG
    //
    // payload_json contains event-type-specific data as a JSON string.
    // This avoids creating 8+ separate payload tables locally.
    // =====================================================================
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS daily_log_events (
        event_id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        concept_id TEXT,
        event_time TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'synced',
        FOREIGN KEY (group_id) REFERENCES daily_logs (group_id)
      );
    `);

    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS ix_daily_events_group ON daily_log_events (group_id);
      CREATE INDEX IF NOT EXISTS ix_daily_events_type ON daily_log_events (event_type);
      CREATE INDEX IF NOT EXISTS ix_daily_events_sync ON daily_log_events (sync_status);
    `);

    // =====================================================================
    // observations
    // Anatomical/body observations (canonical clinical findings).
    // Maps to: models/anatomy.py AnatomicalObservation
    // =====================================================================
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS observations (
        observation_id TEXT PRIMARY KEY,
        patient_id TEXT NOT NULL,
        structure_id TEXT NOT NULL,
        observation_type TEXT NOT NULL,
        finding_code TEXT NOT NULL,
        finding_display_name TEXT NOT NULL,
        visual_status TEXT NOT NULL DEFAULT 'normal',
        visual_severity_score REAL NOT NULL DEFAULT 0.0,
        trend TEXT NOT NULL DEFAULT 'stable',
        source_type TEXT NOT NULL,
        source_id TEXT,
        event_id TEXT,
        document_id TEXT,
        clinical_summary TEXT,
        recorded_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        local_id TEXT,
        sync_status TEXT NOT NULL DEFAULT 'synced',
        server_revision INTEGER
      );
    `);

    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS ix_obs_patient ON observations (patient_id);
      CREATE INDEX IF NOT EXISTS ix_obs_patient_structure ON observations (patient_id, structure_id, recorded_at);
      CREATE INDEX IF NOT EXISTS ix_obs_sync ON observations (sync_status);
    `);

    // =====================================================================
    // body_state_snapshots
    // Materialized read model for 3D body rendering (CACHE DATA).
    // Maps to: models/anatomy.py PatientBodyStateSnapshot
    // Primary key: patient_id + structure_id (composite)
    // =====================================================================
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS body_state_snapshots (
        patient_id TEXT NOT NULL,
        structure_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        mesh_node_name TEXT NOT NULL,
        visual_status TEXT NOT NULL,
        severity REAL NOT NULL,
        trend TEXT NOT NULL,
        latest_summary TEXT,
        cached_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (patient_id, structure_id)
      );
    `);

    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS ix_body_state_patient ON body_state_snapshots (patient_id);
    `);

    // =====================================================================
    // documents
    // Document metadata cache (NOT file contents).
    // Maps to: models/events.py Document, frontend DocumentListItem
    // =====================================================================
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS documents (
        document_id TEXT PRIMARY KEY,
        patient_id TEXT NOT NULL,
        file_hash TEXT NOT NULL,
        storage_url TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'UPLOADED',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        cached_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS ix_docs_patient ON documents (patient_id);
      CREATE INDEX IF NOT EXISTS ix_docs_cached ON documents (cached_at);
    `);

    // =====================================================================
    // sync_queue
    // Offline mutation queue for pending sync operations.
    // Infrastructure table — not health data.
    // =====================================================================
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS sync_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        table_name TEXT NOT NULL,
        record_id TEXT NOT NULL,
        mutation_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        payload_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        attempt_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        status TEXT NOT NULL DEFAULT 'pending'
      );
    `);

    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS ix_sync_status ON sync_queue (status, created_at);
      CREATE INDEX IF NOT EXISTS ix_sync_record ON sync_queue (table_name, record_id);
      CREATE INDEX IF NOT EXISTS ix_sync_mutation ON sync_queue (mutation_id);
    `);

    // Record this migration
    await db.runAsync(
      `INSERT INTO _migration_log (version, description) VALUES (?, ?)`,
      2,
      'Application schema: medications, daily_logs, observations, body_state, documents, sync_queue'
    );
  },

  // ========================================================================
  // Migration 3: Cache tables for HomeCache migration
  // ========================================================================
  // Migrates HomeCache from AsyncStorage to encrypted SQLite.
  // Adds compact cache tables for profile, dailyMetrics, and trends.
  // bodyState, documents, and medications are already in dedicated tables.
  3: async (db: SQLiteDatabase) => {
    // Profile cache (compact, rarely changes)
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS profile_cache (
        patient_id TEXT PRIMARY KEY,
        display_name TEXT,
        phone_number TEXT,
        height_cm REAL,
        weight_kg REAL,
        cached_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // Daily metrics cache (derived server data, 2 min TTL)
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS daily_metrics_cache (
        patient_id TEXT PRIMARY KEY,
        metrics_json TEXT NOT NULL,
        cached_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // Trends cache (large JSON blob, 10 min TTL)
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS trends_cache (
        patient_id TEXT PRIMARY KEY,
        days INTEGER NOT NULL,
        trends_json TEXT NOT NULL,
        cached_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // Record this migration
    await db.runAsync(
      `INSERT INTO _migration_log (version, description) VALUES (?, ?)`,
      3,
      'Cache tables: profile_cache, daily_metrics_cache, trends_cache'
    );
  },
};

/**
 * Get the current schema version from the database.
 * Returns 0 if the database is new (no migrations applied).
 */
export async function getSchemaVersion(db: SQLiteDatabase): Promise<number> {
  const result = await db.getFirstAsync<{ user_version: number }>(
    'PRAGMA user_version'
  );
  return result?.user_version ?? 0;
}

/**
 * Set the schema version in the database.
 */
export async function setSchemaVersion(
  db: SQLiteDatabase,
  version: number
): Promise<void> {
  await db.execAsync(`PRAGMA user_version = ${version}`);
}

/**
 * Run all pending migrations.
 *
 * - Reads current schema version.
 * - Applies all migrations from (current + 1) to CURRENT_SCHEMA_VERSION.
 * - Each migration runs in a transaction and rolls back on failure.
 * - Migrations are idempotent (safe to re-run).
 *
 * Returns the final schema version.
 */
export async function runMigrations(db: SQLiteDatabase): Promise<number> {
  const currentVersion = await getSchemaVersion(db);

  if (currentVersion >= CURRENT_SCHEMA_VERSION) {
    return currentVersion;
  }

  for (let targetVersion = currentVersion + 1; targetVersion <= CURRENT_SCHEMA_VERSION; targetVersion++) {
    const migration = migrations[targetVersion];
    if (!migration) {
      throw new Error(
        `Migration to version ${targetVersion} not found. ` +
          `Current version: ${currentVersion}. ` +
          `Target version: ${CURRENT_SCHEMA_VERSION}.`
      );
    }

    // Run migration in a transaction
    await db.withTransactionAsync(async () => {
      await migration(db);
      await setSchemaVersion(db, targetVersion);
    });
  }

  return CURRENT_SCHEMA_VERSION;
}

/**
 * Verify the database schema is at the expected version.
 * Throws if the version doesn't match.
 */
export async function verifySchemaVersion(db: SQLiteDatabase): Promise<void> {
  const version = await getSchemaVersion(db);
  if (version !== CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Database schema version mismatch. ` +
        `Expected ${CURRENT_SCHEMA_VERSION}, got ${version}.`
    );
  }
}
