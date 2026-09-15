import { StyleSheet, View, Pressable, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';
import { spacing, radius } from '@/theme/tokens';

export type CardKind =
  | 'standard' // normal content card
  | 'elevated' // important feature, medium depth
  | 'metric'   // health metric surface (top accent lane)
  | 'interactive' // tappable card, pressed feedback
  | 'highlighted' // hero / featured card
  | 'compact'; // dense, reduced padding

interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  onPress?: () => void;
  /** New canonical variant selector. */
  kind?: CardKind;
  /** Backward-compatible: 1 = standard · 2 = elevated feature · 3 = hero. */
  level?: 1 | 2 | 3;
  /** Backward-compatible alias for the elevated feature surface. */
  elevated?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  /** Backward-compatible variant (maps onto kind). */
  variant?: 'default' | 'secondary' | 'elevated' | 'accent';
  /** Restrained accent on the border (pass a color). */
  tone?: string;
  /** Top accent strip for hero/metric cards. */
  accentColor?: string;
  accessibilityLabel?: string;
}

/**
 * HealthGraph card — layered surface, hairline border, soft depth.
 *
 * `kind` is the canonical selector. Backward-compatible props (`level`,
 * `elevated`, `variant`) map onto the same renders so existing screens keep
 * working unchanged.
 */
export const Card = ({
  children,
  style,
  onPress,
  kind,
  level = 1,
  elevated = false,
  padding = 'md',
  variant = 'default',
  tone,
  accentColor,
  accessibilityLabel,
}: CardProps) => {
  const { colors, elevation, isDark } = useTheme();

  const paddingMap = {
    none: 0,
    sm: spacing.sm,
    md: spacing.lg,
    lg: spacing.xl,
  };

  // Resolve canonical kind from every input source.
  const resolvedKind: CardKind =
    kind ??
    (variant === 'elevated'
      ? 'elevated'
      : variant === 'accent'
        ? 'highlighted'
        : variant === 'secondary'
          ? 'standard'
          : level >= 3
            ? 'highlighted'
            : level === 2 || elevated
              ? 'elevated'
              : 'standard');

  const surface = ((): ViewStyle => {
    switch (resolvedKind) {
      case 'elevated':
        return {
          backgroundColor: colors.surfaceElevated,
          borderColor: colors.border,
          ...elevation.medium,
        };
      case 'highlighted':
        // Peach feature card (like "Smart Doctor Match")
        return {
          backgroundColor: isDark ? '#2E2A23' : '#FBEEDC',
          borderColor: isDark ? 'rgba(232, 134, 46, 0.4)' : '#F0D3AC',
          ...elevation.medium,
        };
      default:
        return {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          ...elevation.soft,
        };
    }
  })();

  const hasAccentLane =
    resolvedKind === 'metric' || resolvedKind === 'highlighted' || Boolean(accentColor);
  const laneColor = accentColor ?? colors.teal;

  const Container = onPress ? Pressable : View;

  const pressStyle = onPress
    ? ({ pressed }: { pressed: boolean }) => [
        pressed && {
          backgroundColor: colors.surfacePressed,
          transform: [{ scale: 0.985 }],
        },
      ]
    : undefined;

  return (
    <Container
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={onPress ? accessibilityLabel : undefined}
      style={[
        styles.container,
        surface,
        {
          borderRadius: resolvedKind === 'compact' ? radius.lg : radius.xl,
          padding: paddingMap[padding],
        },
        hasAccentLane && {
          borderTopWidth: 3,
          borderTopColor: laneColor,
        },
        tone && { borderColor: tone },
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
    borderWidth: 1,
  },
});