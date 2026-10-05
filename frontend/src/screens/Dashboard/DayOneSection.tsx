/**
 * Setup strip on the dashboard (voice slice C, redesigned).
 *
 * Shows until the three setups are done (daily call booked, medication
 * reminders on, today reflected) or dismissed via "Not now". Each row
 * deep-links its destination; this strip itself requests no permissions.
 * Frosted material card on the aurora stage (Liquid Glass content layer):
 * mint progress, hairline rows, white/fog type — no white cards, no
 * invented hues.
 */

import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { FONT } from '@/theme/guava';
import { LG } from '@/theme/liquidGlass';
import { GlassSurface } from '@/components/home/GlassSurface';
import type { Medication } from '@/types';
import { getVoiceCheckin } from '@/services/voiceCheckin/schedule';
import {
  dayOneItems,
  dismissDayOne,
  isDayOneComplete,
  isDayOneDismissed,
  type DayOneItem,
} from '@/services/dayOne';

type Nav = {
  navigate: (route: string, params?: object) => void;
};

const ROW_NAV: Record<DayOneItem['id'], { route: string; params?: object; label: string }> = {
  'checkin-call': { route: 'VoiceCheckin', params: { mode: 'setup' }, label: 'Daily check-in call' },
  'med-reminders': { route: 'Medications', label: 'Medication reminders' },
  'voice-journal': { route: 'VoiceJournal', label: 'Voice journal' },
};

export default function DayOneSection({
  loggedToday,
  medications,
}: {
  loggedToday: boolean;
  medications: Medication[];
}) {
  const navigation = useNavigation<Nav>();
  const [items, setItems] = useState<DayOneItem[] | null>(null);

  const load = useCallback(async () => {
    try {
      if (await isDayOneDismissed()) {
        setItems(null);
        return;
      }
      const call = await getVoiceCheckin().catch(() => null);
      const active = medications.filter((m) => m.status === 'ACTIVE');
      const next = dayOneItems({
        loggedToday,
        medCount: active.length,
        remindersOn: active.some((m) => m.reminder_enabled),
        callEnabled: call?.enabled === true,
        callTime:
          call && typeof call.hour === 'number' && typeof call.minute === 'number'
            ? `${String(call.hour).padStart(2, '0')}:${String(call.minute).padStart(2, '0')}`
            : null,
      });
      setItems(isDayOneComplete(next) ? null : next);
    } catch {
      setItems(null);
    }
  }, [loggedToday, medications]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const dismiss = useCallback(async () => {
    await dismissDayOne();
    setItems(null);
  }, []);

  if (items === null || items.length === 0) return null;
  const doneCount = items.filter((i) => i.done).length;

  return (
    <GlassSurface strong style={styles.group}>
      <View style={styles.headRow}>
        <Text style={styles.title} numberOfLines={1}>Get set up.</Text>
        <Text style={styles.count} numberOfLines={1}>
          {doneCount} of {items.length} ready
        </Text>
      </View>
      <View
        style={styles.barTrack}
        accessibilityRole="progressbar"
        accessibilityLabel={`${doneCount} of ${items.length} setups ready`}
      >
        <View style={[styles.barFill, { flex: doneCount }]} />
        <View style={[styles.barRest, { flex: Math.max(items.length - doneCount, 0.001) }]} />
      </View>
      {items.map((item, idx) => {
        const nav = ROW_NAV[item.id];
        return (
          <Pressable
            key={item.id}
            onPress={() => navigation.navigate(nav.route, nav.params)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`${nav.label}. ${item.status}`}
            style={({ pressed }) => [styles.row, idx < items.length - 1 && styles.rowDivided, pressed && styles.rowPressed]}
          >
            <View style={[styles.dot, item.done && styles.dotDone]}>
              {item.done ? <Text style={styles.check}>✓</Text> : null}
            </View>
            <View style={styles.rowMain}>
              <Text style={styles.rowTitle} numberOfLines={1}>{nav.label}</Text>
              <Text style={styles.rowSub} numberOfLines={1}>{item.status}</Text>
            </View>
            <Text style={styles.chev}>›</Text>
          </Pressable>
        );
      })}
      <Pressable
        onPress={() => void dismiss()}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Dismiss setup suggestions"
        style={styles.dismissHit}
      >
        <Text style={styles.dismissText}>Not now</Text>
      </Pressable>
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  group: {
    padding: 16,
    gap: 4,
    marginBottom: 24,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: {
    fontFamily: FONT.semi,
    fontSize: 16,
    lineHeight: 22,
    color: '#FFFFFF',
    flexShrink: 1,
  },
  count: {
    fontFamily: FONT.regular,
    fontSize: 13,
    lineHeight: 18,
    color: LG.card.labelSecondary,
    fontVariant: ['tabular-nums'],
    flexShrink: 0,
  },
  barTrack: {
    flexDirection: 'row',
    height: 4,
    width: 160,
    maxWidth: '42%',
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: 8,
    marginBottom: 8,
  },
  barFill: { backgroundColor: LG.card.mint },
  barRest: { backgroundColor: 'rgba(255,255,255,0.22)' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingVertical: 8,
  },
  rowPressed: { opacity: 0.7 },
  rowDivided: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.10)',
  },
  dot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotDone: { backgroundColor: LG.card.mint, borderColor: LG.card.mint },
  check: { color: '#07301F', fontWeight: '700', fontSize: 14 },
  rowMain: { flex: 1, gap: 2, minWidth: 0 },
  rowTitle: { fontFamily: FONT.medium, fontSize: 15, lineHeight: 20, color: '#FFFFFF' },
  rowSub: { fontFamily: FONT.regular, fontSize: 13, lineHeight: 18, color: LG.card.labelSecondary },
  chev: { fontSize: 20, color: LG.card.labelTertiary, flexShrink: 0 },
  dismissHit: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  dismissText: { fontFamily: FONT.semi, fontSize: 13, lineHeight: 18, color: LG.card.labelSecondary },
});
