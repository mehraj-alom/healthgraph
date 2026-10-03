/**
 * reproductiveModes.test.mts — TTC / pregnancy / perimenopause mode logic.
 *
 * RED: reproductiveModes.ts does not exist yet.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeMode,
  ttcCard,
  pregnancyWeekFromLmp,
  pregnancyWeekFromDueDate,
  periNote,
  normalizeOvulationTest,
  TTC_DISCLAIMER,
  PRENATAL_CHECKLIST,
} from '../src/services/reproductiveModes.ts';

const starts = (dates: string[]) => dates.map((date) => ({ date }));

describe('normalizeMode', () => {
  it('defaults to standard for junk', () => {
    assert.equal(normalizeMode(undefined), 'standard');
    assert.equal(normalizeMode('contraception'), 'standard');
    assert.equal(normalizeMode(42), 'standard');
  });
  it('accepts the four known modes', () => {
    assert.equal(normalizeMode('ttc'), 'ttc');
    assert.equal(normalizeMode('pregnant'), 'pregnant');
    assert.equal(normalizeMode('perimenopause'), 'perimenopause');
    assert.equal(normalizeMode('standard'), 'standard');
  });
});

describe('ttcCard', () => {
  it('returns null with fewer than 3 starts (needs 2 lengths)', () => {
    assert.equal(ttcCard(starts(['2026-08-01'])), null);
    assert.equal(ttcCard(starts(['2026-08-01', '2026-08-29'])), null);
  });
  it('returns the fertile window with its basis', () => {
    const card = ttcCard(starts(['2026-06-01', '2026-06-29', '2026-07-27']));
    assert.ok(card !== null);
    assert.equal(card.basedOn, 2);
    assert.match(card.fertileFrom, /^\d{4}-\d{2}-\d{2}$/);
  });
  it('carries the planning-only disclaimer, never contraception guidance', () => {
    assert.match(TTC_DISCLAIMER, /planning/i);
    assert.match(TTC_DISCLAIMER, /not contraception/i);
  });
});

describe('pregnancy week', () => {
  it('computes week from LMP', () => {
    assert.equal(pregnancyWeekFromLmp('2026-08-01', '2026-10-03'), 10);
  });
  it('computes week from due date', () => {
    // LMP 2026-08-01 + 280 days = due 2027-05-08 → same week 10 on 2026-10-03.
    assert.equal(pregnancyWeekFromDueDate('2027-05-08', '2026-10-03'), 10);
  });
  it('returns null out of range or for junk', () => {
    assert.equal(pregnancyWeekFromLmp('2026-10-03', '2026-10-03'), 1); // day zero is week 1
    assert.equal(pregnancyWeekFromLmp('2026-10-10', '2026-10-03'), null); // LMP in the future
    assert.equal(pregnancyWeekFromLmp('2025-01-01', '2026-10-03'), null);
    assert.equal(pregnancyWeekFromDueDate('2026-10-03', '2026-10-03'), 41); // due today is week 41
    assert.equal(pregnancyWeekFromDueDate('2025-01-01', '2026-10-03'), null); // long past due
  });
  it('prenatal checklist is logistics-only (no dosing, no triage)', () => {
    assert.ok(PRENATAL_CHECKLIST.length >= 3);
    const joined = PRENATAL_CHECKLIST.join(' ').toLowerCase();
    assert.doesNotMatch(joined, /dose|take |mg\b|emergency|bleeding|pain/);
  });
});

describe('periNote', () => {
  it('returns null without stats', () => {
    assert.equal(periNote(null), null);
  });
  it('frames variability without diagnosing', () => {
    const note = periNote({ lengths: [28, 45], medianLength: 28, cycles: 2, irregularDays: 17 });
    assert.ok(note !== null);
    assert.match(note as string, /vary/i);
    assert.doesNotMatch(note as string, /you have|diagnos/i);
  });
});

describe('normalizeOvulationTest', () => {
  it('accepts positive/negative with a valid day', () => {
    assert.deepEqual(normalizeOvulationTest({ day: '2026-10-01', result: 'positive' }), {
      day: '2026-10-01',
      result: 'positive',
    });
  });
  it('rejects junk', () => {
    assert.throws(() => normalizeOvulationTest({ day: 'yesterday', result: 'positive' }));
    assert.throws(() => normalizeOvulationTest({ day: '2026-10-01', result: 'maybe' }));
  });
});
