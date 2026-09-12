/**
 * FilterChips — 6.4 segmented/filter row: active chip is solid near-black
 * with white text; inactive options are plain secondary text, no border.
 */

import React from 'react';
import { Pressable, View, Text, StyleSheet } from 'react-native';
import { mv, mvType } from '@/theme/movements';

export interface FilterOption<T extends string = string> {
  key: T;
  label: string;
}

interface FilterChipsProps<T extends string = string> {
  options: FilterOption<T>[];
  active: T;
  onChange: (key: T) => void;
}

export function FilterChips<T extends string = string>({
  options,
  active,
  onChange,
}: FilterChipsProps<T>) {
  return (
    <View style={styles.row}>
      {options.map((opt) => {
        const isActive = opt.key === active;
        return (
          <Pressable
            key={opt.key}
            onPress={() => onChange(opt.key)}
            hitSlop={6}
            style={({ pressed }) => [
              isActive && styles.activeChip,
              pressed && { opacity: 0.6 },
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
          >
            <Text
              style={[
                mvType.pill,
                {
                  color: isActive ? mv.surfaceWhite : mv.textOnLightSecondary,
                },
              ]}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 18,
    alignItems: 'center',
  },
  activeChip: {
    backgroundColor: mv.textOnLightPrimary,
    borderRadius: mv.radiusPill,
    paddingHorizontal: 16,
    paddingVertical: 7,
  },
});