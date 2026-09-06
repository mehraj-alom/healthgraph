import {
  StyleSheet,
  View,
  Text,
  TextInput,
  type TextInputProps,
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

interface InputProps {
  label?: string;
  placeholder?: string;
  value: string;
  onChangeText: (text: string) => void;
  error?: string;
  hint?: string;
  secureTextEntry?: boolean;
  keyboardType?: TextInputProps['keyboardType'];
  autoCapitalize?: TextInputProps['autoCapitalize'];
  autoComplete?: TextInputProps['autoComplete'];
  autoCorrect?: TextInputProps['autoCorrect'];
  textContentType?: TextInputProps['textContentType'];
  rightElement?: React.ReactNode;
  leftElement?: React.ReactNode;
  style?: ViewStyle;
  inputStyle?: TextStyle;
  disabled?: boolean;
  multiline?: boolean;
  numberOfLines?: number;
  size?: ControlSize;
  maxLength?: number;
  returnKeyType?: TextInputProps['returnKeyType'];
  onSubmitEditing?: () => void;
  blurOnSubmit?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  testID?: string;
  accessibilityLabel?: string;
}

/**
 * MedGraph text input — dark recessed glass well with subtle inner depth.
 *
 * Functional contract:
 *  - TextInput is never wrapped in a Pressable or covered by an overlay.
 *  - The value passed in MUST be a string while editing (convert to a number
 *    only when saving).
 *  - Focus callbacks are forwarded without changing the native input hierarchy.
 *  - Disabled inputs reduce contrast and remain non-editable.
 */
export const Input = ({
  label,
  placeholder,
  value,
  onChangeText,
  error,
  hint,
  secureTextEntry = false,
  keyboardType = 'default',
  autoCapitalize = 'none',
  autoComplete,
  autoCorrect,
  textContentType,
  rightElement,
  leftElement,
  style,
  inputStyle,
  disabled = false,
  multiline = false,
  numberOfLines = 4,
  size = 'medium',
  maxLength,
  returnKeyType,
  onSubmitEditing,
  blurOnSubmit,
  onFocus: onFocusExternal,
  onBlur: onBlurExternal,
  testID,
  accessibilityLabel,
}: InputProps) => {
  const hasError = Boolean(error);
  const height = CONTROL_HEIGHTS[size];

  return (
    <View style={styles.container}>
      {label ? (
        <Text style={[styles.label, hasError && styles.labelError]}>
          {label}
        </Text>
      ) : null}

      <View
        style={[
          styles.inputContainer,
          { minHeight: height },
          hasError && styles.inputContainerError,
          disabled && styles.inputContainerDisabled,
          multiline && styles.inputContainerMultiline,
          style,
        ]}
      >
        {leftElement ? (
          <View style={styles.leftElement} pointerEvents="none">
            {leftElement}
          </View>
        ) : null}

        <TextInput
          testID={testID}
          accessibilityLabel={accessibilityLabel ?? label ?? placeholder}
          placeholder={placeholder}
          placeholderTextColor={COLORS.textDisabled}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={secureTextEntry}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoComplete={autoComplete}
          autoCorrect={autoCorrect}
          textContentType={textContentType}
          multiline={multiline}
          numberOfLines={multiline ? numberOfLines : undefined}
          editable={!disabled}
          maxLength={maxLength}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
          blurOnSubmit={blurOnSubmit}
          onFocus={() => {
            onFocusExternal?.();
          }}
          onBlur={() => {
            onBlurExternal?.();
          }}
          selectionColor={COLORS.accentBlue}
          style={[
            styles.input,
            { minHeight: height },
            multiline && styles.inputMultiline,
            disabled && styles.inputDisabled,
            inputStyle,
          ]}
        />

        {rightElement ? (
          <View style={styles.rightElement} pointerEvents="box-none">
            {rightElement}
          </View>
        ) : null}
      </View>

      {error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : hint && !hasError ? (
        <Text style={styles.hintText}>{hint}</Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'column',
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

  // Recessed dark well: sunken surface, hairline border, no external glow
  // unless focused (accent) or in error.
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surfaceSunken,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.medium,
    paddingHorizontal: SPACING.md,
  },

  inputContainerError: {
    borderColor: COLORS.error,
    borderWidth: 1.5,
  },

  inputContainerDisabled: {
    backgroundColor: COLORS.surfaceDisabled,
    borderColor: COLORS.borderFaint,
    opacity: 0.7,
    shadowOpacity: 0,
    elevation: 0,
  },

  inputContainerMultiline: {
    alignItems: 'flex-start',
  },

  input: {
    flex: 1,
    ...TYPOGRAPHY.body,
    color: COLORS.textPrimary,
    paddingVertical: 0,
    paddingHorizontal: 0,
  },

  inputMultiline: {
    minHeight: 100,
    paddingTop: SPACING.sm + 4,
    paddingBottom: SPACING.sm + 4,
    textAlignVertical: 'top',
  },

  inputDisabled: {
    color: COLORS.textDisabled,
  },

  leftElement: {
    marginRight: SPACING.sm,
    justifyContent: 'center',
  },

  rightElement: {
    marginLeft: SPACING.sm,
    justifyContent: 'center',
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
});
