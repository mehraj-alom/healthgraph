/**
 * HealthConnectSection — Settings surface for Health Connect sync.
 *
 * Three honest states: unavailable (no Android native build), off
 * (disclosure + explicit connect), on (status, sync now, manage access,
 * disconnect). Same dark theme as Settings; no new components.
 */

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components';
import { LG } from '@/theme/liquidGlass';
import { GlassSurface } from '@/components/home/GlassSurface';
import { getCachedPatientId } from '@/services/patientIdentity';
import { DISCLOSURE_BODY, DISCLOSURE_TITLE } from '@/services/healthConnect/disclosure';
import {
  connectHealthConnect,
  connectionStatus,
  disconnectHealthConnect,
  openAccessManagement,
  readLastImport,
  runHealthConnectSync,
  type ConnectionStatus,
  type LastImportSummary,
} from '@/services/healthConnect/importWiring';

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function HealthConnectSection() {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [reason, setReason] = useState('');
  const [last, setLast] = useState<LastImportSummary | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const s = await connectionStatus();
      setStatus(s.status);
      setReason(s.reason);
      setLast(await readLastImport());
    } catch {
      setStatus('unavailable');
      setReason('status-unavailable');
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const doConnect = useCallback(async () => {
    const patientId = getCachedPatientId();
    if (!patientId) {
      Alert.alert('Sign in required', 'Sign in first, then connect Health Connect.');
      return;
    }
    setBusy(true);
    try {
      const res = await connectHealthConnect(patientId);
      await reload();
      if (res.connected && res.report) {
        Alert.alert(
          'Health Connect connected',
          `Imported ${res.report.sleepImported} ${res.report.sleepImported === 1 ? 'night' : 'nights'} of sleep and ${res.report.activitiesImported} ${res.report.activitiesImported === 1 ? 'workout' : 'workouts'}. Your hand-logged entries were left untouched.`,
        );
      } else if (res.reason === 'permission-denied') {
        Alert.alert(
          'Permission needed',
          'Health Connect permission was not granted. Open Manage access in Health Connect settings to allow sleep and workout reading, then try again.',
        );
      } else {
        Alert.alert('Not connected', 'Health Connect is not available on this device or build.');
      }
    } finally {
      setBusy(false);
    }
  }, [reload]);

  const onConnectPress = useCallback(() => {
    Alert.alert(DISCLOSURE_TITLE, DISCLOSURE_BODY, [
      { text: 'Not now', style: 'cancel' },
      { text: 'Connect', onPress: () => void doConnect() },
    ]);
  }, [doConnect]);

  const onSyncPress = useCallback(async () => {
    const patientId = getCachedPatientId();
    if (!patientId) return;
    setBusy(true);
    try {
      const report = await runHealthConnectSync(patientId);
      await reload();
      if (report.status === 'ok') {
        Alert.alert(
          'Sync complete',
          `Imported ${report.sleepImported} ${report.sleepImported === 1 ? 'night' : 'nights'} of sleep and ${report.activitiesImported} ${report.activitiesImported === 1 ? 'workout' : 'workouts'}.`,
        );
      }
    } finally {
      setBusy(false);
    }
  }, [reload]);

  const onDisconnectPress = useCallback(() => {
    Alert.alert(
      'Disconnect Health Connect?',
      'Future imports stop immediately. Nights and workouts already imported stay in your log — delete them from your data settings if needed.',
      [
        { text: 'Keep connected', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: () => {
            setBusy(true);
            disconnectHealthConnect()
              .then(() => reload())
              .finally(() => setBusy(false));
          },
        },
      ],
    );
  }, [reload]);

  const onManagePress = useCallback(() => {
    if (!openAccessManagement()) {
      Alert.alert('Health Connect settings', 'Open the Health Connect app from your device settings to manage access.');
    }
  }, []);

  return (
    <View>
      <Text style={styles.sectionTitle}>Health Connect</Text>
      <GlassSurface strong style={styles.card}>
        {status === null ? (
          <ActivityIndicator accessibilityLabel="Loading Health Connect status" color="#FFFFFF" />
        ) : status === 'unavailable' ? (
          <>
            <Text style={styles.status}>Not here.</Text>
            <Text style={styles.sub}>Needs the Android build with Health Connect installed.</Text>
          </>
        ) : status === 'off' ? (
          <>
            <Text style={styles.status}>Not connected.</Text>
            <Text style={styles.sub}>Sleep, workouts, weight, and steps — automatically.</Text>
            <Button title="Connect" fullWidth onPress={onConnectPress} disabled={busy} style={styles.btn} />
          </>
        ) : (
          <>
            <Text style={styles.status}>Connected.</Text>
            <Text style={styles.sub}>
              {last
                ? `Last import ${fmtDate(last.at)} · ${last.sleepImported} ${last.sleepImported === 1 ? 'night' : 'nights'} · ${last.activitiesImported} ${last.activitiesImported === 1 ? 'workout' : 'workouts'}`
                : 'No import yet.'}
            </Text>
            <Button title="Sync now" fullWidth onPress={() => void onSyncPress()} disabled={busy} style={styles.btn} />
            <View style={styles.rowBtns}>
              <Pressable onPress={onManagePress} accessibilityRole="button" accessibilityLabel="Manage Health Connect access" style={styles.linkHit}>
                <Text style={styles.link}>Manage access</Text>
              </Pressable>
              <Pressable onPress={onDisconnectPress} accessibilityRole="button" accessibilityLabel="Disconnect Health Connect" style={styles.linkHit}>
                <Text style={styles.linkDanger}>Disconnect</Text>
              </Pressable>
            </View>
          </>
        )}
        {busy ? <ActivityIndicator style={styles.spinner} accessibilityLabel="Working" color="#FFFFFF" /> : null}
        <Text style={styles.disclaimer}>Wellness tracking only — not medical advice.</Text>
      </GlassSurface>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    fontWeight: '600',
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: -0.3,
    color: '#FFFFFF',
    marginBottom: 12,
  },
  card: { gap: 8, padding: 20 },
  status: { fontWeight: '600', fontSize: 17, lineHeight: 22, letterSpacing: -0.1, color: '#FFFFFF' },
  sub: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: 'rgba(233,240,255,0.66)' },
  btn: { marginTop: 8 },
  rowBtns: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  linkHit: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  link: { fontWeight: '600', fontSize: 15, lineHeight: 22, color: LG.card.mint },
  linkDanger: { fontWeight: '600', fontSize: 15, lineHeight: 22, color: LG.card.danger },
  spinner: { marginTop: 8 },
  disclaimer: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: 'rgba(233,240,255,0.45)', textAlign: 'center', marginTop: 6 },
});
