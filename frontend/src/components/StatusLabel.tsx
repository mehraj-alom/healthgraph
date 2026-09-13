import { StyleSheet, View, Text } from 'react-native';
import { useTheme } from '@/theme';
import { spacing } from '@/theme/tokens';

export type HealthStatus = 'positive' | 'neutral' | 'attention';

interface StatusLabelProps {
  label: string;
  status?: HealthStatus;
  /** Icon glyph, defaults to a status glyph shared across tones. */
  icon?: string;
  /** Emphasized variant for hero/card headers. */
  featured?: boolean;
}

const STATUS_GLYPH: Record<HealthStatus, string> = {
  positive: '●',
  neutral: '●',
  attention: '!',
};

/**
 * Health status label — a calm, non-clinical chip that always carries text so
 * meaning is never conveyed by color alone.
 */
export function StatusLabel({ label, status = 'neutral', icon, featured = false }: StatusLabelProps) {
  const { colors, typography } = useTheme();

  const color = {
    positive: colors.healthPositive,
    neutral: colors.healthNeutral,
    attention: colors.healthAttention,
  }[status];

  const surface = {
    positive: colors.healthPositiveSurface,
    neutral: colors.healthNeutralSurface,
    attention: colors.healthAttentionSurface,
  }[status];

  return (
    <View
      accessible
      accessibilityLabel={label}
      style={[
        styles.container,
        { backgroundColor: surface },
        featured && styles.featured,
      ]}
    >
      <Text
        style={[
          styles.glyph,
          { color },
          typography.overline,
        ]}
      >
        {icon ?? STATUS_GLYPH[status]}
      </Text>
      <Text style={[styles.label, typography.captionStrong, { color }, featured && styles.featuredText]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs + 2,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 3,
    borderRadius: 9999,
  },
  featured: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 1,
  },
  glyph: {
    fontSize: 9,
    letterSpacing: 0,
  },
  label: {
    fontSize: 11,
    letterSpacing: 0.2,
  },
  featuredText: {
    fontSize: 12,
  },
});