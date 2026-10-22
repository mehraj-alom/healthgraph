import { useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SPACE } from '@/theme/guava';
import { Button, Chip } from '@/components';
import { GlassSurface } from '@/components/home/GlassSurface';
import { LG } from '@/theme/liquidGlass';
import { useToast } from '@/components/Toast';
import {
  logScannedMeal,
  type FoodScanConfidence,
  type FoodScanResult,
} from '@/services/nutritionService';
import { MEAL_TYPES, suggestMealType, type MealType } from './mealTypes';
import { microLine } from './microDisplay';
import { OFF_ATTRIBUTION } from '@/services/legalLinks';
import { getCachedPatientId } from '@/services/patientIdentity';
import { saveFoodScanBreakdown } from '@/db/queries/foodScans';

const SECONDARY = 'rgba(233,240,255,0.66)';
const TERTIARY = 'rgba(233,240,255,0.45)';

const STEP_G = 10;
const MIN_G = 10;

const CONFIDENCE_DOT: Record<FoodScanConfidence, string> = {
  high: LG.card.mint,
  med: '#E8862E',
  low: TERTIARY,
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

/** Tap-to-type grams: shows the value, opens the keyboard on tap,
 *  commits a clamped number on submit or blur. */
function GramInput({
  grams,
  label,
  onCommit,
}: {
  grams: number;
  label: string;
  onCommit: (grams: number) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const commit = (raw: string) => {
    const parsed = parseInt(raw.replace(/[^0-9]/g, ''), 10);
    if (Number.isFinite(parsed)) {
      onCommit(Math.min(5000, Math.max(MIN_G, parsed)));
    }
    setText(null);
  };
  return (
    <TextInput
      value={text ?? String(grams)}
      onChangeText={setText}
      onSubmitEditing={(e) => commit(e.nativeEvent.text)}
      onBlur={() => {
        if (text != null) commit(text);
      }}
      keyboardType="number-pad"
      returnKeyType="done"
      maxLength={5}
      accessibilityRole="spinbutton"
      accessibilityLabel={`${label} grams, tap to type`}
      style={styles.stepValue}
    />
  );
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
          fiber: item.fiber_g != null ? scale(item.fiber_g, factor) : null,
          sugar: item.sugar_g != null ? scale(item.sugar_g, factor) : null,
          sodium: item.sodium_mg != null ? scale(item.sodium_mg, factor) : null,
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

  const sumOrNull = (values: (number | null)[]): number | null => {
    const clean = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (clean.length === 0) return null;
    return Math.round(clean.reduce((a, b) => a + b, 0) * 10) / 10;
  };
  const totalFiber = useMemo(() => sumOrNull(rows.map((r) => r.fiber)), [rows]);
  const totalSugar = useMemo(() => sumOrNull(rows.map((r) => r.sugar)), [rows]);
  const totalSodium = useMemo(() => sumOrNull(rows.map((r) => r.sodium)), [rows]);

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
    <GlassSurface strong style={styles.sheet}>
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
      {(totalFiber != null || totalSugar != null || totalSodium != null) && (
        <Text style={styles.range}>
          {microLine(totalFiber, totalSugar, totalSodium)} · from matched foods
        </Text>
      )}

      <Text style={styles.sectionTitle}>Items</Text>
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
              {(row.fiber != null || row.sugar != null || row.sodium != null) && (
                <Text style={styles.itemMacros}>
                  {microLine(row.fiber, row.sugar, row.sodium)}
                </Text>
              )}
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
              <GramInput
                grams={row.grams}
                label={row.item.label}
                onCommit={(g) =>
                  setGrams((prev) => prev.map((v, j) => (j === i ? g : v)))
                }
              />
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
      {result.items.some((item) => item.barcode) ? (
        <Text style={styles.note}>{OFF_ATTRIBUTION}</Text>
      ) : null}

      <Text style={styles.sectionTitle}>Log as</Text>
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
            color={LG.card.mint}
            accessibilityLabel={`Log as ${type}`}
          />
        ))}
      </View>

      {logError ? <Text style={styles.error}>{logError}</Text> : null}

      <Button
        title={logging ? 'Logging…' : `Log ${mealType.toLowerCase()}`}
        variant="secondary"
        onPress={() => void logMeal()}
        disabled={logging}
        loading={logging}
        fullWidth
        size="large"
        accessibilityLabel={`Log ${mealType.toLowerCase()}`}
      />
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  sheet: {
    padding: 16,
    gap: 12,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  headText: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontWeight: '600',
    fontSize: 18,
    lineHeight: 24,
    color: '#FFFFFF',
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
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: SECONDARY,
  },
  retake: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: SPACE.rPill,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  retakeText: {
    fontWeight: '600',
    fontSize: 13,
    lineHeight: 18,
    color: '#FFFFFF',
  },
  hero: {
    fontWeight: '600',
    fontSize: 40,
    lineHeight: 46,
    color: '#FFFFFF',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  range: {
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: SECONDARY,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  sectionTitle: {
    fontWeight: '600',
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.4,
    color: '#FFFFFF',
    marginTop: 8,
  },
  sectionHint: {
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: SECONDARY,
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
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 8,
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
    fontWeight: '600',
    fontSize: 15,
    lineHeight: 20,
    color: '#FFFFFF',
    flex: 1,
  },
  itemMacros: {
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: SECONDARY,
    fontVariant: ['tabular-nums'],
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stepBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepGlyph: {
    fontWeight: '600',
    fontSize: 18,
    lineHeight: 22,
    color: '#FFFFFF',
  },
  stepValue: {
    fontWeight: '600',
    fontSize: 13,
    lineHeight: 18,
    color: '#FFFFFF',
    minWidth: 56,
    minHeight: 44,
    textAlign: 'center',
    textAlignVertical: 'center',
    fontVariant: ['tabular-nums'],
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.25)',
    paddingHorizontal: 4,
  },
  note: {
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: SECONDARY,
  },
  error: {
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: LG.card.danger,
  },
});
