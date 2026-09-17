/**
 * PpgMeasureScreen — fingertip heart-rate measurement (wellness only).
 *
 * One provider-agnostic flow (screen → usePpgMeasurement → PPG provider):
 * ready → measuring (progress + signal-quality feedback) → result | failed.
 *
 * Honesty rules enforced here:
 * - No BPM is shown before the pipeline returns one, and never when the
 *   signal-quality gate fails (heartRateBpm null → failed UI, not a number).
 * - The pulse animation is a state indicator, not data: no waveform is
 *   rendered because the provider exposes none (raw stays on-device).
 * - Simulation is badged SIMULATED and never looks like a real measurement.
 * - Wellness copy only: no diagnosis / disease / BP / treatment claims.
 */

import { useEffect, useRef, useState } from 'react';
import {
  AppState,
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
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { Button, ErrorState, ProgressBar } from '@/components';
import { usePpgMeasurement } from '@/hooks/usePpgMeasurement';
import { useReducedMotion } from '@/theme';
import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
import type { MainTabParamList, RootStackParamList } from '@/types';
import { PpgCameraPreview } from 'healthgraph-ppg';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';

type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'PpgMeasure'>,
  NativeStackNavigationProp<RootStackParamList>
>;

/** Fixed measurement window (matches the hook's default start call). */
const MEASURE_DURATION_SECONDS = 60;

/**
 * Display bands derived from the SAME gates the pipeline uses:
 * below 0.5 the native result is unreliable (HR nulled). The 0.25 cut is a
 * display-only band boundary (native weak-signal state is SIGNAL_WEAK).
 * The screen adds no new algorithm.
 */
type QualityBand = 'good' | 'weak' | 'poor';

function qualityBand(quality: number | null): QualityBand | null {
  if (quality == null) return null;
  if (quality >= 0.5) return 'good';
  if (quality >= 0.25) return 'weak';
  return 'poor';
}

const QUALITY_COPY: Record<QualityBand, { label: string; guidance: string }> = {
  good: {
    label: 'Signal looks good',
    guidance: 'Hold still — almost there.',
  },
  weak: {
    label: 'Signal is weak',
    guidance: 'Signal is weak — adjust your finger so the camera and flash are fully covered.',
  },
  poor: {
    label: 'No reliable signal',
    guidance: 'Unable to get a reliable signal. Keep your finger still and make sure the camera and flash are fully covered.',
  },
};

const QUALITY_DOT: Record<QualityBand, string> = {
  good: GV.cta,
  weak: GV.fx.amber,
  poor: GV.danger,
};

function resultQualityLabel(quality: number): string {
  if (quality >= 0.75) return 'Good';
  if (quality >= 0.5) return 'Fair';
  return 'Poor';
}

function resultQualityDot(quality: number): string {
  if (quality >= 0.75) return GV.cta;
  if (quality >= 0.5) return GV.fx.amber;
  return GV.danger;
}

const DISCLAIMER =
  'Wellness measurement only. Not a medical device — not for diagnosis, treatment, or blood-pressure estimation.';

/**
 * Indicative sensing animation. Driven by measurement STATE (band), never by
 * physiological data — the provider exposes no live waveform, so none is
 * drawn. Static when reduced motion is requested.
 */
function SensingPulse({ band }: { band: QualityBand | null }) {
  const reducedMotion = useReducedMotion();
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (reducedMotion) return;
    pulse.value = withRepeat(
      withTiming(1, {
        duration: band === 'poor' ? 1400 : 1000,
        easing: Easing.inOut(Easing.ease),
      }),
      -1,
      true,
    );
    return () => {
      pulse.value = 0;
    };
  }, [pulse, reducedMotion, band]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: reducedMotion ? 1 : 1 + 0.1 * pulse.value }],
    opacity: reducedMotion ? 1 : 0.55 + 0.45 * pulse.value,
  }));

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel="Measuring. Sensing indicator."
      style={styles.pulseRing}
    >
      <Animated.View style={[styles.pulseCore, animatedStyle]}>
        <Text style={styles.pulseGlyph}>♥</Text>
      </Animated.View>
    </View>
  );
}

