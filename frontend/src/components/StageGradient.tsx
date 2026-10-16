/**
 * StageGradient — app-wide stage wash (trial).
 *
 * An absolute-fill SVG gradient laid behind screen content; each screen
 * keeps its flat background underneath as fallback, so removing the
 * trial is a one-line deletion per screen.
 *
 * Variants: 'violet' (neon brand wash), 'ink' (modern deep ink-violet
 * charcoal), 'dawn' (light sunrise peach → lavender → violet for a
 * positive vibe — pair only with dark-ink text, never white), 'navy'
 * (deep navy wash matching the after-signup priority picker backdrop),
 * and 'algae' (black-teal liquid-glass wash matching the web stage:
 * black → algae-deep → algae with a teal-blue lift — pair with light
 * text on LG.stage bases).
 */

import { StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

const RAMPS = {
  violet: ['#8B5CF6', '#6D28D9', '#2E1065'],
  ink: ['#1E1B33', '#141222', '#0C0B16'],
  dawn: ['#FFE2C2', '#C9B1F5', '#7C5CD6'],
  /** Deep navy wash — matches the after-signup priority picker backdrop. */
  navy: ['#2E3757', '#20263D', '#11142A'],
  /** Black-teal liquid glass — matches the web body stage (black base, algae depth, teal-blue lift). */
  algae: ['#0B4A3F', '#07332B', '#020404'],
} as const;

export function StageGradient({
  variant = 'violet',
}: {
  variant?: keyof typeof RAMPS;
}): React.JSX.Element {
  const [top, mid, bottom] = RAMPS[variant];
  return (
    <Svg style={styles.fill} width="100%" height="100%" pointerEvents="none">
      <Defs>
        <LinearGradient id={`stage-${variant}`} x1="0" y1="0" x2="0.55" y2="1">
          <Stop offset="0" stopColor={top} stopOpacity={1} />
          <Stop offset="0.45" stopColor={mid} stopOpacity={1} />
          <Stop offset="1" stopColor={bottom} stopOpacity={1} />
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width="100%" height="100%" fill={`url(#stage-${variant})`} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  fill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});

export default StageGradient;
