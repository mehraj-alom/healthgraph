/**
 * FamilyWatchSection — user-invited missed-dose alerts (Medications tab).
 *
 * The patient invites a contact (name + phone, device-only) and links
 * medications. Missed linked doses (past a 60-minute grace window, no
 * taken event) render a card with a patient-tapped Notify action that
 * opens the system SMS composer — sent by the patient, never automatic.
 * Deleting a contact revokes its invite.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Chip, Input, Modal, SectionHeader } from '@/components';
import { getCachedPatientId } from '@/services/patientIdentity';
import {
  buildWatchMessage,
  missedDoses,
  type MissedDose,
} from '@/services/familyWatch';
import {
  addWatchContact,
  getWatch,
  removeWatchContact,
  setWatchLink,
  type StoredWatch,
} from '@/services/familyWatchStore';
import type { DailyMedicationSchedule } from '@/types';

const GRACE_MINUTES = 60;

interface Props {
  medications: { medication_id: string; name: string }[];
  schedule: DailyMedicationSchedule[];
  today: string;
}

function smsUrl(phone: string, body: string): string {
  const sep = Platform.OS === 'ios' ? '&' : '?';
  return `sms:${phone}${sep}body=${encodeURIComponent(body)}`;
}

export default function FamilyWatchSection({ medications, schedule, today }: Props) {
  const [watch, setWatch] = useState<StoredWatch | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const patientId = getCachedPatientId();
    if (!patientId) return;
    setWatch(await getWatch(patientId));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const missed: MissedDose[] = useMemo(() => {
    const slots = schedule.map((s) => ({
      medicationId: s.medication.medication_id,
      medicationName: s.medication.name,
      day: today,
      time: s.scheduled_time,
    }));
    const taken = schedule
      .filter((s) => s.taken)
      .map((s) => ({ medicationId: s.medication.medication_id, day: today, time: s.scheduled_time }));
    return missedDoses(slots, taken, new Date().toISOString(), GRACE_MINUTES);
  }, [schedule, today]);

  const linkedMedIds = useCallback(
    (contactId: string): string[] =>
      watch?.links.find((l) => l.contactId === contactId)?.medicationIds ?? [],
    [watch],
  );

  const handleAdd = useCallback(async () => {
    const patientId = getCachedPatientId();
    if (!patientId) return;
    try {
      setWatch(await addWatchContact(patientId, { name: name.trim(), phone: phone.trim() }));
      setName('');
      setPhone('');
      setFormError(null);
      setShowAdd(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Check the name and phone number.');
    }
  }, [name, phone]);

  const handleRemove = useCallback(
    (contactId: string, contactName: string) => {
      Alert.alert(
        `Remove ${contactName}?`,
        'This revokes their invite — they will no longer be listed for missed-dose alerts.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: () => {
              const patientId = getCachedPatientId();
              if (!patientId) return;
              void removeWatchContact(patientId, contactId).then(setWatch);
            },
          },
        ],
      );
    },
    [],
  );

  const toggleMed = useCallback(
    async (contactId: string, medicationId: string) => {
      const patientId = getCachedPatientId();
      if (!patientId) return;
      const current = linkedMedIds(contactId);
      const next = current.includes(medicationId)
        ? current.filter((id) => id !== medicationId)
        : [...current, medicationId];
      if (next.length === 0) return;
      try {
        setWatch(await setWatchLink(patientId, { contactId, medicationIds: next }));
      } catch {
        // Link failures leave existing links untouched.
      }
    },
    [linkedMedIds],
  );

  const notify = useCallback((contactPhone: string, contactName: string, dose: MissedDose) => {
    const msg = buildWatchMessage({
      contactName,
      medicationName: dose.medicationName,
      time: dose.time,
    });
    void Linking.openURL(smsUrl(contactPhone, msg)).catch(() => {
      Alert.alert('Could not open messages', 'Your SMS app did not open. Please try again.');
    });
  }, []);

  const contacts = watch?.contacts ?? [];
  const missedByContact = useMemo(() => {
    const out = new Map<string, MissedDose[]>();
    for (const c of contacts) {
      const ids = new Set(linkedMedIds(c.contactId));
      const hits = missed.filter((m) => ids.has(m.medicationId));
      if (hits.length > 0) out.set(c.contactId, hits);
    }
    return out;
  }, [contacts, missed, linkedMedIds]);

  return (
    <View>
      <SectionHeader dark title="Family watch" />
      <Card>
        <Text>
          Invite someone you trust: when a linked dose is missed, you can notify them with one tap
          from your phone. Nothing is sent automatically.
        </Text>
        {contacts.map((c) => (
          <View key={c.contactId} style={styles.contact}>
            <View style={styles.contactRow}>
              <Text style={styles.contactName}>
                {c.name} · {c.phone}
              </Text>
              <Pressable
                onPress={() => handleRemove(c.contactId, c.name)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${c.name}`}
              >
                <Text style={styles.remove}>Remove</Text>
              </Pressable>
            </View>
            <View style={styles.chips}>
              {medications.map((m) => (
                <Chip
                  key={m.medication_id}
                  label={m.name}
                  selected={linkedMedIds(c.contactId).includes(m.medication_id)}
                  onPress={() => void toggleMed(c.contactId, m.medication_id)}
                  size="medium"
                  accessibilityLabel={`Watch ${m.name} for ${c.name}`}
                />
              ))}
            </View>
            {(missedByContact.get(c.contactId) ?? []).map((dose) => (
              <View key={`${dose.medicationId}-${dose.time}`} style={styles.missedRow}>
                <Text style={styles.missedText}>
                  Missed: {dose.medicationName} at {dose.time}
                </Text>
                <Button
                  title={`Notify ${c.name}`}
                  onPress={() => notify(c.phone, c.name, dose)}
                  size="medium"
                />
              </View>
            ))}
          </View>
        ))}
        <Button title="Invite family member" onPress={() => setShowAdd(true)} size="medium" />
      </Card>

      <Modal visible={showAdd} onClose={() => setShowAdd(false)} title="Invite family member" subtitle="Stored on this device only.">
        <Input label="Name" value={name} onChangeText={setName} placeholder="Mira" />
        <Input
          label="Phone"
          value={phone}
          onChangeText={setPhone}
          placeholder="+14155552671"
          keyboardType="phone-pad"
        />
        {formError !== null ? <Text style={styles.error}>{formError}</Text> : null}
        <Button title="Add contact" onPress={() => void handleAdd()} size="medium" />
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  contact: {
    marginTop: 12,
  },
  contactRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  contactName: {
    fontWeight: '600',
  },
  remove: {
    opacity: 0.7,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginVertical: 8,
  },
  missedRow: {
    marginVertical: 4,
  },
  missedText: {
    marginBottom: 4,
  },
  error: {
    marginVertical: 8,
  },
});
