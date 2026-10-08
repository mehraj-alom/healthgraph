/**
 * billing.ts — Google Play Billing via RevenueCat (react-native-purchases).
 *
 * Play policy: all digital goods (tiers, trials) MUST be sold through
 * Google Play Billing — no external payment links anywhere in the app.
 * RevenueCat is the compliant wrapper; product IDs live in Play Console
 * and are referenced here only through env (no hardcoded secrets).
 *
 * Env (EXPO_PUBLIC_*, set in EAS / GitHub Actions Variables):
 *   EXPO_PUBLIC_REVENUECAT_ANDROID_KEY — RevenueCat public Android API key
 *   EXPO_PUBLIC_RC_GENERAL_PRODUCT     — Play product id, General monthly
 *   EXPO_PUBLIC_RC_ALLIN_PRODUCT       — Play product id, All-in monthly
 *   EXPO_PUBLIC_RC_GENERAL_ENT         — entitlement id, default "general"
 *   EXPO_PUBLIC_RC_ALLIN_ENT           — entitlement id, default "allin"
 *
 * Without a key or without the native module (Expo Go / web), every call
 * degrades to the local tier — the paywall still gates, nothing crashes,
 * nothing charges. `__DEV__` stays fully entitled via premium.ts.
 */

import { getLocalTier, normalizeTier, notifyTierChanged, setLocalTier, type PremiumTier } from '@/services/premium';

import type { CustomerInfo } from 'react-native-purchases';

type PurchasesApi = typeof import('react-native-purchases').default;

let purchases: PurchasesApi | null = null;
let configured = false;

function loadModule(): PurchasesApi | null {
  if (purchases) return purchases;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-purchases') as typeof import('react-native-purchases');
    const api = (mod?.default ?? (mod as unknown as PurchasesApi)) as PurchasesApi | null;
    if (!api?.configure) return null;
    purchases = api;
    return purchases;
  } catch {
    return null;
  }
}

function env(name: string, fallback: string): string {
  const v = (process.env?.[`EXPO_PUBLIC_${name}`] as string | undefined)?.trim();
  return v && v.length > 0 ? v : fallback;
}

export function billingAvailable(): boolean {
  return loadModule() !== null && env('REVENUECAT_ANDROID_KEY', '').length > 0;
}

/** Configure once at startup. Never throws; failure = local-tier mode. */
export async function configureBilling(): Promise<void> {
  if (configured) return;
  configured = true;
  const mod = loadModule();
  const key = env('REVENUECAT_ANDROID_KEY', '');
  if (!mod || !key) return;
  try {
    mod.configure({ apiKey: key });
    mod.addCustomerInfoUpdateListener((info: CustomerInfo) => {
      void syncTierFromCustomerInfo(info?.entitlements?.active ?? {});
    });
    const info = await mod.getCustomerInfo();
    await syncTierFromCustomerInfo(info?.entitlements?.active ?? {});
  } catch {
    // Store unreachable / misconfigured key: stay on the local tier.
  }
}

async function syncTierFromCustomerInfo(active: Record<string, unknown>): Promise<void> {
  const allinEnt = env('RC_ALLIN_ENT', 'allin');
  const generalEnt = env('RC_GENERAL_ENT', 'general');
  // Store state is authoritative: an absent entitlement means expired/cancelled.
  const resolved: PremiumTier =
    active[allinEnt] != null ? 'allin' : active[generalEnt] != null ? 'general' : 'free';
  if (__DEV__) return; // dev builds stay fully entitled via premium.ts
  const current = await getLocalTier();
  if (resolved !== current) {
    await setLocalTier(resolved);
    notifyTierChanged(resolved);
  }
}

export type PurchaseResult =
  | { status: 'purchased'; tier: PremiumTier }
  | { status: 'cancelled' }
  | { status: 'unavailable' };

