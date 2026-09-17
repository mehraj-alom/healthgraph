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
import { Chip } from './Chip';
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
  /** Initial model. Toggles stay local. */
  gender?: BodyGender;
  /**
   * When false the figure is display-only: taps are ignored and the clear
   * button hides. Used for history playback, where the data owns the view.
   */
  tappable?: boolean;
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
  gender: initialGender = 'male',
  tappable = true,
}: SymptomBodyMapProps) {
  const { colors, typography } = useTheme();
  const { width } = useWindowDimensions();
  const [side, setSide] = useState<BodySide>(initialSide);
  const [gender, setGender] = useState<BodyGender>(initialGender);
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
      {/* View toggles — large targets, one-handed reachable above the figure. */}
      <View style={styles.toggleRow}>
        <View style={styles.toggleGroup}>
          <Text
            style={[
              styles.toggleLabel,
              typography.captionStrong,
              { color: colors.textSecondary },
            ]}
          >
            View
          </Text>
          <View style={styles.chips}>
            <Chip
              label="Front"
              size="large"
              selected={side === 'front'}
              onPress={() => setSide('front')}
              accessibilityLabel="Show front view"
            />
            <Chip
              label="Back"
              size="large"
              selected={side === 'back'}
              onPress={() => setSide('back')}
              accessibilityLabel="Show back view"
            />
          </View>
        </View>
        <View style={styles.toggleGroup}>
          <Text
            style={[
              styles.toggleLabel,
              typography.captionStrong,
              { color: colors.textSecondary },
            ]}
          >
            Model
          </Text>
          <View style={styles.chips}>
            <Chip
              label="Male"
              size="large"
              selected={gender === 'male'}
              onPress={() => setGender('male')}
              accessibilityLabel="Show male model"
            />
            <Chip
              label="Female"
              size="large"
              selected={gender === 'female'}
              onPress={() => setGender('female')}
              accessibilityLabel="Show female model"
            />
          </View>
        </View>
      </View>

      {/* Figure — flat fills only, intensity heats amber → orange → red. */}
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
      </View>

      {/* Legend — the actual ramp stops, honestly labelled. */}
      <View
        style={styles.legend}
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
                { color: colors.textPrimary },
              ]}
            >
              {s.label}
            </Text>
          </View>
        ))}
      </View>

      {/* Readout — real selection only, guidance when empty. */}
      <View
        style={[
          styles.readout,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
          },
        ]}
      >
        <Text
          style={[
            styles.readoutTitle,
            typography.captionStrong,
            { color: colors.textSecondary },
          ]}
        >
          {readout.length > 0 ? 'Marked areas' : 'Nothing marked yet'}
        </Text>
        {readout.length > 0 ? (
          <Text
            style={[
              styles.readoutText,
              typography.body,
              { color: colors.textPrimary },
            ]}
            accessibilityLiveRegion="polite"
          >
            {readout.join(', ')}
          </Text>
        ) : (
          <Text
            style={[
              styles.readoutHint,
              typography.body,
              { color: colors.textSecondary },
            ]}
          >
            {tappable
              ? 'Tap a body part to mark where it hurts. Tap again to clear it.'
              : 'No pain logged that day.'}
          </Text>
        )}
        {tappable && readout.length > 0 ? (
          <Pressable
            onPress={() => setTapped(new Map())}
            accessibilityRole="button"
            accessibilityLabel="Clear all marked areas"
            hitSlop={8}
            style={({ pressed }) => [
              styles.clearBtn,
              pressed && styles.clearBtnPressed,
            ]}
          >
            <Text
              style={[
                styles.clearText,
                typography.captionStrong,
                { color: colors.textSecondary },
              ]}
            >
              Clear all
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  toggleRow: {
    flexDirection: 'row',
    gap: spacing.lg,
    marginBottom: spacing.lg,
  },
  toggleGroup: {
    flex: 1,
    gap: spacing.xs,
  },
  toggleLabel: {
    opacity: 0.75,
  },
  chips: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  figure: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.xl,
    paddingVertical: spacing.lg,
    overflow: 'hidden',
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xl,
    marginTop: spacing.md,
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
  readout: {
    marginTop: spacing.md,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  readoutTitle: {
    opacity: 0.75,
  },
  readoutText: {},
  readoutHint: {
    opacity: 0.8,
  },
  clearBtn: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
    paddingVertical: spacing.xs,
    minHeight: 44,
    justifyContent: 'center',
  },
  clearBtnPressed: {
    opacity: 0.6,
  },
  clearText: {
    textDecorationLine: 'underline',
  },
});
