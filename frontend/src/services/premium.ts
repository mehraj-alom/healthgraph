/**
 * premium.ts — Local premium entitlement.
 *
 * There is no billing backend yet (ProfileSheet shows static tiers), so
 * entitlement is a simple on-device flag:
 *   - `__DEV__` builds are always entitled (feature testing must work).
 *   - Release builds default to the Free tier (locked) until a purchase
 *     flow writes the flag.
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
