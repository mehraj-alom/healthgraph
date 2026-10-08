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
import { Button, EmptyState } from '@/components';
import { GlassSurface } from '@/components/home/GlassSurface';
import { HomeStageBackdrop } from '@/components/home/HomeStageBackdrop';
import { SPACE } from '@/theme/guava';
import { LG } from '@/theme/liquidGlass';
import { getCachedPatientId } from '@/services/patientIdentity';
import { todayKey } from '@/screens/Onboarding/momentum';
import { getMedications } from '@/db/queries/medications';
import { getTakenEventsInRange } from '@/db/queries/medicationTakenEvents';
import { getObservations } from '@/db/queries/observations';
import { getSleepNights, getWeightHistory } from '@/db/queries/dailyLogs';
import { getProfileCache } from '@/db/queries/homeCache';
import { summarizeSleepNights } from '@/screens/SleepEngine/sleepEngine';
import { computeAdherence, computeRefill } from '@/utils/medicationAdherence';
import { interactionFlags } from '@/utils/drugInteractions';
import {
  buildCaregiverReportHtml,
  buildReportHtml,
  type CaregiverReportMed,
  type ReportInput,
} from '@/services/doctorReportHtml';

const WINDOW_DAYS = 30;
const CAREGIVER_WINDOW_DAYS = 7;

