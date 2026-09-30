/**
 * ReportScreen — one-tap doctor report (PDF).
 *
 * Assembles the last 30 days from device storage only (medications +
 * adherence, observations, sleep, weight), renders a printable document,
 * and shares it via the OS sheet. Nothing leaves the device except
 * through the user's own share action.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Button, Card, EmptyState, SectionHeader } from '@/components';
import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
import { getCachedPatientId } from '@/services/patientIdentity';
import { todayKey } from '@/screens/Onboarding/momentum';
import { getMedications } from '@/db/queries/medications';
import { getTakenEventsInRange } from '@/db/queries/medicationTakenEvents';
import { getObservations } from '@/db/queries/observations';
import { getSleepNights, getWeightHistory } from '@/db/queries/dailyLogs';
import { getProfileCache } from '@/db/queries/homeCache';
import { summarizeSleepNights } from '@/screens/SleepEngine/sleepEngine';
import { computeAdherence } from '@/utils/medicationAdherence';
import {
  buildReportHtml,
  type ReportInput,
} from '@/services/doctorReportHtml';

const WINDOW_DAYS = 30;

function shiftDay(today: string, delta: number): string {
  const d = new Date(`${today}T12:00:00`);
  d.setDate(d.getDate() + delta);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function freqLabel(frequency: string): string {
  return frequency.replace(/_/g, ' ').toLowerCase();
}

export default function ReportScreen() {
  const [input, setInput] = useState<ReportInput | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      const patientId = getCachedPatientId();
      if (!patientId || !mounted.current) {
        if (mounted.current) setIsLoading(false);
        return;
      }
      const today = todayKey();
      const start = shiftDay(today, -(WINDOW_DAYS - 1));
      const [meds, taken, obs, sleepRows, weightRows, profile] = await Promise.all([
        getMedications(patientId).catch(() => []),
        getTakenEventsInRange(patientId, `${start}T00:00:00`, `${shiftDay(today, 1)}T00:00:00`).catch(() => []),
        getObservations(patientId, { limit: 50 }).catch(() => []),
        getSleepNights(patientId, start, today).catch(() => []),
        getWeightHistory(patientId, shiftDay(today, -89), today).catch(() => []),
        getProfileCache(patientId).catch(() => ({ data: null })),
      ]);
      if (!mounted.current) return;
      const active = meds.filter((m) => m.status === 'ACTIVE');
      const sleep = summarizeSleepNights(
        sleepRows.map((r) => ({
          date: r.log_date.slice(0, 10),
          durationMinutes: r.sleep_duration_minutes,
          quality: r.sleep_quality,
          awakenings: r.sleep_awakenings,
        })),
      );
      const weights = [...weightRows].sort((a, b) => (a.log_date < b.log_date ? -1 : 1));
      const assembled: ReportInput = {
        generatedAt: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        windowDays: WINDOW_DAYS,
        patientName: profile?.data?.display_name ?? null,
        meds: active.map((m) => {
          const events = taken.filter((e) => e.medication_id === m.medication_id);
          const adh = computeAdherence(m, events, WINDOW_DAYS, new Date(`${today}T12:00:00`));
          const dose = [
            m.strength ? `${m.strength}${m.strength_unit ? ` ${m.strength_unit}` : ''}` : null,
            m.dose_amount ? `${m.dose_amount}${m.dose_unit ? ` ${m.dose_unit}` : ''}` : null,
          ]
            .filter(Boolean)
            .join(' · ');
          return {
            name: m.name,
            detail: [dose || null, freqLabel(m.frequency)].filter(Boolean).join(' · ') || null,
            adherence: adh.percent,
            status: m.status,
          };
        }),
        observations: obs.slice(0, 50).map((o) => ({
          title: o.finding_display_name || o.finding_code,
          sub: o.clinical_summary || o.visual_status || null,
        })),
        sleep:
          sleep.loggedNights > 0
            ? { nights: sleep.loggedNights, avgMinutes: sleep.avgMinutes }
            : null,
        weight:
          weights.length >= 2
            ? {
                startKg: weights[0].weight_kg,
                endKg: weights[weights.length - 1].weight_kg,
                changeKg: Math.round((weights[weights.length - 1].weight_kg - weights[0].weight_kg) * 10) / 10,
              }
            : null,
      };
      setInput(buildReportHtml(assembled) ? assembled : null);
      setIsLoading(false);
    } catch {
      if (mounted.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    setIsLoading(true);
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  const generate = useCallback(async () => {
    if (!input) return;
    const html = buildReportHtml(input);
    if (!html) return;
    setGenerating(true);
    try {
      const { uri } = await Print.printToFileAsync({ html });
      const canShare = await Sharing.isAvailableAsync().catch(() => false);
      if (canShare) {
        await Sharing.shareAsync(uri, { dialogTitle: 'Share doctor report' });
      } else {
        Alert.alert('Report ready', `Saved to: ${uri}`);
      }
    } catch {
      Alert.alert('Could not create the report', 'Try again in a moment.');
    } finally {
      setGenerating(false);
    }
  }, [input]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Doctor report.</Text>
        <Text style={styles.sub}>Last 30 days, one PDF for appointments.</Text>

        {isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#4FD1C5" />
            <Text style={styles.body}>Gathering your data on this device…</Text>
          </View>
        ) : !input ? (
          <EmptyState
            title="Nothing to report yet"
            message="Log medications, sleep, or weight — then come back for your PDF."
          />
        ) : (
          <>
            <SectionHeader dark title="Included" titleStyle={styles.histTitle} />
            <Card style={styles.darkCard}>
              <Text style={styles.line}>{`${input.meds.length} ${input.meds.length === 1 ? 'medication' : 'medications'} with adherence`}</Text>
              <Text style={styles.line}>{`${input.observations.length} recorded ${input.observations.length === 1 ? 'observation' : 'observations'}`}</Text>
              <Text style={styles.line}>{input.sleep ? `Sleep · ${input.sleep.nights} nights` : 'Sleep · none logged'}</Text>
              <Text style={styles.line}>{input.weight ? `Weight · ${input.weight.startKg} → ${input.weight.endKg} kg` : 'Weight · none logged'}</Text>
            </Card>
            <Button
              title={generating ? 'Creating PDF…' : 'Generate PDF'}
              onPress={() => void generate()}
              disabled={generating}
              fullWidth
              size="large"
              style={styles.genBtn}
              textStyle={styles.genBtnText}
            />
          </>
        )}
        <Text style={styles.disclaimer}>
          Generated on-device from your tracking data. Sharing sends it wherever you choose — nothing is uploaded to create it.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#080A11' },
  content: { paddingHorizontal: SPACE.screenH, paddingVertical: SPACE.sectionGap, paddingBottom: 32, gap: 12 },
  title: { fontFamily: FONT.semi, fontSize: 24, lineHeight: 30, letterSpacing: -0.3, color: '#FFFFFF', textAlign: 'center' },
  sub: { ...TYPE.body, color: GV.fog, textAlign: 'center' },
  histTitle: { fontSize: 20, lineHeight: 24, letterSpacing: -0.3 },
  center: { alignItems: 'center', paddingVertical: 40, gap: 12 },
  body: { color: '#8EA0B8', fontSize: 14, textAlign: 'center' },
  darkCard: {
    backgroundColor: '#10141F',
    borderColor: 'rgba(255,255,255,0.10)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 6,
  },
  line: { ...TYPE.body, color: '#FFFFFF', paddingVertical: 4 },
  genBtn: { backgroundColor: '#4FD1C5' },
  genBtnText: { color: '#062A26' },
  disclaimer: { ...TYPE.caption, color: GV.fog, textAlign: 'center' },
});
