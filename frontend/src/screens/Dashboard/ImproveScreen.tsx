import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
import { SPOKE_GUIDANCE, GUIDANCE_FALLBACK } from '@/components/home/HGraphMap';
import type { ImproveMetric, RootStackParamList } from '@/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'Improve'>;

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

  // Flat white cards: status reads from a single small dot + label copy,
  // never from tinted fills. Keep = CTA green, needs-a-nudge = amber dot.
  const renderCard = (m: ImproveMetric, maintain: boolean) => {
    const g = SPOKE_GUIDANCE[m.id] ?? GUIDANCE_FALLBACK;
    // Spotlight the direction that moves toward the goal.
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
    const dotColor = maintain ? GV.cta : GV.fx.amber;
    return (
      <View key={m.id} style={styles.card}>
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
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable
          onPress={() => navigation.goBack()}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={12}
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
            <View style={styles.emptyCard}>
              <View style={styles.celebrateTile}>
                <Text style={styles.celebrateGlyph}>✓</Text>
              </View>
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
                style={({ pressed }) => [styles.emptyBtn, pressed && { opacity: 0.85 }]}
                accessibilityRole="button"
                accessibilityLabel="See what to keep doing"
                hitSlop={12}
              >
                <Text style={styles.emptyBtnText}>See what to keep doing →</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>
                Nothing steady yet — let&apos;s build it
              </Text>
              <Text style={styles.emptyText}>
                Signals show up here once they have a few days of history.
                Meanwhile, tap below to see exactly what to improve first.
              </Text>
              <Pressable
                onPress={() => navigation.setParams({ focus: 'improve' })}
                style={({ pressed }) => [styles.emptyBtn, pressed && { opacity: 0.85 }]}
                accessibilityRole="button"
                accessibilityLabel="See what to improve"
                hitSlop={12}
              >
                <Text style={styles.emptyBtnText}>
                  See what to improve →
                </Text>
              </Pressable>
            </View>
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
          Wellness nudges from your own averages — not medical advice.
        </Text>
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
    paddingBottom: 32,
    gap: SPACE.cardGap,
  },
  backBtn: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: SPACE.screenH,
    borderRadius: SPACE.rPill,
    backgroundColor: GV.card,
  },
  backBtnText: {
    ...TYPE.button,
    fontSize: 15,
    color: GV.ink,
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
    marginBottom: 8,
  },
  card: {
    backgroundColor: GV.card,
    borderRadius: SPACE.rCard,
    padding: SPACE.cardPad,
    gap: 8,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  toneDot: {
    width: 10,
    height: 10,
    borderRadius: 9999,
  },
  toneLabel: {
    ...TYPE.chip,
    color: GV.ink,
    flex: 1,
  },
  valuePill: {
    backgroundColor: GV.wash,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: SPACE.rPill,
  },
  valuePillText: {
    ...TYPE.chip,
    color: GV.ink,
    fontVariant: ['tabular-nums'],
  },
  watchBlock: {
    marginTop: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: GV.wash,
    gap: 4,
  },
  cardLabel: {
    ...TYPE.title,
    color: GV.ink,
  },
  cardStatus: {
    ...TYPE.caption,
    color: GV.muted,
  },
  flag: {
    ...TYPE.caption,
    fontFamily: FONT.semi,
    color: GV.ink,
    backgroundColor: GV.wash,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    overflow: 'hidden',
    marginTop: 4,
  },
  listTitle: {
    fontFamily: FONT.semi,
    fontSize: 14,
    lineHeight: 20,
    color: GV.ink,
    marginTop: 8,
  },
  tip: {
    ...TYPE.body,
    color: GV.body,
  },
  sectionTitle: {
    ...TYPE.caption,
    color: GV.fog,
    letterSpacing: 1,
    textAlign: 'center',
    marginTop: 8,
  },
  emptyCard: {
    backgroundColor: GV.card,
    borderRadius: SPACE.rCard,
    padding: SPACE.cardPad,
    gap: 8,
    alignItems: 'center',
  },
  celebrateTile: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: GV.wash,
    alignItems: 'center',
    justifyContent: 'center',
  },
  celebrateGlyph: {
    fontFamily: FONT.semi,
    fontSize: 28,
    lineHeight: 32,
    color: GV.cta,
  },
  emptyBtn: {
    marginTop: 8,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 24,
    borderRadius: SPACE.rPill,
    backgroundColor: GV.cta,
  },
  emptyBtnText: {
    ...TYPE.button,
    fontSize: 14,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  emptyTitle: {
    ...TYPE.title,
    color: GV.ink,
    textAlign: 'center',
  },
  emptyText: {
    ...TYPE.body,
    color: GV.muted,
    textAlign: 'center',
  },
  foot: {
    ...TYPE.caption,
    color: GV.fog,
    textAlign: 'center',
    marginTop: 8,
  },
});
