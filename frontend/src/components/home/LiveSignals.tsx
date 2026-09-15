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
import { PressScale } from '@/components/PressScale';

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

const TONE_DOT: Record<SignalTone, string> = {
  good: '#4E9B5F',
  warn: '#E8862E',
  bad: '#C2503E',
  neutral: '#A8A094',
};

/** Fill rule: sage when good, terracotta otherwise. */
function fillFor(tone: SignalTone): string {
  return tone === 'good' ? '#4E9B5F' : '#C2503E';
}

function SignalTile({ signal, index, onPress }: { signal: GlanceSignal; index: number; onPress?: (id: string) => void }) {
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

  const body = (
    <View style={styles.tile} accessible accessibilityLabel={`${signal.label}: ${signal.value}${signal.sub ? `, ${signal.sub}` : ''}`}>
      <View style={styles.tileTopRow}>
        <Text style={styles.tileLabel} numberOfLines={1}>{signal.label}</Text>
        <View style={[styles.toneDot, { backgroundColor: TONE_DOT[signal.tone] }]} />
      </View>
      <Text style={styles.tileValue} numberOfLines={1} selectable>{signal.value}</Text>
      {signal.sub ? (
        <Text style={styles.tileSub} numberOfLines={1}>{signal.sub}</Text>
      ) : null}
      <View style={styles.track}>
        <Animated.View style={[styles.fill, { backgroundColor: fillFor(signal.tone) }, fillStyle]} />
      </View>
    </View>
  );
  // Fluffy + tappable only when a destination exists — otherwise a static tile.
  // Both cases keep the grid sizing wrapper so layout never shifts.
  if (!onPress) return <View style={styles.tilePress}>{body}</View>;
  return (
    <PressScale
      onPress={() => onPress(signal.id)}
      accessibilityLabel={`${signal.label}: ${signal.value}. Open details.`}
      scaleTo={0.94}
      style={styles.tilePress}
    >
      {body}
    </PressScale>
  );
}

export default function LiveSignals({ signals, onSignalPress }: { signals: GlanceSignal[]; onSignalPress?: (id: string) => void }) {
  if (signals.length === 0) return null;
  return (
    <View style={styles.wrap}>
      <View style={styles.heading}>
        <View style={styles.liveHalo}>
          <View style={styles.liveDot} />
        </View>
        <Text style={styles.headingText}>LIVE SIGNALS</Text>
      </View>
      <View style={styles.grid}>
        {signals.map((s, i) => (
          <SignalTile key={s.id} signal={s} index={i} onPress={onSignalPress} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#E8862E' },
  liveHalo: {
    width: 13,
    height: 13,
    borderRadius: 6.5,
    borderWidth: 1.5,
    borderColor: 'rgba(232,134,46,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headingText: {
    ...mvType.pill,
    color: '#C96A1E',
    letterSpacing: 1.4,
    fontSize: 11,
    fontWeight: '800',
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: {
    flex: 1,
    backgroundColor: mv.surfaceWhite,
    borderRadius: 22,
    borderCurve: 'continuous',
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 1,
    borderWidth: 1,
    borderColor: '#E6DBC6',
    boxShadow: '0 8px 20px rgba(124,90,46,0.10), 0 1px 2px rgba(29, 27, 23, 0.05)',
  },
  tilePress: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 104,
  },
  tileTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  tileLabel: {
    ...mvType.pill,
    color: mv.textOnLightSecondary,
    letterSpacing: 1.1,
    fontSize: 10,
    fontWeight: '800',
    flex: 1,
  },
  toneDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
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
    backgroundColor: 'rgba(29,27,23,0.10)',
    marginTop: 6,
    overflow: 'hidden',
  },
  fill: { height: 5, borderRadius: 3, backgroundColor: '#C2503E' },
});
