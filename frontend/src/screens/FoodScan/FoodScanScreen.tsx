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
import { GV, TYPE, SPACE } from '@/theme/guava';
import { LG } from '@/theme/liquidGlass';
import { GlassSurface } from '@/components/home/GlassSurface';
import { HomeStageBackdrop } from '@/components/home/HomeStageBackdrop';
import Entrance from '@/components/home/Entrance';
import { ExploreGlyph, type GlyphName } from '@/components/home/ExploreGlyphs';
import { HealthFact } from '@/components/HealthFact';
import { useReducedMotion } from '@/theme';
import { useFoodScan } from '@/hooks/useFoodScan';
import type { RootStackParamList } from '@/types';
import ScanResultSheet from './ScanResultSheet';
import BarcodeScanner from './BarcodeScanner';
import { barcodeResultFor, type BarcodeProduct } from '@/services/barcode';
import type { FoodScanResult } from '@/services/nutritionService';

/** Scan-type pick tiles: monochrome glyph + label on frosted glass. */
const PICK_TILES: { key: 'photo' | 'barcode'; label: string; glyph: GlyphName; hint: string }[] = [
  { key: 'photo', label: 'Meal', glyph: 'camera', hint: 'Scan a meal by photo' },
  { key: 'barcode', label: 'Barcode', glyph: 'scan', hint: 'Scan by barcode' },
];

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
      <Animated.View style={[styles.dot, { backgroundColor: '#FFFFFF' }, s1]} />
      <Animated.View style={[styles.dot, { backgroundColor: '#FFFFFF' }, s2]} />
      <Animated.View style={[styles.dot, { backgroundColor: '#FFFFFF' }, s3]} />
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
    setBarcodeCached(false);
    reset();
    setMode(m);
    setChosen(m);
  };
  const [barcodeResult, setBarcodeResult] = useState<FoodScanResult | null>(null);
  const [barcodeImage, setBarcodeImage] = useState<string | null>(null);
  const [barcodeCached, setBarcodeCached] = useState(false);

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
      <View style={styles.screen}>
        <HomeStageBackdrop />
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView
          contentContainerStyle={styles.resultContent}
          keyboardShouldPersistTaps="handled"
        >
          <Entrance index={0}>
            <View style={styles.header}>
              <Text style={styles.title}>Scan food</Text>
            </View>
          </Entrance>
          {barcodeCached ? (
            <Text style={styles.cachedNote}>
              Saved product · check the label.
            </Text>
          ) : null}
          <Entrance index={1}>
            <ScanResultSheet
            photoUri={barcodeResult ? barcodeImage : photoUri}
            photoLabel={barcodeResult ? 'Product image' : undefined}
            result={(barcodeResult ?? result)!}
            onRetake={() => {
              setBarcodeResult(null);
              setBarcodeImage(null);
              setBarcodeCached(false);
              reset();
            }}
            onLogged={goBack}
          />
          </Entrance>
          <Text style={styles.disclaimer}>
            Estimates only. Not exact nutrition advice.
          </Text>
        </ScrollView>
        </SafeAreaView>
      </View>
    );
  }

  const resolving = permission == null;
  const granted = permission?.granted === true;
  const canAskAgain = permission?.canAskAgain !== false;
  const busy = stage === 'capturing' || stage === 'analyzing';

  return (
    <View style={styles.screen}>
      <HomeStageBackdrop />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Entrance index={0}>
        <View style={styles.header}>
          <Text style={styles.title}>Scan food</Text>
          <Text style={styles.heroSub}>
            {chosen == null ? 'Meal or barcode.' : chosen === 'photo' ? 'Fit the meal in the frame.' : 'Point at the barcode.'}
          </Text>
        </View>
      </Entrance>

      {/* Content stage: everything below the title lives here, so the
          analyzing overlay can never cover the hero. */}
      <View style={styles.body}>
      {chosen == null ? (
      <Entrance index={1}>
      <View style={styles.modeRow} accessibilityRole="tablist">
        {PICK_TILES.map((m) => (
          <GlassSurface
            key={m.key}
            radius={20}
            style={styles.pickTile}
            onPress={() => pick(m.key)}
            accessibilityRole="button"
            accessibilityLabel={m.hint}
          >
            <ExploreGlyph name={m.glyph} size={28} color="rgba(255,255,255,0.92)" />
            <Text style={styles.pickLabel} maxFontSizeMultiplier={1.2}>
              {m.label}
            </Text>
          </GlassSurface>
        ))}
      </View>
      </Entrance>
      ) : null}

      {chosen == null ? null : resolving ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#FFFFFF" />
          <Text style={styles.hint}>Preparing camera…</Text>
          <HealthFact style={styles.factText} />
        </View>
      ) : !granted ? (
        <View style={styles.center}>
          <GlassSurface strong style={styles.card}>
            <Text style={styles.cardTitle}>Camera is off</Text>
            <Text style={styles.cardBody}>
              Needs camera access. Photos stay on this device.
            </Text>
            {canAskAgain ? (
              <Pressable
                onPress={() => void requestPermission()}
                accessibilityRole="button"
                accessibilityLabel="Enable camera"
                style={({ pressed }) => [
                  styles.cta,
                  pressed && { opacity: 0.85 },
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
          </GlassSurface>
        </View>
      ) : (
      <>
      {mode === 'barcode' ? (
        <View style={styles.barcodeWrap}>
          <BarcodeScanner
            onProduct={(product: BarcodeProduct, barcode: string) => {
              setBarcodeResult(barcodeResultFor(product, 100, barcode));
              setBarcodeImage(product.image_url || null);
              setBarcodeCached(product.cached === true);
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
              <GlassSurface strong style={styles.card}>
                <Text style={styles.cardTitle}>Scan did not complete</Text>
                <Text style={styles.cardBody}>
                  {error ?? 'Could not read that photo.'}
                </Text>
                <Pressable
                  onPress={reset}
                  accessibilityRole="button"
                  accessibilityLabel="Try again"
                  style={({ pressed }) => [
                    styles.cta,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Text style={styles.ctaText}>Try again</Text>
                </Pressable>
              </GlassSurface>
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
          <GlassSurface strong style={styles.card}>
            <TypingDots />
            <Text style={styles.cardTitle}>Reading your photo…</Text>
          </GlassSurface>
        </View>
      ) : null}
      </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: LG.stage.bottom,
  },
  safe: {
    flex: 1,
  },
  // Content stage below the hero: owns the overlay bounds.
  body: {
    flex: 1,
    position: 'relative',
  },
  header: {
    paddingHorizontal: 26,
    paddingTop: 20,
    paddingBottom: 4,
    gap: 3,
  },
  title: {
    fontWeight: '600',
    fontSize: 34,
    lineHeight: 41,
    letterSpacing: -0.8,
    color: '#FFFFFF',
    textAlign: 'left',
  },
  heroSub: {
    fontWeight: '400',
    fontSize: 17,
    lineHeight: 22,
    color: 'rgba(233,240,255,0.66)',
    textAlign: 'left',
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
    paddingHorizontal: 26,
    paddingBottom: 24,
  },
  // Pick tiles: frosted glass, glyph over label, ≥44pt by construction.
  pickTile: {
    flex: 1,
    minHeight: 150,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 16,
  },
  pickLabel: {
    fontWeight: '600',
    fontSize: 19,
    lineHeight: 24,
    letterSpacing: -0.2,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  changeHit: {
    alignSelf: 'flex-end',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    marginRight: 12,
  },
  changeText: {
    fontWeight: '600',
    fontSize: 13,
    lineHeight: 18,
    color: LG.card.mint,
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
    borderColor: 'rgba(255,255,255,0.85)',
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
    backgroundColor: LG.card.mint,
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
    padding: 20,
    gap: 12,
    alignItems: 'stretch',
  },
  cardTitle: {
    fontWeight: '600',
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.3,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  cardBody: {
    fontWeight: '400',
    fontSize: 15,
    lineHeight: 22,
    color: 'rgba(233,240,255,0.66)',
    textAlign: 'center',
  },
  // The one prominent action on dark: a white pill.
  cta: {
    backgroundColor: '#FFFFFF',
    borderRadius: SPACE.rPill,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  ctaText: {
    fontWeight: '600',
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.1,
    color: '#0B0F1A',
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
    fontWeight: '600',
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.1,
    color: '#FFFFFF',
  },
  disclaimer: {
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: 'rgba(233,240,255,0.45)',
    textAlign: 'center',
  },
  cachedNote: {
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: 'rgba(233,240,255,0.66)',
    textAlign: 'center',
    paddingHorizontal: 26,
    marginBottom: 8,
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
