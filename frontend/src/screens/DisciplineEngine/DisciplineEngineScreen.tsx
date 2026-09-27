/**
 * DisciplineEngineScreen — the Discipline goal engine (Batch 6D).
 *
 * Answers "what health-related actions have I actually been consistently
 * doing?" with separate factual lines: active days, active-day streak,
 * medication adherence (when doses exist), and a trailing-week strip.
 * No blended metric, no character or mental-health inference, no
 * causal claims — counts only. Empty state is honest when the trailing
 * window holds no tracked actions, with paths to the screens that create
 * the data (daily check-in, medications).
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
import { useDisciplineEngine } from '@/hooks/useDisciplineEngine';

function stripDays(today: string): string[] {
  const days: string[] = [];
  const d = new Date(`${today}T12:00:00`);
  for (let i = 6; i >= 0; i--) {
    const c = new Date(d);
    c.setDate(c.getDate() - i);
    const y = c.getFullYear();
    const m = String(c.getMonth() + 1).padStart(2, '0');
    const day = String(c.getDate()).padStart(2, '0');
    days.push(`${y}-${m}-${day}`);
  }
  return days;
}

export default function DisciplineEngineScreen() {
  const navigation = useNavigation();
  const { model, isLoading } = useDisciplineEngine();

  const go = useCallback(
    (route: string) => {
      const nav = navigation as unknown as {
        navigate: (r: string) => void;
      };
      nav.navigate(route);
    },
    [navigation],
  );

  const activeSet = new Set(model.activeDates);
  const week = model.today ? stripDays(model.today) : [];

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
        <Text style={styles.overline}>Discipline engine · From your tracked actions</Text>
        <Text style={styles.title}>Discipline</Text>
        <Text style={styles.sub}>
          What health-related actions have you actually been doing?
        </Text>

        {isLoading ? (
          <>
            <Text style={styles.loading}>Loading…</Text>
            <HealthFact style={styles.fact} />
          </>
        ) : !model.hasAnyActivity ? (
          <EmptyState
            icon="📋"
            title="No tracked actions yet"
            message="Log a daily check-in, record a dose, or track anything else you follow. Active days, streaks and adherence appear here. Only from real entries."
          />
        ) : (
          <>
            <SectionHeader title="Active days" />
            <Card>
              <Text style={styles.bigValue}>
                {`${model.activeDays7} of 7 days`}
              </Text>
              <Text style={styles.change}>{model.changeLine}</Text>
              <Text style={styles.provenance}>
                Days with at least one tracked action (check-ins, doses, entries, measurements).
              </Text>
            </Card>

            <SectionHeader title="Streak" />
            <Card>
              <Text style={styles.bigValue}>
                {model.streakDays === 1 ? '1 day' : `${model.streakDays} days`}
              </Text>
              <Text style={styles.provenance}>
                Consecutive active days through today. A day without a tracked action ends the streak.
              </Text>
            </Card>

            {model.adherence ? (
              <>
                <SectionHeader title="Medication adherence" />
                <Card>
                  <Text style={styles.bigValue}>{`${model.adherence.percent}%`}</Text>
                  <Text style={styles.provenance}>
                    {`${model.adherence.taken} of ${model.adherence.total} recorded doses taken (trailing 14 days). Skipped and missed doses count against; late entries are excluded.`}
                  </Text>
                </Card>
              </>
            ) : null}

            <SectionHeader title="This week" />
            <Card>
              <View style={styles.strip}>
                {week.map((date) => (
                  <View key={date} style={styles.cell}>
                    <View style={[styles.dot, activeSet.has(date) ? styles.dotOn : styles.dotOff]} />
                    <Text style={styles.cellDay}>{date.slice(8)}</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.weekTotal}>
                {`${model.loggedDays7} ${model.loggedDays7 === 1 ? 'check-in day' : 'check-in days'} this week.`}
              </Text>
            </Card>
          </>
        )}

        <Button title="Log a check-in" onPress={() => go('DailyLog')} fullWidth />
        <Button title="Open medications" variant="ghost" onPress={() => go('Medications')} fullWidth />
        <Text style={styles.disclaimer}>
          Counts from records on this device. Tracking only — not medical advice, diagnosis, or treatment.
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
  bigValue: { ...TYPE.display, fontSize: 32, color: GV.ink, textAlign: 'center', fontVariant: ['tabular-nums'] },
  change: { ...TYPE.body, color: GV.body, textAlign: 'center', marginTop: 8, fontVariant: ['tabular-nums'] },
  provenance: { ...TYPE.caption, color: GV.muted, textAlign: 'center', marginTop: 4 },
  strip: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  cell: { alignItems: 'center', gap: 6, minWidth: 32 },
  dot: { width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  dotOn: { backgroundColor: TILE_TONES.discipline[1] },
  dotOff: { borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.25)' },
  cellDay: { ...TYPE.caption, fontSize: 12, color: GV.fog, fontVariant: ['tabular-nums'] },
  weekTotal: { ...TYPE.caption, color: GV.muted, textAlign: 'center', marginTop: 8 },
  disclaimer: { ...TYPE.caption, color: GV.fog, textAlign: 'center' },
});
