/**
 * PulseInstrumentScreen — the single pulse measurement experience.
 *
 * One active measurement path at a time (enforced by pulseMachineReducer):
 * face rPPG is probed first using REAL native viability signals; if the
 * camera cannot lock a steady face signal the user gets the honest reason
 * and an explicit fingertip path. The two cameras are never live together.
 *
 * Visualization contract: every number, point, and trace on this screen
 * comes from the live pipeline outputs (liveBpm, signalQuality, stability,
 * framesCollected, final rawSignal/waveform/rrIntervals). Absence of data
 * renders as absence — never as synthesized filler.
 *
 * Hooks, providers, native modules, persistence, sync, and backend are
 * reused untouched. This screen owns ONLY mode orchestration + honest UI.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { PpgCameraPreview } from 'healthgraph-ppg';
import { RppgCameraPreview, RppgCameraPreviewBoundary } from 'healthgraph-rppg';
import { usePpgMeasurement } from '@/hooks/usePpgMeasurement';
import { useRppgMeasurement } from '@/hooks/useRppgMeasurement';
import { getCachedPatientId } from '@/services/patientIdentity';
import { hrvBaseline, rmssd as computeRmssd, type HrvBaseline } from '@/services/hrv';
import { todayKeyLocal } from '@/utils/dayKey';
import { getRecentPpgMeasurements } from '@/db/queries/ppg';
import { getRecentRppgMeasurements } from '@/db/queries/rppg';
import {
  FACE_BUILD_BODY,
  FACE_BUILD_TITLE,
  FACE_PROBE_DEADLINE_MS,
  FACE_UNAVAILABLE_BODY,
  FACE_UNAVAILABLE_TITLE,
  FINGERTIP_INSTRUCTIONS,
  INITIAL_PULSE_STATE,
  decideFaceViability,
  isFaceBuildFailure,
  pulseMachineReducer,
  type FaceProbeSample,
} from '@/services/pulse/pulseMachine';
import {
  EngravedLabel,
  INST,
  QualityDial,
  TactileButton,
  Well,
} from '@/components/pulse/Instrument';
import { GlassSurface } from '@/components/home/GlassSurface';
import { HomeStageBackdrop } from '@/components/home/HomeStageBackdrop';
import { PaywallGate } from '@/components/PaywallGate';
import { tierUnlocks, usePremiumTier } from '@/services/premium';
import { LG } from '@/theme/liquidGlass';
import FaceGuideOverlay, { type FaceGuideVisual } from '@/components/pulse/FaceGuideOverlay';
import FingertipGuideOverlay, { type FingertipGuideVisual } from '@/components/pulse/FingertipGuideOverlay';
import PulseTraceView from '@/components/pulse/PulseTraceView';
import BpmTrendView, { type BpmPoint } from '@/components/pulse/BpmTrendView';

const FINGERTIP_DURATION_S = 60;

interface RecentRow {
  bpm: number;
  measuredAt: string;
  quality: number;
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function qualityLabel(quality: number): string {
  if (quality >= 0.75) return 'Good';
  if (quality >= 0.5) return 'Fair';
  return 'Poor';
}

function faceVisualFor(state: string): FaceGuideVisual {
  switch (state) {
    case 'FIND_FACE':
    case 'FACE_LOST':
      return 'searching';
    case 'POSITION_FACE':
      return 'acquiring';
    case 'ACQUIRING':
      return 'locked';
    case 'MEASURING':
    case 'COMPLETING':
      return 'measuring';
    case 'SIGNAL_WEAK':
      return 'poor';
    case 'COMPLETE':
      return 'complete';
    case 'FAILED':
      return 'failed';
    default:
      return 'idle';
  }
}

function fingertipVisualFor(state: string): FingertipGuideVisual {
  switch (state) {
    case 'WAITING_FOR_FINGER':
    case 'FINGER_REMOVED':
      return 'waiting';
    case 'ACQUIRING':
    case 'STARTING':
      return 'acquiring';
    case 'MEASURING':
    case 'COMPLETING':
      return 'measuring';
    case 'SIGNAL_WEAK':
    case 'QUALITY_WARNING':
      return 'poor';
    case 'COMPLETE':
      return 'complete';
    case 'FAILED':
      return 'failed';
    default:
      return 'idle';
  }
}

export default function PulseInstrumentScreen() {
  const navigation = useNavigation();
  const [machine, dispatch] = useReducer(pulseMachineReducer, INITIAL_PULSE_STATE);
  const rppg = useRppgMeasurement();
  const ppg = usePpgMeasurement();
  const [recentPpg, setRecentPpg] = useState<RecentRow | null>(null);
  const [recentRppg, setRecentRppg] = useState<RecentRow | null>(null);
  const [hrvBase, setHrvBase] = useState<HrvBaseline | null>(null);
  const [trend, setTrend] = useState<BpmPoint[]>([]);
  const [elapsed, setElapsed] = useState(0);
  // Premium gates only — measurement logic below is untouched. Camera
  // (fingertip PPG) needs General+, face rPPG needs All-in. Starts
  // free-safe, resolves live via usePremiumTier.
  const tier = usePremiumTier();
  const cameraUnlocked = tierUnlocks(tier, 'cameraPulse');
  const faceUnlocked = tierUnlocks(tier, 'facePulse');
  // Explicit camera vs face switcher. IDLE shows the selected mode's entry;
  // mid-flow phases derive the active mode from the machine (single source
  // of truth) so a locked camera can never mount while gated.
  const [preferredMode, setPreferredMode] = useState<'face' | 'camera'>('face');

  // Mutable run mirrors (effects + timers must see current values).
  const machineRef = useRef(machine);
  machineRef.current = machine;
  const rppgRef = useRef(rppg);
  rppgRef.current = rppg;
  const ppgRef = useRef(ppg);
  ppgRef.current = ppg;
  const probeSamples = useRef<FaceProbeSample[]>([]);
  const probeDeadlineAt = useRef<number | null>(null);
  const probeSettled = useRef(false);
  const runStartMs = useRef(0);
  const ppgResultSeen = useRef(false);
  const busyRef = useRef(false);
  busyRef.current =
    machine.phase === 'CHECKING' || machine.phase === 'FACE_RUN' || machine.phase === 'FINGERTIP_RUN';

  const loadRecent = useCallback(async () => {
    try {
      const patientId = getCachedPatientId();
      if (!patientId) {
        setRecentPpg(null);
        setRecentRppg(null);
        setHrvBase(null);
        return;
      }
      const [ppgRows, rppgRows] = await Promise.all([
        getRecentPpgMeasurements(patientId, 1),
        getRecentRppgMeasurements(patientId, 1),
      ]);
      try {
        const history = await getRecentPpgMeasurements(patientId, 60);
        setHrvBase(
          hrvBaseline(
            history.map((h) => ({ measured_at: h.measured_at, rmssd_ms: h.rmssd_ms })),
            todayKeyLocal(),
          ),
        );
      } catch {
        setHrvBase(null);
      }
      const p = ppgRows[0];
      setRecentPpg(
        p?.heart_rate_bpm != null
          ? { bpm: Math.round(p.heart_rate_bpm), measuredAt: p.measured_at, quality: p.signal_quality }
          : null,
      );
      const r = rppgRows[0];
      setRecentRppg(
        r?.heart_rate_bpm != null
          ? { bpm: Math.round(r.heart_rate_bpm), measuredAt: r.measured_at, quality: r.signal_quality }
          : null,
      );
    } catch {
      setRecentPpg(null);
      setRecentRppg(null);
    }
  }, []);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent, machine.phase]);

  // Leaving or backgrounding mid-run ends the ACTIVE session explicitly —
  // one mode only, so cancel the hook matching the authoritative mode.
  useEffect(() => {
    const off = navigation.addListener('beforeRemove', () => {
      if (!busyRef.current) return;
      const m = machineRef.current;
      if (m.mode === 'face') void rppgRef.current.cancel();
      else if (m.mode === 'fingertip') void ppgRef.current.cancel();
    });
    return off;
  }, [navigation]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'background' || !busyRef.current) return;
      const m = machineRef.current;
      if (m.mode === 'face') void rppgRef.current.cancel();
      else if (m.mode === 'fingertip') void ppgRef.current.cancel();
    });
    return () => sub.remove();
  }, []);

  // ---- Face probe: observe REAL native signals, decide, or fall back. ----
  useEffect(() => {
    const m = machine.phase;
    if (m !== 'CHECKING' && m !== 'FACE_RUN') return;
    const r = rppg;
    if (r.state === 'COMPLETE' && r.result?.heartRateBpm != null) {
      dispatch({ type: 'FACE_COMPLETE' });
      return;
    }
    if (r.state === 'FAILED') {
      dispatch({ type: 'FACE_FAILED', reason: r.error ?? 'The face scan could not be completed. Try again.' });
      return;
    }
    if (m === 'CHECKING') {
      probeSamples.current.push({ state: r.state, stability: r.liveStability, frames: r.progressFrames });
      if (probeDeadlineAt.current === null && r.state !== 'IDLE' && r.state !== 'PREPARING' && r.state !== 'MODEL_DOWNLOAD') {
        probeDeadlineAt.current = Date.now() + FACE_PROBE_DEADLINE_MS;
      }
      const deadline = probeDeadlineAt.current !== null && Date.now() >= probeDeadlineAt.current;
      const verdict = decideFaceViability(probeSamples.current, deadline, false);
      if (verdict === 'viable') {
        probeSettled.current = true;
        dispatch({ type: 'FACE_VIABLE' });
      } else if (verdict === 'unavailable') {
        probeSettled.current = true;
        // Stop the camera BEFORE leaving face mode: mode exclusivity.
        void rppg.cancel().catch(() => {}).then(() => {
          if (machineRef.current.phase === 'CHECKING') {
            dispatch({ type: 'FACE_UNAVAILABLE', reason: FACE_UNAVAILABLE_BODY });
          }
        });
      }
    }
  }, [machine.phase, rppg]);

  // ---- Fingertip terminal mapping (result may resolve after COMPLETE). ----
  useEffect(() => {
    if (machine.phase !== 'FINGERTIP_RUN') return;
    if (ppg.result !== null) ppgResultSeen.current = true;
    if (ppg.state === 'COMPLETE') {
      if (ppg.result?.heartRateBpm != null) dispatch({ type: 'FINGERTIP_COMPLETE' });
      else if (ppgResultSeen.current) {
        dispatch({
          type: 'FINGERTIP_FAILED',
          reason: ppg.error ?? 'No reliable pulse was found. Adjust your finger and try again.',
        });
      }
    } else if (ppg.state === 'FAILED') {
      dispatch({
        type: 'FINGERTIP_FAILED',
        reason: ppg.error ?? 'The fingertip measurement could not be completed. Try again.',
      });
    }
  }, [machine.phase, ppg]);

  // ---- Live fingertip trend (accepted liveBpm points only). ----
  useEffect(() => {
    if (machine.phase !== 'FINGERTIP_RUN') return;
    if (ppg.liveBpm === null || !Number.isFinite(ppg.liveBpm)) return;
    const t = Date.now() - runStartMs.current;
    setTrend((prev) => {
      if (prev.length > 0 && Math.abs(t - prev[prev.length - 1].t) < 800) return prev;
      const next = [...prev, { t, bpm: ppg.liveBpm as number }];
      return next.length > 150 ? next.slice(next.length - 150) : next;
    });
  }, [machine.phase, ppg.liveBpm]);

  // ---- Session clock for the fingertip sweep. ----
  useEffect(() => {
    if (machine.phase !== 'FINGERTIP_RUN') {
      setElapsed(0);
      return;
    }
    const id = setInterval(() => {
      setElapsed(Math.min(FINGERTIP_DURATION_S, (Date.now() - runStartMs.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [machine.phase]);

  const beginCheck = useCallback(async () => {
    try {
      await ppgRef.current.cancel();
    } catch {
      // Idle fingertip provider: nothing to stop.
    }
    ppgRef.current.reset();
    rppgRef.current.reset();
    probeSamples.current = [];
    probeDeadlineAt.current = null;
    probeSettled.current = false;
    setTrend([]);
    dispatch({ type: 'BEGIN_CHECK' });
    // Full pipeline start; the probe effect above either confirms viability
    // (same run continues) or cancels into the fingertip path.
    await rppgRef.current.start();
  }, []);

  const chooseFingertip = useCallback(() => {
    dispatch({ type: 'CHOOSE_FINGERTIP' });
  }, []);

  const retryFace = useCallback(() => {
    dispatch({ type: 'RETRY_FACE' });
    probeSamples.current = [];
    probeDeadlineAt.current = null;
    probeSettled.current = false;
    void rppgRef.current.start();
  }, []);

  const beginFingertip = useCallback(async () => {
    try {
      await rppgRef.current.cancel();
    } catch {
      // Face already idle: nothing to stop.
    }
    rppgRef.current.reset();
    ppgRef.current.reset();
    ppgResultSeen.current = false;
    setTrend([]);
    runStartMs.current = Date.now();
    dispatch({ type: 'BEGIN_FINGERTIP' });
    await ppgRef.current.start(FINGERTIP_DURATION_S, true);
    // Fail-fast guard: providers that refuse synchronously (missing native
    // module) never leave IDLE — surface their message instead of wedging.
    setTimeout(() => {
      const cur = machineRef.current;
      const hook = ppgRef.current;
      if (cur.phase === 'FINGERTIP_RUN' && hook.state === 'IDLE') {
        dispatch({
          type: 'FINGERTIP_FAILED',
          reason: hook.error ?? 'Fingertip measurement is unavailable in this build.',
        });
      }
    }, 1500);
  }, []);

  const cancelRun = useCallback(async () => {
    const m = machineRef.current;
    try {
      if (m.mode === 'face') await rppgRef.current.cancel();
      else if (m.mode === 'fingertip') await ppgRef.current.cancel();
    } catch {
      // Cancel is best-effort.
    }
    rppgRef.current.reset();
    ppgRef.current.reset();
    probeSamples.current = [];
    probeDeadlineAt.current = null;
    probeSettled.current = false;
    setTrend([]);
    dispatch({ type: 'CANCEL' });
  }, []);

  const measureAgain = useCallback(() => {
    rppgRef.current.reset();
    ppgRef.current.reset();
    probeSamples.current = [];
    probeDeadlineAt.current = null;
    probeSettled.current = false;
    ppgResultSeen.current = false;
    setTrend([]);
    dispatch({ type: 'RESET' });
    void loadRecent();
  }, [loadRecent]);

  // Mode switching never touches the measurement pipeline: switching away
  // from a non-IDLE phase resets to IDLE (same RESET as "Measure again"),
  // and the camera entry below reaches FINGERTIP_READY via existing reducer
  // events only — the face camera is never started for the camera path.
  const runBusy =
    machine.phase === 'CHECKING' || machine.phase === 'FACE_RUN' || machine.phase === 'FINGERTIP_RUN';
  const switchMode = useCallback(
    (next: 'face' | 'camera') => {
      if (next === preferredMode || runBusy) return;
      if (machine.phase !== 'IDLE') measureAgain();
      setPreferredMode(next);
    },
    [preferredMode, runBusy, machine.phase, measureAgain],
  );

  const beginCameraReady = useCallback(() => {
    dispatch({ type: 'BEGIN_CHECK' });
    dispatch({ type: 'FACE_UNAVAILABLE', reason: FACE_UNAVAILABLE_BODY });
    dispatch({ type: 'CHOOSE_FINGERTIP' });
  }, []);

  // Active instrument mode: live machine phases win; IDLE / terminal-entry
  // states follow the user's switcher selection. COMPLETE stays gated by the
  // modality that produced it (a downgrade mid-session keeps the result locked).
  const activeModeKey: 'face' | 'fingertip' = (() => {
    if (machine.mode === 'face') return 'face';
    if (machine.mode === 'fingertip') return 'fingertip';
    if (machine.phase === 'FINGERTIP_READY') return 'fingertip';
    if (machine.phase === 'COMPLETE') {
      if (machine.completedMode === 'face') return 'face';
      if (machine.completedMode === 'fingertip') return 'fingertip';
    }
    return preferredMode === 'face' ? 'face' : 'fingertip';
  })();
  const activeFeature = activeModeKey === 'face' ? 'facePulse' : 'cameraPulse';

  const faceActive = machine.mode === 'face' && (machine.phase === 'CHECKING' || machine.phase === 'FACE_RUN');
  const fingertipActive = machine.mode === 'fingertip' && machine.phase === 'FINGERTIP_RUN';

  // HRV from this fingertip read's beat intervals (null when too few).
  const hrvNow = useMemo(
    () => computeRmssd(ppg.result?.rrIntervalsMs ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ppg.result],
  );

  const liveReadout = useMemo(() => {
    if (machine.phase === 'FINGERTIP_RUN') {
      if (ppg.liveBpm !== null) return { value: `${Math.round(ppg.liveBpm)}`, unit: 'BPM · LIVE' };
      return { value: '––', unit: 'BPM · ACQUIRING' };
    }
    if (machine.phase === 'FACE_RUN' || machine.phase === 'CHECKING') {
      if (rppg.liveStability !== null) {
        return { value: `${Math.round(rppg.liveStability * 100)}`, unit: '% · FACE LOCK' };
      }
      return { value: '––', unit: '% · SEARCHING' };
    }
    return null;
  }, [machine.phase, ppg.liveBpm, rppg.liveStability]);

  return (
    <View style={styles.screen}>
      <HomeStageBackdrop />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} scrollEventThrottle={16}>
        {/* Camera vs face switcher — always visible so a locked mode can be
            left without entering the paywall. Locked modes carry ✦. */}
        <View style={styles.modeSwitch} accessibilityRole="tablist" accessibilityLabel="Pulse mode">
          <Pressable
            onPress={() => switchMode('camera')}
            disabled={runBusy}
            accessibilityRole="button"
            accessibilityLabel={cameraUnlocked ? 'Camera pulse mode' : 'Camera pulse mode, premium'}
            accessibilityState={{ selected: preferredMode === 'camera', disabled: runBusy }}
            style={({ pressed }) => [
              styles.modeBtn,
              preferredMode === 'camera' && styles.modeBtnActive,
              runBusy && styles.modeBtnDisabled,
              pressed && !runBusy && styles.modeBtnPressed,
            ]}
          >
            <Text style={[styles.modeBtnText, preferredMode === 'camera' && styles.modeBtnTextActive]}>
              {cameraUnlocked ? 'Camera' : 'Camera ✦'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => switchMode('face')}
            disabled={runBusy}
            accessibilityRole="button"
            accessibilityLabel={faceUnlocked ? 'Face pulse mode' : 'Face pulse mode, premium'}
            accessibilityState={{ selected: preferredMode === 'face', disabled: runBusy }}
            style={({ pressed }) => [
              styles.modeBtn,
              preferredMode === 'face' && styles.modeBtnActive,
              runBusy && styles.modeBtnDisabled,
              pressed && !runBusy && styles.modeBtnPressed,
            ]}
          >
            <Text style={[styles.modeBtnText, preferredMode === 'face' && styles.modeBtnTextActive]}>
              {faceUnlocked ? 'Face' : 'Face ✦'}
            </Text>
          </Pressable>
        </View>
        {/* Premium gate over the instrument area only: header/switcher above
            stays visible. Locked tiers see the lock card; entitled tiers
            render children untouched — cameras mount only when unlocked, so
            a locked mode can never activate its camera. */}
        <PaywallGate feature={activeFeature} title="Pulse">
        {machine.phase === 'IDLE' && (
          <GlassSurface strong radius={24} style={styles.panelPad}>
            <Text style={styles.title}>Pulse</Text>
            <Text style={styles.body}>
              Face first, fingertip backup.
            </Text>
            {(recentRppg || recentPpg) && (
              <View style={styles.recents}>
                {recentRppg && (
                  <View style={styles.recentRow}>
                    <Text style={styles.recentBpm}>{recentRppg.bpm} BPM</Text>
                    <Text style={styles.recentMeta}>Face · {relativeTime(recentRppg.measuredAt)} · {qualityLabel(recentRppg.quality)}</Text>
                  </View>
                )}
                {recentPpg && (
                  <View style={styles.recentRow}>
                    <Text style={styles.recentBpm}>{recentPpg.bpm} BPM</Text>
                    <Text style={styles.recentMeta}>Fingertip · {relativeTime(recentPpg.measuredAt)} · {qualityLabel(recentPpg.quality)}</Text>
                  </View>
                )}
              </View>
            )}
            {preferredMode === 'face' ? (
              <TactileButton title="Begin check" onPress={beginCheck} accessibilityLabel="Begin automatic measurement check" />
            ) : (
              <TactileButton title="Begin fingertip check" onPress={beginCameraReady} accessibilityLabel="Begin fingertip measurement check" />
            )}
            <View style={styles.protoCard}>
              <Text style={styles.protoTitle}>Morning read</Text>
              <Text style={styles.protoLine}>On waking · lying still · breathe normally</Text>
              <Text style={styles.protoLine}>60 seconds of stillness.</Text>
            </View>
          </GlassSurface>
        )}

        {(machine.phase === 'CHECKING' || machine.phase === 'FACE_RUN') && (
          <GlassSurface strong radius={24} style={styles.panelPad}>
            <EngravedLabel>{machine.phase === 'CHECKING' ? 'Checking face signal' : 'Face measurement'}</EngravedLabel>
            <Well style={styles.previewWell}>
              {faceActive && (
                <RppgCameraPreviewBoundary style={styles.preview}>
                  <RppgCameraPreview style={styles.preview} />
                </RppgCameraPreviewBoundary>
              )}
              <View style={styles.overlayFloat}>
                <FaceGuideOverlay
                  visual={faceVisualFor(rppg.state)}
                  progress={rppg.progressFrames > 0 ? Math.min(1, rppg.progressFrames / 160) : null}
                />
              </View>
            </Well>
            <Text style={styles.guideNote}>Positioning guide only — not face detection. The camera reads the highlighted region.</Text>
            {liveReadout && (
              <View style={styles.readout}>
                <Text style={styles.readoutValue}>{liveReadout.value}</Text>
                <Text style={styles.readoutUnit}>{liveReadout.unit}</Text>
              </View>
            )}
            <Text style={styles.hint}>{rppg.hint}</Text>
            <TactileButton title="Cancel" onPress={cancelRun} variant="danger" />
          </GlassSurface>
        )}

        {machine.phase === 'FACE_UNAVAILABLE' && (
          <GlassSurface strong radius={24} style={styles.panelPad}>
            <EngravedLabel>Face path · standby</EngravedLabel>
            <Text style={styles.titleSm}>
              {isFaceBuildFailure(machine.reason) ? FACE_BUILD_TITLE : FACE_UNAVAILABLE_TITLE}
            </Text>
            <Text style={styles.body}>
              {isFaceBuildFailure(machine.reason)
                ? `${FACE_BUILD_BODY}${machine.reason ? `\n\nDetail: ${machine.reason}` : ''}`
                : (machine.reason ?? FACE_UNAVAILABLE_BODY)}
            </Text>
            {isFaceBuildFailure(machine.reason) ? null : (
              <View style={styles.tips}>
                <Text style={styles.tip}>· Face a lamp or window — the sensor needs light.</Text>
                <Text style={styles.tip}>· Keep your face inside the guide oval.</Text>
                <Text style={styles.tip}>· Hold still for a few seconds.</Text>
              </View>
            )}
            <TactileButton title="Use fingertip" onPress={chooseFingertip} accessibilityLabel="Switch to fingertip measurement" />
            {isFaceBuildFailure(machine.reason) ? null : (
              <TactileButton title="Retry face scan" onPress={retryFace} variant="secondary" />
            )}
          </GlassSurface>
        )}

        {machine.phase === 'FINGERTIP_READY' && (
          <GlassSurface strong radius={24} style={styles.panelPad}>
            <EngravedLabel>Fingertip path · ready</EngravedLabel>
            <Text style={styles.titleSm}>Fingertip measurement</Text>
            <View style={styles.tips}>
              {FINGERTIP_INSTRUCTIONS.map((line, i) => (
                <Text key={i} style={styles.tip}>{`${i + 1}. ${line}`}</Text>
              ))}
            </View>
            <TactileButton title="Begin fingertip" onPress={beginFingertip} accessibilityLabel="Begin fingertip measurement" />
            <TactileButton title="Back" onPress={cancelRun} variant="secondary" />
          </GlassSurface>
        )}

        {machine.phase === 'FINGERTIP_RUN' && (
          <GlassSurface strong radius={24} style={styles.panelPad}>
            <EngravedLabel>Fingertip measurement</EngravedLabel>
            <Well style={styles.previewWell}>
              {fingertipActive && <PpgCameraPreview style={styles.preview} />}
              <View style={styles.overlayFloat}>
                <FingertipGuideOverlay visual={fingertipVisualFor(ppg.state)} progress={elapsed / FINGERTIP_DURATION_S} />
              </View>
            </Well>
            <Text style={styles.guideNote}>Placement guide only — cover the camera and flash fully.</Text>
            {ppg.simulated && <Text style={styles.simBadge}>SIMULATION — NOT A MEASUREMENT · NEVER SAVED</Text>}
            {liveReadout && (
              <View style={styles.readout}>
                <Text style={styles.readoutValue}>{liveReadout.value}</Text>
                <Text style={styles.readoutUnit}>{liveReadout.unit}</Text>
              </View>
            )}
            <BpmTrendView points={trend} />
            <View style={styles.dialRow}>
              <QualityDial quality={ppg.liveQuality} />
            </View>
            <Text style={styles.hint}>{ppg.hint}</Text>
            <TactileButton title="Cancel" onPress={cancelRun} variant="danger" />
          </GlassSurface>
        )}

        {machine.phase === 'COMPLETE' && (
          <GlassSurface strong radius={24} style={styles.panelPad}>
            <EngravedLabel>Measurement complete</EngravedLabel>
            {machine.completedMode === 'face' && rppg.result?.heartRateBpm != null && (
              <View style={styles.resultBlock}>
                <View style={styles.readout}>
                  <Text style={styles.readoutValue}>{rppg.result.heartRateBpm}</Text>
                  <Text style={styles.readoutUnit}>BPM · FACE SCAN</Text>
                </View>
                <View style={styles.dialRow}>
                  <QualityDial quality={rppg.result.signalQuality} />
                </View>
                <Text style={styles.meta}>
                  Quality {qualityLabel(rppg.result.signalQuality)} · {rppg.result.qualityLevel} ·{' '}
                  {rppg.result.durationSeconds}s · lock {Math.round(rppg.result.faceStability * 100)}% ·
                  model {rppg.result.modelVersion}
                </Text>
                <PulseTraceView
                  samples={rppg.waveform}
                  sampleRateHz={rppg.result.samplingRateHz > 0 ? rppg.result.samplingRateHz : 30}
                  label="MODEL PULSE OUTPUT · MEASURED"
                  traceColor={INST.cyan}
                />
                <Text style={styles.meta}>{rppg.synced ? 'Saved · synced' : 'Saved on this device · sync pending'}</Text>
              </View>
            )}
            {machine.completedMode === 'fingertip' && ppg.result?.heartRateBpm != null && (
              <View style={styles.resultBlock}>
                {ppg.simulated && <Text style={styles.simBadge}>SIMULATION — NOT A MEASUREMENT · NEVER SAVED</Text>}
                <View style={styles.readout}>
                  <Text style={styles.readoutValue}>{Math.round(ppg.result.heartRateBpm)}</Text>
                  <Text style={styles.readoutUnit}>BPM · FINGERTIP</Text>
                </View>
                <View style={styles.dialRow}>
                  <QualityDial quality={ppg.result.signalQuality} />
                </View>
                <Text style={styles.meta}>
                  Quality {qualityLabel(ppg.result.signalQuality)} · {ppg.result.durationSeconds}s ·{' '}
                  {ppg.result.algorithmVersion}
                </Text>
                {hrvNow !== null && !ppg.simulated ? (
                  <View style={styles.readout}>
                    <Text style={styles.readoutValue}>{hrvNow}</Text>
                    <Text style={styles.readoutUnit}>MS · HRV RMSSD</Text>
                  </View>
                ) : null}
                {hrvNow !== null && !ppg.simulated ? (
                  <Text style={styles.meta}>
                    {hrvBase !== null
                      ? `7-day baseline ${hrvBase.mean} ms · usual range ${hrvBase.lo}–${hrvBase.hi} · ${hrvBase.count} readings`
                      : 'Baseline builds after 4 morning readings.'}
                  </Text>
                ) : null}
                {ppg.rawSignal && ppg.rawSignal.length > 1 ? (
                  <PulseTraceView
                    samples={ppg.rawSignal}
                    sampleRateHz={
                      ppg.result.durationSeconds > 0 ? ppg.rawSignal.length / ppg.result.durationSeconds : 30
                    }
                    label="SENSOR TRACE · MEASURED"
                  />
                ) : ppg.result.rrIntervalsMs && ppg.result.rrIntervalsMs.length > 1 ? (
                  <PulseTraceView
                    samples={ppg.result.rrIntervalsMs}
                    sampleRateHz={1}
                    xAxis={{ unit: 'BEATS', total: ppg.result.rrIntervalsMs.length }}
                    label="BEAT INTERVALS (MS) · MEASURED"
                  />
                ) : ppg.simulated ? (
                  <Text style={styles.meta}>Trace preview is unavailable in simulation.</Text>
                ) : (
                  <PulseTraceView samples={null} sampleRateHz={30} label="SENSOR TRACE" />
                )}
                {!ppg.simulated && (
                  <Text style={styles.meta}>{ppg.synced ? 'Saved · synced' : 'Saved on this device · sync pending'}</Text>
                )}
              </View>
            )}
            <TactileButton title="Measure again" onPress={measureAgain} />
          </GlassSurface>
        )}

        {machine.phase === 'ERROR' && (
          <GlassSurface strong radius={24} style={styles.panelPad}>
            <EngravedLabel>Instrument fault</EngravedLabel>
            <Text style={styles.titleSm}>Measurement could not finish</Text>
            <Text style={styles.body}>{machine.reason ?? 'An unexpected error stopped the measurement. Try again.'}</Text>
            <TactileButton title="Back to start" onPress={measureAgain} />
          </GlassSurface>
        )}
        </PaywallGate>

        <Text style={styles.disclaimer}>Wellness measurements only. Not a medical device — not for diagnosis or treatment.</Text>
      </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: LG.stage.bottom,
  },
  safe: { flex: 1 },
  content: { paddingHorizontal: 26, paddingBottom: 32, paddingTop: 20, gap: 16 },
  // Frosted panel pad (GlassSurface carries the material + rim).
  panelPad: {
    padding: 20,
    gap: 12,
  },
  title: {
    fontWeight: '600',
    fontSize: 34,
    lineHeight: 41,
    letterSpacing: -0.8,
    color: '#FFFFFF',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  titleSm: {
    fontWeight: '600',
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.3,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  body: { fontSize: 15, lineHeight: 22, color: '#A7B8B2', textAlign: 'center' },
  hint: { fontSize: 14, lineHeight: 20, color: INST.amber, textAlign: 'center' },
  guideNote: { fontSize: 12, lineHeight: 17, color: INST.engraved, textAlign: 'center' },
  tips: { gap: 8, paddingHorizontal: 4 },
  tip: { fontSize: 13, lineHeight: 19, color: INST.steel },
  meta: { fontSize: 12, lineHeight: 17, color: INST.dim, textAlign: 'center', fontVariant: ['tabular-nums'] },
  disclaimer: { fontSize: 11, lineHeight: 15, color: INST.engraved, textAlign: 'center', marginTop: 4 },
  simBadge: {
    fontWeight: '600',
    fontSize: 12,
    letterSpacing: 1,
    color: INST.red,
    textAlign: 'center',
    borderWidth: 1,
    borderColor: INST.red,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  recents: { gap: 8 },
  recentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    backgroundColor: INST.well,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  recentBpm: { fontWeight: '600', fontSize: 16, color: INST.steel, fontVariant: ['tabular-nums'] },
  recentMeta: { fontSize: 12, color: INST.dim },
  protoCard: {
    borderWidth: 1,
    borderColor: INST.engraved,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 2,
    marginTop: 4,
  },
  protoTitle: { fontWeight: '600', fontSize: 14, color: INST.steel },
  protoLine: { fontSize: 12, color: INST.dim },
  previewWell: { minHeight: 300, justifyContent: 'center' },
  preview: { width: '100%', height: 300 },
  overlayFloat: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
  readout: { alignItems: 'center', paddingVertical: 4 },
  readoutValue: {
    fontWeight: '600',
    fontSize: 64,
    lineHeight: 70,
    color: INST.steel,
    fontVariant: ['tabular-nums'],
  },
  readoutUnit: { fontWeight: '600', fontSize: 12, letterSpacing: 1.5, color: INST.engraved },
  dialRow: { alignItems: 'center' },
  resultBlock: { gap: 12 },
  modeSwitch: { flexDirection: 'row', gap: 8 },
  modeBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  modeBtnActive: { backgroundColor: '#4FD1C5', borderColor: '#4FD1C5' },
  modeBtnDisabled: { opacity: 0.5 },
  modeBtnPressed: { opacity: 0.85 },
  modeBtnText: { fontWeight: '600', fontSize: 15, lineHeight: 20, color: INST.steel },
  modeBtnTextActive: { color: '#062A26' },
});
