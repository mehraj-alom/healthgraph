import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SymptomBodyMap } from '@/components/SymptomBodyMap';
import { Card, Chip, Slider } from '@/components';
import { usePainHistory } from '@/hooks/usePainHistory';
import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
import { TILE_TONES } from '@/theme/tones';
void FONT;
import type { RootStackParamList } from '@/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Mode = 'mark' | 'history';

const HISTORY_DAYS = 30;

/**
 * Symptom map — two tools sharing one figure:
 * - Mark: tap the figure to mark where it hurts (local state).
 * - History: scrub 30 days of logged pain on a slider and watch the
 *   affected areas move. Driven by on-device pain logs; demo data stands
 *   in until real logs exist. Reached from the stack, not the tab bar.
 */
export default function SymptomMapScreen() {
  const navigation = useNavigation<Nav>();
  const [mode, setMode] = useState<Mode>('mark');
  const { history, loading, unmapped, isSample } = usePainHistory(HISTORY_DAYS);
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
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={8}
        >
          <Text style={styles.backBtnText}>‹ Back</Text>
        </Pressable>

        <Text style={styles.title}>Where does it hurt?</Text>
        <Text style={styles.subtitle}>
          {mode === 'mark'
            ? 'Tap the figure to mark sore spots. Switch sides to check your back, too.'
            : 'Scrub through the last 30 days to see where pain showed up.'}
        </Text>

        <Card style={styles.controlCard}>
          <View style={styles.modeRow}>
            <Chip
              label="Mark today"
              size="large"
              selected={mode === 'mark'}
              color={TILE_TONES.discipline[0]}
              onPress={() => setMode('mark')}
              accessibilityLabel="Mark pain on the figure"
            />
            <Chip
              label="History"
              size="large"
              selected={mode === 'history'}
              color={TILE_TONES.weight[0]}
              onPress={() => setMode('history')}
              accessibilityLabel="Browse pain history by day"
            />
          </View>
        </Card>

        {mode === 'mark' ? (
          <>
            <Card style={styles.mapCard}>
              <SymptomBodyMap
                data={[
                  { slug: 'lower-back', intensity: 2 },
                  { slug: 'deltoids', intensity: 1, side: 'left' },
                ]}
              />
            </Card>
            <Text style={styles.sampleNote}>
              Sample markings. Connect your own symptom data to replace them.
            </Text>
          </>
        ) : (
          <>
            <Card style={styles.controlCard}>
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
                    label="Day"
                    displayValue={activeDay?.label ?? ''}
                    showValue
                    disabled={loading || history.length === 0}
                    color={GV.cta}
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
            </Card>
            <Card style={styles.mapCard}>
              <SymptomBodyMap
                data={activeDay?.marks ?? []}
                tappable={false}
              />
            </Card>
            <Text style={styles.sampleNote}>
              {loading
                ? 'Reading your logs…'
                : isSample
                  ? 'Sample history. Log pain for a few days to see your own.'
                  : unmapped > 0
                    ? `${unmapped} entr${unmapped === 1 ? 'y' : 'ies'} had no mappable location and ${unmapped === 1 ? 'was' : 'were'} skipped.`
                    : 'From your logged pain entries.'}
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: GV.stage,
  },
  content: {
    paddingHorizontal: SPACE.screenH,
    paddingTop: 8,
    paddingBottom: 40,
    gap: SPACE.cardGap,
  },
  backBtn: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
    paddingRight: 8,
  },
  backBtnText: {
    ...TYPE.caption,
    color: GV.fog,
  },
  title: {
    ...TYPE.display,
    color: GV.card,
    textAlign: 'center',
  },
  subtitle: {
    ...TYPE.body,
    color: GV.fog,
    textAlign: 'center',
    marginBottom: 12,
  },
  controlCard: {
    backgroundColor: GV.card,
    borderRadius: SPACE.rCard,
    padding: SPACE.cardPad,
  },
  mapCard: {
    backgroundColor: GV.card,
    borderRadius: SPACE.rCard,
    padding: SPACE.cardPad,
    marginTop: SPACE.cardGap,
  },
  modeRow: {
    flexDirection: 'row',
    gap: SPACE.cardGap,
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
    ...TYPE.title,
    color: GV.ink,
  },
  todayBtn: {
    alignSelf: 'flex-end',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  todayText: {
    ...TYPE.caption,
    color: GV.body,
    textDecorationLine: 'underline',
  },
  sampleNote: {
    ...TYPE.caption,
    color: GV.fog,
    textAlign: 'center',
    marginTop: 4,
  },
});
