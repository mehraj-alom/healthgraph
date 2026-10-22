/**
 * premium.ts — Premium entitlement: server truth, with the tier API the
 * liquid-glass UI (PaywallGate, premium-aware screens) reads.
 *
 * Source of truth: the backend. GET /api/v1/profile returns `premium_tier`
 * ('free' | 'general' | 'allin'); the store is verified server-side through
 * POST /api/v1/billing/verify. The local value is only a cache of the
 * server's answer — a receipt alone never unlocks anything.
 *
 * Tiers (mirror PricingScreen / ProfileSheet):
 *   free    — logging, meds, timeline, priority engines, small quotas
 *   general — + trends, correlations, camera pulse, report export
 *   allin   — + face pulse, 3D body, voice alarms, unlimited chat/scans
 *
 * TESTING BYPASS (2026-10-16): the paywall is OFF so every feature (PPG,
 * rPPG, food scan, documents, prescription scanner, chat, all engines) is
 * usable without purchase. Only the RESOLVED tier is forced to 'allin' —
 * the server-truth plumbing below is intact, so re-enabling real checks
 * before store release is a one-line change (drop TESTING_BYPASS_TIER).
 * Without it a release build (not __DEV__) would gate face pulse behind
 * the 'allin' tier and the face rPPG screen would never open.
 */

import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type PremiumTier = 'free' | 'general' | 'allin';

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

/**
 * TESTING BYPASS: force the effective tier to 'allin' so nothing is
 * paywalled. Delete this constant (and its two uses) to re-enable real
 * entitlement checks.
 */
const TESTING_BYPASS_TIER: PremiumTier | null = 'allin';

const TIER_KEY = 'premium-tier-v1';
/** Legacy boolean flag (pre-tier). `1` maps to 'general'. */
const LEGACY_KEY = 'premium-entitled-v1';
/** Redeemed-code grant (web-bought HG-XXXX-XXXX codes, support comps). */
const GRANT_KEY = 'premium-code-grant-v1';

const TIER_RANK: Record<PremiumTier, number> = { free: 0, general: 1, allin: 2 };

/** Minimum tier required for a locked feature. */
const MIN_TIER: Record<PremiumFeature, PremiumTier> = {
  trends: 'general',
  correlations: 'general',
  reportExport: 'general',
  cameraPulse: 'general',
  facePulse: 'allin',
  body3d: 'allin',
  voiceAlarms: 'allin',
  prescriptionScanner: 'general',
  aiChat: 'free',
  foodScan: 'free',
  documentScan: 'general',
};

export function normalizeTier(value: unknown): PremiumTier {
  return value === 'general' || value === 'allin' ? value : 'free';
}

function maxTier(a: PremiumTier, b: PremiumTier): PremiumTier {
  return TIER_RANK[a] >= TIER_RANK[b] ? a : b;
}

/** True when the tier unlocks the feature outright (not quota-gated). */
export function tierUnlocks(tier: PremiumTier, feature: PremiumFeature): boolean {
  return TIER_RANK[normalizeTier(tier)] >= TIER_RANK[MIN_TIER[feature]];
}

/** Monthly quota; null = unlimited. Exceeding it shows the paywall. */
export function monthlyQuota(
  tier: PremiumTier,
  feature: 'aiChat' | 'foodScan' | 'documentScan',
): number | null {
  const t = normalizeTier(tier);
  if (t === 'allin') return null;
  if (feature === 'aiChat') return t === 'free' ? 2 : 50;
  if (feature === 'foodScan') return t === 'free' ? 3 : null;
  return t === 'free' ? 0 : 4; // documentScan
}

// ─── Code grants ─────────────────────────────────────────────────────────────

