/**
 * SattsTestScreen — ISOLATED sanoTTS synthesis test (development only).
 *
 * Standalone path: precomputed phoneme IDs → native synth → WAV file →
 * expo-audio playback. Never touches the medication Call Engine, never
 * runs in production flows. Reachable only through the __DEV__ voice-test
 * entry on the Medications screen.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Asset } from 'expo-asset';
import { useAudioPlayer } from 'expo-audio';
import {
  SATTS_TEST_IDS,
  SATTS_TEST_PHRASE,
  getSattsModule,
  isSattsAvailable,
} from 'healthgraph-satts';
import { createSanoTTSProvider, type TtsResult } from '@/services/voice/tts';
import { VoiceError } from '@/services/voice/errors';
import { FONT } from '@/theme/guava';

const FRONT_ASSET = require('../../../assets/voices/heartnano/front_q8.bin');
const MODEL_ASSET = require('../../../assets/voices/heartnano/model_q8.bin');

interface RunStats {
  loadMs: number | null;
  synthMs: number | null;
  uri: string | null;
  bytes: number;
  sampleRateHz: number;
  plays: number;
}

function Player({ uri, onDone }: { uri: string; onDone: () => void }) {
  const player = useAudioPlayer(uri);
  useEffect(() => {
    try {
      player.play();
    } catch {
      onDone();
      return;
    }
    const t = setTimeout(onDone, 8000);
    return () => {
      clearTimeout(t);
      try {
        player.pause();
      } catch {
        // Best-effort.
      }
    };
  }, [player, uri, onDone]);
  return null;
}

export default function SattsTestScreen() {
  const navigation = useNavigation();
  const [status, setStatus] = useState('Idle. Native module: ' + (isSattsAvailable ? 'present' : 'absent'));
  const [stats, setStats] = useState<RunStats>({ loadMs: null, synthMs: null, uri: null, bytes: -1, sampleRateHz: 0, plays: 0 });
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [playUri, setPlayUri] = useState<string | null>(null);
  const providerRef = useRef<ReturnType<typeof createSanoTTSProvider> | null>(null);

  const exit = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
  }, [navigation]);

  const loadVoices = useCallback(async () => {
    const t0 = Date.now();
    setStatus('Loading voice files…');
    try {
      const [front, model] = await Promise.all([
        Asset.fromModule(FRONT_ASSET).downloadAsync(),
        Asset.fromModule(MODEL_ASSET).downloadAsync(),
      ]);
      const frontUri = front.localUri ?? front.uri;
      const modelUri = model.localUri ?? model.uri;
      const bridge = getSattsModule();
      providerRef.current = createSanoTTSProvider({
        bridge,
        voice: { frontUri, modelUri },
        stat: async (uri: string) => {
          const FileSystem = await import('expo-file-system');
          const info = await FileSystem.getInfoAsync(uri);
          return { size: info.exists && info.size !== undefined ? info.size : -1 };
        },
      });
      // Warm the native handle now so synthesis timing is pure inference.
      await providerRef.current.synthesizeIds([1, 2]);
      const loadMs = Date.now() - t0;
      setStats((s) => ({ ...s, loadMs }));
      setStatus(`Voice ready in ${loadMs} ms (heartnano, on-device).`);
    } catch (e) {
      setStatus(e instanceof VoiceError ? `${e.code}: ${e.message}` : 'Voice load failed.');
    }
  }, []);

  const synthesize = useCallback(async () => {
    if (!providerRef.current) {
      setStatus('Load the voice first.');
      return;
    }
    setBusy(true);
    setStatus('Synthesizing…');
    try {
      const t0 = Date.now();
      const out: TtsResult = await providerRef.current.synthesizeIds([...SATTS_TEST_IDS]);
      const synthMs = Date.now() - t0;
      setStats((s) => ({ ...s, synthMs, uri: out.uri, bytes: out.bytes, sampleRateHz: out.sampleRateHz }));
      setStatus(`Synthesized ${out.bytes} bytes in ${synthMs} ms. Tap Play to hear it.`);
    } catch (e) {
      setStatus(e instanceof VoiceError ? `${e.code}: ${e.message}` : 'Synthesis failed.');
    } finally {
      setBusy(false);
    }
  }, []);

  const play = useCallback(() => {
    if (!stats.uri) return;
    setPlaying(true);
    setPlayUri(stats.uri);
    setStats((s) => ({ ...s, plays: s.plays + 1 }));
  }, [stats.uri]);

  const stopPlayback = useCallback(() => {
    setPlaying(false);
    setPlayUri(null);
  }, []);

  return (
    <SafeAreaView style={styles.safe}>
      {playing && playUri ? <Player uri={playUri} onDone={stopPlayback} /> : null}
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.kicker}>VOICE TEST · ISOLATED · DEV ONLY</Text>
        <Text style={styles.title}>sanoTTS synthesis</Text>
        <Text style={styles.phrase}>“{SATTS_TEST_PHRASE}”</Text>
        <Text style={styles.status}>{status}</Text>
        <View style={styles.meterRow}>
          <Text style={styles.meter}>load: {stats.loadMs === null ? '—' : `${stats.loadMs} ms`}</Text>
          <Text style={styles.meter}>synth: {stats.synthMs === null ? '—' : `${stats.synthMs} ms`}</Text>
        </View>
        <View style={styles.meterRow}>
          <Text style={styles.meter}>bytes: {stats.bytes < 0 ? '—' : stats.bytes}</Text>
          <Text style={styles.meter}>rate: {stats.sampleRateHz || '—'} Hz</Text>
          <Text style={styles.meter}>plays: {stats.plays}</Text>
        </View>
        <Pressable onPress={() => void loadVoices()} accessibilityRole="button" accessibilityLabel="Load voice" style={styles.btn}>
          <Text style={styles.btnText}>1 · LOAD VOICE</Text>
        </Pressable>
        <Pressable
          onPress={() => void synthesize()}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Synthesize test phrase"
          style={[styles.btn, busy && styles.btnDisabled]}
        >
          <Text style={styles.btnText}>2 · SYNTHESIZE</Text>
        </Pressable>
        <Pressable
          onPress={play}
          disabled={!stats.uri}
          accessibilityRole="button"
          accessibilityLabel="Play synthesized audio"
          style={[styles.btn, !stats.uri && styles.btnDisabled]}
        >
          <Text style={styles.btnText}>3 · PLAY</Text>
        </Pressable>
        {playing ? (
          <Pressable onPress={stopPlayback} accessibilityRole="button" accessibilityLabel="Stop playback" style={styles.stopBtn}>
            <Text style={styles.btnText}>STOP</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={exit} accessibilityRole="button" accessibilityLabel="Close voice test" style={styles.ghostBtn}>
          <Text style={styles.ghostText}>Close</Text>
        </Pressable>
        <Text style={styles.fineprint}>
          Disconnected from medication reminders and production flows. Precomputed phoneme IDs only — no on-device text phonemization yet.
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
  phrase: { fontSize: 14, fontStyle: 'italic', color: '#93a5a0', textAlign: 'center' },
  status: { fontSize: 13, lineHeight: 19, color: '#c9d5da', textAlign: 'center', minHeight: 38 },
  meterRow: { flexDirection: 'row', justifyContent: 'space-evenly' },
  meter: { fontSize: 12, color: '#7d8f96', fontVariant: ['tabular-nums'] },
  btn: { backgroundColor: '#0e5c40', borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  btnDisabled: { opacity: 0.45 },
  btnText: { fontFamily: FONT.semi, fontSize: 15, letterSpacing: 1, color: '#eafff3' },
  stopBtn: { backgroundColor: '#4a1a1a', borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  ghostBtn: { borderRadius: 14, paddingVertical: 13, alignItems: 'center', borderWidth: 1, borderColor: '#2c3a34' },
  ghostText: { fontFamily: FONT.semi, fontSize: 14, color: '#c9d5da' },
  fineprint: { fontSize: 11, lineHeight: 15, color: '#5b6b72', textAlign: 'center', marginTop: 8 },
});
