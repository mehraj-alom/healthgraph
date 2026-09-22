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

import { useEffect, useRef } from 'react';
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
import { Button, ErrorState, ProgressBar } from '@/components';
import { useRppgMeasurement } from '@/hooks/useRppgMeasurement';
import { isRppgBusyState } from '@/services/rppg';
import { RppgCameraPreview, RppgCameraPreviewBoundary } from 'healthgraph-rppg';
import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
import { StageGradient } from '@/components/StageGradient';
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

/** Flat status pill — wash fill, ink label. No colored fills. */
function StatusPill({ label }: { label: string }) {
  return (
    <View style={styles.pill}>
      <Text style={styles.pillText}>{label}</Text>
    </View>
  );
}

export default function RppgMeasureScreen() {
  const navigation = useNavigation<Nav>();
  const {
    state,
    hint,
    result,
    progressFrames,
    liveStability,
    modelProgress,
    synced,
    error,
    permissionBlocked,
    start,
    cancel,
    reset,
  } = useRppgMeasurement();

  const busy = isRppgBusyState(state);
  const hr = result?.heartRateBpm ?? null;
  const hasResult = state === 'COMPLETE' && result != null && hr != null;
  const isModelDownload = state === 'MODEL_DOWNLOAD';
  const progress = isModelDownload
    ? Math.max(0, Math.min(100, modelProgress ?? 0))
    : state === 'COMPLETE' || state === 'MEASURING' || state === 'COMPLETING'
      ? 100
      : Math.max(0, Math.min(100, (progressFrames / WINDOW_FRAMES) * 100));

  // Leaving the screen or backgrounding ends an ACTIVE capture (no orphan
  // camera). Guarded by busy: cancelling while IDLE would emit a spurious
  // native CANCELLED and its telemetry for a run that never started.
  const busyRef = useRef(false);
  busyRef.current = busy;
  useEffect(() => {
    const sub = navigation.addListener('beforeRemove', () => {
      if (busyRef.current) void cancel();
    });
    return sub;
  }, [navigation, cancel]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background' && busyRef.current) void cancel();
    });
    return () => sub.remove();
  }, [cancel]);

  const exit = () => {
    if (navigation.canGoBack()) navigation.goBack();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StageGradient />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Face pulse scan</Text>
        <Text style={styles.hint}>{hint}</Text>

        <View style={styles.previewWrap}>
          <RppgCameraPreviewBoundary style={styles.preview}>
            <RppgCameraPreview style={styles.preview} />
          </RppgCameraPreviewBoundary>
          {busy && (
            <View style={styles.guide} pointerEvents="none">
              <View style={styles.oval} />
            </View>
          )}
        </View>

        {busy && (
          <ProgressBar
            segments={progress}
            label={
              isModelDownload
                ? `Model download ${Math.round(progress)} percent`
                : `Capture progress ${Math.round(progress)} percent`
            }
          />
        )}

        {isModelDownload && (
          <Text style={styles.stability}>
            First use downloads the pulse model once. Afterwards it works offline.
          </Text>
        )}

        {liveStability !== null && busy && (
          <Text style={styles.stability}>
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
          <View style={styles.result}>
            <Text style={styles.resultBpm}>
              {hr} BPM
            </Text>
            <View style={styles.badges}>
              <StatusPill
                label={result.qualityLevel === 'reliable' ? 'Reliable' : 'Borderline'}
              />
              <StatusPill label={`Quality ${qualityLabel(result.signalQuality)}`} />
              <StatusPill label="Face scan" />
            </View>
            <Text style={styles.resultMeta}>
              {synced === true
                ? 'Saved · synced'
                : synced === false
                  ? 'Saved · will sync when online'
                  : 'Saved'}
            </Text>
            <Button title="Done" onPress={exit} fullWidth />
            <Button title="Scan again" onPress={() => reset()} variant="secondary" fullWidth />
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

        <Text style={styles.disclaimer}>
          {DISCLAIMER} Your face images never leave this phone.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: GV.stage },
  content: {
    paddingHorizontal: SPACE.screenH,
    paddingBottom: 32,
    gap: SPACE.cardGap,
  },
  title: {
    ...TYPE.display,
    color: GV.card,
    textAlign: 'center',
    marginTop: 8,
  },
  hint: {
    ...TYPE.body,
    color: GV.fog,
    textAlign: 'center',
    marginBottom: 8,
  },
  previewWrap: {
    borderRadius: SPACE.rCard,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
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
    borderColor: GV.teal,
    backgroundColor: 'transparent',
  },
  stability: {
    ...TYPE.caption,
    color: GV.fog,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  result: {
    backgroundColor: GV.card,
    borderRadius: SPACE.rCard,
    padding: SPACE.cardPad,
    gap: SPACE.cardGap,
    alignItems: 'center',
  },
  resultBpm: {
    fontFamily: FONT.semi,
    fontSize: 48,
    lineHeight: 56,
    color: GV.ink,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  badges: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  pill: {
    backgroundColor: GV.wash,
    borderRadius: SPACE.rPill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pillText: {
    ...TYPE.chip,
    color: GV.ink,
  },
  resultMeta: {
    ...TYPE.caption,
    color: GV.muted,
    textAlign: 'center',
  },
  disclaimer: {
    ...TYPE.caption,
    color: GV.fog,
    textAlign: 'center',
    marginTop: 8,
  },
});
