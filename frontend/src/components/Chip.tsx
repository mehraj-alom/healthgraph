import { StyleSheet, Text, Pressable, View, type ViewStyle } from 'react-native';
import { spacing, radius, type ControlSize } from '@/theme/tokens';
import { GV, TYPE, FONT } from '@/theme/guava';

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
 * Guava-flat filter chip — white pill, hairline. Selected is the CTA green
 * pill with white label. API unchanged.
 */
export const Chip = ({
  label,
  selected = false,
  onPress,
  color = GV.cta,
  icon,
  disabled = false,
  size = 'small',
  style,
  accessibilityLabel,
}: ChipProps) => {
  const height = HEIGHT[size];
  const accent = selected ? '#FFFFFF' : GV.body;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected, disabled }}
      style={({ pressed }) => [
        styles.container,
        { minHeight: height, backgroundColor: GV.card, borderColor: GV.line },
        selected && { backgroundColor: color, borderColor: color },
        pressed && !selected && { transform: [{ scale: 0.97 }], backgroundColor: GV.wash },
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
          { color: accent },
          selected && styles.selected,
          disabled && { color: GV.muted },
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
    ...TYPE.chip,
  },
  selected: {
    fontFamily: FONT.bold,
  },
});