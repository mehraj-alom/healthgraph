import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CameraView } from 'expo-camera';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
import { useReducedMotion } from '@/theme';
import { useFoodScan } from '@/hooks/useFoodScan';
import type { RootStackParamList } from '@/types';
import ScanResultSheet from './ScanResultSheet';

void FONT;

type Nav = NativeStackNavigationProp<RootStackParamList, 'FoodScan'>;

const FRAME_H = 320;
const SWEEP_MS = 2800;

/**
 * Aiming tips, rotated on a timer. These are framing guidance — not sensor
 * readings — so the hint line never claims to measure light or distance.
 */
const AIM_TIPS = [
  'Hold steady for a clear shot',
  'Move closer to fill the frame',
  'Use good light for the best estimate',
] as const;

/** Typing-dots indicator (functional motion only; static under reduced motion). */
function TypingDots() {
  const reducedMotion = useReducedMotion();
  const o1 = useSharedValue(0.3);
  const o2 = useSharedValue(0.3);
  const o3 = useSharedValue(0.3);

  useEffect(() => {
    if (reducedMotion) {
      o1.value = 1;
      o2.value = 1;
      o3.value = 1;
      return;
    }
    const pulse = () =>
      withSequence(
        withTiming(1, { duration: 450, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.3, { duration: 450, easing: Easing.inOut(Easing.ease) }),
      );
    o1.value = withRepeat(pulse(), -1, false);
    o2.value = withDelay(150, withRepeat(pulse(), -1, false));
    o3.value = withDelay(300, withRepeat(pulse(), -1, false));
    return () => {
      cancelAnimation(o1);
      cancelAnimation(o2);
      cancelAnimation(o3);
    };
  }, [reducedMotion, o1, o2, o3]);

  const s1 = useAnimatedStyle(() => ({ opacity: o1.value }));
  const s2 = useAnimatedStyle(() => ({ opacity: o2.value }));
  const s3 = useAnimatedStyle(() => ({ opacity: o3.value }));

  return (
    <View style={styles.dots} accessibilityLabel="Loading">
      <Animated.View style={[styles.dot, { backgroundColor: GV.cta }, s1]} />
      <Animated.View style={[styles.dot, { backgroundColor: GV.cta }, s2]} />
      <Animated.View style={[styles.dot, { backgroundColor: GV.cta }, s3]} />
    </View>
  );
}

/** Four flat corner brackets over the viewfinder (positioning aid only). */
function CornerBrackets() {
  return (
    <View style={styles.brackets} pointerEvents="none">
      <View style={[styles.corner, styles.cornerTL]} />
      <View style={[styles.corner, styles.cornerTR]} />
      <View style={[styles.corner, styles.cornerBL]} />
      <View style={[styles.corner, styles.cornerBR]} />
    </View>
  );
}

export default function FoodScanScreen() {
  const navigation = useNavigation<Nav>();
  const reducedMotion = useReducedMotion();
  const {
    permission,
    requestPermission,
    cameraRef,
    cameraReady,
    setCameraReady,
    stage,
    photoUri,
    result,
    error,
    capture,
    reset,
  } = useFoodScan();

  const [tipIndex, setTipIndex] = useState(0);
  const sweep = useSharedValue(0);

  // Rotate aiming tips while the live viewfinder is up.
  useEffect(() => {
    if (stage !== 'idle') return;
    const timer = setInterval(() => {
      setTipIndex((i) => (i + 1) % AIM_TIPS.length);
    }, 3000);
    return () => clearInterval(timer);
  }, [stage]);

  // Slow top-to-bottom teal sweep; static when reduced motion is requested.
  useEffect(() => {
    if (reducedMotion || stage !== 'idle') {
      cancelAnimation(sweep);
      return;
    }
    sweep.value = withRepeat(
      withTiming(1, { duration: SWEEP_MS, easing: Easing.linear }),
      -1,
      false,
    );
    return () => cancelAnimation(sweep);
  }, [reducedMotion, stage, sweep]);

  const sweepStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: reducedMotion ? FRAME_H / 2 : sweep.value * (FRAME_H - 4),
      },
    ],
  }));

  const goBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
  };

  // ── Result ──────────────────────────────────────────────────────────────
  if (stage === 'done' && result && photoUri) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView
          contentContainerStyle={styles.resultContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <Pressable
              onPress={goBack}
              accessibilityRole="button"
              accessibilityLabel="Go back"
              hitSlop={8}
              style={styles.backBtn}
            >
              <Text style={styles.backBtnText}>‹ Back</Text>
            </Pressable>
            <Text style={styles.title}>Scan food</Text>
          </View>
          <ScanResultSheet
            photoUri={photoUri}
            result={result}
            onRetake={reset}
            onLogged={goBack}
          />
          <Text style={styles.disclaimer}>
            Estimates only — not exact nutrition advice.
          </Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const resolving = permission == null;
  const granted = permission?.granted === true;
  const canAskAgain = permission?.canAskAgain !== false;
  const busy = stage === 'capturing' || stage === 'analyzing';

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          onPress={goBack}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={8}
          style={styles.backBtn}
        >
          <Text style={styles.backBtnText}>‹ Back</Text>
        </Pressable>
        <Text style={styles.title}>Scan food</Text>
        <Text style={styles.subtitle}>Point at your meal, then capture.</Text>
      </View>

      {resolving ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={GV.teal} />
          <Text style={styles.hint}>Preparing camera…</Text>
        </View>
      ) : !granted ? (
        <View style={styles.center}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Camera is off</Text>
            <Text style={styles.cardBody}>
              HealthGraph needs camera access to scan your meal. Your photos
              stay on this device except for the estimation request.
            </Text>
            {canAskAgain ? (
              <Pressable
                onPress={() => void requestPermission()}
                accessibilityRole="button"
                accessibilityLabel="Enable camera"
                style={({ pressed }) => [
                  styles.cta,
                  pressed && { backgroundColor: GV.ctaPressed },
                ]}
              >
                <Text style={styles.ctaText}>Enable camera</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => void Linking.openSettings()}
              accessibilityRole="button"
              accessibilityLabel="Open system settings to enable camera access"
              style={({ pressed }) => [
                styles.secondaryCta,
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={styles.secondaryCtaText}>Open Settings</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.finder}>
          <View style={styles.frame}>
            <CameraView
              ref={cameraRef}
              style={styles.camera}
              facing="back"
              onCameraReady={() => setCameraReady(true)}
            />
            <CornerBrackets />
            {stage === 'idle' ? (
              <Animated.View style={[styles.sweep, sweepStyle]} pointerEvents="none" />
            ) : null}
          </View>

          <Text style={styles.hint}>{AIM_TIPS[tipIndex]}</Text>

          {stage === 'error' ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Scan did not complete</Text>
              <Text style={styles.cardBody}>
                {error ?? 'The photo could not be analyzed. Please try again.'}
              </Text>
              <Pressable
                onPress={reset}
                accessibilityRole="button"
                accessibilityLabel="Try again"
                style={({ pressed }) => [
                  styles.cta,
                  pressed && { backgroundColor: GV.ctaPressed },
                ]}
              >
                <Text style={styles.ctaText}>Try again</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.captureRow}>
              <Pressable
                onPress={() => void capture()}
                disabled={!cameraReady || busy}
                accessibilityRole="button"
                accessibilityLabel="Capture meal photo"
                accessibilityState={{ disabled: !cameraReady || busy, busy }}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.captureBtn,
                  pressed && cameraReady && !busy && { transform: [{ scale: 0.94 }] },
                  (!cameraReady || busy) && { opacity: 0.55 },
                ]}
              >
                <View style={styles.captureInner} />
              </Pressable>
            </View>
          )}

          <Text style={styles.disclaimer}>
            Estimates only — not exact nutrition advice.
          </Text>
        </View>
      )}

      {/* Analyzing overlay: typing dots + honest status copy. */}
      {busy ? (
        <View style={styles.overlay} pointerEvents="auto">
          <View style={styles.card}>
            <TypingDots />
            <Text style={styles.cardTitle}>Estimating portions…</Text>
            <Text style={styles.cardBody}>
              Reading dishes and portion sizes from your photo.
            </Text>
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: GV.stage,
  },
  header: {
    paddingHorizontal: SPACE.screenH,
    paddingTop: 8,
    gap: 4,
  },
  backBtn: {
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
  },
  backBtnText: {
    ...TYPE.button,
    fontSize: 16,
    color: GV.fog,
  },
  title: {
    ...TYPE.display,
    color: GV.card,
    textAlign: 'center',
  },
  subtitle: {
    ...TYPE.body,
    color: GV.fog,
    textAlign: 'center',
    marginBottom: 8,
  },
  center: {
    flex: 1,
    paddingHorizontal: SPACE.screenH,
    alignItems: 'stretch',
    justifyContent: 'center',
  },
  finder: {
    flex: 1,
    paddingHorizontal: SPACE.screenH,
    paddingBottom: 24,
    gap: SPACE.cardGap,
  },
  frame: {
    height: FRAME_H,
    borderRadius: SPACE.rCard,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  camera: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  brackets: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  corner: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderColor: GV.teal,
  },
  cornerTL: {
    left: 16,
    top: 16,
    borderLeftWidth: 3,
    borderTopWidth: 3,
    borderTopLeftRadius: 8,
  },
  cornerTR: {
    right: 16,
    top: 16,
    borderRightWidth: 3,
    borderTopWidth: 3,
    borderTopRightRadius: 8,
  },
  cornerBL: {
    left: 16,
    bottom: 16,
    borderLeftWidth: 3,
    borderBottomWidth: 3,
    borderBottomLeftRadius: 8,
  },
  cornerBR: {
    right: 16,
    bottom: 16,
    borderRightWidth: 3,
    borderBottomWidth: 3,
    borderBottomRightRadius: 8,
  },
  sweep: {
    position: 'absolute',
    left: 24,
    right: 24,
    height: 2,
    backgroundColor: GV.teal,
  },
  hint: {
    ...TYPE.body,
    color: GV.fog,
    textAlign: 'center',
  },
  captureRow: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  captureBtn: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: GV.pulse,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: GV.card,
  },
  card: {
    backgroundColor: GV.card,
    borderRadius: SPACE.rCard,
    padding: SPACE.cardPad,
    gap: SPACE.cardGap,
    alignItems: 'stretch',
  },
  cardTitle: {
    ...TYPE.title,
    color: GV.ink,
    textAlign: 'center',
  },
  cardBody: {
    ...TYPE.body,
    color: GV.body,
    textAlign: 'center',
  },
  cta: {
    backgroundColor: GV.cta,
    borderRadius: SPACE.rPill,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  ctaText: {
    ...TYPE.button,
    color: '#FFFFFF',
  },
  secondaryCta: {
    backgroundColor: GV.wash,
    borderRadius: SPACE.rPill,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  secondaryCtaText: {
    ...TYPE.button,
    color: GV.ink,
  },
  disclaimer: {
    ...TYPE.caption,
    color: GV.fog,
    textAlign: 'center',
  },
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    paddingHorizontal: SPACE.screenH,
    alignItems: 'stretch',
    justifyContent: 'center',
  },
  dots: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  resultContent: {
    paddingHorizontal: SPACE.screenH,
    paddingBottom: 32,
    gap: SPACE.cardGap,
  },
});
