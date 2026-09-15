import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';
import { spacing } from '@/theme/tokens';

interface BadgeProps {
  label: string;
  /** tone drives the restrained accent fill */
  tone?: 'default' | 'blue' | 'purple' | 'gold' | 'green' | 'red' | 'neutral';
  /** Semantic health tone (takes priority for health-coded badges). */
  health?: 'positive' | 'neutral' | 'attention';
  dot?: boolean;
  style?: ViewStyle;
}

/** HealthGraph status badge — small muted pill with restrained accent fill. */
export const Badge = ({
  label,
  tone = 'default',
  health,
  dot = false,
  style,
}: BadgeProps) => {
  const { colors, typography } = useTheme();

  const toneMap = {
    default: { fg: colors.textSecondary, bg: colors.surfaceSecondary, dot: colors.textMuted },
    blue: { fg: '#2D5F86', bg: '#D9EAF7', dot: '#4A90C2' },
    purple: { fg: colors.accentPurple, bg: colors.accentPurpleSoft, dot: colors.accentPurple },
    gold: { fg: colors.tealDark, bg: colors.tealSurface, dot: colors.teal },
    green: { fg: colors.success, bg: colors.successSurface, dot: colors.success },
    red: { fg: colors.error, bg: colors.errorSurface, dot: colors.error },
    neutral: { fg: colors.textMuted, bg: colors.surfaceSecondary, dot: colors.textDisabled },
  } as const;

  const healthMap = {
    positive: { fg: colors.healthPositive, bg: colors.healthPositiveSurface, dot: colors.healthPositive },
    neutral: { fg: colors.healthNeutral, bg: colors.healthNeutralSurface, dot: colors.healthNeutral },
    attention: { fg: colors.healthAttention, bg: colors.healthAttentionSurface, dot: colors.healthAttention },
  } as const;

  const t = health ? healthMap[health] : toneMap[tone] ?? toneMap.default;

  return (
    <View style={[styles.container, { backgroundColor: t.bg }, style]}>
      {dot ? <View style={[styles.dot, { backgroundColor: t.dot }]} /> : null}
      <Text style={[styles.label, { color: t.fg }, typography.captionStrong]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 9999,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  label: {
    fontSize: 11,
  },
});