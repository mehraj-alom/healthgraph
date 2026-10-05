/**
 * PriorityWorldScreen — the Priority destination (Apple Liquid Glass).
 *
 * "My Priorities" is a content-layer world on the shared aurora stage:
 * a large-title hero, the shared health dial as the hero instrument
 * (same pipeline as the dashboard via useDialMetrics — no duplicated
 * computation), the Improve / Keep duo, one monochrome glass row per
 * focus area, and a compact patterns preview. Empty selection renders
 * the honest empty state with a path to setup.
 *
 * Follows design_follow.md mechanically:
 * - Two layers: aurora stage + frosted GlassSurface content. No glass
 *   stacked on glass, no per-screen background, root bg LG.stage.bottom.
 * - Text on glass is monochrome; one tinted action language per view
 *   (the Improve / Keep duo, mirrored from the dashboard reference).
 * - System typography, tabular-nums on the dial label, ≤2-line subtitles.
 * - Copy is outcome-led, never jargon ("Focus areas", never "engines").
 * - Entrances stagger gently, reduced-motion gated; every tappable ≥44pt.
 *
 * Composition only: every number here is computed by an existing
 * contract. No Priority score, no new health math, no medical claims.
 */

import { useCallback, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  Vibration,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, SectionHeader } from '@/components';
import { LG } from '@/theme/liquidGlass';
import { graphToneForStream } from '@/theme/tones';
import HGraphMap from '@/components/home/HGraphMap';
import CorrelationGraphCard from '@/components/home/CorrelationGraphCard';
import { GlassSurface } from '@/components/home/GlassSurface';
import { HomeStageBackdrop } from '@/components/home/HomeStageBackdrop';
import Entrance from '@/components/home/Entrance';
import { ExploreGlyph, type GlyphName } from '@/components/home/ExploreGlyphs';
import { useTrendRange } from '@/context/TrendRangeContext';
import { useTrends } from '@/hooks/useTrends';
import { useDailyMetrics } from '@/hooks/useDailyMetrics';
import { useHomeStory } from '@/screens/Dashboard/useHomeStory';
import { useLocalHeartRate } from '@/hooks/useLocalHeartRate';
import { useCorrelationFeed } from '@/screens/Dashboard/correlations';
import { useDialMetrics } from '@/hooks/useDialMetrics';
import { usePriority } from '@/hooks/usePriority';
import { ENGINES } from '@/screens/HealthAreas/engines';
import type { RootStackParamList } from '@/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** Focus area → the same monochrome glyph the dashboard Explore grid uses. */
const ENGINE_GLYPHS: Record<string, GlyphName> = {
  sleep: 'moon',
  weight: 'scale',
  discipline: 'medal',
  fitness: 'bolt',
  nutrition: 'leaf',
  wellbeing: 'face',
  heart: 'heart',
};

function ImproveKeepDuo({
  onImprove,
}: {
  onImprove: (focus: 'improve' | 'keep') => void;
}) {
  return (
    <View style={styles.actionDuo}>
      <Button
        title="Improve"
        onPress={() => {
          try { Vibration.vibrate(12); } catch { /* best-effort */ }
          onImprove('improve');
        }}
        accessibilityLabel="Improve: actions based on your dial"
        style={styles.duoBtn}
      />
      <Button
        title="Keep"
        variant="secondary"
        onPress={() => {
          try { Vibration.vibrate(12); } catch { /* best-effort */ }
          onImprove('keep');
        }}
        accessibilityLabel="Keep: what is holding steady"
        style={styles.duoBtn}
      />
    </View>
  );
}

