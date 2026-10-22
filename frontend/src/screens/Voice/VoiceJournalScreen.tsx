/**
 * VoiceJournalScreen — free-form voice journaling.
 *
 * Unlike the guided check-in interview, this screen asks nothing and parses
 * nothing: the user speaks in 12-second turns (same recorder, same
 * per-turn transcription path and size caps), turns accumulate verbatim,
 * and saving appends the transcript to today's notes through the existing
 * daily-log merge path. Empty transcripts can never create a note; a full
 * notes day keeps its existing notes instead of cutting them.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAudioRecorder, requestRecordingPermissionsAsync } from 'expo-audio';
import { SPACE } from '@/theme/guava';
import { Button, EmptyState } from '@/components';
import { GlassSurface } from '@/components/home/GlassSurface';
import { HomeStageBackdrop } from '@/components/home/HomeStageBackdrop';
import { LG } from '@/theme/liquidGlass';
import { todayKeyLocal } from '@/utils/dayKey';
import { requestDataRefresh } from '@/services/dataRefresh';
import { getCachedPatientId } from '@/services/patientIdentity';
import { createPakeetProvider } from '@/services/voice/stt';
import { createPakeetTransport } from '@/services/voice/transport';
import { getDailyLogDetail, mergeIntoDailyLog } from '@/db/queries/dailyLogs';
import {
  MAX_JOURNAL_TURNS,
  buildNotesAppend,
  joinTurns,
  validateTranscript,
} from '@/services/voiceJournal';

const LISTEN_SECONDS = 12;

const SECONDARY = 'rgba(233,240,255,0.66)';
const TERTIARY = 'rgba(233,240,255,0.45)';

type Phase = 'idle' | 'recording' | 'working' | 'preview' | 'saving';

export default function VoiceJournalScreen() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [turns, setTurns] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const turnsRef = useRef<string[]>([]);
  turnsRef.current = turns;

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

  const clearTimer = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      clearTimer();
      try {
        if (recorder.isRecording) void recorder.stop();
      } catch {
        // Never recording — nothing to stop.
      }
    },
    [recorder, clearTimer],
  );

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

  const finishTurn = useCallback(
    async (uri: string | null) => {
      clearTimer();
      if (!uri) {
        setError('No recording was captured.');
        setPhase(turnsRef.current.length > 0 ? 'preview' : 'idle');
        return;
      }
      setPhase('working');
      setError(null);
      try {
        const stt = createPakeetProvider({ transport: createPakeetTransport() });
        const out = await stt.transcribe({ audioUri: uri, timeoutMs: 90_000 });
        const text = out.text.trim();
        if (text.length > 0) {
          setTurns((prev) => [...prev, text]);
        }
        setPhase('preview');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Voice upload failed.');
        setPhase(turnsRef.current.length > 0 ? 'preview' : 'idle');
      }
    },
    [clearTimer],
  );

  const startTurn = useCallback(async () => {
    clearTimer();
    setError(null);
    setSavedMsg(null);
    setElapsed(0);
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setError('Microphone denied. Enable it in Settings to journal by voice.');
        return;
      }
      try {
        if (recorder.isRecording) await recorder.stop();
      } catch {
        // Previous turn may still hold the recorder — stop first.
      }
      await recorder.prepareToRecordAsync();
      recorder.record();
      setPhase('recording');
      timer.current = setInterval(() => {
        setElapsed((s) => {
          if (s + 1 >= LISTEN_SECONDS) {
            void stopRecording().then((uri) => void finishTurn(uri));
            return s;
          }
          return s + 1;
        });
      }, 1000);
    } catch {
      setError('Could not start recording. Try again.');
      setPhase(turnsRef.current.length > 0 ? 'preview' : 'idle');
    }
  }, [recorder, clearTimer, stopRecording, finishTurn]);

  const stopTurn = useCallback(async () => {
    const uri = await stopRecording();
    await finishTurn(uri);
  }, [stopRecording, finishTurn]);

  const discard = useCallback(() => {
    clearTimer();
    setTurns([]);
    setError(null);
    setSavedMsg(null);
    setPhase('idle');
  }, [clearTimer]);

  const save = useCallback(async () => {
    const transcript = joinTurns(turnsRef.current);
    const check = validateTranscript(transcript);
    if (!check.ok) {
      setError(check.reason === 'empty' ? 'Nothing to save yet — record a turn first.' : 'That entry is too long to save.');
      return;
    }
    const patientId = getCachedPatientId();
    if (!patientId) {
      setError('Sign in first, then save your journal entry.');
      return;
    }
    setPhase('saving');
    setError(null);
    try {
      const today = todayKeyLocal();
      const detail = await getDailyLogDetail(patientId, today).catch(() => null);
      const expected = buildNotesAppend(detail?.notes ?? null, transcript);
      if (expected === (detail?.notes ?? '')) {
        setSavedMsg("Today's notes are full — your existing notes were kept as-is.");
        setPhase('preview');
        return;
      }
      await mergeIntoDailyLog(patientId, today, { notes_append: transcript });
      requestDataRefresh();
      setTurns([]);
      setSavedMsg('Saved to today’s notes. Find it in your Timeline diary.');
      setPhase('idle');
    } catch {
      setError('Could not save. Your words are still on this screen — try again.');
      setPhase('preview');
    }
  }, []);

  const transcript = joinTurns(turns);
  const canRecordMore = turns.length < MAX_JOURNAL_TURNS;

  return (
    <View style={styles.root}>
      <HomeStageBackdrop />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>Voice journal</Text>
          <Text style={styles.sub}>Speak freely. Turns save verbatim to today’s notes.</Text>

          {phase === 'idle' && turns.length === 0 ? (
            <EmptyState
              title="No turns yet"
              message="Record a 12-second turn. Add up to ten turns per entry."
            />
          ) : null}

          {transcript.length > 0 ? (
            <GlassSurface strong style={styles.card}>
              <Text style={styles.transcript}>{transcript}</Text>
              <Text style={styles.provenance}>
                {`${turns.length} ${turns.length === 1 ? 'turn' : 'turns'} · verbatim, unedited`}
              </Text>
            </GlassSurface>
          ) : null}

          {phase === 'recording' ? (
            <GlassSurface strong style={styles.card}>
              <Text style={styles.bigValue}>{`${elapsed}s / ${LISTEN_SECONDS}s`}</Text>
              <Text style={styles.avgSub}>Recording… tap stop when done.</Text>
            </GlassSurface>
          ) : null}

          {phase === 'working' ? <Text style={styles.loading}>Transcribing…</Text> : null}
          {phase === 'saving' ? <Text style={styles.loading}>Saving…</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {savedMsg ? <Text style={styles.saved}>{savedMsg}</Text> : null}

          {phase === 'recording' ? (
            <Button
              title="Stop turn"
              variant="secondary"
              onPress={() => void stopTurn()}
              fullWidth
              size="large"
              style={styles.measureBtn}
              textStyle={styles.measureBtnText}
            />
          ) : (
            <>
              {canRecordMore ? (
                <Button
                  title={turns.length === 0 ? 'Record first turn' : 'Record another turn'}
                  variant="secondary"
                  onPress={() => void startTurn()}
                  fullWidth
                  size="large"
                  style={styles.measureBtn}
                  textStyle={styles.measureBtnText}
                />
              ) : (
                <Text style={styles.avgSub}>{`Turn limit reached (${MAX_JOURNAL_TURNS}). Save or discard this entry.`}</Text>
              )}
              {transcript.length > 0 && phase !== 'saving' ? (
                <>
                  <Button
                    title="Save to today’s notes"
                    variant="secondary"
                    onPress={() => void save()}
                    fullWidth
                    style={styles.measureBtn}
                    textStyle={styles.measureBtnText}
                  />
                  <Button title="Discard entry" variant="ghost" onPress={discard} fullWidth textStyle={styles.ghostText} />
                </>
              ) : null}
            </>
          )}

          <Text style={styles.disclaimer}>Transcripts save to today’s notes. Tracking only — not medical advice.</Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05070F' },
  safe: { flex: 1 },
  content: { paddingHorizontal: SPACE.screenH, paddingVertical: 12, paddingBottom: 32, gap: 12 },
  title: { fontWeight: '600', fontSize: 34, lineHeight: 41, letterSpacing: -0.8, color: '#FFFFFF', textAlign: 'center' },
  sub: { fontWeight: '400', fontSize: 15, lineHeight: 21, color: SECONDARY, textAlign: 'center' },
  loading: { fontWeight: '400', fontSize: 15, lineHeight: 21, color: SECONDARY, textAlign: 'center', marginTop: 16 },
  error: { fontWeight: '400', fontSize: 15, lineHeight: 22, color: LG.card.danger, textAlign: 'center', marginTop: 8 },
  saved: { fontWeight: '400', fontSize: 15, lineHeight: 22, color: LG.card.mint, textAlign: 'center', marginTop: 8 },
  card: { padding: 16 },
  transcript: { fontWeight: '400', fontSize: 15, lineHeight: 22, color: '#FFFFFF' },
  bigValue: { fontWeight: '600', fontSize: 40, lineHeight: 48, color: '#FFFFFF', textAlign: 'center', fontVariant: ['tabular-nums'] },
  avgSub: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: SECONDARY, textAlign: 'center', marginTop: 4 },
  provenance: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: TERTIARY, textAlign: 'center', marginTop: 8 },
  measureBtn: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  measureBtnText: { color: '#0B0F1A' },
  ghostText: { color: '#FFFFFF' },
  disclaimer: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: TERTIARY, textAlign: 'center' },
});
