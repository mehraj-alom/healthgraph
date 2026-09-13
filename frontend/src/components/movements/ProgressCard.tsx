/**
 * ProgressCard — 6.2: colored card (lime or teal) with label row, a caption
 * line ("Your progress"), one giant stat, a pill progress bar, a pill CTA
 * button in the inverse color, and an avatar pair bottom-right.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet, type ViewStyle } from 'react-native';
import { mv, mvType } from '@/theme/movements';
import { PillBar } from './PillBar';
import { AvatarStack, type Avatar } from './AvatarStack';

type ProgressVariant = 'lime' | 'teal';

interface ProgressCardProps {
  variant: ProgressVariant;
  label: string;
  caption: string;
  value: string;
  progress: number;
  buttonLabel: string;
  onPress: () => void;
  avatars?: Avatar[];
  style?: ViewStyle;
}

const PALETTE: Record<
  ProgressVariant,
  {
    bg: string;
    text: string;
    subText: string;
    track: string;
    fill: string;
    buttonBg: string;
    buttonText: string;
  }
> = {
  lime: {
    bg: mv.accentLime,
    text: mv.textOnLightPrimary,
    subText: 'rgba(20,20,20,0.60)',
    track: 'rgba(0,0,0,0.18)',
    fill: mv.textOnLightPrimary,
    buttonBg: mv.textOnLightPrimary,
    buttonText: mv.surfaceWhite,
  },
  teal: {
    bg: mv.surfaceTealDeep,
    text: mv.surfaceWhite,
    subText: 'rgba(255,255,255,0.60)',
    track: 'rgba(255,255,255,0.25)',
    fill: mv.surfaceWhite,
    buttonBg: mv.surfaceWhite,
    buttonText: mv.textOnLightPrimary,
  },
};

export function ProgressCard({
  variant,
  label,
  caption,
  value,
  progress,
  buttonLabel,
  onPress,
  avatars,
  style,
}: ProgressCardProps) {
  const p = PALETTE[variant];
  return (
    <View style={[styles.card, { backgroundColor: p.bg }, style]} accessible>
      <Text style={[mvType.labelCard, { color: p.text }]}>{label}</Text>

      <Text style={[mvType.caption, { color: p.subText }]}>{caption}</Text>

      <Text style={[mvType.statGiant, styles.statNums, { color: p.text }]}>
        {value}
      </Text>

      <PillBar progress={progress} track={p.track} fill={p.fill} height={9} />

      <View style={styles.footer}>
        <Pressable
          onPress={onPress}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: p.buttonBg },
            pressed && { opacity: 0.75, transform: [{ scale: 0.97 }] },
          ]}
          accessibilityRole="button"
          accessibilityLabel={buttonLabel}
        >
          <Text style={[mvType.pill, { color: p.buttonText, fontWeight: '700' }]}>
            {buttonLabel}
          </Text>
        </Pressable>
        {avatars && avatars.length > 0 ? (
          <AvatarStack avatars={avatars} plus={false} size={26} />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: mv.radiusCard,
    padding: mv.spaceCard,
    gap: 10,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
  },
  statNums: {
    fontVariant: ['tabular-nums'],
  },
  button: {
    alignSelf: 'flex-start',
    borderRadius: mv.radiusPill,
    paddingHorizontal: 20,
    paddingVertical: 9,
    marginTop: 2,
  },
});