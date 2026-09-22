/**
 * HGraphMap — At-a-glance health picture in the style of the hGraph banner
 * (hgraph.org): one radial picture, every logged metric on its own spoke.
 *
 * Rebuilt on the evidence for what makes radial health visuals actually
 * readable (hFigures usability work + radar-chart research):
 * - Category SECTORS stay visible so you always know which family a spoke
 *   belongs to (the #1 hFigures finding).
 * - Every spoke prints its VALUE directly — no tap-to-read basics.
 * - The healthy zone is a band segment per spoke (the original hGraph "green
 *   circle" idea); dots inside read fine at a glance.
 * - Direction chevrons answer "which way is good?" per spoke.
 * - NO connected polygon: joining discrete metrics implies relationships
 *   that don't exist, and its area exaggerates differences quadratically.
 *
 * Each spoke plots the metric's multi-day AVERAGE (not a single day).
 * Missing = no spoke (never a zero dot).
 *
 * Guava-flat: the dial lives on a white card — ink dots and hairlines on a
 * soft wash well, green reserved for healthy-zone bands, danger reserved
 * strictly for off-track flags. Geometry and data encoding are unchanged.
 *
 * Motion (functional only, reduced-motion gated): data changes morph
 * dots/bands from their on-screen presentation values via a
 * critically-damped spring — never a jump. New spokes fade in. Press-down
 * swells the dot the instant the finger lands; selection halo grows outward
 * from the dot. No entrance cascades, no ambient loops — the dial rests.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, Vibration, View } from 'react-native';
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
  useAnimatedProps,
  withTiming,
  withSpring,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';

import { useReducedMotion } from '@/theme/useReducedMotion';
import { spring } from '@/theme/motion';
import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
import { MARKER_COLOR, scribblePaths } from '@/components/markerScribble';
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

const VB = 360;
const C = VB / 2;
const R = 124; // plot radius
const LABEL_R = R + 26;
const SECTOR_R = R + 46;
// Guava-flat dial tokens: monochrome ink on white, green bands, red flags.
const WELL = GV.wash;
const GRID = GV.line;
const BAND = GV.fx.green;
const BAD = GV.danger;
const SUB = GV.muted;
const DOT_R = 7;

/** Fixed sector order — spokes group by family so the dial reads in zones. */
const SECTOR_ORDER = ['rest', 'vitality', 'body', 'fuel', 'mind', 'care', 'more'] as const;
const SECTOR_LABEL: Record<string, string> = {
  rest: 'REST',
  vitality: 'VITALITY',
  body: 'BODY',
  fuel: 'FUEL',
  mind: 'MIND',
  care: 'CARE',
  more: 'MORE',
};

function sectorOf(m: HMetric): string {
  const base = m.id.includes(':') ? m.id.slice(0, m.id.indexOf(':')) : m.id;
  if (['sleepDur', 'sleepQual', 'awakenings', 'sleep'].includes(base)) return 'rest';
  if (['energy', 'wellbeing'].includes(base)) return 'vitality';
  if (['activity', 'heart', 'hr'].includes(base)) return 'body';
  if (['water', 'meals', 'appetite'].includes(base)) return 'fuel';
  if (['stress', 'pain', 'symptom'].includes(base)) return 'mind';
  if (['doses', 'medication'].includes(base)) return 'care';
  return 'more';
}

/** Which radial direction is healthy: +1 outward, -1 inward, 0 steady. */
function goodDirection(m: HMetric): 1 | -1 | 0 {
  const base = m.id.includes(':') ? m.id.slice(0, m.id.indexOf(':')) : m.id;
  if (['sleepDur', 'sleepQual', 'energy', 'water', 'activity', 'wellbeing', 'meals', 'appetite', 'doses'].includes(base)) return 1;
  if (['stress', 'pain', 'symptom', 'awakenings'].includes(base)) return -1;
  return 0;
}

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
  /** Healthy radial direction: +1 outward, -1 inward, 0 steady. */
  dir: 1 | -1 | 0;
  sector: string;
}

