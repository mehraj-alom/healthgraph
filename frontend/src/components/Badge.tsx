import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { COLORS, SPACING, BORDER_RADIUS, TYPOGRAPHY } from '@/constants';

interface BadgeProps {
  label: string;
  /** tone drives the restrained accent fill */
  tone?: 'default' | 'blue' | 'purple' | 'gold' | 'green' | 'red' | 'neutral';
  dot?: boolean;
  style?: ViewStyle;
}

const TONES = {
  default: { fg: COLORS.textSecondary, bg: 'rgba(255,255,255,0.05)', dot: COLORS.textMuted },
  blue: { fg: COLORS.accentBlue, bg: COLORS.accentBlueSoft, dot: COLORS.accentBlue },
  purple: { fg: COLORS.accentPurple, bg: COLORS.accentPurpleSoft, dot: COLORS.accentPurple },
  gold: { fg: COLORS.accentGold, bg: COLORS.accentGoldSoft, dot: COLORS.accentGold },
  green: { fg: COLORS.success, bg: COLORS.successBg, dot: COLORS.success },
  red: { fg: COLORS.error, bg: COLORS.errorBg, dot: COLORS.error },
  neutral: { fg: COLORS.textMuted, bg: 'rgba(255,255,255,0.03)', dot: COLORS.textDisabled },
} as const;

/** MedGraph status badge — small muted pill with restrained accent fill. */
export const Badge = ({
  label,
  tone = 'default',
  dot = false,
  style,
}: BadgeProps) => {
  const t = TONES[tone] ?? TONES.default;
  return (
    <View style={[styles.container, { backgroundColor: t.bg }, style]}>
      {dot ? <View style={[styles.dot, { backgroundColor: t.dot }]} /> : null}
      <Text style={[styles.label, { color: t.fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs + 2,
    paddingHorizontal: SPACING.sm + 2,
    paddingVertical: 3,
    borderRadius: BORDER_RADIUS.pill,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  label: {
    ...TYPOGRAPHY.captionStrong,
    fontSize: 11,
  },
});
