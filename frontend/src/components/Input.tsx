import {
  StyleSheet,
  View,
  Text,
  TextInput,
  type TextInputProps,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import { useTheme } from '@/theme';
import { spacing, radius, type ControlSize } from '@/theme/tokens';

const HEIGHT: Record<ControlSize, number> = {
  small: 36,
  medium: 44,
  large: 52,
};

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
 * HealthGraph text input — recessed well with hairline border.
 * Normal → focused (accent glow) → error (tone border) → disabled.
 * The TextInput is never wrapped in a Pressable or covered by an overlay.
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
  const { colors, typography } = useTheme();
  const hasError = Boolean(error);
  const height = HEIGHT[size];

  return (
    <View style={styles.container}>
      {label ? (
        <Text style={[styles.label, hasError && { color: colors.error }]}>
          {label}
        </Text>
      ) : null}

      <View
        style={[
          styles.inputContainer,
          {
            minHeight: height,
            backgroundColor: colors.surfaceSunken,
            borderColor: hasError ? colors.error : colors.border,
            borderRadius: radius.md,
          },
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
          placeholderTextColor={colors.textDisabled}
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
          selectionColor={colors.accentBlue}
          style={[
            styles.input,
            { minHeight: height, color: colors.textPrimary, ...typography.body },
            multiline && styles.inputMultiline,
            disabled && { color: colors.textDisabled },
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
        <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
      ) : hint && !hasError ? (
        <Text style={[styles.hintText, { color: colors.textMuted }]}>{hint}</Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'column',
    gap: spacing.xs + 2,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingHorizontal: spacing.md,
  },
  inputContainerError: {
    borderWidth: 1.5,
  },
  inputContainerDisabled: {
    opacity: 0.7,
    shadowOpacity: 0,
    elevation: 0,
  },
  inputContainerMultiline: {
    alignItems: 'flex-start',
  },
  input: {
    flex: 1,
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  inputMultiline: {
    minHeight: 100,
    paddingTop: spacing.sm + 4,
    paddingBottom: spacing.sm + 4,
    textAlignVertical: 'top',
  },
  leftElement: {
    marginRight: spacing.sm,
    justifyContent: 'center',
  },
  rightElement: {
    marginLeft: spacing.sm,
    justifyContent: 'center',
  },
  errorText: {
    fontSize: 13,
    lineHeight: 18,
  },
  hintText: {
    fontSize: 12,
    lineHeight: 18,
  },
});