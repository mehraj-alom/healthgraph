import {
  StyleSheet,
  View,
  Text,
  TextInput,
  type TextInputProps,
  type TextStyle,
} from 'react-native';
import { useRef } from 'react';

import {
  COLORS,
  SPACING,
  BORDER_RADIUS,
  TYPOGRAPHY,
  SHADOWS,
} from '@/constants';

interface InputProps {
  label?: string;
  placeholder?: string;
  value: string;
  onChangeText: (text: string) => void;
  error?: string;
  secureTextEntry?: boolean;
  keyboardType?: TextInputProps['keyboardType'];
  autoCapitalize?: TextInputProps['autoCapitalize'];
  autoComplete?: TextInputProps['autoComplete'];
  autoCorrect?: TextInputProps['autoCorrect'];
  textContentType?: TextInputProps['textContentType'];
  rightElement?: React.ReactNode;
  style?: TextStyle;
  disabled?: boolean;
  multiline?: boolean;
  numberOfLines?: number;
}

export const Input = ({
  label,
  placeholder,
  value,
  onChangeText,
  error,
  secureTextEntry = false,
  keyboardType = 'default',
  autoCapitalize = 'none',
  autoComplete,
  autoCorrect,
  textContentType,
  rightElement,
  style,
  disabled = false,
  multiline = false,
  numberOfLines = 4,
}: InputProps) => {
  const hasError = Boolean(error);
  const focused = useRef(false);

  const inputContainerStyles = [
    styles.inputContainer,
    hasError && styles.inputContainerError,
    disabled && styles.inputContainerDisabled,
  ];

  return (
    <View style={styles.container}>
      {label && (
        <Text style={styles.label}>
          {label}
        </Text>
      )}

      <View style={inputContainerStyles}>
        <TextInput
          placeholder={placeholder}
          placeholderTextColor={COLORS.textMuted}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={secureTextEntry}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoComplete={autoComplete}
          autoCorrect={autoCorrect}
          textContentType={textContentType}
          multiline={multiline}
          numberOfLines={
            multiline ? numberOfLines : undefined
          }
          editable={!disabled}
          style={[
            styles.input,
            multiline && styles.inputMultiline,
            disabled && styles.inputDisabled,
            hasError && styles.inputError,
            style,
          ]}
          onFocus={() => {
            focused.current = true;
          }}
          onBlur={() => {
            focused.current = false;
          }}
          selectionColor={COLORS.primary}
        />

        {rightElement && (
          <View style={styles.rightElement}>
            {rightElement}
          </View>
        )}
      </View>

      {error && (
        <Text style={styles.errorText}>
          {error}
        </Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'column',
    gap: SPACING.xs,
  },

  label: {
    ...TYPOGRAPHY.label,
    color: COLORS.textSecondary,
  },

  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    ...SHADOWS.sm,
  },

  inputContainerError: {
    borderColor: COLORS.error,
    borderWidth: 2,
  },

  inputContainerDisabled: {
    backgroundColor: COLORS.surfaceElevated,
  },

  input: {
    flex: 1,
    ...TYPOGRAPHY.body,
    color: COLORS.textPrimary,
    minHeight: 48,
  },

  inputMultiline: {
    minHeight: 100,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.sm,
    textAlignVertical: 'top',
  },

  inputDisabled: {
    opacity: 0.6,
  },

  inputError: {
    color: COLORS.error,
  },

  rightElement: {
    marginLeft: SPACING.sm,
  },

  errorText: {
    ...TYPOGRAPHY.caption,
    color: COLORS.error,
    marginTop: SPACING.xs,
  },
});