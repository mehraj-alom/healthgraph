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
import { shiftDayKey } from '@/utils/dayKey';
import { useDisciplineEngine } from '@/hooks/useDisciplineEngine';
import { DISCIPLINE_HISTORY_DAYS } from '@/screens/DisciplineEngine/disciplineEngine';

const SECONDARY = 'rgba(233,240,255,0.66)';
const TERTIARY = 'rgba(233,240,255,0.45)';

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
  // Binary activity series over the trailing window — real active days only.
  const activityPoints = model.today
    ? Array.from({ length: DISCIPLINE_HISTORY_DAYS }, (_, k) => {
        const date = shiftDayKey(model.today, -(DISCIPLINE_HISTORY_DAYS - 1 - k));
        return { date, value: activeSet.has(date) ? 1 : 0 };
      }).filter((p) => p.date !== '')
    : [];

  return (
    <View style={styles.root}>
      <HomeStageBackdrop />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>Discipline</Text>
          <Text style={styles.sub}>Tracked actions only.</Text>

          {isLoading ? (
            <View style={styles.center}>
              <Text style={styles.loading}>Loading…</Text>
            </View>
          ) : !model.hasAnyActivity ? (
            <EmptyState
              title="No tracked actions yet"
              message="Log a check-in or record a dose to begin."
            />
          ) : (
            <>
              <Text style={styles.sectionTitle}>Active days</Text>
              <GlassSurface strong style={styles.card}>
                <Text style={styles.bigValue}>
                  {`${model.activeDays7} of 7 days`}
                </Text>
                <Text style={styles.change}>{model.changeLine}</Text>
                <Text style={styles.provenance}>
                  Days with a tracked action.
                </Text>
              </GlassSurface>

              <Text style={styles.sectionTitle}>Streak</Text>
              <GlassSurface strong style={styles.card}>
                <Text style={styles.bigValue}>
                  {model.streakDays === 1 ? '1 day' : `${model.streakDays} days`}
                </Text>
                <Text style={styles.provenance}>
                  Consecutive active days through today.
                </Text>
              </GlassSurface>

              {model.adherence ? (
                <>
                  <Text style={styles.sectionTitle}>Medication adherence</Text>
                  <GlassSurface strong style={styles.card}>
                    <Text style={styles.bigValue}>{`${model.adherence.percent}%`}</Text>
                    <Text style={styles.provenance}>
                      {`${model.adherence.taken} of ${model.adherence.total} recorded doses taken (14 days).`}
                    </Text>
                  </GlassSurface>
                </>
              ) : null}

              <Text style={styles.sectionTitle}>This week</Text>
              <GlassSurface strong style={styles.card}>
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
              </GlassSurface>

              {activityPoints.length > 0 ? (
                <>
                  <Text style={styles.sectionTitle}>Activity</Text>
                  <GlassSurface strong style={styles.card}>
                    <EngineGraph
                      points={activityPoints}
                      tone={TILE_TONES.discipline[1]}
                      decimals={0}
                      domain={[0, 1]}
                      ticks={[0, 1]}
                    />
                    <Text style={styles.avgSub}>
                      {`${activeSet.size} active ${activeSet.size === 1 ? 'day' : 'days'} in ${DISCIPLINE_HISTORY_DAYS} days`}
                    </Text>
                  </GlassSurface>
                </>
              ) : null}
            </>
          )}

          <Button
            title="Log a check-in"
            onPress={() => go('DailyLog')}
            fullWidth
            size="large"
            variant="secondary"
            style={styles.logBtn}
            textStyle={styles.logBtnText}
          />
          <Button
            title="Open medications"
            variant="ghost"
            onPress={() => go('Medications')}
            fullWidth
            textStyle={styles.ghostText}
          />
          <Text style={styles.disclaimer}>
            Counts from records on this device. Tracking only — not medical advice, diagnosis, or treatment.
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
  bigValue: { fontWeight: '600', fontSize: 32, lineHeight: 38, color: '#FFFFFF', textAlign: 'center', fontVariant: ['tabular-nums'] },
  change: { fontWeight: '400', fontSize: 15, lineHeight: 21, color: '#FFFFFF', textAlign: 'center', marginTop: 8, fontVariant: ['tabular-nums'] },
  provenance: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: SECONDARY, textAlign: 'center', marginTop: 4 },
  avgSub: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: SECONDARY, textAlign: 'center', marginTop: 8, fontVariant: ['tabular-nums'] },
  strip: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  cell: { alignItems: 'center', gap: 6, minWidth: 32 },
  dot: { width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  dotOn: { backgroundColor: LG.card.mint },
  dotOff: { borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.25)' },
  cellDay: { fontWeight: '400', fontSize: 12, lineHeight: 16, color: SECONDARY, fontVariant: ['tabular-nums'] },
  weekTotal: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: SECONDARY, textAlign: 'center', marginTop: 8 },
  logBtn: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  logBtnText: { color: '#0B0F1A' },
  ghostText: { color: '#FFFFFF' },
  disclaimer: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: TERTIARY, textAlign: 'center' },
});
