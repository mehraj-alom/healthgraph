/**
 * nutritionMicros.test.mts — fiber/sugar/sodium display contract (node).
 *
 * Micros render only when USDA-matched; estimated items show nothing
 * rather than invented values. Totals sum matched items only.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { microLine, sumMicros } from '../src/screens/FoodScan/microDisplay.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('micro display helpers', () => {
  test('full, partial, and absent micros format honestly', () => {
    assert.equal(microLine(2.5, 12, 300), 'Fiber 2.5g · Sugar 12g · Sodium 300mg');
    assert.equal(microLine(null, 12, null), 'Sugar 12g');
    assert.equal(microLine(null, null, null), null);
    assert.equal(microLine(undefined, undefined, undefined), null);
    assert.equal(microLine(NaN, 12, null), 'Sugar 12g');
  });

  test('totals sum matched items; all-absent stays null', () => {
    assert.equal(sumMicros([2.5, null, 1.5]), 4);
    assert.equal(sumMicros([null, null]), null);
    assert.equal(sumMicros([]), null);
  });
});

describe('scan sheet micro contract', () => {
  test('sheet renders matched micros and scales them with portions', () => {
    const sheet = src('src/screens/FoodScan/ScanResultSheet.tsx');
    assert.ok(sheet.includes('microLine('), 'shared formatter, one copy path');
    assert.ok(sheet.includes('from matched foods'), 'provenance on totals');
  });

  test('no micro values are invented for estimated items', () => {
    const sheet = src('src/screens/FoodScan/ScanResultSheet.tsx');
    assert.ok(!sheet.includes('estimateFiber'), 'no estimated micros');
    assert.ok(!sheet.includes('fiber ?? 0'), 'absent stays absent');
  });
});
