/**
 * MomentumStep — onboarding step 3: the 7-day momentum strip.
 *
 * Rendered strictly from useMomentumWeek (real local rows only). New users
 * see the legitimate empty state — nothing is fabricated to fill the week.
 */

import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useEffect } from 'react';
import Svg, { Circle, Defs, LinearGradient, Path, Polyline, Stop } from 'react-native-svg';
import { BlurView } from 'expo-blur';
import Animated, {
  Easing,
  createAnimatedComponent,
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Reveal } from '@/components/home/Reveal';
import { FONT, GV, TYPE } from '@/theme/guava';
import { useReducedMotion } from '@/theme/useReducedMotion';
import { useMomentumWeek } from '@/hooks/useMomentumWeek';
import { momentumActiveDays } from './momentum';

function DayCell({
  weekday,
  active,
  isToday,
  heartRate,
  showGuide,
}: {
  weekday: string;
  active: boolean;
  isToday: boolean;
  heartRate: number | null;
  showGuide: boolean;
}) {
  return (
    <View style={styles.cell} accessibilityRole="text" accessibilityLabel={`${weekday}${active ? ', active' : ''}`}>
      <View
        style={[
          styles.dot,
          active ? styles.dotActive : styles.dotIdle,
          isToday && styles.dotToday,
        ]}
      />
      <Text style={[styles.weekday, active && styles.weekdayActive]}>{weekday}</Text>
      {heartRate !== null ? (
        <Text style={styles.hr}>{heartRate}</Text>
      ) : showGuide ? (
        <Text style={styles.hrIdle}>·</Text>
      ) : null}
    </View>
  );
}

export function MomentumStep() {
  const { days, isEmpty, activeDays, isLoading } = useMomentumWeek();
  const count = momentumActiveDays(days);
  const glassOff = useReducedMotion();

  return (
    <View style={styles.wrap}>
      <Reveal>
        <Text style={styles.headline}>Your first week</Text>
      </Reveal>
      {isLoading ? (
        <ActivityIndicator color={GV.teal} style={styles.loader} />
      ) : isEmpty ? (
        <View style={styles.glass}>
          {glassOff ? (
            <View style={styles.glassSolid} />
          ) : (
            <BlurView tint="dark" intensity={70} style={styles.glassFill} />
          )}
          <View style={styles.glassTint} />
          <View style={styles.glassContent}>
            <Text style={styles.previewPill}>Preview</Text>
            <PreviewGraph />
            <Text style={styles.graphCaption}>7 days of health</Text>
            <Text style={styles.tagline}>Small steps, steady climb.</Text>
            <Text style={styles.honestNote}>
              Log a day and your real week draws itself here.
            </Text>
          </View>
        </View>
      ) : (
        <>
          <Reveal>
            <Text style={styles.sub}>
              {count === 7
                ? '7 of 7 days active.'
                : `${activeDays} of 7 days active.`}
            </Text>
          </Reveal>
          <View style={styles.glass}>
            {glassOff ? (
              <View style={styles.glassSolid} />
            ) : (
              <BlurView tint="dark" intensity={70} style={styles.glassFill} />
            )}
            <View style={styles.glassTint} />
            <View style={styles.glassContent}>
              <WeekSpark days={days} />
              <View style={styles.strip} accessibilityRole="list">
                {days.map((day, i) => (
                  <DayCell
                    key={day.date}
                    weekday={day.weekday}
                    active={day.active}
                    isToday={i === days.length - 1}
                    heartRate={day.heartRate}
                    showGuide
                  />
                ))}
              </View>
              <Text style={styles.tagline}>Small steps, steady climb.</Text>
            </View>
          </View>
          <Text style={styles.legend}>
            A filled dot means a logged day.
          </Text>
        </>
      )}
    </View>
  );
}

/**
 * PreviewGraph — simulated day-vs-health illustration with a positive
 * slope and a draw-on animation (line draws, dot rides it, area fades
 * in). Explicitly labeled Preview everywhere it renders: it must never
 * be mistaken for the user's own week. Reduced motion shows it whole.
 */
const AnimPath = Animated.createAnimatedComponent(Path);
const AnimCircle = Animated.createAnimatedComponent(Circle);

const PREVIEW_VALS = [26, 34, 43, 51, 60, 69, 80];

