/**
 * SattsTestScreen — ISOLATED sanoTTS synthesis test (development only).
 *
 * Standalone path: precomputed phoneme IDs → native synth → WAV file →
 * expo-audio playback. Never touches the medication Call Engine, never
 * runs in production flows. Reachable only through the __DEV__ voice-test
 * entry on the Medications screen.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
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
import { Button } from '@/components';
import { GlassSurface } from '@/components/home/GlassSurface';
import { HomeStageBackdrop } from '@/components/home/HomeStageBackdrop';
import { SPACE } from '@/theme/guava';
import { createSanoTTSProvider, type TtsResult } from '@/services/voice/tts';
import { VoiceError } from '@/services/voice/errors';

const FRONT_ASSET = require('../../../assets/voices/heartnano/front_q8.bin');
const MODEL_ASSET = require('../../../assets/voices/heartnano/model_q8.bin');

const SECONDARY = 'rgba(233,240,255,0.66)';
const TERTIARY = 'rgba(233,240,255,0.45)';

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
    <View style={styles.root}>
      <HomeStageBackdrop />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {playing && playUri ? <Player uri={playUri} onDone={stopPlayback} /> : null}
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.kicker}>Voice test · isolated · dev only</Text>
          <Text style={styles.title}>sanoTTS synthesis</Text>
          <Text style={styles.phrase}>“{SATTS_TEST_PHRASE}”</Text>
          <Text style={styles.status}>{status}</Text>
          <GlassSurface strong style={styles.card}>
            <View style={styles.meterRow}>
              <Text style={styles.meter}>load: {stats.loadMs === null ? '—' : `${stats.loadMs} ms`}</Text>
              <Text style={styles.meter}>synth: {stats.synthMs === null ? '—' : `${stats.synthMs} ms`}</Text>
            </View>
            <View style={styles.meterRow}>
              <Text style={styles.meter}>bytes: {stats.bytes < 0 ? '—' : stats.bytes}</Text>
              <Text style={styles.meter}>rate: {stats.sampleRateHz || '—'} Hz</Text>
              <Text style={styles.meter}>plays: {stats.plays}</Text>
            </View>
          </GlassSurface>
          <Button
            title="1 · Load voice"
            variant="secondary"
            onPress={() => void loadVoices()}
            accessibilityLabel="Load voice"
            fullWidth
            size="large"
            style={styles.measureBtn}
            textStyle={styles.measureBtnText}
          />
          <Button
            title="2 · Synthesize"
            variant="secondary"
            onPress={() => void synthesize()}
            disabled={busy}
            accessibilityLabel="Synthesize test phrase"
            fullWidth
            size="large"
            style={styles.measureBtn}
            textStyle={styles.measureBtnText}
          />
          <Button
            title="3 · Play"
            variant="secondary"
            onPress={play}
            disabled={!stats.uri}
            accessibilityLabel="Play synthesized audio"
            fullWidth
            size="large"
            style={styles.measureBtn}
            textStyle={styles.measureBtnText}
          />
          {playing ? (
            <Button
              title="Stop"
              variant="danger"
              onPress={stopPlayback}
              accessibilityLabel="Stop playback"
              fullWidth
              size="large"
            />
          ) : null}
          <Button title="Close" variant="ghost" onPress={exit} accessibilityLabel="Close voice test" fullWidth textStyle={styles.ghostText} />
          <Text style={styles.fineprint}>
            Disconnected from medication reminders and production flows. Precomputed phoneme IDs only — no on-device text phonemization yet.
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
  phrase: { fontWeight: '400', fontSize: 14, lineHeight: 20, fontStyle: 'italic', color: SECONDARY, textAlign: 'center' },
  status: { fontWeight: '400', fontSize: 15, lineHeight: 21, color: SECONDARY, textAlign: 'center' },
  card: { padding: 16, gap: 8 },
  meterRow: { flexDirection: 'row', justifyContent: 'space-evenly' },
  meter: { fontWeight: '400', fontSize: 12, lineHeight: 17, color: SECONDARY, fontVariant: ['tabular-nums'] },
  measureBtn: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  measureBtnText: { color: '#0B0F1A' },
  ghostText: { color: '#FFFFFF' },
  fineprint: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: TERTIARY, textAlign: 'center', marginTop: 8 },
});
