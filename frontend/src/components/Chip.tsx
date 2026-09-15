import { StyleSheet, Text, Pressable, View, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';
import { spacing, radius, type ControlSize } from '@/theme/tokens';

const HEIGHT: Record<ControlSize, number> = {
  small: 32,
  medium: 40,
  large: 48,
};

interface ChipProps {
  label: string;
  selected?: boolean;
  onPress: () => void;
  /** Accent color applied when selected (defaults to accentBlue). */
  color?: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  size?: ControlSize;
  style?: ViewStyle;
  accessibilityLabel?: string;
}

/**
 * Filter/tag chip — cream pill, sandy hairline. Selected is the ink pill
 * from the reference ("All Doctors"): dark fill + white label.
 */
export const Chip = ({
  label,
  selected = false,
  onPress,
  color = '#1D1B17',
  icon,
  disabled = false,
  size = 'small',
  style,
  accessibilityLabel,
}: ChipProps) => {
  const { colors, typography } = useTheme();
  const height = HEIGHT[size];
  const accent = selected ? '#FFFFFF' : colors.textSecondary;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected, disabled }}
      style={({ pressed }) => [
        styles.container,
        { minHeight: height, backgroundColor: colors.surface, borderColor: colors.border },
        selected && { backgroundColor: '#1D1B17', borderColor: '#1D1B17' },
        pressed && !selected && { transform: [{ scale: 0.97 }], backgroundColor: colors.surfacePressed },
        pressed && selected && { transform: [{ scale: 0.97 }], opacity: 0.88 },
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
          typography.captionStrong,
          { color: accent },
          selected && styles.selected,
          disabled && { color: colors.textDisabled },
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
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    gap: spacing.xs,
  },
  disabled: {
    opacity: 0.45,
  },
  icon: {
    justifyContent: 'center',
  },
  label: {
    fontSize: 13,
  },
  selected: {
    fontWeight: '700',
  },
});