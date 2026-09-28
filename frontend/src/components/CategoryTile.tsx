/**
 * CategoryTile — the shared duotone selection tile.
 *
 * One component for "pick a health category" surfaces: muted duotone
 * gradient, label, optional hint/icon, teal ring + check when active.
 * `surface="ink"` matches the onboarding tiles (dark); `surface="wash"`
 * renders the same hues as a soft wash for light screens.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { FONT, GV } from '@/theme/guava';
import { withAlpha, type Tone } from '@/theme/tones';

interface CategoryTileProps {
  tone: Tone;
  label: string;
  hint?: string;
  glyph?: string;
  active?: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
  surface?: 'ink' | 'wash';
  fullWidth?: boolean;
  /** Compact rows (mode toggles): shorter tile, single-line hint. */
  compact?: boolean;
  /** Center glyph + label in the middle of the tile. */
  center?: boolean;
  /** Larger label for two-choice pickers. */
  large?: boolean;
}

export function CategoryTile({
  tone,
  label,
  hint,
  glyph,
  active = false,
  onPress,
  accessibilityLabel,
  surface = 'ink',
  fullWidth = false,
  compact = false,
  center = false,
  large = false,
}: CategoryTileProps) {
  const gid = `ct-${label.replace(/[^a-z0-9]/gi, '').slice(0, 12)}`;
  // Identical pair = flat skill fill: paint it directly so the colour
  // covers the tile edge to edge with no gradient banding.
  const solid = surface === 'ink' && tone[0] === tone[1] ? tone[0] : undefined;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: active }}
      accessibilityLabel={accessibilityLabel ?? `${label}${hint ? `. ${hint}` : ''}`}
      style={({ pressed }) => [
        styles.tile,
        compact && styles.tileCompact,
        fullWidth && styles.tileFull,
        center && styles.tileCenter,
        surface === 'wash' && styles.tileWash,
        // Base tone under the art: the tile is fully coloured even
        // where the gradient layer ends.
        surface === 'ink' && { backgroundColor: tone[0] },
        solid != null && { backgroundColor: solid },
        active && styles.tileOn,
        pressed && { opacity: 0.85 },
      ]}
    >
      {solid != null ? null : surface === 'ink' ? (
        <Svg style={styles.art} width="100%" height="100%" preserveAspectRatio="none">
          <Defs>
            <LinearGradient id={gid} x1="0" y1="0" x2="0.7" y2="1">
              <Stop offset="0" stopColor={tone[0]} stopOpacity={1} />
              <Stop offset="1" stopColor={tone[1]} stopOpacity={1} />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width="100%" height="100%" fill={`url(#${gid})`} />
          <Rect x={0} y={0} width="100%" height="100%" fill="#000000" opacity={0.22} />
        </Svg>
      ) : (
        <View style={[styles.washArt, { backgroundColor: withAlpha(tone[1], 0.22) }]} pointerEvents="none" />
      )}
      {glyph ? <Text style={[styles.glyph, compact && styles.glyphCompact, center && styles.glyphCenter, surface === 'wash' && { color: tone[0] }]}>{glyph}</Text> : null}
      {active ? (
        <View style={styles.check}>
          <Text style={styles.checkGlyph}>✓</Text>
        </View>
      ) : null}
      <Text style={[styles.tileLabel, compact && styles.tileLabelCompact, center && styles.tileLabelCenter, large && styles.tileLabelLarge, surface === 'wash' && { color: GV.ink }]} numberOfLines={compact ? 1 : 2}>
        {label}
      </Text>
      {hint ? (
        <Text style={[styles.tileHint, surface === 'wash' && { color: GV.body }]} numberOfLines={1}>
          {hint}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    minHeight: 104,
    borderRadius: 16,
    overflow: 'hidden',
    padding: 12,
    justifyContent: 'flex-end',
    gap: 2,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  tileCompact: {
    minHeight: 88,
    padding: 10,
  },
  tileFull: {
    flexBasis: '100%',
  },
  tileCenter: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  tileWash: {
    backgroundColor: GV.card,
    borderColor: GV.line,
  },
  tileOn: {
    borderColor: GV.teal,
  },
  art: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  washArt: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  glyph: {
    fontSize: 20,
    color: '#FFFFFF',
    marginBottom: 2,
  },
  glyphCompact: {
    fontSize: 15,
    marginBottom: 0,
  },
  glyphCenter: {
    textAlign: 'center',
    marginBottom: 4,
  },
  check: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: GV.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkGlyph: {
    color: '#06231B',
    fontSize: 13,
    fontFamily: FONT.bold,
  },
  tileLabel: {
    fontFamily: FONT.semi,
    fontSize: 15,
    lineHeight: 20,
    color: '#FFFFFF',
  },
  tileLabelCompact: {
    fontSize: 14,
    lineHeight: 18,
  },
  tileLabelCenter: {
    textAlign: 'center',
  },
  tileLabelLarge: {
    fontSize: 19,
    lineHeight: 24,
  },
  tileHint: {
    fontSize: 12,
    lineHeight: 16,
    color: GV.fog,
  },
});
