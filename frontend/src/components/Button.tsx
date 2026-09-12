import {
  StyleSheet,
  Text,
  View,
  Pressable,
  ActivityIndicator,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import { useTheme } from '@/theme';
import { spacing, radius, type ControlSize } from '@/theme/tokens';

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
  leftElement?: React.ReactNode;
  style?: ViewStyle;
  textStyle?: TextStyle;
  accessibilityLabel?: string;
}

const HEIGHT: Record<ControlSize, number> = {
  small: 36,
  medium: 44,
  large: 52,
};

/**
 * HealthGraph button — shared variants with pressed / disabled / loading /
 * focus states. Pressed fill steps one tone toward the surface for tactile
 * feedback; a single shared scale handles the press gesture.
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
  leftElement,
  style,
  textStyle,
  accessibilityLabel,
}: ButtonProps) => {
  const { colors, isDark } = useTheme();
  const height = HEIGHT[size];
  const isDisabled = disabled || loading;

  const surfaceMap: Record<ButtonVariant, ViewStyle> = {
    primary: {
      backgroundColor: colors.brand,
      shadowColor: colors.brand,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: isDark ? 0.25 : 0.4,
      shadowRadius: 8,
      elevation: isDark ? 5 : 3,
    },
    secondary: {
      backgroundColor: colors.surfaceElevated,
      borderWidth: 1,
      borderColor: colors.border,
    },
    outline: {
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      borderColor: colors.borderStrong,
    },
    ghost: {
      backgroundColor: 'transparent',
      borderWidth: 0,
    },
    danger: {
      backgroundColor: colors.error,
      shadowColor: colors.error,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.2,
      shadowRadius: 8,
      elevation: 4,
    },
    success: {
      backgroundColor: colors.success,
      shadowColor: colors.success,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.2,
      shadowRadius: 8,
      elevation: 4,
    },
  };

  const pressedMap: Record<ButtonVariant, ViewStyle> = {
    primary: { backgroundColor: colors.brandDark },
    secondary: { backgroundColor: colors.surfacePressed },
    outline: { backgroundColor: colors.accentBlueSoft },
    ghost: { backgroundColor: colors.glassHighlight },
    danger: { backgroundColor: colors.error, opacity: 0.85 },
    success: { backgroundColor: colors.success, opacity: 0.85 },
  };

  const textMap: Record<ButtonVariant, TextStyle> = {
    primary: { color: colors.textOnBrand },
    secondary: { color: colors.textPrimary },
    outline: { color: colors.textPrimary },
    ghost: { color: colors.textSecondary },
    danger: { color: '#FFFFFF' },
    success: { color: isDark ? '#07111F' : '#FFFFFF' },
  };

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => [
        styles.container,
        { minHeight: height, borderRadius: pill ? radius.pill : radius.md },
        surfaceMap[variant],
        isDisabled && styles.disabled,
        pressed && !isDisabled && { ...pressedMap[variant], transform: [{ scale: 0.975 }] },
        fullWidth && styles.fullWidth,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={textMap[variant].color} />
      ) : (
        <>
          {leftElement ? (
            <View style={styles.icon} pointerEvents="none">
              {leftElement}
            </View>
          ) : null}
          <Text style={[styles.text, textMap[variant], isDisabled && styles.textDisabled, textStyle]}>
            {title}
          </Text>
        </>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  fullWidth: {
    width: '100%',
  },
  disabled: {
    opacity: 0.45,
    shadowOpacity: 0,
    elevation: 0,
  },
  text: {
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
    letterSpacing: 0.2,
  },
  textDisabled: {
    opacity: 0.7,
  },
  icon: {
    justifyContent: 'center',
  },
});