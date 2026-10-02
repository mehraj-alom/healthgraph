/**
 * DayOneSection — day-one starter strip on the dashboard (slice C).
 *
 * Shows above the feed until the three setups are done (daily call
 * booked, medication reminders on, today reflected) or dismissed via
 * "Not now". Each row deep-links its destination; this strip itself
 * requests no permissions — all permission surface lives in the
 * destination screens. Loads on screen focus so returning from setup
 * updates the rows without a reload.
 */

import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Card } from '@/components/Card';
import { SectionHeader } from '@/components/SectionHeader';
import { FONT, GV, TYPE } from '@/theme/guava';
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

  return (
    <View style={styles.section}>
      <SectionHeader dark title="Day one" />
      <Text style={styles.sub}>Three quick setups. Skip any of them.</Text>
      {items.map((item) => {
        const nav = ROW_NAV[item.id];
        return (
          <Card
            key={item.id}
            onPress={() => navigation.navigate(nav.route, nav.params)}
            style={styles.row}
            accessibilityLabel={`${nav.label}. ${item.status}`}
          >
            <View style={[styles.dot, item.done && styles.dotDone]}>
              {item.done ? <Text style={styles.check}>✓</Text> : null}
            </View>
            <View style={styles.rowMain}>
              <Text style={styles.rowTitle}>{nav.label}</Text>
              <Text style={styles.rowSub}>{item.status}</Text>
            </View>
            <Text style={styles.chev}>›</Text>
          </Card>
        );
      })}
      <Pressable
        onPress={() => void dismiss()}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Dismiss day-one setups"
        style={styles.dismissHit}
      >
        <Text style={styles.dismissText}>Not now</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  sub: { ...TYPE.body, color: GV.fog },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotDone: { backgroundColor: '#4FD1C5', borderColor: '#4FD1C5' },
  check: { color: '#062A26', fontWeight: '700', fontSize: 14 },
  rowMain: { flex: 1, gap: 2 },
  rowTitle: { ...TYPE.button, fontSize: 15, color: '#FFFFFF' },
  rowSub: { ...TYPE.caption, color: GV.fog },
  chev: { fontSize: 20, color: GV.fog },
  dismissHit: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  dismissText: { ...TYPE.chip, color: GV.fog },
});
