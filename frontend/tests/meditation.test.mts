/**
 * meditation.test.mts — Meditation engine (node --experimental-strip-types).
 *
 * Bell-timed sits, device-only: pure input math runs directly
 * (queries/meditation.ts and meditationReminderPlan.ts are zero-import),
 * migration 22 runs against a real in-memory SQLite database via the
 * Node built-in test runner and `node:sqlite` — zero new npm dependencies.
 * RN-bound layers (screen, reminder wiring, nav registration) are pinned
 * by source-text contract. Absences (no guided content, no outcomes, no
 * sync, no backend) are tested as absences.
 *
 * Run:
 *   node --experimental-sqlite --experimental-strip-types --test frontend/tests/meditation.test.mts
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import {
  MEDITATION_PRESETS,
  deleteMeditationSessionDb,
  insertMeditationSessionDb,
  isMeditationPreset,
  listMeditationDaysDb,
  listMeditationSessionsDb,
  normalizeMeditationInput,
  summarizeMeditation,
  summarizeMeditationWeek,
  type MeditationDb,
  type MeditationSession,
} from '../src/db/queries/meditation.ts';
import {
  CURRENT_SCHEMA_VERSION,
  getMissingTables,
  runMigrations,
} from '../src/db/migrations.ts';
import {
  DEFAULT_MEDITATION_REMINDER_TIME,
  MEDITATION_REMINDER_STORAGE_KEY,
  describeMeditationReminder,
  normalizeMeditationReminderState,
  validateMeditationReminderTime,
} from '../src/services/meditationReminderPlan.ts';
import { ENGINE_IDS, ENGINES } from '../src/screens/HealthAreas/engines.ts';
import {
  areaRouteName,
  buildHealthAreas,
} from '../src/screens/HealthAreas/areas.ts';
import { FOCUS_AREAS } from '../src/screens/Onboarding/options.ts';
import { collectActiveDates } from '../src/screens/DisciplineEngine/disciplineEngine.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** Minimal async facade over node:sqlite (same shape as migrations.test.mts). */
function makeDb(): MeditationDb & {
  withTransactionAsync(fn: () => Promise<void>): Promise<void>;
} {
  const s = new DatabaseSync(':memory:');
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
    async getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null> {
      const r = s.prepare(sql).get(...(flat(params) as unknown[])) as T | undefined;
      return r ?? null;
    },
    async getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]> {
      return s.prepare(sql).all(...(flat(params) as unknown[])) as T[];
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
  };
}

const SIT = {
  preset_min: 10,
  duration_sec: 600,
  started_at: '2026-10-14T08:00:00.000Z',
  ended_at: '2026-10-14T08:10:00.000Z',
  completed: true,
  notes: 'quiet morning',
};

// ============================================================================
// Input validation — pure
// ============================================================================

describe('meditation input validation', () => {
  test('valid sit normalizes (note trimmed)', () => {
    const clean = normalizeMeditationInput({ ...SIT, notes: '  quiet morning  ' });
    assert.equal(clean.preset_min, 10);
    assert.equal(clean.duration_sec, 600);
    assert.equal(clean.completed, true);
    assert.equal(clean.notes, 'quiet morning');
  });

  test('only 5/10/15/20 presets accepted', () => {
    for (const p of MEDITATION_PRESETS) assert.ok(isMeditationPreset(p));
    assert.equal(isMeditationPreset(7), false);
    assert.throws(() => normalizeMeditationInput({ ...SIT, preset_min: 7 }));
  });

  test('non-positive duration rejected', () => {
    assert.throws(() => normalizeMeditationInput({ ...SIT, duration_sec: 0 }));
    assert.throws(() => normalizeMeditationInput({ ...SIT, duration_sec: -5 }));
  });

  test('bad or inverted timestamps rejected', () => {
    assert.throws(() => normalizeMeditationInput({ ...SIT, started_at: 'nope' }));
    assert.throws(() =>
      normalizeMeditationInput({
        ...SIT,
        started_at: '2026-10-14T08:10:00.000Z',
        ended_at: '2026-10-14T08:00:00.000Z',
      }),
    );
  });

  test('blank note normalizes to null', () => {
    assert.equal(normalizeMeditationInput({ ...SIT, notes: '   ' }).notes, null);
  });
});

// ============================================================================
// Summaries — pure, descriptive only
// ============================================================================

