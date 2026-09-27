import { useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
import { useToast } from '@/components/Toast';
import { Chip } from '@/components';
import {
  logScannedMeal,
  type FoodScanConfidence,
  type FoodScanResult,
} from '@/services/nutritionService';
import { MEAL_TYPES, suggestMealType, type MealType } from './mealTypes';
import { getCachedPatientId } from '@/services/patientIdentity';
import { saveFoodScanBreakdown } from '@/db/queries/foodScans';

void FONT;

const STEP_G = 10;
const MIN_G = 10;

const CONFIDENCE_DOT: Record<FoodScanConfidence, string> = {
  high: GV.cta,
  med: GV.fx.amber,
  low: GV.muted,
};

const CONFIDENCE_LABEL: Record<FoodScanConfidence, string> = {
  high: 'High confidence',
  med: 'Medium confidence',
  low: 'Low confidence',
};

/** Honest range from the estimate — never fake-exact. */
function kcalRange(totalKcal: number, confidence: FoodScanConfidence): string {
  const spread = confidence === 'high' ? 0.1 : confidence === 'med' ? 0.2 : 0.3;
  const lo = Math.max(0, Math.floor((totalKcal * (1 - spread)) / 10) * 10);
  const hi = Math.ceil((totalKcal * (1 + spread)) / 10) * 10;
  return `~${lo}\u2013${hi} kcal`;
}

function scale(value: number, factor: number): number {
  return Math.round(value * factor * 10) / 10;
}

export default function ScanResultSheet({
  photoUri,
  photoLabel = 'Photo of your meal',
  result,
  onRetake,
  onLogged,
}: {
  /** Local photo URI, remote product image, or null (no thumbnail). */
  photoUri: string | null;
  photoLabel?: string;
  result: FoodScanResult;
  onRetake: () => void;
  onLogged: (serverSaved: boolean) => void;
}) {
  const toast = useToast();
  const [grams, setGrams] = useState<number[]>(() =>
    result.items.map((item) => item.grams),
  );
  // Consumption classification: a scan identifies food, it never becomes a
  // meal on its own. Suggested from time of day; the user confirms or
  // changes it before anything is logged. Retake (reset) cancels outright.
  const [mealType, setMealType] = useState<MealType>(() => suggestMealType());
  const [logging, setLogging] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      result.items.map((item, i) => {
        const nextGrams = grams[i] ?? item.grams;
        const factor = item.grams > 0 ? nextGrams / item.grams : 1;
        return {
          item,
          grams: nextGrams,
          kcal: Math.round(item.kcal * factor),
          protein: scale(item.protein_g, factor),
          carbs: scale(item.carbs_g, factor),
          fat: scale(item.fat_g, factor),
          // Retail barcode survives portion edits into the breakdown row.
          ...(item.barcode ? { barcode: item.barcode } : {}),
        };
      }),
    [result.items, grams],
  );

  const totalKcal = useMemo(
    () => rows.reduce((sum, row) => sum + row.kcal, 0),
    [rows],
  );

  const adjust = (index: number, delta: number) => {
    setGrams((prev) =>
      prev.map((g, i) => (i === index ? Math.max(MIN_G, g + delta) : g)),
    );
  };

  const logMeal = async () => {
    if (logging) return;
    setLogging(true);
    setLogError(null);
    const label = result.items.map((item) => item.label).join(', ').slice(0, 200) || 'Scanned meal';
    try {
      const { serverSaved } = await logScannedMeal(totalKcal, label, mealType);
      // Persist the per-item estimate so the timeline can show exactly
      // what the camera saw. Best-effort and local-only: a failure here
      // never fails the meal log itself.
      try {
        const pid = getCachedPatientId();
        if (pid) {
          const now = new Date();
          const logDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
          await saveFoodScanBreakdown(pid, {
            logDate,
            mealLabel: label,
            mealType,
            items: rows.map((r) => ({
              label: r.item.label,
              grams: r.grams,
              kcal: r.kcal,
              protein_g: r.protein,
              carbs_g: r.carbs,
              fat_g: r.fat,
              confidence: result.confidence,
            })),
            totalKcal,
            confidence: result.confidence,
          });
        }
      } catch {
        // Timeline detail is a bonus — the logged totals are already safe.
      }
      toast.success(
        serverSaved
          ? `${mealType} logged.`
          : 'Saved on this device. It will sync when you are back online.',
      );
      onLogged(serverSaved);
    } catch (err) {
      setLogError(
        err instanceof Error ? err.message : 'Could not log this meal. Please try again.',
      );
    } finally {
      setLogging(false);
    }
  };

  return (
    <View style={styles.sheet}>
      <View style={styles.headRow}>
        {photoUri ? (
          <Image source={{ uri: photoUri }} style={styles.thumb} accessibilityLabel={photoLabel} />
        ) : null}
        <View style={styles.headText}>
          <Text style={styles.title}>Estimate</Text>
          <View style={styles.confRow}>
            <View
              style={[styles.confDot, { backgroundColor: CONFIDENCE_DOT[result.confidence] }]}
            />
            <Text style={styles.confText}>{CONFIDENCE_LABEL[result.confidence]}</Text>
          </View>
        </View>
        <Pressable
          onPress={onRetake}
          accessibilityRole="button"
          accessibilityLabel="Retake photo"
          hitSlop={8}
          style={({ pressed }) => [styles.retake, pressed && { opacity: 0.6 }]}
        >
          <Text style={styles.retakeText}>Retake</Text>
        </Pressable>
      </View>

      <Text style={styles.hero} accessibilityLabel={`Estimated total ${totalKcal} kilocalories`}>
        {totalKcal} kcal
      </Text>
      <Text style={styles.range}>
        {kcalRange(totalKcal, result.confidence)}. Estimate, not exact.
      </Text>

      <Text style={styles.sectionLabel}>Items</Text>
      <View style={styles.items}>
        {rows.map((row, i) => (
          <View key={`${row.item.label}-${i}`} style={styles.itemRow}>
            <View style={styles.itemInfo}>
              <View style={styles.itemLabelRow}>
                <View
                  style={[styles.itemDot, { backgroundColor: CONFIDENCE_DOT[row.item.confidence] }]}
                />
                <Text style={styles.itemLabel} numberOfLines={1}>
                  {row.item.label}
                </Text>
              </View>
              <Text style={styles.itemMacros}>
                {row.kcal} kcal · P {row.protein}g · C {row.carbs}g · F {row.fat}g
              </Text>
            </View>
            <View style={styles.stepper}>
              <Pressable
                onPress={() => adjust(i, -STEP_G)}
                accessibilityRole="button"
                accessibilityLabel={`Decrease ${row.item.label} by 10 grams`}
                hitSlop={8}
                style={({ pressed }) => [styles.stepBtn, pressed && { opacity: 0.6 }]}
              >
                <Text style={styles.stepGlyph}>−</Text>
              </Pressable>
              <Text style={styles.stepValue}>{row.grams}g</Text>
              <Pressable
                onPress={() => adjust(i, STEP_G)}
                accessibilityRole="button"
                accessibilityLabel={`Increase ${row.item.label} by 10 grams`}
                hitSlop={8}
                style={({ pressed }) => [styles.stepBtn, pressed && { opacity: 0.6 }]}
              >
                <Text style={styles.stepGlyph}>+</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </View>

      {result.note ? <Text style={styles.note}>{result.note}</Text> : null}

      <Text style={styles.sectionLabel}>Log as</Text>
      <Text style={styles.sectionHint}>
        A scan identifies food. You decide what this was.
      </Text>
      <View style={styles.chips} accessibilityRole="list">
        {MEAL_TYPES.map((type) => (
          <Chip
            key={type}
            label={type}
            selected={mealType === type}
            onPress={() => setMealType(type)}
            size="medium"
            color={GV.cta}
            accessibilityLabel={`Log as ${type}`}
          />
        ))}
      </View>

      {logError ? <Text style={styles.error}>{logError}</Text> : null}

      <Pressable
        onPress={() => void logMeal()}
        disabled={logging}
        accessibilityRole="button"
        accessibilityLabel={`Log ${mealType.toLowerCase()}`}
        accessibilityState={{ disabled: logging, busy: logging }}
        style={({ pressed }) => [
          styles.cta,
          pressed && !logging && { backgroundColor: GV.ctaPressed },
          logging && { opacity: 0.6 },
        ]}
      >
        <Text style={styles.ctaText}>{logging ? 'Logging…' : `Log ${mealType.toLowerCase()}`}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: GV.card,
    borderRadius: SPACE.rCard,
    padding: SPACE.cardPad,
    gap: SPACE.cardGap,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: GV.wash,
  },
  headText: {
    flex: 1,
    gap: 4,
  },
  title: {
    ...TYPE.title,
    color: GV.ink,
  },
  confRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  confDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  confText: {
    ...TYPE.caption,
    color: GV.muted,
  },
  retake: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: SPACE.rPill,
    backgroundColor: GV.wash,
  },
  retakeText: {
    ...TYPE.chip,
    color: GV.ink,
  },
  hero: {
    fontFamily: FONT.semi,
    fontSize: 40,
    lineHeight: 46,
    color: GV.ink,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  range: {
    ...TYPE.caption,
    color: GV.muted,
    textAlign: 'center',
  },
  sectionLabel: {
    fontFamily: FONT.semi,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 2,
    color: GV.teal,
    marginTop: 4,
  },
  sectionHint: {
    ...TYPE.caption,
    color: GV.muted,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  items: {
    gap: 8,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: GV.wash,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  itemInfo: {
    flex: 1,
    gap: 2,
  },
  itemLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  itemDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  itemLabel: {
    ...TYPE.button,
    fontSize: 15,
    color: GV.ink,
    flex: 1,
  },
  itemMacros: {
    ...TYPE.caption,
    color: GV.body,
    fontVariant: ['tabular-nums'],
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: GV.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepGlyph: {
    fontFamily: FONT.semi,
    fontSize: 18,
    lineHeight: 22,
    color: GV.ink,
  },
  stepValue: {
    ...TYPE.chip,
    color: GV.ink,
    minWidth: 44,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  note: {
    ...TYPE.caption,
    color: GV.muted,
  },
  error: {
    ...TYPE.caption,
    color: GV.danger,
  },
  cta: {
    backgroundColor: GV.cta,
    borderRadius: SPACE.rPill,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  ctaText: {
    ...TYPE.button,
    color: '#FFFFFF',
  },
});
