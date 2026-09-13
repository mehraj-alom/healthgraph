import { StyleSheet, View, Text, Switch, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';
import { spacing } from '@/theme/tokens';

interface ToggleProps {
  label: string;
  description?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  style?: ViewStyle;
}

/** HealthGraph toggle row — label + description with a calm, accessible switch. */
export const Toggle = ({
  label,
  description,
  value,
  onChange,
  disabled = false,
  style,
}: ToggleProps) => {
  const { colors, typography } = useTheme();
  return (
    <View style={[styles.row, style]}>
      <View style={styles.text}>
        <Text style={[styles.label, typography.bodyStrong, { color: colors.textPrimary }]}>
          {label}
        </Text>
        {description ? (
          <Text style={[styles.description, typography.caption, { color: colors.textMuted }]}>
            {description}
          </Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{
          false: colors.border,
          true: colors.accentBlue,
        }}
        thumbColor={value ? '#FFFFFF' : colors.textMuted}
        ios_backgroundColor={colors.border}
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
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  text: {
    flex: 1,
    gap: 2,
  },
  label: {
    fontSize: 15,
  },
  description: {
    lineHeight: 17,
  },
});
