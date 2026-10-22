import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { Reveal } from '@/components/home/Reveal';
import { GlassSurface } from '@/components/home/GlassSurface';
import { HomeStageBackdrop } from '@/components/home/HomeStageBackdrop';
import { activeBillingProvider, resolvePurchaseOutcome } from '@/services/billingClient';
import { productIdForPlan } from '@/services/billingProducts';
import { refreshServerEntitlement, getLocalTier, notifyTierChanged } from '@/services/premium';
import { useToast } from '@/components/Toast';
import { LG } from '@/theme/liquidGlass';

/**
 * PricingScreen — shown once, right after signup (never after login).
 *
 * Same tiers and terms as the rest of the app (ProfileSheet Premium,
 * marketing page): Free €0, General €11/mo, All-in €18/mo, 3 days free
 * on paid plans, monthly renewal, cancel anytime. The only way forward
 * is a visible continue path — this screen can never trap anyone.
 */

const NEEDED_KEY = 'hg:pricingNeeded:v1';
const PLAN_KEY = 'hg:selectedPlan:v1';

const SECONDARY = 'rgba(233,240,255,0.66)';
const TERTIARY = 'rgba(233,240,255,0.45)';

export type PricingPlan = 'free' | 'general' | 'allin';

/** Flag a brand-new signup so the App gate shows pricing once. */
export async function markPricingNeeded(): Promise<void> {
  await AsyncStorage.setItem(NEEDED_KEY, '1');
}

/** True only for a fresh signup that has not seen pricing yet. */
export async function shouldShowPricing(): Promise<boolean> {
  const value = await AsyncStorage.getItem(NEEDED_KEY);
  return value === '1';
}

/** Clear a stale flag (failed signup, fresh sign-out, login). */
export async function clearPricingNeeded(): Promise<void> {
  await AsyncStorage.removeItem(NEEDED_KEY);
}

/** Record the pick and clear the flag. Never throws to callers. */
export async function markPricingSeen(plan: PricingPlan): Promise<void> {
  await AsyncStorage.setItem(PLAN_KEY, plan);
  await AsyncStorage.removeItem(NEEDED_KEY);
}

/** The locally picked plan (default Free). Display-only; billing is separate. */
export async function getSelectedPlan(): Promise<PricingPlan> {
  const value = await AsyncStorage.getItem(PLAN_KEY);
  return value === 'general' || value === 'allin' ? value : 'free';
}

interface TierDef {
  id: PricingPlan;
  name: string;
  price: string;
  per: string;
  trial: string;
  feats: string;
  badge?: string;
}

const TIERS: TierDef[] = [
  {
    id: 'free',
    name: 'Free',
    price: '€0',
    per: '',
    trial: 'Free forever',
    feats: 'Daily logging, meds, timeline\n3 meal scans a month\n2 AI messages a month',
  },
  {
    id: 'general',
    name: 'General',
    price: '€11',
    per: '/mo',
    trial: '3 days free',
    feats: 'Everything in Free, unlimited\nCamera pulse, health graph\n4 document scans a month',
  },
  {
    id: 'allin',
    name: 'All-in',
    price: '€18',
    per: '/mo',
    trial: '3 days free',
    feats: 'Everything in General\nFace pulse, 3D body, voice alarms\nUnlimited AI chat and scans',
    badge: 'Most complete',
  },
];

const VALUE_ROWS = [
  '3 days free before paid plans start',
  'Cancel anytime, keep access till then',
  'Free plan included forever',
];

