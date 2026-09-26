/**
 * VoiceTurnScreen — ISOLATED turn-based voice loop (development only).
 *
 * One short turn, no streaming, no session state:
 *   mic record (≤30 s) → upload → Pakeet text → LangGraph reply (existing
 *   /api/v1/chat) → response shown as text.
 *
 * Response playback via sanoTTS stays pending on-device g2p (documented);
 * the screen says so instead of fabricating audio. Disconnected from
 * medication calls and production flows; dev-gated entry only.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { requestRecordingPermissionsAsync, useAudioRecorder } from 'expo-audio';
import { api } from '@/services/api';
import { createPakeetProvider } from '@/services/voice/stt';
import { createPakeetTransport } from '@/services/voice/transport';
import { VoiceError } from '@/services/voice/errors';
import { FONT } from '@/theme/guava';

const MAX_TURN_S = 30;

type TurnPhase = 'IDLE' | 'RECORDING' | 'UPLOADING' | 'THINKING' | 'DONE' | 'ERROR';

export default function VoiceTurnScreen() {
  const navigation = useNavigation();
  const [phase, setPhase] = useState<TurnPhase>('IDLE');
  const [status, setStatus] = useState('Tap Record and speak a short turn (≤30 s).');
  const [transcript, setTranscript] = useState<string | null>(null);
  const [reply, setReply] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

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
    (s) => {
      if (s.isFinished && phase === 'RECORDING') void finishTurn();
    },
  );
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
    },
    [],
  );

  const startTurn = useCallback(async () => {
    setTranscript(null);
    setReply(null);
    setElapsed(0);
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setPhase('ERROR');
        setStatus('Microphone permission denied. Enable it in Settings to test voice turns.');
        return;
      }
      await recorder.prepareToRecordAsync();
      recorder.record({ forDuration: MAX_TURN_S });
      setPhase('RECORDING');
      setStatus('Recording… speak now.');
      const t0 = Date.now();
      timer.current = setInterval(() => setElapsed((Date.now() - t0) / 1000), 250);
    } catch (e) {
      setPhase('ERROR');
      setStatus(e instanceof Error ? e.message : 'Microphone could not start.');
    }
  }, [recorder]);

  const finishTurn = useCallback(async () => {
    if (phaseRef.current !== 'RECORDING') return;
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    setPhase('UPLOADING');
    setStatus('Uploading turn for transcription…');
    try {
      try {
        await recorder.stop();
      } catch {
        // stop() after auto-stop races harmlessly.
      }
      const uri = recorder.uri;
      if (!uri) throw new VoiceError('INVALID_AUDIO', 'No recording was captured.');
      const stt = createPakeetProvider({ transport: createPakeetTransport() });
      const out = await stt.transcribe({ audioUri: uri, timeoutMs: 90_000 });
      setTranscript(out.text);
      setPhase('THINKING');
      setStatus('Thinking (LangGraph)…');
      const chat = await api.getClient().post<{ response_text?: unknown }>('/api/v1/chat', {
        message: out.text,
        conversation_id: null,
        focused_structure_id: null,
      });
      const text = (chat.data as { response_text?: unknown })?.response_text;
      if (typeof text !== 'string' || text.trim() === '') {
        throw new VoiceError('TRANSCRIPTION_FAILED', 'The assistant returned no text.');
      }
      setReply(text);
      setPhase('DONE');
      setStatus('Turn complete. Playback of this reply needs on-device text phonemization (voice-session phase).');
    } catch (e) {
      setPhase('ERROR');
      setStatus(
        e instanceof VoiceError
          ? `${e.code}: ${e.message}`
          : e instanceof Error
            ? e.message
            : 'Voice turn failed.',
      );
    }
  }, [recorder]);

  const cancelTurn = useCallback(async () => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    try {
      if (recorder.isRecording) await recorder.stop();
    } catch {
      // Best-effort.
    }
    setPhase('IDLE');
    setStatus('Turn cancelled. Tap Record to try again.');
  }, [recorder]);

  const exit = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
  }, [navigation]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.kicker}>VOICE TURN · ISOLATED · DEV ONLY</Text>
        <Text style={styles.title}>Turn-based voice</Text>
        <Text style={styles.status}>{status}</Text>
        {phase === 'RECORDING' ? <Text style={styles.timer}>{elapsed.toFixed(0)}s / {MAX_TURN_S}s</Text> : null}
        {transcript !== null ? (
          <View style={styles.bubble}>
            <Text style={styles.bubbleLabel}>YOU (PAKEET)</Text>
            <Text style={styles.bubbleText}>{transcript || '(empty transcription)'}</Text>
          </View>
        ) : null}
        {reply !== null ? (
          <View style={styles.bubble}>
            <Text style={styles.bubbleLabel}>HEALTHGRAPH (LANGGRAPH)</Text>
            <Text style={styles.bubbleText}>{reply}</Text>
          </View>
        ) : null}
        {phase === 'IDLE' || phase === 'DONE' || phase === 'ERROR' ? (
          <Pressable onPress={() => void startTurn()} accessibilityRole="button" accessibilityLabel="Record voice turn" style={styles.btn}>
            <Text style={styles.btnText}>● RECORD TURN</Text>
          </Pressable>
        ) : null}
        {phase === 'RECORDING' ? (
          <>
            <Pressable onPress={() => void finishTurn()} accessibilityRole="button" accessibilityLabel="Stop and send turn" style={styles.btn}>
              <Text style={styles.btnText}>■ STOP + SEND</Text>
            </Pressable>
            <Pressable onPress={() => void cancelTurn()} accessibilityRole="button" accessibilityLabel="Cancel turn" style={styles.ghostBtn}>
              <Text style={styles.ghostText}>Cancel</Text>
            </Pressable>
          </>
        ) : null}
        {(phase === 'UPLOADING' || phase === 'THINKING') && (
          <Pressable onPress={() => void cancelTurn()} accessibilityRole="button" accessibilityLabel="Cancel turn" style={styles.ghostBtn}>
            <Text style={styles.ghostText}>Cancel</Text>
          </Pressable>
        )}
        <Pressable onPress={exit} accessibilityRole="button" accessibilityLabel="Close voice turn test" style={styles.ghostBtn}>
          <Text style={styles.ghostText}>Close</Text>
        </Pressable>
        <Text style={styles.fineprint}>
          Short-lived turn only: no streaming, no session state, no medication-call contact. Response audio waits on on-device g2p.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0f0d' },
  content: { paddingHorizontal: 24, paddingTop: 32, paddingBottom: 40, gap: 12 },
  kicker: { fontFamily: FONT.semi, fontSize: 11, letterSpacing: 3, color: '#7d8f96', textAlign: 'center' },
  title: { fontFamily: FONT.semi, fontSize: 24, color: '#e8f0ec', textAlign: 'center' },
  status: { fontSize: 13, lineHeight: 19, color: '#c9d5da', textAlign: 'center', minHeight: 38 },
  timer: { fontSize: 28, color: '#ffb454', textAlign: 'center', fontVariant: ['tabular-nums'] },
  bubble: { backgroundColor: '#141c19', borderRadius: 14, padding: 14, gap: 6, borderWidth: 1, borderColor: '#223028' },
  bubbleLabel: { fontFamily: FONT.semi, fontSize: 10, letterSpacing: 2, color: '#7d8f96' },
  bubbleText: { fontSize: 15, lineHeight: 22, color: '#e8f0ec' },
  btn: { backgroundColor: '#0e5c40', borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  btnText: { fontFamily: FONT.semi, fontSize: 15, letterSpacing: 1, color: '#eafff3' },
  ghostBtn: { borderRadius: 14, paddingVertical: 13, alignItems: 'center', borderWidth: 1, borderColor: '#2c3a34' },
  ghostText: { fontFamily: FONT.semi, fontSize: 14, color: '#c9d5da' },
  fineprint: { fontSize: 11, lineHeight: 15, color: '#5b6b72', textAlign: 'center', marginTop: 8 },
});
