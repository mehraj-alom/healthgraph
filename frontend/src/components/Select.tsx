import {
  StyleSheet,
  View,
  Text,
  Pressable,
  ScrollView,
  Modal as RNModal,
  type ViewStyle,
} from 'react-native';
import { useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme';
import { spacing, radius, type ControlSize } from '@/theme/tokens';

export interface SelectOption {
  label: string;
  value: string;
  description?: string;
  disabled?: boolean;
}

const HEIGHT: Record<ControlSize, number> = {
  small: 36,
  medium: 44,
  large: 52,
};

interface SelectProps {
  label?: string;
  placeholder?: string;
  value: string | null;
  options: SelectOption[];
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  disabled?: boolean;
  size?: ControlSize;
  /** Accent for the active/selected state (default accentBlue). */
  color?: string;
  menuTitle?: string;
  style?: ViewStyle;
}

/**
 * HealthGraph select — a real pressable control backed by a native Modal
 * picker. The Modal is unmounted on close; Android Back closes it.
 */
export const Select = ({
  label,
  placeholder = 'Select…',
  value,
  options,
  onChange,
  error,
  hint,
  disabled = false,
  size = 'medium',
  color = '#4D8DFF',
  menuTitle,
  style,
}: SelectProps) => {
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const { colors, typography, elevation } = useTheme();
  const height = HEIGHT[size];
  const hasError = Boolean(error);
  const selected = options.find((opt) => opt.value === value) ?? null;

  return (
    <View style={[styles.container, style]}>
      {label ? (
        <Text style={[styles.label, { color: hasError ? colors.error : colors.textSecondary }]}>
          {label}
        </Text>
      ) : null}

      <Pressable
        onPress={() => !disabled && setOpen(true)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label ?? placeholder}
        accessibilityState={{ disabled, expanded: open }}
        style={({ pressed }) => [
          styles.trigger,
          {
            minHeight: height,
            backgroundColor: colors.surfaceSunken,
            borderColor: hasError ? colors.error : colors.border,
          },
          pressed && !disabled && { backgroundColor: colors.surfacePressed, transform: [{ scale: 0.985 }] },
          hasError && styles.triggerError,
          disabled && styles.triggerDisabled,
        ]}
      >
        <Text
          style={[
            styles.triggerText,
            typography.body,
            { color: selected ? colors.textPrimary : colors.textDisabled },
          ]}
          numberOfLines={1}
        >
          {selected ? selected.label : placeholder}
        </Text>
        <Text
          style={[
            styles.chevron,
            { color: disabled ? colors.textDisabled : selected ? color : colors.textMuted },
          ]}
        >
          ▾
        </Text>
      </Pressable>

      {error ? (
        <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
      ) : hint && !hasError ? (
        <Text style={[styles.hintText, { color: colors.textMuted }]}>{hint}</Text>
      ) : null}

      <RNModal
        visible={open}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setOpen(false)}
        accessibilityViewIsModal
      >
        <View style={styles.modalRoot}>
          <Pressable
            style={[styles.scrim, { backgroundColor: colors.overlayScrim }]}
            onPress={() => setOpen(false)}
            accessibilityLabel="Close options"
          />
          <View
            style={[
              styles.menu,
              elevation.deep,
              {
                backgroundColor: colors.glassStrong,
                borderColor: colors.glassBorder,
                paddingTop: Math.max(insets.top, 20),
                paddingBottom: Math.max(insets.bottom, 16),
              },
            ]}
          >
            <Text style={[styles.menuTitle, typography.heading, { color: colors.textPrimary }]}>
              {menuTitle ?? label ?? placeholder}
            </Text>
            <ScrollView
              style={styles.menuScroll}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {options.map((opt) => {
                const isSelected = opt.value === value;
                return (
                  <Pressable
                    key={opt.value}
                    disabled={opt.disabled}
                    onPress={() => {
                      onChange(opt.value);
                      setOpen(false);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={opt.label}
                    accessibilityState={{ selected: isSelected, disabled: opt.disabled }}
                    style={({ pressed }) => [
                      styles.option,
                      isSelected && { borderColor: color, backgroundColor: `${color}14` },
                      pressed && styles.optionPressed,
                      opt.disabled && styles.optionDisabled,
                    ]}
                  >
                    <View style={styles.optionText}>
                      <Text
                        style={[
                          styles.optionLabel,
                          typography.body,
                          { color: isSelected ? color : colors.textPrimary },
                          opt.disabled && { color: colors.textDisabled },
                        ]}
                      >
                        {opt.label}
                      </Text>
                      {opt.description ? (
                        <Text style={[styles.optionDesc, typography.caption, { color: colors.textMuted }]}>
                          {opt.description}
                        </Text>
                      ) : null}
                    </View>
                    {isSelected ? (
                      <Text style={[styles.check, { color }]}>✓</Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </RNModal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: 6,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  triggerError: {
    borderWidth: 1.5,
  },
  triggerDisabled: {
    opacity: 0.7,
  },
  triggerText: {
    flex: 1,
  },
  chevron: {
    fontSize: 14,
  },
  errorText: {
    fontSize: 13,
    lineHeight: 18,
  },
  hintText: {
    fontSize: 12,
    lineHeight: 18,
  },

  // Option picker (Modal)
  modalRoot: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  menu: {
    width: '100%',
    maxWidth: 460,
    maxHeight: '70%',
    borderWidth: 1,
    borderRadius: radius.xxl,
    paddingHorizontal: spacing.lg,
  },
  menuTitle: {
    fontSize: 20,
    paddingBottom: spacing.sm,
  },
  menuScroll: {
    flexGrow: 0,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'transparent',
    marginBottom: spacing.xs,
  },
  optionPressed: {
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  optionDisabled: {
    opacity: 0.45,
  },
  optionText: {
    flex: 1,
    gap: 2,
  },
  optionLabel: {
    fontWeight: '600',
  },
  optionDesc: {
    fontSize: 12,
  },
  check: {
    fontSize: 16,
    fontWeight: '700',
  },
});