/**
 * RecoveryScreen — overnight-recovery hint from the user's own baseline.
 *
 * Big number + band + per-factor rows (sleep, resting pulse, HRV, load),
 * all computed device-side from logged data. Sparse data shows exactly
 * what to log next instead of a number. A wellness hint — never medical
 * advice, diagnosis, or treatment.
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
import { Button, Card, EmptyState, SectionHeader } from '@/components';
import { HealthFact } from '@/components/HealthFact';
import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
import { useReadiness } from '@/hooks/useReadiness';
import type { ReadinessBand } from '@/screens/Recovery/recovery';

const BAND_COPY: Record<ReadinessBand, { title: string; sub: string; color: string }> = {
  ready: { title: 'Ready', sub: 'Your baseline says go.', color: '#4FD1C5' },
  steady: { title: 'Steady', sub: 'A normal day by your baseline.', color: '#C9A24B' },
  easy: { title: 'Take it easy', sub: 'Your baseline is asking for rest.', color: '#D4818D' },
};

export default function RecoveryScreen() {
  const navigation = useNavigation();
  const { readiness, missing, isLoading, refetch } = useReadiness();

  const goMeasure = useCallback(() => {
    const nav = navigation as unknown as {
      navigate: (route: string, params?: { screen?: string }) => void;
    };
    nav.navigate('Main', { screen: 'PpgMeasure' });
  }, [navigation]);

  const goSleep = useCallback(() => {
    const nav = navigation as unknown as {
      navigate: (r: string) => void;
    };
    nav.navigate('SleepEngine');
  }, [navigation]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Recovery.</Text>
        <Text style={styles.sub}>Overnight restoration, from your own baseline.</Text>

        {isLoading ? (
          <>
            <Text style={styles.loading}>Loading…</Text>
            <HealthFact style={styles.fact} />
          </>
        ) : !readiness ? (
          <EmptyState
            title="Not enough history yet"
            message={
              missing.length > 0
                ? missing.join(' · ')
                : 'Log sleep and measure pulse a few more days to unlock.'
            }
          />
        ) : (
          <>
            <Card style={styles.darkCard}>
              <Text style={[styles.bigValue, { color: BAND_COPY[readiness.band].color }]}>
                {readiness.value}
              </Text>
              <Text style={styles.bandTitle}>{BAND_COPY[readiness.band].title}</Text>
              <Text style={styles.avgSub}>{BAND_COPY[readiness.band].sub}</Text>
              <Text style={styles.provenance}>
                {`From ${readiness.baselineNights} logged ${readiness.baselineNights === 1 ? 'night' : 'nights'} · your baseline, not a population chart.`}
              </Text>
            </Card>

            <SectionHeader dark title="What went in" titleStyle={styles.histTitle} />
            <Card style={styles.darkCard}>
              {readiness.factors.map((f) => (
                <View key={f.key} style={styles.factorRow}>
                  <View style={styles.factorMain}>
                    <Text style={styles.factorLabel}>{f.label}</Text>
                    <Text style={styles.factorNote} numberOfLines={1}>{f.note}</Text>
                  </View>
                  <View style={styles.factorBar}>
                    <View
                      style={[
                        styles.factorFill,
                        {
                          width: `${Math.round((f.points / Math.max(1, f.max)) * 100)}%`,
                          backgroundColor: BAND_COPY[readiness.band].color,
                        },
                      ]}
                    />
                  </View>
                  <Text style={styles.factorPoints}>{`${f.points}/${f.max}`}</Text>
                </View>
              ))}
            </Card>

            <Button title="Refresh" variant="ghost" onPress={() => void refetch()} fullWidth textStyle={styles.ghostText} />
          </>
        )}

        <Button
          title="Measure heart rate"
          onPress={goMeasure}
          fullWidth
          size="large"
          style={styles.measureBtn}
          textStyle={styles.measureBtnText}
        />
        <Button
          title="Log sleep"
          variant="ghost"
          onPress={goSleep}
          fullWidth
          textStyle={styles.ghostText}
        />
        <Text style={styles.disclaimer}>
          A wellness hint from your trends — not medical advice, diagnosis, or treatment.
        </Text>
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
  bigValue: { ...TYPE.display, fontSize: 64, textAlign: 'center', fontVariant: ['tabular-nums'] },
  bandTitle: { fontFamily: FONT.semi, fontSize: 20, color: '#FFFFFF', textAlign: 'center', marginTop: 4 },
  avgSub: { ...TYPE.caption, color: GV.fog, textAlign: 'center', marginTop: 4 },
  provenance: { ...TYPE.caption, color: GV.fog, textAlign: 'center', marginTop: 8 },
  factorRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  factorMain: { width: 128, gap: 2 },
  factorLabel: { ...TYPE.body, color: '#FFFFFF', fontSize: 14 },
  factorNote: { ...TYPE.caption, color: GV.fog, fontSize: 11 },
  factorBar: { flex: 1, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.12)' },
  factorFill: { height: 8, borderRadius: 4 },
  factorPoints: { ...TYPE.caption, color: GV.fog, width: 44, textAlign: 'right', fontVariant: ['tabular-nums'] },
  measureBtn: { backgroundColor: '#4FD1C5' },
  measureBtnText: { color: '#062A26' },
  ghostText: { color: '#A7B8B2' },
  disclaimer: { ...TYPE.caption, color: GV.fog, textAlign: 'center' },
});
