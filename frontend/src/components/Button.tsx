import {
  StyleSheet,
  Text,
  Pressable,
  ActivityIndicator,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import {
  COLORS,
  SPACING,
  BORDER_RADIUS,
  TYPOGRAPHY,
  CONTROL_HEIGHTS,
  type ControlSize,
} from '@/constants';

type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'ghost'
  | 'danger'
  | 'success';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  size?: ControlSize;
  pill?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
  accessibilityLabel?: string;
}

/**
 * MedGraph button — shared variants with pressed / disabled / loading states.
 *
 * Pressed: slightly darker fill + ~2% compression (100–150 ms feel).
 * Loading: spinner while preserving button dimensions.
 * Glow is reserved for the focused/active accent, never constant everywhere.
 */
export const Button = ({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  fullWidth = false,
  size = 'medium',
  pill = false,
  style,
  textStyle,
  accessibilityLabel,
}: ButtonProps) => {
  const height = CONTROL_HEIGHTS[size];
  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => [
        styles.container,
        { minHeight: height },
        pill && styles.pill,
        variantStyles[variant],
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
        pressed && !isDisabled && variantPressedStyles[variant],
        fullWidth && styles.fullWidth,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={textColors[variant].color} />
      ) : (
        <Text
          style={[
            styles.text,
            textColors[variant],
            isDisabled && styles.textDisabled,
            textStyle,
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: SPACING.lg,
    borderRadius: BORDER_RADIUS.medium,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  pill: {
    borderRadius: BORDER_RADIUS.pill,
    paddingHorizontal: SPACING.xl,
  },
  fullWidth: {
    width: '100%',
  },
  pressed: {
    transform: [{ scale: 0.975 }],
  },
  disabled: {
    opacity: 0.45,
    shadowOpacity: 0,
    elevation: 0,
  },
  text: {
    ...TYPOGRAPHY.button,
    fontSize: 15,
  },
  textDisabled: {
    opacity: 0.7,
  },

  // ── Variant surfaces ──
  primary: {
    backgroundColor: COLORS.accentGold,
    shadowColor: COLORS.accentGold,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.22,
    shadowRadius: 8,
    elevation: 5,
  },
  secondary: {
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  outline: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: COLORS.borderStrong,
  },
  ghost: {
    backgroundColor: 'transparent',
    borderWidth: 0,
  },
  danger: {
    backgroundColor: COLORS.error,
    shadowColor: COLORS.error,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 4,
  },
  success: {
    backgroundColor: COLORS.success,
    shadowColor: COLORS.success,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 4,
  },
});

const variantStyles: Record<ButtonVariant, ViewStyle> = {
  primary: styles.primary,
  secondary: styles.secondary,
  outline: styles.outline,
  ghost: styles.ghost,
  danger: styles.danger,
  success: styles.success,
};

// Pressed fills: one step darker for tactile feedback.
const variantPressedStyles: Record<ButtonVariant, ViewStyle> = {
  primary: { backgroundColor: '#D9B016' },
  secondary: { backgroundColor: COLORS.surfacePressed },
  outline: { backgroundColor: 'rgba(77, 141, 255, 0.08)' },
  ghost: { backgroundColor: 'rgba(255, 255, 255, 0.06)' },
  danger: { backgroundColor: '#C94A55' },
  success: { backgroundColor: '#4FA95F' },
};

const textColors: Record<ButtonVariant, TextStyle> = {
  primary: { color: COLORS.textOnAccent },
  secondary: { color: COLORS.textPrimary },
  outline: { color: COLORS.textPrimary },
  ghost: { color: COLORS.textSecondary },
  danger: { color: '#FFFFFF' },
  success: { color: COLORS.textOnAccent },
};
