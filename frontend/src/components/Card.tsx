import { StyleSheet, View, Pressable, type ViewStyle } from 'react-native';
import { COLORS, SPACING, BORDER_RADIUS, ELEVATION } from '@/constants';

interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  onPress?: () => void;
  /** 1 = standard content · 2 = important feature · 3 = featured/hero */
  level?: 1 | 2 | 3;
  /** Backward-compatible elevation flag (alias for level 2) */
  elevated?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  variant?: 'default' | 'secondary' | 'elevated' | 'accent';
  /** Restrained accent glow on the border (pass a COLORS key, e.g. accentBlue) */
  tone?: string;
  accessibilityLabel?: string;
}

/**
 * MedGraph card — layered dark surface, hairline border, soft depth.
 *
 * Hierarchy:
 *   level 1  normal content card          (surface, soft shadow)
 *   level 2  important feature card       (elevated surface, medium shadow)
 *   level 3  hero / featured card         (brightest surface, deep shadow, accent)
 */
export const Card = ({
  children,
  style,
  onPress,
  level = 1,
  elevated = false,
  padding = 'md',
  variant = 'default',
  tone,
  accessibilityLabel,
}: CardProps) => {
  const paddingMap = {
    none: 0,
    sm: SPACING.sm,
    md: SPACING.md,
    lg: SPACING.lg,
  };

  const resolvedVariant =
    variant === 'elevated'
      ? 'elevated'
      : variant === 'accent'
        ? 'accent'
        : variant === 'secondary'
          ? 'secondary'
          : level >= 3
            ? 'hero'
            : level === 2 || elevated
              ? 'feature'
              : 'base';

  const Container = onPress ? Pressable : View;

  const pressStyle = onPress
    ? ({ pressed }: { pressed: boolean }) => [
        pressed && styles.pressed,
      ]
    : undefined;

  return (
    <Container
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={onPress ? accessibilityLabel : undefined}
      style={[
        styles.container,
        variantSurface[resolvedVariant],
        tone ? { borderColor: tone } : null,
        { padding: paddingMap[padding] },
        pressStyle as any,
        style,
      ]}
    >
      {children}
    </Container>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  pressed: {
    backgroundColor: COLORS.surfacePressed,
    transform: [{ scale: 0.985 }],
  },
});

const variantSurface: Record<string, ViewStyle> = {
  // Level 1 — standard content
  base: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    ...ELEVATION.soft,
  },
  secondary: {
    backgroundColor: COLORS.surfaceSecondary,
    borderColor: COLORS.border,
    ...ELEVATION.soft,
  },
  // Level 2 — important feature
  feature: {
    backgroundColor: COLORS.surfaceElevated,
    borderColor: COLORS.borderStrong,
    ...ELEVATION.medium,
  },
  // Level 3 — hero / featured
  hero: {
    backgroundColor: '#1D2A3F',
    borderColor: 'rgba(77, 141, 255, 0.35)',
    ...ELEVATION.deep,
  },
  accent: {
    backgroundColor: 'rgba(77, 141, 255, 0.07)',
    borderColor: 'rgba(77, 141, 255, 0.4)',
    ...ELEVATION.medium,
  },
  elevated: {
    backgroundColor: COLORS.surfaceElevated,
    borderColor: COLORS.borderStrong,
    ...ELEVATION.medium,
  },
};
