/**
 * billingProducts.ts — Play product catalog (pure).
 *
 * The single client-side map of paid tiers to Play subscription product
 * ids. These ids must exist in the Play Console before any purchase can
 * succeed; unknown ids never reach the store (fail closed at lookup).
 * Prices here are display strings mirroring PricingScreen — Play is the
 * price authority at purchase time.
 *
 * Zero imports: safe for node unit tests.
 */

export type PaidPlan = 'general' | 'allin';

export interface BillingProduct {
  plan: PaidPlan;
  /** Play Console subscription product id. */
  productId: string;
  name: string;
  price: string;
}

export const BILLING_PRODUCTS: Record<PaidPlan, BillingProduct> = {
  general: {
    plan: 'general',
    productId: 'hg_general_monthly',
    name: 'General',
    price: '€11/mo',
  },
  allin: {
    plan: 'allin',
    productId: 'hg_allin_monthly',
    name: 'All-in',
    price: '€18/mo',
  },
};

/** Product id for a paid plan, or null for Free/unknown (never purchase). */
export function productIdForPlan(plan: string | null | undefined): string | null {
  if (plan === 'general') return BILLING_PRODUCTS.general.productId;
  if (plan === 'allin') return BILLING_PRODUCTS.allin.productId;
  return null;
}

/** Paid tier for a Play product id, or null when unknown. */
export function planForProductId(productId: string | null | undefined): PaidPlan | null {
  if (typeof productId !== 'string') return null;
  for (const product of Object.values(BILLING_PRODUCTS)) {
    if (product.productId === productId) return product.plan;
  }
  return null;
}
