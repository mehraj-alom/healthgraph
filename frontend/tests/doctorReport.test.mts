/**
 * doctorReport.test.mts — doctor-report HTML builder (node --experimental-strip-types).
 *
 * Pure builder runs directly (doctorReportHtml.ts is zero-import). Core
 * properties: every value escaped, honest empty states, null when there
 * is nothing to report. Wiring: route typed/registered, Settings entry,
 * no network or backend dependency (device-only by design).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildReportHtml,
  esc,
  type ReportInput,
} from '../src/services/doctorReportHtml.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const FULL: ReportInput = {
  generatedAt: 'Sep 30, 2026',
  windowDays: 30,
  patientName: 'Test Patient',
  meds: [
    { name: 'Amoxicillin', detail: '500 mg · twice daily', adherence: 87, status: 'ACTIVE' },
    { name: 'Vitamin D', detail: null, adherence: null, status: 'ACTIVE' },
  ],
  observations: [{ title: 'Knee pain', sub: 'mild' }],
  sleep: { nights: 21, avgMinutes: 452 },
  weight: { startKg: 82, endKg: 79.5, changeKg: -2.5 },
};

describe('esc', () => {
  test('neutralizes markup in every position', () => {
    assert.equal(esc('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
    assert.equal(esc('"quoted" & \'apos\''), '&quot;quoted&quot; &amp; &#39;apos&#39;');
    assert.equal(esc(null), '');
    assert.equal(esc(undefined), '');
  });
});

describe('buildReportHtml', () => {
  test('renders all sections with values', () => {
    const html = buildReportHtml(FULL);
    assert.ok(html);
    assert.ok(html.includes('Amoxicillin'));
    assert.ok(html.includes('87%'));
    assert.ok(html.includes('Knee pain'));
    assert.ok(html.includes('21 nights'));
    assert.ok(html.includes('7h 32m'));
    assert.ok(html.includes('82 kg → 79.5 kg (-2.5 kg)'));
    assert.ok(html.includes('Test Patient'));
  });

  test('escapes hostile input everywhere', () => {
    const html = buildReportHtml({
      ...FULL,
      patientName: '<img src=x onerror=alert(1)>',
      meds: [{ name: '<b>X</b>', detail: null, adherence: null, status: 'ACTIVE"><script>' }],
      observations: [],
      sleep: null,
      weight: null,
    });
    assert.ok(html);
    assert.ok(!html.includes('<img src=x'));
    assert.ok(!html.includes('<b>X</b>'));
    assert.ok(!html.includes('"><script>'));
  });

  test('null when nothing to report; honest partial states', () => {
    assert.equal(
      buildReportHtml({ ...FULL, meds: [], observations: [], sleep: null, weight: null }),
      null,
    );
    const partial = buildReportHtml({ ...FULL, observations: [], sleep: null, weight: null });
    assert.ok(partial);
    assert.ok(partial.includes('No recorded observations in this window.'));
    assert.ok(partial.includes('No sleep logged in this window.'));
  });
});

describe('report wiring', () => {
  test('route typed, registered, reachable from Settings', () => {
    const types = src('src/types/index.ts');
    assert.ok(types.includes('Report:'), 'route typed');
    const app = src('App.tsx');
    assert.ok(app.includes('name="Report"'), 'route registered');
    assert.ok(app.includes('ReportScreen'), 'screen wired');
    const settings = src('src/screens/Settings/SettingsScreen.tsx');
    assert.ok(settings.includes("navigate('Report')"), 'settings entry point');
  });

  test('device-only: no network, no backend, print+share present', () => {
    const screen = src('src/screens/Report/ReportScreen.tsx');
    assert.ok(screen.includes('printToFileAsync'), 'PDF generation');
    assert.ok(screen.includes('shareAsync'), 'OS share sheet');
    assert.ok(!screen.includes('fetch('), 'no network calls');
    assert.ok(!screen.includes('/api/v1/'), 'no backend dependency');
  });
});
