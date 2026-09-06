import { StyleSheet, View, Text, Switch, type ViewStyle } from 'react-native';
import { COLORS, SPACING, TYPOGRAPHY } from '@/constants';

interface ToggleProps {
  label: string;
  description?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  style?: ViewStyle;
}

/** MedGraph toggle row — label + description with a calm, accessible switch. */
export const Toggle = ({
  label,
  description,
  value,
  onChange,
  disabled = false,
  style,
}: ToggleProps) => {
  return (
    <View style={[styles.row, style]}>
      <View style={styles.text}>
        <Text style={[styles.label, disabled && styles.muted]}>{label}</Text>
        {description ? (
          <Text style={[styles.description, disabled && styles.muted]}>
            {description}
          </Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{
          false: COLORS.border,
          true: COLORS.accentBlue,
        }}
        thumbColor={value ? '#FFFFFF' : COLORS.textMuted}
        ios_backgroundColor={COLORS.border}
        accessibilityRole="switch"
        accessibilityState={{ checked: value, disabled }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingVertical: SPACING.sm + 2,
  },
  text: {
    flex: 1,
    gap: 2,
  },
  label: {
    ...TYPOGRAPHY.bodyStrong,
    color: COLORS.textPrimary,
    fontSize: 15,
  },
  description: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
    lineHeight: 17,
  },
  muted: {
    color: COLORS.textDisabled,
  },
});
