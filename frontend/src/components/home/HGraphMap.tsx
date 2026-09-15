/**
 * HGraphMap — At-a-glance health picture in the style of the hGraph banner
 * (hgraph.org): one radial picture, every logged metric on its own spoke.
 *
 * Each spoke plots the metric's multi-day AVERAGE (not a single day). Dots
 * are CONNECTED into a closed contour whose segments and zonal fills read
 * green or red per spoke verdict: red when a metric slid the wrong way for
 * 3+ days or its average sits outside the healthy band, green otherwise.
 * Only metrics with real history are passed in (missing = no spoke).
 * No composite score is computed; the hub names the averaging window.
 *
 * Motion (all UI-thread, reduced-motion gated): wrapper fades + settles in,
 * dots pop along a single shared progress value with per-dot windows, then a
 * faint ambient breath loop. Values are touched only in effects/worklets.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, {
  Rect,
  Line,
  Circle,
  Ellipse,
  Path,
  Text as SvgText,
  G,
  Defs,
  RadialGradient,
  LinearGradient,
  Stop,
} from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedProps,
  withTiming,
  withDelay,
  withRepeat,
  withSpring,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';

import { useReducedMotion } from '@/theme/useReducedMotion';
import { bezier, curves } from '@/theme/motion';
import { BottomSheet } from '@/components/BottomSheet';
import type { MetricTrend } from '@/screens/Dashboard/correlations';

export interface HMetric {
  id: string;
  /** Short perimeter label, e.g. "Sleep". */
  label: string;
  /** Formatted multi-day average, e.g. "7h 18m". */
  valueText: string;
  /** Average value (plotted position). */
  value: number;
  /** Display range mapped to center→rim. */
  min: number;
  max: number;
  /** Healthy zone (inclusive) in the same units. */
  bandLo: number;
  bandHi: number;
  /** Verdict: red dot when false. */
  good: boolean;
  /** Least-squares direction over the window. */
  trend: MetricTrend;
  /** Days actually averaged. */
  avgDays: number;
}

const VB = 320;
const C = VB / 2;
const R = 130; // plot radius
const LABEL_R = R + 24;
const PAPER = '#FFF8F0';
const INK = '#191919';
const GRID = 'rgba(20,20,20,0.10)';
const GOOD = '#3F9B4E';
const GOOD_BAND = 'rgba(63,155,78,0.38)';
const BAD = '#D64545';
const SUB = '#6E5F52';
const DOT_R = 8;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedLine = Animated.createAnimatedComponent(Line);

/**
 * Tap-a-spoke guidance — wellness nudges only, never diagnosis or
 * treatment. `raise` lifts the metric, `lower` pulls it down; `goal`
 * picks which side the card spotlights. `zone` names the healthy band in
 * human units. Unknown ids fall back to the generic entry.
 */
interface SpokeGuidance {
  zone: string;
  goal: 'high' | 'low' | 'steady';
  raise: string[];
  lower: string[];
  flag?: string;
}

export type { SpokeGuidance };

export const GUIDANCE_FALLBACK: SpokeGuidance = {
  zone: 'its usual range',
  goal: 'steady',
  raise: ['A steadier daily rhythm', 'Regular sleep and mealtimes'],
  lower: ['Long gaps without rest', 'Back-to-back exhausting days'],
};

export const SPOKE_GUIDANCE: Record<string, SpokeGuidance> = {
  sleepDur: {
    zone: '7–9h nightly',
    goal: 'high',
    raise: ['A steadier bedtime', 'A longer wind-down in the evening'],
    lower: ['Late caffeine', 'Late screens in bed'],
  },
  energy: {
    zone: '4–5 / 5',
    goal: 'high',
    raise: ['Short daylight walks', 'Regular mealtimes'],
    lower: ['All-nighters', 'Skipping meals'],
  },
  water: {
    zone: '2–2.5 L daily',
    goal: 'high',
    raise: ['A glass with each meal', 'Carrying water with you'],
    lower: ['Long gaps without drinking', 'Only caffeinated drinks'],
  },
  stress: {
    zone: '1–2 / 5',
    goal: 'low',
    raise: ['Saying yes to everything', 'Doomscrolling before bed'],
    lower: ['Slow breathing breaks', 'Unwinding walks'],
  },
  activity: {
    zone: '30–60 min daily',
    goal: 'high',
    raise: ['Brisk 10-minute walks', 'Stairs over lifts'],
    lower: ['Back-to-back rest days', 'Long sitting stretches'],
  },
  wellbeing: {
    zone: '4–5 / 5',
    goal: 'high',
    raise: ['Time with people you like', 'Small finished tasks'],
    lower: ['Bottling up worries', 'Skipping rest'],
  },
  pain: {
    zone: '0–2 / 10',
    goal: 'low',
    raise: ['Overdoing a sore area', 'Staying still all day'],
    lower: ['Gentle movement', 'Heat or rest, as suits you'],
  },
  meals: {
    zone: '2–3 meals daily',
    goal: 'high',
    raise: ['Regular mealtimes', 'Planning one meal ahead'],
    lower: ['Skipping meals', 'Very late dinners'],
  },
  heart: {
    zone: '60–100 bpm resting',
    goal: 'steady',
    raise: ['Consistent sleep', 'Easy daily movement'],
    lower: ['Binge caffeine', 'All-out late workouts'],
    flag: 'Out of its usual zone — worth mentioning to your doctor.',
  },
  doses: {
    zone: '80–100% adherence',
    goal: 'high',
    raise: ['Tying doses to a routine', 'A visible pill spot'],
    lower: ['Unplanned schedule changes'],
  },
};

