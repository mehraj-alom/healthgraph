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
    return (
      <Animated.View
        key={m.id}
        entering={reducedMotion ? undefined : FadeInUp.duration(280).delay(Math.min(index * 50, 300))}
      >
        <View style={[styles.card, { borderLeftColor: maintain ? CLIN.green : CLIN.red }]}>
          <Text style={styles.cardLabel}>
            {m.label} · {m.valueText}
          </Text>
          <Text style={styles.cardStatus}>
            {positionOf(m)} ({g.zone}) · {m.avgDays}d avg
          </Text>
          {m.good === false && g.flag ? <Text style={styles.flag}>{g.flag}</Text> : null}
          <Text style={[styles.listTitle, { color: first.color }]}>{first.title}</Text>
          {first.items.map((tip) => (
            <Text key={tip} style={styles.tip}>· {tip}</Text>
          ))}
          {second ? (
            <>
              <Text style={[styles.listTitle, { color: second.color }]}>{second.title}</Text>
              {second.items.map((tip) => (
                <Text key={tip} style={styles.tip}>· {tip}</Text>
              ))}
            </>
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
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>
              {focus === 'improve' ? 'All steady — nothing to chase 🎉' : 'Log a few more days to see patterns.'}
            </Text>
            <Text style={styles.emptyText}>
              {focus === 'improve'
                ? 'Every signal sits in its usual zone. Keep doing what you are doing.'
                : 'Signals appear here once they have real history behind them.'}
            </Text>
          </View>
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
