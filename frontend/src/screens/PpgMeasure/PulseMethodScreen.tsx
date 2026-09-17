/**
 * PulseMethodScreen — the single Pulse entry point (red button tab).
 *
 * One HealthGraph Pulse feature, two measurement methods:
 * - Fingertip PPG → the existing validated flow (untouched).
 * - Face rPPG → the new on-device PhysFormer flow.
 *
 * Also shows the latest real measurement per method (time + HR + quality)
 * with source badges, so the two modalities are never confused.
 */

import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useFocusEffect,
  useNavigation,
  type CompositeNavigationProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { Button, Card } from '@/components';
import { useHideTabBarOnScroll } from '@/components/tabBarVisibility';
import { getCachedPatientId } from '@/services/patientIdentity';
import { getRecentPpgMeasurements } from '@/db/queries/ppg';
import { getRecentRppgMeasurements } from '@/db/queries/rppg';
import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
import type { MainTabParamList, RootStackParamList } from '@/types';

type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'PpgMeasure'>,
  NativeStackNavigationProp<RootStackParamList>
>;

interface RecentRow {
  bpm: number;
  measuredAt: string;
  quality: number;
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function qualityLabel(quality: number): string {
  if (quality >= 0.75) return 'Good';
  if (quality >= 0.5) return 'Fair';
  return 'Poor';
}

/** Flat icon tile — wash fill, single CTA-green glyph. Icons only. */
function MethodIcon({ glyph, label }: { glyph: string; label: string }) {
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      style={styles.iconTile}
    >
      <Text style={styles.iconGlyph}>{glyph}</Text>
    </View>
  );
}

/** Flat source pill — wash fill, ink label. No colored fills. */
function SourcePill({ label }: { label: string }) {
  return (
    <View style={styles.sourcePill}>
      <Text style={styles.sourcePillText}>{label}</Text>
    </View>
  );
}

export default function PulseMethodScreen() {
  const navigation = useNavigation<Nav>();
  const [recentPpg, setRecentPpg] = useState<RecentRow | null>(null);
  const [recentRppg, setRecentRppg] = useState<RecentRow | null>(null);
  // Side tabs hide on scroll down, return on scroll up (pulse tab stays).
  const onTabScroll = useHideTabBarOnScroll();

  const load = useCallback(async () => {
    try {
      const patientId = getCachedPatientId();
      if (!patientId) {
        setRecentPpg(null);
        setRecentRppg(null);
        return;
      }
      const [ppgRows, rppgRows] = await Promise.all([
        getRecentPpgMeasurements(patientId, 1),
        getRecentRppgMeasurements(patientId, 1),
      ]);
      const ppg = ppgRows[0];
      setRecentPpg(
        ppg?.heart_rate_bpm != null
          ? {
              bpm: Math.round(ppg.heart_rate_bpm),
              measuredAt: ppg.measured_at,
              quality: ppg.signal_quality,
            }
          : null,
      );
      const rppg = rppgRows[0];
      setRecentRppg(
        rppg?.heart_rate_bpm != null
          ? {
              bpm: Math.round(rppg.heart_rate_bpm),
              measuredAt: rppg.measured_at,
              quality: rppg.signal_quality,
            }
          : null,
      );
    } catch {
      setRecentPpg(null);
      setRecentRppg(null);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const goFingertip = useCallback(
    () => navigation.navigate('PpgMeasureFlow'),
    [navigation],
  );
  const goFace = useCallback(
    () => navigation.navigate('RppgMeasure'),
    [navigation],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        onScroll={onTabScroll}
        scrollEventThrottle={16}
      >
        <Text style={styles.title}>Pulse</Text>
        <Text style={styles.subtitle}>
          Choose how to measure. Both run entirely on this device.
        </Text>

        <Card
          onPress={goFingertip}
          accessibilityLabel="Measure with fingertip PPG"
          style={styles.card}
        >
          <View style={styles.row}>
            <MethodIcon glyph="♥" label="Fingertip pulse icon" />
            <View style={styles.texts}>
              <Text style={styles.cardTitle}>Fingertip PPG</Text>
              <Text style={styles.cardBody}>
                Camera + flash on your fingertip · about a minute
              </Text>
              {recentPpg ? (
                <Text style={styles.recent}>
                  <Text style={styles.recentBpm}>{recentPpg.bpm} BPM</Text>
                  <Text>
                    {' · '}
                    {relativeTime(recentPpg.measuredAt)}
                    {' · '}
                    {qualityLabel(recentPpg.quality)}
                  </Text>
                </Text>
              ) : (
                <Text style={styles.recent}>
                  No recent fingertip measurement
                </Text>
              )}
            </View>
            <SourcePill label="Fingertip" />
          </View>
        </Card>

        <Card
          onPress={goFace}
          accessibilityLabel="Measure with face scan"
          style={styles.card}
        >
          <View style={styles.row}>
            <MethodIcon glyph="◉" label="Face scan icon" />
            <View style={styles.texts}>
              <Text style={styles.cardTitle}>Face rPPG</Text>
              <Text style={styles.cardBody}>
                Front-camera face scan · a few seconds
              </Text>
              {recentRppg ? (
                <Text style={styles.recent}>
                  <Text style={styles.recentBpm}>{recentRppg.bpm} BPM</Text>
                  <Text>
                    {' · '}
                    {relativeTime(recentRppg.measuredAt)}
                    {' · '}
                    {qualityLabel(recentRppg.quality)}
                  </Text>
                </Text>
              ) : (
                <Text style={styles.recent}>No recent face measurement</Text>
              )}
            </View>
            <SourcePill label="Face scan" />
          </View>
        </Card>

        <Button title="Measure with fingertip" onPress={goFingertip} fullWidth />
        <Button title="Measure with face scan" onPress={goFace} variant="secondary" fullWidth />

        <Text style={styles.disclaimer}>
          Wellness measurements only. Not a medical device — not for diagnosis or treatment.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: GV.stage },
  content: {
    paddingHorizontal: SPACE.screenH,
    paddingBottom: 32,
    gap: SPACE.cardGap,
  },
  title: {
    ...TYPE.display,
    color: GV.card,
    textAlign: 'center',
    marginTop: 8,
  },
  subtitle: {
    ...TYPE.body,
    color: GV.fog,
    textAlign: 'center',
    marginBottom: 8,
  },
  card: {
    padding: SPACE.cardPad,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  texts: { flex: 1, gap: 8 },
  iconTile: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: GV.wash,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconGlyph: {
    fontFamily: FONT.semi,
    fontSize: 24,
    lineHeight: 28,
    color: GV.cta,
  },
  sourcePill: {
    backgroundColor: GV.wash,
    borderRadius: SPACE.rPill,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignSelf: 'flex-start',
  },
  sourcePillText: {
    ...TYPE.chip,
    color: GV.ink,
  },
  cardTitle: {
    ...TYPE.title,
    color: GV.ink,
  },
  cardBody: {
    ...TYPE.body,
    color: GV.body,
  },
  recent: {
    ...TYPE.caption,
    color: GV.muted,
  },
  recentBpm: {
    fontFamily: FONT.semi,
    fontSize: 13,
    lineHeight: 18,
    color: GV.ink,
    fontVariant: ['tabular-nums'],
  },
  disclaimer: {
    ...TYPE.caption,
    color: GV.fog,
    textAlign: 'center',
    marginTop: 8,
  },
});
