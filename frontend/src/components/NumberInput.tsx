import { StyleSheet, Text } from 'react-native';
import { useState } from 'react';

import { Input } from './Input';
import { spacing } from '@/theme/tokens';
import type { ControlSize } from '@/theme/tokens';

interface NumberInputProps {
  label?: string;
  placeholder?: string;
  /** MUST stay a string while editing; convert with Number(value) only on save. */
  value: string;
  onChangeText: (text: string) => void;
  /** Optional unit rendered as a muted suffix inside the field. */
  unit?: string;
  /** Restrict the keyboard to whole numbers (integer fields only). */
  integer?: boolean;
  /** Show inline validation when the typed value is out of range (never blocks typing). */
  min?: number;
  max?: number;
  error?: string;
  hint?: string;
  disabled?: boolean;
  size?: ControlSize;
  style?: any;
  inputStyle?: any;
  maxLength?: number;
}

/**
 * MedGraph numeric input.
 *
 * Editing contract:
 *  - The TextInput is always driven by a string; typing, deleting and clearing
 *    are never intercepted or auto-overwritten.
 *  - min/max produce inline messages on blur/typing — they never clamp or
 *    block what the user types mid-edit.
 */
export const NumberInput = ({
  label,
  placeholder,
  value,
  onChangeText,
  unit,
  integer = false,
  min,
  max,
  error,
  hint,
  disabled = false,
  size,
  style,
  inputStyle,
  maxLength,
}: NumberInputProps) => {
  const [blurred, setBlurred] = useState(false);

  // Inline validation only after the user leaves the field — it must never
  // block or overwrite what is being typed.
  let inlineError = error;
  if (!inlineError && blurred && value.trim().length > 0) {
    const num = Number(value);
    if (Number.isNaN(num)) {
      inlineError = 'Enter a number.';
    } else if (min != null && num < min) {
      inlineError = `Minimum is ${min}.`;
    } else if (max != null && num > max) {
      inlineError = `Maximum is ${max}.`;
    }
  }

  return (
    <Input
      label={label}
      placeholder={placeholder}
      value={value}
      onChangeText={(text) => {
        // Integer fields accept digits only — the filter never prevents
        // deleting or clearing (empty string always passes).
        if (integer && text !== '' && !/^\d+$/.test(text)) {
          return;
        }
        onChangeText(text);
      }}
      error={inlineError}
      hint={hint}
      disabled={disabled}
      keyboardType={integer ? 'number-pad' : 'decimal-pad'}
      size={size}
      style={style}
      inputStyle={inputStyle}
      maxLength={maxLength}
      onBlur={() => setBlurred(true)}
      onFocus={() => setBlurred(false)}
      rightElement={
        unit ? <Text style={styles.unit}>{unit}</Text> : undefined
      }
    />
  );
};

const styles = StyleSheet.create({
  unit: {
    fontSize: 14,
    lineHeight: 20,
    color: '#6F7D8C',
    marginLeft: spacing.sm,
  },
});
