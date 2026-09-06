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
import {
  COLORS,
  SPACING,
  BORDER_RADIUS,
  TYPOGRAPHY,
  CONTROL_HEIGHTS,
  ELEVATION,
  type ControlSize,
} from '@/constants';

export interface SelectOption {
  label: string;
  value: string;
  description?: string;
  disabled?: boolean;
}

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
 * MedGraph select — a real pressable control backed by a native Modal picker.
 *
 * Notes:
 *  - No TextInput is faked; the trigger simply opens a modal option list.
 *  - The Modal is fully unmounted on close, so it never blocks other inputs.
 *  - Android Back closes the picker through onRequestClose.
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
  color = COLORS.accentBlue,
  menuTitle,
  style,
}: SelectProps) => {
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const height = CONTROL_HEIGHTS[size];
  const hasError = Boolean(error);
  const selected = options.find((opt) => opt.value === value) ?? null;

  return (
    <View style={[styles.container, style]}>
      {label ? (
        <Text style={[styles.label, hasError && styles.labelError]}>{label}</Text>
      ) : null}

      <Pressable
        onPress={() => !disabled && setOpen(true)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label ?? placeholder}
        accessibilityState={{ disabled, expanded: open }}
        style={({ pressed }) => [
          styles.trigger,
          { minHeight: height },
          pressed && !disabled && styles.triggerPressed,
          hasError && styles.triggerError,
          disabled && styles.triggerDisabled,
        ]}
      >
        <Text
          style={[
            styles.triggerText,
            !selected && styles.triggerPlaceholder,
            disabled && styles.triggerDisabledText,
          ]}
          numberOfLines={1}
        >
          {selected ? selected.label : placeholder}
        </Text>
        <Text
          style={[
            styles.chevron,
            { color: disabled ? COLORS.textDisabled : selected ? color : COLORS.textMuted },
          ]}
        >
          ▾
        </Text>
      </Pressable>

      {error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : hint && !hasError ? (
        <Text style={styles.hintText}>{hint}</Text>
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
            style={styles.scrim}
            onPress={() => setOpen(false)}
            accessibilityLabel="Close options"
          />

          <View
            style={[
              styles.menu,
              { paddingTop: Math.max(insets.top, 20), paddingBottom: Math.max(insets.bottom, 16) },
            ]}
          >
            <Text style={styles.menuTitle}>
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
                          isSelected && { color },
                          opt.disabled && styles.optionDisabledText,
                        ]}
                      >
                        {opt.label}
                      </Text>
                      {opt.description ? (
                        <Text style={styles.optionDesc}>{opt.description}</Text>
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
    gap: SPACING.xs + 2,
  },
  label: {
    ...TYPOGRAPHY.label,
    color: COLORS.textSecondary,
    fontSize: 11,
  },
  labelError: {
    color: COLORS.error,
  },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.surfaceSunken,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.medium,
    paddingHorizontal: SPACING.md,
    gap: SPACING.sm,
  },
  triggerPressed: {
    backgroundColor: COLORS.surfacePressed,
    transform: [{ scale: 0.985 }],
  },
  triggerError: {
    borderColor: COLORS.error,
    borderWidth: 1.5,
  },
  triggerDisabled: {
    backgroundColor: COLORS.surfaceDisabled,
    opacity: 0.7,
  },
  triggerText: {
    flex: 1,
    ...TYPOGRAPHY.body,
    color: COLORS.textPrimary,
  },
  triggerPlaceholder: {
    color: COLORS.textDisabled,
  },
  triggerDisabledText: {
    color: COLORS.textDisabled,
  },
  chevron: {
    fontSize: 14,
  },
  errorText: {
    ...TYPOGRAPHY.caption,
    color: COLORS.error,
  },
  hintText: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
    fontSize: 12,
  },

  // Option picker (Modal)
  modalRoot: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
  },
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: COLORS.overlayScrim,
  },
  menu: {
    width: '100%',
    maxWidth: 460,
    maxHeight: '70%',
    backgroundColor: COLORS.glassStrong,
    borderWidth: 1,
    borderColor: COLORS.borderFaint,
    borderRadius: BORDER_RADIUS.xl,
    paddingHorizontal: SPACING.lg,
    ...ELEVATION.deep,
  },
  menuTitle: {
    ...TYPOGRAPHY.h3,
    color: COLORS.textPrimary,
    paddingBottom: SPACING.sm,
  },
  menuScroll: {
    flexGrow: 0,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.md,
    paddingVertical: SPACING.sm + 4,
    paddingHorizontal: SPACING.sm + 2,
    borderRadius: BORDER_RADIUS.medium,
    borderWidth: 1,
    borderColor: 'transparent',
    marginBottom: SPACING.xs,
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
    ...TYPOGRAPHY.body,
    color: COLORS.textPrimary,
    fontWeight: '600',
  },
  optionDesc: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
  },
  optionDisabledText: {
    color: COLORS.textDisabled,
  },
  check: {
    fontSize: 16,
    fontWeight: '700',
  },
});
