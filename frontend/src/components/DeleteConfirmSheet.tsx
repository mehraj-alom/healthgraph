/**
 * DeleteConfirmSheet — destructive-action safeguard for account/data deletion.
 *
 * Flow: type DELETE (exact, case-sensitive) → 20-second countdown →
 * explicit final tap. The countdown is a client-side safeguard only; the
 * backend remains the authorization boundary (ownership, erasure fence,
 * scoped deletion, verification).
 *
 * Safety properties:
 * - Confirm button enables only on exact match; any edit restarts the
 *   countdown from scratch.
 * - One interval in a ref; unmount/close clears it (remount = fresh start,
 *   nothing was ever triggered implicitly).
 * - Running disables everything; duplicate taps cannot start a second
 *   request (parent in-flight guard + disabled controls).
 * - Timeout/network failure shows a reconcile-and-retry state instead of
 *   claiming "nothing was deleted" — retry is safe (idempotent backend).
 */

import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GV, TYPE, FONT } from '@/theme/guava';
import {
  DELETE_CONFIRM_PHRASE,
  DELETE_COUNTDOWN_SECONDS,
  countdownLabel,
  isDeleteConfirmed,
} from '@/services/deletionContract';

export type DeleteMode = 'data' | 'account';

export type DeleteResult =
  | { status: 'completed' }
  | { status: 'partial' }
  | { status: 'failed'; message: string; retryable: boolean };