function clamp01(v: number): number {
  return v <= 0 ? 0 : v >= 1 ? 1 : v;
}

interface Spoke {
  m: HMetric;
  angle: number;
  cos: number;
  sin: number;
  dotX: number;
  dotY: number;
  bandX1: number;
  bandY1: number;
  bandX2: number;
  bandY2: number;
  labelX: number;
  labelY: number;
  anchor: 'start' | 'middle' | 'end';
  good: boolean;
}

function HDot({
  spoke,
  index,
  progress,
}: {
  spoke: Spoke;
  index: number;
  progress: ReturnType<typeof useSharedValue<number>>;
}) {
  const props = useAnimatedProps(() => {
    const t0 = index * 0.07;
    const t = interpolate(progress.value, [t0, t0 + 0.3], [0, 1], Extrapolation.CLAMP);
    return { r: 2 + t * (DOT_R - 2), opacity: t };
  });
  return (
    <AnimatedCircle
      cx={spoke.dotX}
      cy={spoke.dotY}
      fill={spoke.good ? 'url(#dotGood)' : 'url(#dotBad)'}
      stroke="#FFFFFF"
      strokeWidth={1.5}
      animatedProps={props}
    />
  );
}

function HBand({
  spoke,
  index,
  progress,
}: {
  spoke: Spoke;
  index: number;
  progress: ReturnType<typeof useSharedValue<number>>;
}) {
  const props = useAnimatedProps(() => {
    const t0 = index * 0.07;
    const t = interpolate(progress.value, [t0, t0 + 0.3], [0, 1], Extrapolation.CLAMP);
    return { opacity: 0.45 + t * 0.55 };
  });
  return (
    <AnimatedLine
      x1={spoke.bandX1}
      y1={spoke.bandY1}
      x2={spoke.bandX2}
      y2={spoke.bandY2}
      stroke={GOOD_BAND}
      strokeWidth={12}
      strokeLinecap="round"
      animatedProps={props}
    />
  );
}

