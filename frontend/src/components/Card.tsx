import { StyleSheet, View, Pressable, type ViewStyle } from 'react-native';
import { spacing, radius } from '@/theme/tokens';
import { GV } from '@/theme/guava';

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
 * Guava-flat card — pure white, radius 20, no shadow, no border, no accent
 * lanes. Separation comes from the dark stage behind it.
 *
 * All legacy selectors (`kind`, `level`, `elevated`, `variant`, `tone`,
 * `accentColor`) are accepted and intentionally render the SAME flat card
 * so existing screens converge without rewrites breaking.
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

  // Every legacy kind converges on the same flat white card.
  const surface: ViewStyle = {
    backgroundColor: GV.card,
  };
  void resolvedKind;
  void tone;
  void accentColor;

  const Container = onPress ? Pressable : View;

  const pressStyle = onPress
    ? ({ pressed }: { pressed: boolean }) => [
        pressed && {
          opacity: 0.92,
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
          borderRadius: resolvedKind === 'compact' ? radius.lg : 20,
          padding: paddingMap[padding],
        },
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
    borderWidth: 0,
  },
});