export async function getCodeGrant(): Promise<{ tier: PremiumTier; expiresAt: string } | null> {
  try {
    const raw = await AsyncStorage.getItem(GRANT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { tier?: unknown; expiresAt?: unknown };
    const tier = normalizeTier(parsed.tier);
    const expiresAt = typeof parsed.expiresAt === 'string' ? parsed.expiresAt : '';
    if (!expiresAt) return null;
    if (Date.parse(expiresAt) <= Date.now()) return null;
    return { tier, expiresAt };
  } catch {
    return null;
  }
}

export async function setCodeGrant(tier: PremiumTier, expiresAt: string): Promise<void> {
  try {
    await AsyncStorage.setItem(GRANT_KEY, JSON.stringify({ tier, expiresAt }));
  } catch {
    // Best-effort; a failed write simply means no grant.
  }
}

/** Merge a code grant ABOVE the store tier so a live grant is never wiped. */
export function withGrant(
  storeTier: PremiumTier,
  grant: { tier: PremiumTier } | null,
): PremiumTier {
  if (!grant) return storeTier;
  return maxTier(storeTier, grant.tier);
}

// ─── Local cache ────────────────────────────────────────────────────────────

/** Local tier read. The server answer is written here by refreshServerEntitlement. */
export async function getLocalTier(): Promise<PremiumTier> {
  if (TESTING_BYPASS_TIER) return TESTING_BYPASS_TIER;
  if (__DEV__) return 'allin';
  let stored: PremiumTier = 'free';
  try {
    const raw = await AsyncStorage.getItem(TIER_KEY);
    if (raw === 'general' || raw === 'allin') stored = raw;
    // One-time legacy migration: entitled flag → general.
    else if ((await AsyncStorage.getItem(LEGACY_KEY)) === '1') {
      await AsyncStorage.setItem(TIER_KEY, 'general');
      stored = 'general';
    }
  } catch {
    // Locked (safe) on storage failure.
  }
  return withGrant(stored, await getCodeGrant());
}

/** Written after a server-verified purchase/restore. */
export async function setLocalTier(tier: PremiumTier): Promise<void> {
  try {
    await AsyncStorage.setItem(TIER_KEY, tier);
  } catch {
    // Best-effort; a failed write keeps the previous (safer) tier.
  }
}

// ─── Server truth ───────────────────────────────────────────────────────────

/**
 * Refresh the local tier from server truth (GET profile premium_tier).
 * Call after a verified purchase and on app start. Any failure keeps the
 * current tier — an offline user is never locked out by a failed fetch.
 */
export async function refreshServerEntitlement(): Promise<boolean> {
  if (TESTING_BYPASS_TIER) {
    await setLocalTier(TESTING_BYPASS_TIER);
    return true;
  }
  try {
    const { api } = await import('@/services/api');
    const profile = await api.get<{ premium_tier?: string | null }>('/api/v1/profile');
    const tier = normalizeTier(profile?.premium_tier);
    await setLocalTier(tier);
    return tier !== 'free';
  } catch {
    // Offline / not signed in: keep whatever we already had.
    return false;
  }
}

/** True when the prescription scanner and other premium features unlock. */
export async function isPremiumEntitled(): Promise<boolean> {
  if (TESTING_BYPASS_TIER) return true;
  return (await getLocalTier()) !== 'free';
}

/** Written by the future purchase flow. Kept isolated for that swap. */
export async function setPremiumEntitled(entitled: boolean): Promise<void> {
  await setLocalTier(entitled ? 'general' : 'free');
}

// ─── Monthly usage counters ──────────────────────────────────────────────────

function monthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function usageKey(feature: string): string {
  return `usage:${feature}:${monthKey()}`;
}

export async function getMonthlyUsage(
  feature: 'aiChat' | 'foodScan' | 'documentScan',
): Promise<number> {
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

// ─── React bindings ─────────────────────────────────────────────────────────

type TierListener = (tier: PremiumTier) => void;
const tierListeners = new Set<TierListener>();

/** Announce a tier change to every mounted consumer. */
export function notifyTierChanged(tier: PremiumTier): void {
  tierListeners.forEach((fn) => {
    try {
      fn(tier);
    } catch {
      // One bad listener must not break the rest.
    }
  });
}

/** Current tier — resolves on mount, live-updates from the server refresh. */
export function usePremiumTier(): PremiumTier {
  const [tier, setTier] = useState<PremiumTier>(
    TESTING_BYPASS_TIER ?? (__DEV__ ? 'allin' : 'free'),
  );
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