export default function HGraphMap({ metrics, width }: { metrics: HMetric[]; width: number }) {
  const reduced = useReducedMotion();

  const spokes = useMemo<Spoke[]>(() => {
    const n = metrics.length;
    return metrics.map((m, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(n, 1);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const span = m.max - m.min || 1;
      const rr = (v: number) => R * (0.05 + 0.95 * clamp01((v - m.min) / span));
      const rv = rr(m.value);
      const rawLabelX = C + LABEL_R * cos;
      const rawLabelY = C + LABEL_R * sin;
      const labelX = Math.max(44, Math.min(VB - 44, rawLabelX));
      const anchor: 'start' | 'middle' | 'end' =
        Math.abs(cos) < 0.35 ? 'middle' : cos > 0 ? 'start' : 'end';
      return {
        m, angle, cos, sin,
        dotX: C + rv * cos,
        dotY: C + rv * sin,
        bandX1: C + rr(m.bandLo) * cos,
        bandY1: C + rr(m.bandLo) * sin,
        bandX2: C + rr(m.bandHi) * cos,
        bandY2: C + rr(m.bandHi) * sin,
        labelX, labelY: Math.max(16, Math.min(VB - 8, rawLabelY)),
        anchor, good: m.good,
      };
    });
  }, [metrics]);

  const enter = useSharedValue(reduced ? 1 : 0);
  const enterScale = useSharedValue(reduced ? 1 : 0.96);
  const progress = useSharedValue(reduced ? 1 : 0);
  const breath = useSharedValue(1);

  useEffect(() => {
    if (reduced) {
      enter.value = 1;
      enterScale.value = 1;
      progress.value = 1;
      breath.value = 1;
      return;
    }
    enter.value = withTiming(1, { duration: 350, easing: bezier(curves.standard) });
    enterScale.value = withSpring(1, { duration: 450, dampingRatio: 0.85 });
    progress.value = withDelay(150, withTiming(1, { duration: 900, easing: bezier(curves.standard) }));
    breath.value = withDelay(
      1500,
      withRepeat(withTiming(1.012, { duration: 2800, easing: bezier(curves.standard) }), -1, true),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  const enterStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ scale: enterScale.value }],
  }));
  const breathStyle = useAnimatedStyle(() => ({
    transform: [{ scale: breath.value }],
  }));

  // Closed contour segments: red when either endpoint verdict is bad —
  // the map reads as green and red territory, not isolated dots.
  const segs = useMemo(() => {
    if (spokes.length < 2) return [];
    return spokes.map((s, i) => {
      const t = spokes[(i + 1) % spokes.length];
      return { a: s, b: t, bad: !s.good || !t.good };
    });
  }, [spokes]);

  const basePoly = useMemo(() => {
    if (spokes.length < 3) return '';
    return `M ${spokes.map((s) => `${s.dotX.toFixed(1)} ${s.dotY.toFixed(1)}`).join(' L ')} Z`;
  }, [spokes]);

  const trendArrow = (t: MetricTrend) => (t === 'up' ? '▲' : t === 'down' ? '▼' : '●');
  const windowDays = useMemo(
    () => spokes.reduce((mx, s) => Math.max(mx, s.m.avgDays), 1),
    [spokes],
  );

  // Tap-a-spoke interpretation.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId != null ? (spokes.find((s) => s.m.id === selectedId) ?? null) : null;
  const selectedGuide = selected ? (SPOKE_GUIDANCE[selected.m.id] ?? GUIDANCE_FALLBACK) : null;

  const trendLine = (m: HMetric): string => {
    const days = `${m.avgDays}d avg`;
    if (m.trend === 'up') return `Rising over the last ${days}`;
    if (m.trend === 'down') return `Easing over the last ${days}`;
    return `Steady over the last ${days}`;
  };

  const positionLine = (m: HMetric, g: SpokeGuidance): string => {
    if (m.value < m.bandLo) return `Below its usual zone (${g.zone})`;
    if (m.value > m.bandHi) return `Above its usual zone (${g.zone})`;
    return `Inside its usual zone (${g.zone})`;
  };

  if (spokes.length === 0) {
    return (
      <Svg width={width} height={width * 0.6}>
        <Rect x={0} y={0} width={width} height={width * 0.6} rx={18} fill={PAPER} />
        <SvgText
          x={width / 2}
          y={width * 0.3}
          fontSize={12}
          fontWeight="600"
          fill={SUB}
          textAnchor="middle"
        >
          Log your first day to fill this in
        </SvgText>
      </Svg>
    );
  }

  return (
    <>
      <Animated.View style={enterStyle}>
        <Animated.View style={breathStyle}>
          <Svg width={width} height={width} viewBox={`0 0 ${VB} ${VB}`}>
            <Defs>
              {/* plinth shading: lit center, soft rim */}
              <RadialGradient id="hgDisc" cx="50%" cy="42%" r="65%">
                <Stop offset="0" stopColor="#FFFFFF" stopOpacity={1} />
                <Stop offset="0.72" stopColor="#F4F6F8" stopOpacity={1} />
                <Stop offset="1" stopColor="#E2E7EC" stopOpacity={1} />
              </RadialGradient>
              {/* hub sphere: highlight upper-left */}
              <RadialGradient id="hgHub" cx="36%" cy="30%" r="75%">
                <Stop offset="0" stopColor="#FFFFFF" stopOpacity={1} />
                <Stop offset="0.55" stopColor="#EDF0F3" stopOpacity={1} />
                <Stop offset="1" stopColor="#B7C0C9" stopOpacity={1} />
              </RadialGradient>
              {/* value-dot spheres */}
              <RadialGradient id="dotGood" cx="36%" cy="30%" r="75%">
                <Stop offset="0" stopColor="#8FE39A" stopOpacity={1} />
                <Stop offset="0.6" stopColor="#3F9B4E" stopOpacity={1} />
                <Stop offset="1" stopColor="#2E7D3A" stopOpacity={1} />
              </RadialGradient>
              <RadialGradient id="dotBad" cx="36%" cy="30%" r="75%">
                <Stop offset="0" stopColor="#F69A9A" stopOpacity={1} />
                <Stop offset="0.6" stopColor="#D64545" stopOpacity={1} />
                <Stop offset="1" stopColor="#A81F1F" stopOpacity={1} />
              </RadialGradient>
              {/* dome gloss sweeping the plinth */}
              <LinearGradient id="hgGloss" x1="0" y1="0" x2="0.7" y2="1">
                <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.55} />
                <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
              </LinearGradient>
            </Defs>

            {/* paper */}
            <Rect x={0} y={0} width={VB} height={VB} rx={20} fill={PAPER} />

            {/* 3D plinth: drop shadow, shaded disc, dome gloss */}
            <Ellipse cx={C} cy={C + R + 20} rx={R - 16} ry={8} fill="#16212C" opacity={0.1} />
            <Circle cx={C} cy={C} r={R + 22} fill="url(#hgDisc)" />
            <Ellipse
              cx={C - 18}
              cy={C - 62}
              rx={72}
              ry={20}
              fill="url(#hgGloss)"
              opacity={0.5}
              rotation={-16}
              originX={C - 18}
              originY={C - 62}
            />

            {/* concentric reference rings */}
            {[0.25, 0.5, 0.75].map((f) => (
              <Circle key={f} cx={C} cy={C} r={R * f} fill="none" stroke={GRID} strokeWidth={1} />
            ))}
            <Circle cx={C} cy={C} r={R} fill="none" stroke={INK} strokeWidth={2.5} />

            {/* spokes */}
            {spokes.map((s) => (
              <Line
                key={`sp-${s.m.id}`}
                x1={C}
                y1={C}
                x2={C + R * s.cos}
                y2={C + R * s.sin}
                stroke={GRID}
                strokeWidth={1}
              />
            ))}

            {/* healthy bands */}
            {spokes.map((s, i) => (
              <HBand key={`bd-${s.m.id}`} spoke={s} index={i} progress={progress} />
            ))}

            {/* connected territory: green wash + red danger wedges */}
            {basePoly ? (
              <Path d={basePoly} fill="rgba(63,155,78,0.08)" stroke="none" />
            ) : null}
            {segs
              .filter((sg) => sg.bad)
              .map((sg, i) => (
                <Path
                  key={`rz-${i}`}
                  d={`M ${C} ${C} L ${sg.a.dotX.toFixed(1)} ${sg.a.dotY.toFixed(1)} L ${sg.b.dotX.toFixed(1)} ${sg.b.dotY.toFixed(1)} Z`}
                  fill="rgba(214,69,69,0.13)"
                  stroke="none"
                />
              ))}
            {segs.map((sg, i) => (
              <Line
                key={`sg-${i}`}
                x1={sg.a.dotX}
                y1={sg.a.dotY}
                x2={sg.b.dotX}
                y2={sg.b.dotY}
                stroke={sg.bad ? BAD : GOOD}
                strokeWidth={sg.bad ? 3.5 : 2.5}
                strokeLinecap="round"
                opacity={0.9}
              />
            ))}

            {/* value dots */}
            {spokes.map((s, i) => (
              <HDot key={`dt-${s.m.id}`} spoke={s} index={i} progress={progress} />
            ))}

            {/* tap targets: generous invisible discs over every dot */}
            {spokes.map((s) => (
              <Circle
                key={`hit-${s.m.id}`}
                cx={s.dotX}
                cy={s.dotY}
                r={20}
                fill="#FFFFFF"
                opacity={0}
                onPress={() => setSelectedId(s.m.id)}
              />
            ))}

            {/* selection halo */}
            {selected ? (
              <G pointerEvents="none">
                <Circle
                  cx={selected.dotX}
                  cy={selected.dotY}
                  r={15}
                  fill="none"
                  stroke={selected.good ? GOOD : BAD}
                  strokeWidth={3}
                  opacity={0.35}
                />
                <Circle
                  cx={selected.dotX}
                  cy={selected.dotY}
                  r={10.5}
                  fill="none"
                  stroke="#FFFFFF"
                  strokeWidth={2.5}
                />
              </G>
            ) : null}

            {/* 3D hub: shadow, sphere, specular tick, labels */}
            <Ellipse cx={C + 2} cy={C + 4} rx={30} ry={30} fill="#16212C" opacity={0.14} />
            <Circle cx={C} cy={C} r={30} fill="url(#hgHub)" stroke="#8A94A0" strokeWidth={1} />
            <Circle cx={C - 9} cy={C - 10} r={5} fill="#FFFFFF" opacity={0.8} />
            <SvgText x={C} y={C + 1} textAnchor="middle" fontSize={13} fontWeight="800" fill={INK}>
              {`${windowDays}d avg`}
            </SvgText>
            <SvgText x={C} y={C + 17} textAnchor="middle" fontSize={10} fontWeight="600" fill={SUB}>
              {`${spokes.length} signal${spokes.length === 1 ? '' : 's'}`}
            </SvgText>

            {/* perimeter labels */}
            {spokes.map((s) => (
              <G key={`lb-${s.m.id}`}>
                <SvgText
                  x={s.labelX}
                  y={s.labelY - 1}
                  textAnchor={s.anchor}
                  fontSize={11.5}
                  fontWeight="800"
                  fill={s.good ? INK : BAD}
                >
                  {s.m.label}
                </SvgText>
                <SvgText
                  x={s.labelX}
                  y={s.labelY + 12}
                  textAnchor={s.anchor}
                  fontSize={12.5}
                  fontWeight="700"
                  fill={s.good ? '#3E4C59' : '#A81F1F'}
                >
                  {`${s.m.valueText} ${trendArrow(s.m.trend)}`}
                </SvgText>
              </G>
            ))}
          </Svg>
        </Animated.View>
      </Animated.View>

      {/* Tap-a-spoke interpretation */}
      {selected && selectedGuide ? (
        <BottomSheet
          visible
          onClose={() => setSelectedId(null)}
          title={`${selected.m.label} · ${selected.m.valueText}`}
        >
          <View style={guideStyles.body}>
            <Text style={guideStyles.status}>
              {positionLine(selected.m, selectedGuide)}
            </Text>
            <Text style={guideStyles.trend}>{trendLine(selected.m)}</Text>
            {selected.m.good === false && selectedGuide.flag ? (
              <Text style={guideStyles.flag}>{selectedGuide.flag}</Text>
            ) : null}
            <View style={guideStyles.row}>
              <Text style={guideStyles.up}>▲ Nudge up</Text>
              {selectedGuide.raise.map((tip) => (
                <Text key={tip} style={guideStyles.tip}>· {tip}</Text>
              ))}
            </View>
            <View style={guideStyles.row}>
              <Text style={guideStyles.down}>▼ Ease off</Text>
              {selectedGuide.lower.map((tip) => (
                <Text key={tip} style={guideStyles.tip}>· {tip}</Text>
              ))}
            </View>
            <Text style={guideStyles.foot}>
              Wellness nudge from your own averages — not medical advice.
            </Text>
            <Pressable
              onPress={() => setSelectedId(null)}
              style={({ pressed }) => [guideStyles.done, pressed && { opacity: 0.75 }]}
              accessibilityRole="button"
              accessibilityLabel="Close guidance"
            >
              <Text style={guideStyles.doneText}>Got it</Text>
            </Pressable>
          </View>
        </BottomSheet>
      ) : null}
    </>
  );
}

const guideStyles = StyleSheet.create({
  body: {
    gap: 10,
    paddingBottom: 8,
  },
  status: {
    fontSize: 16,
    fontWeight: '800',
    color: '#141414',
  },
  trend: {
    fontSize: 13,
    fontWeight: '600',
    color: '#5C6B7A',
  },
  flag: {
    fontSize: 13,
    fontWeight: '700',
    color: '#C2503E',
    backgroundColor: 'rgba(194,80,62,0.08)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    overflow: 'hidden',
  },
  row: {
    gap: 4,
    borderTopWidth: 1,
    borderTopColor: '#E6DBC6',
    paddingTop: 10,
  },
  up: {
    fontSize: 13,
    fontWeight: '800',
    color: '#4E9B5F',
  },
  down: {
    fontSize: 13,
    fontWeight: '800',
    color: '#C2255C',
  },
  tip: {
    fontSize: 14,
    color: '#2B333C',
    lineHeight: 20,
  },
  foot: {
    fontSize: 11,
    color: '#8A94A0',
    marginTop: 2,
  },
  done: {
    marginTop: 4,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: '#1D1B17',
    alignItems: 'center',
  },
  doneText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
  },
});