describe('meditation summaries', () => {
  const rows = (over: Partial<MeditationSession>[]): MeditationSession[] =>
    over.map((o, i) => ({
      entry_id: `e${i}`,
      patient_id: 'p1',
      preset_min: 10,
      duration_sec: 600,
      started_at: '2026-10-14T08:00:00.000Z',
      ended_at: '2026-10-14T08:10:00.000Z',
      completed: 1,
      notes: null,
      created_at: '2026-10-14T08:10:00.000Z',
      ...o,
    }));

  test('totals count completed sits only', () => {
    const t = summarizeMeditation(
      rows([{ completed: 1 }, { completed: 0, duration_sec: 120 }]),
    );
    assert.equal(t.sessions, 2);
    assert.equal(t.completedSessions, 1);
    assert.equal(t.minutes, 10);
  });

  test('week strip is 7 ascending days with per-day counts', () => {
    const week = summarizeMeditationWeek(
      rows([
        { started_at: '2026-10-14T08:00:00.000Z', completed: 1 },
        { started_at: '2026-10-14T19:00:00.000Z', completed: 1 },
        { started_at: '2026-10-12T08:00:00.000Z', completed: 1 },
        { started_at: '2026-10-11T08:00:00.000Z', completed: 0 },
      ]),
      '2026-10-14',
    );
    assert.equal(week.length, 7);
    assert.equal(week[6]?.date, '2026-10-14');
    assert.equal(week[6]?.count, 2);
    assert.equal(week[4]?.date, '2026-10-12');
    assert.equal(week[4]?.count, 1);
    assert.equal(week[3]?.count, 0);
  });
});

// ============================================================================
// Reminder plan — pure
// ============================================================================

describe('meditation reminder plan', () => {
  test('default is 08:00 off; key is versioned', () => {
    assert.deepEqual(DEFAULT_MEDITATION_REMINDER_TIME, { hour: 8, minute: 0 });
    assert.ok(MEDITATION_REMINDER_STORAGE_KEY.startsWith('hg:meditation-reminder:'));
  });

  test('time validates strictly', () => {
    assert.equal(validateMeditationReminderTime(8, 0).ok, true);
    assert.equal(validateMeditationReminderTime(24, 0).ok, false);
    assert.equal(validateMeditationReminderTime(8, 60).ok, false);
    assert.equal(validateMeditationReminderTime('8', 0).ok, false);
  });

  test('corrupt stored state resolves to off, never a surprise alarm', () => {
    for (const raw of [null, undefined, 42, 'on', [], { enabled: true }]) {
      assert.equal(normalizeMeditationReminderState(raw).enabled, false);
    }
    assert.deepEqual(normalizeMeditationReminderState({ enabled: true, hour: 8, minute: 0 }), {
      enabled: true,
      hour: 8,
      minute: 0,
    });
  });

  test('status line is descriptive, promise-free', () => {
    assert.equal(
      describeMeditationReminder({ enabled: false, hour: 8, minute: 0 }),
      'Practice reminder off.',
    );
    assert.equal(
      describeMeditationReminder({ enabled: true, hour: 8, minute: 0 }),
      'Practice reminder daily at 08:00.',
    );
  });
});

// ============================================================================
// Registration — engines, areas, onboarding, discipline
// ============================================================================

describe('meditation registration', () => {
  test('engine catalog entry with destination', () => {
    assert.ok((ENGINE_IDS as readonly string[]).includes('meditation'));
    assert.equal(ENGINES.meditation.route?.name, 'MeditationEngine');
    assert.ok(ENGINES.meditation.title.length > 0);
    assert.ok(ENGINES.meditation.description.length > 0);
    assert.ok(ENGINES.meditation.glyph.length > 0);
  });

  test('hub area routes to the engine and reports device provenance', () => {
    assert.equal(areaRouteName('meditation'), 'MeditationEngine');
    const base = {
      heartBpm: null,
      serverHeartBpm: null,
      loggedDays: 0,
      activeMedications: 0,
      documentCount: 0,
      substanceEntries: 0,
      cycleEntries: 0,
      profileWeightKg: null,
      activeDays7: 0,
      activitySessions7: 0,
      nutritionMeals7: 0,
      wellbeingDays7: 0,
      meditationSessions7: 0,
    };
    const empty = buildHealthAreas(base).find((a) => a.id === 'meditation');
    assert.deepEqual([empty?.status, empty?.source], ['no-data', 'none']);
    const filled = buildHealthAreas({ ...base, meditationSessions7: 3 }).find(
      (a) => a.id === 'meditation',
    );
    assert.deepEqual([filled?.status, filled?.source], ['available', 'device']);
    assert.ok(filled?.headline.includes('3'), 'real count shown');
    assert.equal(filled?.detail, 'On this device only');
  });

  test('focus catalog covers the new engine (no drift)', () => {
    assert.ok(FOCUS_AREAS.some((o) => o.id === 'meditation'));
  });

  test('meditation days join the discipline union', () => {
    const days = collectActiveDates({
      logDates: [],
      takenInstants: [],
      substanceDates: [],
      cycleDates: [],
      heartDates: [],
      meditationDates: ['2026-10-14'],
    });
    assert.ok(days.has('2026-10-14'));
  });

  test('route is typed and registered', () => {
    const types = src('src/types/index.ts');
    assert.ok(types.includes('MeditationEngine:'), 'route typed');
    const app = src('App.tsx');
    assert.ok(app.includes('name="MeditationEngine"'), 'route registered');
    assert.ok(app.includes('MeditationScreen'), 'screen wired');
  });
});

