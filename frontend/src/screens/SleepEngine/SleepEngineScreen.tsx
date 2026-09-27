/**
 * SleepEngineScreen — the Sleep goal engine (Batch 6B).
 *
 * Active when 'sleep' is among the Batch 6A active-engine ids. Tracking,
 * NOT treatment: average duration, trailing-week strip, period comparison
 * and real night history — all from logged daily-check-in sleep columns on
 * this device. No bedtime/wake times exist, no stages, no wearables, so no
 * consistency section and no charts beyond real nights.
 *
 * Empty state is honest ("no sleep logged yet") with a path to the DailyLog
 * check-in that creates the data. Copy is descriptive ("Track your sleep
 * patterns") — never improve/fix/prevent, never diagnosis.
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
import { TILE_TONES } from '@/theme/tones';
import { StageGradient } from '@/components/StageGradient';
import { useSleepEngine } from '@/hooks/useSleepEngine';
import {
  formatSleepDuration,
  type SleepNight,
} from '@/screens/SleepEngine/sleepEngine';

const QUALITY_LABELS: Record<number, string> = {
  1: 'Very poor',
  2: 'Poor',
  3: 'Fair',
  4: 'Good',
  5: 'Excellent',
};

function formatDayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return date.slice(5);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function qualityCopy(quality: number | null): string | null {
  if (quality == null) return null;
  const label = QUALITY_LABELS[quality];
  return label ? `quality ${label.toLowerCase()}` : null;
}

function nightSub(night: SleepNight): string {
  const parts = [formatDayLabel(night.date)];
  const q = qualityCopy(night.quality);
  if (q) parts.push(q);
  if (night.awakenings != null && night.awakenings > 0) {
    parts.push(night.awakenings === 1 ? '1 wake-up' : `${night.awakenings} wake-ups`);
  }
  return parts.join(' · ');
}

export default function SleepEngineScreen() {
  const navigation = useNavigation();
  const { nights, summary, week, changeLine, isLoading } = useSleepEngine();

  const goLog = useCallback(() => {
    const nav = navigation as unknown as {
      navigate: (route: string) => void;
    };
    nav.navigate('DailyLog');
  }, [navigation]);

  const loggedWeek = week.filter((d) => d.logged).length;

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
        <Text style={styles.overline}>SLEEP ENGINE · ON THIS DEVICE</Text>
        <Text style={styles.title}>Sleep</Text>
        <Text style={styles.sub}>
          Track your sleep patterns. See how your sleep changes over time.
        </Text>

        {isLoading ? (
          <>
            <Text style={styles.loading}>Loading…</Text>
            <HealthFact style={styles.fact} />
          </>
        ) : summary.loggedNights === 0 ? (
          <EmptyState
            icon="🌙"
            title="No sleep logged yet"
            message="Sleep tracking starts with your daily check-in. Log last night's sleep and patterns, averages and changes appear here. Only from real entries."
          />
        ) : (
          <>
            <SectionHeader title="Average" />
            <Card>
              <Text style={styles.avgValue}>
                {summary.avgMinutes != null ? formatSleepDuration(summary.avgMinutes) : '—'}
              </Text>
              <Text style={styles.avgSub}>
                {`Across ${summary.loggedNights} ${summary.loggedNights === 1 ? 'logged night' : 'logged nights'} (last 28 days)`}
              </Text>
              {changeLine ? <Text style={styles.change}>{changeLine}</Text> : null}
            </Card>

            <SectionHeader title="This week" />
            <Card>
              <View style={styles.strip}>
                {week.map((d) => (
                  <View key={d.date} style={styles.cell}>
                    <View
                      style={[styles.bar, d.logged ? styles.barOn : styles.barOff]}
                      accessibilityLabel={`${d.date} ${d.logged ? `slept ${formatSleepDuration(d.durationMinutes ?? 0)}` : 'no entry'}`}
                    />
                    <Text style={styles.cellDay}>{d.date.slice(8)}</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.weekTotal}>
                {loggedWeek === 0
                  ? 'Nothing recorded this week.'
                  : `${loggedWeek} ${loggedWeek === 1 ? 'night' : 'nights'} logged this week.`}
              </Text>
            </Card>

            <SectionHeader title="Recent nights" />
            <View style={styles.list}>
              {[...nights]
                .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
                .slice(0, 14)
                .map((night) => (
                  <Card key={night.date}>
                    <View style={styles.rowTop}>
                      <View style={styles.rowMain}>
                        <Text style={styles.rowTitle}>
                          {formatSleepDuration(night.durationMinutes)}
                        </Text>
                        <Text style={styles.rowSub}>{nightSub(night)}</Text>
                      </View>
                    </View>
                  </Card>
                ))}
            </View>
          </>
        )}

        <Button title="+ Log sleep" onPress={goLog} fullWidth />
        <Text style={styles.disclaimer}>
          From your check-ins on this device. Tracking only — not medical advice, diagnosis, or treatment.
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
  avgValue: { ...TYPE.display, fontSize: 40, color: GV.ink, textAlign: 'center', fontVariant: ['tabular-nums'] },
  avgSub: { ...TYPE.caption, color: GV.muted, textAlign: 'center', marginTop: 4 },
  change: { ...TYPE.body, color: GV.body, textAlign: 'center', marginTop: 8, fontVariant: ['tabular-nums'] },
  strip: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  cell: { alignItems: 'center', gap: 6, minWidth: 32 },
  bar: { width: 16, height: 44, borderRadius: 8, justifyContent: 'flex-end' },
  barOn: { backgroundColor: TILE_TONES.sleep[1] },
  barOff: { borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.25)' },
  cellDay: { ...TYPE.caption, fontSize: 12, color: GV.fog, fontVariant: ['tabular-nums'] },
  weekTotal: { ...TYPE.caption, color: GV.muted, textAlign: 'center', marginTop: 8 },
  list: { gap: SPACE.cardGap },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  rowMain: { flex: 1, gap: 4 },
  rowTitle: { ...TYPE.button, fontSize: 17, color: GV.ink, fontVariant: ['tabular-nums'] },
  rowSub: { ...TYPE.caption, color: GV.body, fontVariant: ['tabular-nums'] },
  disclaimer: { ...TYPE.caption, color: GV.fog, textAlign: 'center' },
});
