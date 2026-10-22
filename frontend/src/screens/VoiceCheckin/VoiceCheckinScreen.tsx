/**
 * VoiceCheckinScreen — the scheduled voice check-in call.
 *
 * At the user's chosen time a call-style notification fires; answering
 * opens this screen ringing (chime + vibration, same ambience as the
 * medication call). On answer, Sanotts interviews the daily-log questions
 * one by one: device speech asks, the mic records, the backend
 * transcribes, answers parse to log fields. Unparseable answers get one
 * re-ask, then the field is skipped — never guessed. The summary saves
 * to the daily check-in, then prompts a pulse check.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAudioPlayer, setAudioModeAsync, requestRecordingPermissionsAsync, useAudioRecorder } from 'expo-audio';
import * as Speech from 'expo-speech';
import { SPACE } from '@/theme/guava';
import { Button, Input } from '@/components';
import { GlassSurface } from '@/components/home/GlassSurface';
import { HomeStageBackdrop } from '@/components/home/HomeStageBackdrop';
import { PaywallGate } from '@/components/PaywallGate';
import { LG } from '@/theme/liquidGlass';
import { api } from '@/services/api';
import { todayKeyLocal } from '@/utils/dayKey';
import { requestDataRefresh } from '@/services/dataRefresh';
import { createPakeetProvider } from '@/services/voice/stt';
import { createPakeetTransport } from '@/services/voice/transport';
import { isSttOutage, markSttOutage } from '@/services/voice/outageLog';
import { VoiceError } from '@/services/voice/errors';
import {
  CLOSING_PROMPT,
  INTERVIEW_SCRIPT,
  type AnswerField,
} from '@/services/voiceCheckin/questions';
import {
  getVoiceCheckin,
  setVoiceCheckin,
  type VoiceCheckinTime,
} from '@/services/voiceCheckin/schedule';
import {
  RINGTONE_ASSET,
  startCallVibration,
  startRing,
  stopCallVibration,
  stopRing,
  tapTick,
} from '@/services/medicationCall/ringtone';
import type { DailyCheckInRequest, RootStackParamList } from '@/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'VoiceCheckin'>;

type Mode = 'setup' | 'ringing' | 'interview' | 'apology' | 'whole' | 'summary';
type Phase = 'speaking' | 'listening' | 'working' | 'heard';
type WholePhase = 'prompt' | 'recording' | 'working' | 'done';

const LISTEN_SECONDS = 12;
/** Whole-answer fallback cap: one continuous answer, two minutes. */
const WHOLE_ANSWER_SECONDS = 120;

const SECONDARY = 'rgba(233,240,255,0.66)';
const TERTIARY = 'rgba(233,240,255,0.45)';

/** Bundled spoken prompt for the TTS-down path ("see on your screen…"). */
const FALLBACK_PROMPT_ASSET = require('../../../assets/audio/checkin-fallback-prompt.wav');

const FIELD_LABEL: Record<AnswerField, string> = {
  overall_wellbeing: 'Mood',
  energy_level: 'Energy',
  stress_level: 'Stress',
  sleep_hours: 'Sleep',
  water_glasses: 'Water',
};

/** Looping chime, owned by mount lifetime. */
function RingAudio() {
  const player = useAudioPlayer(RINGTONE_ASSET);
  useEffect(() => {
    try {
      void setAudioModeAsync({ playsInSilentMode: true });
    } catch {
      // Best-effort.
    }
    startRing(player);
    startCallVibration();
    return () => {
      stopRing(player);
      stopCallVibration();
    };
  }, [player]);
  return null;
}

function Ripple() {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(t, { toValue: 1, duration: 2200, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [t]);
  const scale = t.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.5] });
  const opacity = t.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0.5, 0.25, 0] });
  return (
    <View style={ripple.host} pointerEvents="none">
      {[0, 1].map((i) => (
        <Animated.View key={i} style={[ripple.ring, { transform: [{ scale }], opacity }]} />
      ))}
    </View>
  );
}

const ripple = StyleSheet.create({
  host: { position: 'absolute', width: 220, height: 220, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: 170, height: 170, borderRadius: 85, borderWidth: 2, borderColor: LG.card.mint },
});

function stopSpeaking(): void {
  try {
    void Speech.stop();
  } catch {
    // Best-effort.
  }
}

/** Fallible speak: true when the utterance completed, false on TTS failure. */
function speakLoud(text: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      Speech.speak(text, {
        rate: 0.95,
        onDone: () => resolve(true),
        onError: () => resolve(false),
        onStopped: () => resolve(false),
      });
    } catch {
      resolve(false);
    }
  });
}

/** Device speech preflight: any usable voice means TTS is available. */
async function isDeviceSpeechAvailable(): Promise<boolean> {
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    return Array.isArray(voices) && voices.length > 0;
  } catch {
    return false;
  }
}

