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
import { Button, EmptyState } from '@/components';
import { GlassSurface } from '@/components/home/GlassSurface';
import { HomeStageBackdrop } from '@/components/home/HomeStageBackdrop';
import { SPACE } from '@/theme/guava';
import { LG } from '@/theme/liquidGlass';
import { useReadiness } from '@/hooks/useReadiness';
import type { ReadinessBand } from '@/screens/Recovery/recovery';

const SECONDARY = 'rgba(233,240,255,0.66)';
const TERTIARY = 'rgba(233,240,255,0.45)';

const BAND_COPY: Record<ReadinessBand, { title: string; sub: string; color: string }> = {
  ready: { title: 'Ready', sub: 'Your baseline says go.', color: LG.card.mint },
  steady: { title: 'Steady', sub: 'A normal day by your baseline.', color: '#C9A24B' },
  easy: { title: 'Take it easy', sub: 'Your baseline is asking for rest.', color: LG.card.danger },
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
    <View style={styles.root}>
      <HomeStageBackdrop />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Recovery</Text>
        <Text style={styles.sub}>Overnight restoration, from your own baseline.</Text>

        {isLoading ? (
          <View style={styles.center}>
            <Text style={styles.loading}>Loading…</Text>
          </View>
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
            <GlassSurface strong style={styles.card}>
              <Text style={[styles.bigValue, { color: BAND_COPY[readiness.band].color }]}>
                {readiness.value}
              </Text>
              <Text style={styles.bandTitle}>{BAND_COPY[readiness.band].title}</Text>
              <Text style={styles.avgSub}>{BAND_COPY[readiness.band].sub}</Text>
              <Text style={styles.provenance}>
                {`From ${readiness.baselineNights} logged ${readiness.baselineNights === 1 ? 'night' : 'nights'} · your baseline, not a population chart.`}
              </Text>
            </GlassSurface>

            <Text style={styles.sectionTitle}>What went in</Text>
            <GlassSurface strong style={styles.card}>
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
            </GlassSurface>

            <Button title="Refresh" variant="ghost" onPress={() => void refetch()} fullWidth textStyle={styles.ghostText} />
          </>
        )}

        <Button
          title="Measure heart rate"
          variant="secondary"
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
  bigValue: { fontWeight: '600', fontSize: 64, lineHeight: 70, color: '#FFFFFF', textAlign: 'center', fontVariant: ['tabular-nums'] },
  bandTitle: { fontWeight: '600', fontSize: 20, lineHeight: 26, letterSpacing: -0.4, color: '#FFFFFF', textAlign: 'center', marginTop: 4 },
  avgSub: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: SECONDARY, textAlign: 'center', marginTop: 4 },
  provenance: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: TERTIARY, textAlign: 'center', marginTop: 8 },
  factorRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  factorMain: { width: 128, gap: 2 },
  factorLabel: { fontWeight: '600', fontSize: 14, lineHeight: 19, color: '#FFFFFF' },
  factorNote: { fontWeight: '400', fontSize: 11, lineHeight: 14, color: TERTIARY },
  factorBar: { flex: 1, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.12)' },
  factorFill: { height: 8, borderRadius: 4 },
  factorPoints: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: SECONDARY, width: 44, textAlign: 'right', fontVariant: ['tabular-nums'] },
  measureBtn: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  measureBtnText: { color: '#0B0F1A' },
  ghostText: { color: '#FFFFFF' },
  disclaimer: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: TERTIARY, textAlign: 'center' },
});
