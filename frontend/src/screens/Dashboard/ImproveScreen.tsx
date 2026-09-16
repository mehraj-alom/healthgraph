import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS, BORDER_RADIUS, SPACING, TYPOGRAPHY } from '@/constants';
import { AmbientBackground } from '@/components';
import { useReducedMotion } from '@/theme';
import { SPOKE_GUIDANCE, GUIDANCE_FALLBACK } from '@/components/home/HGraphMap';
import type { ImproveMetric, RootStackParamList } from '@/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'Improve'>;

const CLIN = {
  bg: '#EAE4D6',
  card: '#FFFBF3',
  ink: '#1D1B17',
  muted: '#797166',
  faint: '#E6DBC6',
  red: '#C2503E',
  green: '#4E9B5F',
};

/**
 * Improve / Keep — the actions window behind the dashboard duo buttons.
 * Built from the CURRENT dial values (passed in, fresh at tap time):
 * metrics outside their zone get raise/lower cards; steady ones get
 * maintenance cards. Wellness nudges only — never diagnosis or treatment.
 */
export default function ImproveScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const reducedMotion = useReducedMotion();
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

  // Card tone drives the whole interior: green-tinted "keep" cards,
  // warm/red-tinted "improve" cards, neutral "watch" blocks.
  const renderCard = (m: ImproveMetric, index: number, maintain: boolean) => {
    const g = SPOKE_GUIDANCE[m.id] ?? GUIDANCE_FALLBACK;
    // Spotlight the direction that moves toward the goal.
    const towardLow = g.goal === 'low';
    const first = maintain
      ? towardLow
        ? { title: 'Keep doing', items: g.lower, color: CLIN.green }
        : { title: 'Keep doing', items: g.raise, color: CLIN.green }
      : towardLow
        ? { title: 'Ease off', items: g.lower, color: CLIN.red }
        : { title: 'Nudge up', items: g.raise, color: CLIN.green };
    const second = maintain
      ? null
      : towardLow
        ? { title: 'Watch for', items: g.raise, color: CLIN.muted }
        : { title: 'Ease off', items: g.lower, color: CLIN.red };
    const tone = maintain ? 'keep' : 'improve';
    const toneColor = maintain ? CLIN.green : CLIN.red;
    return (
      <Animated.View
        key={m.id}
        entering={reducedMotion ? undefined : FadeInUp.duration(280).delay(Math.min(index * 50, 300))}
      >
        <View
          style={[
            styles.card,
            tone === 'keep' ? styles.cardKeep : styles.cardImprove,
            { borderLeftColor: toneColor },
          ]}
        >
          <View style={styles.cardTopRow}>
            <View style={[styles.toneDot, { backgroundColor: toneColor }]} />
            <Text style={[styles.toneLabel, { color: toneColor }]}>
              {maintain ? 'Keep it steady' : 'Needs a nudge'}
            </Text>
            <View style={[styles.valuePill, { backgroundColor: toneColor + '1A' }]}>
              <Text style={[styles.valuePillText, { color: toneColor }]}>{m.valueText}</Text>
            </View>
          </View>
          <Text style={styles.cardLabel}>{m.label}</Text>
          <Text style={styles.cardStatus}>
            {positionOf(m)} ({g.zone}) · {m.avgDays}d avg
          </Text>
          {m.good === false && g.flag ? <Text style={styles.flag}>{g.flag}</Text> : null}
          <Text style={[styles.listTitle, { color: first.color }]}>{first.title}</Text>
          {first.items.map((tip) => (
            <Text key={tip} style={styles.tip}>· {tip}</Text>
          ))}
          {second ? (
            <View style={styles.watchBlock}>
              <Text style={[styles.listTitle, { color: second.color }]}>{second.title}</Text>
              {second.items.map((tip) => (
                <Text key={tip} style={styles.tip}>· {tip}</Text>
              ))}
            </View>
          ) : null}
        </View>
      </Animated.View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <AmbientBackground tone="clinical" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={8}
        >
          <Text style={styles.backBtnText}>‹ Back</Text>
        </Pressable>

        <Text style={styles.title}>{focus === 'improve' ? 'Improve' : 'Keep going'}</Text>
        <Text style={styles.subtitle}>
          {focus === 'improve'
            ? 'Based on your dial right now — what to move.'
            : 'What is holding steady — and what sustains it.'}
        </Text>

        {primary.length === 0 ? (
          focus === 'improve' ? (
            <View style={[styles.emptyCard, styles.emptyCelebrate]}>
              <Text style={styles.celebrateEmoji}>🎉</Text>
              <Text style={styles.emptyTitle}>
                Congratulations — nothing to improve!
              </Text>
              <Text style={styles.emptyText}>
                Every signal is sitting in its healthy zone. Whatever you are
                doing is working — keep it up, and check back after your next
                few logs.
              </Text>
              <Pressable
                onPress={() => navigation.setParams({ focus: 'keep' })}
                style={styles.emptyBtn}
                accessibilityRole="button"
                accessibilityLabel="See what to keep doing"
                hitSlop={8}
              >
                <Text style={styles.emptyBtnText}>See what to keep doing →</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>
                Nothing steady yet — let's build it 🌱
              </Text>
              <Text style={styles.emptyText}>
                Signals show up here once they have a few days of history.
                Meanwhile, tap below to see exactly what to improve first.
              </Text>
              <Pressable
                onPress={() => navigation.setParams({ focus: 'improve' })}
                style={[styles.emptyBtn, styles.emptyBtnImprove]}
                accessibilityRole="button"
                accessibilityLabel="See what to improve"
                hitSlop={8}
              >
                <Text style={[styles.emptyBtnText, styles.emptyBtnImproveText]}>
                  See what to improve →
                </Text>
              </Pressable>
            </View>
          )
        ) : (
          primary.map((m, i) => renderCard(m, i, focus === 'keep'))
        )}

        {secondary.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>
              {focus === 'improve' ? 'Holding steady' : 'Needs attention'}
            </Text>
            {secondary.map((m, i) => renderCard(m, primary.length + i, focus === 'improve'))}
          </>
        ) : null}

        <Text style={styles.foot}>
          Wellness nudges from your own averages — not medical advice.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: CLIN.bg,
  },
  content: {
    padding: SPACING.md,
    paddingBottom: SPACING.xxl,
    gap: SPACING.sm,
  },
  backBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: BORDER_RADIUS.sm,
    backgroundColor: CLIN.card,
    borderWidth: 1,
    borderColor: CLIN.faint,
  },
  backBtnText: {
    ...TYPOGRAPHY.captionStrong,
    color: CLIN.red,
  },
  title: {
    ...TYPOGRAPHY.h1,
    color: CLIN.ink,
  },
  subtitle: {
    ...TYPOGRAPHY.body,
    color: CLIN.muted,
  },
  card: {
    backgroundColor: CLIN.card,
    borderWidth: 1,
    borderColor: CLIN.faint,
    borderLeftWidth: 4,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    gap: 4,
    shadowColor: '#16212C',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 2,
  },
  // Tone-tinted interiors: keep cards breathe green, improve cards glow warm.
  cardKeep: {
    backgroundColor: '#F2F8F0',
    borderColor: 'rgba(78,155,95,0.35)',
  },
  cardImprove: {
    backgroundColor: '#FBF3E4',
    borderColor: 'rgba(194,80,62,0.30)',
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  toneDot: {
    width: 10,
    height: 10,
    borderRadius: 9999,
  },
  toneLabel: {
    ...TYPOGRAPHY.captionStrong,
    flex: 1,
  },
  valuePill: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: 9999,
  },
  valuePillText: {
    ...TYPOGRAPHY.captionStrong,
    fontSize: 12,
  },
  watchBlock: {
    marginTop: SPACING.xs,
    padding: SPACING.sm,
    borderRadius: BORDER_RADIUS.sm,
    backgroundColor: 'rgba(121,113,102,0.08)',
    gap: 2,
  },
  cardLabel: {
    ...TYPOGRAPHY.bodyStrong,
    fontSize: 16,
    color: CLIN.ink,
  },
  cardStatus: {
    ...TYPOGRAPHY.caption,
    color: CLIN.muted,
  },
  flag: {
    ...TYPOGRAPHY.caption,
    fontWeight: '700',
    color: CLIN.red,
    backgroundColor: 'rgba(215,38,61,0.08)',
    borderRadius: BORDER_RADIUS.sm,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    overflow: 'hidden',
    marginTop: 2,
  },
  listTitle: {
    ...TYPOGRAPHY.captionStrong,
    marginTop: SPACING.xs,
  },
  tip: {
    ...TYPOGRAPHY.body,
    fontSize: 14,
    color: CLIN.ink,
    lineHeight: 20,
  },
  sectionTitle: {
    ...TYPOGRAPHY.overline,
    color: CLIN.muted,
    letterSpacing: 1,
    marginTop: SPACING.sm,
  },
  emptyCard: {
    backgroundColor: CLIN.card,
    borderWidth: 1,
    borderColor: CLIN.faint,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    gap: 6,
    alignItems: 'center',
  },
  emptyCelebrate: {
    backgroundColor: '#F2F8F0',
    borderColor: 'rgba(78,155,95,0.45)',
    borderWidth: 1.5,
  },
  celebrateEmoji: {
    fontSize: 40,
  },
  emptyBtn: {
    marginTop: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: 9999,
    backgroundColor: CLIN.green,
  },
  emptyBtnText: {
    ...TYPOGRAPHY.bodyStrong,
    color: '#FFFFFF',
    fontSize: 14,
  },
  emptyBtnImprove: {
    backgroundColor: CLIN.red,
  },
  emptyBtnImproveText: {
    color: '#FFFFFF',
  },
  emptyTitle: {
    ...TYPOGRAPHY.h3,
    color: CLIN.ink,
    textAlign: 'center',
  },
  emptyText: {
    ...TYPOGRAPHY.body,
    color: CLIN.muted,
    textAlign: 'center',
  },
  foot: {
    ...TYPOGRAPHY.caption,
    color: CLIN.muted,
    textAlign: 'center',
    marginTop: SPACING.sm,
  },
});
