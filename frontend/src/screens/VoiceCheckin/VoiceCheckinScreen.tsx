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
import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
import { Button } from '@/components';
import { api } from '@/services/api';
import { todayKeyLocal } from '@/utils/dayKey';
import { requestDataRefresh } from '@/services/dataRefresh';
import { createPakeetProvider } from '@/services/voice/stt';
import { createPakeetTransport } from '@/services/voice/transport';
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

type Mode = 'setup' | 'ringing' | 'interview' | 'summary';
type Phase = 'speaking' | 'listening' | 'working' | 'heard';

const LISTEN_SECONDS = 12;

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
  ring: { position: 'absolute', width: 170, height: 170, borderRadius: 85, borderWidth: 2, borderColor: '#4FD1C5' },
});

function speak(text: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      Speech.speak(text, {
        rate: 0.95,
        onDone: () => resolve(),
        onError: () => resolve(),
        onStopped: () => resolve(),
      });
    } catch {
      resolve();
    }
  });
}

function stopSpeaking(): void {
  try {
    void Speech.stop();
  } catch {
    // Best-effort.
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
            await speak(`Sorry, I did not catch that. ${q.prompt}`);
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

  const askCurrent = useCallback(async () => {
    const { qIndex: qi } = stateRef.current;
    const q = INTERVIEW_SCRIPT[qi];
    if (!q) return;
    setPhase('speaking');
    await speak(q.prompt);
    if (stateRef.current.qIndex !== qi) return;
    await startListening();
  }, [startListening]);

  const advance = useCallback(() => {
    const { qIndex: qi } = stateRef.current;
    setTranscript(null);
    setParsed(null);
    setRetries(0);
    setError(null);
    if (qi + 1 >= INTERVIEW_SCRIPT.length) {
      void (async () => {
        await speak(CLOSING_PROMPT);
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

  const answerCall = useCallback(() => {
    tapTick();
    setQIndex(0);
    setAnswers({});
    setRetries(0);
    setTranscript(null);
    setParsed(null);
    setError(null);
    setSaved(false);
    setMode('interview');
  }, []);

  const declineCall = useCallback(() => {
    clearTimers();
    stopSpeaking();
    navigation.goBack();
  }, [navigation, clearTimers]);

  // ---- save to daily log ----
  const saveLog = useCallback(async () => {
    if (savingLog) return;
    setSavingLog(true);
    try {
      const payload: DailyCheckInRequest = {
        log_date: todayKeyLocal(),
        symptoms: [],
        vitals: [],
        pain: [],
        activities: [],
        medications: [],
      };
      if (answers.overall_wellbeing != null) payload.overall_wellbeing = answers.overall_wellbeing;
      if (answers.energy_level != null) payload.energy_level = answers.energy_level;
      if (answers.stress_level != null) payload.stress_level = answers.stress_level;
      if (answers.sleep_hours != null) {
        payload.sleep = { duration_minutes: Math.round(answers.sleep_hours * 60) };
      }
      if (answers.water_glasses != null) {
        payload.nutrition = { water_ml: answers.water_glasses * 250 };
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
  if (mode === 'setup') {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>Voice check-in.</Text>
          <Text style={styles.sub}>A call every day. Answer five questions by voice.</Text>
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
    );
  }

  // ================= ringing =================
  if (mode === 'ringing') {
    return (
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
    );
  }

  // ================= interview =================
  if (mode === 'interview') {
    const q = INTERVIEW_SCRIPT[qIndex];
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.progress}>{`Question ${Math.min(qIndex + 1, INTERVIEW_SCRIPT.length)} of ${INTERVIEW_SCRIPT.length}`}</Text>
          {q ? <Text style={styles.question}>{q.prompt}</Text> : null}
          {q ? <Text style={styles.hint}>{q.hint}</Text> : null}
          <View style={styles.statusBox}>
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
          <View style={styles.rowBtns}>
            {phase === 'listening' ? (
              <Button title="Done answering" onPress={() => void stopNow()} fullWidth size="large" style={styles.goBtn} textStyle={styles.goBtnText} />
            ) : null}
            {phase === 'heard' ? (
              <Button title={qIndex + 1 >= INTERVIEW_SCRIPT.length ? 'Finish' : 'Next'} onPress={() => advance()} fullWidth size="large" style={styles.goBtn} textStyle={styles.goBtnText} />
            ) : null}
          </View>
          <Button title="End call" variant="ghost" onPress={declineCall} fullWidth textStyle={styles.ghostText} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ================= summary =================
  const answered = INTERVIEW_SCRIPT.filter((q) => answers[q.field] != null);
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Heard.</Text>
        <Text style={styles.sub}>Check it, then save to your daily log.</Text>
        <View style={styles.summaryCard}>
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
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!saved ? (
          <Button
            title={savingLog ? 'Saving…' : `Save ${answered.length} answers`}
            onPress={() => void saveLog()}
            disabled={savingLog || answered.length === 0}
            fullWidth
            size="large"
            style={styles.goBtn}
            textStyle={styles.goBtnText}
          />
        ) : (
          <View style={styles.pulseCard}>
            <Text style={styles.pulseTitle}>One more thing.</Text>
            <Text style={styles.pulseSub}>Check your pulse now while you are still.</Text>
            <Button title="Open pulse check" onPress={goPulse} fullWidth size="large" style={styles.goBtn} textStyle={styles.goBtnText} />
          </View>
        )}
        <Button title="Done" variant="ghost" onPress={() => navigation.goBack()} fullWidth textStyle={styles.ghostText} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#080A11' },
  content: { paddingHorizontal: SPACE.screenH, paddingVertical: SPACE.sectionGap, paddingBottom: 32, gap: 12 },
  title: { fontFamily: FONT.semi, fontSize: 24, lineHeight: 30, letterSpacing: -0.3, color: '#FFFFFF', textAlign: 'center' },
  sub: { ...TYPE.body, color: GV.fog, textAlign: 'center' },
  progress: { ...TYPE.chip, color: GV.teal, textAlign: 'center', letterSpacing: 1 },
  question: { fontFamily: FONT.semi, fontSize: 22, lineHeight: 28, letterSpacing: -0.2, color: '#FFFFFF', textAlign: 'center' },
  hint: { ...TYPE.body, color: GV.fog, textAlign: 'center' },
  statusBox: {
    backgroundColor: '#10141F',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    borderRadius: 20,
    padding: 20,
    gap: 8,
    alignItems: 'center',
  },
  status: { ...TYPE.body, color: GV.fog, textAlign: 'center' },
  liveDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#FF5D5D' },
  transcript: { ...TYPE.body, color: '#FFFFFF', textAlign: 'center' },
  heardValue: { fontFamily: FONT.semi, fontSize: 18, color: '#4FD1C5', textAlign: 'center', fontVariant: ['tabular-nums'] },
  error: { ...TYPE.caption, color: GV.danger, textAlign: 'center' },
  rowBtns: { gap: 8 },
  summaryCard: {
    backgroundColor: '#10141F',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    borderRadius: 20,
    padding: 16,
    gap: 4,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
  summaryLabel: { ...TYPE.body, color: GV.fog },
  summaryValue: { ...TYPE.button, fontSize: 15, color: '#FFFFFF', fontVariant: ['tabular-nums'] },
  pulseCard: { gap: 8, alignItems: 'stretch' },
  pulseTitle: { fontFamily: FONT.semi, fontSize: 18, color: '#FFFFFF', textAlign: 'center' },
  pulseSub: { ...TYPE.body, color: GV.fog, textAlign: 'center' },
  timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  stepper: { alignItems: 'center', gap: 4 },
  stepBtn: { minWidth: 56, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 26, color: '#FFFFFF', fontFamily: FONT.semi },
  timeValue: { fontSize: 44, lineHeight: 50, color: '#FFFFFF', fontFamily: FONT.semi, fontVariant: ['tabular-nums'] },
  timeColon: { fontSize: 40, color: GV.fog, fontFamily: FONT.semi },
  toggle: {
    borderRadius: 9999,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.22)',
    paddingHorizontal: 18,
    minHeight: 44,
    justifyContent: 'center',
  },
  toggleOn: { backgroundColor: '#4FD1C5', borderColor: '#4FD1C5' },
  toggleText: { ...TYPE.chip, color: GV.fog },
  toggleTextOn: { color: '#062A26' },
  timeMsg: { ...TYPE.caption, color: GV.fog, textAlign: 'center' },
  goBtn: { backgroundColor: '#4FD1C5' },
  goBtnText: { color: '#062A26' },
  ghostText: { color: '#A7B8B2' },
  disclaimer: { ...TYPE.caption, color: GV.fog, textAlign: 'center' },
  callWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 26 },
  emblemWrap: { width: 220, height: 220, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  emblem: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#0E2A26',
    borderWidth: 2,
    borderColor: '#4FD1C5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emblemGlyph: { fontSize: 44, color: '#4FD1C5' },
  callTitle: { fontFamily: FONT.semi, fontSize: 26, color: '#FFFFFF', textAlign: 'center' },
  callSub: { ...TYPE.body, color: GV.fog, textAlign: 'center' },
  callBtns: { flexDirection: 'row', gap: 16, marginTop: 16 },
  callBtn: { flex: 1, minHeight: 56, borderRadius: 9999, alignItems: 'center', justifyContent: 'center' },
  declineBtn: { backgroundColor: 'rgba(255,93,93,0.14)', borderWidth: 1.5, borderColor: 'rgba(255,93,93,0.5)' },
  answerBtn: { backgroundColor: '#4FD1C5' },
  callBtnText: { ...TYPE.button, color: '#FF7A7A' },
  answerText: { color: '#062A26' },
});
