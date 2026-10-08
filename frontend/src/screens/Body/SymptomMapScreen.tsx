import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymptomBodyMap } from '@/components/SymptomBodyMap';
import { Slider } from '@/components';
import { GlassSurface } from '@/components/home/GlassSurface';
import { HomeStageBackdrop } from '@/components/home/HomeStageBackdrop';
import { LG } from '@/theme/liquidGlass';
import { usePainHistory } from '@/hooks/usePainHistory';
import { useAnatomy } from '@/context/AnatomyContext';

const SECONDARY = 'rgba(233,240,255,0.66)';
const TERTIARY = 'rgba(233,240,255,0.45)';

const HISTORY_DAYS = 30;

/**
 * Symptom map — one figure, tappable today, scrubbable history.
 * The day slider sits directly under the figure. Tapping marks sore
 * spots for today; scrubbing back shows logged days read-only.
 */
export default function SymptomMapScreen() {
  const { history, loading, unmapped, isSample } = usePainHistory(HISTORY_DAYS);
  // Model follows the app's anatomy choice. No toggle on this screen.
  const { selectedGender } = useAnatomy();
  const [dayIndex, setDayIndex] = useState(HISTORY_DAYS - 1);

  const activeDay = history[Math.min(dayIndex, history.length - 1)] ?? history[history.length - 1];
  const todayIndex = history.length - 1;

  const stepDay = useMemo(
    () => (delta: number) => {
      setDayIndex((i) => Math.min(todayIndex, Math.max(0, i + delta)));
    },
    [todayIndex],
  );

  return (
    <View style={styles.root}>
      <HomeStageBackdrop />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.title}>Symptom Map</Text>
          <Text style={styles.subtitle}>
            From your log.
          </Text>

          <GlassSurface strong style={styles.mapCard}>
            <SymptomBodyMap
              key={`day-${dayIndex}`}
              data={activeDay?.marks ?? []}
              gender={selectedGender}
              tappable={false}
              belowFigure={
                <View style={styles.dayRow}>
                  <Pressable
                    onPress={() => stepDay(-1)}
                    disabled={dayIndex <= 0}
                    style={[styles.stepBtn, dayIndex <= 0 && styles.stepBtnDisabled]}
                    accessibilityRole="button"
                    accessibilityLabel="Previous day"
                    hitSlop={8}
                  >
                    <Text style={styles.stepGlyph}>‹</Text>
                  </Pressable>
                  <View style={styles.sliderWrap}>
                    <Slider
                      value={dayIndex}
                      onValueChange={setDayIndex}
                      min={0}
                      max={todayIndex}
                      step={1}
                      displayValue={activeDay?.label ?? ''}
                      showValue
                      disabled={loading || history.length === 0}
                      color={LG.card.mint}
                    />
                  </View>
                  <Pressable
                    onPress={() => stepDay(1)}
                    disabled={dayIndex >= todayIndex}
                    style={[styles.stepBtn, dayIndex >= todayIndex && styles.stepBtnDisabled]}
                    accessibilityRole="button"
                    accessibilityLabel="Next day"
                    hitSlop={8}
                  >
                    <Text style={styles.stepGlyph}>›</Text>
                  </Pressable>
                </View>
              }
            />
            {dayIndex !== todayIndex ? (
              <Pressable
                onPress={() => setDayIndex(todayIndex)}
                style={styles.todayBtn}
                accessibilityRole="button"
                accessibilityLabel="Jump to today"
                hitSlop={8}
              >
                <Text style={styles.todayText}>Jump to today</Text>
              </Pressable>
            ) : null}
          </GlassSurface>
          {dayIndex !== todayIndex ? (
            <Text style={styles.sampleNote}>
              {loading
                ? 'Reading your logs…'
                : isSample
                  ? 'Sample history. Log pain for a few days to see your own.'
                  : unmapped > 0
                    ? `${unmapped} entr${unmapped === 1 ? 'y' : 'ies'} had no mappable location and ${unmapped === 1 ? 'was' : 'were'} skipped.`
                    : 'From your logged pain entries.'}
            </Text>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#05070F',
  },
  safe: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 40,
    gap: 12,
  },
  title: {
    fontWeight: '600',
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: -0.8,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  subtitle: {
    fontWeight: '400',
    fontSize: 15,
    lineHeight: 21,
    color: SECONDARY,
    textAlign: 'center',
    marginBottom: 12,
  },
  mapCard: {
    padding: 16,
    marginTop: 12,
  },
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sliderWrap: {
    flex: 1,
  },
  stepBtn: {
    width: 44,
    height: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnDisabled: {
    opacity: 0.4,
  },
  stepGlyph: {
    fontWeight: '600',
    fontSize: 24,
    lineHeight: 30,
    color: '#FFFFFF',
  },
  todayBtn: {
    alignSelf: 'flex-end',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  todayText: {
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: LG.card.mint,
    textDecorationLine: 'underline',
  },
  sampleNote: {
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: SECONDARY,
    textAlign: 'center',
    marginTop: 4,
  },
});
