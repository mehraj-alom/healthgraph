/**
 * premiumSync.ts — report verified store purchases to the backend ledger.
 *
 * The Play Store / RevenueCat entitlement stays the source of truth for
 * access (services/billing.ts). This module mirrors each verified
 * purchase/restore into `premium_purchases` so support, status, and
 * history ("who bought premium?") read from one business table.
 *
 * Best-effort by design: reporting never throws, never blocks the
 * purchase flow, and never changes the local tier. Offline or backend
 * errors are swallowed — the next purchase/restore reports again.
 */

import { api } from '@/services/api';
import type { PremiumTier } from '@/services/premium';

function productIdFor(tier: Exclude<PremiumTier, 'free'>): string | undefined {
  const key =
    tier === 'allin' ? 'EXPO_PUBLIC_RC_ALLIN_PRODUCT' : 'EXPO_PUBLIC_RC_GENERAL_PRODUCT';
  const v = (process.env?.[key] as string | undefined)?.trim();
  return v && v.length > 0 ? v : undefined;
}

function entitlementFor(tier: Exclude<PremiumTier, 'free'>): string {
  const key = tier === 'allin' ? 'EXPO_PUBLIC_RC_ALLIN_ENT' : 'EXPO_PUBLIC_RC_GENERAL_ENT';
  const fallback = tier === 'allin' ? 'allin' : 'general';
  const v = (process.env?.[key] as string | undefined)?.trim();
  return v && v.length > 0 ? v : fallback;
}

/** Store-side expiry/renewal detail when the native module is reachable. */
async function storeDetail(
  tier: Exclude<PremiumTier, 'free'>,
): Promise<{ expires_at?: string; auto_renewing?: boolean }> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-purchases') as typeof import('react-native-purchases');
    const purchasesApi = (mod?.default ?? mod) as unknown as {
      getCustomerInfo?: () => Promise<import('react-native-purchases').CustomerInfo>;
    };
    if (typeof purchasesApi?.getCustomerInfo !== 'function') return {};
    const info = await purchasesApi.getCustomerInfo();
    const ent = info?.entitlements?.active?.[entitlementFor(tier)] as
      | { expirationDate?: string | null; isActive?: boolean }
      | undefined;
    if (!ent) return {};
    const out: { expires_at?: string; auto_renewing?: boolean } = {};
    if (ent.expirationDate) {
      const d = new Date(ent.expirationDate);
      if (!Number.isNaN(d.getTime())) out.expires_at = d.toISOString();
    }
    // Active with an expiry behaves as auto-renewing until proven otherwise;
    // the backend treats a missing flag as unknown, never as cancelled.
    if (ent.isActive && out.expires_at) out.auto_renewing = true;
    return out;
  } catch {
    return {};
  }
}

/**
 * Mirror a verified paid tier into the backend ledger. Call after
 * purchaseTier / presentStorePaywall / restorePurchases resolve paid.
 */
export async function reportPremiumPurchase(
  tier: Exclude<PremiumTier, 'free'>,
): Promise<void> {
  try {
    const detail = await storeDetail(tier);
    await api.post('/api/v1/premium/purchases', {
      tier,
      status: 'active',
      provider: 'google_play',
      product_id: productIdFor(tier),
      entitlement: entitlementFor(tier),
      auto_renewing: detail.auto_renewing ?? undefined,
      started_at: new Date().toISOString(),
      expires_at: detail.expires_at,
    });
  } catch {
    // Ledger is observability, not access control. Swallow everything.
  }
}
