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
import { BlurView } from 'expo-blur';

import { Reveal } from '@/components/home/Reveal';
import { useToast } from '@/components/Toast';
import { productIdForPlan } from '@/services/billingProducts';
import { activeBillingProvider, resolvePurchaseOutcome } from '@/services/billingClient';
import { FONT, GV, SPACE, TYPE } from '@/theme/guava';
import { TILE_TONES } from '@/theme/tones';
import { useReducedMotion } from '@/theme/useReducedMotion';
import { StageGradient } from '@/components/StageGradient';

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
    badge: 'Recommended',
  },
];

/** Tier bands: Free wellbeing, General heart, All-in fitness. */
const TIER_TONES: Record<PricingPlan, string> = {
  free: TILE_TONES.wellbeing[0],
  general: TILE_TONES.heart[0],
  allin: TILE_TONES.fitness[0],
};

const VALUE_ROWS = [
  '3 days free before paid plans start',
  'Cancel anytime, keep access till then',
  'Free plan included forever',
];

export default function PricingScreen({ onDone }: { onDone: () => void }) {
  const [selected, setSelected] = useState<PricingPlan>('free');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  // Same frosted material as the profile sidebar: live blur over the
  // stage, brand tint for depth, solid stage under reduced motion.
  const glassOff = useReducedMotion();

  const finish = async (plan: PricingPlan): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await markPricingSeen(plan);
    } catch {
      // State below still moves forward — never trap anyone here.
    } finally {
      setBusy(false);
      onDone();
    }
  };

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
        const { refreshServerEntitlement } = await import('@/services/premium');
        await refreshServerEntitlement();
        await markPricingSeen(plan);
        onDone();
      } else {
        toast.info('Purchase could not be confirmed. Nothing is charged today.');
        await markPricingSeen(plan);
        onDone();
      }
    } catch {
      toast.info('Purchase failed. Nothing is charged today.');
      try {
        await markPricingSeen(plan);
      } catch {
        // Never trap anyone here.
      }
      onDone();
    } finally {
      setBusy(false);
    }
  };

  const picked = TIERS.find(t => t.id === selected) ?? TIERS[0];

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StageGradient />
      {glassOff ? (
        <View style={styles.glassSolid} />
      ) : (
        <BlurView tint="dark" intensity={84} style={[styles.glass, styles.glassTint]} />
      )}
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <Reveal>
          <Text style={styles.overline}>3 days free on paid plans</Text>
        </Reveal>
        <Reveal delay={120}>
          <Text style={styles.title}>Start free. Stay because it works.</Text>
        </Reveal>
        <Reveal delay={200}>
          <Text style={styles.sub}>Paid plans renew monthly. Cancel anytime.</Text>
        </Reveal>

        <View style={styles.rows}>
          {VALUE_ROWS.map((row, i) => (
            <Reveal key={row} delay={260 + i * 80}>
              <View style={styles.row}>
                <View style={styles.check}>
                  <Text style={styles.checkGlyph}>✓</Text>
                </View>
                <Text style={styles.rowText}>{row}</Text>
              </View>
            </Reveal>
          ))}
        </View>

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
                  style={({ pressed }) => [
                    styles.tier,
                    on && styles.tierOn,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <View style={[styles.tierBand, { backgroundColor: TIER_TONES[tier.id] }]} />
                  <View style={styles.tierHead}>
                    <View style={styles.tierNameRow}>
                      <Text style={styles.tierName}>{tier.name}</Text>
                      {tier.badge ? (
                        <View style={styles.badge}>
                          <Text style={styles.badgeText}>{tier.badge}</Text>
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
                </Pressable>
              </Reveal>
            );
          })}
        </View>

        <Text style={styles.renewNote}>
          Start with 3 days free. Then your plan auto-renews every month. Cancel anytime and keep access until the period ends.
        </Text>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          onPress={() => void (selected === 'free' ? finish(selected) : finishPaid(selected))}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={`Continue with ${picked.name}`}
          style={({ pressed }) => [
            styles.cta,
            pressed && { opacity: 0.9 },
            busy && { opacity: 0.7 },
          ]}
        >
          <Text style={styles.ctaText}>
            {busy ? 'Continuing…' : `Continue with ${picked.name}`}
          </Text>
          <Text style={styles.ctaChev}>›</Text>
        </Pressable>
        <Text style={styles.honestNote}>Subscriptions open soon. Nothing is charged today.</Text>
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
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: GV.stage,
  },
  glassSolid: {
    ...StyleSheet.absoluteFill,
    backgroundColor: GV.stage,
  },
  glass: {
    ...StyleSheet.absoluteFill,
  },
  glassTint: {
    backgroundColor: 'rgba(11, 74, 63, 0.62)',
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 16,
    gap: 12,
  },
  overline: {
    fontFamily: FONT.semi,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 3,
    color: GV.teal,
    textAlign: 'center',
  },
  title: {
    fontFamily: FONT.semi,
    fontSize: 32,
    lineHeight: 38,
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  sub: {
    ...TYPE.body,
    color: GV.fog,
    textAlign: 'center',
  },
  rows: {
    gap: 8,
    marginTop: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    minHeight: 48,
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    flexShrink: 0,
  },
  checkGlyph: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  rowText: {
    ...TYPE.body,
    fontSize: 13.5,
    color: '#FFFFFF',
    flex: 1,
  },
  tiers: {
    gap: 12,
    marginTop: 4,
  },
  tier: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.11)',
    padding: 16,
    gap: 6,
  },
  tierBand: {
    height: 4,
    borderRadius: 2,
    marginBottom: 6,
  },
  tierOn: {
    borderColor: GV.teal,
    backgroundColor: 'rgba(255, 255, 255, 0.09)',
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
  },
  tierName: {
    ...TYPE.button,
    fontSize: 16,
    color: '#FFFFFF',
  },
  badge: {
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    borderRadius: 11,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  badgeText: {
    fontFamily: FONT.semi,
    fontSize: 10.5,
    lineHeight: 14,
    letterSpacing: 0.2,
    color: 'rgba(255, 255, 255, 0.85)',
  },
  tierPrice: {
    fontFamily: FONT.bold,
    fontSize: 20,
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },
  tierPer: {
    fontFamily: FONT.regular,
    fontSize: 13,
    color: GV.fog,
  },
  tierTrial: {
    ...TYPE.caption,
    fontFamily: FONT.semi,
    color: GV.teal,
  },
  tierFeats: {
    ...TYPE.body,
    fontSize: 13.5,
    lineHeight: 21,
    color: GV.fog,
  },
  renewNote: {
    ...TYPE.caption,
    color: GV.fog,
    lineHeight: 18,
    paddingHorizontal: 4,
  },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 16,
    gap: 8,
  },
  cta: {
    backgroundColor: '#FFFFFF',
    borderRadius: 9999,
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  ctaText: {
    fontFamily: FONT.semi,
    fontSize: 16,
    lineHeight: 22,
    color: '#0C0C0E',
  },
  ctaChev: {
    fontSize: 22,
    lineHeight: 22,
    color: '#0C0C0E',
  },
  honestNote: {
    ...TYPE.caption,
    color: GV.fog,
    textAlign: 'center',
  },
  skipHit: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipText: {
    fontFamily: FONT.semi,
    fontSize: 14,
    lineHeight: 20,
    color: GV.fog,
  },
});
