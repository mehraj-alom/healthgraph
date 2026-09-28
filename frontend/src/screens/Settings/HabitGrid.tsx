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
import { Card } from '@/components';
import { HealthFact } from '@/components/HealthFact';
import { GV, TYPE } from '@/theme/guava';
import type { HabitCell } from '@/screens/Settings/habitTracker';

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
    <Card
      style={{
        backgroundColor: '#2A3049',
        borderColor: 'rgba(255, 255, 255, 0.12)',
        borderWidth: 1,
        borderRadius: 8,
      }}
    >
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
    </Card>
  );
}

const styles = StyleSheet.create({
  loading: { ...TYPE.body, color: GV.fog, textAlign: 'center', paddingVertical: 16 },
  fact: { ...TYPE.caption, color: GV.fog, textAlign: 'center' },
  summary: { ...TYPE.button, fontSize: 15, color: '#FFFFFF', fontVariant: ['tabular-nums'] },
  provenance: { ...TYPE.caption, color: GV.fog, marginTop: 2, marginBottom: 12 },
  gridRow: { flexDirection: 'row', gap: 6 },
  dayLabels: { gap: GAP, paddingTop: 1 },
  dayLabel: { fontSize: 9, lineHeight: CELL, color: GV.fog, width: 10, textAlign: 'center' },
  weeks: { flex: 1, flexDirection: 'row', justifyContent: 'space-between' },
  week: { gap: GAP },
  cell: { width: CELL, height: CELL, borderRadius: 3 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 10, justifyContent: 'flex-end' },
  legendCell: { width: CELL, height: CELL, borderRadius: 3 },
  legendText: { ...TYPE.caption, color: GV.fog, marginHorizontal: 2 },
});

export default HabitGrid;
