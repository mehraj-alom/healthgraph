/**
 * WeightEngineScreen — the Weight goal engine (Batch 6C).
 *
 * A shell around the only real weight source: the profile weight. Shows
 * the recorded value with honest provenance, or an honest empty state.
 * No trend (one value has no baseline), no change line, no history, no
 * period switcher — those appear only when weight logging exists. Copy is
 * descriptive ("See your weight as recorded") — never causal, never
 * medical, never a target or prediction.
 */

import { useCallback } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Button, EmptyState } from '@/components';
import { EngineGraph } from '@/components/EngineGraph';
import { GlassSurface } from '@/components/home/GlassSurface';
import { HomeStageBackdrop } from '@/components/home/HomeStageBackdrop';
import { SPACE } from '@/theme/guava';
import { TILE_TONES } from '@/theme/tones';
import { useWeightEngine } from '@/hooks/useWeightEngine';
import { formatWeightKg } from '@/screens/WeightEngine/weightEngine';

const SECONDARY = 'rgba(233,240,255,0.66)';
const TERTIARY = 'rgba(233,240,255,0.45)';

export default function WeightEngineScreen() {
  const navigation = useNavigation();
  const { model, history, isLoading } = useWeightEngine();

  const goSettings = useCallback(() => {
    const nav = navigation as unknown as {
      navigate: (route: string) => void;
    };
    nav.navigate('Settings');
  }, [navigation]);

  const goLog = useCallback(() => {
    const nav = navigation as unknown as {
      navigate: (route: string) => void;
    };
    nav.navigate('DailyLog');
  }, [navigation]);

  const avgKg =
    history.length > 0
      ? history.reduce((a, p) => a + p.weight_kg, 0) / history.length
      : null;

  return (
    <View style={styles.root}>
      <HomeStageBackdrop />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>Weight</Text>
          <Text style={styles.sub}>Recorded weight only.</Text>

          {isLoading ? (
            <View style={styles.center}>
              <Text style={styles.loading}>Loading…</Text>
            </View>
          ) : model.weightKg === null ? (
            <EmptyState
              title="No weight recorded yet"
              message="Record your weight in your profile to begin."
            />
          ) : (
            <>
              <Text style={styles.sectionTitle}>Current</Text>
              <GlassSurface strong style={styles.card}>
                <Text style={styles.value}>{formatWeightKg(model.weightKg)}</Text>
                <Text style={styles.provenance}>{model.provenance}</Text>
              </GlassSurface>

              <Text style={styles.sectionTitle}>Tracking</Text>
              <GlassSurface strong style={styles.card}>
                <Text style={styles.trackingBody}>
                  Trends appear here once weight logging exists.
                </Text>
              </GlassSurface>
            </>
          )}

          {history.length > 0 ? (
            <>
              <Text style={styles.sectionTitle}>Weight graph</Text>
              <GlassSurface strong style={styles.card}>
                <EngineGraph
                  points={history.map((p) => ({ date: p.log_date, value: p.weight_kg }))}
                  tone={TILE_TONES.weight[1]}
                  decimals={1}
                />
                <Text style={styles.avgSub}>
                  {`${history.length} ${history.length === 1 ? 'reading' : 'readings'}${avgKg != null ? ` · avg ${formatWeightKg(avgKg)}` : ''}`}
                </Text>
              </GlassSurface>
            </>
          ) : (
            !isLoading && (
              <GlassSurface strong style={styles.card}>
                <Text style={styles.trackingBody}>
                  Log weight in your daily check-in to grow this graph.
                </Text>
              </GlassSurface>
            )
          )}

          <Button
            title="Log weight"
            onPress={goLog}
            fullWidth
            size="large"
            variant="secondary"
            style={styles.logBtn}
            textStyle={styles.logBtnText}
          />

          <Button
            title="Open profile in Settings"
            onPress={goSettings}
            fullWidth
            size="large"
            variant="ghost"
            textStyle={styles.ghostText}
          />
          <Text style={styles.disclaimer}>
            From your profile on this device. Tracking only — not medical advice, diagnosis, or treatment.
          </Text>

          <View style={styles.bottomPad} />
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
  sectionTitle: { fontWeight: '600', fontSize: 20, lineHeight: 26, letterSpacing: -0.4, color: '#FFFFFF', marginTop: 8 },
  loading: { fontWeight: '400', fontSize: 15, lineHeight: 21, color: SECONDARY, textAlign: 'center', marginTop: 16 },
  center: { alignItems: 'center', paddingVertical: 24 },
  card: { padding: 16 },
  value: { fontWeight: '600', fontSize: 40, lineHeight: 46, color: '#FFFFFF', textAlign: 'center', fontVariant: ['tabular-nums'] },
  provenance: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: SECONDARY, textAlign: 'center', marginTop: 4 },
  avgSub: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: SECONDARY, textAlign: 'center', marginTop: 8, fontVariant: ['tabular-nums'] },
  trackingBody: { fontWeight: '400', fontSize: 15, lineHeight: 21, color: '#FFFFFF', textAlign: 'center' },
  logBtn: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  logBtnText: { color: '#0B0F1A' },
  ghostText: { color: '#FFFFFF' },
  disclaimer: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: TERTIARY, textAlign: 'center' },
  bottomPad: { height: 8 },
});