function HDot({
  spoke,
  from,
  index,
  progress,
  morph,
  pressedId,
  pressT,
}: {
  spoke: Spoke;
  /** On-screen position before the latest data change (null = new spoke). */
  from: { x: number; y: number } | null;
  index: number;
  progress: ReturnType<typeof useSharedValue<number>>;
  /** 0→1 spring driving data-change morphs. */
  morph: ReturnType<typeof useSharedValue<number>>;
  pressedId: ReturnType<typeof useSharedValue<string | null>>;
  /** 0→1 press-down swell (100ms timing). */
  pressT: ReturnType<typeof useSharedValue<number>>;
}) {
  const fx = from?.x;
  const fy = from?.y;
  const props = useAnimatedProps(() => {
    const t0 = index * 0.07;
    const t = interpolate(progress.value, [t0, t0 + 0.3], [0, 1], Extrapolation.CLAMP);
    const m = morph.value;
    const px = fx != null ? fx + (spoke.dotX - fx) * m : spoke.dotX;
    const py = fy != null ? fy + (spoke.dotY - fy) * m : spoke.dotY;
    const pressed = pressedId.value === spoke.m.id;
    const r = (2 + t * (DOT_R - 2)) * (pressed ? 1 + 0.4 * pressT.value : 1);
    return { cx: px, cy: py, r, opacity: t * (fx != null ? 1 : m) };
  }, [spoke.dotX, spoke.dotY, spoke.m.id, fx, fy, index]);
  return (
    <AnimatedCircle
      cx={spoke.dotX}
      cy={spoke.dotY}
      fill={spoke.good ? GV.ink : GV.danger}
      stroke="#FFFFFF"
      strokeWidth={2}
      animatedProps={props}
    />
  );
}

function HBand({
  spoke,
  from,
  index,
  progress,
  morph,
  color,
}: {
  spoke: Spoke;
  /** On-screen band endpoints before the latest data change (null = new). */
  from: { x1: number; y1: number; x2: number; y2: number } | null;
  index: number;
  progress: ReturnType<typeof useSharedValue<number>>;
  morph: ReturnType<typeof useSharedValue<number>>;
  color: string;
}) {
  const fx1 = from?.x1;
  const fy1 = from?.y1;
  const fx2 = from?.x2;
  const fy2 = from?.y2;
  const props = useAnimatedProps(() => {
    const t0 = index * 0.07;
    const t = interpolate(progress.value, [t0, t0 + 0.3], [0, 1], Extrapolation.CLAMP);
    const m = morph.value;
    const has = fx1 != null && fy1 != null && fx2 != null && fy2 != null;
    return {
      x1: has ? fx1 + (spoke.bandX1 - fx1) * m : spoke.bandX1,
      y1: has ? fy1 + (spoke.bandY1 - fy1) * m : spoke.bandY1,
      x2: has ? fx2 + (spoke.bandX2 - fx2) * m : spoke.bandX2,
      y2: has ? fy2 + (spoke.bandY2 - fy2) * m : spoke.bandY2,
      opacity: (0.45 + t * 0.55) * (has ? 1 : m),
    };
  }, [spoke.bandX1, spoke.bandY1, spoke.bandX2, spoke.bandY2, fx1, fy1, fx2, fy2, index]);
  return (
    <AnimatedLine
      x1={spoke.bandX1}
      y1={spoke.bandY1}
      x2={spoke.bandX2}
      y2={spoke.bandY2}
      stroke={color}
      strokeOpacity={0.4}
      strokeWidth={14}
      strokeLinecap="round"
      animatedProps={props}
    />
  );
}

