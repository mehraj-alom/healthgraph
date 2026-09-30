/**
 * medicationReminders — Batch 1 tests for the call-like local reminder.
 *
 * Layers (kept explicit per the batch report):
 * - unit-tested pure scheduling logic (no device, no native modules)
 * - node:sqlite migration + query tests (need node 22+)
 * - text-level wiring guards for the RN-bound layers (repo precedent)
 * - Android notification integration + physical device: NOT claimed here
 *
 * Run (node 22+):
 *   node --experimental-sqlite --experimental-strip-types --test frontend/tests/medicationReminders.test.mts
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  MAX_SNOOZE_COUNT,
  LATER_FALLBACK_MINUTES,
  occurrenceIdFor,
  rootOccurrenceId,
  localDayString,
  localWeekday,
  slotsForMedication,
  computeReminderOccurrences,
  takenSlotKey,
  diffReconcile,
  snoozeOptionsFor,
  nextSnoozeOccurrence,
  defaultTimesForFrequency,
  type SchedulableMedication,
  type ReminderOccurrence,
} from '../src/services/medicationReminderSchedule.ts';

import {
  ACTION_TAKEN,
  ACTION_SNOOZE_30,
  ACTION_SNOOZE_60,
  REMINDER_CHANNEL_ID,
  REMINDER_CATEGORY_ID,
  parseReminderTap,
} from '../src/services/reminderContract.ts';

import {
  upsertReminderInstanceDb,
  listReminderInstancesFromDb,
  getReminderInstanceDb,
  setReminderInstanceStatusDb,
  pruneReminderInstancesDb,
} from '../src/db/queries/reminderInstances.ts';

import { runMigrations, CURRENT_SCHEMA_VERSION, getSchemaVersion } from '../src/db/migrations.ts';

declare const __dirname: string;

function repoRoot(): string {
  const bases: string[] = [];
  try {
    if (typeof __dirname === 'string') bases.push(path.resolve(__dirname, '..'));
  } catch {
    // ESM/strip-types runtimes have no __dirname: fall through to cwd.
  }
  bases.push(process.cwd(), path.join(process.cwd(), 'frontend'));
  for (const b of bases) {
    try {
      if (fs.existsSync(path.join(b, 'App.tsx'))) return b;
    } catch {
      // Ignore and try the next candidate.
    }
  }
  throw new Error('repo root not found (App.tsx missing)');
}

const ROOT = repoRoot();
function src(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// Facade over node:sqlite matching the expo-sqlite subset the migrations
// and mirrored queries use (same shape as migrations.test.mts).
function makeDb() {
  const s = new DatabaseSync(':memory:');
  s.exec('PRAGMA foreign_keys = ON');

  const flat = (params: unknown[]) =>
    params.length === 1 && Array.isArray(params[0]) ? params[0] : params;

  return {
    async execAsync(sql: string): Promise<void> {
      s.exec(sql);
    },
    async runAsync(sql: string, ...params: unknown[]) {
      const r = s.prepare(sql).run(...(flat(params) as unknown[]));
      return { changes: Number(r.changes) };
    },
    async getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]> {
      return s.prepare(sql).all(...(flat(params) as unknown[])) as T[];
    },
    async getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null> {
      return (s.prepare(sql).get(...(flat(params) as unknown[])) as T | undefined) ?? null;
    },
    async withTransactionAsync(fn: () => Promise<void>): Promise<void> {
      s.exec('BEGIN');
      try {
        await fn();
        s.exec('COMMIT');
      } catch (e) {
        s.exec('ROLLBACK');
        throw e;
      }
    },
    exec(sql: string): void {
      s.exec(sql);
    },
  };
}

function med(overrides: Partial<SchedulableMedication> = {}): SchedulableMedication {
  return {
    medication_id: 'm1',
    name: 'Aspirin',
    dose_amount: 100,
    dose_unit: 'mg',
    frequency: 'ONCE_DAILY',
    scheduled_times: ['08:00'],
    scheduled_weekdays: null,
    start_date: null,
    end_date: null,
    status: 'ACTIVE',
    prn: false,
    reminder_enabled: true,
    ...overrides,
  };
}

function occ(
  overrides: Partial<ReminderOccurrence> = {},
): ReminderOccurrence {
  return {
    occurrenceId: 'm1|2026-09-23|08:00',
    medicationId: 'm1',
    medicationName: 'Aspirin',
    doseAmount: 100,
    doseUnit: 'mg',
    day: '2026-09-23',
    scheduledTime: '08:00',
    scheduledAt: new Date(2026, 8, 23, 8, 0, 0).toISOString(),
    ...overrides,
  };
}

// ============================================================================
// Pure scheduling logic
// ============================================================================

describe('occurrence ids + slots', () => {
  test('occurrence ids are deterministic per dose slot', () => {
    assert.equal(occurrenceIdFor('m1', '2026-09-23', '08:00'), 'm1|2026-09-23|08:00');
    assert.equal(rootOccurrenceId('m1|2026-09-23|08:00::snooze2'), 'm1|2026-09-23|08:00');
    assert.equal(rootOccurrenceId('m1|2026-09-23|08:00'), 'm1|2026-09-23|08:00');
  });

  test('wall-clock helpers stay local (no UTC drift)', () => {
    const d = new Date(2026, 8, 23, 8, 5, 0);
    assert.equal(localDayString(d), '2026-09-23');
    assert.equal(localWeekday('2026-09-23'), d.getDay());
  });

  test('slots honor status, prn, reminder flag, dates, weekdays', () => {
    assert.deepEqual(slotsForMedication(med(), '2026-09-23'), ['08:00']);
    assert.deepEqual(slotsForMedication(med({ status: 'PAUSED' }), '2026-09-23'), []);
    assert.deepEqual(slotsForMedication(med({ prn: true }), '2026-09-23'), []);
    assert.deepEqual(slotsForMedication(med({ reminder_enabled: false }), '2026-09-23'), []);
    assert.deepEqual(slotsForMedication(med({ start_date: '2026-09-24' }), '2026-09-23'), []);
    assert.deepEqual(slotsForMedication(med({ end_date: '2026-09-22' }), '2026-09-23'), []);
    // Wednesday 2026-09-23 is weekday 3.
    assert.deepEqual(slotsForMedication(med({ scheduled_weekdays: [3] }), '2026-09-23'), ['08:00']);
    assert.deepEqual(slotsForMedication(med({ scheduled_weekdays: [4] }), '2026-09-23'), []);
  });

  test('invalid or missing times fall back or drop', () => {
    assert.deepEqual(
      slotsForMedication(med({ scheduled_times: null, frequency: 'TWICE_DAILY' }), '2026-09-23'),
      ['08:00', '20:00'],
    );
    assert.deepEqual(
      slotsForMedication(med({ scheduled_times: ['25:00', 'nope'] }), '2026-09-23'),
      ['08:00'],
    );
    assert.deepEqual(
      slotsForMedication(med({ scheduled_times: null, frequency: 'AS_NEEDED' }), '2026-09-23'),
      [],
    );
    assert.deepEqual(defaultTimesForFrequency('EVERY_8_HOURS'), ['08:00', '16:00', '00:00']);
  });

  test('occurrences are future-only, sorted and horizon-bounded', () => {
    const now = new Date(2026, 8, 23, 9, 0, 0); // 09:00 local
    const out = computeReminderOccurrences(
      [med({ scheduled_times: ['08:00', '20:00'] })],
      now,
      2,
    );
    // 08:00 today is past; 20:00 today + both slots tomorrow remain.
    assert.equal(out.length, 3);
    assert.ok(out.every((o) => new Date(o.scheduledAt).getTime() > now.getTime()));
    assert.deepEqual(
      out.map((o) => o.occurrenceId),
      ['m1|2026-09-23|20:00', 'm1|2026-09-24|08:00', 'm1|2026-09-24|20:00'],
    );
    assert.ok(computeReminderOccurrences([med()], now, 30).length <= 60);
  });
});

describe('reconcile diff', () => {
  test('new slots schedule, removed slots cancel, taken slots skip', () => {
    const desired = [occ(), occ({ occurrenceId: 'm1|2026-09-23|20:00', scheduledTime: '20:00' })];
    const existing = [
      {
        occurrence_id: 'm1|2026-09-23|08:00',
        medication_id: 'm1',
        status: 'scheduled',
        notification_id: 'n1',
      },
      {
        occurrence_id: 'm0|2026-09-23|08:00',
        medication_id: 'm0',
        status: 'scheduled',
        notification_id: 'n0',
      },
    ];
    const diff = diffReconcile(desired, existing, []);
    assert.deepEqual(
      diff.toSchedule.map((o) => o.occurrenceId),
      ['m1|2026-09-23|20:00'],
    );
    assert.deepEqual(
      diff.toCancel.map((i) => i.occurrence_id),
      ['m0|2026-09-23|08:00'],
    );
    assert.equal(diff.skippedTaken, 0);
  });

  test('taken events suppress their slots; snoozed rows are preserved', () => {
    const desired = [occ()];
    const existing = [
      {
        occurrence_id: 'm1|2026-09-23|08:00::snooze1',
        medication_id: 'm1',
        status: 'snoozed',
        notification_id: 'n9',
      },
    ];
    const taken = [
      {
        medication_id: 'm1',
        scheduled_for: new Date(2026, 8, 23, 8, 0, 0).toISOString(),
      },
    ];
    const diff = diffReconcile(desired, existing, taken);
    assert.deepEqual(diff.toSchedule, []);
    assert.deepEqual(diff.toCancel, []);
    assert.equal(diff.skippedTaken, 1);
  });

  test('reconciliation is idempotent', () => {    const desired = [occ(), occ({ occurrenceId: 'm1|2026-09-23|20:00', scheduledTime: '20:00' })];
    const first = diffReconcile(desired, [], []);
    assert.equal(first.toSchedule.length, 2);
    // Second pass sees the first pass's rows as already scheduled.
    const scheduled = first.toSchedule.map((o) => ({
      occurrence_id: o.occurrenceId,
      medication_id: o.medicationId,
      status: 'scheduled',
      notification_id: 'n',
    }));
    const second = diffReconcile(desired, scheduled, []);
    assert.deepEqual(second.toSchedule, []);
    assert.deepEqual(second.toCancel, []);
  });

  test('scheduled rows without an OS id are retried, not trusted', () => {
    const desired = [occ()];
    const existing = [
      {
        occurrence_id: 'm1|2026-09-23|08:00',
        medication_id: 'm1',
        status: 'scheduled',
        notification_id: null,
      },
    ];
    const diff = diffReconcile(desired, existing, []);
    assert.deepEqual(
      diff.toSchedule.map((o) => o.occurrenceId),
      ['m1|2026-09-23|08:00'],
    );
    assert.deepEqual(diff.toCancel, []);
  });

  test('takenSlotKey parses local day+time, rejects garbage', () => {
    assert.equal(
      takenSlotKey({ scheduled_for: new Date(2026, 8, 23, 8, 0, 0).toISOString() }),
      '2026-09-23|08:00',
    );
    assert.equal(takenSlotKey({ scheduled_for: null }), null);
    assert.equal(takenSlotKey({ scheduled_for: 'not-a-date' }), null);
  });
});

describe('snooze mapping', () => {
  test('fixed options plus later-today and next-time', () => {
    const nowMs = new Date(2026, 8, 23, 8, 5, 0).getTime();
    const parent = { scheduledAt: new Date(2026, 8, 23, 8, 0, 0).toISOString(), medicationId: 'm1' };
    const future = [
      { medicationId: 'm1', scheduledAt: new Date(2026, 8, 23, 20, 0, 0).toISOString() },
      { medicationId: 'm2', scheduledAt: new Date(2026, 8, 23, 9, 0, 0).toISOString() },
    ];
    const opts = snoozeOptionsFor(parent, future, nowMs);
    assert.deepEqual(
      opts.map((o) => o.key),
      ['snooze-30', 'snooze-60', 'busy', 'later-today', 'next-time'],
    );
    assert.equal(opts[0].minutes, 30);
    assert.equal(opts[1].minutes, 60);
    assert.equal(opts[2].minutes, 120);
    assert.equal(opts[3].minutes, 240);
    // 08:05 -> 20:00 same med = 715 minutes.
    assert.equal(opts[4].minutes, 715);
  });

  test('next-time falls back to +6h with no future dose', () => {
    const parent = { scheduledAt: new Date(2026, 8, 23, 8, 0, 0).toISOString(), medicationId: 'm1' };
    const opts = snoozeOptionsFor(parent, [], new Date(2026, 8, 23, 8, 5, 0).getTime());
    assert.equal(opts[4].minutes, LATER_FALLBACK_MINUTES);
  });

  test('snooze chain ids increment and cap out', () => {
    const first = nextSnoozeOccurrence('m1|2026-09-23|08:00', 0, 30, new Date(2026, 8, 23, 8, 5, 0).getTime());
    assert.equal(first.occurrenceId, 'm1|2026-09-23|08:00::snooze1');
    assert.equal(first.snoozeCount, 1);
    assert.equal(first.scheduledTime, '08:35');
    assert.throws(
      () => nextSnoozeOccurrence('m1|2026-09-23|08:00', MAX_SNOOZE_COUNT, 30),
      /Snooze limit/,
    );
    assert.throws(() => nextSnoozeOccurrence('m1|2026-09-23|08:00', 0, 0), /out of range/);
    assert.throws(() => nextSnoozeOccurrence('m1|2026-09-23|08:00', 0, 9999), /out of range/);
  });
});

describe('tap contract (patient isolation)', () => {
  const data = {
    type: 'medication_reminder',
    patient_id: 'pat-A',
    medication_id: 'm1',
    occurrence_id: 'm1|2026-09-23|08:00',
    scheduled_at: new Date(2026, 8, 23, 8, 0, 0).toISOString(),
  };
  test('valid tap routes with the action', () => {
    assert.deepEqual(parseReminderTap(data, 'expo.modules.notifications.actions.DEFAULT', 'pat-A', 'expo.modules.notifications.actions.DEFAULT'), {
      patientId: 'pat-A',
      occurrenceId: 'm1|2026-09-23|08:00',
      action: 'open',
    });
    assert.equal(parseReminderTap(data, ACTION_TAKEN, 'pat-A', 'x')?.action, 'taken');
    assert.equal(parseReminderTap(data, ACTION_SNOOZE_30, 'pat-A', 'x')?.action, 'snooze-30');
    assert.equal(parseReminderTap(data, ACTION_SNOOZE_60, 'pat-A', 'x')?.action, 'snooze-60');
  });

  test("another patient's tap never routes", () => {
    assert.equal(parseReminderTap(data, 'x', 'pat-B', 'x'), null);
    assert.equal(parseReminderTap(data, 'x', null, 'x'), null);
  });

  test('foreign or malformed payloads never route', () => {
    assert.equal(parseReminderTap({ type: 'other' }, 'x', 'pat-A', 'x'), null);
    assert.equal(parseReminderTap(null, 'x', 'pat-A', 'x'), null);
    assert.equal(parseReminderTap({ ...data, occurrence_id: 42 }, 'x', 'pat-A', 'x'), null);
    assert.equal(parseReminderTap(data, 'unknown-action', 'pat-A', 'default'), null);
  });

  test('channel + category ids are stable', () => {
    assert.equal(REMINDER_CHANNEL_ID, 'medication-reminders');
    assert.equal(REMINDER_CATEGORY_ID, 'med-reminder');
  });
});

// ============================================================================
// reminder_instances queries (mock Db handle — SQL shape + guards)
// ============================================================================

function mockDb() {
  const calls: { sql: string; params: unknown[] }[] = [];
  return {
    calls,
    async runAsync(sql: string, ...params: unknown[]) {
      calls.push({ sql, params });
      return { changes: 1 };
    },
    async getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]> {
      calls.push({ sql, params });
      return [];
    },
    async getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null> {
      calls.push({ sql, params });
      return null;
    },
  };
}

describe('reminder_instances queries', () => {
  test('upsert validates status before touching the db', async () => {
    const db = mockDb();
    await assert.rejects(
      upsertReminderInstanceDb(db, {
        occurrence_id: 'o1',
        patient_id: 'pat-A',
        medication_id: 'm1',
        scheduled_at: new Date().toISOString(),
        scheduled_time: '08:00',
        status: 'bogus' as never,
        snooze_count: 0,
        parent_occurrence_id: null,
        notification_id: null,
      }),
      /Invalid reminder instance status/,
    );
    assert.equal(db.calls.length, 0);
    await assert.rejects(
      setReminderInstanceStatusDb(db, 'pat-A', 'o1', 'bogus' as never),
      /Invalid reminder instance status/,
    );
  });

  test('every statement is patient-scoped', async () => {
    const db = mockDb();
    await upsertReminderInstanceDb(db, {
      occurrence_id: 'o1',
      patient_id: 'pat-A',
      medication_id: 'm1',
      scheduled_at: new Date().toISOString(),
      scheduled_time: '08:00',
      status: 'scheduled',
      snooze_count: 0,
      parent_occurrence_id: null,
      notification_id: 'n1',
    });
    await listReminderInstancesFromDb(db, 'pat-A', new Date().toISOString());
    await getReminderInstanceDb(db, 'pat-A', 'o1');
    await setReminderInstanceStatusDb(db, 'pat-A', 'o1', 'taken');
    await pruneReminderInstancesDb(db, 'pat-A', new Date().toISOString());
    for (const call of db.calls) {
      assert.ok(call.sql.includes('patient_id'), `patient scope: ${call.sql.slice(0, 60)}`);
      assert.ok(call.params.includes('pat-A'), 'patient param bound');
    }
  });
});

// ============================================================================
// Migration 16 (needs node:sqlite — runs on node 22+)
// ============================================================================

describe('migration 16: reminder_instances table', () => {
  test('fresh migrate creates the device-only table with indexes', async () => {
    const db = makeDb();
    await runMigrations(db);
    assert.equal(await getSchemaVersion(db), CURRENT_SCHEMA_VERSION);
    const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(reminder_instances)`);
    const byName = new Set(cols.map((c) => c.name));
    for (const col of [
      'occurrence_id',
      'patient_id',
      'medication_id',
      'scheduled_at',
      'scheduled_time',
      'status',
      'snooze_count',
      'parent_occurrence_id',
      'notification_id',
      'created_at',
    ]) {
      assert.ok(byName.has(col), `reminder_instances missing column ${col}`);
    }
    const idx = await db.getAllAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'reminder_instances'`,
    );
    const idxNames = new Set(idx.map((r) => r.name));
    assert.ok(idxNames.has('ix_reminder_patient_time'), 'patient+time index');
    assert.ok(idxNames.has('ix_reminder_patient_med'), 'patient+med index');
    // Device-only: no sync_status column, no queue coupling.
    assert.ok(!byName.has('sync_status'), 'must stay device-only');
  });
});

// ============================================================================
// Wiring guards — RN-bound layers (repo precedent: text-level)
// ============================================================================

describe('batch 1 wiring', () => {
  test('mutation paths reconcile (save/edit/scan, pause, resume, stop)', () => {
    const meds = src('src/screens/Medications/MedicationsScreen.tsx');
    const hits = meds.match(/reconcileMedicationReminders\(patientId\)/g) ?? [];
    assert.ok(hits.length >= 4, `expected save+pause+resume+stop hooks, got ${hits.length}`);
  });

  test('reminder permission is requested at save intent only', () => {
    const meds = src('src/screens/Medications/MedicationsScreen.tsx');
    assert.ok(meds.includes('requestReminderPermissions'), 'permission wired to save');
    // Exactly one request site (inside the save handler) — never on mount.
    const sites = meds.match(/requestReminderPermissions\(\)/g) ?? [];
    assert.equal(sites.length, 1);
  });

  test('screen has three actions sharing one delay sheet', () => {
    const screen = src('src/screens/Medications/MedicationReminderScreen.tsx');
    assert.ok(screen.includes('Still not taken'), 'red action');
    assert.ok(screen.includes('Remind me later'), 'neutral launcher');
    assert.ok(screen.includes('Cancel — keep this reminder'), 'keep option');
    assert.ok(!screen.includes('MISSED'), 'never auto-missed');
    const schedule = src('src/services/medicationReminderSchedule.ts');
    assert.ok(schedule.includes('Remind me later today'), 'later-today option');
    assert.ok(schedule.includes('Remind me at the next suitable time'), 'next-time option');
  });

  test('taken flows through the existing event system', () => {
    const service = src('src/services/medicationReminders.ts');
    assert.ok(service.includes('recordMedicationTaken'), 'existing Taken path');
    assert.ok(service.includes("REMINDER_TAKEN_STATUS: DoseTakenStatus = 'TAKEN'"), 'existing status');
    assert.ok(!service.includes('clinical_event_id'), 'no parallel completion table');
  });

  test('taken dismisses the reminder and refreshes', () => {
    const service = src('src/services/medicationReminders.ts');
    assert.ok(service.includes('cancelReminderNotification(instance.notification_id)'), 'dismiss');
    assert.ok(service.includes("setReminderInstanceStatus(patientId, occurrenceId, 'taken')"), 'taken mark');
    assert.ok(service.includes('requestDataRefresh'), 'refresh signal');
  });

  test('snooze never mutates the recurring schedule', () => {
    const service = src('src/services/medicationReminders.ts');
    assert.ok(!service.includes('api.put'), 'no schedule PUT on snooze path');
    assert.ok(!service.includes('updateMedication'), 'no schedule mutation helper');
    assert.ok(service.includes('parent_occurrence_id'), 'chain linkage');
    assert.ok(service.includes('MAX_SNOOZE_COUNT'), 'bounded chains');
  });

  test('startup + foreground reconcile; logout + erase cancel', () => {
    const app = src('App.tsx');
    assert.ok(app.includes('reconcileMedicationReminders(patientId)'), 'startup/foreground');
    const auth = src('src/context/AuthContext.tsx');
    assert.ok(auth.includes('cancelAllPatientReminders'), 'logout cancels');
    const erase = src('src/db/queries/patientErase.ts');
    assert.ok(erase.includes('reminder_instances'), 'erase wipes instances');
    const deletion = src('src/services/deletion.ts');
    assert.ok(deletion.includes('cancelAllPatientReminders'), 'erase cancels OS rows');
  });

  test('reminder screen route + channel + category wired', () => {
    const types = src('src/types/index.ts');
    assert.ok(types.includes('MedicationReminder'), 'route typed');
    const app = src('App.tsx');
    assert.ok(app.includes('name="MedicationReminder"'), 'route registered');
    assert.ok(app.includes('ReminderBridge'), 'OS listeners mounted');
    const service = src('src/services/reminderNotifications.ts');
    assert.ok(service.includes('AndroidImportance.MAX'), 'max-importance channel');
    assert.ok(service.includes('AndroidAudioUsage.ALARM'), 'alarm audio usage');
    assert.ok(service.includes('setNotificationCategoryAsync'), 'action category');
  });

  test('no voice, scheduling-server or second-database dependencies', () => {
    const hay = [
      src('src/services/medicationReminders.ts'),
      src('src/services/medicationReminderSchedule.ts'),
      src('src/services/reminderNotifications.ts'),
      src('src/services/reminderContract.ts'),
      src('src/db/queries/reminderInstances.ts'),
      src('src/screens/Medications/MedicationReminderScreen.tsx'),
    ].join('\n').toLowerCase();
    for (const token of [
      'stt',
      'tts',
      'openrouter',
      'langgraph',
      'redis',
      'celery',
      'system_alert_window',
      'taskmanager',
      'backgroundfetch',
      'setinterval(',
      'settimeout(',
    ]) {
      assert.ok(!hay.includes(token), `forbidden dependency: ${token}`);
    }
  });

  test('Expo Go never touches native notification modules', () => {
    const wrapper = src('src/services/reminderNotifications.ts');
    assert.ok(wrapper.includes('isReminderRuntimeSupported'), 'runtime gate exists');
    assert.ok(wrapper.includes("appOwnership !== 'expo'"), 'Expo Go detected');
    for (const fn of [
      'ensureReminderChannel',
      'setReminderNotificationHandler',
      'requestReminderPermissions',
      'scheduleReminderNotification',
      'cancelReminderNotification',
      'listPatientScheduledNotifications',
    ]) {
      assert.ok(
        wrapper.includes(`export async function ${fn}`) ||
          wrapper.includes(`export function ${fn}`),
        `${fn} defined`,
      );
    }
    const meds = src('src/screens/Medications/MedicationsScreen.tsx');
    assert.ok(meds.includes('isReminderRuntimeSupported()'), 'save respects runtime');
  });

  test('expo-notifications is never statically imported (Expo Go safety)', () => {
    // The package runs push side effects at import time, which throws in
    // Expo Go. Every use must be lazy (dynamic import) past the runtime
    // gate, or type-only (fully erased).
    const files: Array<[string, string]> = [
      ['wrapper', src('src/services/reminderNotifications.ts')],
      ['bridge', src('App.tsx')],
    ];
    for (const [name, text] of files) {
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (
          trimmed.includes("from 'expo-notifications'") &&
          !trimmed.startsWith('import type') &&
          !trimmed.startsWith('* expo-notifications')
        ) {
          throw new Error(`${name}: static expo-notifications import: ${trimmed}`);
        }
      }
    }
    const wrapper = src('src/services/reminderNotifications.ts');
    assert.ok(wrapper.includes("await import('expo-notifications')"), 'lazy loading');
    assert.ok(wrapper.includes('isReminderRuntimeSupported'), 'runtime gate');
  });

  test('dev preview entry is stripped from production', () => {
    const meds = src('src/screens/Medications/MedicationsScreen.tsx');
    assert.ok(meds.includes('Preview reminder'), 'preview entry exists');
    assert.ok(meds.includes('__DEV__'), 'gated to development builds');
  });

  test('migration registered + app config carries permissions', () => {
    const mig = src('src/db/migrations.ts');
    assert.ok(mig.includes('reminder_instances'), 'migration 16 table');
    assert.ok(mig.includes('CURRENT_SCHEMA_VERSION = 18'), 'version bump');
    const config = src('app.json');
    assert.ok(config.includes('expo-notifications'), 'plugin registered');
    assert.ok(config.includes('POST_NOTIFICATIONS'), 'post permission');
    assert.ok(config.includes('SCHEDULE_EXACT_ALARM'), 'exact-alarm permission');
  });
});
