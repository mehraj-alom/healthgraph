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

import { useCallback, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Button, Card, EmptyState, SectionHeader } from '@/components';
import { EngineGraph } from '@/components/EngineGraph';
import { HealthFact } from '@/components/HealthFact';
import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
import { TILE_TONES } from '@/theme/tones';
import { useWeightEngine } from '@/hooks/useWeightEngine';
import { formatWeightKg } from '@/screens/WeightEngine/weightEngine';


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
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Weight.</Text>
        <Text style={styles.sub}>Recorded weight only.</Text>

        {isLoading ? (
          <>
            <Text style={styles.loading}>Loading…</Text>
            <HealthFact style={styles.fact} />
          </>
        ) : model.weightKg === null ? (
          <EmptyState
            title="No weight recorded yet"
            message="Record your weight in your profile to begin."
          />
        ) : (
          <>
            <SectionHeader dark title="Current" titleStyle={styles.histTitle} />
            <Card style={styles.darkCard}>
              <Text style={styles.value}>{formatWeightKg(model.weightKg)}</Text>
              <Text style={styles.provenance}>{model.provenance}</Text>
            </Card>

            <SectionHeader dark title="Tracking" titleStyle={styles.histTitle} />
            <Card style={styles.darkCard}>
              <Text style={styles.trackingBody}>
                Trends appear here once weight logging exists.
              </Text>
            </Card>
          </>
        )}

        {history.length > 0 ? (
          <>
            <SectionHeader dark title="Weight graph" titleStyle={styles.histTitle} />
            <Card style={styles.darkCard}>
              <EngineGraph
                points={history.map((p) => ({ date: p.log_date, value: p.weight_kg }))}
                tone={TILE_TONES.weight[1]}
                decimals={1}
              />
              <Text style={styles.avgSub}>
                {`${history.length} ${history.length === 1 ? 'reading' : 'readings'}${avgKg != null ? ` · avg ${formatWeightKg(avgKg)}` : ''}`}
              </Text>
            </Card>
          </>
        ) : (
          !isLoading && (
            <Card style={styles.darkCard}>
              <Text style={styles.trackingBody}>
                Log weight in your daily check-in to grow this graph.
              </Text>
            </Card>
          )
        )}

        <Button
          title="Log weight"
          onPress={goLog}
          fullWidth
          size="large"
          variant="ghost"
          style={styles.logBtn}
          textStyle={styles.logBtnText}
        />

        <Button
          title="Open profile in Settings"
          onPress={goSettings}
          fullWidth
          size="large"
          style={styles.goBtn}
          textStyle={styles.goBtnText}
        />
        <Text style={styles.disclaimer}>
          From your profile on this device. Tracking only — not medical advice, diagnosis, or treatment.
        </Text>

        <View style={styles.bottomPad} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#080A11' },
  content: { paddingHorizontal: SPACE.screenH, paddingVertical: SPACE.sectionGap, paddingBottom: 32, gap: 12 },
  title: { fontFamily: FONT.semi, fontSize: 24, lineHeight: 30, letterSpacing: -0.3, color: '#FFFFFF', textAlign: 'center' },
  sub: { ...TYPE.body, color: GV.fog, textAlign: 'center' },
  histTitle: { fontSize: 20, lineHeight: 24, letterSpacing: -0.3 },
  loading: { ...TYPE.body, color: GV.fog, textAlign: 'center', marginTop: 16 },
  fact: { ...TYPE.caption, color: GV.fog, textAlign: 'center', marginTop: 8 },
  darkCard: {
    backgroundColor: '#10141F',
    borderColor: 'rgba(255,255,255,0.10)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 6,
  },
  value: { ...TYPE.display, fontSize: 40, color: '#FFFFFF', textAlign: 'center', fontVariant: ['tabular-nums'] },
  provenance: { ...TYPE.caption, color: GV.fog, textAlign: 'center', marginTop: 4 },
  avgSub: { ...TYPE.caption, color: GV.fog, textAlign: 'center', marginTop: 8, fontVariant: ['tabular-nums'] },
  trackingBody: { ...TYPE.body, color: '#E8ECF1', textAlign: 'center' },
  goBtn: { backgroundColor: '#4FD1C5' },
  goBtnText: { color: '#062A26' },
  logBtn: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: '#4FD1C5' },
  logBtnText: { color: '#4FD1C5' },
  disclaimer: { ...TYPE.caption, color: GV.fog, textAlign: 'center' },
  bottomPad: { height: 8 },
});
