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
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { Badge, Button, ErrorState, ProgressBar } from '@/components';
import { usePpgMeasurement } from '@/hooks/usePpgMeasurement';
import { useReducedMotion, useTheme } from '@/theme';
import { healthIcon } from '@/theme/icons';
import { spacing, radius, layout } from '@/theme/tokens';
import type { RootStackParamList } from '@/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** Fixed measurement window (matches the hook's default start call). */
const MEASURE_DURATION_SECONDS = 60;

/**
 * Display bands derived from the SAME gates the pipeline uses:
 * below 0.5 the native result is unreliable (HR nulled); below 0.25 the
 * native layer raises QUALITY_WARNING. The screen adds no new algorithm.
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

function resultQualityLabel(quality: number): string {
  if (quality >= 0.75) return 'Good';
  if (quality >= 0.5) return 'Fair';
  return 'Poor';
}

const DISCLAIMER =
  'Wellness measurement only. Not a medical device — not for diagnosis, treatment, or blood-pressure estimation.';

/**
 * Indicative sensing animation. Driven by measurement STATE (band), never by
 * physiological data — the provider exposes no live waveform, so none is
 * drawn. Static when reduced motion is requested.
 */
function SensingPulse({ band }: { band: QualityBand | null }) {
  const { colors, health } = useTheme();
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
      style={[
        styles.pulseRing,
        {
          backgroundColor: colors.surfaceSunken,
          borderColor: colors.border,
        },
      ]}
    >
      <Animated.View
        style={[
          styles.pulseCore,
          { backgroundColor: health.vitals },
          animatedStyle,
        ]}
      >
        <Text style={styles.pulseGlyph}>{healthIcon.heartRate}</Text>
      </Animated.View>
    </View>
  );
}

