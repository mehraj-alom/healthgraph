/**
 * RppgMeasureScreen — face heart-rate measurement (wellness only).
 *
 * Flow (screen → useRppgMeasurement → frame source → RppgProvider):
 * idle → preparing → find/position face → acquiring (progress + stability
 * guidance) → analyzing → result | failed.
 *
 * Honesty rules enforced here (mirroring the fingertip screen):
 * - No BPM is shown before the pipeline returns one, and never when the
 *   quality gate fails (null HR → failed UI, not a number).
 * - The guide overlay is a positioning aid, not data: no waveform is drawn.
 * - Borderline quality is badged and flagged; insufficient runs show the
 *   true reason and are never persisted (the hook refuses them).
 * - Wellness copy only: no diagnosis / disease / BP / treatment claims.
 */

import { useEffect } from 'react';
import {
  AppState,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Badge, Button, ErrorState, ProgressBar } from '@/components';
import { useRppgMeasurement } from '@/hooks/useRppgMeasurement';
import { RppgCameraPreview, RppgCameraPreviewBoundary } from 'healthgraph-rppg';
import { useTheme } from '@/theme';
import { spacing, radius } from '@/theme/tokens';
import type { RootStackParamList } from '@/types';

type Nav = NativeStackNavigationProp<RootStackParamList, 'RppgMeasure'>;

const WINDOW_FRAMES = 160;

const DISCLAIMER =
  'Wellness measurement only. Not a medical device — not for diagnosis, treatment, or blood-pressure estimation.';

function qualityLabel(quality: number): string {
  if (quality >= 0.75) return 'Good';
  if (quality >= 0.5) return 'Fair';
  return 'Poor';
}

export default function RppgMeasureScreen() {
  const navigation = useNavigation<Nav>();
  const { colors, typography } = useTheme();
  const {
    state,
    hint,
    result,
    progressFrames,
    liveStability,
    synced,
    error,
    permissionBlocked,
    start,
    cancel,
    reset,
  } = useRppgMeasurement();

  const busy = [
    'PREPARING',
    'FIND_FACE',
    'POSITION_FACE',
    'ACQUIRING',
    'MEASURING',
    'SIGNAL_WEAK',
    'FACE_LOST',
    'COMPLETING',
  ].includes(state);
  const hr = result?.heartRateBpm ?? null;
  const hasResult = state === 'COMPLETE' && result != null && hr != null;
  const progress =
    state === 'COMPLETE' || state === 'MEASURING' || state === 'COMPLETING'
      ? 100
      : Math.max(0, Math.min(100, (progressFrames / WINDOW_FRAMES) * 100));

  // Leaving the screen or backgrounding ends capture (no orphan camera).
  useEffect(() => {
    const sub = navigation.addListener('beforeRemove', () => {
      void cancel();
    });
    return sub;
  }, [navigation, cancel]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background') void cancel();
    });
    return () => sub.remove();
  }, [cancel]);

  const exit = () => {
    if (navigation.canGoBack()) navigation.goBack();
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[typography.heading, { color: colors.textPrimary }]}>
          Face pulse scan
        </Text>
        <Text style={[typography.bodySecondary, { color: colors.textSecondary }]}>
          {hint}
        </Text>

        <View style={styles.previewWrap}>
          <RppgCameraPreviewBoundary style={styles.preview}>
            <RppgCameraPreview style={styles.preview} />
          </RppgCameraPreviewBoundary>
          {busy && (
            <View style={styles.guide} pointerEvents="none">
              <View style={[styles.oval, { borderColor: colors.brand }]} />
            </View>
          )}
        </View>

        {busy && (
          <ProgressBar
            segments={progress}
            label={`Capture progress ${Math.round(progress)} percent`}
          />
        )}

        {liveStability !== null && busy && (
          <Text style={[typography.captionStrong, { color: colors.textSecondary }]}>
            Face stability {Math.round(liveStability * 100)}%
          </Text>
        )}

        {!busy && !hasResult && state !== 'FAILED' && (
          <Button title="Start face scan" onPress={() => void start()} fullWidth />
        )}

        {busy && (
          <Button title="Cancel" onPress={() => void cancel()} variant="secondary" fullWidth />
        )}

        {hasResult && result && (
          <View style={[styles.result, { borderColor: colors.border }]}>
            <Text style={[typography.metricValue, { color: colors.textPrimary }]}>
              {hr} BPM
            </Text>
            <View style={styles.badges}>
              <Badge
                label={result.qualityLevel === 'reliable' ? 'Reliable' : 'Borderline'}
                health={result.qualityLevel === 'reliable' ? 'positive' : 'attention'}
              />
              <Badge label={`Quality ${qualityLabel(result.signalQuality)}`} tone="neutral" />
              <Badge label="Face scan" tone="purple" />
            </View>
            <Text style={[typography.bodySecondary, { color: colors.textSecondary }]}>
              {synced === true
                ? 'Saved · synced'
                : synced === false
                  ? 'Saved · will sync when online'
                  : 'Saved'}
            </Text>
            <Button title="Scan again" onPress={() => reset()} variant="outline" fullWidth />
            <Button title="Done" onPress={exit} variant="ghost" fullWidth />
          </View>
        )}

        {state === 'FAILED' && (
          <ErrorState
            title="Scan did not complete"
            message={error ?? 'Measurement could not be completed. Try again.'}
          />
        )}
        {state === 'FAILED' && permissionBlocked && (
          <Button
            title="Open Settings"
            onPress={() => void Linking.openSettings()}
            fullWidth
          />
        )}
        {state === 'FAILED' && !permissionBlocked && (
          <Button title="Try again" onPress={() => void start()} fullWidth />
        )}

        <Text style={[styles.disclaimer, typography.caption, { color: colors.textSecondary }]}>
          {DISCLAIMER} Your face images never leave this phone.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.md },
  previewWrap: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#000' },
  preview: { minHeight: 320 },
  guide: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  oval: {
    width: 200,
    height: 260,
    borderRadius: 100,
    borderWidth: 2,
    borderStyle: 'dashed',
    backgroundColor: 'transparent',
  },
  result: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    alignItems: 'center',
  },
  badges: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap', justifyContent: 'center' },
  disclaimer: { marginTop: spacing.md },
});
