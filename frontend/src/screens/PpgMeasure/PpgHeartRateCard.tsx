/**
 * PpgHeartRateCard — dashboard entry point for fingertip heart-rate.
 *
 * Shows the most recent ON-DEVICE camera-PPG measurement (real stored data
 * only — never invented) or an empty state, and navigates to the
 * measurement screen. Guava-flat white card, Poppins numerals.
 * No medical claims.
 */

import React, { useCallback, useState } from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { useFocusEffect, useNavigation, type CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { getRecentPpgMeasurements } from '@/db/queries/ppg';
import { getCachedPatientId } from '@/services/patientIdentity';
import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
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
      <Pressable
        onPress={goToMeasure}
        accessibilityRole="button"
        accessibilityLabel={recent ? `Heart rate, ${recent.bpm} beats per minute. Measure again.` : 'Heart rate. No recent measurement. Measure now.'}
        style={({ pressed }) => [
          styles.card,
          pressed && { opacity: 0.92, transform: [{ scale: 0.985 }] },
        ]}
      >
        <View style={styles.top}>
          <View style={styles.eyebrowRow}>
            <View
              accessible
              accessibilityRole="image"
              accessibilityLabel="Heart rate icon"
              style={styles.iconTile}
            >
              <Text style={styles.iconGlyph}>♥</Text>
            </View>
            <Text style={styles.eyebrow}>Heart rate</Text>
          </View>
          <Text style={styles.cta}>Measure →</Text>
        </View>
        <Text style={styles.value} numberOfLines={1}>
          {recent ? `${recent.bpm} BPM` : 'No recent measurement'}
        </Text>
        <Text style={styles.sub} numberOfLines={1} accessibilityLabel={label}>
          {recent ? `${relativeTime(recent.measuredAt)} · fingertip camera` : 'Fingertip camera · about a minute'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: SPACE.screenH,
    paddingTop: 8,
  },
  card: {
    backgroundColor: GV.card,
    borderRadius: SPACE.rCard,
    padding: SPACE.cardPad,
    gap: 8,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconTile: {
    width: 32,
    height: 32,
    borderRadius: 12,
    backgroundColor: GV.wash,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconGlyph: {
    fontFamily: FONT.semi,
    fontSize: 16,
    lineHeight: 20,
    color: GV.fx.pink,
  },
  eyebrow: {
    ...TYPE.caption,
    color: GV.muted,
    letterSpacing: 1.1,
  },
  cta: {
    ...TYPE.button,
    fontSize: 14,
    color: GV.cta,
  },
  value: {
    fontFamily: FONT.semi,
    fontSize: 24,
    lineHeight: 30,
    letterSpacing: -0.3,
    color: GV.ink,
    fontVariant: ['tabular-nums'],
  },
  sub: {
    ...TYPE.caption,
    color: GV.muted,
  },
});
