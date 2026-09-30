/**
 * batchPriority.test.mts — Priority presentation layer (node --experimental-strip-types).
 *
 * Priority derives from the Batch 6A activeEngines system: the pure
 * priorityLayer contract runs directly (zero-import); exposure
 * persistence is exercised through the onboarding Db seam with an
 * in-memory handle; RN-bound layers (card, hooks, dashboard, settings,
 * animation) are pinned by source-text contract.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MAX_PRIORITY_EXPOSURES,
  PRIORITY_ENGINES,
  buildPriority,
  formatPriorityNames,
  introCopy,
  introDayNumber,
  shouldShowPriorityIntro,
} from '../src/screens/Priority/priorityLayer.ts';
import {
  deriveActiveEngines,
  ENGINES,
} from '../src/screens/HealthAreas/engines.ts';
import {
  queryPriorityIntroDb,
  recordPriorityIntroDb,
} from '../src/db/queries/onboarding.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const TODAY = '2026-09-21';
const YESTERDAY = '2026-09-20';

// In-memory OnboardingDb handle (mirrors the migration-14 schema).
function makeDb(rows: Record<string, unknown> = {}) {
  const store = new Map<string, Record<string, unknown>>(Object.entries(rows));
  return {
    store,
    async getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null> {
      void sql;
      return (store.get(String(params[0])) ?? null) as T | null;
    },
    async runAsync(sql: string, ...params: unknown[]): Promise<unknown> {
      void sql;
      // UPDATE onboarding_state SET count=?, last_date=?, ... WHERE patient_id=?
      const row = store.get(String(params[2]));
      if (row) {
        row.priority_intro_count = params[0];
        row.priority_intro_last_date = params[1];
      }
      return undefined;
    },
    async getAllAsync<T>(): Promise<T[]> {
      return [];
    },
  };
}

const ROW = (overrides: Record<string, unknown> = {}) => ({
  completed: 1,
  priority_intro_count: 0,
  priority_intro_last_date: null,
  ...overrides,
});

// ============================================================================
// Priority derivation — all seven engines, catalog order, no second truth
// ============================================================================

describe('priority derivation', () => {
  test('engine list matches the 6A catalog (no drift)', () => {
    assert.deepEqual(
      PRIORITY_ENGINES.map((e) => e.id),
      ['sleep', 'weight', 'discipline', 'fitness', 'nutrition', 'wellbeing', 'heart'],
    );
    for (const entry of PRIORITY_ENGINES) {
      assert.equal(entry.title, ENGINES[entry.id as keyof typeof ENGINES].title);
    }
  });

  test('0 engines → empty (honest empty state, never placeholders)', () => {
    assert.deepEqual(buildPriority([]), []);
    assert.deepEqual(buildPriority(null), []);
    assert.deepEqual(buildPriority(undefined), []);
    assert.equal(formatPriorityNames([]), '');
  });

  test('1 engine works', () => {
    assert.deepEqual(buildPriority(['sleep']), [{ id: 'sleep', title: 'Sleep better' }]);
  });

  test('2–7 engines stay combined in catalog order (not input order)', () => {
    assert.deepEqual(
      buildPriority(['heart', 'sleep']).map((e) => e.id),
      ['sleep', 'heart'],
    );
    assert.deepEqual(
      buildPriority(['nutrition', 'fitness', 'sleep']).map((e) => e.id),
      ['sleep', 'fitness', 'nutrition'],
    );
    assert.deepEqual(
      buildPriority(['heart', 'wellbeing', 'nutrition', 'fitness', 'discipline', 'weight', 'sleep']).map(
        (e) => e.id,
      ),
      ['sleep', 'weight', 'discipline', 'fitness', 'nutrition', 'wellbeing', 'heart'],
    );
  });

  test('duplicates collapse; unknowns and legacy ids drop out', () => {
    assert.deepEqual(
      buildPriority(['sleep', 'sleep', 'bogus', 'movement', 'records-clarity']).map((e) => e.id),
      ['sleep'],
    );
  });

  test('no engine disappears because another was selected (7 max)', () => {
    const all = ['sleep', 'weight', 'discipline', 'fitness', 'nutrition', 'wellbeing', 'heart'];
    assert.equal(buildPriority(all).length, 7);
    assert.equal(formatPriorityNames(buildPriority(['sleep', 'nutrition', 'fitness'])).split(' · ').length, 3);
  });

  test('priority follows the 6A pipeline end to end', () => {
    const active = deriveActiveEngines(['heart', 'sleep', 'nope']).map((e) => e.id);
    assert.deepEqual(
      buildPriority(active).map((e) => e.id),
      ['sleep', 'heart'],
    );
  });
});

// ============================================================================
// Exposure rule — three lifetime showings, one per calendar day
// ============================================================================

describe('three-exposure rule', () => {
  test('cap is exactly three', () => {
    assert.equal(MAX_PRIORITY_EXPOSURES, 3);
  });

  test('fresh user (0, never shown) is eligible', () => {
    assert.equal(
      shouldShowPriorityIntro({ completed: true, count: 0, lastDate: null, today: TODAY }),
      true,
    );
  });

  test('incomplete onboarding is never eligible', () => {
    assert.equal(
      shouldShowPriorityIntro({ completed: false, count: 0, lastDate: null, today: TODAY }),
      false,
    );
  });

  test('first eligible day → exposure 1; same day never re-shows', () => {
    assert.equal(
      shouldShowPriorityIntro({ completed: true, count: 0, lastDate: YESTERDAY, today: TODAY }),
      true,
    );
    assert.equal(
      shouldShowPriorityIntro({ completed: true, count: 1, lastDate: TODAY, today: TODAY }),
      false,
    );
  });

  test('second day → 2, third day → 3, fourth day → never', () => {
    assert.equal(
      shouldShowPriorityIntro({ completed: true, count: 1, lastDate: YESTERDAY, today: TODAY }),
      true,
    );
    assert.equal(
      shouldShowPriorityIntro({ completed: true, count: 2, lastDate: YESTERDAY, today: TODAY }),
      true,
    );
    assert.equal(
      shouldShowPriorityIntro({ completed: true, count: 3, lastDate: YESTERDAY, today: TODAY }),
      false,
    );
    assert.equal(
      shouldShowPriorityIntro({ completed: true, count: 3, lastDate: null, today: TODAY }),
      false,
    );
  });

  test('day numbers progress 1 → 2 → 3 and clamp', () => {
    assert.equal(introDayNumber(0), 1);
    assert.equal(introDayNumber(1), 2);
    assert.equal(introDayNumber(2), 3);
    assert.equal(introDayNumber(3), 3);
    assert.equal(introDayNumber(99), 3);
  });

  test('day-specific copy progresses (never a repeated popup)', () => {
    const c1 = introCopy(1);
    const c2 = introCopy(2);
    const c3 = introCopy(3);
    assert.notEqual(c1.headline, c2.headline);
    assert.notEqual(c2.headline, c3.headline);
    for (const copy of [c1, c2, c3]) {
      assert.ok(copy.headline.length > 0 && copy.body.length > 0 && copy.cta.length > 0);
    }
  });
});

// ============================================================================
// Exposure persistence — patient-scoped, capped, day-stamped
// ============================================================================

describe('exposure persistence', () => {
  test('missing row yields zero state (never crashes)', async () => {
    const db = makeDb();
    assert.deepEqual(await queryPriorityIntroDb(db, 'pat-A'), {
      completed: false,
      count: 0,
      lastDate: null,
    });
  });

  test('record → read round-trips count and date', async () => {
    const db = makeDb({ 'pat-A': ROW() });
    await recordPriorityIntroDb(db, 'pat-A', 1, TODAY);
    assert.deepEqual(await queryPriorityIntroDb(db, 'pat-A'), {
      completed: true,
      count: 1,
      lastDate: TODAY,
    });
  });

  test('count never exceeds 3 (clamped on read and write)', async () => {
    const db = makeDb({ 'pat-A': ROW({ priority_intro_count: 99 }) });
    assert.equal((await queryPriorityIntroDb(db, 'pat-A')).count, 3);
    await recordPriorityIntroDb(db, 'pat-A', 99, TODAY);
    assert.equal((await queryPriorityIntroDb(db, 'pat-A')).count, 3);
  });

  test('recording touches only exposure columns (goals/focus/completion intact)', async () => {
    const db = makeDb({
      'pat-A': { ...ROW(), goals_json: '["sleep"]', focus_json: '["sleep"]', completed: 1 },
    });
    await recordPriorityIntroDb(db, 'pat-A', 2, TODAY);
    const row = db.store.get('pat-A')!;
    assert.equal(row.goals_json, '["sleep"]');
    assert.equal(row.focus_json, '["sleep"]');
    assert.equal(row.completed, 1);
  });

  test('patient isolation (logout/login never leaks exposures)', async () => {
    const db = makeDb({ 'pat-A': ROW(), 'pat-B': ROW() });
    await recordPriorityIntroDb(db, 'pat-A', 3, TODAY);
    assert.equal((await queryPriorityIntroDb(db, 'pat-B')).count, 0);
    assert.equal((await queryPriorityIntroDb(db, 'pat-B')).lastDate, null);
  });

  test('exposure lives on the onboarding row (wiped with the patient)', () => {
    const erase = src('src/db/queries/patientErase.ts');
    assert.ok(erase.includes("'onboarding_state'"), 'row wiped wholesale');
    const migrations = src('src/db/migrations.ts');
    assert.ok(migrations.includes('priority_intro_count'), 'counter column exists');
    assert.ok(migrations.includes('priority_intro_last_date'), 'last-date column exists');
  });

  test('grandfathered users start at exposure 1 (completion row pre-exists)', async () => {
    // Gate writes completed=1 for established users before Dashboard can
    // mount — the intro then treats them like Day-1 users, not blocked ones.
    const db = makeDb({ 'pat-old': ROW({ priority_intro_count: 0 }) });
    const exposure = await queryPriorityIntroDb(db, 'pat-old');
    assert.equal(
      shouldShowPriorityIntro({ ...exposure, today: TODAY }),
      true,
    );
  });
});

// ============================================================================
// Wiring guards — RN-bound layers pinned by contract
// ============================================================================

describe('priority wiring', () => {
  test('no second source of truth (single derivation point)', () => {
    const layer = src('src/screens/Priority/priorityLayer.ts');
    assert.ok(!layer.includes('AsyncStorage'), 'no side store');
    assert.ok(!layer.includes('fetch('), 'no backend truth');
    const hook = src('src/hooks/usePriority.ts');
    assert.ok(hook.includes('useOnboardingState'), 'reads 6A state');
    assert.ok(hook.includes('buildPriority'), 'single derivation');
  });

  test('dashboard keeps Priority out of the feed (P button only)', () => {
    const dash = src('src/screens/Dashboard/HealthDashboardScreen.tsx');
    assert.ok(!dash.includes('<PriorityCard'), 'no feed card');
    assert.ok(dash.includes('PriorityIntroCard'), 'intro mounted');
    assert.ok(dash.includes('usePriorityIntro'), 'exposure hook mounted');
  });

  test('header Priority button guides to Health Areas (the Priority view)', () => {
    const dash = src('src/screens/Dashboard/HealthDashboardScreen.tsx');
    assert.ok(dash.includes('onPriorityPress'), 'header button wired');
    assert.ok(dash.includes("navigate('HealthAreas')"), 'button leads to pinned engines');
    assert.ok(dash.includes('headerPriority'), 'orange P chrome present');
  });

  test('drawer Explore list hosts its destinations (single home, no timers)', () => {
    const drawer = src('src/components/ProfileSheet.tsx');
    // Single home each: Medications + My Priorities live here; the two
    // compact Settings shortcuts are NOT duplicated in the drawer.
    for (const title of ['Medications', 'My Priorities']) {
      assert.ok(drawer.includes(title), `drawer hosts ${title}`);
    }
    for (const title of ['Goals & focus areas', 'Health Areas']) {
      assert.ok(!drawer.includes(title), `${title} not duplicated in drawer`);
    }
    // Gone from Settings as full rows (single home in the drawer); two
    // compact deliberate-change shortcuts remain.
    const settings = src('src/screens/Settings/SettingsScreen.tsx');
    for (const title of ['Medications', 'My Priorities']) {
      assert.ok(!settings.includes(`>${title}<`), `${title} removed from settings`);
    }
    assert.ok(settings.includes('Goals & focus areas'), 'compact goals shortcut remains');
    assert.ok(settings.includes('Health areas'), 'compact areas shortcut remains');
    // Post-redesign drawer (frosted-glass skill pass): destinations are
    // declared once in EXPLORE_FEATURES and rendered as data-driven NavRow
    // rows through a single go() dispatch — no per-destination handlers.
    assert.ok(drawer.includes('EXPLORE_FEATURES'), 'destinations declared once');
    assert.ok(drawer.includes("{ title: 'Medications', route: 'Medications' }"), 'medications destination');
    assert.ok(drawer.includes("{ title: 'My Priorities', route: 'Priority' }"), 'my priorities opens its world');
    assert.ok(drawer.includes('NavRow'), 'rows render the destinations');
    assert.ok(drawer.includes('go(f.route'), 'single dispatch for all rows');
    assert.ok(drawer.includes('useReducedMotion'), 'reduced-motion path');
    assert.ok(!drawer.includes('setInterval') && !drawer.includes('setTimeout'), 'no timers');
  });

  test('Priority world is typed, registered, and composes existing contracts', () => {
    const types = src('src/types/index.ts');
    assert.ok(types.includes('Priority:'), 'route typed');
    const app = src('App.tsx');
    assert.ok(app.includes('name="Priority"'), 'route registered');
    assert.ok(app.includes('PriorityWorldScreen'), 'screen wired');
    const world = src('src/screens/Priority/PriorityWorldScreen.tsx');
    assert.ok(world.includes('useDialMetrics'), 'shared dial pipeline (no fork)');
    assert.ok(world.includes('HGraphMap'), 'own dial');
    assert.ok(world.includes("navigate('Improve'"), 'improve/keep window');
    assert.ok(world.includes('CorrelationGraphCard'), 'time-vs-correlations preview');
    assert.ok(world.includes('ENGINES['), 'engine destinations from the catalog');
    assert.ok(world.includes("navigate('OnboardingSetup')"), 'edit priorities path');
    assert.ok(world.includes("navigate('HealthGraph'"), 'full graph link');
    assert.ok(!world.includes('describeChange') && !world.includes('summarize'), 'no new health math');
  });

  test('intro CTA leads to Settings (profile destination)', () => {
    const dash = src('src/screens/Dashboard/HealthDashboardScreen.tsx');
    assert.ok(dash.includes("navigate('Settings')"), 'CTA destination is Settings');
    const card = src('src/screens/Priority/PriorityIntroCard.tsx');
    assert.ok(card.includes('onDone'), 'animated CTA completion path');
    assert.ok(card.includes('onDismiss'), 'dismiss path without navigation');
  });

  test('animation uses existing infra, honors reduced motion, leaks nothing', () => {
    const card = src('src/screens/Priority/PriorityIntroCard.tsx');
    assert.ok(card.includes('react-native-reanimated'), 'existing animation system');
    assert.ok(card.includes('useReducedMotion'), 'reduced-motion path');
    assert.ok(!card.includes('setInterval') && !card.includes('setTimeout'), 'no timers');
    assert.ok(!card.includes('addEventListener'), 'no listeners');
    assert.ok(!card.includes('Animated.') || card.includes('Animated.View'), 'reanimated views only');
  });

  test('no engine calculation contracts were modified', () => {
    for (const id of ['sleep', 'weight', 'discipline', 'fitness', 'nutrition', 'wellbeing', 'heart']) {
      const name = `${id[0].toUpperCase()}${id.slice(1)}`;
      const mod = src(`src/screens/${name}Engine/${id}Engine.ts`);
      assert.ok(!mod.toLowerCase().includes('priority'), `${id}: engine untouched by Priority`);
    }
  });

  test('no Priority score, graph nodes, or health metric duplication', () => {
    const hay = [
      src('src/screens/Priority/priorityLayer.ts'),
      src('src/screens/Priority/PriorityCard.tsx'),
      src('src/screens/Priority/PriorityIntroCard.tsx'),
      src('src/hooks/usePriority.ts'),
      src('src/hooks/usePriorityIntro.ts'),
    ].join('\n');
    assert.ok(!hay.toLowerCase().includes('priority score'), 'no priority score');
    assert.ok(!hay.includes('describeChange') && !hay.includes('summarize'), 'no engine math duplicated');
  });

  test('no fabricated values, medical, or causal claims in Priority copy', () => {
    const hay = [
      src('src/screens/Priority/priorityLayer.ts'),
      src('src/screens/Priority/PriorityCard.tsx'),
      src('src/screens/Priority/PriorityIntroCard.tsx'),
    ]
      .join('\n')
      .toLowerCase();
    for (const phrase of [
      'will improve',
      'healthier',
      'treatment',
      'prescrib',
      'diagnos',
      'caused your',
      'because you',
      'you will lose',
    ]) {
      assert.ok(!hay.includes(phrase), phrase);
    }
  });

  test('no new table, no graph nodes, no backend field for Priority', () => {
    const migrations = src('src/db/migrations.ts');
    assert.ok(!migrations.toLowerCase().includes('priority_state'), 'no new table');
    const graph = src('src/screens/Body/HealthGraphScreen.tsx');
    assert.ok(!graph.toLowerCase().includes('priority'), 'no graph nodes');
  });
});

describe('priority log (check-in shortcuts)', () => {
  test('Priority log replaces fixed Quick buttons with engine-driven chips', () => {
    const log = src('src/screens/VitalsLogger/VitalsLoggerScreen.tsx');
    assert.ok(log.includes('Priority log'), 'priority card present');
    assert.ok(log.includes('usePriority'), 'driven by chosen engines');
    // Fixed shortcuts.
    assert.ok(log.includes("label: 'Stress'") || log.includes("label: 'Stress',"), 'stress fixed');
    // Engine-conditional shortcuts.
    for (const id of ['sleep', 'nutrition', 'fitness', 'wellbeing', 'weight', 'discipline', 'heart']) {
      assert.ok(log.includes(`priorityIds.has('${id}')`), `${id} conditional`);
    }
    // Scroll-to-section wiring (no dead targets).
    assert.ok(log.includes('scrollToSection'), 'scroll helper present');
    assert.ok(log.includes('recordSectionY'), 'section offsets recorded');
    for (const target of ['essentials', 'sleep', 'activity', 'nutrition', 'vitals', 'feel']) {
      assert.ok(log.includes(`recordSectionY('${target}')`), `${target} target mounted`);
    }
    // Old fixed Quick buttons are gone.
    assert.ok(!log.includes('Quick: Pulse'), 'no fixed pulse button');
    assert.ok(!log.includes('Quick: Glucose'), 'no fixed glucose button');
    assert.ok(!log.includes('Quick: Fever'), 'no fixed fever button');
    assert.ok(!log.includes('quickAddSymptom'), 'fever-only helper removed');
  });
});