export default function VoiceCheckinScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const [mode, setMode] = useState<Mode>(route.params?.mode ?? 'setup');

  // ---- setup state ----
  const [time, setTime] = useState<VoiceCheckinTime>({ hour: 20, minute: 0, enabled: false });
  const [timeLoaded, setTimeLoaded] = useState(false);
  const [savingTime, setSavingTime] = useState(false);
  const [timeMsg, setTimeMsg] = useState<string | null>(null);

  // ---- interview state ----
  const [qIndex, setQIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('speaking');
  const [transcript, setTranscript] = useState<string | null>(null);
  const [parsed, setParsed] = useState<number | null>(null);
  const [answers, setAnswers] = useState<Partial<Record<AnswerField, number>>>({});
  const [retries, setRetries] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [savingLog, setSavingLog] = useState(false);
  const [saved, setSaved] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  // ---- apology (STT down) state ----
  const [manual, setManual] = useState<Record<AnswerField, string>>({
    overall_wellbeing: '',
    energy_level: '',
    stress_level: '',
    sleep_hours: '',
    water_glasses: '',
  });
  const [manualError, setManualError] = useState<string | null>(null);

  // ---- whole-answer (TTS down) state ----
  const [wholePhase, setWholePhase] = useState<WholePhase>('prompt');
  const [wholeElapsed, setWholeElapsed] = useState(0);
  const promptPlayer = useAudioPlayer(FALLBACK_PROMPT_ASSET);

  const stateRef = useRef({ qIndex, phase, retries, answers });
  stateRef.current = { qIndex, phase, retries, answers };
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const recorder = useAudioRecorder(
    {
      extension: '.m4a',
      sampleRate: 16000,
      numberOfChannels: 1,
      bitRate: 64000,
      android: { extension: '.m4a', outputFormat: 'mpeg4', audioEncoder: 'aac', sampleRate: 16000, numberOfChannels: 1 },
      ios: { extension: '.m4a', outputFormat: '.m4a', audioQuality: 32, sampleRate: 16000, numberOfChannels: 1 },
      web: { mimeType: 'audio/mp4', bitsPerSecond: 64000 },
    } as never,
  );

  const clearTimers = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    if (advanceTimer.current) {
      clearTimeout(advanceTimer.current);
      advanceTimer.current = null;
    }
  }, []);

  // Full cleanup on unmount: no lingering speech, recording, or timers.
  useEffect(
    () => () => {
      clearTimers();
      stopSpeaking();
      try {
        if (recorder.isRecording) void recorder.stop();
      } catch {
        // Never recording — nothing to stop.
      }
    },
    [recorder, clearTimers],
  );

  // ---- setup: load current time ----
  useEffect(() => {
    if (mode !== 'setup' || timeLoaded) return;
    void getVoiceCheckin().then((t) => {
      setTime(t);
      setTimeLoaded(true);
    });
  }, [mode, timeLoaded]);

  const saveTime = useCallback(async () => {
    setSavingTime(true);
    setTimeMsg(null);
    const ok = await setVoiceCheckin(time);
    setSavingTime(false);
    setTimeMsg(
      !time.enabled
        ? 'Voice check-in off.'
        : ok
          ? `Call booked daily at ${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}.`
          : 'Time saved, but notifications are off — the call cannot fire.',
    );
  }, [time]);

  // ---- interview engine ----
  // Single stop-then-read helper: every turn MUST stop before reading uri.
  // Reading recorder.uri while still recording yields null/stale headers,
  // which breaks Q2+ (prepare-while-recording throws, upload is 0 bytes).
  const stopRecording = useCallback(async (): Promise<string | null> => {
    try {
      if (recorder.isRecording) await recorder.stop();
    } catch {
      // Auto-stop races harmlessly.
    }
    // Android needs a tick to flush the m4a header before upload.
    await new Promise<void>((r) => setTimeout(r, 150));
    return recorder.uri ?? null;
  }, [recorder]);

  const finishAnswer = useCallback(
    async (uri: string | null) => {
      clearTimers();
      const { qIndex: qi } = stateRef.current;
      const q = INTERVIEW_SCRIPT[qi];
      if (!q || !uri) {
        setError('No recording was captured.');
        setPhase('heard');
        return;
      }
      setPhase('working');
      setError(null);
      try {
        const stt = createPakeetProvider({ transport: createPakeetTransport() });
        const out = await stt.transcribe({ audioUri: uri, timeoutMs: 90_000 });
        const value = q.parse(out.text);
        setTranscript(out.text);
        if (value == null) {
          const { retries: r } = stateRef.current;
          if (r < 1) {
            setRetries(r + 1);
            setParsed(null);
            setPhase('speaking');
            const reasked = await speakLoud(`Sorry, I did not catch that. ${q.prompt}`);
            if (!reasked) {
              // TTS died mid-interview: counted as heard-nothing, move on.
              setParsed(null);
              setPhase('heard');
              return;
            }
            setPhase('listening');
            await startListening();
          } else {
            setParsed(null);
            setPhase('heard');
          }
          return;
        }
        setParsed(value);
        setAnswers((prev) => ({ ...prev, [q.field]: value }));
        setPhase('heard');
        advanceTimer.current = setTimeout(() => advance(), 1400);
      } catch (e) {
        // Server transcription itself is down: apologize, mark the outage
        // for observability, and offer manual entry. Transient turn
        // failures keep the existing retry path below.
        if (e instanceof VoiceError && isSttOutage(e.code)) {
          clearTimers();
          stopSpeaking();
          void markSttOutage(e.code);
          const heard = stateRef.current.answers;
          setManual({
            overall_wellbeing: heard.overall_wellbeing != null ? String(heard.overall_wellbeing) : '',
            energy_level: heard.energy_level != null ? String(heard.energy_level) : '',
            stress_level: heard.stress_level != null ? String(heard.stress_level) : '',
            sleep_hours: heard.sleep_hours != null ? String(heard.sleep_hours) : '',
            water_glasses: heard.water_glasses != null ? String(heard.water_glasses) : '',
          });
          setManualError(null);
          setError(null);
          setMode('apology');
          return;
        }
        setError(e instanceof VoiceError ? e.message : 'Transcription failed. Try again.');
        setPhase('heard');
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clearTimers],
  );

  const startListening = useCallback(async () => {
    clearTimers();
    setTranscript(null);
    setParsed(null);
    setError(null);
    setElapsed(0);
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setError('Microphone denied. Enable it in Settings to answer by voice.');
        setPhase('heard');
        return;
      }
      // Q2+ guard: a previous turn may still hold the recorder (auto-stop
      // race). Stop before prepare, otherwise prepare-while-recording throws
      // and the mic never starts.
      try {
        if (recorder.isRecording) await recorder.stop();
      } catch {
        // Stale handle — prepare below will re-arm.
      }
      await recorder.prepareToRecordAsync();
      recorder.record();
      setPhase('listening');
      const t0 = Date.now();
      timer.current = setInterval(() => {
        const s = (Date.now() - t0) / 1000;
        setElapsed(s);
        if (s >= LISTEN_SECONDS) {
          if (timer.current) {
            clearInterval(timer.current);
            timer.current = null;
          }
          // MUST stop before reading uri — never finishAnswer(recorder.uri).
          void (async () => {
            try {
              if (recorder.isRecording) await recorder.stop();
            } catch {
              // ignore — uri read below still valid
            }
            await new Promise<void>((r) => setTimeout(r, 150));
            await finishAnswer(recorder.uri);
          })();
        }
      }, 250);
    } catch {
      setError('Microphone could not start.');
      setPhase('heard');
    }
  }, [recorder, finishAnswer, clearTimers]);

  /** Mid-interview TTS failure: keep heard answers, flip to whole-answer. */
  const flipToWhole = useCallback(() => {
    clearTimers();
    stopSpeaking();
    setWholePhase('prompt');
    setWholeElapsed(0);
    setError(null);
    setTranscript(null);
    setParsed(null);
    setMode('whole');
  }, [clearTimers]);

  const askCurrent = useCallback(async () => {
    const { qIndex: qi } = stateRef.current;
    const q = INTERVIEW_SCRIPT[qi];
    if (!q) return;
    setPhase('speaking');
    const heard = await speakLoud(q.prompt);
    if (stateRef.current.qIndex !== qi) return;
    if (!heard) {
      flipToWhole();
      return;
    }
    await startListening();
  }, [startListening, flipToWhole]);

  const advance = useCallback(() => {
    const { qIndex: qi } = stateRef.current;
    setTranscript(null);
    setParsed(null);
    setRetries(0);
    setError(null);
    if (qi + 1 >= INTERVIEW_SCRIPT.length) {
      void (async () => {
        await speakLoud(CLOSING_PROMPT);
        setMode('summary');
      })();
      return;
    }
    setQIndex(qi + 1);
  }, []);

  // Ask on entering interview + on each question advance.
  useEffect(() => {
    if (mode !== 'interview') return;
    void askCurrent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, qIndex]);

  const stopNow = useCallback(async () => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    // MUST stop before reading uri — same Q2+ bug as the auto-timeout.
    const uri = await stopRecording();
    await finishAnswer(uri);
  }, [finishAnswer, stopRecording]);

  // ---- whole-answer (TTS down): one recording, structured server-side ----
  const finishWholeAnswer = useCallback(
    async (uri: string | null) => {
      if (!uri) {
        setError('No recording was captured.');
        setWholePhase('recording');
        return;
      }
      setWholePhase('working');
      setError(null);
      try {
        const formData = new FormData();
        formData.append('file', {
          uri,
          name: 'whole-answer.m4a',
          type: 'audio/mp4',
        } as unknown as Blob);
        const resp = await api.getClient().post<{ transcript?: unknown; fields?: unknown }>(
          '/api/v1/voice/structure-checkin',
          formData,
          { timeout: 150_000 },
        );
        const body = (resp.data ?? {}) as { transcript?: unknown; fields?: unknown };
        const rawFields =
          body.fields && typeof body.fields === 'object' ? (body.fields as Record<string, unknown>) : {};
        // Server values pass through the interview parsers: out-of-range
        // or nonsense becomes a skip, never a stored guess.
        const next: Partial<Record<AnswerField, number>> = {};
        for (const q of INTERVIEW_SCRIPT) {
          const raw = rawFields[q.field];
          if (raw == null) continue;
          const value = q.parse(String(raw));
          if (value != null) next[q.field] = value;
        }
        setTranscript(
          typeof body.transcript === 'string' && body.transcript.trim().length > 0
            ? body.transcript.trim()
            : null,
        );
        const heardCount = Object.keys(next).length;
        if (heardCount === 0) {
          // Nothing usable came back: same honest path as STT-down.
          clearTimers();
          stopSpeaking();
          void markSttOutage('MODEL_UNAVAILABLE');
          setManual({
            overall_wellbeing: '',
            energy_level: '',
            stress_level: '',
            sleep_hours: '',
            water_glasses: '',
          });
          setManualError(null);
          setError(null);
          setMode('apology');
          return;
        }
        setAnswers(next);
        setWholePhase('done');
        setMode('summary');
      } catch (e: unknown) {
        const status = (e as { response?: { status?: number } })?.response?.status;
        if (status === 503) {
          // Structuring needs transcription: same outage, same path.
          clearTimers();
          stopSpeaking();
          void markSttOutage('MODEL_UNAVAILABLE');
          setManual({
            overall_wellbeing: '',
            energy_level: '',
            stress_level: '',
            sleep_hours: '',
            water_glasses: '',
          });
          setManualError(null);
          setError(null);
          setMode('apology');
          return;
        }
        setError('Could not understand that recording. Try recording again.');
        setWholePhase('recording');
      }
    },
    [clearTimers],
  );

  const startWholeRecording = useCallback(async () => {
    clearTimers();
    setTranscript(null);
    setError(null);
    setWholeElapsed(0);
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setError('Microphone denied. Enable it in Settings to answer by voice.');
        setWholePhase('recording');
        return;
      }
      try {
        if (recorder.isRecording) await recorder.stop();
      } catch {
        // Stale handle — prepare below will re-arm.
      }
      await recorder.prepareToRecordAsync();
      recorder.record();
      setWholePhase('recording');
      const t0 = Date.now();
      timer.current = setInterval(() => {
        const s = (Date.now() - t0) / 1000;
        setWholeElapsed(s);
        if (s >= WHOLE_ANSWER_SECONDS) {
          if (timer.current) {
            clearInterval(timer.current);
            timer.current = null;
          }
          void (async () => {
            try {
              if (recorder.isRecording) await recorder.stop();
            } catch {
              // ignore — uri read below still valid
            }
            await new Promise<void>((r) => setTimeout(r, 150));
            await finishWholeAnswer(recorder.uri);
          })();
        }
      }, 250);
    } catch {
      setError('Microphone could not start.');
      setWholePhase('recording');
    }
  }, [recorder, finishWholeAnswer, clearTimers]);

  const stopWholeRecording = useCallback(async () => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    try {
      if (recorder.isRecording) await recorder.stop();
    } catch {
      // ignore — uri read below still valid
    }
    await new Promise<void>((r) => setTimeout(r, 150));
    await finishWholeAnswer(recorder.uri);
  }, [recorder, finishWholeAnswer]);

  // Whole-answer entry: play the recorded prompt, then auto-start the
  // single recording. Questions stay on screen the whole time.
  useEffect(() => {
    if (mode !== 'whole') return;
    setWholePhase('prompt');
    let cancelled = false;
    let poll: ReturnType<typeof setInterval> | null = null;
    try {
      promptPlayer.play();
    } catch {
      // Prompt asset failure still leaves the on-screen questions usable.
    }
    const t0 = Date.now();
    poll = setInterval(() => {
      if (cancelled) return;
      const finished = promptPlayer.duration > 0 && !promptPlayer.playing;
      if (finished || Date.now() - t0 > 25000) {
        if (poll) clearInterval(poll);
        poll = null;
        if (!cancelled) void startWholeRecording();
      }
    }, 400);
    return () => {
      cancelled = true;
      if (poll) clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const answerCall = useCallback(() => {
    tapTick();
    setQIndex(0);
    setAnswers({});
    setRetries(0);
    setTranscript(null);
    setParsed(null);
    setError(null);
    setSaved(false);
    // TTS preflight: no device voices → whole-answer mode with the
    // recorded prompt instead of a silent interview.
    void isDeviceSpeechAvailable().then((ok) => {
      if (ok) {
        setMode('interview');
      } else {
        setWholePhase('prompt');
        setWholeElapsed(0);
        setError(null);
        setMode('whole');
      }
    });
  }, []);

  const declineCall = useCallback(() => {
    clearTimers();
    stopSpeaking();
    navigation.goBack();
  }, [navigation, clearTimers]);

  // ---- save to daily log ----
  const saveLog = useCallback(async (override?: Partial<Record<AnswerField, number>>) => {
    if (savingLog) return;
    setSavingLog(true);
    try {
      const got = override ?? answers;
      const payload: DailyCheckInRequest = {
        log_date: todayKeyLocal(),
        symptoms: [],
        vitals: [],
        pain: [],
        activities: [],
        medications: [],
      };
      if (got.overall_wellbeing != null) payload.overall_wellbeing = got.overall_wellbeing;
      if (got.energy_level != null) payload.energy_level = got.energy_level;
      if (got.stress_level != null) payload.stress_level = got.stress_level;
      if (got.sleep_hours != null) {
        payload.sleep = { duration_minutes: Math.round(got.sleep_hours * 60) };
      }
      if (got.water_glasses != null) {
        payload.nutrition = { water_ml: got.water_glasses * 250 };
      }
      await api.post('/api/v1/logs/daily-checkin', payload);
      requestDataRefresh();
      setSaved(true);
    } catch {
      setError('Could not save. Check connection and try again.');
    } finally {
      setSavingLog(false);
    }
  }, [answers, savingLog]);

  // ---- apology: typed answers through the same parsers, blanks skipped ----
  const saveManual = useCallback(async () => {
    const next: Partial<Record<AnswerField, number>> = {};
    for (const q of INTERVIEW_SCRIPT) {
      const raw = (manual[q.field] ?? '').trim();
      if (!raw) continue;
      const value = q.parse(raw);
      if (value == null) {
        setManualError(`${FIELD_LABEL[q.field]}: ${q.hint.toLowerCase()}`);
        return;
      }
      next[q.field] = value;
    }
    setManualError(null);
    setAnswers(next);
    await saveLog(next);
  }, [manual, saveLog]);

  const goPulse = useCallback(() => {
    (navigation.navigate as (r: string, p?: object) => void)('Main', { screen: 'PpgMeasure' });
  }, [navigation]);

  const adjust = (key: 'hour' | 'minute', delta: number, min: number, max: number, step = 1) => {
    setTime((t) => {
      const v = key === 'hour' ? t.hour : t.minute;
      let next = v + delta * step;
      if (next > max) next = min;
      if (next < min) next = max;
      return { ...t, [key]: next };
    });
  };

  // ================= setup =================
  // Alarm/reminder scheduling (time + daily call) is All-in (voiceAlarms).
  // Voice recording/interview itself is free logging and stays ungated —
  // only this scheduling section is wrapped; ringing/interview/whole/
  // apology/summary below render for every tier.
  if (mode === 'setup') {
    return (
      <View style={styles.root}>
        <HomeStageBackdrop />
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <Text style={styles.title}>Voice check-in</Text>
            <Text style={styles.sub}>A call every day. Answer five questions by voice.</Text>
            <PaywallGate feature="voiceAlarms" title="Call reminders" body="A daily call on your schedule.">
              <View style={styles.gatedSchedule}>
                <View style={styles.timeRow}>
                  <View style={styles.stepper}>
                    <Pressable onPress={() => adjust('hour', -1, 0, 23)} hitSlop={12} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel="Hour down">
                      <Text style={styles.stepText}>−</Text>
                    </Pressable>
                    <Text style={styles.timeValue}>{String(time.hour).padStart(2, '0')}</Text>
                    <Pressable onPress={() => adjust('hour', 1, 0, 23)} hitSlop={12} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel="Hour up">
                      <Text style={styles.stepText}>+</Text>
                    </Pressable>
                  </View>
                  <Text style={styles.timeColon}>:</Text>
                  <View style={styles.stepper}>
                    <Pressable onPress={() => adjust('minute', -1, 0, 55, 5)} hitSlop={12} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel="Minute down">
                      <Text style={styles.stepText}>−</Text>
                    </Pressable>
                    <Text style={styles.timeValue}>{String(time.minute).padStart(2, '0')}</Text>
                    <Pressable onPress={() => adjust('minute', 1, 0, 55, 5)} hitSlop={12} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel="Minute up">
                      <Text style={styles.stepText}>+</Text>
                    </Pressable>
                  </View>
                  <Pressable
                    onPress={() => setTime((t) => ({ ...t, enabled: !t.enabled }))}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: time.enabled }}
                    accessibilityLabel="Daily voice check-in on or off"
                    style={[styles.toggle, time.enabled && styles.toggleOn]}
                  >
                    <Text style={[styles.toggleText, time.enabled && styles.toggleTextOn]}>
                      {time.enabled ? 'On' : 'Off'}
                    </Text>
                  </Pressable>
                </View>
                {timeMsg ? <Text style={styles.timeMsg}>{timeMsg}</Text> : null}
                <Button
                  title={savingTime ? 'Saving…' : 'Save'}
                  variant="secondary"
                  onPress={() => void saveTime()}
                  disabled={savingTime}
                  fullWidth
                  size="large"
                  style={styles.goBtn}
                  textStyle={styles.goBtnText}
                />
                <Button
                  title="Test call now"
                  variant="ghost"
                  onPress={() => setMode('ringing')}
                  fullWidth
                  textStyle={styles.ghostText}
                />
              </View>
            </PaywallGate>
            <Button
              title="Speak freely instead"
              variant="ghost"
              onPress={() => navigation.navigate('VoiceJournal')}
              fullWidth
              textStyle={styles.ghostText}
            />
            <Text style={styles.disclaimer}>Answers save to your daily log. Tracking only.</Text>
            <Text style={styles.disclaimer}>Rings exactly on time only if the system allows “Alarms & reminders” for this app — otherwise Android may delay the call by minutes.</Text>
          </ScrollView>
        </SafeAreaView>
      </View>
    );
  }

  // ================= ringing =================
  if (mode === 'ringing') {
    return (
      <View style={styles.root}>
        <HomeStageBackdrop />
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <RingAudio />
          <View style={styles.callWrap}>
            <View style={styles.emblemWrap}>
              <Ripple />
              <View style={styles.emblem}>
                <Text style={styles.emblemGlyph}>◉</Text>
              </View>
            </View>
            <Text style={styles.callTitle}>Health check-in</Text>
            <Text style={styles.callSub}>Voice call · five questions</Text>
            <View style={styles.callBtns}>
              <Pressable onPress={declineCall} accessibilityRole="button" accessibilityLabel="Decline call" style={[styles.callBtn, styles.declineBtn]}>
                <Text style={styles.callBtnText}>Decline</Text>
              </Pressable>
              <Pressable onPress={answerCall} accessibilityRole="button" accessibilityLabel="Answer call" style={[styles.callBtn, styles.answerBtn]}>
                <Text style={[styles.callBtnText, styles.answerText]}>Answer</Text>
              </Pressable>
            </View>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // ================= interview =================
  if (mode === 'interview') {
    const q = INTERVIEW_SCRIPT[qIndex];
    return (
      <View style={styles.root}>
        <HomeStageBackdrop />
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <Text style={styles.progress}>{`Question ${Math.min(qIndex + 1, INTERVIEW_SCRIPT.length)} of ${INTERVIEW_SCRIPT.length}`}</Text>
            {q ? <Text style={styles.question}>{q.prompt}</Text> : null}
            {q ? <Text style={styles.hint}>{q.hint}</Text> : null}
            <GlassSurface strong style={styles.card}>
              <View style={styles.statusInner}>
                {phase === 'speaking' ? <Text style={styles.status}>Asking…</Text> : null}
                {phase === 'listening' ? (
                  <>
                    <View style={styles.liveDot} />
                    <Text style={styles.status}>Listening… {Math.floor(elapsed)}s</Text>
                  </>
                ) : null}
                {phase === 'working' ? <Text style={styles.status}>Understanding…</Text> : null}
                {phase === 'heard' && transcript ? <Text style={styles.transcript}>“{transcript}”</Text> : null}
                {phase === 'heard' && parsed != null && q ? (
                  <Text style={styles.heardValue}>{`${FIELD_LABEL[q.field]}: ${q.format(parsed)}`}</Text>
                ) : null}
                {phase === 'heard' && parsed == null ? (
                  <Text style={styles.status}>Skipped — moving on.</Text>
                ) : null}
                {error ? <Text style={styles.error}>{error}</Text> : null}
              </View>
            </GlassSurface>
            <View style={styles.rowBtns}>
              {phase === 'listening' ? (
                <Button title="Done answering" variant="secondary" onPress={() => void stopNow()} fullWidth size="large" style={styles.goBtn} textStyle={styles.goBtnText} />
              ) : null}
              {phase === 'heard' ? (
                <Button title={qIndex + 1 >= INTERVIEW_SCRIPT.length ? 'Finish' : 'Next'} variant="secondary" onPress={() => advance()} fullWidth size="large" style={styles.goBtn} textStyle={styles.goBtnText} />
              ) : null}
            </View>
            <Button title="End call" variant="ghost" onPress={declineCall} fullWidth textStyle={styles.ghostText} />
          </ScrollView>
        </SafeAreaView>
      </View>
    );
  }

  // ================= whole-answer (TTS down) =================
  if (mode === 'whole') {
    const mm = Math.floor(Math.min(wholeElapsed, WHOLE_ANSWER_SECONDS) / 60);
    const ss = Math.floor(Math.min(wholeElapsed, WHOLE_ANSWER_SECONDS) % 60);
    const clock = `${mm}:${String(ss).padStart(2, '0')} / 2:00`;
    return (
      <View style={styles.root}>
        <HomeStageBackdrop />
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <Text style={styles.title}>One recording</Text>
            <Text style={styles.sub}>
              Answer everything below in one go — say as much as you like. Stops at 2:00.
            </Text>
            <GlassSurface strong style={styles.card}>
              <View style={styles.summaryList}>
                {INTERVIEW_SCRIPT.map((q) => (
                  <View key={q.field} style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>{FIELD_LABEL[q.field]}</Text>
                    <Text style={styles.wholeHint}>{q.hint}</Text>
                  </View>
                ))}
              </View>
            </GlassSurface>
            <GlassSurface strong style={styles.card}>
              <View style={styles.statusInner}>
                {wholePhase === 'prompt' ? <Text style={styles.status}>Playing the prompt…</Text> : null}
                {wholePhase === 'recording' ? (
                  <>
                    <View style={styles.liveDot} />
                    <Text style={styles.status}>Recording… {clock}</Text>
                  </>
                ) : null}
                {wholePhase === 'working' ? <Text style={styles.status}>Understanding your answers…</Text> : null}
                {error ? <Text style={styles.error}>{error}</Text> : null}
              </View>
            </GlassSurface>
            {wholePhase === 'recording' ? (
              <Button title="Stop recording" variant="secondary" onPress={() => void stopWholeRecording()} fullWidth size="large" style={styles.goBtn} textStyle={styles.goBtnText} />
            ) : null}
            <Button title="End call" variant="ghost" onPress={declineCall} fullWidth textStyle={styles.ghostText} />
          </ScrollView>
        </SafeAreaView>
      </View>
    );
  }

  // ================= apology (STT down) =================
  if (mode === 'apology') {
    return (
      <View style={styles.root}>
        <HomeStageBackdrop />
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <Text style={styles.title}>Voice typing is down</Text>
            <Text style={styles.sub}>
              Sorry — voice transcription isn&apos;t working right now. We&apos;re working on it. You can enter your answers below instead.
            </Text>
            {!saved ? (
              <>
                {INTERVIEW_SCRIPT.map((q) => (
                  <Input
                    key={q.field}
                    label={`${FIELD_LABEL[q.field]} (${q.hint.toLowerCase()})`}
                    value={manual[q.field]}
                    onChangeText={(v) => setManual((prev) => ({ ...prev, [q.field]: v }))}
                    placeholder="Leave blank to skip"
                    keyboardType="decimal-pad"
                  />
                ))}
                {manualError ? <Text style={styles.error}>{manualError}</Text> : null}
                {error ? <Text style={styles.error}>{error}</Text> : null}
                <Button
                  title={savingLog ? 'Saving…' : 'Save answers'}
                  variant="secondary"
                  onPress={() => void saveManual()}
                  disabled={savingLog}
                  loading={savingLog}
                  fullWidth
                  size="large"
                  style={styles.goBtn}
                  textStyle={styles.goBtnText}
                />
              </>
            ) : (
              <GlassSurface strong style={styles.card}>
                <View style={styles.pulseInner}>
                  <Text style={styles.pulseTitle}>Saved.</Text>
                  <Text style={styles.pulseSub}>Check your pulse now while you are still.</Text>
                  <Button title="Open pulse check" variant="secondary" onPress={goPulse} fullWidth size="large" style={styles.goBtn} textStyle={styles.goBtnText} />
                </View>
              </GlassSurface>
            )}
            <Button title="End call" variant="ghost" onPress={declineCall} fullWidth textStyle={styles.ghostText} />
          </ScrollView>
        </SafeAreaView>
      </View>
    );
  }

  // ================= summary =================
  const answered = INTERVIEW_SCRIPT.filter((q) => answers[q.field] != null);
  return (
    <View style={styles.root}>
      <HomeStageBackdrop />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>Heard</Text>
          <Text style={styles.sub}>Check it, then save to your daily log.</Text>
          <GlassSurface strong style={styles.card}>
            <View style={styles.summaryList}>
              {INTERVIEW_SCRIPT.map((q) => {
                const v = answers[q.field];
                return (
                  <View key={q.field} style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>{FIELD_LABEL[q.field]}</Text>
                    <Text style={styles.summaryValue}>{v != null ? q.format(v) : 'Skipped'}</Text>
                  </View>
                );
              })}
            </View>
          </GlassSurface>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {!saved ? (
            <Button
              title={savingLog ? 'Saving…' : `Save ${answered.length} answers`}
              variant="secondary"
              onPress={() => void saveLog()}
              disabled={savingLog || answered.length === 0}
              fullWidth
              size="large"
              style={styles.goBtn}
              textStyle={styles.goBtnText}
            />
          ) : (
            <GlassSurface strong style={styles.card}>
              <View style={styles.pulseInner}>
                <Text style={styles.pulseTitle}>One more thing.</Text>
                <Text style={styles.pulseSub}>Check your pulse now while you are still.</Text>
                <Button title="Open pulse check" variant="secondary" onPress={goPulse} fullWidth size="large" style={styles.goBtn} textStyle={styles.goBtnText} />
              </View>
            </GlassSurface>
          )}
          <Button title="Done" variant="ghost" onPress={() => navigation.goBack()} fullWidth textStyle={styles.ghostText} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05070F' },
  safe: { flex: 1 },
  content: { paddingHorizontal: SPACE.screenH, paddingVertical: 12, paddingBottom: 32, gap: 12 },
  gatedSchedule: { gap: 12 },
  title: { fontWeight: '600', fontSize: 34, lineHeight: 41, letterSpacing: -0.8, color: '#FFFFFF', textAlign: 'center' },
  sub: { fontWeight: '400', fontSize: 15, lineHeight: 21, color: SECONDARY, textAlign: 'center' },
  progress: { fontWeight: '600', fontSize: 13, lineHeight: 18, letterSpacing: 1, color: LG.card.mint, textAlign: 'center' },
  question: { fontWeight: '600', fontSize: 22, lineHeight: 28, letterSpacing: -0.2, color: '#FFFFFF', textAlign: 'center' },
  hint: { fontWeight: '400', fontSize: 15, lineHeight: 21, color: SECONDARY, textAlign: 'center' },
  card: { padding: 16 },
  statusInner: { gap: 8, alignItems: 'center' },
  summaryList: { gap: 4 },
  status: { fontWeight: '400', fontSize: 15, lineHeight: 21, color: SECONDARY, textAlign: 'center' },
  liveDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: LG.card.danger },
  transcript: { fontWeight: '400', fontSize: 15, lineHeight: 22, color: '#FFFFFF', textAlign: 'center' },
  heardValue: { fontWeight: '600', fontSize: 18, lineHeight: 24, color: LG.card.mint, textAlign: 'center', fontVariant: ['tabular-nums'] },
  error: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: LG.card.danger, textAlign: 'center' },
  rowBtns: { gap: 8 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
  wholeHint: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: SECONDARY, textAlign: 'right', flexShrink: 1, marginLeft: 12 },
  summaryLabel: { fontWeight: '400', fontSize: 15, lineHeight: 21, color: SECONDARY },
  summaryValue: { fontWeight: '600', fontSize: 15, lineHeight: 21, color: '#FFFFFF', fontVariant: ['tabular-nums'] },
  pulseInner: { gap: 8, alignItems: 'stretch' },
  pulseTitle: { fontWeight: '600', fontSize: 18, lineHeight: 24, color: '#FFFFFF', textAlign: 'center' },
  pulseSub: { fontWeight: '400', fontSize: 15, lineHeight: 21, color: SECONDARY, textAlign: 'center' },
  timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  stepper: { alignItems: 'center', gap: 4 },
  stepBtn: { minWidth: 56, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontWeight: '600', fontSize: 26, lineHeight: 32, color: '#FFFFFF' },
  timeValue: { fontWeight: '600', fontSize: 44, lineHeight: 50, color: '#FFFFFF', fontVariant: ['tabular-nums'] },
  timeColon: { fontWeight: '600', fontSize: 40, lineHeight: 48, color: SECONDARY },
  toggle: {
    borderRadius: 9999,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.22)',
    paddingHorizontal: 18,
    minHeight: 44,
    justifyContent: 'center',
  },
  toggleOn: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  toggleText: { fontWeight: '600', fontSize: 13, lineHeight: 18, color: SECONDARY },
  toggleTextOn: { color: '#0B0F1A' },
  timeMsg: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: SECONDARY, textAlign: 'center' },
  goBtn: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  goBtnText: { color: '#0B0F1A' },
  ghostText: { color: '#FFFFFF' },
  disclaimer: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: TERTIARY, textAlign: 'center' },
  callWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: SPACE.screenH },
  emblemWrap: { width: 220, height: 220, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  emblem: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 2,
    borderColor: LG.card.mint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emblemGlyph: { fontSize: 44, lineHeight: 52, color: LG.card.mint },
  callTitle: { fontWeight: '600', fontSize: 26, lineHeight: 32, color: '#FFFFFF', textAlign: 'center' },
  callSub: { fontWeight: '400', fontSize: 15, lineHeight: 21, color: SECONDARY, textAlign: 'center' },
  callBtns: { flexDirection: 'row', gap: 16, marginTop: 16 },
  callBtn: { flex: 1, minHeight: 56, borderRadius: 9999, alignItems: 'center', justifyContent: 'center' },
  declineBtn: { backgroundColor: 'rgba(255,142,142,0.12)', borderWidth: 1.5, borderColor: 'rgba(255,142,142,0.45)' },
  answerBtn: { backgroundColor: '#FFFFFF' },
  callBtnText: { fontWeight: '600', fontSize: 16, lineHeight: 22, color: LG.card.danger },
  answerText: { color: '#0B0F1A' },
});
