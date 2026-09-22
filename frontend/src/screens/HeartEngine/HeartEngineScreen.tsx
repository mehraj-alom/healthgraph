/**
 * HeartEngineScreen — the Heart goal engine (Batch 6H, final engine).
 *
 * Reports camera measurements only: latest measured HR with modality
 * provenance, weekly average with absolute change, measured days, PPG
 * HRV (RMSSD/SDNN) where longer fingertip sessions stored it, and real
 * measurement history. No rest-state label (no source defines one), no
 * oxygen-saturation card (no source), no min/max-as-range, no
 * derivations, no diagnoses. Empty state is honest when nothing is
 * measured, with a path to the existing PPG flow. Copy reports measured
 * values — never healthy or risky, never causal.
 */

import { useCallback } from 'react';
import {
  Pressable,
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
import { StageGradient } from '@/components/StageGradient';
import { useHeartEngine } from '@/hooks/useHeartEngine';
import {
  formatBpm,
  formatMeasuredAt,
  formatMs,
  methodLabel,
  type HeartPoint,
} from '@/screens/HeartEngine/heartEngine';

function recentSub(point: HeartPoint): string {
  const parts = [formatMeasuredAt(point.measuredAt), methodLabel(point.method)];
  if (point.reliable !== 1) parts.push('borderline signal');
  return parts.join(' · ');
}

export default function HeartEngineScreen() {
  const navigation = useNavigation();
  const { latest, summary, changeLine, recent, hrv, isLoading } = useHeartEngine();

  const goMeasure = useCallback(() => {
    const nav = navigation as unknown as {
      navigate: (route: string, params?: { screen?: string }) => void;
    };
    nav.navigate('Main', { screen: 'PpgMeasure' });
  }, [navigation]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StageGradient />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable
          onPress={() => navigation.canGoBack() && navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={12}
          style={styles.backHit}
        >
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>
        <Text style={styles.overline}>Heart engine · From your measurements</Text>
        <Text style={styles.title}>Heart</Text>
        <Text style={styles.sub}>
          See your measured heart rate and HRV.
        </Text>

        {isLoading ? (
          <>
            <Text style={styles.loading}>Loading…</Text>
            <HealthFact style={styles.fact} />
          </>
        ) : latest === null ? (
          <EmptyState
            icon="♥️"
            title="No measurements yet"
            message="Heart tracking starts with a camera measurement. Take a fingertip or face reading and latest values, averages and history appear here. Only from real measurements."
          />
        ) : (
          <>
            <SectionHeader title="Latest" />
            <Card>
              <Text style={styles.bigValue}>{formatBpm(latest.bpm)}</Text>
              <Text style={styles.avgSub}>
                {`${methodLabel(latest.method)} · ${formatMeasuredAt(latest.measuredAt)}`}
              </Text>
              <Text style={styles.provenance}>
                {latest.reliable === 1 ? 'Good signal.' : 'Borderline signal. Still a real reading.'}
              </Text>
            </Card>

            {summary.avgBpm != null ? (
              <>
                <SectionHeader title="This week" />
                <Card>
                  <Text style={styles.bigValue}>{formatBpm(summary.avgBpm)}</Text>
                  <Text style={styles.avgSub}>
                    {`Average measured HR · ${summary.measurements} ${summary.measurements === 1 ? 'measurement' : 'measurements'} on ${summary.measuredDays} ${summary.measuredDays === 1 ? 'day' : 'days'}`}
                  </Text>
                  {changeLine ? <Text style={styles.change}>{changeLine}</Text> : null}
                  <Text style={styles.provenance}>
                    {`${summary.reliableCount} of ${summary.measurements} with good signal.`}
                  </Text>
                </Card>
              </>
            ) : null}

            <SectionHeader title="Heart rate variability" />
            <Card>
              {hrv.latest !== null ? (
                <>
                  <Text style={styles.bigValue}>{formatMs(hrv.latest.rmssdMs)}</Text>
                  <Text style={styles.avgSub}>
                    {`Latest RMSSD${hrv.latest.sdnnMs != null ? ` · SDNN ${formatMs(hrv.latest.sdnnMs)}` : ''} · fingertip PPG only`}
                  </Text>
                  {hrv.avgRmssdMs != null ? (
                    <Text style={styles.provenance}>
                      {`Average RMSSD ${formatMs(hrv.avgRmssdMs)} over ${hrv.sessions} ${hrv.sessions === 1 ? 'session' : 'sessions'}.`}
                    </Text>
                  ) : null}
                </>
              ) : (
                <Text style={styles.trackingBody}>
                  No HRV stored yet. HRV appears here after a longer fingertip measurement (30 seconds or more with good signal). Face readings do not produce it.
                </Text>
              )}
            </Card>

            <SectionHeader title="Recent measurements" />
            <View style={styles.list}>
              {recent.map((point) => (
                <Card key={`${point.method}-${point.measuredAt}`}>
                  <View style={styles.rowTop}>
                    <View style={styles.rowMain}>
                      <Text style={styles.rowTitle}>{formatBpm(point.bpm)}</Text>
                      <Text style={styles.rowSub}>{recentSub(point)}</Text>
                    </View>
                  </View>
                </Card>
              ))}
            </View>
          </>
        )}

        <Button title="Measure heart rate" onPress={goMeasure} fullWidth />
        <Text style={styles.disclaimer}>
          Camera measurements on this device. Tracking only — not medical advice, diagnosis, or treatment.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: GV.stage },
  content: { paddingHorizontal: SPACE.screenH, paddingVertical: SPACE.sectionGap, paddingBottom: 32, gap: 12 },
  backHit: { minHeight: 44, justifyContent: 'center' },
  backText: { ...TYPE.button, fontSize: 16, color: GV.fog },
  overline: { fontFamily: FONT.semi, fontSize: 12, lineHeight: 16, letterSpacing: 3, color: GV.teal, textAlign: 'center' },
  title: { ...TYPE.display, color: GV.card, textAlign: 'center' },
  sub: { ...TYPE.body, color: GV.fog, textAlign: 'center' },
  loading: { ...TYPE.body, color: GV.fog, textAlign: 'center', marginTop: 16 },
  fact: { ...TYPE.caption, color: GV.fog, textAlign: 'center', marginTop: 8 },
  bigValue: { ...TYPE.display, fontSize: 40, color: GV.ink, textAlign: 'center', fontVariant: ['tabular-nums'] },
  change: { ...TYPE.body, color: GV.body, textAlign: 'center', marginTop: 8, fontVariant: ['tabular-nums'] },
  provenance: { ...TYPE.caption, color: GV.muted, textAlign: 'center', marginTop: 8 },
  avgSub: { ...TYPE.caption, color: GV.muted, textAlign: 'center', marginTop: 4 },
  trackingBody: { ...TYPE.body, color: GV.body, textAlign: 'center' },
  list: { gap: SPACE.cardGap },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  rowMain: { flex: 1, gap: 4 },
  rowTitle: { ...TYPE.button, fontSize: 17, color: GV.ink, fontVariant: ['tabular-nums'] },
  rowSub: { ...TYPE.caption, color: GV.body },
  disclaimer: { ...TYPE.caption, color: GV.fog, textAlign: 'center' },
});