function PreviewGraph() {
  const reduced = useReducedMotion();
  const progress = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) {
      progress.value = 1;
      return;
    }
    progress.value = withTiming(1, {
      duration: 1800,
      easing: Easing.out(Easing.cubic),
    });
    // Mount-only entrance; no deps to re-trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  const W = 300;
  const H = 120;
  const TOP = 14;
  const BASE = 104;
  const step = W / (PREVIEW_VALS.length - 1);
  const pts = PREVIEW_VALS.map((v, i) => ({
    x: i * step,
    // Higher health value rides higher on screen.
    y: BASE - (v / 100) * (BASE - TOP),
  }));
  const segLens: number[] = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const len = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    segLens.push(len);
    total += len;
  }
  const line = `M${pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L')}`;
  const area = `${line} L${W},${H} L0,${H} Z`;

  const pointAt = (t: number): { x: number; y: number } => {
    'worklet';
    let dist = Math.max(0, Math.min(1, t)) * total;
    for (let i = 0; i < segLens.length; i++) {
      if (dist <= segLens[i] || i === segLens.length - 1) {
        const f = segLens[i] === 0 ? 0 : Math.min(1, Math.max(0, dist / segLens[i]));
        const a = pts[i];
        const b = pts[i + 1];
        return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
      }
      dist -= segLens[i];
    }
    return pts[pts.length - 1];
  };

  const lineProps = useAnimatedProps(() => ({
    strokeDasharray: `${total} ${total}`,
    strokeDashoffset: total * (1 - progress.value),
  }));
  const dotProps = useAnimatedProps(() => {
    const at = pointAt(progress.value);
    return { cx: at.x, cy: at.y, opacity: 0.4 + 0.6 * progress.value };
  });
  const areaProps = useAnimatedProps(() => ({ opacity: progress.value }));

  return (
    <Svg
      width="100%"
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      accessibilityRole="image"
      accessibilityLabel="Illustration of health rising across 7 days"
    >
      <Defs>
        <LinearGradient id="prev-fill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#4FD1C5" stopOpacity={0.45} />
          <Stop offset="1" stopColor="#4FD1C5" stopOpacity={0.03} />
        </LinearGradient>
      </Defs>
      <AnimPath d={area} fill="url(#prev-fill)" animatedProps={areaProps} />
      <AnimPath
        d={line}
        fill="none"
        stroke="#4FD1C5"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
        animatedProps={lineProps}
      />
      <AnimCircle r={5} fill="#FFFFFF" stroke="#4FD1C5" strokeWidth={2.5} animatedProps={dotProps} />
    </Svg>
  );
}

/**
 * WeekSpark — day-vs-health line drawn only from the week's real rows:
 * active days ride high, quiet days ride low. Nothing is smoothed or
 * filled in, so the slope always tells the truth about the 7 days.
 */
function WeekSpark({ days }: { days: readonly { active: boolean }[] }) {
  const W = 300;
  const H = 64;
  const TOP = 12;
  const BASE = 52;
  const step = W / Math.max(1, days.length - 1);
  const pts = days.map(
    (day, i) => `${(i * step).toFixed(1)},${day.active ? TOP : BASE}`,
  );
  const line = `M${pts.join(' L')}`;
  const area = `${line} L${W},${H} L0,${H} Z`;
  return (
    <Svg
      width="100%"
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      accessibilityRole="image"
      accessibilityLabel="Activity across the last 7 days"
    >
      <Defs>
        <LinearGradient id="mom-fill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#4FD1C5" stopOpacity={0.4} />
          <Stop offset="1" stopColor="#4FD1C5" stopOpacity={0.03} />
        </LinearGradient>
      </Defs>
      <Path d={area} fill="url(#mom-fill)" />
      <Polyline
        points={pts.join(' ')}
        fill="none"
        stroke="#4FD1C5"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

const DOT = 16;

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    gap: 12,
    paddingTop: 8,
  },
  headline: {
    fontWeight: '600',
    fontSize: 32,
    lineHeight: 38,
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: -0.6,
  },
  sub: {
    fontWeight: '400',
    fontSize: 15,
    lineHeight: 21,
    color: 'rgba(233, 240, 255, 0.66)',
    textAlign: 'center',
    alignSelf: 'center',
  },
  loader: {
    marginTop: 32,
  },
  // Liquid-glass week panel (sidebar material): frosted blur, brand
  // tint, hairline edge. Solid panel under reduced motion.
  glass: {
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    marginTop: 8,
  },
  glassFill: {
    ...StyleSheet.absoluteFill,
  },
  glassTint: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(14, 19, 31, 0.5)',
  },
  glassSolid: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  glassContent: {
    paddingVertical: 16,
    paddingHorizontal: 14,
    gap: 12,
  },
  strip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  tagline: {
    fontWeight: '600',
    fontSize: 14,
    lineHeight: 20,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  previewPill: {
    fontFamily: FONT.semi,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 2,
    color: GV.fog,
    textAlign: 'center',
  },
  graphCaption: {
    ...TYPE.caption,
    color: GV.fog,
    textAlign: 'center',
  },
  honestNote: {
    ...TYPE.caption,
    color: GV.fog,
    lineHeight: 18,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  cell: {
    alignItems: 'center',
    gap: 6,
    minWidth: 32,
  },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
  },
  dotActive: {
    backgroundColor: '#7CF5D3',
    shadowColor: '#7CF5D3',
    shadowOpacity: 0.8,
    shadowRadius: 8,
    elevation: 4,
  },
  dotIdle: {
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  dotToday: {
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  weekday: {
    fontWeight: '600',
    fontSize: 12,
    lineHeight: 16,
    color: 'rgba(233, 240, 255, 0.6)',
  },
  weekdayActive: {
    color: '#FFFFFF',
  },
  hr: {
    fontFamily: FONT.semi,
    fontSize: 11,
    lineHeight: 14,
    color: GV.teal,
    fontVariant: ['tabular-nums'],
  },
  hrIdle: {
    fontSize: 11,
    lineHeight: 14,
    color: 'rgba(255, 255, 255, 0.25)',
  },
  legend: {
    ...TYPE.caption,
    color: GV.fog,
    textAlign: 'center',
  },
});
