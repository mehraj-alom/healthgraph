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
import { TILE_TONES } from '@/theme/tones';
import { CategoryTile } from '@/components/CategoryTile';
import { HealthFact } from '@/components/HealthFact';
import { useReducedMotion } from '@/theme';
import { useFoodScan } from '@/hooks/useFoodScan';
import type { RootStackParamList } from '@/types';
import ScanResultSheet from './ScanResultSheet';
import BarcodeScanner from './BarcodeScanner';
import { barcodeResultFor, type BarcodeProduct } from '@/services/barcode';
import type { FoodScanResult } from '@/services/nutritionService';

void FONT;

type Nav = NativeStackNavigationProp<RootStackParamList, 'FoodScan'>;

const FRAME_H = 320;
const SWEEP_MS = 2800;

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

  const sweep = useSharedValue(0);
  const [mode, setMode] = useState<'photo' | 'barcode'>('photo');
  // Pick-first flow: the first screen is the selection (Meal vs
  // Barcode). Choosing one opens its camera. Change returns here.
  const [chosen, setChosen] = useState<'photo' | 'barcode' | null>(null);
  const pick = (m: 'photo' | 'barcode') => {
    setBarcodeResult(null);
    setBarcodeImage(null);
    reset();
    setMode(m);
    setChosen(m);
  };
  const [barcodeResult, setBarcodeResult] = useState<FoodScanResult | null>(null);
  const [barcodeImage, setBarcodeImage] = useState<string | null>(null);

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
  if ((stage === 'done' && result && photoUri) || barcodeResult) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView
          contentContainerStyle={styles.resultContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <Text style={styles.title}>Scan food</Text>
          </View>
          <ScanResultSheet
            photoUri={barcodeResult ? barcodeImage : photoUri}
            photoLabel={barcodeResult ? 'Product image' : undefined}
            result={(barcodeResult ?? result)!}
            onRetake={() => {
              setBarcodeResult(null);
              setBarcodeImage(null);
              reset();
            }}
            onLogged={goBack}
          />
          <Text style={styles.disclaimer}>
            Estimates only. Not exact nutrition advice.
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
        <Text style={styles.title}>Scan food</Text>
      </View>

      {chosen == null ? (
      <View style={styles.modeRow} accessibilityRole="tablist">
        {([
          { key: 'photo', label: 'Meal', tone: TILE_TONES.nutrition },
          { key: 'barcode', label: 'Barcode', tone: TILE_TONES.weight },
        ] as const).map((m) => (
          <View key={m.key} style={styles.pickWrap}>
            <CategoryTile
              tone={m.tone}
              label={m.label}
              center
              large
              active={mode === m.key && chosen != null}
              accessibilityLabel={m.key === 'photo' ? 'Scan a meal by photo' : 'Scan by barcode'}
              onPress={() => pick(m.key)}
            />
          </View>
        ))}
      </View>
      ) : null}

      {chosen == null ? null : resolving ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={GV.teal} />
          <Text style={styles.hint}>Preparing camera…</Text>
          <HealthFact style={styles.factText} />
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
      <>
      {mode === 'barcode' ? (
        <View style={styles.barcodeWrap}>
          <BarcodeScanner
            onProduct={(product: BarcodeProduct, barcode: string) => {
              setBarcodeResult(barcodeResultFor(product, 100, barcode));
              setBarcodeImage(product.image_url || null);
            }}
            onCancel={() => setChosen(null)}
          />
        </View>
      ) : (
        <View style={styles.finder}>
          <Pressable
            onPress={() => setChosen(null)}
            accessibilityRole="button"
            accessibilityLabel="Change scan type"
            hitSlop={8}
            style={styles.changeHit}
          >
            <Text style={styles.changeText}>Change</Text>
          </Pressable>
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
            {stage !== 'error' ? (
              <View style={styles.captureFloat} pointerEvents="box-none">
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
            ) : null}
          </View>

          {stage === 'error' ? (
            <View style={styles.errorWrap}>
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
            </View>
          ) : null}

          <Text style={styles.disclaimer}>
            Estimates only. Not exact nutrition advice.
          </Text>
        </View>
      )}
      </>
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

const NAVY = '#080A11';
const TILE_BG = '#2A3049';
const HAIRLINE_ON_NAVY = 'rgba(255, 255, 255, 0.12)';

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: NAVY,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 4,
    alignItems: 'center',
  },
  title: {
    fontFamily: FONT.semi,
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: -0.3,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  center: {
    flex: 1,
    paddingHorizontal: 24,
    alignItems: 'stretch',
    justifyContent: 'center',
  },
  finder: {
    flex: 1,
    paddingBottom: 16,
    gap: 12,
  },
  barcodeWrap: {
    flex: 1,
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  modeRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  pickWrap: {
    flex: 1,
    height: 150,
  },
  changeHit: {
    alignSelf: 'flex-end',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    marginRight: 12,
  },
  changeText: {
    ...TYPE.caption,
    color: GV.fog,
  },
  frame: {
    flex: 1,
    minHeight: 320,
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
  factText: {
    ...TYPE.caption,
    color: GV.fog,
    textAlign: 'center',
    alignSelf: 'center',
    maxWidth: 300,
    marginTop: 8,
  },
  captureFloat: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorWrap: {
    paddingHorizontal: 24,
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
    borderWidth: 4,
    borderColor: '#FFFFFF',
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureInner: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: '#FFFFFF',
  },
  card: {
    backgroundColor: TILE_BG,
    borderWidth: 1,
    borderColor: HAIRLINE_ON_NAVY,
    borderRadius: 8,
    padding: 16,
    gap: 12,
    alignItems: 'stretch',
  },
  cardTitle: {
    ...TYPE.title,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  cardBody: {
    ...TYPE.body,
    color: GV.fog,
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
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    borderRadius: SPACE.rPill,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  secondaryCtaText: {
    ...TYPE.button,
    color: '#FFFFFF',
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
    paddingHorizontal: 24,
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
    paddingHorizontal: 24,
    paddingBottom: 32,
    gap: 12,
  },
});