export default function HGraphMap({ metrics, width }: { metrics: HMetric[]; width: number }) {
  const reduced = useReducedMotion();

  // Spokes group by family sector (fixed order) so the dial reads in zones
  // instead of an arbitrary ring — axis order stops being a shape artifact.
  const spokes = useMemo<Spoke[]>(() => {
    const ordered = [...metrics].sort(
      (a, b) => SECTOR_ORDER.indexOf(sectorOf(a) as (typeof SECTOR_ORDER)[number]) - SECTOR_ORDER.indexOf(sectorOf(b) as (typeof SECTOR_ORDER)[number]),
    );
    const n = ordered.length;
    return ordered.map((m, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(n, 1);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const span = m.max - m.min || 1;
      const rr = (v: number) => R * (0.05 + 0.95 * clamp01((v - m.min) / span));
      const rv = rr(Math.max(m.min, Math.min(m.max, m.value)));
      const rawLabelX = C + LABEL_R * cos;
      const rawLabelY = C + LABEL_R * sin;
      const labelX = Math.max(30, Math.min(VB - 30, rawLabelX));
      const anchor: 'start' | 'middle' | 'end' =
        Math.abs(cos) < 0.35 ? 'middle' : cos > 0 ? 'start' : 'end';
      return {
        m, angle, cos, sin,
        dotX: C + rv * cos,
        dotY: C + rv * sin,
        bandX1: C + rr(Math.max(m.min, Math.min(m.max, m.bandLo))) * cos,
        bandY1: C + rr(Math.max(m.min, Math.min(m.max, m.bandLo))) * sin,
        bandX2: C + rr(Math.max(m.min, Math.min(m.max, m.bandHi))) * cos,
        bandY2: C + rr(Math.max(m.min, Math.min(m.max, m.bandHi))) * sin,
        labelX, labelY: Math.max(18, Math.min(VB - 16, rawLabelY)),
        anchor, good: m.good,
        dir: goodDirection(m),
        sector: sectorOf(m),
      };
    });
  }, [metrics]);

  // No entrance cascade: dots rest at full size. `progress` stays pinned at 1
  // so the shared dot/band math is untouched; only functional motion
  // (morph, press swell, halo) still animates, and never under reduced motion.
  const progress = useSharedValue(1);
  // Fluid-interaction state: morph springs dots/bands from presentation
  // values on data change; pressedId/pressT give instant press-down swell.
  const morph = useSharedValue(1);
  const pressedId = useSharedValue<string | null>(null);
  const pressT = useSharedValue(0);
  const haloT = useSharedValue(0);
  const prevLayout = useRef<Map<
    string,
    { x: number; y: number; b1x: number; b1y: number; b2x: number; b2y: number }
  > | null>(null);
  /** Spoke-id signature driving the scrub gate above. */
  const sigRef = useRef<string | null>(null);
  const prevSelectedId = useRef<string | null>(null);

  // Data-change morph: re-target from live on-screen positions with a
  // critically-damped spring (no bounce — this morph carries no momentum).
  // Re-assigning withSpring mid-flight blends from the presentation value,
  // so rapid refreshes never jump. Reduced motion: static cut.
  // Scrub-gate: when only VALUES change (same spoke set — e.g. the day
  // scrubber gliding), morph stays pinned at 1 so dots track the new
  // positions frame-by-frame instead of rubber-banding. The spring fires
  // only when spokes appear/disappear.
  useEffect(() => {
    const snap = new Map(
      spokes.map((s) => [
        s.m.id,
        { x: s.dotX, y: s.dotY, b1x: s.bandX1, b1y: s.bandY1, b2x: s.bandX2, b2y: s.bandY2 },
      ]),
    );
    const prev = prevLayout.current;
    prevLayout.current = snap;
    const sig = spokes.map((s) => s.m.id).join(',');
    const prevSig = sigRef.current;
    sigRef.current = sig;
    if (reduced || prevSig === sig) {
      morph.value = 1;
      return;
    }
    if (prev != null && spokes.some((s) => prev.has(s.m.id))) {
      morph.value = 0;
      morph.value = withSpring(1, spring);
    } else {
      morph.value = 1;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spokes, reduced]);

  // Sector rim labels only — families stay visible without background
  // washes. One tracked word per family, always in the same place.
  const sectorArcs = useMemo(() => {
    if (spokes.length === 0) return [];
    const step = (2 * Math.PI) / spokes.length;
    const groups: { sector: string; start: number; end: number; mid: number }[] = [];
    for (const s of spokes) {
      const g = groups[groups.length - 1];
      if (g && g.sector === s.sector) {
        g.end = s.angle + step / 2;
      } else {
        groups.push({ sector: s.sector, start: s.angle - step / 2, end: s.angle + step / 2, mid: s.angle });
      }
    }
    return groups.map((g) => {
      const span = g.end - g.start;
      const mid = g.start + span / 2;
      const lx = C + SECTOR_R * Math.cos(mid);
      const ly = C + SECTOR_R * Math.sin(mid);
      return {
        sector: g.sector,
        labelX: Math.max(36, Math.min(VB - 36, lx)),
        labelY: Math.max(18, Math.min(VB - 12, ly)),
      };
    });
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

  // Selection halo grows outward from the dot — the in-between frames point
  // at the outcome. Only on fresh selections (moving between spokes just
  // re-anchors at full size); static under reduced motion.
  useEffect(() => {
    const had = prevSelectedId.current != null;
    prevSelectedId.current = selectedId;
    if (selectedId == null) return;
    if (reduced) {
      haloT.value = 1;
      return;
    }
    if (!had) {
      haloT.value = 0;
      haloT.value = withSpring(1, spring);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, reduced]);

  const haloProps = useAnimatedProps(() => ({ r: 9 + haloT.value * 6 }));

  // Commit on release; feedback starts on press-down (see hit discs below).
  // Haptic fires on the same frame as halo + sheet for one causal moment.
  const commitSpoke = useCallback(
    (id: string) => {
      try {
        Vibration.vibrate(10);
      } catch {
        /* best-effort haptics */
      }
      pressT.value = withTiming(0, { duration: 100 });
      pressedId.value = null;
      setSelectedId(id);
    },
    [pressT, pressedId],
  );

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
        <Rect x={0.5} y={0.5} width={width - 1} height={width * 0.6 - 1} rx={20} fill={GV.card} strokeWidth={0} />
        <SvgText
          x={width / 2}
          y={width * 0.3}
          fontSize={13}
          fontFamily={FONT.regular}
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
      <View>
        <Svg width={width} height={width} viewBox={`0 0 ${VB} ${VB}`}>
          {/* flat stage: white disc, soft wash well, hairline rim */}
          <Rect x={0} y={0} width={VB} height={VB} rx={20} fill={GV.card} />
          <Circle cx={C} cy={C} r={R + 22} fill={WELL} />
          <Circle cx={C} cy={C} r={R + 22} fill="none" stroke={GV.line} strokeWidth={1} />

          {/* concentric reference rings + thin rim */}
          {[0.25, 0.5, 0.75].map((f) => (
            <Circle key={f} cx={C} cy={C} r={R * f} fill="none" stroke={GRID} strokeWidth={1} />
          ))}
          <Circle cx={C} cy={C} r={R} fill="none" stroke={GV.line} strokeWidth={1.5} />

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

          {/* healthy-zone bands — one quiet green segment per spoke */}
          {spokes.map((s, i) => {
            const p = prevLayout.current?.get(s.m.id) ?? null;
            return (
              <HBand
                key={`bd-${s.m.id}`}
                spoke={s}
                from={
                  p
                    ? { x1: p.b1x, y1: p.b1y, x2: p.b2x, y2: p.b2y }
                    : null
                }
                index={i}
                progress={progress}
                morph={morph}
                color={BAND}
              />
            );
          })}

          {/* value dots — ink on-track, red off-track. No connecting
              polygon: discrete metrics joined by lines imply relationships
              that don't exist, and fills exaggerate differences. */}
          {spokes.map((s, i) => {
            const p = prevLayout.current?.get(s.m.id) ?? null;
            return (
              <HDot
                key={`dt-${s.m.id}`}
                spoke={s}
                from={p ? { x: p.x, y: p.y } : null}
                index={i}
                progress={progress}
                morph={morph}
                pressedId={pressedId}
                pressT={pressT}
              />
            );
          })}

          {/* direction chevrons: which radial way is healthy, per spoke */}
          {spokes.map((s) => {
            if (s.dir === 0) return null;
            const bx = C + (R + 8) * s.cos;
            const by = C + (R + 8) * s.sin;
            const px = -s.sin;
            const py = s.cos;
            const t = 6 * s.dir;
            const b = -3 * s.dir;
            const d =
              `M ${(bx + t * s.cos).toFixed(1)} ${(by + t * s.sin).toFixed(1)} ` +
              `L ${(bx + b * s.cos + 4 * px).toFixed(1)} ${(by + b * s.sin + 4 * py).toFixed(1)} ` +
              `L ${(bx + b * s.cos - 4 * px).toFixed(1)} ${(by + b * s.sin - 4 * py).toFixed(1)} Z`;
            return <Path key={`ch-${s.m.id}`} d={d} fill={GV.muted} opacity={0.9} stroke="none" />;
          })}

          {/* off-track verdict: persistent red halo (dots turn red too) */}
          {spokes
            .filter((s) => !s.good)
            .map((s) => (
              <Circle
                key={`bad-${s.m.id}`}
                cx={s.dotX}
                cy={s.dotY}
                r={12}
                fill="none"
                stroke={BAD}
                strokeWidth={2}
                opacity={0.85}
                pointerEvents="none"
              />
            ))}

          {/* tap targets: 44px invisible discs over every dot.
              Press-down swells the dot instantly; release commits. */}
          {spokes.map((s) => (
            <Circle
              key={`hit-${s.m.id}`}
              cx={s.dotX}
              cy={s.dotY}
              r={22}
              fill="#FFFFFF"
              opacity={0}
              onPressIn={() => {
                pressedId.value = s.m.id;
                if (!reduced) pressT.value = withTiming(1, { duration: 100 });
              }}
              onPressOut={() => {
                if (pressedId.value === s.m.id) pressedId.value = null;
                if (!reduced) pressT.value = withTiming(0, { duration: 100 });
              }}
              onPress={() => commitSpoke(s.m.id)}
            />
          ))}

          {/* selection halo grows outward from the dot on fresh selects */}
          {selected ? (
            <G pointerEvents="none">
              <AnimatedCircle
                cx={selected.dotX}
                cy={selected.dotY}
                r={15}
                fill="none"
                stroke={selected.good ? GV.ink : BAD}
                strokeWidth={3}
                opacity={selected.good ? 0.5 : 0.9}
                animatedProps={haloProps}
              />
            </G>
          ) : null}

          {/* flat hub: averaging window + signal count */}
          <Circle cx={C} cy={C} r={32} fill={GV.card} stroke={GV.line} strokeWidth={1.5} />
          <SvgText x={C} y={C + 1} textAnchor="middle" fontSize={13} fontFamily={FONT.semi} fill={GV.ink}>
            {`${windowDays}d avg`}
          </SvgText>
          <SvgText x={C} y={C + 17} textAnchor="middle" fontSize={10} fontFamily={FONT.semi} fill={SUB} letterSpacing={1}>
            {`${spokes.length} SIGNAL${spokes.length === 1 ? '' : 'S'}`}
          </SvgText>

          {/* rim: value printed directly (no tap needed) + short name.
              The name carries a sketchpen shade (marker scribble behind
              the tagline, sized from the label itself). */}
          {spokes.map((s) => {
            const name = s.m.label.toUpperCase().slice(0, 14);
            const markW = name.length * 6.8 + 8;
            const markH = 12;
            const markX =
              s.anchor === 'middle'
                ? s.labelX - markW / 2
                : s.anchor === 'start'
                  ? s.labelX - 4
                  : s.labelX - markW + 4;
            const mark = scribblePaths(markX, s.labelY + 13 - 11, markW, markH);
            return (
            <G key={`lb-${s.m.id}`}>
              <Path
                d={mark.main}
                stroke={MARKER_COLOR}
                strokeWidth={mark.mainWidth}
                opacity={0.5}
                fill="none"
                strokeLinecap="round"
              />
              <Path
                d={mark.over}
                stroke={MARKER_COLOR}
                strokeWidth={mark.overWidth}
                opacity={0.45}
                fill="none"
                strokeLinecap="round"
              />
              <SvgText
                x={s.labelX}
                y={s.labelY - 1}
                textAnchor={s.anchor}
                fontSize={12.5}
                fontFamily={FONT.semi}
                fill={s.good ? GV.ink : BAD}
              >
                {`${s.m.valueText} ${trendArrow(s.m.trend)}`}
              </SvgText>
              <SvgText
                x={s.labelX}
                y={s.labelY + 13}
                textAnchor={s.anchor}
                fontSize={10}
                fontFamily={FONT.semi}
                fill={SUB}
                letterSpacing={0.5}
              >
                {name}
              </SvgText>
            </G>
            );
          })}

          {/* sector rim labels: one per family, always visible */}
          {sectorArcs.map((g) => (
            <SvgText
              key={`sl-${g.sector}`}
              x={g.labelX}
              y={g.labelY}
              textAnchor="middle"
              fontSize={10}
              fontFamily={FONT.semi}
              fill={GV.muted}
              letterSpacing={1.5}
            >
              {SECTOR_LABEL[g.sector] ?? g.sector.toUpperCase()}
            </SvgText>
          ))}
        </Svg>
      </View>

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
  // Flat white block inside the sheet (sheet chrome stays system).
  body: {
    gap: 12,
    paddingBottom: 8,
    backgroundColor: GV.card,
    borderRadius: SPACE.rCard,
    padding: SPACE.cardPad,
  },
  status: {
    ...TYPE.title,
    color: GV.ink,
  },
  trend: {
    ...TYPE.body,
    color: GV.body,
  },
  flag: {
    ...TYPE.body,
    fontFamily: FONT.semi,
    color: '#FFFFFF',
    backgroundColor: GV.danger,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    overflow: 'hidden',
  },
  row: {
    gap: 4,
    borderTopWidth: 1,
    borderTopColor: GV.line,
    paddingTop: 12,
  },
  up: {
    ...TYPE.caption,
    fontFamily: FONT.semi,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: GV.fx.green,
  },
  down: {
    ...TYPE.caption,
    fontFamily: FONT.semi,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: GV.danger,
  },
  tip: {
    ...TYPE.body,
    color: GV.ink,
  },
  foot: {
    ...TYPE.caption,
    color: GV.muted,
    marginTop: 4,
  },
  done: {
    marginTop: 8,
    paddingVertical: 12,
    borderRadius: SPACE.rPill,
    backgroundColor: GV.cta,
    alignItems: 'center',
  },
  doneText: {
    ...TYPE.button,
    fontSize: 15,
    color: '#FFFFFF',
  },
});
