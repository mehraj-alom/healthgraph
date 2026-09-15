/**
 * PpgHeartRateCard — dashboard entry point for fingertip heart-rate.
 *
 * Shows the most recent ON-DEVICE camera-PPG measurement (real stored data
 * only — never invented) or an empty state, and navigates to the
 * measurement screen. Styled with the dashboard Movements+ tokens via the
 * shared LiftCard primitive. No medical claims.
 */

import React, { useCallback, useState } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { useFocusEffect, useNavigation, type CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import LiftCard from '@/components/home/LiftCard';
import { getRecentPpgMeasurements } from '@/db/queries/ppg';
import { getCachedPatientId } from '@/services/patientIdentity';
import { healthIcon } from '@/theme/icons';
import { mv, mvType } from '@/theme/movements';
import type { MainTabParamList, RootStackParamList } from '@/types';

type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'Dashboard'>,
  NativeStackNavigationProp<RootStackParamList>
>;

interface RecentPpg {
  bpm: number;
  measuredAt: string;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(then).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export default function PpgHeartRateCard() {
  const navigation = useNavigation<Nav>();
  const [recent, setRecent] = useState<RecentPpg | null>(null);

  const load = useCallback(async () => {
    try {
      const patientId = getCachedPatientId();
      if (!patientId) {
        setRecent(null);
        return;
      }
      const rows = await getRecentPpgMeasurements(patientId, 1);
      const row = rows[0];
      // Only real measured values — a null BPM (unreliable run) shows the
      // empty state instead of inventing a number.
      if (row?.heart_rate_bpm != null) {
        setRecent({ bpm: Math.round(row.heart_rate_bpm), measuredAt: row.measured_at });
      } else {
        setRecent(null);
      }
    } catch {
      setRecent(null);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const goToMeasure = useCallback(
    () => navigation.navigate('PpgMeasure'),
    [navigation],
  );

  const label = recent ? `${recent.bpm} BPM · ${relativeTime(recent.measuredAt)}` : 'No recent measurement';

  return (
    <View style={styles.section}>
      <LiftCard
        style={styles.card}
        contentContainerStyle={styles.content}
        accessibilityLabel={recent ? `Heart rate, ${recent.bpm} beats per minute. Measure again.` : 'Heart rate. No recent measurement. Measure now.'}
        onPress={goToMeasure}
        pressedBg="rgba(20,20,20,0.06)"
      >
        <View style={styles.top}>
          <Text style={styles.eyebrow}>{healthIcon.heartRate}  HEART RATE</Text>
          <Text style={styles.cta}>Measure  →</Text>
        </View>
        <Text style={styles.value} numberOfLines={1}>
          {recent ? `${recent.bpm} BPM` : 'No recent measurement'}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {recent ? `${relativeTime(recent.measuredAt)} · fingertip camera` : 'Fingertip camera · about a minute'}
        </Text>
        <View style={styles.track} accessible accessibilityLabel={label}>
          <View style={[styles.fill, recent ? null : styles.fillEmpty]} />
        </View>
      </LiftCard>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  card: {
    backgroundColor: mv.surfaceWhite,
    borderRadius: 20,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: 'rgba(20,20,20,0.06)',
    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
  },
  content: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 2,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  eyebrow: {
    ...mvType.pill,
    color: mv.textOnLightSecondary,
    letterSpacing: 1.1,
    fontSize: 10,
    fontWeight: '800',
  },
  cta: {
    ...mvType.pill,
    color: mv.textOnLightPrimary,
    fontSize: 12,
    fontWeight: '800',
  },
  value: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.3,
    lineHeight: 26,
    color: mv.textOnLightPrimary,
    fontVariant: ['tabular-nums'],
  },
  sub: {
    ...mvType.caption,
    color: mv.textOnLightSecondary,
    fontSize: 12,
  },
  track: {
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(20,20,20,0.08)',
    marginTop: 6,
    overflow: 'hidden',
  },
  fill: {
    height: 5,
    borderRadius: 3,
    width: '100%',
    backgroundColor: '#E8862E',
  },
  fillEmpty: {
    width: '12%',
    backgroundColor: 'rgba(20,20,20,0.18)',
  },
});
