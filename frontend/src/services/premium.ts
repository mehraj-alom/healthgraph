/**
 * premium.ts — Local premium entitlement cache.
 *
 * TESTING BYPASS (2026-10-16): paywall removed so every feature (PPG,
 * rPPG, food scan, documents, prescription scanner, chat, all engines)
 * is usable without purchase. All helpers below return entitled.
 * TODO: re-enable real entitlement checks before store release.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const PREMIUM_KEY = 'premium-entitled-v1';

/** True when the prescription scanner and other premium features unlock. */
export async function isPremiumEntitled(): Promise<boolean> {
  // TESTING: paywall off — everything unlocked.
  return true;
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
  // TESTING: paywall off — never lock out.
  try {
    await setPremiumEntitled(true);
  } catch {
    // best-effort
  }
  return true;
}

/** React binding — starts locked (safe), resolves on mount. */
export function usePremiumEntitled(): boolean {
  // TESTING: paywall off — everything unlocked.
  return true;
}