export default function PpgMeasureScreen() {
  const navigation = useNavigation<Nav>();
  const { colors, typography, animation } = useTheme();
  const reducedMotion = useReducedMotion();
  const {
    state,
    result,
    liveQuality,
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
    state === 'MEASURING' ||
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
    navigation.goBack();
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

  const entering = reducedMotion
    ? undefined
    : FadeInUp.duration(animation.emphasized);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top', 'bottom']}
    >
      {/* Header: back affordance + simulation badge. */}
      <View style={styles.header}>
        <Pressable
          onPress={leave}
          accessibilityRole="button"
          accessibilityLabel={busy ? 'Cancel measurement and go back' : 'Go back'}
          hitSlop={12}
          style={styles.backBtn}
        >
          <Text style={[styles.backBtnText, { color: colors.textSecondary }]}>
            ‹ Back
          </Text>
        </Pressable>
        <View style={styles.headerSpacer} />
        {simulated ? (
          <View
            accessible
            accessibilityLabel="Simulation mode. Not a real measurement."
          >
            <Badge label="SIMULATED" tone="blue" />
          </View>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {simulated ? (
          <Text
            style={[
              styles.simNote,
              typography.caption,
              { color: colors.textMuted },
            ]}
          >
            Simulation mode — synthetic numbers for preview only. Never saved,
            never synced, never health data.
          </Text>
        ) : null}

        {/* ── READY ─────────────────────────────────────────── */}
        {!busy && !hasResult && !failed ? (
          <Animated.View entering={entering} style={styles.phase}>
            <Text
              style={[typography.overline, { color: colors.textMuted }]}
            >
              Heart Rate
            </Text>
            <Text
              style={[typography.largeHeading, { color: colors.textPrimary }]}
            >
              Heart Rate
            </Text>
            <Text style={[typography.body, { color: colors.textSecondary }]}>
              Measure your pulse using your phone&apos;s camera.
            </Text>

            <View
              style={[
                styles.instruction,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  borderRadius: radius.xxl,
                },
              ]}
            >
              <View
                style={[
                  styles.instructionIcon,
                  {
                    backgroundColor: colors.surfaceSunken,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text style={styles.instructionGlyph}>
                  {healthIcon.heartRate}
                </Text>
              </View>
              <Text
                style={[typography.body, { color: colors.textPrimary }]}
              >
                Place your fingertip gently over the camera and flash.
              </Text>
              <Text
                style={[typography.caption, { color: colors.textMuted }]}
              >
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
          </Animated.View>
        ) : null}

        {/* ── MEASURING ─────────────────────────────────────── */}
        {busy ? (
          <Animated.View entering={entering} style={styles.phase}>
            <View
              accessible
              accessibilityLiveRegion="polite"
              accessibilityLabel={`Measuring heart rate. ${elapsed} seconds elapsed of about ${MEASURE_DURATION_SECONDS}. ${
                band ? QUALITY_COPY[band].label : 'Starting'
              }.`}
            >
              <SensingPulse band={band} />
            </View>

            <Text
              style={[typography.sectionHeading, { color: colors.textPrimary }]}
            >
              Measuring…
            </Text>
            <Text
              style={[typography.bodySecondary, { color: colors.textSecondary }]}
            >
              Keep your fingertip over the camera and flash.
            </Text>

            <ProgressBar
              segments={progress}
              label={`Measurement progress, ${progress} percent`}
              animate={!reducedMotion}
            />
            <Text
              style={[typography.caption, { color: colors.textMuted }]}
            >
              {elapsed}s of about {MEASURE_DURATION_SECONDS}s
            </Text>

            {band ? (
              <View
                style={[
                  styles.qualityRow,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    borderRadius: radius.lg,
                  },
                ]}
              >
                <View
                  style={[
                    styles.qualityDot,
                    {
                      backgroundColor:
                        band === 'good'
                          ? colors.success
                          : band === 'weak'
                            ? colors.warning
                            : colors.error,
                    },
                  ]}
                />
                <View style={styles.qualityText}>
                  <Text
                    style={[
                      typography.bodyStrong,
                      { color: colors.textPrimary },
                    ]}
                  >
                    {QUALITY_COPY[band].label}
                  </Text>
                  <Text
                    style={[
                      typography.caption,
                      { color: colors.textSecondary },
                    ]}
                  >
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
          </Animated.View>
        ) : null}

        {/* ── RESULT ────────────────────────────────────────── */}
        {hasResult && result ? (
          <Animated.View entering={entering} style={styles.phase}>
            <Text
              style={[typography.overline, { color: colors.textMuted }]}
            >
              Your measurement
            </Text>
            <View
              accessible
              accessibilityRole="summary"
              accessibilityLabel={`Your heart rate measurement: ${Math.round(hr)} beats per minute.`}
              style={styles.resultHero}
            >
              <Text
                style={[typography.metricValue, { color: colors.textPrimary }]}
              >
                {Math.round(hr)}
              </Text>
              <Text
                style={[typography.metricUnit, { color: colors.textSecondary }]}
              >
                BPM · Heart rate
              </Text>
            </View>

            {result.rmssdMs != null || result.sdnnMs != null ? (
              <View
                style={[
                  styles.hrvRow,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    borderRadius: radius.lg,
                  },
                ]}
              >
                <Text
                  style={[
                    typography.captionStrong,
                    { color: colors.textSecondary },
                  ]}
                >
                  HEART RATE VARIABILITY
                </Text>
                <Text
                  style={[typography.body, { color: colors.textPrimary }]}
                >
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
            ) : null}

            <View style={styles.metaRow}>
              <Badge
                label={`Signal quality: ${resultQualityLabel(result.signalQuality)}`}
                health={
                  result.signalQuality >= 0.75
                    ? 'positive'
                    : result.signalQuality >= 0.5
                      ? 'neutral'
                      : 'attention'
                }
                dot
              />
            </View>
            <Text
              style={[typography.caption, { color: colors.textMuted }]}
            >
              {completedAt
                ? new Date(completedAt).toLocaleString(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })
                : null}
              {'  ·  '}PPG measurement
            </Text>
            {result.simulated === true ? (
              <Text
                style={[typography.caption, { color: colors.textMuted }]}
              >
                Simulation — not saved, not synced.
              </Text>
            ) : (
              <Text
                style={[typography.caption, { color: colors.textMuted }]}
              >
                {synced === true
                  ? 'Saved · synced to HealthGraph.'
                  : synced === false
                    ? 'Saved on this device · will sync when online.'
                    : 'Saving…'}
              </Text>
            )}
            {error && result.simulated !== true ? (
              <Text
                style={[typography.caption, { color: colors.warning }]}
              >
                Couldn&apos;t save this measurement yet — it will retry
                automatically.
              </Text>
            ) : null}

            <Button
              title="Done"
              onPress={() => navigation.goBack()}
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
          </Animated.View>
        ) : null}

        {/* ── FAILED ────────────────────────────────────────── */}
        {failed ? (
          <Animated.View entering={entering} style={styles.phase}>
            <ErrorState
              title="Measurement couldn't be completed"
              message={
                permissionBlocked
                  ? 'Camera access is turned off for HealthGraph. Enable it in Settings, then try again.'
                  : 'Keep your finger still and make sure the camera and flash are fully covered.'
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
              onPress={() => navigation.goBack()}
              fullWidth
              accessibilityLabel="Done, back to HealthGraph"
            />
          </Animated.View>
        ) : null}

        <Text
          style={[
            styles.disclaimer,
            typography.caption,
            { color: colors.textMuted },
          ]}
        >
          {DISCLAIMER}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    minHeight: layout.minTouchTarget,
  },
  backBtn: {
    minWidth: layout.minTouchTarget,
    minHeight: layout.minTouchTarget,
    justifyContent: 'center',
  },
  backBtnText: {
    fontSize: 16,
    fontWeight: '600',
  },
  headerSpacer: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.section,
    gap: spacing.xl,
  },
  phase: {
    gap: spacing.lg,
    alignItems: 'stretch',
  },
  simNote: {
    textAlign: 'center',
  },
  instruction: {
    borderWidth: 1,
    padding: spacing.xl,
    gap: spacing.sm,
    alignItems: 'center',
  },
  instructionIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  instructionGlyph: {
    fontSize: 32,
  },
  pulseRing: {
    width: 168,
    height: 168,
    borderRadius: 84,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  pulseCore: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseGlyph: {
    fontSize: 40,
  },
  qualityRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    borderWidth: 1,
    padding: spacing.lg,
  },
  qualityDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 6,
  },
  qualityText: {
    flex: 1,
    gap: spacing.xs,
  },
  resultHero: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
  },
  hrvRow: {
    borderWidth: 1,
    padding: spacing.lg,
    gap: spacing.xs,
    alignItems: 'center',
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  disclaimer: {
    textAlign: 'center',
  },
});
