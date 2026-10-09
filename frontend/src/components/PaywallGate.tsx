/**
 * PaywallGate — the single money barrier for every paid case.
 *
 * Wrap any premium surface: entitled tiers render children with zero
 * friction (no upsells, no locks — paying users use everything). Locked
 * tiers see the real surface blurred behind glass (a capped, non-touchable
 * preview) plus an honest lock card: what this is, which plan unlocks it,
 * one "See plans" action into Pricing, and a Restore purchases link
 * (Play policy). Quota-exhausted features (AI chat, scans) reuse the same
 * card with quota copy via the `quotaNote` prop.
 *
 * Privacy/perf escape hatch: `blurPreview={false}` renders the lock card
 * alone without mounting children — required where children activate
 * hardware (camera pulse) or heavy work (3D GL view, model downloads)
 * on mount. Those call sites document why.
 */

import { Children, useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { BlurView } from 'expo-blur';

import { GlassSurface } from '@/components/home/GlassSurface';
import { tierUnlocks, usePremiumTier, type PremiumFeature, type PremiumTier } from '@/services/premium';
import { restorePurchases } from '@/services/billing';
import { LG } from '@/theme/liquidGlass';

const SECONDARY = 'rgba(233,240,255,0.66)';
const TERTIARY = 'rgba(233,240,255,0.45)';

const TIER_LABEL: Record<PremiumTier, string> = {
  free: 'Free',
  general: 'General',
  allin: 'All-in',
};

const MIN_TIER_LABEL: Record<PremiumFeature, PremiumTier> = {
  trends: 'general',
  correlations: 'general',
  reportExport: 'general',
  cameraPulse: 'general',
  facePulse: 'allin',
  body3d: 'allin',
  voiceAlarms: 'allin',
  prescriptionScanner: 'general',
  aiChat: 'general',
  foodScan: 'general',
  documentScan: 'general',
};

interface PaywallGateProps {
  feature: PremiumFeature;
  /** Short name shown in the lock card, e.g. "Trends". */
  title: string;
  /** One-line outcome copy, e.g. "Your patterns across every engine." */
  body?: string;
  /** Set when a monthly quota ran out ("2 AI messages included in Free"). */
  quotaNote?: string;
  /**
   * Render children blurred behind the lock card for locked tiers.
   * Default true when children exist. Set false where children must not
   * mount locked (camera hardware, 3D GL view / model downloads).
   */
  blurPreview?: boolean;
  /** Capped preview height so the tease never pushes the pitch off-screen. */
  previewHeight?: number;
  children: React.ReactNode;
}

export function PaywallGate({
  feature,
  title,
  body,
  quotaNote,
  blurPreview,
  previewHeight = 420,
  children,
}: PaywallGateProps) {
  const tier = usePremiumTier();
  const navigation = useNavigation();
  const [restoring, setRestoring] = useState(false);
  const [restored, setRestored] = useState<string | null>(null);

  const goPlans = useCallback(() => {
    // Pricing lives on the root stack; gated screens sit in tabs or nested
    // stacks, so walk up until a navigator accepts it. Never throws.
    const nav = navigation as unknown as {
      navigate: (route: string) => void;
      getParent?: () => unknown;
    };
    let current: unknown = nav;
    for (let depth = 0; depth < 4; depth++) {
      try {
        (current as { navigate: (route: string) => void }).navigate('Pricing');
        return;
      } catch {
        const parent = (current as { getParent?: () => unknown })?.getParent?.();
        if (!parent) return;
        current = parent;
      }
    }
  }, [navigation]);

  const onRestore = useCallback(async () => {
    if (restoring) return;
    setRestoring(true);
    setRestored(null);
    try {
      const resolved = await restorePurchases();
      if (resolved === 'free') {
        setRestored('No purchases found on this account.');
      } else {
        const { reportPremiumPurchase } = await import('@/services/premiumSync');
        void reportPremiumPurchase(resolved);
        setRestored(`Restored — ${TIER_LABEL[resolved]} is active.`);
      }
    } catch {
      setRestored('Restore failed — check your connection and retry.');
    } finally {
      setRestoring(false);
    }
  }, [restoring]);

  if (tierUnlocks(tier, feature) && !quotaNote) {
    return <>{children}</>;
  }

  const lockCard = (
    <GlassSurface strong style={styles.card}>
      <View style={styles.glyphWrap}>
        <Text style={styles.glyph}>✦</Text>
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>
        {quotaNote ?? body ?? `Available on ${TIER_LABEL[MIN_TIER_LABEL[feature]]} and above.`}
      </Text>
      {!quotaNote ? (
        <Text style={styles.planNote}>
          {`Included in ${TIER_LABEL[MIN_TIER_LABEL[feature]]} — 3 days free, cancel anytime.`}
        </Text>
      ) : null}
      <Pressable
        onPress={goPlans}
        accessibilityRole="button"
        accessibilityLabel={`See plans to unlock ${title}`}
        style={({ pressed }) => [styles.cta, pressed && { opacity: 0.9 }]}
      >
        <Text style={styles.ctaText}>See plans</Text>
      </Pressable>
      <Pressable
        onPress={() => void onRestore()}
        disabled={restoring}
        accessibilityRole="button"
        accessibilityLabel="Restore purchases"
        hitSlop={12}
        style={styles.restoreHit}
      >
        <Text style={styles.restoreText}>{restoring ? 'Restoring…' : 'Restore purchases'}</Text>
      </Pressable>
      {restored ? <Text style={styles.restoredNote}>{restored}</Text> : null}
    </GlassSurface>
  );

  // Free/restricted tiers see the real surface blurred — desire, not a
  // blank wall. The preview is capped, dimmed, and untouchable; the lock
  // card below pitches the unlocking plan.
  const showPreview =
    (blurPreview ?? true) && Children.count(children) > 0;
  if (!showPreview) return lockCard;

  return (
    <View style={styles.teaseWrap}>
      <View style={[styles.teasePreviewBox, { height: previewHeight }]}>
        <View
          pointerEvents="none"
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
          style={styles.teasePreview}
        >
          {children}
        </View>
        <BlurView tint="dark" intensity={32} style={StyleSheet.absoluteFill} />
      </View>
      <View style={styles.teaseLock}>{lockCard}</View>
    </View>
  );
}

/** Open Pricing from any handler (quota exhausted, locked CTA). Same parent-walk. */
export function useOpenPricing(): () => void {
  const navigation = useNavigation();
  return useCallback(() => {
    const nav = navigation as unknown as {
      navigate: (route: string) => void;
      getParent?: () => unknown;
    };
    let current: unknown = nav;
    for (let depth = 0; depth < 4; depth++) {
      try {
        (current as { navigate: (route: string) => void }).navigate('Pricing');
        return;
      } catch {
        const parent = (current as { getParent?: () => unknown })?.getParent?.();
        if (!parent) return;
        current = parent;
      }
    }
  }, [navigation]);
}

const styles = StyleSheet.create({
  card: { padding: 20, alignItems: 'center', gap: 8 },
  // Blurred tease: capped preview box (untouchable live surface under
  // glass) with the sharp lock card pitched directly below it.
  teaseWrap: { gap: 12 },
  teasePreviewBox: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  teasePreview: { opacity: 0.92 },
  teaseLock: {},
  glyphWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(92,232,184,0.14)',
  },
  glyph: { fontSize: 20, color: LG.card.mint },
  title: { fontWeight: '600', fontSize: 20, lineHeight: 26, letterSpacing: -0.4, color: '#FFFFFF', textAlign: 'center' },
  body: { fontWeight: '400', fontSize: 15, lineHeight: 21, color: SECONDARY, textAlign: 'center' },
  planNote: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: TERTIARY, textAlign: 'center' },
  cta: {
    marginTop: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 9999,
    paddingHorizontal: 28,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: { fontWeight: '600', fontSize: 16, color: '#0B0F1A' },
  restoreHit: { paddingVertical: 8, paddingHorizontal: 16 },
  restoreText: { fontWeight: '400', fontSize: 14, color: SECONDARY, textAlign: 'center' },
  restoredNote: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: TERTIARY, textAlign: 'center' },
});