// ============================================================================
// Migration 22 + storage round-trip — real sqlite
// ============================================================================

describe('meditation storage', () => {
  test('schema version is 22 and the table exists after fresh migrate', async () => {
    assert.equal(CURRENT_SCHEMA_VERSION, 22);
    const db = makeDb();
    await runMigrations(db as never);
    assert.deepEqual(await getMissingTables(db as never), []);
    const tables = await db.getAllAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meditation_sessions'`,
    );
    assert.equal(tables.length, 1);
    const cols = await db.getAllAsync<{ name: string }>(
      `SELECT name FROM pragma_table_info('meditation_sessions')`,
    );
    const names = new Set(cols.map((c) => c.name));
    for (const c of [
      'entry_id',
      'patient_id',
      'preset_min',
      'duration_sec',
      'started_at',
      'ended_at',
      'completed',
      'notes',
    ]) {
      assert.ok(names.has(c), `column ${c}`);
    }
  });

  test('insert → list → days → delete round-trip is patient-scoped', async () => {
    const db = makeDb();
    await runMigrations(db as never);
    const id = await insertMeditationSessionDb(db, 'p1', normalizeMeditationInput(SIT));
    assert.ok(typeof id === 'string' && id.length > 0);
    await insertMeditationSessionDb(db, 'p2', normalizeMeditationInput(SIT));
    const mine = await listMeditationSessionsDb(db, 'p1', 200);
    assert.equal(mine.length, 1);
    assert.equal(mine[0]?.preset_min, 10);
    assert.deepEqual(await listMeditationDaysDb(db, 'p1', 200), ['2026-10-14']);
    assert.deepEqual(await listMeditationDaysDb(db, 'p2', 200), ['2026-10-14']);
    await deleteMeditationSessionDb(db, 'p1', id);
    assert.equal((await listMeditationSessionsDb(db, 'p1', 200)).length, 0);
    // Other patient's row untouched.
    assert.equal((await listMeditationSessionsDb(db, 'p2', 200)).length, 1);
  });
});

// ============================================================================
// RN-bound layers — source-text contracts + absences
// ============================================================================

describe('meditation wiring contracts', () => {
  test('screen uses shared bell asset, no new audio', () => {
    const screen = src('src/screens/Meditation/MeditationScreen.tsx');
    assert.ok(screen.includes('RINGTONE_ASSET'), 'shared chime');
    assert.ok(screen.includes('useAudioPlayer'), 'expo-audio');
    assert.ok(!screen.includes('expo-av'), 'no new audio dep');
  });

  test('reminder wiring is a daily nudge, off by default', () => {
    const wiring = src('src/services/meditationReminders.ts');
    assert.ok(wiring.includes('meditation-reminder'), 'own payload kind');
    assert.ok(wiring.includes('DAILY'), 'daily trigger');
    assert.ok(wiring.includes('isReminderRuntimeSupported'), 'runtime gate');
    assert.ok(wiring.includes("await import('expo-notifications')"), 'lazy loading');
  });

  test('absences: no guided content, no outcomes, no sync, no backend', () => {
    // Note: the tracking-only disclaimer itself names diagnosis/treatment
    // as things this screen is NOT — so pin outcome language instead.
    const screen = src('src/screens/Meditation/MeditationScreen.tsx').toLowerCase();
    for (const word of ['prescrib', 'anxiety', 'depress', 'therapy', 'symptom checker', 'reduces stress']) {
      assert.ok(!screen.includes(word), `screen: ${word}`);
    }
    const queries = src('src/db/queries/meditation.ts');
    assert.ok(!queries.includes('sync_status TEXT'), 'no sync column');
    assert.ok(!queries.includes('sync_queue'), 'no queue rows');
    for (const f of [
      'src/screens/Meditation/MeditationScreen.tsx',
      'src/db/queries/meditation.ts',
      'src/services/meditationReminders.ts',
      'src/services/meditationReminderPlan.ts',
    ]) {
      assert.ok(!src(f).includes('Streak'), 'no streak language in v1');
    }
  });
});