export function DeleteConfirmSheet({
  visible,
  mode,
  scopeLines,
  running,
  result,
  onConfirm,
  onRetry,
  onClose,
}: {
  visible: boolean;
  mode: DeleteMode;
  scopeLines: string[];
  running: boolean;
  result: DeleteResult | null;
  onConfirm: () => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  const [input, setInput] = useState('');
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const matched = isDeleteConfirmed(input);
  const armed = matched && secondsLeft !== null && secondsLeft <= 0;

  const clearTimer = () => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  // Fresh start every time the sheet opens or the mode changes. A remount
  // can never resume a countdown, let alone trigger deletion.
  useEffect(() => {
    if (visible) {
      setInput('');
      setSecondsLeft(null);
    }
    clearTimer();
    return clearTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, mode]);

  // Any edit restarts the countdown from scratch.
  const handleInput = (text: string) => {
    setInput(text);
    clearTimer();
    setSecondsLeft(text === DELETE_CONFIRM_PHRASE ? DELETE_COUNTDOWN_SECONDS : null);
  };

  useEffect(() => {
    if (secondsLeft === null || secondsLeft <= 0 || running) return;
    timerRef.current = setInterval(() => {
      setSecondsLeft((s) => (s !== null && s > 0 ? s - 1 : s));
    }, 1000);
    return clearTimer;
  }, [secondsLeft === null, running]);

  const title = mode === 'data' ? 'Delete all my data?' : 'Delete account?';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={running ? undefined : onClose}
    >
      <View style={styles.scrim}>
        <SafeAreaView style={styles.sheet} edges={['bottom']}>
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.sub}>This cannot be undone.</Text>

            <View style={styles.scopeBox} accessibilityRole="summary">
              {scopeLines.map((line) => (
                <Text key={line} style={styles.scopeLine}>
                  • {line}
                </Text>
              ))}
            </View>

            {result === null ? (
              <>
                <Text style={styles.instructions}>
                  {`Type ${DELETE_CONFIRM_PHRASE} to continue, then wait for the countdown.`}
                </Text>
                <TextInput
                  style={styles.input}
                  value={input}
                  onChangeText={handleInput}
                  placeholder={DELETE_CONFIRM_PHRASE}
                  placeholderTextColor={GV.muted}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  editable={!running}
                  accessibilityLabel="Type DELETE to confirm"
                />
                <Pressable
                  onPress={onConfirm}
                  disabled={!armed || running}
                  accessibilityRole="button"
                  accessibilityLabel={countdownLabel(secondsLeft ?? DELETE_COUNTDOWN_SECONDS)}
                  accessibilityState={{ disabled: !armed || running }}
                  style={({ pressed }) => [
                    styles.confirmBtn,
                    !armed && styles.confirmBtnDisabled,
                    pressed && armed && !running && styles.confirmBtnPressed,
                  ]}
                >
                  {running ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text
                      style={[
                        styles.confirmText,
                        !armed && styles.confirmTextDisabled,
                      ]}
                    >
                      {countdownLabel(secondsLeft ?? DELETE_COUNTDOWN_SECONDS)}
                    </Text>
                  )}
                </Pressable>
                <Pressable
                  onPress={onClose}
                  disabled={running}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel deletion"
                  hitSlop={12}
                  style={styles.cancelHit}
                >
                  <Text style={styles.cancelText}>Cancel</Text>
                </Pressable>
              </>
            ) : result.status === 'completed' ? (
              <>
                <Text style={styles.doneGlyph}>✓</Text>
                <Text style={styles.doneText}>
                  {mode === 'data'
                    ? 'All health records were removed from your account and this device.'
                    : 'Your account and all data were removed.'}
                </Text>
                <Pressable
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel="Done"
                  style={({ pressed }) => [
                    styles.doneBtn,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Text style={styles.doneBtnText}>Done</Text>
                </Pressable>
              </>
            ) : result.status === 'partial' ? (
              <>
                <Text style={styles.doneText}>
                  Your records were removed, but some background systems need
                  another pass. Retry is safe — completed parts stay deleted.
                </Text>
                <Pressable
                  onPress={onRetry}
                  accessibilityRole="button"
                  accessibilityLabel="Retry deletion"
                  style={({ pressed }) => [
                    styles.doneBtn,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Text style={styles.doneBtnText}>Retry now</Text>
                </Pressable>
                <Pressable
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  hitSlop={12}
                  style={styles.cancelHit}
                >
                  <Text style={styles.cancelText}>Later</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.failGlyph}>!</Text>
                <Text style={styles.doneText}>{result.message}</Text>
                {result.retryable ? (
                  <Text style={styles.retryNote}>
                    The server may already have deleted your data — retrying
                    reconciles instead of duplicating.
                  </Text>
                ) : null}
                <Pressable
                  onPress={onRetry}
                  accessibilityRole="button"
                  accessibilityLabel="Retry deletion"
                  style={({ pressed }) => [
                    styles.doneBtn,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Text style={styles.doneBtnText}>Retry</Text>
                </Pressable>
                <Pressable
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  hitSlop={12}
                  style={styles.cancelHit}
                >
                  <Text style={styles.cancelText}>Close</Text>
                </Pressable>
              </>
            )}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#2A3049',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    maxHeight: '88%',
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 24,
    gap: 12,
  },
  title: {
    ...TYPE.title,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  sub: {
    ...TYPE.body,
    color: GV.danger,
    textAlign: 'center',
    fontFamily: FONT.semi,
  },
  scopeBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 8,
    padding: 14,
    gap: 6,
  },
  scopeLine: {
    ...TYPE.body,
    fontSize: 14,
    color: '#FFFFFF',
  },
  instructions: {
    ...TYPE.caption,
    color: GV.fog,
    textAlign: 'center',
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    borderRadius: 8,
    minHeight: 52,
    paddingHorizontal: 16,
    fontSize: 16,
    color: '#14151D',
    textAlign: 'center',
    letterSpacing: 2,
  },
  confirmBtn: {
    backgroundColor: GV.danger,
    borderRadius: 9999,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnDisabled: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  confirmBtnPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  confirmText: {
    ...TYPE.button,
    fontSize: 15,
    color: '#FFFFFF',
  },
  confirmTextDisabled: {
    color: GV.fog,
  },
  cancelHit: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: {
    fontFamily: FONT.semi,
    fontSize: 15,
    color: GV.cta,
  },
  doneGlyph: {
    fontSize: 40,
    color: GV.cta,
    textAlign: 'center',
    fontFamily: FONT.bold,
  },
  failGlyph: {
    fontSize: 40,
    color: GV.danger,
    textAlign: 'center',
    fontFamily: FONT.bold,
  },
  doneText: {
    ...TYPE.body,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  retryNote: {
    ...TYPE.caption,
    color: GV.fog,
    textAlign: 'center',
  },
  doneBtn: {
    backgroundColor: GV.cta,
    borderRadius: 9999,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBtnText: {
    ...TYPE.button,
    fontSize: 15,
    color: '#FFFFFF',
  },
});
