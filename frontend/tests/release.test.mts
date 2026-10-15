/**
 * release.test.mts — Play launch one-liners (node --experimental-strip-types).
 *
 * EU AI Act disclosure, Open Food Facts attribution, and external legal
 * links (hidden until the owner publishes the URLs) are pinned here so
 * no later edit can silently drop a launch requirement.
 *
 * Run:
 *   node --experimental-strip-types --test frontend/tests/release.test.mts
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  OFF_ATTRIBUTION,
  hasImprintUrl,
  hasPrivacyPolicyUrl,
} from '../src/services/legalLinks.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('launch one-liners', () => {
  test('chat discloses AI generation', () => {
    const chat = src('src/screens/Chat/ChatScreen.tsx');
    assert.ok(chat.includes('AI-generated'), 'EU AI Act transparency line');
  });

  test('packaged-food attribution exists in code and on screen', () => {
    assert.ok(OFF_ATTRIBUTION.includes('Open Food Facts'), 'credit names the source');
    assert.ok(OFF_ATTRIBUTION.includes('ODbL'), 'credit names the license');
    const profile = src('src/components/ProfileSheet.tsx');
    assert.ok(profile.includes('OFF_ATTRIBUTION'), 'About section shows the credit');
    const sheet = src('src/screens/FoodScan/ScanResultSheet.tsx');
    assert.ok(sheet.includes('OFF_ATTRIBUTION'), 'barcode results show the credit');
  });

  test('external legal links hide until the owner publishes URLs', () => {
    // Null today (owner hosts externally): rows must not render.
    assert.equal(hasPrivacyPolicyUrl(), false);
    assert.equal(hasImprintUrl(), false);
    const profile = src('src/components/ProfileSheet.tsx');
    assert.ok(profile.includes('hasPrivacyPolicyUrl()'), 'privacy row gated');
    assert.ok(profile.includes('hasImprintUrl()'), 'impressum row gated');
    assert.ok(profile.includes('Linking.openURL'), 'links open externally');
  });

  test('FHIR upload path is labeled, never silent', () => {
    const screen = src('src/screens/Documents/DocumentUploadScreen.tsx');
    assert.ok(screen.includes('FHIR JSON file'), 'picker copy names the format');
    assert.ok(screen.includes('FHIR Bundle'), 'preview names the format');
  });
});
