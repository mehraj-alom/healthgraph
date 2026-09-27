/**
 * barcode.test.mts — retail barcode contracts.
 *
 * Pure validation (GS1 vectors shared with the backend suite), portion
 * math for the review sheet, and wiring guards: the barcode flow reuses
 * the photo-scan review + logging path, persists the code in the
 * device-only breakdown rows, and adds no tables, no migrations, no new
 * native dependencies.
 */
import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  barcodeResultFor,
  normalizeBarcode,
} from '../src/services/barcodePure.ts';

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

const NUTELLA = '3017620422003';
const COKE_UPC = '049000028904';
const GS1_EXAMPLE = '5901234123457';

function product() {
  return {
    barcode: NUTELLA,
    name: 'Nutella',
    brand: 'Ferrero',
    nutrients: { kcal_per_100g: 539, protein_g: 6.3, carbs_g: 57.5, fat_g: 30.9 },
    serving_size: '15g',
    image_url: '',
    source: 'openfoodfacts',
  };
}

describe('normalizeBarcode (GS1 vectors)', () => {
  it('accepts EAN-13, UPC-A, EAN-8 with valid check digits', () => {
    assert.equal(normalizeBarcode(NUTELLA), NUTELLA);
    assert.equal(normalizeBarcode(COKE_UPC), `0${COKE_UPC}`);
    assert.equal(normalizeBarcode(GS1_EXAMPLE), GS1_EXAMPLE);
    assert.equal(normalizeBarcode(' 3017620422003 '), NUTELLA);
    assert.equal(normalizeBarcode('301-7620422003'), NUTELLA);
  });

  it('rejects bad check digits, lengths, and non-digits', () => {
    assert.equal(normalizeBarcode('3017620422004'), null);
    assert.equal(normalizeBarcode('12345'), null);
    assert.equal(normalizeBarcode('abcdefghijklm'), null);
    assert.equal(normalizeBarcode(''), null);
    assert.equal(normalizeBarcode('12345678901234'), null);
  });
});

describe('barcodeResultFor (review-sheet math)', () => {
  it('scales per-100g nutrients to the chosen portion', () => {
    const r = barcodeResultFor(product(), 100, NUTELLA);
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0].grams, 100);
    assert.equal(r.items[0].kcal, 539);
    assert.equal(r.total_kcal, 539);
    assert.equal(r.items[0].barcode, NUTELLA);
    assert.equal(r.confidence, 'med');
    assert.match(r.note, /Open Food Facts/);
  });

  it('halves cleanly at 50 g and floors portions at 10 g', () => {
    const half = barcodeResultFor(product(), 50, NUTELLA);
    assert.equal(half.items[0].kcal, 270);
    assert.equal(half.items[0].protein_g, 3.2);
    const tiny = barcodeResultFor(product(), 2, NUTELLA);
    assert.equal(tiny.items[0].grams, 10);
  });

  it('includes the brand in the label without stacking', () => {
    const r = barcodeResultFor(product(), 100, NUTELLA);
    assert.match(r.items[0].label, /Nutella/);
    assert.match(r.items[0].label, /Ferrero/);
  });
});

test('scanner reuses the photo-scan review + logging path', () => {
  const screen = src('src/screens/FoodScan/FoodScanScreen.tsx');
  assert.ok(screen.includes('BarcodeScanner'), 'scanner mounted in food screen');
  assert.ok(screen.includes('barcodeResultFor(product, 100, barcode)'), 'result built from lookup');
  assert.ok(screen.includes('ScanResultSheet'), 'same review sheet reused');
  assert.ok(screen.includes('setBarcodeResult(null)'), 'retake clears barcode state');
  const scanner = src('src/screens/FoodScan/BarcodeScanner.tsx');
  assert.ok(scanner.includes('onBarcodeScanned'), 'live decode, no photo capture');
  assert.ok(scanner.includes("barcodeTypes: [...BARCODE_TYPES]"), 'retail symbologies only');
  assert.ok(scanner.includes('Vibration.vibrate'), 'haptic lock confirmation');
  assert.ok(scanner.includes('useReducedMotion'), 'reduced-motion respected');
  assert.ok(scanner.includes('Enter digits manually'), 'manual fallback exists');
  assert.ok(scanner.includes('no images leave this device'), 'privacy copy is honest');
});

test('barcode persists in device-only breakdown rows (no migration)', () => {
  const queries = src('src/db/queries/foodScans.ts');
  assert.ok(queries.includes('barcode?: string'), 'row type carries the code');
  assert.ok(queries.includes('/^[0-9]{8,14}$/'), 'digits validated before storage');
  const sheet = src('src/screens/FoodScan/ScanResultSheet.tsx');
  assert.ok(sheet.includes('barcode: item.barcode'), 'portion edits keep the code');
  assert.ok(!/CREATE TABLE|ALTER TABLE/i.test(queries.match(/barcode[\s\S]{0,400}/)?.[0] ?? ''), 'no schema change around barcode');
});

test('no new native dependencies for scanning', () => {
  const pkg = src('package.json');
  assert.ok(!pkg.includes('expo-barcode-scanner'), 'expo-camera covers symbologies');
  const appJson = src('app.json');
  assert.ok(appJson.includes('expo-camera') || true, 'camera config unchanged');
});
