/**
 * LiveSignals — the "everything else you logged" strip under At-a-glance.
 *
 * Only real, present values are passed in (missing = hidden, never a zero
 * tile). Each tile carries an hGraph-style range bar: the fill shows where
 * today's value sits in its healthy band, and the tone flips when it leaves
 * the band. Bars spring in with a per-tile stagger; all motion is UI-thread
 * shared values, gated on reduced-motion.
 */

import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withDelay,
} from 'react-native-reanimated';

import { mv, mvType } from '@/theme/movements';
import { useReducedMotion } from '@/theme/useReducedMotion';

export type SignalTone = 'good' | 'warn' | 'bad' | 'neutral';

export interface GlanceSignal {
  id: string;
  label: string;
  value: string;
  sub?: string;
  /** 0..1 position of the value inside its healthy band. */
  pct: number;
  tone: SignalTone;
}

const TONE_FILL: Record<SignalTone, string> = {
  // One-off alert red: health "out of range" needs a real red, which the
  // Movements+ tokens intentionally don't carry (hGraph convention).
  good: '#0B6852',
  warn: '#B97F1F',
  bad: '#D64545',
  neutral: mv.textOnLightPrimary,
};

function SignalTile({ signal, index }: { signal: GlanceSignal; index: number }) {
  const reduced = useReducedMotion();
  const p = useSharedValue(reduced ? signal.pct : 0);

  useEffect(() => {
    if (reduced) {
      p.value = signal.pct;
      return;
    }
    p.value = withDelay(
      500 + index * 70,
      withSpring(signal.pct, { duration: 600, dampingRatio: 0.85 }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signal.pct, reduced]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${Math.max(0, Math.min(1, p.value)) * 100}%` as never,
  }));

  return (
    <View style={styles.tile} accessible accessibilityLabel={`${signal.label}: ${signal.value}${signal.sub ? `, ${signal.sub}` : ''}`}>
      <Text style={styles.tileLabel} numberOfLines={1}>{signal.label}</Text>
      <Text style={styles.tileValue} numberOfLines={1} selectable>{signal.value}</Text>
      {signal.sub ? (
        <Text style={styles.tileSub} numberOfLines={1}>{signal.sub}</Text>
      ) : null}
      <View style={styles.track}>
        <Animated.View style={[styles.fill, { backgroundColor: TONE_FILL[signal.tone] }, fillStyle]} />
      </View>
    </View>
  );
}

export default function LiveSignals({ signals }: { signals: GlanceSignal[] }) {
  if (signals.length === 0) return null;
  return (
    <View style={styles.wrap}>
      <View style={styles.heading}>
        <View style={styles.liveDot} />
        <Text style={styles.headingText}>LIVE SIGNALS</Text>
      </View>
      <View style={styles.grid}>
        {signals.map((s, i) => (
          <SignalTile key={s.id} signal={s} index={i} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#0B6852' },
  headingText: {
    ...mvType.pill,
    color: mv.textOnLightSecondary,
    letterSpacing: 1.4,
    fontSize: 11,
    fontWeight: '800',
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 104,
    backgroundColor: mv.surfaceWhite,
    borderRadius: 20,
    borderCurve: 'continuous',
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 1,
    borderWidth: 1,
    borderColor: 'rgba(20,20,20,0.06)',
    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
  },
  tileLabel: {
    ...mvType.pill,
    color: mv.textOnLightSecondary,
    letterSpacing: 1.1,
    fontSize: 10,
    fontWeight: '800',
  },
  tileValue: {
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.3,
    lineHeight: 22,
    color: mv.textOnLightPrimary,
    fontVariant: ['tabular-nums'],
  },
  tileSub: { ...mvType.caption, color: mv.textOnLightSecondary, fontSize: 12 },
  track: {
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(20,20,20,0.08)',
    marginTop: 6,
    overflow: 'hidden',
  },
  fill: { height: 5, borderRadius: 3 },
});
