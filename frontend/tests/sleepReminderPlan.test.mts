/**
 * sleepReminderPlan.test.mts — bedtime reminder pure contract (node).
 *
 * A bedtime reminder is a daily nudge, not a smart alarm: it fires at the
 * chosen clock time every day. Times validate strictly; disabled or
 * invalid states never produce a schedule; summary copy stays descriptive.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_REMINDER_TIME,
  REMINDER_STORAGE_KEY,
  describeReminder,
  normalizeReminderState,
  validateReminderTime,
} from '../src/services/sleepReminderPlan.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('reminder time validation', () => {
  test('hours 0-23 and minutes 0-59 pass; everything else fails', () => {
    assert.equal(validateReminderTime(22, 30).ok, true);
    assert.equal(validateReminderTime(0, 0).ok, true);
    assert.equal(validateReminderTime(23, 59).ok, true);
    assert.equal(validateReminderTime(24, 0).ok, false);
    assert.equal(validateReminderTime(-1, 0).ok, false);
    assert.equal(validateReminderTime(22, 60).ok, false);
    assert.equal(validateReminderTime(22.5, 0).ok, false);
    assert.equal(validateReminderTime(NaN, 0).ok, false);
  });

  test('stored states normalize defensively, defaulting to off', () => {
    assert.deepEqual(normalizeReminderState(null), { enabled: false, ...DEFAULT_REMINDER_TIME });
    assert.deepEqual(normalizeReminderState('garbage'), { enabled: false, ...DEFAULT_REMINDER_TIME });
    assert.deepEqual(normalizeReminderState({ enabled: true, hour: 22, minute: 30 }), {
      enabled: true,
      hour: 22,
      minute: 30,
    });
    assert.deepEqual(normalizeReminderState({ enabled: true, hour: 99, minute: 99 }), {
      enabled: false,
      ...DEFAULT_REMINDER_TIME,
    });
    assert.deepEqual(normalizeReminderState({ enabled: 'yes' }), { enabled: false, ...DEFAULT_REMINDER_TIME });
  });
});

describe('reminder summary copy', () => {
  test('off state and on state describe themselves without promises', () => {
    assert.equal(describeReminder({ enabled: false, hour: 22, minute: 30 }), 'Bedtime reminder off.');
    assert.equal(describeReminder({ enabled: true, hour: 22, minute: 30 }), 'Bedtime reminder daily at 22:30.');
  });

  test('summary never makes sleep-quality claims', () => {
    const hay = describeReminder({ enabled: true, hour: 22, minute: 30 }).toLowerCase();
    for (const phrase of ['better sleep', 'improve', 'guarantee', 'will help']) {
      assert.ok(!hay.includes(phrase), phrase);
    }
  });
});

describe('reminder wiring guards', () => {
  test('storage key versioned; wiring never imports notifications statically', () => {
    assert.ok(REMINDER_STORAGE_KEY.startsWith('hg:'), 'namespaced key');
    const wiring = src('src/services/sleepReminders.ts');
    for (const line of wiring.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.includes("from 'expo-notifications'") && !trimmed.startsWith('import type')) {
        throw new Error(`static expo-notifications import: ${trimmed}`);
      }
    }
    assert.ok(wiring.includes("await import('expo-notifications')"), 'dynamic import past the gate');
    assert.ok(wiring.includes('REMINDER_STORAGE_KEY'), 'single storage key');
  });

  test('no new tables, no backend calls for reminders', () => {
    const wiring = src('src/services/sleepReminders.ts');
    assert.ok(!wiring.includes('CREATE TABLE'), 'no schema');
    assert.ok(!wiring.includes('fetch('), 'no network');
    assert.ok(!wiring.includes('/api/'), 'no backend endpoints');
  });
});
