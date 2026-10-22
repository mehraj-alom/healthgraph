/**
 * RedeemCodeRow — "Have a code?" inside the Premium drawer section.
 *
 * Bought premium on health.healthgraph.shop (or got a support code)?
 * Enter HG-XXXX-XXXX here: the backend verifies it, mirrors the grant
 * into the purchase ledger, and the tier unlocks immediately via
 * setCodeGrant + notifyTierChanged.
 */

import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { api } from '@/services/api';
import {
  getLocalTier,
  normalizeTier,
  notifyTierChanged,
  setCodeGrant,
} from '@/services/premium';
import { LG } from '@/theme/liquidGlass';

const SECONDARY = 'rgba(233,240,255,0.66)';
const TERTIARY = 'rgba(233,240,255,0.45)';

export function RedeemCodeRow() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const redeem = async () => {
    const value = code.trim();
    if (!value || busy) return;
    setBusy(true);
    setNote(null);
    setOk(false);
    try {
      const res = await api.post<{ tier: string; expires_at?: string | null }>(
        '/api/v1/premium/redeem',
        { code: value },
      );
      const tier = normalizeTier(res.tier);
      if (tier === 'free') throw new Error('bad tier');
      if (res.expires_at) await setCodeGrant(tier, res.expires_at);
      notifyTierChanged(await getLocalTier());
      setOk(true);
      setNote(
        `Code accepted — ${tier === 'allin' ? 'All-in' : 'General'} is active. Enjoy everything.`,
      );
      setCode('');
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      setNote(
        status === 404
          ? 'Code not found — check each character and retry.'
          : status === 410
            ? 'This code is used up, expired, or revoked.'
            : 'Could not reach the server — check your connection and retry.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel="Redeem a premium code"
        style={styles.head}
      >
        <Text style={styles.headText}>Have a code?</Text>
        <Text style={styles.chev}>{open ? '▾' : '›'}</Text>
      </Pressable>
      {open ? (
        <View style={styles.body}>
          <Text style={styles.help}>
            Bought premium on our website? Enter your HG-XXXX-XXXX code.
          </Text>
          <View style={styles.row}>
            <TextInput
              value={code}
              onChangeText={setCode}
              placeholder="HG-XXXX-XXXX"
              placeholderTextColor={TERTIARY}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!busy}
              accessibilityLabel="Premium code"
              style={styles.input}
              onSubmitEditing={() => void redeem()}
            />
            <Pressable
              onPress={() => void redeem()}
              disabled={busy || !code.trim()}
              accessibilityRole="button"
              accessibilityLabel="Redeem code"
              style={({ pressed }) => [
                styles.btn,
                (busy || !code.trim()) && { opacity: 0.5 },
                pressed && { opacity: 0.8 },
              ]}
            >
              <Text style={styles.btnText}>{busy ? 'Checking…' : 'Redeem'}</Text>
            </Pressable>
          </View>
          {note ? (
            <Text style={[styles.note, ok && styles.noteOk]}>{note}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 8 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  headText: { fontWeight: '600', fontSize: 14, lineHeight: 20, color: SECONDARY },
  chev: { fontSize: 16, color: TERTIARY },
  body: { gap: 8, paddingHorizontal: 4, paddingBottom: 4 },
  help: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: TERTIARY },
  row: { flexDirection: 'row', gap: 8 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: 12,
    paddingHorizontal: 12,
    minHeight: 48,
    color: '#FFFFFF',
    fontSize: 15,
    letterSpacing: 1,
  },
  btn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 18,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: { fontWeight: '600', fontSize: 14, color: '#0B0F1A' },
  note: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: SECONDARY },
  noteOk: { color: LG.card.mint },
});
