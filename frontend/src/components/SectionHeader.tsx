import { StyleSheet, View, Text, type ViewStyle } from 'react-native';
import { spacing } from '@/theme/tokens';
import { GV, TYPE } from '@/theme/guava';
import { MarkerHighlight } from '@/components/MarkerHighlight';

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  /** Small colored index dot (maps to category / graph accents). */
  accent?: string;
  right?: React.ReactNode;
  /** Guava-style centered section titles ("Your tracked factors"). */
  align?: 'left' | 'center';
  style?: ViewStyle;
  /** Sketchpen shade behind the title (default on — the kid-highlight). */
  marked?: boolean;
}

/** Section heading — Poppins SemiBold with a sketchpen-shaded tagline. */
export const SectionHeader = ({
  title,
  subtitle,
  accent,
  right,
  align = 'left',
  style,
  marked = true,
}: SectionHeaderProps) => {
  const centered = align === 'center';
  return (
    <View style={[styles.row, centered && styles.centered, style]}>
      {accent ? (
        <View style={[styles.dot, { backgroundColor: accent }]} />
      ) : null}
      <View style={styles.text}>
        {marked ? (
          <MarkerHighlight
            color={accent ?? undefined}
            textStyle={[styles.title, centered && styles.titleCentered]}
            center={centered}
          >
            {title}
          </MarkerHighlight>
        ) : (
          <Text style={[styles.title, centered && styles.titleCentered]}>
            {title}
          </Text>
        )}
        {subtitle ? (
          <Text style={[styles.subtitle, centered && styles.titleCentered]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right && !centered ? <View>{right}</View> : null}
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
  centered: {
    justifyContent: 'center',
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
  titleCentered: {
    textAlign: 'center',
  },
  subtitle: {
    ...TYPE.caption,
    color: GV.muted,
  },
  title: {
    ...TYPE.title,
    fontSize: 17,
    color: GV.ink,
  },
});