/**
 * CheckinStep — onboarding step 4: the daily voice check-in, demo + setup.
 *
 * Demo half is a labeled offline sample (the five questions with example
 * answers): no mic, no audio, no permissions. Setup half books the real
 * daily call through the existing schedule module (time persists there;
 * notification permission stays moment-of-intent inside setVoiceCheckin).
 * Skippable like every other step; enabling later lives in VoiceCheckin.
 */

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Reveal } from '@/components/home/Reveal';
import { FONT, GV, TYPE } from '@/theme/guava';
import { INTERVIEW_SCRIPT } from '@/services/voiceCheckin/questions';
import {
  getVoiceCheckin,
  setVoiceCheckin,
  type VoiceCheckinTime,
} from '@/services/voiceCheckin/schedule';

const SAMPLE_VALUES = [4, 3, 2, 7, 3];

function fmtTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function CheckinStep() {
  const [time, setTime] = useState<VoiceCheckinTime>({ hour: 20, minute: 0, enabled: false });
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void getVoiceCheckin().then((t) => {
      if (live) {
        setTime(t);
        setLoaded(true);
      }
    });
    return () => {
      live = false;
    };
  }, []);

  const adjust = useCallback((key: 'hour' | 'minute', delta: number) => {
    setTime((t) => {
      const max = key === 'hour' ? 23 : 59;
      let next = (key === 'hour' ? t.hour : t.minute) + delta;
      if (next > max) next = 0;
      if (next < 0) next = max;
      return { ...t, [key]: next };
    });
  }, []);

  const apply = useCallback(
    async (enabled: boolean) => {
      if (busy) return;
      setBusy(true);
      try {
        const ok = await setVoiceCheckin({ ...time, enabled });
        if (!enabled) {
          setTime((t) => ({ ...t, enabled: false }));
          setMsg('Daily call off. You can enable it anytime from Voice check-in.');
        } else if (ok) {
          setTime((t) => ({ ...t, enabled: true }));
          setMsg(`Daily check-in call set for ${fmtTime(time.hour, time.minute)}.`);
        } else {
          setTime((t) => ({ ...t, enabled: false }));
          setMsg('Time saved. Allow notifications to receive the call.');
        }
      } finally {
        setBusy(false);
      }
    },
    [busy, time],
  );

  return (
    <View style={styles.wrap}>
      <Reveal>
        <Text style={styles.headline}>Two minutes, every day.</Text>
      </Reveal>
      <Reveal>
        <Text style={styles.sub}>
          A short call at your chosen time — five questions, and your day is logged.
        </Text>
      </Reveal>

      <View style={styles.card}>
        <Text style={styles.cardTag}>Preview</Text>
        {INTERVIEW_SCRIPT.map((q, i) => (
          <View key={q.field} style={styles.sampleRow}>
            <Text style={styles.sampleQ}>{q.prompt}</Text>
            <Text style={styles.sampleA}>{q.format(SAMPLE_VALUES[i] ?? 0)}</Text>
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTag}>Daily time</Text>
        {!loaded ? (
          <ActivityIndicator color={GV.teal} style={styles.loader} />
        ) : (
          <>
            <View style={styles.timeRow}>
              <View style={styles.stepper}>
                <Pressable
                  onPress={() => adjust('hour', 1)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Hour up"
                  style={styles.stepBtn}
                >
                  <Text style={styles.stepText}>+</Text>
                </Pressable>
                <Text style={styles.timeValue}>{fmtTime(time.hour, time.minute)}</Text>
                <Pressable
                  onPress={() => adjust('hour', -1)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Hour down"
                  style={styles.stepBtn}
                >
                  <Text style={styles.stepText}>−</Text>
                </Pressable>
              </View>
              <View style={styles.stepper}>
                <Pressable
                  onPress={() => adjust('minute', 5)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Minutes up"
                  style={styles.stepBtn}
                >
                  <Text style={styles.stepText}>+</Text>
                </Pressable>
                <Text style={styles.stepSub}>5-min steps</Text>
                <Pressable
                  onPress={() => adjust('minute', -5)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Minutes down"
                  style={styles.stepBtn}
                >
                  <Text style={styles.stepText}>−</Text>
                </Pressable>
              </View>
            </View>
            <Pressable
              onPress={() => void apply(!time.enabled)}
              disabled={busy}
              hitSlop={8}
              accessibilityRole="switch"
              accessibilityState={{ checked: time.enabled }}
              accessibilityLabel="Daily check-in call"
              style={[styles.toggle, time.enabled && styles.toggleOn]}
            >
              <Text style={[styles.toggleText, time.enabled && styles.toggleTextOn]}>
                {time.enabled ? `On · ${fmtTime(time.hour, time.minute)}` : 'Off'}
              </Text>
            </Pressable>
            {msg ? <Text style={styles.msg}>{msg}</Text> : null}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  headline: { fontWeight: '600', fontSize: 32, lineHeight: 38, letterSpacing: -0.6, color: '#FFFFFF' },
  sub: { fontWeight: '400', fontSize: 15, lineHeight: 21, color: 'rgba(233, 240, 255, 0.66)' },
  card: {
    backgroundColor: 'rgba(23, 29, 44, 0.6)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 20,
    padding: 16,
    gap: 8,
  },
  cardTag: { fontWeight: '600', fontSize: 11, lineHeight: 14, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(233,240,255,0.5)' },
  sampleRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, paddingVertical: 4 },
  sampleQ: { fontWeight: '400', fontSize: 15, lineHeight: 21, color: '#FFFFFF', flexShrink: 1 },
  sampleA: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: 'rgba(233, 240, 255, 0.6)', fontVariant: ['tabular-nums'] },
  loader: { paddingVertical: 12 },
  timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  stepper: { alignItems: 'center', gap: 2 },
  stepBtn: { minWidth: 56, minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 22, color: '#FFFFFF', fontWeight: '600' },
  timeValue: { fontSize: 36, lineHeight: 42, color: '#FFFFFF', fontWeight: '600', fontVariant: ['tabular-nums'] },
  stepSub: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: 'rgba(233, 240, 255, 0.6)' },
  toggle: {
    borderRadius: 9999,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.22)',
    paddingHorizontal: 18,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleOn: { backgroundColor: '#5CE8B8', borderColor: '#5CE8B8' },
  toggleText: { fontWeight: '600', fontSize: 13, lineHeight: 18, color: 'rgba(233, 240, 255, 0.66)' },
  toggleTextOn: { color: '#062A26' },
  msg: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: 'rgba(233, 240, 255, 0.6)', textAlign: 'center' },
});
