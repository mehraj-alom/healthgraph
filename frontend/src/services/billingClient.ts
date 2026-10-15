/**
 * billingClient.ts — store purchase port + stub provider (pure).
 *
 * The app talks to the Play Store ONLY through BillingProvider. Today the
 * only provider is the stub (store unavailable: no SDK, no Console
 * products yet) — a real provider (react-native-iap or RevenueCat) slips
 * behind this interface later without touching callers. Verification
 * ALWAYS happens server-side (POST /api/v1/billing/verify); a store
 * receipt alone never unlocks anything.
 *
 * Zero imports: safe for node unit tests.
 */

export type PurchaseResult =
  | { status: 'purchased'; productId: string; purchaseToken: string }
  | { status: 'cancelled' }
  | { status: 'unavailable'; reason: string };

export interface BillingProvider {
  /** Provider name for logs and copy (never user data). */
  readonly name: string;
  /** True when this provider can open a real purchase sheet. */
  readonly canPurchase: boolean;
  purchase: (productId: string) => Promise<PurchaseResult>;
}

/**
 * Stub provider: the store integration is not installed yet. Every call
 * resolves unavailable — callers fall back to today's Free behavior and
 * nothing is ever charged.
 */
export const stubBillingProvider: BillingProvider = {
  name: 'stub',
  canPurchase: false,
  purchase: async (_productId: string): Promise<PurchaseResult> => ({
    status: 'unavailable',
    reason: 'store-unavailable',
  }),
};

/** The active provider. Swap for the real SDK provider at integration. */
export function activeBillingProvider(): BillingProvider {
  return stubBillingProvider;
}

export type PurchaseOutcome =
  | { action: 'verify'; productId: string; purchaseToken: string }
  | { action: 'stay' }
  | { action: 'fallback-free'; message: string };

/**
 * Pure purchase-flow decision: what the UI does next for each provider
 * result. 'verify' → call the backend; 'stay' → user cancelled, keep
 * them on screen to choose again; 'fallback-free' → store path failed,
 * today's Free behavior with an honest message.
 */
export function resolvePurchaseOutcome(result: PurchaseResult): PurchaseOutcome {
  switch (result.status) {
    case 'purchased':
      return {
        action: 'verify',
        productId: result.productId,
        purchaseToken: result.purchaseToken,
      };
    case 'cancelled':
      return { action: 'stay' };
    case 'unavailable':
    default:
      return {
        action: 'fallback-free',
        message: 'Subscriptions open soon. Nothing is charged today.',
      };
  }
}
