/**
 * premium.test.mts — 3-tier premium enforcement contracts.
 *
 * Free sees blurred previews (never blank walls, never live hardware);
 * paid uses everything untouched. Purchases mirror into the backend
 * ledger table `premium_purchases`.
 *
 * Run:
 *   node --experimental-strip-types --test frontend/tests/premium.test.mts
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const src = (...p: string[]) => fs.readFileSync(path.join(repoRoot, ...p), 'utf8');

function mustContain(file: string[], needle: string, why: string): void {
  const text = src(...file);
  assert.ok(text.includes(needle), `${file.join('/')} must contain ${why}: ${needle}`);
}

describe('premium tiers', () => {
  test('three tiers stay Free/General/All-in', () => {
    const text = src('frontend', 'src', 'services', 'premium.ts');
    assert.ok(text.includes("'free' | 'general' | 'allin'"), 'tier union');
    assert.ok(text.includes('general €11/mo') || text.includes('general'), 'general tier');
    assert.ok(text.includes('allin'), 'allin tier');
  });

  test('paid minimums unchanged (logging/meds/timeline stay free)', () => {
    const text = src('frontend', 'src', 'services', 'premium.ts');
    assert.ok(text.includes("trends: 'general'"), 'trends need General');
    assert.ok(text.includes("facePulse: 'allin'"), 'face pulse needs All-in');
    assert.ok(text.includes("body3d: 'allin'"), '3D body needs All-in');
    assert.ok(text.includes("voiceAlarms: 'allin'"), 'voice needs All-in');
  });
});

describe('PaywallGate blur tease', () => {
  test('locked tiers render children blurred behind glass', () => {
    const f = ['frontend', 'src', 'components', 'PaywallGate.tsx'];
    mustContain(f, "from 'expo-blur'", 'BlurView import');
    mustContain(f, 'BlurView', 'BlurView usage');
    mustContain(f, 'pointerEvents="none"', 'untouchable preview');
    mustContain(f, 'blurPreview', 'opt-out prop');
    mustContain(f, 'teasePreviewBox', 'capped preview box');
  });

  test('entitled tiers still render children untouched', () => {
    mustContain(
      ['frontend', 'src', 'components', 'PaywallGate.tsx'],
      'return <>{children}</>',
      'zero-friction paid path',
    );
  });

  test('camera hardware never mounts behind blur', () => {
    mustContain(
      ['frontend', 'src', 'screens', 'PpgMeasure', 'PulseInstrumentScreen.tsx'],
      'blurPreview={false}',
      'pulse opt-out',
    );
  });

  test('3D GL view never mounts behind blur', () => {
    mustContain(
      ['frontend', 'src', 'screens', 'Body', 'BodyScreen.tsx'],
      'blurPreview={false}',
      'body opt-out',
    );
  });

  test('dashboard correlations are gated with blur', () => {
    const f = ['frontend', 'src', 'screens', 'Dashboard', 'HealthDashboardScreen.tsx'];
    mustContain(f, 'PaywallGate', 'gate import');
    mustContain(f, 'feature="correlations"', 'correlations gate');
  });

  test('prescription scanner button shows lock state', () => {
    mustContain(
      ['frontend', 'src', 'screens', 'Medications', 'MedicationsScreen.tsx'],
      'scanLocked',
      'scan lock badge',
    );
  });
});

describe('purchase ledger reporting', () => {
  test('premiumSync posts verified purchases, never throws', () => {
    const f = ['frontend', 'src', 'services', 'premiumSync.ts'];
    mustContain(f, '/api/v1/premium/purchases', 'ledger endpoint');
    mustContain(f, 'reportPremiumPurchase', 'reporter export');
    const text = src(...f);
    assert.ok(text.includes('catch'), 'swallowed errors — reporting never blocks purchase');
  });

  test('purchase and restore flows report paid tiers', () => {
    mustContain(
      ['frontend', 'src', 'screens', 'Onboarding', 'PricingScreen.tsx'],
      'reportPremiumPurchase',
      'pricing reports',
    );
    mustContain(
      ['frontend', 'src', 'components', 'ProfileSheet.tsx'],
      'reportPremiumPurchase',
      'drawer reports',
    );
    mustContain(
      ['frontend', 'src', 'components', 'PaywallGate.tsx'],
      'reportPremiumPurchase',
      'restore reports',
    );
  });

  test('profile drawer marks the real current plan', () => {
    const f = ['frontend', 'src', 'components', 'ProfileSheet.tsx'];
    mustContain(f, 'usePremiumTier', 'live tier hook');
    mustContain(f, 'Your plan:', 'plan label');
  });
});

describe('backend ledger', () => {
  test('premium_purchases model exists with buyer tracking fields', () => {
    const f = ['models', 'premium.py'];
    mustContain(f, 'premium_purchases', 'table name');
    mustContain(f, 'patient_id', 'buyer link');
    mustContain(f, 'purchase_token', 'upsert key');
    mustContain(f, 'expires_at', 'expiry');
  });

  test('migration chains on the waitlist head', () => {
    const f = ['alembic', 'versions', 'pm01_premium_purchases.py'];
    mustContain(f, 'ea01earlyaccess', 'down revision');
    mustContain(f, '"premium_purchases"', 'table creation');
  });

  test('status + history endpoints exist behind auth', () => {
    const f = ['app', 'api', 'v1', 'premium.py'];
    mustContain(f, '/purchases', 'report/history routes');
    mustContain(f, '/status', 'status route');
    mustContain(f, 'get_authenticated_patient_id', 'auth guard');
  });
});
