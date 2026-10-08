/**
 * HabitGrid — GitHub-style activity grid (Settings > Activity).
 *
 * Sixteen week-columns × Sunday→Saturday cells colored by real tracked
 * actions that day (level 0 = none, never an estimate). Future days
 * render blank. Pure presentational: the hook supplies the weeks.
 * Honors the product copy rules — counts only, no composite numbers,
 * no streak shaming (the streak line states consecutive active days
 * factually).
 */

import { StyleSheet, Text, View } from 'react-native';
import { GlassSurface } from '@/components/home/GlassSurface';
import { HealthFact } from '@/components/HealthFact';
import type { HabitCell } from '@/screens/Settings/habitTracker';

const SECONDARY = 'rgba(233,240,255,0.66)';

const CELL = 11;
const GAP = 3;

// Empty through darkest: GitHub-dark greens. Flat fills, no borders.
const LEVEL_COLORS = ['rgba(255,255,255,0.08)', '#0E4429', '#006D32', '#26A641', '#39D353'] as const;
const FUTURE_COLOR = 'transparent';

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

export function HabitGrid({
  weeks,
  activeDays,
  totalActions,
  streakDays,
  isLoading,
}: {
  weeks: HabitCell[][];
  activeDays: number;
  totalActions: number;
  streakDays: number;
  isLoading: boolean;
}): React.JSX.Element {
  return (
    <GlassSurface noBlur style={styles.card}>
      {isLoading ? (
        <>
          <Text style={styles.loading}>Loading activity…</Text>
          <HealthFact style={styles.fact} />
        </>
      ) : (
        <>
          <Text style={styles.summary}>
            {`${activeDays} ${activeDays === 1 ? 'active day' : 'active days'} · ${totalActions} ${totalActions === 1 ? 'action' : 'actions'} · ${streakDays}-day streak`}
          </Text>
          <View style={styles.gridRow}>
            <View style={styles.dayLabels}>
              {WEEKDAY_LABELS.map((label, i) => (
                <Text key={`${label}-${i}`} style={styles.dayLabel}>
                  {i % 2 === 1 ? label : ' '}
                </Text>
              ))}
            </View>
            <View style={styles.weeks}>
              {weeks.map((days, w) => (
                <View key={days[0]?.date ?? w} style={styles.week}>
                  {days.map((cell) => (
                    <View
                      key={cell.date}
                      accessibilityLabel={`${cell.date}: ${cell.future ? 'upcoming' : `${cell.count} actions`}`}
                      style={[
                        styles.cell,
                        {
                          backgroundColor: cell.future
                            ? FUTURE_COLOR
                            : LEVEL_COLORS[cell.level],
                        },
                      ]}
                    />
                  ))}
                </View>
              ))}
            </View>
          </View>
          <View style={styles.legend}>
            <Text style={styles.legendText}>Less</Text>
            {LEVEL_COLORS.map((color) => (
              <View key={color} style={[styles.legendCell, { backgroundColor: color }]} />
            ))}
            <Text style={styles.legendText}>More</Text>
          </View>
        </>
      )}
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16 },
  loading: {
    fontWeight: '400',
    fontSize: 15,
    lineHeight: 22,
    color: SECONDARY,
    textAlign: 'center',
    paddingVertical: 16,
  },
  fact: {
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: SECONDARY,
    textAlign: 'center',
  },
  summary: {
    fontWeight: '600',
    fontSize: 15,
    lineHeight: 20,
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },
  gridRow: { flexDirection: 'row', gap: 6 },
  dayLabels: { gap: GAP, paddingTop: 1 },
  dayLabel: { fontSize: 9, lineHeight: CELL, color: SECONDARY, width: 10, textAlign: 'center' },
  weeks: { flex: 1, flexDirection: 'row', justifyContent: 'space-between' },
  week: { gap: GAP },
  cell: { width: CELL, height: CELL, borderRadius: 3 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 10, justifyContent: 'flex-end' },
  legendCell: { width: CELL, height: CELL, borderRadius: 3 },
  legendText: {
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: SECONDARY,
    marginHorizontal: 2,
  },
});

export default HabitGrid;
