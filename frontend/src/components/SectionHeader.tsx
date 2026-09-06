import { StyleSheet, View, Text, type ViewStyle } from 'react-native';
import { COLORS, SPACING, TYPOGRAPHY } from '@/constants';

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  /** Small colored index dot (maps to category / graph accents) */
  accent?: string;
  right?: React.ReactNode;
  style?: ViewStyle;
}

/** MedGraph section heading — title + optional muted subtitle + accent dot. */
export const SectionHeader = ({
  title,
  subtitle,
  accent,
  right,
  style,
}: SectionHeaderProps) => {
  return (
    <View style={[styles.row, style]}>
      {accent ? (
        <View style={[styles.dot, { backgroundColor: accent }]} />
      ) : null}
      <View style={styles.text}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {right ? <View>{right}</View> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.sm,
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
  title: {
    ...TYPOGRAPHY.h3,
    color: COLORS.textPrimary,
  },
  subtitle: {
    ...TYPOGRAPHY.subtitle,
    color: COLORS.textMuted,
  },
});
