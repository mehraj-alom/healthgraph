import { StyleSheet, View, Text } from 'react-native';
import type { ReactNode } from 'react';
import { useTheme } from '@/theme';
import { spacing, radius } from '@/theme/tokens';

interface MetricValueProps {
  value: string | number;
  unit?: string;
  label?: string;
  /**
   * Health range interpretation — drives icon/helper text, never a medical
   * claim. 'positive' | 'neutral' | 'attention' default 'neutral'.
   */
  tone?: 'positive' | 'neutral' | 'attention';
  /** Optional sub-label under the value (e.g. a trend summary). */
  detail?: string;
  size?: 'md' | 'lg';
  testID?: string;
  accessibilityLabel?: string;
}

/**
 * Large metric number — the signature HealthGraph number.
 * Strong visual hierarchy (bold metric + light unit) with an optional
 * health-context tone conveyed by icon + label, not color alone.
 */
export function MetricValue({
  value,
  unit,
  label,
  tone = 'neutral',
  detail,
  size = 'lg',
  testID,
  accessibilityLabel,
}: MetricValueProps) {
  const { colors, typography } = useTheme();

  const toneColor = {
    positive: colors.healthPositive,
    neutral: colors.healthNeutral,
    attention: colors.healthAttention,
  }[tone];

  const toneSurface = {
    positive: colors.healthPositiveSurface,
    neutral: colors.healthNeutralSurface,
    attention: colors.healthAttentionSurface,
  }[tone];

  const metricStyle = size === 'lg' ? typography.metricValue : typography.metricSmall;

  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={accessibilityLabel ?? (unit ? `${value} ${unit}` : `${value}`)}
      style={styles.container}
    >
      {label ? (
        <Text style={[styles.label, typography.label, { color: colors.textSecondary }]}>
          {label}
        </Text>
      ) : null}
      <View style={styles.valueRow}>
        <Text style={[metricStyle, { color: colors.textPrimary, fontVariant: ['tabular-nums'] }]}>
          {value}
        </Text>
        {unit ? (
          <Text style={[styles.unit, typography.metricUnit, { color: colors.textSecondary }]}>
            {unit}
          </Text>
        ) : null}
      </View>
      {detail ? (
        <View style={styles.detailRow}>
          <View style={[styles.toneDot, { backgroundColor: toneColor, borderColor: toneSurface }]} />
          <Text
            style={[styles.detail, typography.caption, { color: colors.textSecondary }]}
            numberOfLines={1}
          >
            {detail}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  label: {
    letterSpacing: 0.4,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.xs,
  },
  unit: {
    marginBottom: 4,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  toneDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    borderWidth: 2,
  },
  detail: {
    letterSpacing: 0.2,
  },
});