/**
 * cyclePredictions.test.mts — period + fertile-window estimates (node).
 *
 * Estimates only, from recorded period starts: median of recent cycle
 * lengths with an explicit ± range (never a single certain day), fertile
 * window by the textbook calendar method, labeled approximate throughout.
 * Fewer than the required past cycles means no estimate — never a guess.
 * No pregnancy mode, no condition inference, no contraception use: the
 * copy guards pin exactly that.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  cycleStats,
  describePrediction,
  fertileEstimate,
  predictNextPeriod,
} from '../src/services/cyclePredictions.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const starts = (dates: string[]) => dates.map((date) => ({ date }));

describe('cycle statistics', () => {
  test('median of recent lengths; irregularity as max-min spread', () => {
    const stats = cycleStats(starts(['2026-07-01', '2026-07-29', '2026-08-26', '2026-09-23']));
    assert.deepEqual(stats?.lengths, [28, 28, 28]);
    assert.equal(stats?.medianLength, 28);
    assert.equal(stats?.cycles, 3);
    assert.equal(stats?.irregularDays, 0);
  });

  test('even counts take the lower-middle median; only recent six count', () => {
    const stats = cycleStats(
      starts([
        '2026-01-01',
        '2026-01-20',
        '2026-02-15',
        '2026-03-15',
        '2026-04-12',
        '2026-05-10',
        '2026-06-07',
        '2026-07-05',
      ]),
    );
    assert.equal(stats?.cycles, 6);
    assert.ok(stats !== null && stats.medianLength >= 26 && stats.medianLength <= 28);
  });

  test('fewer than two starts, unsorted, or malformed input yields null', () => {
    assert.equal(cycleStats([]), null);
    assert.equal(cycleStats(starts(['2026-09-23'])), null);
    assert.equal(cycleStats(starts(['garbage', '2026-09-23'])), null);
    assert.equal(cycleStats(starts(['2026-09-23', '2026-09-23'])), null);
    assert.equal(cycleStats(starts(['2026-09-23', '2026-01-01'])), null);
  });

  test('absurd lengths are rejected, not averaged in', () => {
    assert.equal(cycleStats(starts(['2026-01-01', '2027-06-01', '2027-07-01'])), null);
  });
});

describe('next period prediction', () => {
  test('regular cycles give a tight range with cycle count', () => {
    const pred = predictNextPeriod(starts(['2026-07-01', '2026-07-29', '2026-08-26', '2026-09-23']));
    assert.deepEqual(pred, {
      expected: '2026-10-21',
      from: '2026-10-20',
      to: '2026-10-22',
      basedOn: 3,
      early: false,
    });
  });

  test('one past cycle gives a wide early range, flagged early', () => {
    const pred = predictNextPeriod(starts(['2026-09-01', '2026-09-29']));
    assert.equal(pred?.expected, '2026-10-27');
    assert.equal(pred?.from, '2026-10-24');
    assert.equal(pred?.to, '2026-10-30');
    assert.equal(pred?.early, true);
    assert.equal(pred?.basedOn, 1);
  });

  test('irregular cycles widen the range instead of hiding it', () => {
    const pred = predictNextPeriod(starts(['2026-07-01', '2026-07-29', '2026-08-30', '2026-09-23']));
    assert.ok(pred !== null && pred.from <= pred.expected && pred.expected <= pred.to);
    assert.ok(pred !== null && pred.to >= '2026-10-24');
  });

  test('no prediction without enough history', () => {
    assert.equal(predictNextPeriod(starts(['2026-09-23'])), null);
    assert.equal(predictNextPeriod([]), null);
  });
});

describe('fertile window estimate', () => {
  test('calendar method around length-minus-14, needs two lengths', () => {
    const est = fertileEstimate(starts(['2026-07-29', '2026-08-26', '2026-09-23']));
    assert.deepEqual(est, {
      ovulationAround: '2026-10-07',
      fertileFrom: '2026-10-02',
      fertileTo: '2026-10-08',
    });
  });

  test('single length or no history yields no estimate', () => {
    assert.equal(fertileEstimate(starts(['2026-09-23'])), null);
    assert.equal(fertileEstimate([]), null);
  });
});

describe('prediction copy', () => {
  test('lines read as estimates with the cycle count attached', () => {
    assert.equal(
      describePrediction({ expected: '2026-10-21', from: '2026-10-20', to: '2026-10-22', basedOn: 3, early: false }),
      'Expected Oct 20 – 22 · based on 3 past cycles',
    );
    assert.equal(
      describePrediction({ expected: '2026-10-27', from: '2026-10-24', to: '2026-10-30', basedOn: 1, early: true }),
      'Expected Oct 24 – 30 · early estimate from 1 past cycle',
    );
  });
});

describe('prediction copy guards', () => {
  test('estimates, not certainties; no pregnancy, birth-control, or condition use', () => {
    const hay = src('src/services/cyclePredictions.ts').toLowerCase();
    for (const phrase of ['will start', 'will ovulate', 'safe day', 'safe to', 'unsafe', 'pregnan', 'birth control', 'pcos', 'endometriosis', 'diagnos', 'infertil']) {
      assert.ok(!hay.includes(phrase), phrase);
    }
    assert.ok(hay.includes('estimat'), 'estimate language present');
  });

  test('screen carries the not-for-contraception line', () => {
    const screen = src('src/screens/Cycle/CycleScreen.tsx');
    assert.ok(screen.toLowerCase().includes('not for contraception'), 'contraception disclaimer');
    assert.ok(screen.includes('not medical advice'), 'wellness disclaimer');
  });
});
