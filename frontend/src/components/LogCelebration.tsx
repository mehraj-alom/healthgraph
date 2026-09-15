import { useEffect, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  ZoomIn,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { useReducedMotion } from '@/theme';
import { bezier, curves } from '@/theme/motion';

interface LogCelebrationProps {
  visible: boolean;
  onDone: () => void;
  /** Accent for the badge + confetti. */
  color?: string;
  title?: string;
  subtitle?: string;
}

const PIECES = 16;
const COLORS = ['#2FBF71', '#4D8DFF', '#FD79A8', '#F1C40F', '#00B4D8', '#9B59B6'];

function pieceSpec(i: number): { angle: number; dist: number; color: string; size: number; delay: number } {
  // Deterministic pseudo-random burst — stable across renders.
  const angle = (i / PIECES) * Math.PI * 2 + (i % 3) * 0.22;
  const dist = 74 + ((i * 37) % 46);
  return {
    angle,
    dist,
    color: COLORS[i % COLORS.length]!,
    size: 7 + ((i * 13) % 7),
    delay: (i % 4) * 45,
  };
}

function ConfettiPiece({ index, reduced }: { index: number; reduced: boolean }) {
  const spec = useMemo(() => pieceSpec(index), [index]);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (reduced) return;
    progress.value = withDelay(spec.delay, withTiming(1, { duration: 750, easing: bezier(curves.standard) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = useAnimatedStyle(() => {
    if (reduced) return { opacity: 0 };
    const p = progress.value;
    const x = Math.cos(spec.angle) * spec.dist * p;
    const y = Math.sin(spec.angle) * spec.dist * p + 44 * p * p;
    return {
      opacity: 1 - p,
      transform: [{ translateX: x }, { translateY: y }, { rotate: `${p * 260}deg` }],
    };
  });

  if (reduced) return null;
  return (
    <Animated.View
      style={[
        styles.piece,
        { width: spec.size, height: spec.size * 0.62, backgroundColor: spec.color },
        style,
      ]}
    />
  );
}

/**
 * LogCelebration — one-shot "log saved" delight overlay.
 *
 * Purpose (rare-tier): delight on success. A spring badge + short confetti
 * burst, then auto-dismiss. Reduced motion: static badge, no confetti, no
 * translation. Never blocks: pointer events pass through except the badge.
 */
export function LogCelebration({
  visible,
  onDone,
  color = '#2FBF71',
  title = 'Logged',
  subtitle = 'Nice — your health story is up to date.',
}: LogCelebrationProps) {
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(onDone, reduced ? 1200 : 1700);
    return () => clearTimeout(t);
  }, [visible, reduced, onDone]);

  if (!visible) return null;

  return (
    <Animated.View
      style={styles.scrim}
      entering={reduced ? FadeIn.duration(120) : FadeIn.duration(220)}
      pointerEvents="box-none"
    >
      <View style={styles.center} pointerEvents="none">
        {/* Confetti burst */}
        <View style={styles.burst} pointerEvents="none">
          {Array.from({ length: PIECES }, (_, i) => (
            <ConfettiPiece key={i} index={i} reduced={reduced} />
          ))}
        </View>
        {/* Badge */}
        <Animated.View
          style={[styles.badge, { backgroundColor: color }]}
          entering={
            reduced
              ? FadeIn.duration(150)
              : ZoomIn.springify().damping(16).stiffness(260)
          }
        >
          <Text style={styles.check}>✓</Text>
        </Animated.View>
        <Animated.View entering={reduced ? undefined : FadeIn.delay(120).duration(220)}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  burst: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  piece: {
    position: 'absolute',
    borderRadius: 2,
  },
  badge: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  check: {
    color: '#fff',
    fontSize: 40,
    fontWeight: '700',
  },
  title: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    marginTop: 14,
    textAlign: 'center',
  },
  subtitle: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 14,
    marginTop: 4,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
});
