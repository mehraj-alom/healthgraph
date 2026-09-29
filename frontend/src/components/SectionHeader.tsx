import { StyleSheet, View, Text, type ViewStyle, type StyleProp, type TextStyle } from 'react-native';
import { spacing } from '@/theme/tokens';
import { GV, TYPE } from '@/theme/guava';
import { MarkerHighlight } from '@/components/MarkerHighlight';
import { MARK_DARK } from '@/components/markerScribble';

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
  /** Dark glass variant: white title, fog subtitle, slate shade. */
  dark?: boolean;
  /** Instance-level title override (size/tracking) — hierarchy fixes only. */
  titleStyle?: StyleProp<TextStyle>;
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
  dark = false,
  titleStyle: titleOverride,
}: SectionHeaderProps) => {
  const centered = align === 'center';
  const titleStyle = [styles.title, centered && styles.titleCentered, dark && styles.titleDark, titleOverride];
  return (
    <View style={[styles.row, centered && styles.centered, style]}>
      {accent ? (
        <View style={[styles.dot, { backgroundColor: accent }]} />
      ) : null}
      <View style={styles.text}>
        {marked ? (
          <MarkerHighlight
            color={accent ?? (dark ? MARK_DARK : undefined)}
            opacity={dark ? 0.9 : 0.5}
            textStyle={titleStyle}
            center={centered}
          >
            {title}
          </MarkerHighlight>
        ) : (
          <Text style={titleStyle}>
            {title}
          </Text>
        )}
        {subtitle ? (
          <Text style={[styles.subtitle, centered && styles.titleCentered, dark && styles.subtitleDark]}>
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
  subtitleDark: {
    color: '#A7B8B2',
  },
  title: {
    ...TYPE.title,
    fontSize: 17,
    color: GV.ink,
  },
  titleDark: {
    color: '#FFFFFF',
  },
});