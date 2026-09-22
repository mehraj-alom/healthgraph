/**
 * HealthAreaCard - bento tiles for live areas, grouped rows for the rest.
 *
 * Anti-slop notes (mobile-taste):
 * - No icon chip row. Live tiles carry a 3px accent spine in the area
 *   color, quiet rows carry an 8px dot. One accent per tile, never a
 *   tinted square plus a colored glyph plus a pill.
 * - Value first. The real number is the hero of each tile (20 SemiBold,
 *   tabular). The area name sits small above it.
 * - Cards group by role. Live tiles are tappable objects in a 2 column
 *   bento grid. To start rows live inside one inset grouped card with
 *   hairline dividers, never twelve identical cards.
 * - Press feedback runs on the UI thread via PressScale (spring 0.97).
 *   Reduced motion collapses to opacity.
 */

import { StyleSheet, Text, View } from 'react-native';
import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
import { PressScale } from '@/components/PressScale';
import type { HealthAreaState } from '@/screens/HealthAreas/areas';
import type { HealthAreaId } from '@/screens/HealthAreas/areas';

export const AREA_ACCENT: Record<HealthAreaId, string> = {
  heart: GV.fx.pink,
  sleep: GV.fx.purple,
  activity: GV.fx.green,
  nutrition: GV.fx.amber,
  weight: GV.fx.sky,
  wellbeing: GV.cta,
  medications: GV.fx.blue,
  records: GV.fx.brown,
  skin: GV.muted,
  substance: GV.muted,
  cycle: GV.fx.pink,
  discipline: GV.cta,
};

const SOURCE_LABEL: Record<string, string> = {
  device: 'On this device',
  server: 'Synced',
};

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
  const accent = AREA_ACCENT[area.id] ?? GV.muted;
  const sourceLabel = SOURCE_LABEL[area.source] ?? null;
  const label = a11yLabel(area, change);
  return (
    <PressScale
      onPress={onPress}
      accessibilityLabel={label}
      scaleTo={0.97}
      hitSlop={4}
      style={styles.tileOuter}
    >
      <View style={styles.tile} accessible accessibilityLabel={label}>
        <View style={[styles.spine, { backgroundColor: accent }]} />
        <View style={styles.tileHead}>
          <Text
            style={styles.tileLabel}
            numberOfLines={1}
            maxFontSizeMultiplier={1.4}
          >
            {area.label}
          </Text>
          {onPress ? (
            <Text style={styles.tileChev} maxFontSizeMultiplier={1.4}>
              ›
            </Text>
          ) : null}
        </View>
        <Text
          style={styles.tileValue}
          numberOfLines={2}
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
        <Text
          style={styles.tileSource}
          numberOfLines={1}
          maxFontSizeMultiplier={1.4}
        >
          {sourceLabel ?? 'Live'}
        </Text>
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
  const accent = AREA_ACCENT[area.id] ?? GV.muted;
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
        <View style={[styles.dot, { backgroundColor: accent }]} />
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
    backgroundColor: GV.card,
    borderRadius: SPACE.rCard,
    padding: 16,
    minHeight: 132,
    justifyContent: 'flex-start',
    overflow: 'hidden',
  },
  spine: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
  },
  tileHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  tileLabel: {
    ...TYPE.caption,
    color: GV.muted,
    flex: 1,
  },
  tileChev: {
    fontSize: 18,
    lineHeight: 22,
    color: GV.muted,
  },
  tileValue: {
    fontFamily: FONT.semi,
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.3,
    color: GV.ink,
    fontVariant: ['tabular-nums'],
    marginTop: 6,
  },
  tileChange: {
    fontFamily: FONT.semi,
    fontSize: 13,
    lineHeight: 18,
    color: GV.cta,
    fontVariant: ['tabular-nums'],
    marginTop: 4,
  },
  tileSource: {
    ...TYPE.caption,
    fontSize: 12,
    color: GV.muted,
    marginTop: 6,
  },
  rowOuter: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: GV.line,
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
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  rowMain: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    ...TYPE.button,
    fontSize: 15,
    color: GV.ink,
  },
  rowSub: {
    ...TYPE.caption,
    color: GV.body,
  },
  rowChev: {
    fontSize: 20,
    color: GV.muted,
  },
});