const SECONDARY = 'rgba(233,240,255,0.66)';
const TERTIARY = 'rgba(233,240,255,0.45)';

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
  const [caregiverMeds, setCaregiverMeds] = useState<CaregiverReportMed[]>([]);
  const [caregiverName, setCaregiverName] = useState<string | null>(null);
  const [variant, setVariant] = useState<'doctor' | 'caregiver'>('doctor');
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
        interactions: interactionFlags(active).map((f) => ({
          medicines: f.medicationIds
            .map((id) => active.find((m) => m.medication_id === id)?.name ?? null)
            .filter((n): n is string => n !== null)
            .join(' + '),
          note: f.text,
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
      const todayNoon = new Date(`${today}T12:00:00`);
      setCaregiverMeds(
        active.map((m) => {
          const events = taken.filter((e) => e.medication_id === m.medication_id);
          const adh = computeAdherence(m, events, CAREGIVER_WINDOW_DAYS, todayNoon);
          const refill = computeRefill(m, events, todayNoon);
          const dose = [
            m.strength ? `${m.strength}${m.strength_unit ? ` ${m.strength_unit}` : ''}` : null,
            m.dose_amount ? `${m.dose_amount}${m.dose_unit ? ` ${m.dose_unit}` : ''}` : null,
          ]
            .filter(Boolean)
            .join(' · ');
          const schedule = [dose || null, freqLabel(m.frequency)].filter(Boolean).join(' · ') || null;
          let supply: string | null = null;
          if (refill) {
            if (refill.out) {
              supply = 'Out of supply';
            } else if (refill.daysLeft != null) {
              const refillBit = m.refills_left != null ? ` · ${m.refills_left} ${m.refills_left === 1 ? 'refill' : 'refills'} left` : '';
              supply = `~${Math.max(1, Math.ceil(refill.daysLeft))} days left${refillBit}`;
            } else {
              supply = `${Math.max(0, Math.floor(refill.dosesLeft))} doses left`;
            }
          }
          return { name: m.name, schedule, adherence: adh.percent, supply };
        }),
      );
      setCaregiverName(profile?.data?.display_name ?? null);
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
    setGenerating(true);
    try {
      const html =
        variant === 'caregiver'
          ? buildCaregiverReportHtml({
              generatedAt: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
              windowDays: CAREGIVER_WINDOW_DAYS,
              patientName: caregiverName,
              meds: caregiverMeds,
            })
          : input
            ? buildReportHtml(input)
            : null;
      if (!html) return;
      const { uri } = await Print.printToFileAsync({ html });
      const canShare = await Sharing.isAvailableAsync().catch(() => false);
      if (canShare) {
        await Sharing.shareAsync(uri, {
          dialogTitle: variant === 'caregiver' ? 'Share caregiver report' : 'Share doctor report',
        });
      } else {
        Alert.alert('Report ready', `Saved to: ${uri}`);
      }
    } catch {
      Alert.alert('Could not create the report', 'Try again in a moment.');
    } finally {
      setGenerating(false);
    }
  }, [input, variant, caregiverMeds, caregiverName]);

  const showingCaregiver = variant === 'caregiver';
  const hasContent = showingCaregiver ? caregiverMeds.length > 0 : input !== null;

  return (
    <View style={styles.root}>
      <HomeStageBackdrop />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>{showingCaregiver ? 'Caregiver report' : 'Doctor report'}</Text>
          <Text style={styles.sub}>
            {showingCaregiver
              ? 'Last 7 days · schedule, recent taking, and supply for a family member or caregiver.'
              : 'Last 30 days, one PDF for appointments.'}
          </Text>

          <View style={styles.variantRow}>
            <Button
              title="Doctor"
              variant={showingCaregiver ? 'ghost' : 'secondary'}
              onPress={() => setVariant('doctor')}
              style={{ ...styles.variantBtn, ...(!showingCaregiver ? styles.variantActive : null) }}
              textStyle={!showingCaregiver ? styles.variantActiveText : styles.ghostText}
            />
            <Button
              title="Caregiver"
              variant={showingCaregiver ? 'secondary' : 'ghost'}
              onPress={() => setVariant('caregiver')}
              style={{ ...styles.variantBtn, ...(showingCaregiver ? styles.variantActive : null) }}
              textStyle={showingCaregiver ? styles.variantActiveText : styles.ghostText}
            />
          </View>

          {isLoading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={LG.card.mint} />
              <Text style={styles.loading}>Gathering your data on this device…</Text>
            </View>
          ) : !hasContent ? (
            <EmptyState
              title="Nothing to report yet"
              message="Log medications, sleep, or weight — then come back for your PDF."
            />
          ) : showingCaregiver ? (
            <>
              <Text style={styles.sectionTitle}>Included</Text>
              <GlassSurface strong style={styles.card}>
                <Text style={styles.line}>{`${caregiverMeds.length} ${caregiverMeds.length === 1 ? 'medicine' : 'medicines'} with recent taking`}</Text>
                <Text style={styles.line}>Schedule and supply included</Text>
              </GlassSurface>
              <Button
                title={generating ? 'Creating PDF…' : 'Generate caregiver PDF'}
                variant="secondary"
                onPress={() => void generate()}
                disabled={generating}
                fullWidth
                size="large"
                style={styles.genBtn}
                textStyle={styles.genBtnText}
              />
            </>
          ) : (
            <>
              <Text style={styles.sectionTitle}>Included</Text>
              <GlassSurface strong style={styles.card}>
                <Text style={styles.line}>{`${input!.meds.length} ${input!.meds.length === 1 ? 'medication' : 'medications'} with adherence`}</Text>
                <Text style={styles.line}>{`${input!.observations.length} recorded ${input!.observations.length === 1 ? 'observation' : 'observations'}`}</Text>
                <Text style={styles.line}>{input!.sleep ? `Sleep · ${input!.sleep.nights} nights` : 'Sleep · none logged'}</Text>
                <Text style={styles.line}>{input!.weight ? `Weight · ${input!.weight.startKg} → ${input!.weight.endKg} kg` : 'Weight · none logged'}</Text>
              </GlassSurface>
              <Button
                title={generating ? 'Creating PDF…' : 'Generate PDF'}
                variant="secondary"
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05070F' },
  safe: { flex: 1 },
  content: { paddingHorizontal: SPACE.screenH, paddingVertical: 12, paddingBottom: 32, gap: 12 },
  title: { fontWeight: '600', fontSize: 34, lineHeight: 41, letterSpacing: -0.8, color: '#FFFFFF', textAlign: 'center' },
  sub: { fontWeight: '400', fontSize: 15, lineHeight: 21, color: SECONDARY, textAlign: 'center' },
  sectionTitle: { fontWeight: '600', fontSize: 20, lineHeight: 26, letterSpacing: -0.4, color: '#FFFFFF', marginTop: 8 },
  center: { alignItems: 'center', paddingVertical: 40, gap: 12 },
  loading: { fontWeight: '400', fontSize: 15, lineHeight: 21, color: SECONDARY, textAlign: 'center' },
  card: { padding: 16 },
  line: { fontWeight: '400', fontSize: 15, lineHeight: 22, color: '#FFFFFF', paddingVertical: 4 },
  variantRow: { flexDirection: 'row', gap: 8 },
  variantBtn: { flex: 1 },
  variantActive: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  variantActiveText: { color: '#0B0F1A' },
  ghostText: { color: '#FFFFFF' },
  genBtn: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  genBtnText: { color: '#0B0F1A' },
  disclaimer: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: TERTIARY, textAlign: 'center' },
});
