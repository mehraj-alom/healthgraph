import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button } from '@/components';
import { GlassSurface } from '@/components/home/GlassSurface';
import { HomeStageBackdrop } from '@/components/home/HomeStageBackdrop';
import { SPACE } from '@/theme/guava';
import { LG } from '@/theme/liquidGlass';
import { SPOKE_GUIDANCE, GUIDANCE_FALLBACK } from '@/components/home/HGraphMap';
import type { ImproveMetric, RootStackParamList } from '@/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'Improve'>;

const SECONDARY = 'rgba(233,240,255,0.66)';
const TERTIARY = 'rgba(233,240,255,0.45)';

/**
 * Improve / Keep — the actions window behind the dashboard duo buttons.
 * Built from the CURRENT dial values (passed in, fresh at tap time):
 * metrics outside their zone get raise/lower cards; steady ones get
 * maintenance cards. Wellness nudges only — never diagnosis or treatment.
 */
export default function ImproveScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const focus = route.params?.focus ?? 'improve';
  const metrics = route.params?.metrics ?? [];

  const needsWork = metrics.filter((m) => !m.good);
  const steady = metrics.filter((m) => m.good);
  const primary = focus === 'improve' ? needsWork : steady;
  const secondary = focus === 'improve' ? steady : needsWork;

  const positionOf = (m: ImproveMetric): string => {
    if (m.value < m.bandLo) return 'below zone';
    if (m.value > m.bandHi) return 'above zone';
    return 'in zone';
  };

  const renderCard = (m: ImproveMetric, maintain: boolean) => {
    const g = SPOKE_GUIDANCE[m.id] ?? GUIDANCE_FALLBACK;
    const towardLow = g.goal === 'low';
    const first = maintain
      ? { title: 'Keep doing', items: towardLow ? g.lower : g.raise }
      : towardLow
        ? { title: 'Ease off', items: g.lower }
        : { title: 'Nudge up', items: g.raise };
    const second = maintain
      ? null
      : towardLow
        ? { title: 'Watch for', items: g.raise }
        : { title: 'Ease off', items: g.lower };
    const dotColor = maintain ? LG.card.mint : LG.card.danger;
    return (
      <GlassSurface strong key={m.id} style={styles.card}>
        <View style={styles.cardTopRow}>
          <View style={[styles.toneDot, { backgroundColor: dotColor }]} />
          <Text style={styles.toneLabel}>
            {maintain ? 'Keep it steady' : 'Needs a nudge'}
          </Text>
          <View style={styles.valuePill}>
            <Text style={styles.valuePillText}>{m.valueText}</Text>
          </View>
        </View>
        <Text style={styles.cardLabel}>{m.label}</Text>
        <Text style={styles.cardStatus}>
          {positionOf(m)} ({g.zone}) · {m.avgDays}d avg
        </Text>
        {m.good === false && g.flag ? <Text style={styles.flag}>{g.flag}</Text> : null}
        <Text style={styles.listTitle}>{first.title}</Text>
        {first.items.map((tip) => (
          <Text key={tip} style={styles.tip}>· {tip}</Text>
        ))}
        {second ? (
          <View style={styles.watchBlock}>
            <Text style={styles.listTitle}>{second.title}</Text>
            {second.items.map((tip) => (
              <Text key={tip} style={styles.tip}>· {tip}</Text>
            ))}
          </View>
        ) : null}
      </GlassSurface>
    );
  };

  return (
    <View style={styles.root}>
      <HomeStageBackdrop />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Pressable
            onPress={() => navigation.goBack()}
            style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={12}
          >
            <Text style={styles.backBtnText}>‹ Back</Text>
          </Pressable>

          <Text style={styles.title}>{focus === 'improve' ? 'Improve' : 'Keep going'}</Text>
          <Text style={styles.sub}>
            {focus === 'improve'
              ? 'Based on your dial right now. What to move.'
              : 'What is holding steady. What sustains it.'}
          </Text>

          {primary.length === 0 ? (
            focus === 'improve' ? (
              <GlassSurface strong style={styles.emptyCard}>
                <View style={styles.celebrateTile}>
                  <Text style={styles.celebrateGlyph}>✓</Text>
                </View>
                <Text style={styles.emptyTitle}>
                  Nothing to improve.
                </Text>
                <Text style={styles.emptyText}>
                  Every signal is sitting in its healthy zone. Whatever you are
                  doing is working. Keep it up, and check back after your next
                  few logs.
                </Text>
                <Button
                  title="See what to keep doing"
                  variant="secondary"
                  onPress={() => navigation.setParams({ focus: 'keep' })}
                  fullWidth
                  style={styles.primaryBtn}
                  textStyle={styles.primaryBtnText}
                />
              </GlassSurface>
            ) : (
              <GlassSurface strong style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>
                  Nothing steady yet. You can build it.
                </Text>
                <Text style={styles.emptyText}>
                  Signals show up here once they have a few days of history.
                  Meanwhile, tap below to see exactly what to improve first.
                </Text>
                <Button
                  title="See what to improve"
                  variant="secondary"
                  onPress={() => navigation.setParams({ focus: 'improve' })}
                  fullWidth
                  style={styles.primaryBtn}
                  textStyle={styles.primaryBtnText}
                />
              </GlassSurface>
            )
          ) : (
            primary.map((m) => renderCard(m, focus === 'keep'))
          )}

          {secondary.length > 0 ? (
            <>
              <Text style={styles.sectionTitle}>
                {focus === 'improve' ? 'Holding steady' : 'Needs attention'}
              </Text>
              {secondary.map((m) => renderCard(m, focus === 'improve'))}
            </>
          ) : null}

          <Text style={styles.foot}>
            Wellness nudges from your own averages. Not medical advice.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05070F' },
  safe: { flex: 1 },
  content: {
    paddingHorizontal: SPACE.screenH,
    paddingVertical: 12,
    paddingBottom: 32,
    gap: 12,
  },
  backBtn: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  backBtnText: {
    fontWeight: '600',
    fontSize: 15,
    lineHeight: 20,
    color: '#FFFFFF',
  },
  title: { fontWeight: '600', fontSize: 34, lineHeight: 41, letterSpacing: -0.8, color: '#FFFFFF', textAlign: 'center' },
  sub: { fontWeight: '400', fontSize: 15, lineHeight: 21, color: SECONDARY, textAlign: 'center', marginBottom: 4 },
  card: {
    padding: 16,
    gap: 8,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  toneDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  toneLabel: {
    fontWeight: '600',
    fontSize: 13,
    lineHeight: 18,
    color: '#FFFFFF',
    flex: 1,
  },
  valuePill: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 9999,
  },
  valuePillText: {
    fontWeight: '600',
    fontSize: 13,
    lineHeight: 18,
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },
  watchBlock: {
    marginTop: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    gap: 4,
  },
  cardLabel: {
    fontWeight: '600',
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.4,
    color: '#FFFFFF',
  },
  cardStatus: {
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: SECONDARY,
    fontVariant: ['tabular-nums'],
  },
  flag: {
    fontWeight: '600',
    fontSize: 13,
    lineHeight: 18,
    color: '#FFFFFF',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    overflow: 'hidden',
    marginTop: 4,
  },
  listTitle: {
    fontWeight: '600',
    fontSize: 14,
    lineHeight: 20,
    color: '#FFFFFF',
    marginTop: 8,
  },
  tip: {
    fontWeight: '400',
    fontSize: 15,
    lineHeight: 21,
    color: SECONDARY,
  },
  sectionTitle: { fontWeight: '600', fontSize: 20, lineHeight: 26, letterSpacing: -0.4, color: '#FFFFFF', marginTop: 8 },
  emptyCard: {
    padding: 20,
    gap: 8,
    alignItems: 'center',
  },
  celebrateTile: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  celebrateGlyph: {
    fontWeight: '600',
    fontSize: 28,
    lineHeight: 32,
    color: LG.card.mint,
  },
  primaryBtn: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF', marginTop: 8 },
  primaryBtnText: { color: '#0B0F1A' },
  emptyTitle: {
    fontWeight: '600',
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.4,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  emptyText: {
    fontWeight: '400',
    fontSize: 15,
    lineHeight: 21,
    color: SECONDARY,
    textAlign: 'center',
  },
  foot: {
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: TERTIARY,
    textAlign: 'center',
    marginTop: 8,
  },
});
