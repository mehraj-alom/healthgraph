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

import React, { useEffect, useMemo } from 'react';
import Svg, {
  Rect,
  Line,
  Circle,
  Path,
  Text as SvgText,
  G,
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
const R = 104; // plot radius
const LABEL_R = R + 34;
const PAPER = '#FAFAF8';
const INK = '#191919';
const GRID = 'rgba(20,20,20,0.10)';
const GOOD = '#3F9B4E';
const GOOD_BAND = 'rgba(63,155,78,0.38)';
const BAD = '#D64545';
const SUB = '#6E5F52';
const DOT_R = 7;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedLine = Animated.createAnimatedComponent(Line);

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
      fill={spoke.good ? GOOD : BAD}
      stroke="#FFFFFF"
      strokeWidth={2}
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
      strokeWidth={10}
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
        labelX, labelY: rawLabelY,
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
    <Animated.View style={enterStyle}>
      <Animated.View style={breathStyle}>
        <Svg width={width} height={width} viewBox={`0 0 ${VB} ${VB}`}>
          {/* paper */}
          <Rect x={0} y={0} width={VB} height={VB} rx={20} fill={PAPER} />

          {/* concentric reference rings */}
          {[0.25, 0.5, 0.75].map((f) => (
            <Circle key={f} cx={C} cy={C} r={R * f} fill="none" stroke={GRID} strokeWidth={1} />
          ))}
          <Circle cx={C} cy={C} r={R} fill="none" stroke={INK} strokeWidth={1.5} />

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
              strokeWidth={sg.bad ? 3 : 2}
              strokeLinecap="round"
              opacity={0.9}
            />
          ))}

          {/* value dots */}
          {spokes.map((s, i) => (
            <HDot key={`dt-${s.m.id}`} spoke={s} index={i} progress={progress} />
          ))}

          {/* hub */}
          <Circle cx={C} cy={C} r={30} fill="#FFFFFF" stroke={INK} strokeWidth={1.5} />
          <SvgText x={C} y={C - 1} textAnchor="middle" fontSize={13} fontWeight="800" fill={INK}>
            {`${windowDays}d avg`}
          </SvgText>
          <SvgText x={C} y={C + 15} textAnchor="middle" fontSize={10} fontWeight="600" fill={SUB}>
            {`${spokes.length} signal${spokes.length === 1 ? '' : 's'}`}
          </SvgText>

          {/* perimeter labels */}
          {spokes.map((s) => (
            <G key={`lb-${s.m.id}`}>
              <SvgText
                x={s.labelX}
                y={s.labelY - 1}
                textAnchor={s.anchor}
                fontSize={9.5}
                fontWeight="800"
                fill={s.good ? INK : BAD}
              >
                {s.m.label}
              </SvgText>
              <SvgText
                x={s.labelX}
                y={s.labelY + 11}
                textAnchor={s.anchor}
                fontSize={9.5}
                fontWeight="600"
                fill={s.good ? SUB : BAD}
              >
                {`${s.m.valueText} ${trendArrow(s.m.trend)}`}
              </SvgText>
            </G>
          ))}
        </Svg>
      </Animated.View>
    </Animated.View>
  );
}
