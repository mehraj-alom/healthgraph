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
import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
import { Button, Card, EmptyState } from '@/components';
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
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Voice journal.</Text>
        <Text style={styles.sub}>Speak freely. Turns save verbatim to today’s notes.</Text>

        {phase === 'idle' && turns.length === 0 ? (
          <EmptyState
            title="No turns yet"
            message="Record a 12-second turn. Add up to ten turns per entry."
          />
        ) : null}

        {transcript.length > 0 ? (
          <Card style={styles.darkCard}>
            <Text style={styles.transcript}>{transcript}</Text>
            <Text style={styles.provenance}>
              {`${turns.length} ${turns.length === 1 ? 'turn' : 'turns'} · verbatim, unedited`}
            </Text>
          </Card>
        ) : null}

        {phase === 'recording' ? (
          <Card style={styles.darkCard}>
            <Text style={styles.bigValue}>{`${elapsed}s / ${LISTEN_SECONDS}s`}</Text>
            <Text style={styles.avgSub}>Recording… tap stop when done.</Text>
          </Card>
        ) : null}

        {phase === 'working' ? <Text style={styles.loading}>Transcribing…</Text> : null}
        {phase === 'saving' ? <Text style={styles.loading}>Saving…</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {savedMsg ? <Text style={styles.saved}>{savedMsg}</Text> : null}

        {phase === 'recording' ? (
          <Button title="Stop turn" onPress={() => void stopTurn()} fullWidth size="large" style={styles.stopBtn} textStyle={styles.stopBtnText} />
        ) : (
          <>
            {canRecordMore ? (
              <Button
                title={turns.length === 0 ? 'Record first turn' : 'Record another turn'}
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
                <Button title="Save to today’s notes" onPress={() => void save()} fullWidth textStyle={styles.recoveryText} />
                <Button title="Discard entry" variant="ghost" onPress={discard} fullWidth textStyle={styles.recoveryText} />
              </>
            ) : null}
          </>
        )}

        <Text style={styles.disclaimer}>Transcripts save to today’s notes. Tracking only — not medical advice.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#080A11' },
  content: { paddingHorizontal: 26, paddingVertical: SPACE.sectionGap, paddingBottom: 32, gap: 12 },
  title: { fontFamily: FONT.semi, fontSize: 24, lineHeight: 30, letterSpacing: -0.3, color: '#FFFFFF', textAlign: 'center' },
  sub: { ...TYPE.body, color: GV.fog, textAlign: 'center' },
  loading: { ...TYPE.body, color: GV.fog, textAlign: 'center', marginTop: 16 },
  error: { ...TYPE.body, color: GV.danger, textAlign: 'center', marginTop: 8 },
  saved: { ...TYPE.body, color: '#4FD1C5', textAlign: 'center', marginTop: 8 },
  darkCard: {
    backgroundColor: '#10141F',
    borderColor: 'rgba(255,255,255,0.10)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 6,
  },
  transcript: { ...TYPE.body, color: '#E8ECF1' },
  bigValue: { ...TYPE.display, fontSize: 40, color: '#FFFFFF', textAlign: 'center', fontVariant: ['tabular-nums'] },
  avgSub: { ...TYPE.caption, color: GV.fog, textAlign: 'center', marginTop: 4 },
  provenance: { ...TYPE.caption, color: GV.fog, textAlign: 'center', marginTop: 8 },
  measureBtn: { backgroundColor: '#4FD1C5' },
  measureBtnText: { color: '#062A26' },
  stopBtn: { backgroundColor: '#E5484D' },
  stopBtnText: { color: '#FFFFFF' },
  recoveryText: { color: '#A7B8B2' },
  disclaimer: { ...TYPE.caption, color: GV.fog, textAlign: 'center' },
});