export default function PricingScreen({ onDone }: { onDone: () => void }) {
  const [selected, setSelected] = useState<PricingPlan>('free');
  const [busy, setBusy] = useState(false);
  const [payNote, setPayNote] = useState<string | null>(null);
  const toast = useToast();

  /**
   * Paid continue: attempt a real store purchase, then verify it with
   * the backend before unlocking anything. Every failure path falls
   * back to today's Free behavior with the honest note — the screen
   * can never trap anyone mid-purchase.
   */
  const finishPaid = async (plan: PricingPlan): Promise<void> => {
    if (busy) return;
    const productId = productIdForPlan(plan);
    if (productId === null) {
      await finish('free');
      return;
    }
    setBusy(true);
    try {
      const outcome = resolvePurchaseOutcome(
        await activeBillingProvider().purchase(productId),
      );
      if (outcome.action === 'stay') {
        // Cancelled: stay on screen so they can choose again or skip.
        return;
      }
      if (outcome.action === 'fallback-free') {
        toast.info(outcome.message);
        await markPricingSeen(plan);
        onDone();
        return;
      }
      const { api } = await import('@/services/api');
      const receipt = await api.post<{ tier: string; premium: boolean }>(
        '/api/v1/billing/verify',
        { product_id: outcome.productId, purchase_token: outcome.purchaseToken },
      );
      if (receipt?.premium === true) {
        await refreshServerEntitlement();
        const active = await getLocalTier();
        notifyTierChanged(active);
        await markPricingSeen(active);
        onDone();
      } else {
        toast.info('Purchase could not be confirmed. Nothing is charged today.');
        await markPricingSeen(plan);
        onDone();
      }
    } catch {
      toast.info('Purchase failed — nothing was charged. Please retry.');
    } finally {
      setBusy(false);
    }
  };

  const finish = async (plan: PricingPlan): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setPayNote(null);
    try {
      if (plan === 'free') {
        await markPricingSeen(plan);
        onDone();
        return;
      }
      // Paid pick goes through Google Play Billing behind a provider
      // abstraction. The screen never advances on a paid plan without a
      // SERVER-VERIFIED purchase — cancel or failure keeps the user here
      // with an honest note, never trapped.
      await finishPaid(plan);
    } catch {
      setPayNote('Something went wrong — nothing was charged. Please retry.');
    } finally {
      setBusy(false);
    }
  };

  const onRestore = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setPayNote(null);
    try {
      await refreshServerEntitlement();
      const tier = await getLocalTier();
      if (tier === 'free') {
        setPayNote('No purchases found on this Play account.');
      } else {
        notifyTierChanged(tier);
        await markPricingSeen(tier);
        onDone();
      }
    } catch {
      setPayNote('Restore failed — check your connection and retry.');
    } finally {
      setBusy(false);
    }
  };

  const picked = TIERS.find(t => t.id === selected) ?? TIERS[0];
  const paidPick = picked?.id !== 'free';

  return (
    <View style={styles.root}>
      <HomeStageBackdrop />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          <Reveal>
            <View style={styles.ornamentWrap}>
              <View style={styles.ornament}>
                <Text style={styles.ornamentGlyph}>✦</Text>
              </View>
            </View>
          </Reveal>
          <Reveal delay={120}>
            <Text style={styles.title}>Unlock everything</Text>
          </Reveal>
          <Reveal delay={200}>
            <Text style={styles.sub}>Every engine, unlimited AI — free for 3 days.</Text>
          </Reveal>

          <Reveal delay={260}>
            <GlassSurface strong style={styles.rowsCard}>
              {VALUE_ROWS.map((row, i) => (
                <View key={row} style={[styles.row, i > 0 && styles.rowDivider]}>
                  <View style={styles.check}>
                    <Text style={styles.checkGlyph}>✓</Text>
                  </View>
                  <Text style={styles.rowText}>{row}</Text>
                </View>
              ))}
            </GlassSurface>
          </Reveal>

          <View style={styles.tiers}>
            {TIERS.map((tier, i) => {
              const on = tier.id === selected;
              return (
                <Reveal key={tier.id} delay={480 + i * 90}>
                  <Pressable
                    onPress={() => setSelected(tier.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={`${tier.name}, ${tier.price}${tier.per}, ${tier.trial}`}
                    style={({ pressed }) => [pressed && { opacity: 0.85 }]}
                  >
                    <GlassSurface
                      strong
                      noSheen
                      style={[styles.tier, on && styles.tierOn]}
                    >
                      <View style={styles.tierHead}>
                        <View style={styles.tierNameRow}>
                          <Text style={styles.tierName}>{tier.name}</Text>
                          {tier.badge ? (
                            <View style={styles.badge}>
                              <Text style={styles.badgeText}>{tier.badge}</Text>
                            </View>
                          ) : null}
                          {tier.id === 'free' ? (
                            <View style={styles.currentChip}>
                              <Text style={styles.currentChipText}>Your current plan</Text>
                            </View>
                          ) : null}
                        </View>
                        <Text style={styles.tierPrice}>
                          {tier.price}
                          {tier.per ? <Text style={styles.tierPer}>{tier.per}</Text> : null}
                        </Text>
                      </View>
                      <Text style={styles.tierTrial}>{tier.trial}</Text>
                      <Text style={styles.tierFeats}>{tier.feats}</Text>
                    </GlassSurface>
                  </Pressable>
                </Reveal>
              );
            })}
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            onPress={() => void finish(selected)}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={paidPick ? 'Start 3 days free' : 'Continue with Free'}
            style={({ pressed }) => [
              styles.cta,
              pressed && !busy && { opacity: 0.9 },
              busy && { opacity: 0.7 },
            ]}
          >
            <Text style={styles.ctaText}>
              {busy ? 'Continuing…' : paidPick ? 'Start 3 days free' : 'Continue with Free'}
            </Text>
          </Pressable>
          <Text style={styles.trustNote}>
            {paidPick
              ? '3 days free, then monthly. Cancel anytime — you keep access until the period ends.'
              : 'Free forever — upgrade anytime.'}
          </Text>
          {payNote ? <Text style={styles.payNote}>{payNote}</Text> : null}
          <Text style={styles.honestNote}>Billed through Google Play. Nothing is charged today.</Text>
          <Pressable
            onPress={() => void onRestore()}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Restore purchases"
            hitSlop={12}
            style={styles.skipHit}
          >
            <Text style={styles.skipText}>Restore purchases</Text>
          </Pressable>
          <Pressable
            onPress={() => void finish('free')}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Skip for now, continue with Free"
            hitSlop={12}
            style={styles.skipHit}
          >
            <Text style={styles.skipText}>Not now</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05070F' },
  safe: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 16,
    gap: 12,
  },
  // The one sparkle: mint star marks the premium moment.
  ornamentWrap: { alignItems: 'center', marginTop: 4 },
  ornament: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(92, 232, 184, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(92, 232, 184, 0.4)',
  },
  ornamentGlyph: { color: LG.card.mint, fontSize: 18, lineHeight: 22 },
  title: {
    fontWeight: '600',
    fontSize: 34,
    lineHeight: 41,
    letterSpacing: -0.8,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  sub: {
    fontWeight: '400',
    fontSize: 15,
    lineHeight: 21,
    color: SECONDARY,
    textAlign: 'center',
  },
  rowsCard: { paddingHorizontal: 16, paddingVertical: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    minHeight: 48,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255, 255, 255, 0.12)',
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(92, 232, 184, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(92, 232, 184, 0.4)',
    flexShrink: 0,
  },
  checkGlyph: { color: LG.card.mint, fontSize: 13, fontWeight: '600' },
  rowText: {
    fontWeight: '400',
    fontSize: 13.5,
    lineHeight: 19,
    color: '#FFFFFF',
    flex: 1,
  },
  tiers: { gap: 12, marginTop: 4 },
  tier: { padding: 16, gap: 6, borderWidth: 1.5, borderColor: 'transparent' },
  tierOn: {
    borderColor: 'rgba(92, 232, 184, 0.55)',
  },
  tierHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  tierNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    flexWrap: 'wrap',
  },
  tierName: {
    fontWeight: '600',
    fontSize: 16,
    lineHeight: 21,
    letterSpacing: -0.2,
    color: '#FFFFFF',
  },
  // One recommendation: the eye lands here.
  badge: {
    backgroundColor: 'rgba(92, 232, 184, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(92, 232, 184, 0.4)',
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  badgeText: {
    fontWeight: '600',
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: LG.card.mint,
  },
  // Free tier is respected, never a taunt.
  currentChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  currentChipText: {
    fontWeight: '600',
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: SECONDARY,
  },
  tierPrice: {
    fontWeight: '700',
    fontSize: 20,
    lineHeight: 24,
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },
  tierPer: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: SECONDARY },
  tierTrial: {
    fontWeight: '600',
    fontSize: 13,
    lineHeight: 18,
    color: LG.card.mint,
  },
  tierFeats: {
    fontWeight: '400',
    fontSize: 13.5,
    lineHeight: 21,
    color: SECONDARY,
  },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 16,
    gap: 8,
  },
  // Single white pill: the prominent action on dark.
  cta: {
    backgroundColor: '#FFFFFF',
    borderRadius: 9999,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    fontWeight: '600',
    fontSize: 16,
    lineHeight: 22,
    letterSpacing: -0.2,
    color: '#0B0F1A',
  },
  trustNote: {
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: SECONDARY,
    textAlign: 'center',
  },
  honestNote: {
    fontWeight: '400',
    fontSize: 12,
    lineHeight: 17,
    color: TERTIARY,
    textAlign: 'center',
  },
  payNote: {
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  skipHit: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipText: {
    fontWeight: '600',
    fontSize: 14,
    lineHeight: 20,
    color: SECONDARY,
  },
});
