/**
 * voiceCheckin.test.mts — interview answer parsing (node, no device needed).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  INTERVIEW_SCRIPT,
  parseSpokenNumber,
} from '../src/services/voiceCheckin/questions.ts';

describe('parseSpokenNumber', () => {
  test('digits win, decimals and halves kept', () => {
    assert.equal(parseSpokenNumber('about 7 hours'), 7);
    assert.equal(parseSpokenNumber('7 and a half'), 7.5);
    assert.equal(parseSpokenNumber('seven and a half'), 7.5);
    assert.equal(parseSpokenNumber('2.5 litres'), 2.5);
  });

  test('number words resolve', () => {
    assert.equal(parseSpokenNumber('three'), 3);
    assert.equal(parseSpokenNumber('I would say four I guess'), 4);
    assert.equal(parseSpokenNumber('no sleep at all'), null);
  });

  test('no number anywhere returns null (never guessed)', () => {
    assert.equal(parseSpokenNumber('pretty good actually'), null);
    assert.equal(parseSpokenNumber(''), null);
  });
});

describe('interview script', () => {
  test('five questions, every parse bounded', () => {
    assert.equal(INTERVIEW_SCRIPT.length, 5);
    for (const q of INTERVIEW_SCRIPT) {
      assert.ok(q.prompt.length > 0 && q.prompt.length < 80, `${q.field} prompt short`);
      assert.equal(q.parse('thirty'), null, `${q.field} rejects out-of-range`);
      assert.equal(q.parse('blah blah'), null, `${q.field} rejects nonsense`);
    }
  });

  test('scales snap 1 to 5', () => {
    const mood = INTERVIEW_SCRIPT[0];
    assert.equal(mood.parse('1'), 1);
    assert.equal(mood.parse('five'), 5);
    assert.equal(mood.parse('0'), null);
    assert.equal(mood.parse('6'), null);
  });

  test('sleep allows halves up to 24 hours', () => {
    const sleep = INTERVIEW_SCRIPT[3];
    assert.equal(sleep.parse('7 and a half'), 7.5);
    assert.equal(sleep.parse('25'), null);
  });

  test('water counts whole glasses up to 20', () => {
    const water = INTERVIEW_SCRIPT[4];
    assert.equal(water.parse('3 glasses'), 3);
    assert.equal(water.parse('thirty'), null);
  });
});
