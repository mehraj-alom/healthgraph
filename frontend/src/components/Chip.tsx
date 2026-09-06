import {
  StyleSheet,
  Text,
  Pressable,
  View,
  type ViewStyle,
} from 'react-native';
import {
  COLORS,
  SPACING,
  BORDER_RADIUS,
  TYPOGRAPHY,
  CONTROL_HEIGHTS,
  type ControlSize,
} from '@/constants';

interface ChipProps {
  label: string;
  selected?: boolean;
  onPress: () => void;
  /** Accent color applied when selected (defaults to accentBlue) */
  color?: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  size?: ControlSize;
  style?: ViewStyle;
  accessibilityLabel?: string;
}

/**
 * MedGraph filter/tag chip — hairline border, sunken surface; the selected chip
 * gets a restrained accent fill + glow so it reads as active without neon.
 */
export const Chip = ({
  label,
  selected = false,
  onPress,
  color = COLORS.accentBlue,
  icon,
  disabled = false,
  size = 'small',
  style,
  accessibilityLabel,
}: ChipProps) => {
  const height = CONTROL_HEIGHTS[size];
  const accent = selected ? color : COLORS.textSecondary;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected, disabled }}
      style={({ pressed }) => [
        styles.container,
        { minHeight: height },
        selected && { backgroundColor: `${color}1F`, borderColor: color },
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      {icon ? (
        <View style={styles.icon} pointerEvents="none">
          {icon}
        </View>
      ) : null}
      <Text
        style={[
          styles.label,
          { color: accent },
          selected && styles.labelSelected,
          disabled && styles.labelDisabled,
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceSunken,
    gap: SPACING.xs,
  },
  pressed: {
    transform: [{ scale: 0.97 }],
    backgroundColor: COLORS.surfacePressed,
  },
  disabled: {
    opacity: 0.45,
  },
  icon: {
    justifyContent: 'center',
  },
  label: {
    ...TYPOGRAPHY.captionStrong,
    fontSize: 13,
  },
  labelSelected: {
    fontWeight: '700',
  },
  labelDisabled: {
    color: COLORS.textDisabled,
  },
});
