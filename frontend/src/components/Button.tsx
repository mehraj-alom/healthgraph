import {
  StyleSheet,
  Text,
  View,
  Pressable,
  ActivityIndicator,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import { spacing, radius, type ControlSize } from '@/theme/tokens';
import { GV, TYPE } from '@/theme/guava';

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
 * Guava-flat button — deep-green pill (primary), white pill (secondary),
 * hairline pill (outline), quiet text (ghost). Flat fills, no shadows.
 * API unchanged so existing call sites keep working.
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
  const height = HEIGHT[size];
  const isDisabled = disabled || loading;

  const surfaceMap: Record<ButtonVariant, ViewStyle> = {
    primary: {
      backgroundColor: GV.cta,
    },
    secondary: {
      backgroundColor: GV.card,
      borderWidth: 1,
      borderColor: GV.line,
    },
    outline: {
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      borderColor: GV.line,
    },
    ghost: {
      backgroundColor: 'transparent',
      borderWidth: 0,
    },
    danger: {
      backgroundColor: GV.danger,
    },
    success: {
      backgroundColor: GV.cta,
    },
  };

  const pressedMap: Record<ButtonVariant, ViewStyle> = {
    primary: { backgroundColor: GV.ctaPressed },
    secondary: { backgroundColor: GV.wash },
    outline: { backgroundColor: GV.wash },
    ghost: { backgroundColor: GV.wash },
    danger: { backgroundColor: GV.danger, opacity: 0.85 },
    success: { backgroundColor: GV.ctaPressed },
  };

  const textMap: Record<ButtonVariant, TextStyle> = {
    primary: { color: '#FFFFFF' },
    secondary: { color: GV.ink },
    outline: { color: GV.ink },
    ghost: { color: GV.body },
    danger: { color: '#FFFFFF' },
    success: { color: '#FFFFFF' },
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
        { minHeight: height, borderRadius: pill || variant === 'primary' ? radius.pill : radius.md },
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
  },
  text: {
    ...TYPE.button,
    fontSize: 15,
    letterSpacing: 0.2,
  },
  textDisabled: {
    opacity: 0.7,
  },
  icon: {
    justifyContent: 'center',
  },
});