export default function PriorityWorldScreen() {
  const navigation = useNavigation<Nav>();
  const { entries, isEmpty } = usePriority();
  // Shared dial pipeline (same inputs the dashboard feeds it — the dial
  // reads identically here, including local streams, doses, and camera).
  const { days: trendDays } = useTrendRange();
  const trends = useTrends(trendDays);
  const metrics = useDailyMetrics();
  const story = useHomeStory();
  const localHr = useLocalHeartRate();
  const feedQuery = useCorrelationFeed(trends.data, metrics.data, Math.min(trendDays, 60));
  const {
    dialDay,
    hMetrics,
  } = useDialMetrics({
    trendsData: trends.data,
    metricsData: metrics.data,
    localDetails: feedQuery.localDetails,
    takenEvents: feedQuery.takenEvents,
    medSummary: story.medSummary,
    hrPoints: localHr.points,
  });
  const [mapWidth, setMapWidth] = useState(0);
  const [showAllPatterns, setShowAllPatterns] = useState(false);

  const goEngine = useCallback(
    (routeName: string, params?: Record<string, unknown>) => {
      (navigation.navigate as (r: string, p?: object) => void)(routeName, params);
    },
    [navigation],
  );

  const goEdit = useCallback(() => navigation.navigate('OnboardingSetup'), [navigation]);
  const goImprove = useCallback(
    (focus: 'improve' | 'keep') => navigation.navigate('Improve', { focus, metrics: hMetrics }),
    [navigation, hMetrics],
  );

  const preview = showAllPatterns ? feedQuery.items : feedQuery.items.slice(0, 3);
  const hasMorePatterns = feedQuery.items.length > 3;

  return (
    <View style={styles.screen}>
      <HomeStageBackdrop />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Entrance index={0}>
            <View style={styles.heroBlock}>
              <Text style={styles.heroTitle} maxFontSizeMultiplier={1.4}>
                My Priorities
              </Text>
              {isEmpty ? (
                <Text style={styles.heroSub} maxFontSizeMultiplier={1.4}>
                  Choose what to focus on.
                </Text>
              ) : (
                <Text style={styles.heroSub} maxFontSizeMultiplier={1.4} numberOfLines={2}>
                  {entries.map((e) => e.title).join(' · ')}
                </Text>
              )}
            </View>
          </Entrance>

          {isEmpty ? (
            <Entrance index={1}>
              <GlassSurface strong style={styles.emptyCard}>
                <Text style={styles.emptyTitle} maxFontSizeMultiplier={1.4}>
                  No priorities yet.
                </Text>
                <Text style={styles.emptyBody} maxFontSizeMultiplier={1.4}>
                  Pick the areas you want to keep together.
                </Text>
                <Button
                  title="Choose priorities"
                  variant="secondary"
                  onPress={goEdit}
                  fullWidth
                />
              </GlassSurface>
            </Entrance>
          ) : (
            <>
              <Entrance index={1}>
                <GlassSurface
                  strong
                  noSheen
                  radius={26}
                  intensity={LG.card.blurIntensity + 6}
                  style={styles.overviewCard}
                >
                  <View
                    style={styles.panelMap}
                    onLayout={(e) => setMapWidth(e.nativeEvent.layout.width)}
                  >
                    {mapWidth > 0 ? (
                      <View style={styles.dialCol}>
                        <HGraphMap metrics={hMetrics} width={mapWidth} />
                        <Text style={styles.dialLabel} maxFontSizeMultiplier={1.4}>
                          {dialDay.label}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </GlassSurface>
              </Entrance>

              <Entrance index={2}>
                <ImproveKeepDuo onImprove={goImprove} />
              </Entrance>

              <Entrance index={3}>
                <View style={styles.sectionBlock}>
                  <SectionHeader
                    dark
                    marked={false}
                    title="Focus areas"
                    titleStyle={styles.sectionTitle}
                  />
                  <View style={styles.list}>
                    {entries.map((entry) => {
                      const def = ENGINES[entry.id as keyof typeof ENGINES];
                      if (!def?.route) return null;
                      return (
                        <GlassSurface
                          key={entry.id}
                          noBlur
                          radius={20}
                          style={styles.focusRow}
                          onPress={() => goEngine(def.route?.name ?? '', def.route?.params)}
                          accessibilityLabel={`Open ${entry.title}`}
                        >
                          <View style={styles.focusGlyph}>
                            <ExploreGlyph
                              name={ENGINE_GLYPHS[entry.id] ?? 'target'}
                              size={22}
                              color="rgba(255,255,255,0.92)"
                            />
                          </View>
                          <View style={styles.focusMain}>
                            <Text style={styles.focusTitle} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                              {entry.title}
                            </Text>
                            <Text style={styles.focusHint} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                              {def.description}
                            </Text>
                          </View>
                          <Text style={styles.focusChevron}>›</Text>
                        </GlassSurface>
                      );
                    })}
                  </View>
                </View>
              </Entrance>

              {preview.length > 0 ? (
                <Entrance index={4}>
                  <View style={styles.sectionBlock}>
                    <SectionHeader
                      dark
                      marked={false}
                      title="Your patterns"
                      titleStyle={styles.sectionTitle}
                    />
                    <View style={styles.list}>
                      {preview.map((item) => (
                        <CorrelationGraphCard
                          key={item.id}
                          title={item.title}
                          subtitle={item.subtitle}
                          data={item.data}
                          lineColor={
                            item.data.kind === 'timeSeries'
                              ? graphToneForStream(item.id)
                              : undefined
                          }
                        />
                      ))}
                    </View>
                    <View style={styles.patternActions}>
                      {hasMorePatterns ? (
                        <Button
                          title={showAllPatterns ? 'Show less' : 'Show all'}
                          variant="ghost"
                          onPress={() => setShowAllPatterns((v) => !v)}
                          fullWidth
                          textStyle={styles.quietAction}
                        />
                      ) : null}
                      <Button
                        title="Edit priorities"
                        variant="secondary"
                        onPress={goEdit}
                        fullWidth
                      />
                    </View>
                  </View>
                </Entrance>
              ) : feedQuery.isLocalLoading ? (
                <Text style={styles.loadingNote}>Loading patterns…</Text>
              ) : (
                <Entrance index={4}>
                  <Button
                    title="Edit priorities"
                    variant="secondary"
                    onPress={goEdit}
                    fullWidth
                  />
                </Entrance>
              )}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: LG.stage.bottom,
  },
  safe: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 26,
    paddingTop: 20,
    paddingBottom: 48,
    gap: 16,
  },
  // Apple large-title hero (content layer, opaque — never glass).
  heroBlock: {
    paddingTop: 16,
    paddingBottom: 4,
    gap: 3,
  },
  heroTitle: {
    fontWeight: '600',
    fontSize: 34,
    lineHeight: 41,
    letterSpacing: -0.8,
    color: '#FFFFFF',
  },
  heroSub: {
    fontWeight: '400',
    fontSize: 17,
    lineHeight: 22,
    color: 'rgba(233,240,255,0.66)',
  },
  // The hero instrument: the dial sits directly on one clear frosted
  // panel — nothing layered over it. Teal-tinted rim + outer glow read
  // as the highlight, never paint over the instrument.
  overviewCard: {
    padding: 16,
    borderColor: 'rgba(92,232,184,0.22)',
    shadowColor: 'rgba(92,232,184,0.25)',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 28,
    elevation: 8,
  },
  panelMap: {
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  dialCol: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialLabel: {
    marginTop: 8,
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: 'rgba(233,240,255,0.45)',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  actionDuo: {
    flexDirection: 'row',
    gap: 8,
  },
  duoBtn: {
    flex: 1,
  },
  sectionBlock: {
    gap: 12,
  },
  sectionTitle: {
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: -0.3,
  },
  list: {
    gap: 12,
  },
  // Focus rows: translucent material without blur (small repeated tiles),
  // monochrome glyph + headline + quiet hint. ≥44pt by construction.
  focusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    minHeight: 68,
  },
  focusGlyph: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.09)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  focusMain: {
    flex: 1,
    gap: 2,
  },
  focusTitle: {
    fontWeight: '600',
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.1,
    color: '#FFFFFF',
  },
  focusHint: {
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: 'rgba(233,240,255,0.66)',
  },
  focusChevron: {
    fontSize: 22,
    color: 'rgba(233,240,255,0.45)',
  },
  patternActions: {
    gap: 8,
  },
  quietAction: {
    color: 'rgba(233,240,255,0.66)',
  },
  // Honest empty state: one line, one outcome, one white pill.
  emptyCard: {
    padding: 20,
    gap: 8,
  },
  emptyTitle: {
    fontWeight: '600',
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.3,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  emptyBody: {
    fontWeight: '400',
    fontSize: 15,
    lineHeight: 20,
    color: 'rgba(233,240,255,0.66)',
    textAlign: 'center',
    marginBottom: 8,
  },
  loadingNote: {
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: 'rgba(233,240,255,0.66)',
    textAlign: 'center',
  },
});
