/**
 * HealthAreaCard - bento tiles for live areas, grouped rows for the rest.
 *
 * Color discipline (mobile-taste calibration): no rainbow. Tiles are
 * quiet white surfaces where hierarchy comes from type alone — small
 * muted label, large ink value, one CTA-green change line. Rows are
 * text plus chevron with hairline dividers. The only color on either
 * is the change line, never decoration.
 * - Value first. The real number is the hero of each tile (20 SemiBold,
 *   tabular). The area name sits small above it.
 * - Cards group by role. Live tiles are tappable objects in a 2 column
 *   bento grid. Quiet rows live inside one inset grouped card with
 *   hairline dividers, never twelve identical cards.
 * - Press feedback runs on the UI thread via PressScale (spring 0.97).
 *   Reduced motion collapses to opacity.
 */

import { StyleSheet, Text, View } from 'react-native';
import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
import { EXTRA_TONES, toneForCategory } from '@/theme/tones';
import { PressScale } from '@/components/PressScale';
import type { HealthAreaState } from '@/screens/HealthAreas/areas';
import type { HealthAreaId } from '@/screens/HealthAreas/areas';

/** Light pastel wash per area — soft color, ink text stays readable. */
export const AREA_TINT: Record<HealthAreaId, string> = {
  heart: '#FBE7EC',
  sleep: '#E9E3F7',
  activity: '#DDF2E7',
  nutrition: '#FBEFD8',
  weight: '#DFF0F8',
  wellbeing: '#DCEFE8',
  medications: '#E0EBFA',
  records: '#EFE6D8',
  skin: '#E9ECEE',
  substance: '#E9ECEE',
  cycle: '#FBE7EC',
  discipline: '#DCEFE8',
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
  const label = a11yLabel(area, change);
  const tint = AREA_TINT[area.id] ?? GV.paper;
  // Category tone bar: the pastel wash stays, the duotone deep color marks
  // the left edge so areas read by family at a glance.
  const toneBar =
    area.id === 'skin' ? EXTRA_TONES.slate[0]
    : area.id === 'substance' ? EXTRA_TONES.sand[0]
    : area.id === 'cycle' ? EXTRA_TONES.berry[0]
    : toneForCategory(area.id)[0];
  return (
    <PressScale
      onPress={onPress}
      accessibilityLabel={label}
      scaleTo={0.97}
      hitSlop={4}
      style={styles.tileOuter}
    >
      <View
        style={[styles.tile, { backgroundColor: tint, borderLeftWidth: 4, borderLeftColor: toneBar }]}
        accessible
        accessibilityLabel={label}
      >
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
    borderWidth: 1,
    borderColor: 'rgba(20, 32, 29, 0.08)',
    borderRadius: SPACE.rCard,
    padding: 12,
    minHeight: 116,
    justifyContent: 'flex-start',
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
    letterSpacing: 0.5,
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
    lineHeight: 24,
    letterSpacing: -0.4,
    color: GV.ink,
    fontVariant: ['tabular-nums'],
    marginTop: 4,
  },
  tileChange: {
    fontFamily: FONT.semi,
    fontSize: 13,
    lineHeight: 18,
    color: GV.cta,
    fontVariant: ['tabular-nums'],
    marginTop: 4,
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
  rowMain: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontFamily: FONT.regular,
    fontSize: 17,
    lineHeight: 23,
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
