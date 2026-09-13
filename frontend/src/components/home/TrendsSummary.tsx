/**
 * TrendsSummary — compact "This month in your health" grid for Home.
 *
 * Renders backend /trends data directly. No local computation, no trend
 * engine — just a restrained surface showing what the server returned.
 * If logged_days === 0, shows a calm placeholder.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { spacing, radius } from '@/theme/tokens';
import { TrendIndicator } from '@/components/TrendIndicator';
import { SectionHeader } from '@/components/SectionHeader';
import { Skeleton } from '@/components/Skeleton';
import { formatSleepMinutes, formatScale } from '@/screens/Dashboard/homeData';
import type { TrendsResponse } from '@/types';

type BackendDirection = TrendsResponse['wellbeing_trend']['direction'];

function toArrow(dir: BackendDirection): 'up' | 'down' | 'flat' {
  if (dir === 'improving') return 'up';
  if (dir === 'declining') return 'down';
  return 'flat';
}

function toTone(dir: BackendDirection): 'positive' | 'attention' | 'neutral' {
  if (dir === 'improving') return 'positive';
  if (dir === 'declining') return 'attention';
  return 'neutral';
}

interface StatTileProps {
  label: string;
  value: string;
  trend?: { direction: BackendDirection; label: string };
  color: string;
}

function StatTile({ label, value, trend, color }: StatTileProps) {
  const { colors, typography } = useTheme();

  return (
    <View style={[statStyles.tile, { backgroundColor: colors.surfaceSecondary }]}>
      <Text
        style={[typography.caption, { color: colors.textSecondary, marginBottom: 4 }]}
        numberOfLines={1}
      >
        {label}
      </Text>
      <Text style={[typography.bodyStrong, { color }]} numberOfLines={1}>
        {value}
      </Text>
      {trend && trend.direction !== 'insufficient_data' ? (
        <View style={{ marginTop: 4 }}>
          <TrendIndicator
            direction={toArrow(trend.direction)}
            tone={toTone(trend.direction)}
            text={trend.label}
          />
        </View>
      ) : null}
    </View>
  );
}

const statStyles = StyleSheet.create({
  tile: {
    flex: 1,
    minWidth: '45%',
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: 2,
  },
});

interface TrendsSummaryProps {
  data: TrendsResponse | null;
  isLoading?: boolean;
}

export function TrendsSummary({ data, isLoading }: TrendsSummaryProps) {
  const { colors, typography } = useTheme();

  if (!data || data.logged_days === 0) {
    if (isLoading) {
      return (
        <View style={trendStyles.section}>
          <SectionHeader title="This month in your health" />
          <Skeleton width="100%" height={64} style={{ borderRadius: radius.xl, marginTop: spacing.xs }} />
        </View>
      );
    }
    return (
      <View style={trendStyles.empty}>
        <SectionHeader title="This month in your health" />
        <View style={[trendStyles.emptyCard, { backgroundColor: colors.surfaceSecondary, borderRadius: radius.xl }]}>
          <Text style={[typography.bodySecondary, { color: colors.textSecondary, textAlign: 'center' }]}>
            Log a few days to start seeing trends here.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={trendStyles.section}>
      <SectionHeader
        title="This month in your health"
        subtitle={`${data.logged_days} of ${data.period_days} days logged`}
      />

      <View style={trendStyles.grid}>
        <StatTile
          label="Avg wellbeing"
          value={formatScale(data.avg_wellbeing)}
          trend={data.wellbeing_trend}
          color={colors.textPrimary}
        />
        <StatTile
          label="Avg sleep"
          value={formatSleepMinutes(data.avg_sleep_minutes)}
          trend={data.sleep_trend}
          color={colors.textPrimary}
        />
        <StatTile
          label="Avg energy"
          value={formatScale(data.avg_energy)}
          color={colors.textPrimary}
        />
        <StatTile
          label="Avg stress"
          value={data.avg_stress != null ? `${Math.round(data.avg_stress * 10) / 10}/5` : '—'}
          color={colors.textPrimary}
        />
      </View>

      {data.insights.length > 0 ? (
        <View style={trendStyles.insights}>
          {data.insights.slice(0, 2).map((ins, i) => (
            <View
              key={i}
              style={[trendStyles.insightRow, { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md }]}
            >
              <Text style={[typography.caption, { color: colors.textSecondary }]} numberOfLines={2}>
                {ins.text}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const trendStyles = StyleSheet.create({
  section: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  empty: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  emptyCard: {
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  insights: {
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  insightRow: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
});