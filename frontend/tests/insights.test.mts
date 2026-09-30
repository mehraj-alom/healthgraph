/**
 * insights.test.mts — first-class Insights feed (node --experimental-strip-types).
 *
 * The curated feed is shared (not forked) between the dashboard preview
 * and the Insights screen. RN layers pinned by source-text contract.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('insights feed', () => {
  test('curation is shared, not forked', () => {
    const hook = src('src/screens/Dashboard/useCuratedFeed.ts');
    assert.ok(hook.includes('export function useCuratedFeed'), 'shared hook exported');
    const dash = src('src/screens/Dashboard/HealthDashboardScreen.tsx');
    assert.ok(dash.includes("from '@/screens/Dashboard/useCuratedFeed'"), 'dashboard uses shared hook');
    const insights = src('src/screens/Insights/InsightsScreen.tsx');
    assert.ok(insights.includes("from '@/screens/Dashboard/useCuratedFeed'"), 'insights uses shared hook');
    assert.ok(!dash.includes('function useCuratedFeed('), 'no local fork on dashboard');
  });

  test('dashboard previews three, insights shows all', () => {
    const dash = src('src/screens/Dashboard/HealthDashboardScreen.tsx');
    assert.ok(dash.includes('data={feed.slice(0, 3)}'), 'dashboard previews three');
    assert.ok(dash.includes("navigate('Insights')"), 'see-all entry point');
    const insights = src('src/screens/Insights/InsightsScreen.tsx');
    assert.ok(insights.includes('data={visibleFeed}'), 'insights renders the full curated feed');
  });

  test('route typed, registered, reachable', () => {
    const types = src('src/types/index.ts');
    assert.ok(types.includes('Insights:'), 'route typed');
    const app = src('App.tsx');
    assert.ok(app.includes('name="Insights"'), 'route registered');
    assert.ok(app.includes('InsightsScreen'), 'screen wired');
  });

  test('verdicts labeled, honest empty state, no synthetic copy', () => {
    const screen = src('src/screens/Insights/InsightsScreen.tsx');
    assert.ok(screen.includes('verdictLabel'), 'verdicts labeled per card');
    assert.ok(screen.includes('No insights yet'), 'honest empty state');
    assert.ok(!screen.includes('fetch('), 'no network calls outside hooks');
    const lower = screen.toLowerCase();
    for (const phrase of ['because you', 'caused your', 'will improve', 'prescrib']) {
      assert.ok(!lower.includes(phrase), phrase);
    }
  });
});