export default function PpgMeasureScreen() {
  const navigation = useNavigation<Nav>();
  const reducedMotion = useReducedMotion();
  const {
    state,
    result,
    liveQuality,
    liveBpm,
    simulated,
    synced,
    error,
    permissionBlocked,
    start,
    cancel,
    reset,
  } = usePpgMeasurement();

  const busy =
    state === 'STARTING' ||
    state === 'WAITING_FOR_FINGER' ||
    state === 'ACQUIRING' ||
    state === 'MEASURING' ||
    state === 'SIGNAL_WEAK' ||
    state === 'FINGER_REMOVED' ||
    state === 'QUALITY_WARNING' ||
    state === 'COMPLETING';

  const hr = result?.heartRateBpm ?? null;
  const hasResult = state === 'COMPLETE' && result != null && hr != null;
  // A persistence/sync error alongside a valid result is surfaced inline on
  // the result card — it must not trigger the failed-measurement screen.
  const failed =
    !busy &&
    !hasResult &&
    (state === 'FAILED' ||
      error != null ||
      (state === 'COMPLETE' && result != null && hr == null));

  // Elapsed seconds within the expected window (display progress only).
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const timer = setInterval(() => {
      setElapsed((value) => value + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [busy]);

  // Completion timestamp for the result display (result carries no clock).
  const [completedAt, setCompletedAt] = useState<number | null>(null);
  useEffect(() => {
    if (hasResult) setCompletedAt(Date.now());
    else if (!result) setCompletedAt(null);
  }, [hasResult, result]);

  const progress = Math.min(
    100,
    Math.round((elapsed / MEASURE_DURATION_SECONDS) * 100),
  );
  const band = qualityBand(liveQuality);

  const leave = () => {
    if (busy) void cancel();
    exitMeasure();
  };

  /** Back out of the measure flow. As a tab there may be no back stack —
      fall back to the Home tab instead of stranding the user. */
  const exitMeasure = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('Dashboard');
  };

  // System/gesture back bypasses the header button: stop the camera and
  // torch here too so a measurement can never keep running after unmount.
  const busyRef = useRef(busy);
  busyRef.current = busy;
  useEffect(() => {
    const sub = navigation.addListener('beforeRemove', () => {
      if (busyRef.current) void cancel();
    });
    return sub;
  }, [navigation, cancel]);

  // Backgrounding mid-session must end the session explicitly: otherwise the
  // camera/torch lifecycle is left to the OS and the watchdog could later
  // resolve partial data. Cancel turns torch off, unbinds, and settles
  // the promise as CANCELLED (never saved).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background' && busyRef.current) void cancel();
    });
    return () => sub.remove();
  }, [cancel]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Header: back affordance + simulation badge. */}
      <View style={styles.header}>
        <Pressable
          onPress={leave}
          accessibilityRole="button"
          accessibilityLabel={busy ? 'Cancel measurement and go back' : 'Go back'}
          hitSlop={12}
          style={styles.backBtn}
        >
          <Text style={styles.backBtnText}>‹ Back</Text>
        </Pressable>
        <View style={styles.headerSpacer} />
        {simulated ? (
          <View
            accessible
            accessibilityLabel="Simulation mode. Not a real measurement."
            style={styles.simBadge}
          >
            <Text style={styles.simBadgeText}>SIMULATED</Text>
          </View>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {simulated ? (
          <Text style={styles.simNote}>
            Simulation mode — synthetic numbers for preview only. Never saved,
            never synced, never health data.
          </Text>
        ) : null}

        {/* ── READY ─────────────────────────────────────────── */}
        {!busy && !hasResult && !failed ? (
          <View style={styles.phase}>
            <Text style={styles.overline}>Heart Rate</Text>
            <Text style={styles.screenTitle}>Heart Rate</Text>
            <Text style={styles.screenSubtitle}>
              Measure your pulse using your phone&apos;s camera.
            </Text>

            <View style={styles.card}>
              <View style={styles.instructionIcon}>
                <Text style={styles.instructionGlyph}>♥</Text>
              </View>
              <Text style={styles.cardBody}>
                Place your fingertip gently over the camera and flash.
              </Text>
              <Text style={styles.cardCaption}>
                About a minute · stay still · on this device only
              </Text>
            </View>

            <Button
              title={simulated ? 'Start simulated check' : 'Start measurement'}
              onPress={() => void start(MEASURE_DURATION_SECONDS)}
              size="large"
              fullWidth
              accessibilityLabel={
                simulated
                  ? 'Start simulated heart rate check'
                  : 'Start 60 second heart rate measurement'
              }
            />
          </View>
        ) : null}

        {/* ── LIVE SESSION ────────────────────────────────────
            The live rear-camera preview is the main measurement surface on
            real builds (same camera that feeds analysis): the user sees
            their finger and the illuminated field. Overlays carry state only.
            WAITING_FOR_FINGER: no finger yet — never show a BPM.
            ACQUIRING: finger seen, first window still filling — no BPM yet.
            MEASURING + liveBpm: confident live BPM, updates ~1Hz.
            MEASURING without liveBpm (transient): detecting copy, no number.
            SIGNAL_WEAK: finger present, no confident BPM — guidance only.
            FINGER_REMOVED: live BPM invalidated — resume automatically. */}
        {busy ? (
          <View style={styles.phase}>
            {!simulated ? (
              <View
                accessible
                accessibilityRole="image"
                accessibilityLabel="Live camera preview. Cover the camera and flash with your fingertip."
                style={styles.previewFrame}
              >
                <PpgCameraPreview style={styles.preview} />
                <View style={styles.previewOverlay} pointerEvents="none">
            {/* Native sessions show the live BPM overlaid on the preview;
                the standalone hero below is the simulation path. */}
            {state === 'MEASURING' && liveBpm != null && simulated ? (
                    <View
                      accessible
                      accessibilityLiveRegion="polite"
                      accessibilityLabel={`Live heart rate ${Math.round(liveBpm)} beats per minute.`}
                      style={styles.previewBpmBadge}
                    >
                      <Text style={styles.previewBpmText}>
                        {Math.round(liveBpm)}
                      </Text>
                      <Text style={styles.previewBpmUnit}>
                        BPM · Live
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.previewStatePill}>
                      <Text style={styles.previewStateText}>
                        {state === 'WAITING_FOR_FINGER'
                          ? 'Place your finger over the camera'
                          : state === 'ACQUIRING' ||
                              (state === 'MEASURING' && liveBpm == null)
                            ? 'Detecting pulse…'
                            : state === 'SIGNAL_WEAK'
                              ? 'Keep your finger still'
                              : state === 'FINGER_REMOVED'
                                ? 'Finger removed — place your finger over the camera'
                                : 'Measuring…'}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            ) : null}
            {state === 'WAITING_FOR_FINGER' ? (
              <View
                accessible
                accessibilityLiveRegion="polite"
                accessibilityLabel="Waiting for finger. Place your finger over the camera."
                style={styles.card}
              >
                <View style={styles.instructionIcon}>
                  <Text style={styles.instructionGlyph}>♥</Text>
                </View>
                <Text style={styles.cardTitle}>
                  Place your finger over the camera
                </Text>
                <Text style={styles.cardCaption}>
                  Cover the camera and flash fully. Measurement starts automatically.
                </Text>
              </View>
            ) : null}

            {/* On real builds the camera preview above is the visual; the
                placeholder art renders for simulation only. */}
            {(state === 'ACQUIRING' ||
              (state === 'MEASURING' && liveBpm == null)) &&
            simulated ? (
              <View
                accessible
                accessibilityLiveRegion="polite"
                accessibilityLabel="Detecting pulse."
              >
                <SensingPulse band={band} />
              </View>
            ) : null}
            {state === 'ACQUIRING' ||
            (state === 'MEASURING' && liveBpm == null) ? (
              <Text style={styles.statusTitle}>
                Detecting pulse…
              </Text>
            ) : null}
            {state === 'ACQUIRING' ||
            (state === 'MEASURING' && liveBpm == null) ? (
              <Text style={styles.statusBody}>
                Keep your fingertip over the camera and flash.
              </Text>
            ) : null}

            {state === 'MEASURING' && liveBpm != null ? (
              <View
                accessible
                accessibilityLiveRegion="polite"
                accessibilityLabel={`Live heart rate ${Math.round(liveBpm)} beats per minute.`}
                style={styles.resultHero}
              >
                <Text style={styles.heroBpm}>
                  {Math.round(liveBpm)}
                </Text>
                <Text style={styles.heroUnit}>
                  BPM · Live
                </Text>
              </View>
            ) : null}

            {state === 'SIGNAL_WEAK' && simulated ? (
              <View
                accessible
                accessibilityLiveRegion="polite"
                accessibilityLabel="Signal weak. Keep your finger still."
              >
                <SensingPulse band={band} />
              </View>
            ) : null}
            {state === 'SIGNAL_WEAK' ? (
              <Text style={styles.statusTitle}>
                Keep your finger still
              </Text>
            ) : null}
            {state === 'SIGNAL_WEAK' ? (
              <Text style={styles.statusBody}>
                The pulse signal is unclear. Hold still with the camera and
                flash fully covered.
              </Text>
            ) : null}

            {state === 'FINGER_REMOVED' ? (
              <View
                accessible
                accessibilityLiveRegion="polite"
                accessibilityLabel="Finger removed. Place your finger over the camera to continue."
                style={styles.card}
              >
                <Text style={styles.cardTitle}>
                  Finger removed
                </Text>
                <Text style={styles.cardBody}>
                  Place your finger over the camera to continue.
                </Text>
                <Text style={styles.cardCaption}>
                  The live reading was cleared and will resume automatically.
                </Text>
              </View>
            ) : null}

            {(state === 'STARTING' ||
              state === 'QUALITY_WARNING' ||
              state === 'COMPLETING') &&
            simulated ? (
              <View
                accessible
                accessibilityLiveRegion="polite"
                accessibilityLabel={`Measuring heart rate. ${elapsed} seconds elapsed of about ${MEASURE_DURATION_SECONDS}. ${
                  band ? QUALITY_COPY[band].label : 'Starting'
                }.`}
              >
                <SensingPulse band={band} />
              </View>
            ) : null}

            {state === 'STARTING' ||
            state === 'QUALITY_WARNING' ||
            state === 'COMPLETING' ? (
              <Text style={styles.statusTitle}>
                Measuring…
              </Text>
            ) : null}

            <ProgressBar
              segments={progress}
              label={`Measurement progress, ${progress} percent`}
              animate={!reducedMotion}
            />
            <Text style={styles.elapsed}>
              {elapsed}s of about {MEASURE_DURATION_SECONDS}s
            </Text>

            {band ? (
              <View style={styles.qualityCard}>
                <View
                  style={[
                    styles.qualityDot,
                    { backgroundColor: QUALITY_DOT[band] },
                  ]}
                />
                <View style={styles.qualityText}>
                  <Text style={styles.qualityLabel}>
                    {QUALITY_COPY[band].label}
                  </Text>
                  <Text style={styles.qualityGuidance}>
                    {QUALITY_COPY[band].guidance}
                  </Text>
                </View>
              </View>
            ) : null}

            <Button
              title="Cancel"
              variant="secondary"
              onPress={() => void cancel()}
              fullWidth
              accessibilityLabel="Cancel measurement"
            />
          </View>
        ) : null}

        {/* ── RESULT ────────────────────────────────────────── */}
        {hasResult && result ? (
          <View style={styles.phase}>
            <Text style={styles.overline}>
              Your measurement
            </Text>
            <View
              accessible
              accessibilityRole="summary"
              accessibilityLabel={`Your heart rate measurement: ${Math.round(hr)} beats per minute.`}
              style={styles.resultHero}
            >
              <Text style={styles.heroBpm}>
                {Math.round(hr)}
              </Text>
              <Text style={styles.heroUnit}>
                BPM · Heart rate
              </Text>
            </View>

            {result.rmssdMs != null || result.sdnnMs != null ? (
              <View style={styles.hrvCard}>
                <Text style={styles.hrvLabel}>
                  HEART RATE VARIABILITY
                </Text>
                <Text style={styles.hrvValue}>
                  {result.rmssdMs != null
                    ? `RMSSD ${result.rmssdMs.toFixed(0)} ms`
                    : null}
                  {result.rmssdMs != null && result.sdnnMs != null
                    ? '  ·  '
                    : null}
                  {result.sdnnMs != null
                    ? `SDNN ${result.sdnnMs.toFixed(0)} ms`
                    : null}
                </Text>
              </View>
            ) : (
              <Text style={styles.elapsed}>
                HRV not available for this measurement.
              </Text>
            )}

            <View style={styles.qualityCard}>
              <View
                style={[
                  styles.qualityDot,
                  { backgroundColor: resultQualityDot(result.signalQuality) },
                ]}
              />
              <View style={styles.qualityText}>
                <Text style={styles.qualityLabel}>
                  {`Signal quality: ${resultQualityLabel(result.signalQuality)}`}
                </Text>
              </View>
            </View>
            <Text style={styles.elapsed}>
              {completedAt
                ? new Date(completedAt).toLocaleString(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })
                : null}
              {'  ·  '}
              {result.simulated === true
                ? 'Development simulation'
                : 'Real device measurement'}
            </Text>
            {result.simulated === true ? (
              <Text style={styles.elapsed}>
                Simulation — not saved, not synced.
              </Text>
            ) : (
              <Text style={styles.elapsed}>
                {synced === true
                  ? 'Saved · synced to HealthGraph.'
                  : synced === false
                    ? 'Saved on this device · will sync when online.'
                    : 'Saving…'}
              </Text>
            )}
            {error && result.simulated !== true ? (
              <View style={styles.qualityCard}>
                <View style={styles.qualityText}>
                  <Text style={styles.saveError}>
                    Couldn&apos;t save this measurement yet — it will retry
                    automatically.
                  </Text>
                </View>
              </View>
            ) : null}

            <Button
              title="Done"
              onPress={() => exitMeasure()}
              size="large"
              fullWidth
              accessibilityLabel="Done, back to HealthGraph"
            />
            <Button
              title="Measure again"
              variant="secondary"
              onPress={() => {
                reset();
              }}
              fullWidth
              accessibilityLabel="Measure again"
            />
          </View>
        ) : null}

        {/* ── FAILED ────────────────────────────────────────── */}
        {failed ? (
          <View style={styles.phase}>
            <ErrorState
              title="Measurement couldn't be completed"
              message={
                permissionBlocked
                  ? 'Camera access is turned off for HealthGraph. Enable it in Settings, then try again.'
                  : (error ??
                    'Keep your finger still and make sure the camera and flash are fully covered.')
              }
              onRetry={() => {
                reset();
                void start(MEASURE_DURATION_SECONDS);
              }}
              retryLabel="Try again"
            />
            {permissionBlocked ? (
              <Button
                title="Open Settings"
                onPress={() => void Linking.openSettings()}
                fullWidth
                accessibilityLabel="Open system settings to enable camera access"
              />
            ) : null}
            <Button
              title="Done"
              variant="secondary"
              onPress={() => exitMeasure()}
              fullWidth
              accessibilityLabel="Done, back to HealthGraph"
            />
          </View>
        ) : null}

        <Text style={styles.disclaimer}>
          {DISCLAIMER}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: GV.stage,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACE.screenH,
    paddingTop: 8,
    minHeight: 44,
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
  headerSpacer: {
    flex: 1,
  },
  simBadge: {
    borderWidth: 1,
    borderColor: GV.stageline,
    borderRadius: SPACE.rPill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  simBadgeText: {
    ...TYPE.chip,
    color: GV.teal,
  },
  content: {
    paddingHorizontal: SPACE.screenH,
    paddingBottom: 32,
    gap: SPACE.cardGap,
  },
  phase: {
    gap: SPACE.cardGap,
    alignItems: 'stretch',
  },
  overline: {
    ...TYPE.caption,
    color: GV.fog,
    textAlign: 'center',
  },
  screenTitle: {
    ...TYPE.display,
    color: GV.card,
    textAlign: 'center',
  },
  screenSubtitle: {
    ...TYPE.body,
    color: GV.fog,
    textAlign: 'center',
  },
  simNote: {
    ...TYPE.caption,
    color: GV.fog,
    textAlign: 'center',
  },
  card: {
    backgroundColor: GV.card,
    borderRadius: SPACE.rCard,
    padding: SPACE.cardPad,
    gap: 8,
    alignItems: 'center',
  },
  cardTitle: {
    ...TYPE.title,
    color: GV.ink,
    textAlign: 'center',
  },
  cardBody: {
    ...TYPE.body,
    color: GV.ink,
    textAlign: 'center',
  },
  cardCaption: {
    ...TYPE.caption,
    color: GV.muted,
    textAlign: 'center',
  },
  instructionIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: GV.wash,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  instructionGlyph: {
    fontFamily: FONT.semi,
    fontSize: 32,
    lineHeight: 36,
    color: GV.fx.pink,
  },
  previewFrame: {
    borderRadius: SPACE.rCard,
    overflow: 'hidden',
    height: 300,
    backgroundColor: '#000',
  },
  preview: {
    ...StyleSheet.absoluteFill,
  },
  previewOverlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'flex-end',
    alignItems: 'center',
    padding: SPACE.screenH,
  },
  previewBpmBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 22,
  },
  previewBpmText: {
    fontFamily: FONT.semi,
    fontSize: 40,
    lineHeight: 44,
    color: '#fff',
    fontVariant: ['tabular-nums'],
  },
  previewBpmUnit: {
    ...TYPE.caption,
    color: 'rgba(255,255,255,0.8)',
  },
  previewStatePill: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: SPACE.screenH,
    paddingVertical: 8,
    borderRadius: SPACE.rPill,
  },
  previewStateText: {
    ...TYPE.button,
    fontSize: 15,
    color: '#fff',
    textAlign: 'center',
  },
  pulseRing: {
    width: 168,
    height: 168,
    borderRadius: 84,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: GV.stageline,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  pulseCore: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: GV.fx.pink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseGlyph: {
    fontFamily: FONT.semi,
    fontSize: 40,
    lineHeight: 44,
    color: '#FFFFFF',
  },
  qualityCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: GV.card,
    borderRadius: SPACE.rCard,
    padding: SPACE.cardPad,
  },
  qualityDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 6,
  },
  qualityText: {
    flex: 1,
    gap: 8,
  },
  qualityLabel: {
    fontFamily: FONT.semi,
    fontSize: 15,
    lineHeight: 22,
    color: GV.ink,
  },
  qualityGuidance: {
    ...TYPE.caption,
    color: GV.body,
  },
  saveError: {
    ...TYPE.caption,
    color: GV.danger,
  },
  statusTitle: {
    ...TYPE.title,
    color: GV.card,
    textAlign: 'center',
  },
  statusBody: {
    ...TYPE.body,
    color: GV.fog,
    textAlign: 'center',
  },
  elapsed: {
    ...TYPE.caption,
    color: GV.fog,
    textAlign: 'center',
  },
  resultHero: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  heroBpm: {
    fontFamily: FONT.semi,
    fontSize: 64,
    lineHeight: 72,
    color: GV.card,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  heroUnit: {
    ...TYPE.body,
    color: GV.fog,
    textAlign: 'center',
  },
  hrvCard: {
    backgroundColor: GV.card,
    borderRadius: SPACE.rCard,
    padding: SPACE.cardPad,
    gap: 8,
    alignItems: 'center',
  },
  hrvLabel: {
    ...TYPE.caption,
    color: GV.muted,
    letterSpacing: 1,
  },
  hrvValue: {
    ...TYPE.body,
    color: GV.ink,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  disclaimer: {
    ...TYPE.caption,
    color: GV.fog,
    textAlign: 'center',
  },
});
