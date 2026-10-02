/**
 * HealthConnectSection — Settings surface for Health Connect sync.
 *
 * Three honest states: unavailable (no Android native build), off
 * (disclosure + explicit connect), on (status, sync now, manage access,
 * disconnect). Same dark theme as Settings; no new components.
 */

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Card } from '@/components';
import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
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
      <Card padding="lg" level={1} style={styles.card}>
        {status === null ? (
          <ActivityIndicator accessibilityLabel="Loading Health Connect status" />
        ) : status === 'unavailable' ? (
          <>
            <Text style={styles.status}>Not available on this device or build.</Text>
            <Text style={styles.sub}>Health Connect sync needs the Android app build with Health Connect installed.</Text>
          </>
        ) : status === 'off' ? (
          <>
            <Text style={styles.status}>Not connected.</Text>
            <Text style={styles.sub}>Fill Fitness, Sleep, and Weight automatically from Health Connect. Sleep, workouts, weight, and steps import.</Text>
            <Button title="Connect Health Connect" fullWidth onPress={onConnectPress} disabled={busy} style={styles.btn} />
          </>
        ) : (
          <>
            <Text style={styles.status}>Connected · sleep, workouts, weight, steps.</Text>
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
        {busy ? <ActivityIndicator style={styles.spinner} accessibilityLabel="Working" /> : null}
        <Text style={styles.disclaimer}>Wellness tracking only — not medical advice.</Text>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { fontFamily: FONT.semi, fontSize: 17, lineHeight: 22, color: '#FFFFFF', marginBottom: 10, marginTop: SPACE.sectionGap },
  card: { gap: 8 },
  status: { ...TYPE.body, fontFamily: FONT.semi, color: '#FFFFFF' },
  sub: { ...TYPE.caption, color: GV.fog },
  btn: { marginTop: 8 },
  rowBtns: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  linkHit: { paddingVertical: 8, paddingHorizontal: 4 },
  link: { ...TYPE.body, fontFamily: FONT.semi, color: '#4FD1C5' },
  linkDanger: { ...TYPE.body, fontFamily: FONT.semi, color: GV.danger },
  spinner: { marginTop: 8 },
  disclaimer: { ...TYPE.caption, color: GV.fog, textAlign: 'center', marginTop: 6 },
});
