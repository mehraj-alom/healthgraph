/**
 * MomentumStep — onboarding step 3: the 7-day momentum strip.
 *
 * Rendered strictly from useMomentumWeek (real local rows only). New users
 * see the legitimate empty state — nothing is fabricated to fill the week.
 */

import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { EmptyState } from '@/components';
import { Reveal } from '@/components/home/Reveal';
import { FONT, GV, TYPE } from '@/theme/guava';
import { useMomentumWeek } from '@/hooks/useMomentumWeek';
import { momentumActiveDays } from './momentum';

function DayCell({
  weekday,
  active,
  isToday,
  heartRate,
  showGuide,
}: {
  weekday: string;
  active: boolean;
  isToday: boolean;
  heartRate: number | null;
  showGuide: boolean;
}) {
  return (
    <View style={styles.cell} accessibilityRole="text" accessibilityLabel={`${weekday}${active ? ', active' : ''}`}>
      <View
        style={[
          styles.dot,
          active ? styles.dotActive : styles.dotIdle,
          isToday && styles.dotToday,
        ]}
      />
      <Text style={[styles.weekday, active && styles.weekdayActive]}>{weekday}</Text>
      {heartRate !== null ? (
        <Text style={styles.hr}>{heartRate}</Text>
      ) : showGuide ? (
        <Text style={styles.hrIdle}>·</Text>
      ) : null}
    </View>
  );
}

export function MomentumStep() {
  const { days, isEmpty, activeDays, isLoading } = useMomentumWeek();
  const count = momentumActiveDays(days);

  return (
    <View style={styles.wrap}>
      <Reveal>
        <Text style={styles.overline}>Step 3 of 3 · Momentum</Text>
      </Reveal>
      <Reveal>
        <Text style={styles.headline}>Your week</Text>
      </Reveal>
      {isLoading ? (
        <ActivityIndicator color={GV.teal} style={styles.loader} />
      ) : isEmpty ? (
        <EmptyState
          icon="🌱"
          title="No activity yet"
          message="Log a day, scan pulse, or record a dose. The strip shows real activity only."
        />
      ) : (
        <>
          <Reveal>
            <Text style={styles.sub}>
              {count === 7
                ? '7 of 7 days active.'
                : `${activeDays} of 7 days active.`}
            </Text>
          </Reveal>
          <View style={styles.strip} accessibilityRole="list">
            {days.map((day, i) => (
              <DayCell
                key={day.date}
                weekday={day.weekday}
                active={day.active}
                isToday={i === days.length - 1}
                heartRate={day.heartRate}
                showGuide
              />
            ))}
          </View>
          <Text style={styles.legend}>
            Filled days carry a real log, pulse reading or dose.
          </Text>
        </>
      )}
    </View>
  );
}

const DOT = 16;

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    gap: 12,
    paddingTop: 8,
  },
  overline: {
    fontFamily: FONT.semi,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 3,
    color: GV.teal,
    textAlign: 'center',
  },
  headline: {
    fontFamily: FONT.semi,
    fontSize: 32,
    lineHeight: 38,
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  sub: {
    ...TYPE.body,
    color: GV.fog,
    textAlign: 'center',
    alignSelf: 'center',
  },
  loader: {
    marginTop: 32,
  },
  strip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 20,
    paddingVertical: 16,
    paddingHorizontal: 12,
    marginTop: 8,
  },
  cell: {
    alignItems: 'center',
    gap: 6,
    minWidth: 32,
  },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
  },
  dotActive: {
    backgroundColor: '#7CF5D3',
    shadowColor: '#7CF5D3',
    shadowOpacity: 0.8,
    shadowRadius: 8,
    elevation: 4,
  },
  dotIdle: {
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  dotToday: {
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  weekday: {
    fontFamily: FONT.semi,
    fontSize: 12,
    lineHeight: 16,
    color: GV.fog,
  },
  weekdayActive: {
    color: '#FFFFFF',
  },
  hr: {
    fontFamily: FONT.semi,
    fontSize: 11,
    lineHeight: 14,
    color: GV.teal,
    fontVariant: ['tabular-nums'],
  },
  hrIdle: {
    fontSize: 11,
    lineHeight: 14,
    color: 'rgba(255, 255, 255, 0.25)',
  },
  legend: {
    ...TYPE.caption,
    color: GV.fog,
    textAlign: 'center',
  },
});
