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
import { Button, Card, EmptyState, SectionHeader } from '@/components';
import { EngineGraph } from '@/components/EngineGraph';
import { HealthFact } from '@/components/HealthFact';
import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
import { TILE_TONES } from '@/theme/tones';
import { useHeartEngine } from '@/hooks/useHeartEngine';
import {
  formatBpm,
  formatMeasuredAt,
  formatMs,
  methodLabel,
  type HeartPoint,
} from '@/screens/HeartEngine/heartEngine';

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
  const { latest, summary, changeLine, recent, hrv, isLoading } = useHeartEngine();
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
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Heart.</Text>
        <Text style={styles.sub}>Measured heart rate and HRV.</Text>

        {isLoading ? (
          <>
            <Text style={styles.loading}>Loading…</Text>
            <HealthFact style={styles.fact} />
          </>
        ) : latest === null ? (
          <EmptyState
            title="No measurements yet"
            message="Take a fingertip or face reading to begin."
          />
        ) : (
          <>
            <SectionHeader dark title="Latest" titleStyle={styles.histTitle} />
            <Card style={{ ...styles.darkCard, borderLeftWidth: 4, borderLeftColor: TILE_TONES.heart[1] }}>
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
                <SectionHeader dark title="This week" titleStyle={styles.histTitle} />
                <Card style={styles.darkCard}>
                  <Text style={styles.bigValue}>{formatBpm(summary.avgBpm)}</Text>
                  <Text style={styles.avgSub}>
                    {`Average · ${summary.measurements} ${summary.measurements === 1 ? 'reading' : 'readings'} · ${summary.measuredDays} ${summary.measuredDays === 1 ? 'day' : 'days'}`}
                  </Text>
                  {changeLine ? <Text style={styles.change}>{changeLine}</Text> : null}
                  <Text style={styles.provenance}>
                    {`${summary.reliableCount} of ${summary.measurements} good signal.`}
                  </Text>
                </Card>
              </>
            ) : null}

            <SectionHeader dark title="Heart rate variability" titleStyle={styles.histTitle} />
            <Card style={styles.darkCard}>
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
            </Card>

            <SectionHeader dark title="Recent measurements" titleStyle={styles.histTitle} />
            <View style={styles.grid}>
              {recent.map((point) => (
                <View
                  key={`${point.method}-${point.measuredAt}`}
                  style={styles.tile}
                  accessible
                  accessibilityRole="text"
                  accessibilityLabel={`${formatBpm(point.bpm)}, ${formatMeasuredAt(point.measuredAt)}`}
                >
                  <Text style={styles.tileValue} numberOfLines={1}>
                    {Math.round(point.bpm)}
                    <Text style={styles.tileUnit}> bpm</Text>
                  </Text>
                  <Text style={styles.tileDate} numberOfLines={1}>{fmtDay(point.measuredAt)}</Text>
                  <Text style={styles.tileTime} numberOfLines={1}>{fmtTime(point.measuredAt)}</Text>
                  {point.reliable !== 1 ? <View style={styles.tileFlag} /> : null}
                </View>
              ))}
            </View>

            {recent.length > 0 ? (
              <>
                <SectionHeader dark title="Heart trend" titleStyle={styles.histTitle} />
                <Card style={styles.darkCard}>
                  <EngineGraph
                    points={[...recent]
                      .sort((a, b) => (a.measuredAt < b.measuredAt ? -1 : a.measuredAt > b.measuredAt ? 1 : 0))
                      .map((p) => ({ date: p.measuredAt.slice(0, 10), value: Math.round(p.bpm) }))}
                    tone={TILE_TONES.heart[1]}
                    decimals={0}
                  />
                  <Text style={styles.avgSub}>
                    {`${recent.length} ${recent.length === 1 ? 'reading' : 'readings'}`}
                  </Text>
                </Card>
              </>
            ) : null}
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
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#080A11' },
  content: { paddingHorizontal: 26, paddingVertical: SPACE.sectionGap, paddingBottom: 32, gap: 12 },
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
  bigValue: { ...TYPE.display, fontSize: 40, color: '#FFFFFF', textAlign: 'center', fontVariant: ['tabular-nums'] },
  change: { ...TYPE.body, color: '#E8ECF1', textAlign: 'center', marginTop: 8, fontVariant: ['tabular-nums'] },
  provenance: { ...TYPE.caption, color: GV.fog, textAlign: 'center', marginTop: 8 },
  avgSub: { ...TYPE.caption, color: GV.fog, textAlign: 'center', marginTop: 4 },
  trackingBody: { ...TYPE.body, color: '#E8ECF1', textAlign: 'center' },
  // Four light tiles per row.
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: {
    flexGrow: 1,
    flexBasis: '22%',
    minHeight: 88,
    backgroundColor: '#EDF0F4',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 6,
    gap: 1,
  },
  tileValue: { fontFamily: FONT.semi, fontSize: 20, lineHeight: 24, color: '#14201D', fontVariant: ['tabular-nums'] },
  tileUnit: { fontFamily: FONT.regular, fontSize: 11, lineHeight: 14, color: GV.muted },
  tileDate: { fontSize: 11, lineHeight: 14, fontFamily: FONT.semi, color: GV.body },
  tileTime: { fontSize: 10, lineHeight: 13, fontFamily: FONT.regular, color: GV.muted, fontVariant: ['tabular-nums'] },
  tileFlag: { width: 6, height: 6, borderRadius: 3, backgroundColor: GV.danger, marginTop: 3 },
  measureBtn: { backgroundColor: '#4FD1C5' },
  measureBtnText: { color: '#062A26' },
  recoveryText: { color: '#A7B8B2' },
  disclaimer: { ...TYPE.caption, color: GV.fog, textAlign: 'center' },
  disclaimerHit: { alignItems: 'center', paddingVertical: 4 },
  disclaimerMore: { ...TYPE.caption, fontFamily: FONT.semi, color: '#4FD1C5', textAlign: 'center', marginTop: 2 },
});
