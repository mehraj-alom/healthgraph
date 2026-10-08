/**
 * premium.ts — Tiered premium entitlement.
 *
 * Tiers mirror PricingScreen / ProfileSheet Premium exactly:
 *   free    €0        — logging, meds, timeline, priority engines,
 *                       3 meal scans/mo, 2 AI messages/mo
 *   general €11/mo    — + trends, health graph & correlations, camera pulse,
 *                       priority engines, unlimited food, 4 document scans/mo,
 *                       AI chat limited (50/mo)
 *   allin   €18/mo    — + face pulse, 3D body, voice alarms & call reminders,
 *                       unlimited AI chat and scans ("Most complete")
 *
 * Source of truth priority: RevenueCat entitlement (services/billing.ts)
 * first, local AsyncStorage flag second (`__DEV__` builds are always allin
 * so feature testing works). Callers gate with `canUse(feature, tier)` or
 * the `<PaywallGate>` component — never with ad-hoc flags.
 */

import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type PremiumTier = 'free' | 'general' | 'allin';

const TIER_KEY = 'premium-tier-v1';
/** Legacy boolean flag (pre-tier). `1` maps to `general`. */
const LEGACY_KEY = 'premium-entitled-v1';

const TIER_RANK: Record<PremiumTier, number> = { free: 0, general: 1, allin: 2 };

export function normalizeTier(value: unknown): PremiumTier {
  return value === 'general' || value === 'allin' ? value : 'free';
}

/** Local tier read. RevenueCat sync (billing.ts) overwrites this on launch. */
export async function getLocalTier(): Promise<PremiumTier> {
  if (__DEV__) return 'allin';
  try {
    const stored = await AsyncStorage.getItem(TIER_KEY);
    if (stored === 'general' || stored === 'allin') return stored;
    // One-time legacy migration: entitled flag → general.
    if ((await AsyncStorage.getItem(LEGACY_KEY)) === '1') {
      await AsyncStorage.setItem(TIER_KEY, 'general');
      return 'general';
    }
  } catch {
    // Locked (safe) on storage failure.
  }
  return 'free';
}

/** Written by billing.ts after a verified purchase/restore. Nothing else writes tiers. */
export async function setLocalTier(tier: PremiumTier): Promise<void> {
  try {
    await AsyncStorage.setItem(TIER_KEY, tier);
  } catch {
    // Best-effort; a failed write keeps the previous (safer) tier.
  }
}

// ─── Capabilities ────────────────────────────────────────────────────────────

export type PremiumFeature =
  | 'trends'
  | 'correlations'
  | 'reportExport'
  | 'cameraPulse'
  | 'facePulse'
  | 'body3d'
  | 'voiceAlarms'
  | 'prescriptionScanner'
  | 'aiChat'
  | 'foodScan'
  | 'documentScan';

/** Minimum tier that unlocks each feature. Logging/meds/timeline need no gate. */
const MIN_TIER: Record<PremiumFeature, PremiumTier> = {
  trends: 'general',
  correlations: 'general',
  reportExport: 'general',
  cameraPulse: 'general',
  facePulse: 'allin',
  body3d: 'allin',
  voiceAlarms: 'allin',
  prescriptionScanner: 'general',
  aiChat: 'free', // free tier has a monthly quota instead of a lock
  foodScan: 'free', // free tier has a monthly quota instead of a lock
  documentScan: 'general', // general tier has a monthly quota instead of a lock
};

export function tierUnlocks(tier: PremiumTier, feature: PremiumFeature): boolean {
  return TIER_RANK[normalizeTier(tier)] >= TIER_RANK[MIN_TIER[feature]];
}

/** Monthly quota; null = unlimited. Exceeding it shows the paywall, not an error. */
export function monthlyQuota(tier: PremiumTier, feature: 'aiChat' | 'foodScan' | 'documentScan'): number | null {
  const t = normalizeTier(tier);
  if (t === 'allin') return null;
  if (feature === 'aiChat') return t === 'free' ? 2 : 50;
  if (feature === 'foodScan') return t === 'free' ? 3 : null;
  return t === 'free' ? 0 : 4; // documentScan
}

// ─── Monthly usage counters ──────────────────────────────────────────────────

function monthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function usageKey(feature: string): string {
  return `usage:${feature}:${monthKey()}`;
}

export async function getMonthlyUsage(feature: 'aiChat' | 'foodScan' | 'documentScan'): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(usageKey(feature));
    const n = raw == null ? 0 : Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** Returns false when the quota is exhausted (caller shows the paywall). */
export async function consumeQuota(
  tier: PremiumTier,
  feature: 'aiChat' | 'foodScan' | 'documentScan',
): Promise<boolean> {
  const quota = monthlyQuota(tier, feature);
  if (quota == null) return true;
  const used = await getMonthlyUsage(feature);
  if (used >= quota) return false;
  try {
    await AsyncStorage.setItem(usageKey(feature), String(used + 1));
  } catch {
    // Counting is best-effort; the action itself still proceeds.
  }
  return true;
}

// ─── React bindings ──────────────────────────────────────────────────────────

type TierListener = (tier: PremiumTier) => void;
const tierListeners = new Set<TierListener>();

/** Notify mounted hooks after a purchase / restore / sync changes the tier. */
export function notifyTierChanged(tier: PremiumTier): void {
  tierListeners.forEach((fn) => {
    try {
      fn(tier);
    } catch {
      // One bad listener must not break the rest.
    }
  });
}

/** Current tier — starts free (safe), resolves on mount, live-updates from billing. */
export function usePremiumTier(): PremiumTier {
  const [tier, setTier] = useState<PremiumTier>(__DEV__ ? 'allin' : 'free');
  useEffect(() => {
    let live = true;
    void getLocalTier().then((v) => {
      if (live) setTier(v);
    });
    const fn: TierListener = (v) => {
      if (live) setTier(v);
    };
    tierListeners.add(fn);
    return () => {
      live = false;
      tierListeners.delete(fn);
    };
  }, []);
  return tier;
}

/** Legacy boolean: entitled = any paid tier. Kept for existing call sites. */
export function usePremiumEntitled(): boolean {
  return usePremiumTier() !== 'free';
}

/** Legacy async boolean. Prefer getLocalTier() in new code. */
export async function isPremiumEntitled(): Promise<boolean> {
  return (await getLocalTier()) !== 'free';
}

/** Legacy writer. Prefer billing.ts purchase/restore flows in new code. */
export async function setPremiumEntitled(entitled: boolean): Promise<void> {
  await setLocalTier(entitled ? 'general' : 'free');
}
