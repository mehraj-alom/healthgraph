/**
 * billing.test.mts — Play billing wiring (node --experimental-strip-types).
 *
 * The product catalog, provider port, and purchase-flow decisions run
 * directly (zero-import). The store SDK is intentionally absent: the stub
 * is the provider until Console products + a native build exist. RN
 * layers (PricingScreen flow, server refresh) are pinned by source-text
 * contract. Absences (no charge without verify, no SDK, no BILLING
 * permission) are tested as absences.
 *
 * Run:
 *   node --experimental-strip-types --test frontend/tests/billing.test.mts
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BILLING_PRODUCTS,
  planForProductId,
  productIdForPlan,
} from '../src/services/billingProducts.ts';
import {
  activeBillingProvider,
  resolvePurchaseOutcome,
  stubBillingProvider,
} from '../src/services/billingClient.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ============================================================================
// Catalog — pure
// ============================================================================

describe('billing catalog', () => {
  test('paid tiers map to Play product ids, Free never purchases', () => {
    assert.equal(productIdForPlan('general'), 'hg_general_monthly');
    assert.equal(productIdForPlan('allin'), 'hg_allin_monthly');
    assert.equal(productIdForPlan('free'), null);
    assert.equal(productIdForPlan(null), null);
    assert.equal(productIdForPlan('enterprise'), null);
  });

  test('product ids map back to tiers, unknowns rejected', () => {
    assert.equal(planForProductId('hg_general_monthly'), 'general');
    assert.equal(planForProductId('hg_allin_monthly'), 'allin');
    assert.equal(planForProductId('hg_unknown'), null);
    assert.equal(planForProductId(null), null);
  });

  test('catalog prices mirror the pricing screen', () => {
    assert.equal(BILLING_PRODUCTS.general.price, '€11/mo');
    assert.equal(BILLING_PRODUCTS.allin.price, '€18/mo');
  });
});

// ============================================================================
// Provider port — pure
// ============================================================================

describe('billing provider', () => {
  test('stub cannot purchase and explains itself', async () => {
    assert.equal(stubBillingProvider.canPurchase, false);
    const result = await stubBillingProvider.purchase('hg_general_monthly');
    assert.deepEqual(result, { status: 'unavailable', reason: 'store-unavailable' });
  });

  test('active provider is the stub until the SDK lands', () => {
    assert.equal(activeBillingProvider().name, 'stub');
    assert.equal(activeBillingProvider().canPurchase, false);
  });

  test('purchase outcomes route the UI honestly', () => {
    assert.deepEqual(
      resolvePurchaseOutcome({ status: 'purchased', productId: 'hg_general_monthly', purchaseToken: 'tok' }),
      { action: 'verify', productId: 'hg_general_monthly', purchaseToken: 'tok' },
    );
    assert.deepEqual(resolvePurchaseOutcome({ status: 'cancelled' }), { action: 'stay' });
    const fallback = resolvePurchaseOutcome({ status: 'unavailable', reason: 'store-unavailable' });
    assert.equal(fallback.action, 'fallback-free');
    if (fallback.action === 'fallback-free') {
      assert.ok(fallback.message.includes('Nothing is charged today'));
    }
  });
});

// ============================================================================
// Wiring contracts + absences
// ============================================================================

describe('billing wiring contracts', () => {
  test('pricing screen purchases paid tiers, never traps', () => {
    const screen = src('src/screens/Onboarding/PricingScreen.tsx');
    assert.ok(screen.includes('finishPaid'), 'paid flow exists');
    assert.ok(screen.includes('/api/v1/billing/verify'), 'server verification');
    assert.ok(screen.includes('refreshServerEntitlement'), 'entitlement from server');
    assert.ok(screen.includes('Nothing is charged today'), 'honest fallback copy');
  });

  test('local flag is a server-truth cache, not a grant', () => {
    const premium = src('src/services/premium.ts');
    assert.ok(premium.includes('refreshServerEntitlement'), 'server refresh exists');
    assert.ok(premium.includes('/api/v1/profile'), 'truth source is profile');
  });

  test('absences: no SDK, no charge path, no permission', () => {
    const pkg = src('package.json');
    for (const dep of ['react-native-iap', 'react-native-purchases', 'revenuecat', 'expo-in-app-purchases']) {
      assert.ok(!pkg.includes(dep), `no ${dep}`);
    }
    const manifest = src('app.json');
    assert.ok(!manifest.includes('BILLING'), 'no billing permission yet');
    const client = src('src/services/billingClient.ts');
    assert.ok(!client.includes('setPremiumEntitled'), 'receipt alone unlocks nothing');
  });
});
