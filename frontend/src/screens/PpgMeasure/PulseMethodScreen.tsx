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
import { Badge, Button, Card } from '@/components';
import { getCachedPatientId } from '@/services/patientIdentity';
import { getRecentPpgMeasurements } from '@/db/queries/ppg';
import { getRecentRppgMeasurements } from '@/db/queries/rppg';
import { useTheme } from '@/theme';
import { spacing, radius } from '@/theme/tokens';
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

export default function PulseMethodScreen() {
  const navigation = useNavigation<Nav>();
  const { colors, typography } = useTheme();
  const [recentPpg, setRecentPpg] = useState<RecentRow | null>(null);
  const [recentRppg, setRecentRppg] = useState<RecentRow | null>(null);

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
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[typography.heading, { color: colors.textPrimary }]}>
          Pulse
        </Text>
        <Text style={[typography.bodySecondary, { color: colors.textSecondary }]}>
          Choose how to measure. Both run entirely on this device.
        </Text>

        <Card
          onPress={goFingertip}
          accessibilityLabel="Measure with fingertip PPG"
          style={styles.card}
        >
          <View style={styles.row}>
            <View style={styles.texts}>
              <Text style={[typography.sectionHeading, { color: colors.textPrimary }]}>
                Fingertip PPG
              </Text>
              <Text style={[typography.bodySecondary, { color: colors.textSecondary }]}>
                Camera + flash on your fingertip · about a minute
              </Text>
              <Text style={[typography.captionStrong, { color: colors.textSecondary }]}>
                {recentPpg
                  ? `${recentPpg.bpm} BPM · ${relativeTime(recentPpg.measuredAt)} · ${qualityLabel(recentPpg.quality)}`
                  : 'No recent fingertip measurement'}
              </Text>
            </View>
            <Badge label="Fingertip" tone="blue" />
          </View>
        </Card>

        <Card
          onPress={goFace}
          accessibilityLabel="Measure with face scan"
          style={styles.card}
        >
          <View style={styles.row}>
            <View style={styles.texts}>
              <Text style={[typography.sectionHeading, { color: colors.textPrimary }]}>
                Face rPPG
              </Text>
              <Text style={[typography.bodySecondary, { color: colors.textSecondary }]}>
                Front-camera face scan · a few seconds
              </Text>
              <Text style={[typography.captionStrong, { color: colors.textSecondary }]}>
                {recentRppg
                  ? `${recentRppg.bpm} BPM · ${relativeTime(recentRppg.measuredAt)} · ${qualityLabel(recentRppg.quality)}`
                  : 'No recent face measurement'}
              </Text>
            </View>
            <Badge label="Face scan" tone="purple" />
          </View>
        </Card>

        <Button title="Measure with fingertip" onPress={goFingertip} fullWidth />
        <View style={styles.gap} />
        <Button title="Measure with face scan" onPress={goFace} variant="secondary" fullWidth />

        <Text style={[styles.disclaimer, typography.caption, { color: colors.textSecondary }]}>
          Wellness measurements only. Not a medical device — not for diagnosis or treatment.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.md },
  card: { borderRadius: radius.lg },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  texts: { flex: 1, gap: spacing.xs },
  gap: { height: spacing.sm },
  disclaimer: { marginTop: spacing.md },
});
