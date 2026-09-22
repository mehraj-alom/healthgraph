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
 * Guava card — white surface with hierarchy through depth, not decoration.
 *
 * - standard: quiet flat card with a hairline violet-tinted edge so it
 *   holds together on the neon stage.
 * - elevated: soft violet shadow for feature surfaces.
 * - highlighted: deeper shadow + a 3px top accent lane (hero/featured).
 * - metric: top accent lane, flat body (health metric surface).
 * - interactive: standard surface with press feedback.
 * - compact: dense, reduced padding + radius.
 *
 * All legacy selectors (`kind`, `level`, `elevated`, `variant`, `tone`,
 * `accentColor`) feed the same resolver, so existing screens upgrade
 * without rewrites. Shadows are violet-tinted (never generic grey) and
 * carry Android elevation to match.
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

  // Depth per kind: quiet flat → soft violet shadow → hero shadow +
  // accent lane. One shadow family everywhere (deep violet, never grey).
  const SHADOW = 'rgba(46, 16, 101, 1)';
  // Warm paper default (caller `style` still wins — it merges last).
  const surface: ViewStyle = {
    backgroundColor: GV.paper,
  };
  if (resolvedKind === 'standard' || resolvedKind === 'interactive' || resolvedKind === 'compact') {
    surface.borderWidth = 1;
    surface.borderColor = tone ?? '#E7E1F5';
  }
  if (resolvedKind === 'elevated') {
    surface.borderWidth = 1;
    surface.borderColor = tone ?? '#E2D9F6';
    surface.shadowColor = SHADOW;
    surface.shadowOffset = { width: 0, height: 8 };
    surface.shadowOpacity = 0.16;
    surface.shadowRadius = 16;
    surface.elevation = 6;
  }
  if (resolvedKind === 'highlighted') {
    surface.borderWidth = 1;
    surface.borderColor = tone ?? '#D9CFF3';
    surface.shadowColor = SHADOW;
    surface.shadowOffset = { width: 0, height: 12 };
    surface.shadowOpacity = 0.22;
    surface.shadowRadius = 20;
    surface.elevation = 8;
  }
  if (resolvedKind === 'metric') {
    surface.borderWidth = 1;
    surface.borderColor = tone ?? '#E7E1F5';
  }

  const showLane = resolvedKind === 'highlighted' || resolvedKind === 'metric';
  const laneColor = accentColor ?? GV.violet;

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
          paddingTop: showLane ? 0 : paddingMap[padding],
          overflow: showLane ? 'hidden' : undefined,
        },
        pressStyle as any,
        style,
      ]}
    >
      {showLane ? <View style={[styles.lane, { backgroundColor: laneColor }]} /> : null}
      {showLane ? <View style={{ padding: paddingMap[padding], paddingTop: 12 }}>{children}</View> : children}
    </Container>
  );
};

const styles = StyleSheet.create({
  container: {
    borderWidth: 0,
  },
  lane: {
    height: 3,
    width: '100%',
  },
});