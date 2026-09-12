import { StyleSheet, View, Text } from 'react-native';
import { useTheme } from '@/theme';
import { spacing } from '@/theme/tokens';

export type TrendDirection = 'up' | 'down' | 'flat';

interface TrendIndicatorProps {
  direction: TrendDirection;
  /** Semantic reading: 'positive' | 'attention' | 'neutral' | 'auto' */
  tone?: 'positive' | 'attention' | 'neutral' | 'auto';
  /** Accessible text (recommended) or numeric change, e.g. "+12%" */
  text?: string;
  label?: string;
}

const GLYPH: Record<TrendDirection, string> = {
  up: '▲',
  down: '▼',
  flat: '—',
};

/**
 * Trend indicator — direction arrow + short text.
 * Color is decorative BY DEFAULT (auto maps up→positive, down→attention),
 * so an explicit accessible `text` should always be provided.
 */
export function TrendIndicator({
  direction,
  tone = 'auto',
  text,
  label,
}: TrendIndicatorProps) {
  const { colors, typography } = useTheme();

  const color =
    tone === 'positive'
      ? colors.healthPositive
      : tone === 'attention'
        ? colors.healthAttention
        : tone === 'neutral'
          ? colors.textSecondary
          : direction === 'up'
            ? colors.healthPositive
            : direction === 'down'
              ? colors.healthAttention
              : colors.textSecondary;

  const bubble = {
    up: colors.healthPositiveSurface,
    down: colors.healthAttentionSurface,
    flat: 'rgba(128, 140, 150, 0.12)',
  }[direction];

  return (
    <View
      accessible
      accessibilityLabel={label}
      style={[styles.container, { backgroundColor: bubble }]}
    >
      <Text style={[styles.glyph, { color }]}>{GLYPH[direction]}</Text>
      {text ? (
        <Text style={[styles.text, typography.captionStrong, { color }]}>{text}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: 9999,
  },
  glyph: {
    fontSize: 9,
  },
  text: {
    fontSize: 12,
  },
});