/** Buy a tier through Play Billing. Returns cancelled when the user backs out. */
export async function purchaseTier(want: Exclude<PremiumTier, 'free'>): Promise<PurchaseResult> {
  const mod = loadModule();
  if (!mod) return { status: 'unavailable' };
  const productId =
    want === 'allin' ? env('RC_ALLIN_PRODUCT', '') : env('RC_GENERAL_PRODUCT', '');
  if (!productId) return { status: 'unavailable' };
  try {
    const products = await mod.getProducts([productId]);
    const storeProduct = products?.[0];
    if (!storeProduct) return { status: 'unavailable' };
    const { customerInfo } = await mod.purchaseStoreProduct(storeProduct);
    const active = customerInfo?.entitlements?.active ?? {};
    await syncTierFromCustomerInfo(active);
    const resolved = normalizeTier(await getLocalTier());
    // Purchase succeeded but entitlement not yet reflected (webhook lag):
    // trust the bought tier locally; the next sync corrects it if wrong.
    const tier = resolved === 'free' && !__DEV__ ? want : resolved;
    if (tier !== resolved) {
      await setLocalTier(tier);
    }
    notifyTierChanged(tier);
    return { status: 'purchased', tier };
  } catch (e) {
    const cancelled =
      (e as { userCancelled?: boolean; code?: string })?.userCancelled === true ||
      (e as { code?: string })?.code === 'USER_CANCELLED';
    return { status: cancelled ? 'cancelled' : 'unavailable' };
  }
}

/** Restore previous purchases (Play policy: required on every paywall). */
export async function restorePurchases(): Promise<PremiumTier> {
  const mod = loadModule();
  if (!mod) return getLocalTier();
  try {
    const info = await mod.restorePurchases();
    await syncTierFromCustomerInfo(info?.entitlements?.active ?? {});
  } catch {
    // Offline / store error: keep the local tier.
  }
  return getLocalTier();
}

export type StorePaywallResult =
  | { status: 'purchased'; tier: PremiumTier }
  | { status: 'cancelled' }
  | { status: 'unavailable' };

/**
 * Present RevenueCat's hosted paywall (remote template from the dashboard).
 *
 * This is the primary purchase surface for India + Germany: the template
 * renders the shopper's locale and currency automatically (₹/UPI, cards,
 * netbanking, carrier billing in India; €/cards, PayPal, SEPA in Germany),
 * shows trial + renewal terms per Play policy, and checks out entirely
 * through Google Play Billing. Configure the template + localization
 * (EN/DE at minimum) in the RevenueCat dashboard; no app change needed
 * to restyle it afterwards.
 *
 * Returns unavailable when the native paywall module is missing (Expo Go /
 * web) or no key is configured — callers fall back to purchaseTier().
 */
export async function presentStorePaywall(): Promise<StorePaywallResult> {
  const mod = loadModule();
  if (!mod) return { status: 'unavailable' };
  let ui: {
    presentPaywall: (params?: Record<string, unknown>) => Promise<unknown>;
  } | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const paywalls = require('react-native-purchases-ui') as {
      RevenueCatUI?: { presentPaywall?: (params?: Record<string, unknown>) => Promise<unknown> };
    };
    if (typeof paywalls?.RevenueCatUI?.presentPaywall !== 'function') {
      return { status: 'unavailable' };
    }
    ui = paywalls.RevenueCatUI as {
      presentPaywall: (params?: Record<string, unknown>) => Promise<unknown>;
    };
  } catch {
    return { status: 'unavailable' };
  }
  try {
    const result = String(await ui.presentPaywall());
    if (result === 'PURCHASED' || result === 'RESTORED') {
      // Re-read store state: the update listener may lag behind dismissal.
      // Retry briefly so a verified payer never lands back on Free.
      let tier: PremiumTier = 'free';
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const info = await mod.getCustomerInfo();
          await syncTierFromCustomerInfo(info?.entitlements?.active ?? {});
        } catch {
          // Listener sync covers it; fall through to the local tier.
        }
        tier = normalizeTier(await getLocalTier());
        if (tier !== 'free' || __DEV__) break;
        await new Promise((r) => setTimeout(r, 1200));
      }
      return { status: 'purchased', tier };
    }
    if (result === 'CANCELLED') return { status: 'cancelled' };
    return { status: 'unavailable' };
  } catch {
    return { status: 'cancelled' };
  }
}
