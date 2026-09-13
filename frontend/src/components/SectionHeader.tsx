import { StyleSheet, View, Text, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';
import { spacing } from '@/theme/tokens';

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  /** Small colored index dot (maps to category / graph accents). */
  accent?: string;
  right?: React.ReactNode;
  style?: ViewStyle;
}

/** HealthGraph section heading — title + optional muted subtitle + accent dot. */
export const SectionHeader = ({
  title,
  subtitle,
  accent,
  right,
  style,
}: SectionHeaderProps) => {
  const { colors, typography } = useTheme();
  return (
    <View style={[styles.row, style]}>
      {accent ? (
        <View style={[styles.dot, { backgroundColor: accent }]} />
      ) : null}
      <View style={styles.text}>
        <Text style={[styles.title, typography.sectionHeading, { color: colors.textPrimary }]}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.subtitle, typography.bodySecondary, { color: colors.textMuted }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ? <View>{right}</View> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  text: {
    flex: 1,
    gap: 2,
  },
  subtitle: {
    fontSize: 13,
  },
  title: {
    fontSize: 17,
  },
});