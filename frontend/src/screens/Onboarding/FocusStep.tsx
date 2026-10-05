/**
 * FocusStep — onboarding personalization step 2 (multi-select, optional).
 *
 * Areas to improve or monitor, framed in neutral wellness language ("areas
 * of attention", never conditions or diagnoses). Skipping is allowed.
 *
 * Look: photographic picker grid (duotone gradient tiles, centered
 * labels, teal selection ring). Ids and labels are pinned by batch6a
 * tests to the engine catalog — visuals only change here.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Reveal } from '@/components/home/Reveal';
import { FONT, GV, TYPE } from '@/theme/guava';
import { EXTRA_TONES, TILE_TONES } from '@/theme/tones';
import { FOCUS_AREAS } from './options';

/** Muted photographic duotones, one mood per area (top → bottom). */
const FALLBACK_TONE = EXTRA_TONES.slate;

export function FocusTile({
  id,
  label,
  hint,
  active,
  onToggle,
  fullWidth,
}: {
  id: string;
  label: string;
  hint: string;
  active: boolean;
  onToggle: () => void;
  fullWidth?: boolean;
}) {
  const tone = (TILE_TONES as Readonly<Record<string, readonly [string, string]>>)[id] ?? FALLBACK_TONE;
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: active }}
      accessibilityLabel={`${label}. ${hint}`}
      style={({ pressed }) => [
        styles.tile,
        fullWidth && styles.tileFull,
        active && styles.tileOn,
        pressed && { opacity: 0.85 },
      ]}
    >
      <Svg style={styles.tileArt} width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={`fg-${id}`} x1="0" y1="0" x2="0.7" y2="1">
            <Stop offset="0" stopColor={tone[0]} stopOpacity={1} />
            <Stop offset="1" stopColor={tone[1]} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width="100%" height="100%" fill={`url(#fg-${id})`} />
        <Rect x={0} y={0} width="100%" height="100%" fill="#000000" opacity={0.22} />
      </Svg>
      {active ? (
        <View style={styles.check}>
          <Text style={styles.checkGlyph}>✓</Text>
        </View>
      ) : null}
      <Text style={styles.tileLabel} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

export function FocusStep({
  selected,
  onToggle,
}: {
  selected: readonly string[];
  onToggle: (id: string) => void;
}) {
  const rows: typeof FOCUS_AREAS[] = [];
  for (let i = 0; i < FOCUS_AREAS.length; i += 2) {
    rows.push(FOCUS_AREAS.slice(i, i + 2));
  }
  return (
    <View style={styles.wrap}>
      <Reveal>
        <Text style={styles.headline}>Where should we focus?</Text>
      </Reveal>
      <Reveal>
        <Text style={styles.sub}>Pick as many as you like.</Text>
      </Reveal>
      <View style={styles.grid} accessibilityRole="list">
        {rows.map((row, r) => (
          <View key={r} style={styles.row}>
            {row.map(area => (
              <FocusTile
                key={area.id}
                id={area.id}
                label={area.label}
                hint={area.hint}
                active={selected.includes(area.id)}
                onToggle={() => onToggle(area.id)}
                fullWidth={row.length === 1}
              />
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    gap: 8,
    paddingTop: 8,
  },
  headline: {
    fontWeight: '600',
    fontSize: 32,
    lineHeight: 38,
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: -0.6,
  },
  sub: {
    fontWeight: '400',
    fontSize: 15,
    lineHeight: 21,
    color: 'rgba(233, 240, 255, 0.66)',
    textAlign: 'center',
    alignSelf: 'center',
  },
  grid: {
    gap: 12,
    marginTop: 12,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  tile: {
    flex: 1,
    aspectRatio: 1.5,
    borderRadius: 16,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.10)',
    backgroundColor: 'rgba(23, 29, 44, 0.64)',
  },
  tileFull: {
    aspectRatio: undefined,
    height: 112,
  },
  tileOn: {
    borderColor: '#FFFFFF',
  },
  tileArt: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  tileLabel: {
    fontWeight: '500',
    fontSize: 15,
    lineHeight: 20,
    color: '#FFFFFF',
    textAlign: 'center',
    paddingHorizontal: 10,
    textShadowColor: 'rgba(0, 0, 0, 0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  check: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkGlyph: {
    color: '#0B0F1A',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 16,
  },
});
