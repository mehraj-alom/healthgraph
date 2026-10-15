/**
 * premium.ts — Local premium entitlement cache.
 *
 * Server truth lives in GET /api/v1/profile (premium_tier, written only
 * by POST /api/v1/billing/verify after a Play purchase is verified).
 * This module caches that verdict on-device:
 *   - `__DEV__` builds are always entitled (feature testing must work).
 *   - Release builds default to the Free tier (locked) until a verified
 *     purchase — or a server refresh — writes the flag.
 *
 * Callers gate premium-only entry points (e.g. the prescription scanner)
 * and show the upsell (Profile → Premium) when locked. Load entitlement
 * with the hook below — never block render on it.
 */

import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PREMIUM_KEY = 'premium-entitled-v1';

/** True when the prescription scanner and other premium features unlock. */
export async function isPremiumEntitled(): Promise<boolean> {
  if (__DEV__) return true;
  try {
    return (await AsyncStorage.getItem(PREMIUM_KEY)) === '1';
  } catch {
    return false;
  }
}

/** Written by the future purchase flow. Kept isolated for that swap. */
export async function setPremiumEntitled(entitled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(PREMIUM_KEY, entitled ? '1' : '0');
  } catch {
    // Entitlement persistence is best-effort; failure = locked (safe).
  }
}

/**
 * Refresh the local flag from server truth (GET profile premium_tier).
 * Call after a verified purchase and on app start. Any failure keeps the
 * current flag — an offline user is never locked out by a failed fetch.
 */
export async function refreshServerEntitlement(): Promise<boolean> {
  try {
    const { api } = await import('./api');
    const profile = await api.get<{ premium_tier?: string | null }>('/api/v1/profile');
    const entitled =
      typeof profile?.premium_tier === 'string' && profile.premium_tier !== 'free';
    await setPremiumEntitled(entitled);
    return entitled;
  } catch {
    return false;
  }
}

/** React binding — starts locked (safe), resolves on mount. */
export function usePremiumEntitled(): boolean {
  const [entitled, setEntitled] = useState<boolean>(__DEV__);
  useEffect(() => {
    let live = true;
    isPremiumEntitled().then((v) => {
      if (live) setEntitled(v);
    });
    return () => {
      live = false;
    };
  }, []);
  return entitled;
}
