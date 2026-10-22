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

import { useCallback, useState } from 'react';
import {
  Pressable,
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
import { LG } from '@/theme/liquidGlass';
import { TILE_TONES } from '@/theme/tones';
import { useHeartEngine } from '@/hooks/useHeartEngine';
import {
  formatBpm,
  formatMeasuredAt,
  formatMs,
  methodLabel,
} from '@/screens/HeartEngine/heartEngine';

const SECONDARY = 'rgba(233,240,255,0.66)';
const TERTIARY = 'rgba(233,240,255,0.45)';

function fmtDay(measuredAt: string): string {
  const d = new Date(measuredAt);
  if (Number.isNaN(d.getTime())) return measuredAt.slice(5, 10);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtTime(measuredAt: string): string {
  const d = new Date(measuredAt);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

export default function HeartEngineScreen() {
  const navigation = useNavigation();
  const { latest, summary, changeLine, monthSummary, monthChangeLine, recent, monthPoints, hrv, isLoading } = useHeartEngine();
  const [disclaimerOpen, setDisclaimerOpen] = useState(false);

  const goMeasure = useCallback(() => {
    const nav = navigation as unknown as {
      navigate: (route: string, params?: { screen?: string }) => void;
    };
    nav.navigate('Main', { screen: 'PpgMeasure' });
  }, [navigation]);

  const goRecovery = useCallback(() => {
    const nav = navigation as unknown as {
      navigate: (route: string) => void;
    };
    nav.navigate('Recovery');
  }, [navigation]);

  return (
    <View style={styles.root}>
      <HomeStageBackdrop />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>Heart</Text>
          <Text style={styles.sub}>Measured heart rate and HRV.</Text>

          {isLoading ? (
            <View style={styles.center}>
              <Text style={styles.loading}>Loading…</Text>
            </View>
          ) : latest === null ? (
            <EmptyState
              title="No measurements yet"
              message="Take a fingertip or face reading to begin."
            />
          ) : (
            <>
              <Text style={styles.sectionTitle}>Latest</Text>
              <GlassSurface strong style={styles.card}>
                <Text style={styles.bigValue}>{formatBpm(latest.bpm)}</Text>
                <Text style={styles.avgSub}>
                  {`${methodLabel(latest.method)} · ${formatMeasuredAt(latest.measuredAt)}`}
                </Text>
                <Text style={styles.provenance}>
                  {latest.reliable === 1 ? 'Good signal.' : 'Borderline signal. Still a real reading.'}
                </Text>
              </GlassSurface>

              {summary.avgBpm != null ? (
                <>
                  <Text style={styles.sectionTitle}>This week</Text>
                  <GlassSurface strong style={styles.card}>
                    <Text style={styles.bigValue}>{formatBpm(summary.avgBpm)}</Text>
                    <Text style={styles.avgSub}>
                      {`Average · ${summary.measurements} ${summary.measurements === 1 ? 'reading' : 'readings'} · ${summary.measuredDays} ${summary.measuredDays === 1 ? 'day' : 'days'}`}
                    </Text>
                    {changeLine ? <Text style={styles.change}>{changeLine}</Text> : null}
                    <Text style={styles.provenance}>
                      {`${summary.reliableCount} of ${summary.measurements} good signal.`}
                    </Text>
                  </GlassSurface>
                </>
              ) : null}

              {monthSummary.avgBpm != null ? (
                <>
                  <Text style={styles.sectionTitle}>Last 30 days</Text>
                  <GlassSurface strong style={styles.card}>
                    <Text style={styles.bigValue}>{formatBpm(monthSummary.avgBpm)}</Text>
                    <Text style={styles.avgSub}>
                      {`Average · ${monthSummary.measurements} ${monthSummary.measurements === 1 ? 'reading' : 'readings'} · ${monthSummary.measuredDays} ${monthSummary.measuredDays === 1 ? 'day' : 'days'}`}
                    </Text>
                    {monthChangeLine ? <Text style={styles.change}>{monthChangeLine}</Text> : null}
                    <Text style={styles.provenance}>
                      {`${monthSummary.reliableCount} of ${monthSummary.measurements} good signal.`}
                    </Text>
                  </GlassSurface>
                </>
              ) : null}

              <Text style={styles.sectionTitle}>Heart rate variability</Text>
              <GlassSurface strong style={styles.card}>
                {hrv.latest !== null ? (
                  <>
                    <Text style={styles.bigValue}>{formatMs(hrv.latest.rmssdMs)}</Text>
                    <Text style={styles.avgSub}>
                      {`RMSSD${hrv.latest.sdnnMs != null ? ` · SDNN ${formatMs(hrv.latest.sdnnMs)}` : ''} · fingertip only`}
                    </Text>
                    {hrv.avgRmssdMs != null ? (
                      <Text style={styles.provenance}>
                        {`Avg RMSSD ${formatMs(hrv.avgRmssdMs)} · ${hrv.sessions} ${hrv.sessions === 1 ? 'session' : 'sessions'}.`}
                      </Text>
                    ) : null}
                  </>
                ) : (
                  <Text style={styles.trackingBody}>
                    Appears after a longer fingertip reading (30 seconds or more, good signal).
                  </Text>
                )}
              </GlassSurface>

              <Text style={styles.sectionTitle}>Recent measurements</Text>
              <View style={styles.grid}>
                {recent.map((point) => (
                  <GlassSurface
                    key={`${point.method}-${point.measuredAt}`}
                    noBlur
                    noSheen
                    style={styles.tile}
                  >
                    <View
                      accessible
                      accessibilityRole="text"
                      accessibilityLabel={`${formatBpm(point.bpm)}, ${formatMeasuredAt(point.measuredAt)}`}
                      style={styles.tileInner}
                    >
                      <Text style={styles.tileValue} numberOfLines={1}>
                        {Math.round(point.bpm)}
                        <Text style={styles.tileUnit}> bpm</Text>
                      </Text>
                      <Text style={styles.tileDate} numberOfLines={1}>{fmtDay(point.measuredAt)}</Text>
                      <Text style={styles.tileTime} numberOfLines={1}>{fmtTime(point.measuredAt)}</Text>
                      {point.reliable !== 1 ? <View style={styles.tileFlag} /> : null}
                    </View>
                  </GlassSurface>
                ))}
              </View>

              {monthPoints.length > 0 ? (
                <>
                  <Text style={styles.sectionTitle}>Heart trend</Text>
                  <GlassSurface strong style={styles.card}>
                    <EngineGraph
                      points={monthPoints.map((p) => ({ date: p.measuredAt.slice(0, 10), value: Math.round(p.bpm) }))}
                      tone={TILE_TONES.heart[1]}
                      decimals={0}
                    />
                    <Text style={styles.avgSub}>
                      {`${monthPoints.length} ${monthPoints.length === 1 ? 'reading' : 'readings'} · last 30 days`}
                    </Text>
                  </GlassSurface>
                </>
              ) : null}
            </>
          )}

          <Button
            title="Measure heart rate"
            onPress={goMeasure}
            fullWidth
            size="large"
            variant="secondary"
            style={styles.measureBtn}
            textStyle={styles.measureBtnText}
          />
          <Button
            title="Recovery"
            variant="ghost"
            onPress={goRecovery}
            fullWidth
            textStyle={styles.recoveryText}
          />
          <Pressable
            onPress={() => setDisclaimerOpen((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={disclaimerOpen ? 'Show less' : 'Show full disclaimer'}
            style={styles.disclaimerHit}
          >
            <Text style={styles.disclaimer} numberOfLines={disclaimerOpen ? undefined : 2}>
              Camera measurements on this device. Tracking only — not medical advice, diagnosis, or treatment.
            </Text>
            <Text style={styles.disclaimerMore}>{disclaimerOpen ? 'Less' : 'More'}</Text>
          </Pressable>
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
  bigValue: { fontWeight: '600', fontSize: 40, lineHeight: 46, color: '#FFFFFF', textAlign: 'center', fontVariant: ['tabular-nums'] },
  change: { fontWeight: '400', fontSize: 15, lineHeight: 21, color: '#FFFFFF', textAlign: 'center', marginTop: 8, fontVariant: ['tabular-nums'] },
  provenance: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: SECONDARY, textAlign: 'center', marginTop: 8 },
  avgSub: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: SECONDARY, textAlign: 'center', marginTop: 4 },
  trackingBody: { fontWeight: '400', fontSize: 15, lineHeight: 21, color: '#FFFFFF', textAlign: 'center' },
  // Four light tiles per row.
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { flexGrow: 1, flexBasis: '22%', borderRadius: 16, paddingVertical: 10, paddingHorizontal: 6 },
  tileInner: { alignItems: 'center', justifyContent: 'center', gap: 1 },
  tileValue: { fontWeight: '600', fontSize: 20, lineHeight: 24, color: '#FFFFFF', fontVariant: ['tabular-nums'] },
  tileUnit: { fontWeight: '400', fontSize: 11, lineHeight: 14, color: SECONDARY },
  tileDate: { fontWeight: '600', fontSize: 11, lineHeight: 14, color: '#FFFFFF' },
  tileTime: { fontWeight: '400', fontSize: 10, lineHeight: 13, color: SECONDARY, fontVariant: ['tabular-nums'] },
  tileFlag: { width: 6, height: 6, borderRadius: 3, backgroundColor: LG.card.danger, marginTop: 3 },
  measureBtn: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  measureBtnText: { color: '#0B0F1A' },
  recoveryText: { color: '#FFFFFF' },
  disclaimer: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: TERTIARY, textAlign: 'center' },
  disclaimerHit: { alignItems: 'center', paddingVertical: 4 },
  disclaimerMore: { fontWeight: '600', fontSize: 13, lineHeight: 18, color: LG.card.mint, textAlign: 'center', marginTop: 2 },
});
