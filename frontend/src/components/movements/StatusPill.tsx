/**
 * StatusPill / Badge — 6.3: short 1–3 word fully-rounded pill.
 * On white cards: lime bg, dark text. On dark/teal: translucent limeSoft.
 * Always directly under or beside the giant stat, never in the card header.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { mv, mvType } from '@/theme/movements';

interface StatusPillProps {
  text: string;
  /** 'lime' = solid lime on white; 'limeOnDark' = translucent lime on dark. */
  variant?: 'lime' | 'limeOnDark';
}

export function StatusPill({ text, variant = 'lime' }: StatusPillProps) {
  const bg = variant === 'lime' ? mv.accentLime : 'rgba(234,255,170,0.18)';
  const color = variant === 'lime' ? mv.textOnLightPrimary : mv.accentLimeSoft;
  return (
    <View style={[styles.pill, { backgroundColor: bg }]} accessible>
      <Text style={[mvType.pill, { color }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    borderRadius: mv.radiusPill,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
});