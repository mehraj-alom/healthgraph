/**
 * HealthAreaCard - bento tiles for live areas, grouped rows for the rest.
 *
 * healthgraph skill: solid full-colour tiles (one colour per area from
 * the tone catalog), white centered type, radius 8. Rows are white text
 * on the dark grouped card with hairline dividers. Value first: the
 * real number is the hero of each tile (20 SemiBold, tabular).
 * Press feedback runs on the UI thread via PressScale (spring 0.97).
 * Reduced motion collapses to opacity.
 */

import { StyleSheet, Text, View } from 'react-native';
import { GV, TYPE, FONT } from '@/theme/guava';
import { PressScale } from '@/components/PressScale';
import type { HealthAreaState } from '@/screens/HealthAreas/areas';
import type { HealthAreaId } from '@/screens/HealthAreas/areas';

/** Solid fill per area — the soft tone, full-bleed, white type on top. */
export const AREA_SOLID: Record<HealthAreaId, string> = {
  heart: '#56837B',
  sleep: '#57507A',
  activity: '#96684A',
  nutrition: '#6E7F4E',
  weight: '#5C6E7C',
  wellbeing: '#66666F',
  medications: '#57507A',
  records: '#5C6E7C',
  skin: '#5A6078',
  substance: '#8A7A5C',
  cycle: '#8A4A55',
  discipline: '#66666F',
};

/** Back-compat tint map (kept so existing imports keep working). */
export const AREA_TINT: Record<HealthAreaId, string> = AREA_SOLID;

function a11yLabel(area: HealthAreaState, change?: string | null): string {
  return `${area.label}. ${area.headline}${change ? `. ${change}` : ''}`;
}

/** Live tile for the 2 column bento grid. Tappable metric object. */
export function HealthAreaTile({
  area,
  change,
  onPress,
}: {
  area: HealthAreaState;
  /** Optional quantified week-over-week line (descriptive, never a verdict). */
  change?: string | null;
  onPress?: () => void;
}) {
  const label = a11yLabel(area, change);
  const solid = AREA_SOLID[area.id] ?? '#5A6078';
  return (
    <PressScale
      onPress={onPress}
      accessibilityLabel={label}
      scaleTo={0.97}
      hitSlop={4}
      style={styles.tileOuter}
    >
      <View
        style={[styles.tile, { backgroundColor: solid }]}
        accessible
        accessibilityLabel={label}
      >
        <Text
          style={styles.tileLabel}
          numberOfLines={1}
          maxFontSizeMultiplier={1.4}
        >
          {area.label}
        </Text>
          <Text
            style={styles.tileValue}
            numberOfLines={3}
            maxFontSizeMultiplier={1.5}
          >
            {area.headline}
        </Text>
        {change ? (
          <Text
            style={styles.tileChange}
            numberOfLines={1}
            accessibilityLabel={`Change: ${change}`}
          >
            {change}
          </Text>
        ) : null}
      </View>
    </PressScale>
  );
}

/** Quiet row for the single grouped To start card. No card of its own. */
export function HealthAreaRow({
  area,
  onPress,
  last,
}: {
  area: HealthAreaState;
  onPress?: () => void;
  last?: boolean;
}) {
  const label = a11yLabel(area, null);
  return (
    <PressScale
      onPress={onPress}
      accessibilityLabel={label}
      scaleTo={0.98}
      hitSlop={4}
      style={[styles.rowOuter, last && styles.rowLast]}
    >
      <View style={styles.row} accessible accessibilityLabel={label}>
        <View style={styles.rowMain}>
          <Text style={styles.rowTitle} numberOfLines={1} maxFontSizeMultiplier={1.4}>
            {area.label}
          </Text>
          <Text style={styles.rowSub} numberOfLines={2}>
            {area.headline}
            {area.detail ? ` ${area.detail}` : ''}
          </Text>
        </View>
        {onPress ? (
          <Text style={styles.rowChev} maxFontSizeMultiplier={1.4}>
            ›
          </Text>
        ) : null}
      </View>
    </PressScale>
  );
}

/**
 * Back-compat single card. Kept so existing imports keep working.
 * New code should use HealthAreaTile (live grid) or HealthAreaRow
 * (grouped To start list).
 */
export function HealthAreaCard({
  area,
  change,
  onPress,
}: {
  area: HealthAreaState;
  /** Optional quantified week-over-week line (descriptive, never a verdict). */
  change?: string | null;
  onPress?: () => void;
}) {
  return <HealthAreaTile area={area} change={change} onPress={onPress} />;
}

const styles = StyleSheet.create({
  tileOuter: {
    flexGrow: 1,
    flexBasis: '47%',
    minWidth: 0,
  },
  tile: {
    borderRadius: 8,
    padding: 12,
    minHeight: 116,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  tileLabel: {
    ...TYPE.caption,
    color: 'rgba(255, 255, 255, 0.8)',
    textAlign: 'center',
  },
  tileValue: {
    fontFamily: FONT.semi,
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: -0.4,
    color: '#FFFFFF',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
    marginTop: 4,
  },
  tileChange: {
    fontFamily: FONT.semi,
    fontSize: 13,
    lineHeight: 18,
    color: 'rgba(255, 255, 255, 0.85)',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
    marginTop: 4,
  },
  rowOuter: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255, 255, 255, 0.12)',
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    minHeight: 64,
  },
  rowMain: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontFamily: FONT.regular,
    fontSize: 17,
    lineHeight: 23,
    color: '#FFFFFF',
  },
  rowSub: {
    ...TYPE.caption,
    color: GV.fog,
  },
  rowChev: {
    fontSize: 20,
    color: GV.fog,
  },
});
