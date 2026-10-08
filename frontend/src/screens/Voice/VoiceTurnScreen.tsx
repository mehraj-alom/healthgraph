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
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { requestRecordingPermissionsAsync, useAudioRecorder } from 'expo-audio';
import { Button } from '@/components';
import { GlassSurface } from '@/components/home/GlassSurface';
import { HomeStageBackdrop } from '@/components/home/HomeStageBackdrop';
import { SPACE } from '@/theme/guava';
import { api } from '@/services/api';
import { createPakeetProvider } from '@/services/voice/stt';
import { createPakeetTransport } from '@/services/voice/transport';
import { logVoiceTurn } from '@/services/voice/log';
import { stripMarkdown } from '@/utils/stripMarkdown';
import { VoiceError } from '@/services/voice/errors';

const MAX_TURN_S = 30;

const SECONDARY = 'rgba(233,240,255,0.66)';
const TERTIARY = 'rgba(233,240,255,0.45)';

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
      setReply(stripMarkdown(text));
      setPhase('DONE');
      setStatus('Turn complete. Playback of this reply needs on-device text phonemization (voice-session phase).');
      // Journal the completed turn (best-effort): a failed log never fails
      // an already-completed turn; the sync engine retries offline saves.
      try {
        const saved = await logVoiceTurn(out.text, text);
        if (saved && !saved.serverSaved) {
          setStatus((s) => `${s} Saved on this device; will sync when back online.`);
        }
      } catch {
        // Swallowed by design (see above).
      }
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
    <View style={styles.root}>
      <HomeStageBackdrop />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.kicker}>Voice turn · isolated · dev only</Text>
          <Text style={styles.title}>Turn-based voice</Text>
          <Text style={styles.status}>{status}</Text>
          {phase === 'RECORDING' ? <Text style={styles.timer}>{elapsed.toFixed(0)}s / {MAX_TURN_S}s</Text> : null}
          {transcript !== null ? (
            <GlassSurface strong style={styles.card}>
              <Text style={styles.bubbleLabel}>You (Pakeet)</Text>
              <Text style={styles.bubbleText}>{transcript || '(empty transcription)'}</Text>
            </GlassSurface>
          ) : null}
          {reply !== null ? (
            <GlassSurface strong style={styles.card}>
              <Text style={styles.bubbleLabel}>HealthGraph (LangGraph)</Text>
              <Text style={styles.bubbleText}>{reply}</Text>
            </GlassSurface>
          ) : null}
          {phase === 'IDLE' || phase === 'DONE' || phase === 'ERROR' ? (
            <Button
              title="Record turn"
              variant="secondary"
              onPress={() => void startTurn()}
              accessibilityLabel="Record voice turn"
              fullWidth
              size="large"
              style={styles.measureBtn}
              textStyle={styles.measureBtnText}
            />
          ) : null}
          {phase === 'RECORDING' ? (
            <>
              <Button
                title="Stop + send"
                variant="secondary"
                onPress={() => void finishTurn()}
                accessibilityLabel="Stop and send turn"
                fullWidth
                size="large"
                style={styles.measureBtn}
                textStyle={styles.measureBtnText}
              />
              <Button
                title="Cancel"
                variant="ghost"
                onPress={() => void cancelTurn()}
                accessibilityLabel="Cancel turn"
                fullWidth
                textStyle={styles.ghostText}
              />
            </>
          ) : null}
          {(phase === 'UPLOADING' || phase === 'THINKING') && (
            <Button
              title="Cancel"
              variant="ghost"
              onPress={() => void cancelTurn()}
              accessibilityLabel="Cancel turn"
              fullWidth
              textStyle={styles.ghostText}
            />
          )}
          <Button title="Close" variant="ghost" onPress={exit} accessibilityLabel="Close voice turn test" fullWidth textStyle={styles.ghostText} />
          <Text style={styles.fineprint}>
            Short-lived turn only: no streaming, no session state, no medication-call contact. Response audio waits on on-device g2p.
            Completed turns are saved to today's journal as notes.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05070F' },
  safe: { flex: 1 },
  content: { paddingHorizontal: SPACE.screenH, paddingVertical: 12, paddingBottom: 32, gap: 12 },
  kicker: { fontWeight: '600', fontSize: 11, lineHeight: 14, letterSpacing: 0.5, textTransform: 'uppercase', color: TERTIARY, textAlign: 'center' },
  title: { fontWeight: '600', fontSize: 34, lineHeight: 41, letterSpacing: -0.8, color: '#FFFFFF', textAlign: 'center' },
  status: { fontWeight: '400', fontSize: 15, lineHeight: 21, color: SECONDARY, textAlign: 'center' },
  timer: { fontWeight: '600', fontSize: 28, lineHeight: 34, color: '#FFFFFF', textAlign: 'center', fontVariant: ['tabular-nums'] },
  card: { padding: 16, gap: 6 },
  bubbleLabel: { fontWeight: '600', fontSize: 11, lineHeight: 14, letterSpacing: 0.5, textTransform: 'uppercase', color: TERTIARY },
  bubbleText: { fontWeight: '400', fontSize: 15, lineHeight: 22, color: '#FFFFFF' },
  measureBtn: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  measureBtnText: { color: '#0B0F1A' },
  ghostText: { color: '#FFFFFF' },
  fineprint: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: TERTIARY, textAlign: 'center', marginTop: 8 },
});
