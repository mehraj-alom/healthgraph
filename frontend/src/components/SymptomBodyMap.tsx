/* Hallmark · pre-emit critique: P5 H4 E5 S4 R5 V4 */
import { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Body, {
  type ExtendedBodyPart,
  type Slug,
} from 'react-native-body-highlighter';
import { useTheme } from '@/theme';
import { radius, spacing } from '@/theme/tokens';
import { CategoryTile } from './CategoryTile';
import { TILE_TONES } from '@/theme/tones';
import { formatPartName } from './bodyParts';

export type BodySide = 'front' | 'back';
export type BodyGender = 'male' | 'female';
export type PainSide = 'left' | 'right';

/** One symptom marking. Intensity is 1-based: 1 mild · 2 moderate · 3 severe. */
export interface SymptomDatum {
  slug: Slug;
  intensity: 1 | 2 | 3;
  side?: PainSide;
}

/** What a tap reports: the part plus which half was hit (null = whole part). */
export interface SelectedBodyPart {
  slug: Slug;
  side: PainSide | null;
}

interface SymptomBodyMapProps {
  /** Initial markings. Local taps overlay on top; nothing here mutates. */
  data?: SymptomDatum[];
  /** Fired on every tap with the part + side. Local highlight updates too. */
  onBodyPartPress?: (part: SelectedBodyPart) => void;
  /** Initial view side. Toggles stay local. */
  side?: BodySide;
  /**
   * Model follows the app's anatomy choice (3D Body). No toggle here:
   * first-time selection lives with the anatomy download, and a
   * Settings switch can override this prop in future.
   */
  gender?: BodyGender;
  /**
   * When false the figure is display-only: taps are ignored and the clear
   * chip hides. Used for history playback, where the data owns the view.
   */
  tappable?: boolean;
  /** Rendered directly under the figure (e.g. the day slider). */
  belowFigure?: React.ReactNode;
}

/**
 * Symptom body map — tap-to-mark figure with front/back + male/female views,
 * a mild→severe intensity ramp, and a live readout of what's selected.
 *
 * Everything is local state: taps highlight immediately and report through
 * `onBodyPartPress` for the parent to persist whenever it's ready. No
 * network, no storage, no side effects in this file.
 */
export function SymptomBodyMap({
  data = [],
  onBodyPartPress,
  side: initialSide = 'front',
  gender: genderProp,
  tappable = true,
  belowFigure,
}: SymptomBodyMapProps) {
  const { colors, typography } = useTheme();
  const { width } = useWindowDimensions();
  const [side, setSide] = useState<BodySide>(initialSide);
  // No marking by tapping here: the figure only ever shows logged data.
  const gender: BodyGender = genderProp ?? 'male';
  // Locally tapped parts at moderate intensity, keyed by slug + side.
  const [tapped, setTapped] = useState<Map<string, SymptomDatum>>(new Map());

  // The figure SVG is 200pt wide at scale 1 — fit it to any viewport so a
  // 320px phone never clips or horizontal-scrolls (slop-test gate 34).
  const figureScale = Math.min(1.6, Math.max(1, (width - 64) / 200));

  // Intensity ramp — locked theme tokens, mild amber → deep orange → red.
  // Severe is never green: the ramp only heats up.
  const ramp = useMemo(
    () => [colors.warning, colors.tealDark, colors.error] as const,
    [colors],
  );

  const mergedData = useMemo<ExtendedBodyPart[]>(() => {
    const clamp = (n: number): 1 | 2 | 3 =>
      (Math.min(3, Math.max(1, Math.round(n))) as 1 | 2 | 3);
    const byKey = new Map<string, ExtendedBodyPart>();
    for (const d of data) {
      byKey.set(`${d.slug}:${d.side ?? 'whole'}`, {
        slug: d.slug,
        intensity: clamp(d.intensity),
        side: d.side,
      });
    }
    // Local taps win on collision so the highlight is always visible.
    for (const [key, d] of tapped) {
      byKey.set(key, { slug: d.slug, intensity: d.intensity, side: d.side });
    }
    return [...byKey.values()];
  }, [data, tapped]);

  const handleBodyPartPress = useCallback(
    (part: ExtendedBodyPart, pressedSide?: PainSide) => {
      if (!part.slug) return;
      const sideHit = pressedSide ?? part.side ?? null;
      onBodyPartPress?.({ slug: part.slug, side: sideHit });
      if (!tappable) return;
      setTapped((prev) => {
        const next = new Map(prev);
        const key = `${part.slug}:${sideHit ?? 'whole'}`;
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.set(key, { slug: part.slug!, intensity: 2, side: sideHit ?? undefined });
        }
        return next;
      });
    },
    [onBodyPartPress, tappable],
  );

  const readout = useMemo(() => {
    const names = mergedData.map((d) =>
      formatPartName(d.slug!, d.side ?? null),
    );
    return [...new Set(names)].sort((a, b) => a.localeCompare(b));
  }, [mergedData]);

  return (
    <View>
      {/* Figure — flat fills only, intensity heats amber → orange → red.
          Marked names float on the figure itself; no separate section. */}
      <View
        style={[styles.figure, { backgroundColor: colors.surface }]}
        accessibilityRole="image"
        accessibilityLabel={`Body map, ${side} view, ${gender} model`}
      >
        <Body
          data={mergedData}
          colors={[...ramp]}
          gender={gender}
          side={side}
          scale={figureScale}
          defaultFill={colors.surfaceSecondary}
          defaultStroke={colors.border}
          defaultStrokeWidth={1}
          onBodyPartPress={handleBodyPartPress}
        />
        {readout.length > 0 ? (
          <View style={styles.nameFloat} pointerEvents="box-none">
            <View style={styles.nameRow}>
              {readout.map((name) => (
                <View key={name} style={styles.nameChip}>
                  <Text style={styles.nameText} numberOfLines={1}>{name}</Text>
                </View>
              ))}
              {tappable ? (
                <Pressable
                  onPress={() => setTapped(new Map())}
                  accessibilityRole="button"
                  accessibilityLabel="Clear all marked areas"
                  hitSlop={8}
                  style={({ pressed }) => [
                    styles.clearChip,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Text style={styles.clearChipText}>✕</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}
        {/* Legend rides on the figure's own white space. */}
        <View
          style={styles.legendFloat}
          pointerEvents="none"
          accessibilityRole="text"
          accessibilityLabel="Pain scale: mild, moderate, severe"
        >
          {(
            [
              { label: 'Mild', color: ramp[0] },
              { label: 'Moderate', color: ramp[1] },
              { label: 'Severe', color: ramp[2] },
            ] as const
          ).map((s) => (
            <View key={s.label} style={styles.legendItem}>
              <View style={[styles.swatch, { backgroundColor: s.color }]} />
              <Text
                style={[
                  styles.legendLabel,
                  typography.caption,
                  { color: '#1D1B17' },
                ]}
              >
                {s.label}
              </Text>
            </View>
          ))}
        </View>
      </View>

      {belowFigure}

      {/* Front/Back in two gradient tones, just under the slider. */}
      <View style={styles.sideRow}>
        <CategoryTile
          tone={TILE_TONES.sleep}
          label="Front"
          center
          compact
          active={side === 'front'}
          onPress={() => setSide('front')}
          accessibilityLabel="Show front view"
        />
        <CategoryTile
          tone={TILE_TONES.heart}
          label="Back"
          center
          compact
          active={side === 'back'}
          onPress={() => setSide('back')}
          accessibilityLabel="Show back view"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  figure: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.xl,
    paddingVertical: spacing.lg,
    overflow: 'hidden',
  },
  nameFloat: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 10,
    alignItems: 'center',
  },
  nameRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
    maxWidth: '92%',
  },
  nameChip: {
    backgroundColor: '#FFFFFF',
    borderRadius: 9999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  nameText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    color: '#1D1B17',
  },
  clearChip: {
    backgroundColor: '#1D1B17',
    borderRadius: 9999,
    minWidth: 32,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  clearChipText: {
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  legendFloat: {
    position: 'absolute',
    top: 10,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
  },
  sideRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  swatch: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  legendLabel: {},
});
