/**
 * AvatarStack — 6.5: overlapping circular avatars with 2px white ring,
 * optional "+N" caption, optional "+" join button.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { mv, mvType } from '@/theme/movements';

export interface Avatar {
  initials: string;
  bg?: string;
}

interface AvatarStackProps {
  avatars: Avatar[];
  /** Render a circular "+" join button appended to the stack. */
  plus?: boolean;
  /** Caption following the avatars, e.g. "2 members". */
  caption?: string;
  size?: number;
}

const AVATAR_BGS = ['#D9FF6E', '#0B6852', '#1B2425', '#F0A98A'];

export function AvatarStack({
  avatars,
  plus = true,
  caption,
  size = 30,
}: AvatarStackProps) {
  return (
    <View style={styles.row} accessible>
      {avatars.slice(0, 3).map((a, i) => {
        const bg = a.bg ?? AVATAR_BGS[i % AVATAR_BGS.length];
        const textColor = bg === mv.accentLime ? mv.textOnLightPrimary : mv.surfaceWhite;
        return (
          <View
            key={i}
            style={[
              styles.avatar,
              {
                width: size,
                height: size,
                borderRadius: size / 2,
                backgroundColor: bg,
                marginLeft: i === 0 ? 0 : -size * 0.33,
                borderColor: mv.surfaceWhite,
                borderWidth: 2,
              },
            ]}
          >
            <Text style={[mvType.pill, { color: textColor, fontWeight: '700', fontSize: Math.max(10, size * 0.4) }]}>
              {a.initials}
            </Text>
          </View>
        );
      })}
      {plus ? (
        <View
          style={[
            styles.avatar,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              marginLeft: -size * 0.33,
              backgroundColor: mv.textOnLightPrimary,
              borderColor: mv.surfaceWhite,
              borderWidth: 2,
              alignItems: 'center',
              justifyContent: 'center',
            },
          ]}
        >
          <Text style={[mvType.pill, { color: mv.surfaceWhite, fontSize: Math.max(12, size * 0.45) }]}>+</Text>
        </View>
      ) : null}
      {caption ? (
        <Text style={[mvType.caption, { color: mv.textOnLightSecondary, marginLeft: mv.spaceIconLabel }]}>
          {caption}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});