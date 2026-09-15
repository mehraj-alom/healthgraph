import {
  ActivityIndicator,
  StyleSheet,
  View,
  Text,
  TextInput,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
} from 'react-native';
import { memo, useState, useRef, useEffect, useCallback } from 'react';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import { BottomSheet } from '@/components/BottomSheet';
import { formatFileSize } from '@/services/documents';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSpring,
  withDelay,
  Easing,
  type SharedValue,
} from 'react-native-reanimated';
import axios from 'axios';
import Svg, { Rect, Circle, Defs, Pattern } from 'react-native-svg';

import { api } from '@/services/api';
import { BrandLogo } from '@/components/BrandLogo';
import {
  COLORS,
  SPACING,
  BORDER_RADIUS,
  TYPOGRAPHY,
  MEDICAL_DISCLAIMER,
} from '@/constants';
import { useReducedMotion } from '@/theme/useReducedMotion';
import { bezier, curves } from '@/theme/motion';
import { useAuth } from '@/context/AuthContext';
import { useDocuments, type ProcessingStage } from '@/context/DocumentsContext';
import { useDailyMetrics } from '@/hooks/useDailyMetrics';
import { formatFirstName } from '@/utils/name';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  ui_actions?: {
    action_type: string;
    structure_id: string | null;
    mesh_node_name: string | null;
    visual_status: string | null;
  }[];
}

interface ChatResponse {
  conversation_id: string;
  response_text: string;
  ui_actions: {
    action_type: string;
    structure_id: string | null;
    mesh_node_name: string | null;
    visual_status: string | null;
  }[];
}

interface SuggestionDef {
  icon: string;
  text: string;
  category: 'sleep' | 'symptom' | 'energy' | 'stress' | 'record' | 'general';
}

const ALL_SUGGESTIONS: SuggestionDef[] = [
  { icon: '🌙', text: 'How has my sleep been this week?', category: 'sleep' },
  { icon: '💊', text: 'What symptoms have I logged recently?', category: 'symptom' },
  { icon: '⚡', text: 'How has my energy been lately?', category: 'energy' },
  { icon: '🧘', text: 'Has my stress changed recently?', category: 'stress' },
  { icon: '📋', text: 'What changed in my recent health records?', category: 'record' },
  { icon: '📊', text: 'Show me my recent health trends.', category: 'general' },
  { icon: '📝', text: 'What should I log today?', category: 'general' },
  { icon: '🔬', text: 'Have I had any abnormal lab results?', category: 'record' },
  { icon: '😴', text: 'How was my sleep last night?', category: 'sleep' },
  { icon: '🩺', text: 'Summarize my recent medical records.', category: 'record' },
];

// Suggestion tint per category — same accent family as the rest of Home.
const SUGGESTION_TINT: Record<SuggestionDef['category'], string> = {
  sleep: '#8A7BC8',
  symptom: '#C2503E',
  energy: '#E8862E',
  stress: '#C96A1E',
  record: '#8A7BC8',
  general: '#4A90C2',
};

function getGreetingTime(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function useSmartSuggestions(): SuggestionDef[] {
  const metrics = useDailyMetrics();
  const documents = useDocuments();
  const [selected, setSelected] = useState<SuggestionDef[]>([]);

  useEffect(() => {
    const data = metrics.data;
    const priorities: SuggestionDef[] = [];

    if (data?.latest_sleep) {
      priorities.push(...ALL_SUGGESTIONS.filter((s) => s.category === 'sleep'));
    }
    if (data?.today_wellbeing) {
      priorities.push(...ALL_SUGGESTIONS.filter((s) => s.category === 'energy' || s.category === 'stress'));
    }
    if (data?.recent_daily_logs?.some((log) =>
      log.categories.some((category) => category.toLowerCase().includes('symptom'))
    )) {
      priorities.push(...ALL_SUGGESTIONS.filter((s) => s.category === 'symptom'));
    }
    if (documents.documents.length > 0) {
      priorities.push(...ALL_SUGGESTIONS.filter((s) => s.category === 'record'));
    }
    priorities.push(...ALL_SUGGESTIONS.filter((s) => s.category === 'general'));

    const seen = new Set<string>();
    const unique = priorities.filter((s) => {
      if (seen.has(s.text)) return false;
      seen.add(s.text);
      return true;
    });

    for (let i = unique.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [unique[i], unique[j]] = [unique[j], unique[i]];
    }

    setSelected(unique.slice(0, 4));
  }, [documents.documents.length, metrics.data]);

  return selected;
}

// ─── Motion primitives (Reanimated, UI thread; static under reduced motion) ──

function Enter({
  children,
  index = 0,
  style,
}: {
  children: React.ReactNode;
  index?: number;
  style?: object;
}) {
  const reduced = useReducedMotion();
  const o = useSharedValue(reduced ? 1 : 0);
  const y = useSharedValue(reduced ? 0 : 14);
  useEffect(() => {
    if (reduced) return;
    const d = Math.min(index * 45, 320);
    o.value = withDelay(d, withTiming(1, { duration: 260, easing: bezier(curves.standard) }));
    y.value = withDelay(d, withSpring(0, { duration: 420, dampingRatio: 0.85 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);
  const s = useAnimatedStyle(() => ({ opacity: o.value, transform: [{ translateY: y.value }] }));
  return <Animated.View style={[style, s]}>{children}</Animated.View>;
}

/** Three bouncing dots — the time-to-first-token bridge. */
function BounceDot({ offset, driver }: { offset: number; driver: SharedValue<number> }) {
  const reduced = useReducedMotion();
  const s = useAnimatedStyle(() => {
    if (reduced) return { opacity: 0.9, transform: [{ translateY: 0 }] };
    const p = (driver.value + offset) % 1;
    const lift = p < 0.5 ? Math.sin((p / 0.5) * Math.PI) : 0;
    return { opacity: 0.45 + lift * 0.55, transform: [{ translateY: -lift * 4 }] };
  });
  return <Animated.View style={[styles.typingDot, s]} />;
}

function TypingDots() {
  const reduced = useReducedMotion();
  const t = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) {
      t.value = 1;
      return;
    }
    t.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.linear }), -1, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);
  return (
    <View
      style={styles.typingDots}
      accessibilityLiveRegion="polite"
      accessibilityLabel="Assistant is thinking"
    >
      <BounceDot offset={0} driver={t} />
      <BounceDot offset={0.33} driver={t} />
      <BounceDot offset={0.66} driver={t} />
    </View>
  );
}

// ─── Streaming reveal (client-side progressive render over one blocking call) ─

const REVEAL_TICK_MS = 32;
const WORDS_PER_TICK = 4;

/**
 * StreamText reveals a complete reply word-by-word, then holds it. While
 * `live`, a caret rides at the edge; a tick callback lets the list keep the
 * newest words in view. Pure presentational — the request flow is untouched.
 */
function StreamText({
  text,
  live,
  onTick,
  onDone,
}: {
  text: string;
  live: boolean;
  onTick?: () => void;
  onDone?: () => void;
}) {
  const words = (text.match(/\S+\s*/g) ?? [text]);
  const [count, setCount] = useState(live ? 0 : words.length);
  const tickRef = useRef(0);

  useEffect(() => {
    setCount(live ? 0 : words.length);
    tickRef.current = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  useEffect(() => {
    if (!live) {
      setCount(words.length);
      return;
    }
    if (count >= words.length) {
      onDone?.();
      return;
    }
    const id = setTimeout(() => {
      setCount((c) => Math.min(words.length, c + WORDS_PER_TICK));
      tickRef.current += 1;
      if (tickRef.current % 8 === 0) onTick?.();
    }, REVEAL_TICK_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, count, text]);

  return (
    <Text
      style={styles.messageText}
      selectable
      accessibilityLiveRegion="polite"
    >
      {words.slice(0, count).join('')}
      {live && count < words.length ? <Text style={styles.caret}>▍</Text> : null}
    </Text>
  );
}

function SuggestionRow({
  suggestion,
  index,
  onPress,
}: {
  suggestion: SuggestionDef;
  index: number;
  onPress: () => void;
}) {
  const tint = SUGGESTION_TINT[suggestion.category];
  return (
    <Enter index={index}>
      <Pressable
        style={({ pressed }) => [styles.suggestionPlain, pressed && { opacity: 0.55 }]}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Ask: ${suggestion.text}`}
      >
        <View style={[styles.suggestionDot, { backgroundColor: tint }]} />
        <Text style={styles.suggestionPlainText}>{suggestion.text}</Text>
        <Text style={styles.suggestionPlainArrow}>›</Text>
      </Pressable>
    </Enter>
  );
}

function FollowChip({ text, onPress }: { text: string; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.followChip, pressed && { opacity: 0.7 }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Ask follow-up: ${text}`}
    >
      <Text style={styles.followChipText} numberOfLines={1}>{text}</Text>
    </Pressable>
  );
}

/**
 * Composer — owns the draft text locally so every keystroke re-renders ONLY
 * the input row, not the message list, backdrop, and suggestions. Sends the
 * committed text up; the parent clears nothing (it never held the draft).
 */
function Composer({
  sending,
  busy,
  onSend,
  onStop,
  onAttach,
}: {
  sending: boolean;
  busy: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  onAttach: () => void;
}) {
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    onSend(trimmed);
    setText('');
  };

  return (
    <View style={styles.inputContainer}>
      <View style={[styles.composerShell, focused && styles.composerShellFocused]}>
        <Pressable
          onPress={onAttach}
          accessibilityRole="button"
          accessibilityLabel="Attach a medical record"
          hitSlop={8}
          style={({ pressed }) => [styles.attachButton, pressed && { opacity: 0.6 }]}
        >
          <Text style={styles.attachGlyph}>📎</Text>
        </Pressable>
        <TextInput
          ref={inputRef}
          style={styles.inputInner}
          value={text}
          onChangeText={setText}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={sending ? 'Waiting for reply…' : 'Ask about your health…'}
          placeholderTextColor="#C9BBA9"
          multiline
          maxLength={2000}
          editable={!sending}
          returnKeyType="send"
          blurOnSubmit={false}
          onSubmitEditing={submit}
          keyboardAppearance="light"
          underlineColorAndroid="transparent"
          accessibilityLabel="Message input"
        />
        <View style={styles.composerAction}>
          <SendSparkles />
          {busy ? (
            <Pressable
              onPress={onStop}
              accessibilityRole="button"
              accessibilityLabel="Stop generating"
              style={({ pressed }) => [styles.stopButton, pressed && { opacity: 0.7, transform: [{ scale: 0.94 }] }]}
            >
              <Text style={styles.stopButtonText}>■</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={submit}
              disabled={!text.trim()}
              accessibilityRole="button"
              accessibilityLabel="Send message"
              style={({ pressed }) => [
                styles.sendButton,
                !text.trim() && styles.sendButtonDisabled,
                pressed && text.trim() && styles.sendButtonPressed,
              ]}
            >
              <Text style={styles.sendButtonText}>↑</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

/**
 * SendSparkles — light-green bubbles and "+" motes drifting up from the send
 * button. One shared UI-thread loop; each mote reads a phase-shifted window
 * of it, so eight particles cost one animation. Static when reduced motion.
 */const SPARK_SEEDS = [
  { dx: -15, size: 7, delay: 0, plus: false },
  { dx: -8, size: 5, delay: 0.22, plus: true },
  { dx: -2, size: 8, delay: 0.4, plus: false },
  { dx: 5, size: 5, delay: 0.58, plus: false },
  { dx: 12, size: 6, delay: 0.72, plus: true },
  { dx: 16, size: 4, delay: 0.86, plus: false },
];

function Spark({
  driver,
  dx,
  size,
  delay,
  plus,
}: {
  driver: SharedValue<number>;
  dx: number;
  size: number;
  delay: number;
  plus: boolean;
}) {
  const s = useAnimatedStyle(() => {
    const p = (((driver.value + delay) % 1) + 1) % 1;
    const fade = Math.sin(p * Math.PI);
    return {
      opacity: fade * 0.95,
      transform: [{ translateY: -(4 + p * (plus ? 74 : 60)) }, { scale: 1 - p * 0.45 }],
    };
  });
  if (plus) {
    return (
      <Animated.Text style={[styles.sparkPlus, { left: 22 + dx - 7 }, s]}>
        +
      </Animated.Text>
    );
  }
  return (
    <Animated.View
      style={[styles.sparkDot, { width: size, height: size, borderRadius: size / 2, left: 22 + dx - size / 2 }, s]}
    />
  );
}

function SendSparkles() {
  const reduced = useReducedMotion();
  const t = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    t.value = withRepeat(withTiming(2, { duration: 5200, easing: Easing.linear }), -1, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);
  if (reduced) return null;
  return (
    <View pointerEvents="none" style={styles.sparkField}>
      {SPARK_SEEDS.map((c, i) => (
        <Spark key={i} driver={t} dx={c.dx} size={c.size} delay={c.delay} plus={c.plus} />
      ))}
    </View>
  );
}

/** Midnight-garden wash behind the conversation — lime aura, teal depth,
 * faint dot grid. Pure decoration, never intercepts touches. Memoized: the
 * parent re-renders on every keystroke/tick, the backdrop must not. */
const ChatBackdrop = memo(function ChatBackdrop() {
  return (
    <View pointerEvents="none" style={styles.chatBg}>
      <View style={styles.chatAuraPeach} />
      <View style={styles.chatAuraCream} />
      <Svg width="100%" height="100%" style={styles.chatTexture}>
        <Defs>
          <Pattern id="chatDots" width={22} height={22} patternUnits="userSpaceOnUse">
            <Circle cx={1.5} cy={1.5} r={1.2} fill="rgba(154,52,18,0.07)" />
          </Pattern>
        </Defs>
        <Rect x={0} y={0} width="100%" height="100%" fill="url(#chatDots)" />
      </Svg>
    </View>
  );
});

/**
 * Quiet disclaimer — a one-line footnote that expands to the full medical
 * text on tap. Legally present, visually out of the way.
 */
function DisclaimerNote({ style }: { style?: object }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={[styles.dnWrap, style]}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={open ? 'Hide medical disclaimer' : 'Show medical disclaimer'}
        style={styles.dnHead}
      >
        <Text style={styles.dnHeadText}>ⓘ Wellness info only — not medical advice</Text>
        <Text style={styles.dnChevron}>{open ? '▾' : '▸'}</Text>
      </Pressable>
      {open ? (
        <Text style={styles.disclaimerText}>{MEDICAL_DISCLAIMER}</Text>
      ) : null}
    </View>
  );
}

const DOC_ACCEPT = ['application/pdf', 'image/png', 'image/jpeg'];
const DOC_MAX_BYTES = 50 * 1024 * 1024;

const DOC_STAGES = [
  { key: 'uploading', label: 'Uploading' },
  { key: 'uploaded', label: 'Uploaded' },
  { key: 'processing', label: 'Processing' },
  { key: 'extracted', label: 'Extracted' },
  { key: 'completed', label: 'Ready' },
] as const;

function isTerminalStage(stage: string): boolean {
  return stage === 'completed' || stage === 'failed' || stage === 'failed_triage';
}

/**
 * DocSheet — medical-record upload + live processing, inside Chat.
 * Pick → preview → upload → stage tracker → "ask about it". Processing
 * continues in DocumentsContext when the sheet closes; the header chip
 * reopens tracking. Subscribe-only updates: nothing here polls.
 */
function DocSheet({
  visible,
  track,
  onClose,
  onAsk,
}: {
  visible: boolean;
  track: { id: string; name: string; stage: string } | null;
  onClose: () => void;
  onAsk: (text: string) => void;
}) {
  const { uploadAndProcess, subscribeStage, dismissProcessing } = useDocuments();
  const [file, setFile] = useState<{ uri: string; name: string; type: string; size: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tracked, setTracked] = useState<{ id: string; name: string } | null>(null);
  const [stage, setStage] = useState<string>('idle');
  const [uploading, setUploading] = useState(false);

  // Open in tracking mode from the header chip; reset picks on close.
  useEffect(() => {
    if (visible && track && !tracked) {
      setTracked({ id: track.id, name: track.name });
      setStage(track.stage);
    }
    if (!visible) {
      setFile(null);
      setError(null);
      setTracked(null);
      setStage('idle');
      setUploading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (!tracked) return;
    return subscribeStage(tracked.id, (s: ProcessingStage) => setStage(String(s)));
  }, [tracked, subscribeStage]);

  const pickFile = useCallback(async () => {
    setError(null);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: DOC_ACCEPT,
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      const ext = asset.name.split('.').pop()?.toLowerCase() ?? '';
      if (!['.pdf', '.png', '.jpg', '.jpeg'].includes(`.${ext}`) && !DOC_ACCEPT.includes(asset.mimeType ?? '')) {
        setError('Unsupported file type. Please choose a PDF, PNG, JPG, or JPEG file.');
        return;
      }
      if (asset.size && asset.size > DOC_MAX_BYTES) {
        setError(`File is too large (${formatFileSize(asset.size)}). Maximum is ${formatFileSize(DOC_MAX_BYTES)}.`);
        return;
      }
      setFile({ uri: asset.uri, name: asset.name, type: asset.mimeType ?? 'application/octet-stream', size: asset.size ?? 0 });
    } catch {
      setError('Failed to select file. Please try again.');
    }
  }, []);

  const startUpload = useCallback(() => {
    if (!file) return;
    setError(null);
    setUploading(true);
    uploadAndProcess(
      { uri: file.uri, name: file.name, type: file.type },
      (docId) => {
        setUploading(false);
        setTracked({ id: docId, name: file.name });
        setStage('uploaded');
        setFile(null);
      },
      (message) => {
        setUploading(false);
        setError(message);
      },
    );
  }, [file, uploadAndProcess]);

  const terminal = tracked != null && isTerminalStage(stage);
  const failed = stage === 'failed' || stage === 'failed_triage';
  const stageIndex = DOC_STAGES.findIndex((s) => s.key === stage);

  const closeAndDismiss = () => {
    if (tracked) dismissProcessing(tracked.id);
    onClose();
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Medical records">
      <View style={styles.sheetBody}>
        {tracked ? (
          <>
            <Text style={styles.sheetFileName} numberOfLines={1}>{tracked.name}</Text>
            {DOC_STAGES.map((s, i) => {
              const done = stageIndex >= i && !failed;
              const current = stageIndex === i && !terminal;
              return (
                <View key={s.key} style={styles.sheetStageRow}>
                  <View style={[styles.sheetDot, done && styles.sheetDotDone, current && styles.sheetDotCurrent]}>
                    {done && !terminal ? <Text style={styles.sheetCheck}>✓</Text> : null}
                  </View>
                  <Text style={[styles.sheetStageLabel, (done || current) && styles.sheetStageLabelOn]}>
                    {s.label}
                  </Text>
                  {current ? <ActivityIndicator size="small" color={EMBER} /> : null}
                </View>
              );
            })}
            {failed ? (
              <Text style={styles.sheetError}>
                {stage === 'failed_triage'
                  ? 'This document was not recognized as a medical record.'
                  : 'Processing failed. Your original document is still safe.'}
              </Text>
            ) : null}
            {error ? <Text style={styles.sheetError}>{error}</Text> : null}
            {terminal && !failed ? (
              <Pressable
                onPress={() => {
                  const name = tracked.name;
                  closeAndDismiss();
                  onAsk(`What did you find in my document "${name}"?`);
                }}
                style={({ pressed }) => [styles.sheetPrimary, pressed && { opacity: 0.8 }]}
                accessibilityRole="button"
                accessibilityLabel="Ask about this document"
              >
                <Text style={styles.sheetPrimaryText}>Ask about it</Text>
              </Pressable>
            ) : null}
            {terminal ? (
              <Pressable
                onPress={closeAndDismiss}
                style={({ pressed }) => [styles.sheetGhost, pressed && { opacity: 0.7 }]}
                accessibilityRole="button"
                accessibilityLabel="Close records"
              >
                <Text style={styles.sheetGhostText}>Done</Text>
              </Pressable>
            ) : (
              <Text style={styles.sheetHint}>Processing continues even if you close this.</Text>
            )}
          </>
        ) : file ? (
          <>
            <View style={styles.sheetPreview}>
              <Text style={styles.sheetPreviewIcon}>{file.type.includes('pdf') ? '📑' : '🖼'}</Text>
              <View style={styles.sheetPreviewInfo}>
                <Text style={styles.sheetFileName} numberOfLines={1}>{file.name}</Text>
                <Text style={styles.sheetMeta}>{formatFileSize(file.size)}</Text>
              </View>
            </View>
            {error ? <Text style={styles.sheetError}>{error}</Text> : null}
            <Pressable
              onPress={startUpload}
              disabled={uploading}
              style={({ pressed }) => [styles.sheetPrimary, pressed && { opacity: 0.8 }]}
              accessibilityRole="button"
              accessibilityLabel="Upload and process document"
            >
              <Text style={styles.sheetPrimaryText}>{uploading ? 'Starting…' : 'Upload & Process'}</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setFile(null);
                setError(null);
              }}
              style={({ pressed }) => [styles.sheetGhost, pressed && { opacity: 0.7 }]}
              accessibilityRole="button"
              accessibilityLabel="Choose a different file"
            >
              <Text style={styles.sheetGhostText}>Choose different file</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable
              onPress={() => void pickFile()}
              style={({ pressed }) => [styles.sheetDrop, pressed && { opacity: 0.75 }]}
              accessibilityRole="button"
              accessibilityLabel="Choose a medical document to upload"
            >
              <Text style={styles.sheetDropIcon}>📄</Text>
              <Text style={styles.sheetDropTitle}>Tap to choose a file</Text>
              <Text style={styles.sheetMeta}>PDF, PNG, JPG · max {formatFileSize(DOC_MAX_BYTES)}</Text>
            </Pressable>
            {error ? <Text style={styles.sheetError}>{error}</Text> : null}
          </>
        )}
      </View>
    </BottomSheet>
  );
}

export default function ChatScreen() {
  const navigation = useNavigation<any>();
  const { userProfile } = useAuth();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [revealingId, setRevealingId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);

  const flatListRef = useRef<FlatList<ChatMessage>>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Document processing alongside chat — subscribe-only (structural changes
  // re-render; stage ticks stay inside the sheet via subscribeStage).
  const { processingVersion, getActiveProcessing } = useDocuments();
  const [docSheet, setDocSheet] = useState<{ open: boolean; track: { id: string; name: string; stage: string } | null }>({
    open: false,
    track: null,
  });
  // Reference the version counter so header-chip visibility follows it.
  const activeDocs = processingVersion >= 0 ? getActiveProcessing() : [];
  const firstActive = activeDocs[0] ?? null;

  const suggestions = useSmartSuggestions();

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Once the newest assistant message has been committed to state and the
  // list rendered it (sending == false), report it for the success diagnostic.
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (last && last.role === 'assistant' && !sending) {
      if (__DEV__) console.log(`[Chat] rendered=true textLength=${last.content.length}`);
    }
  }, [messages, sending]);

  const sendMessage = async (text?: string) => {
    const trimmedMessage = (text ?? '').trim();
    if (!trimmedMessage || sending) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: trimmedMessage,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setSending(true);

    const controller = new AbortController();
    abortRef.current = controller;

    let t0: number | undefined;
    try {
      const chatUrl = '/api/v1/chat';
      const chatPayload = {
        message: userMessage.content,
        conversation_id: conversationId,
        focused_structure_id: null,
      };
      if (__DEV__) console.log('[Chat] requestStarted=true');
      if (__DEV__) console.log(`[Chat] request URL = ${chatUrl}`);
      t0 = Date.now();

      // The agent pipeline (LLM planning + tool execution + final synthesis)
      // can legitimately run longer than the default axios timeout. Give this
      // call a generous ceiling so a slow-but-successful 200 is never aborted
      // client-side and turned into a fake network error.
      const http = await api.getClient().post<ChatResponse>(
        chatUrl,
        chatPayload,
        { timeout: 180000, signal: controller.signal },
      );
      const elapsed = Date.now() - t0;
      if (__DEV__) console.log(`[Chat] httpStatus=${http.status} duration=${elapsed}ms`);

      const body: any = http.data ?? {};
      if (__DEV__) console.log('[Chat] response keys=', Object.keys(body));

      // ── Response normalization ────────────────────────────────────────────
      // Backend ChatResponse schema (app/api/v1/chat.py + schemas/chat.py):
      //   { conversation_id: string, response_text: string, ui_actions: [] }
      // response_text is authoritative; the extra fallbacks below exist so a
      // successful 200 can never fall through to the generic error message.
      let assistantText = '';
      for (const key of ['response_text', 'message', 'answer', 'content', 'response']) {
        const value = body?.[key];
        if (typeof value === 'string' && value.trim().length > 0) {
          assistantText = value;
          break;
        }
      }
      const nextConversationId: string | null =
        typeof body?.conversation_id === 'string' ? body.conversation_id : null;
      const uiActions = Array.isArray(body?.ui_actions) ? body.ui_actions : [];

      if (__DEV__) console.log(`[Chat] responseParsed=${assistantText.length > 0}`);
      if (__DEV__) console.log(`[Chat] assistantTextLength=${assistantText.length}`);

      const assistantMessage: ChatMessage = {
        id: `${Date.now()}-assistant`,
        role: 'assistant',
        content: assistantText.length > 0 ? assistantText : 'Processing incomplete.',
        timestamp: new Date(),
        ui_actions: uiActions,
      };

      setMessages((prev) => [...prev, assistantMessage]);
      setRevealingId(assistantMessage.id);
      if (nextConversationId) setConversationId(nextConversationId);
      if (__DEV__) console.log('[Chat] messageInserted=true');
    } catch (error: any) {
      // Client-side stop (Stop button) is not a failure — keep the prompt,
      // show no error bubble.
      if (axios.isAxiosError(error) && error.code === 'ERR_CANCELED') {
        if (__DEV__) console.log('[Chat] requestStoppedByUser=true');
        return;
      }
      // Reaching this block means the request genuinely failed at the
      // transport/HTTP level (timeout, network loss, non-2xx). A backend that
      // returned 200 with an answer never lands here.
      const elapsed = Date.now() - (t0 ?? Date.now());
      const errCode = error?.code ?? error?.name ?? 'UNKNOWN';
      const errMsg = error?.message ?? String(error);
      const errStatus = error?.response?.status ?? 'NO_RESPONSE';
      console.warn(`[Chat] request FAILED code=${errCode} status=${errStatus} duration=${elapsed}ms message=${errMsg}`);
      if (error?.request) {
        console.warn('[Chat] request config:', {
          url: error?.config?.url,
          baseURL: error?.config?.baseURL,
          method: error?.config?.method,
        });
      }
      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-error`,
          role: 'assistant',
          content: 'I apologize, but I encountered an error. Please try again.',
          timestamp: new Date(),
        },
      ]);
    } finally {
      abortRef.current = null;
      setSending(false);
    }
  };

  const stopAll = useCallback(() => {
    // In-flight request: abort the HTTP call (backend sees a disconnect).
    // Revealing reply: finish instantly. Same slot as send, no hunt.
    if (abortRef.current) abortRef.current.abort();
    setRevealingId(null);
  }, []);

  const regenerate = useCallback(() => {
    if (sending) return;
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastAssistant || !lastUser) return;
    setMessages((prev) => prev.filter((m) => m.id !== lastAssistant.id));
    // Defer the resend until the removal has committed.
    setTimeout(() => {
      void sendMessage(lastUser.content);
    }, 60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sending, messages]);

  const busy = sending || revealingId != null;
  const isEmpty = messages.length === 0;
  const firstName = formatFirstName(userProfile?.displayName) || null;
  const greeting = getGreetingTime();

  const lastAssistantId =
    messages.length > 0 && messages[messages.length - 1].role === 'assistant'
      ? messages[messages.length - 1].id
      : null;

  const renderMessageActions = (item: ChatMessage, isLast: boolean) => {
    if (item.role !== 'assistant' || sending) return null;
    const actions = item.ui_actions ?? [];
    const structures = actions.filter((a) => a.structure_id);
    return (
      <View style={styles.msgActions}>
        {structures.slice(0, 2).map((a, i) => (
          <Pressable
            key={`${a.structure_id}-${i}`}
            onPress={() => navigation.navigate('Body', { focusStructureId: a.structure_id ?? undefined })}
            style={({ pressed }) => [styles.actionChip, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel={`View ${a.mesh_node_name ?? 'area'} in 3D body`}
          >
            <Text style={styles.actionChipText}>
              🦴 View {prettyStructure(a.structure_id)} in 3D
            </Text>
          </Pressable>
        ))}
        {isLast ? (
          <Pressable
            style={({ pressed }) => [styles.regenBtn, pressed && { opacity: 0.7 }]}
            onPress={regenerate}
            accessibilityRole="button"
            accessibilityLabel="Regenerate response"
          >
            <Text style={styles.regenText}>↻ Regenerate</Text>
          </Pressable>
        ) : null}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardAvoiding}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : undefined}
        enabled={Platform.OS === 'ios'}
      >
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <BrandLogo height={22} />
            <View style={styles.headerText}>
              <View style={styles.headerTitleRow}>
                <Text style={styles.headerTitle}>healthgraph AI</Text>
                <View style={styles.headerDot} />
              </View>
              <Text style={styles.headerSub}>Online · reads your logs & records</Text>
            </View>
          </View>

          {/* Live processing chip — tap to track the running document */}
          {firstActive && !docSheet.open ? (
            <Pressable
              onPress={() =>
                setDocSheet({
                  open: true,
                  track: { id: firstActive.documentId, name: firstActive.fileName, stage: firstActive.stage },
                })
              }
              style={({ pressed }) => [styles.processingChip, pressed && { opacity: 0.75 }]}
              accessibilityRole="button"
              accessibilityLabel={`Track processing document ${firstActive.fileName}`}
            >
              <ActivityIndicator size="small" color={EMBER} />
              <Text style={styles.processingChipText} numberOfLines={1}>
                {firstActive.fileName} · {firstActive.stage}
              </Text>
            </Pressable>
          ) : null}

          <View style={styles.messagesContainer}>
            <ChatBackdrop />
            {isEmpty ? (
              <FlatList
                data={[]}
                keyExtractor={() => 'empty'}
                renderItem={null}
                ListHeaderComponent={
                  <View style={styles.emptyContainer}>
                    <Enter index={0}>
                      <Text style={styles.emptyGreeting}>
                        {greeting}{firstName ? `, ${firstName}` : ''}.
                      </Text>
                    </Enter>
                    <Enter index={1}>
                      <Text style={styles.emptyPersona}>
                        I read your <Text style={styles.emptyPersonaAccent}>sleep, symptoms and records</Text> — ask me anything about your health.
                      </Text>
                    </Enter>

                    <View style={styles.suggestionsContainer}>
                      <Text style={styles.suggestionsLabel}>Try asking</Text>
                      {suggestions.map((s, i) => (
                        <SuggestionRow key={s.text} suggestion={s} index={2 + i} onPress={() => sendMessage(s.text)} />
                      ))}
                    </View>

                    <DisclaimerNote />
                  </View>
                }
                contentContainerStyle={styles.messagesContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              />
            ) : (
              <>
                <FlatList
                  ref={flatListRef}
                  data={messages}
                  keyExtractor={(item) => item.id}
                  contentContainerStyle={styles.messagesContent}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  ListFooterComponent={<DisclaimerNote style={styles.dnFoot} />}
                  renderItem={({ item, index }) => {
                    const isLast = index === messages.length - 1;
                    const live = revealingId === item.id;
                    return (
                      <Enter index={0} style={item.role === 'user' ? styles.userRow : styles.aiRow}>
                        <View
                          style={[
                            styles.messageBubble,
                            item.role === 'user' ? styles.userBubble : styles.assistantBubble,
                          ]}
                        >
                          {item.role === 'assistant' && (
                            <View style={styles.assistantAvatar}>
                              <View style={styles.aiDot} />
                            </View>
                          )}
                          <View style={styles.messageContent}>
                            {item.role === 'user' ? (
                              <Text style={[styles.messageText, styles.userText]} selectable>
                                {item.content}
                              </Text>
                            ) : (
                              <StreamText
                                text={item.content}
                                live={live}
                                onTick={scrollToBottom}
                                onDone={() => setRevealingId((cur) => (cur === item.id ? null : cur))}
                              />
                            )}
                            <Text
                              style={[
                                styles.messageTime,
                                item.role === 'user' ? styles.userTime : styles.assistantTime,
                              ]}
                            >
                              {item.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </Text>
                          </View>
                        </View>
                        {renderMessageActions(item, isLast && !live)}
                      </Enter>
                    );
                  }}
                />
                {/* Follow-ups ride under the finished reply — two taps, no typing. */}
                {!busy && lastAssistantId && suggestions.length > 0 ? (
                  <View style={styles.followRow}>
                    {suggestions.slice(0, 2).map((s) => (
                      <FollowChip key={s.text} text={s.text} onPress={() => sendMessage(s.text)} />
                    ))}
                  </View>
                ) : null}
              </>
            )}

            {sending && (
              <View style={styles.typingContainer}>
                <TypingDots />
                <Text style={styles.typingText}>Thinking… reading your health data</Text>
              </View>
            )}
          </View>

          {/* Composer — draft lives inside it; keystrokes never re-render chat */}
          <Composer
            sending={sending}
            busy={busy}
            onSend={(text) => void sendMessage(text)}
            onStop={stopAll}
            onAttach={() => setDocSheet({ open: true, track: null })}
          />
          {/* Records live in the same page: upload + processing sheet */}
          <DocSheet
            visible={docSheet.open}
            track={docSheet.track}
            onClose={() => setDocSheet({ open: false, track: null })}
            onAsk={(text) => void sendMessage(text)}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function prettyStructure(structureId: string | null): string {
  if (!structureId) return 'area';
  return structureId.replace(/_/g, ' ').toLowerCase();
}

// Warm cream palette — matches the app-wide Dribbble reference.
const PAPER = '#EAE4D6';
const CARD = '#FFFBF3';
const INK = '#1D1B17';
const EMBER = '#E8862E';
const TITLE_RED = '#1D1B17';
const WARM = '#797166';
const WARM_LINE = '#E6DBC6';
const TEAL_DEEP = '#1D1B17';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: PAPER },
  keyboardAvoiding: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: WARM_LINE,
    backgroundColor: PAPER,
    gap: SPACING.sm,
  },
  aiDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: EMBER },
  headerText: { flex: 1, gap: 1 },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  headerTitle: { ...TYPOGRAPHY.bodyStrong, color: INK, fontSize: 16 },
  headerDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#2F9E44' },
  headerSub: { ...TYPOGRAPHY.caption, color: WARM, fontSize: 12 },

  // Warm wash behind the conversation.
  chatBg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  chatAuraPeach: {
    position: 'absolute',
    top: -80,
    right: -70,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(232,89,12,0.07)',
  },
  chatAuraCream: {
    position: 'absolute',
    top: '45%',
    left: -90,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: 'rgba(214,178,132,0.18)',
  },
  chatTexture: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },

  messagesContainer: { flex: 1 },
  messagesContent: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    gap: 14,
    flexGrow: 1,
  },

  // ── Teaching empty state ──
  emptyContainer: { paddingTop: SPACING.sm, gap: SPACING.md },
  emptyGreeting: {
    ...TYPOGRAPHY.h2,
    color: TITLE_RED,
    textAlign: 'center',
    fontSize: 25,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  emptyPersona: {
    ...TYPOGRAPHY.body,
    color: WARM,
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: SPACING.lg,
  },
  emptyPersonaAccent: { color: EMBER, fontWeight: '700' },

  // Quiet disclaimer footnote — present, never in the way.
  dnWrap: { gap: 6 },
  dnFoot: { paddingHorizontal: SPACING.md, paddingTop: 4, paddingBottom: 12 },
  dnHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 4 },
  dnHeadText: { ...TYPOGRAPHY.caption, color: WARM, fontSize: 11 },
  dnChevron: { color: WARM, fontSize: 11, fontWeight: '700' },
  disclaimerText: { ...TYPOGRAPHY.caption, color: WARM, lineHeight: 18, textAlign: 'center' },

  // Clean list — no cards, just breathable type. Feels like Gemini/ChatGPT starters.
  suggestionsContainer: { paddingBottom: SPACING.md, gap: 0 },
  suggestionsLabel: {
    ...TYPOGRAPHY.label,
    color: WARM,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    fontSize: 11,
    marginBottom: 6,
    opacity: 0.9,
  },
  suggestionPlain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(154,52,18,0.10)',
  },
  suggestionDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    opacity: 0.95,
    marginTop: 1,
  },
  suggestionPlainText: {
    ...TYPOGRAPHY.body,
    color: INK,
    flex: 1,
    lineHeight: 20,
    fontSize: 15,
    fontWeight: '500',
  },
  suggestionPlainArrow: {
    color: WARM,
    fontSize: 20,
    fontWeight: '400',
    opacity: 0.45,
    marginLeft: 4,
    marginTop: -1,
  },
  // kept for backward compat if anything still references old names
  suggestionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: WARM_LINE,
    borderRadius: BORDER_RADIUS.lg,
    borderCurve: 'continuous',
    padding: SPACING.md,
    gap: SPACING.sm,
  },
  suggestionIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionIcon: { fontSize: 17 },
  suggestionText: { ...TYPOGRAPHY.body, color: INK, flex: 1, lineHeight: 20, fontSize: 14.5 },
  suggestionArrow: { fontSize: 17, fontWeight: '700' },

  // ── Messages ──
  userRow: { alignItems: 'flex-end' },
  aiRow: { alignItems: 'flex-start' },
  messageBubble: {
    maxWidth: '86%',
    paddingVertical: SPACING.sm + 2,
    paddingHorizontal: SPACING.md,
    borderRadius: 20,
    borderCurve: 'continuous',
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  userBubble: {
    backgroundColor: '#431407',
    alignSelf: 'flex-end',
    borderBottomRightRadius: 6,
    boxShadow: '0 4px 14px rgba(67,20,7,0.30)',
  },
  assistantBubble: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: WARM_LINE,
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 6,
    borderLeftWidth: 3,
    borderLeftColor: EMBER,
    boxShadow: '0 4px 14px rgba(124,45,18,0.10)',
  },
  assistantAvatar: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  messageContent: { flex: 1, flexShrink: 1 },
  messageText: { ...TYPOGRAPHY.body, color: INK, lineHeight: 22, fontSize: 15 },
  userText: { color: '#FFF7ED' },
  caret: { color: EMBER, fontWeight: '800' },
  messageTime: { ...TYPOGRAPHY.caption, marginTop: 6, opacity: 0.6, alignSelf: 'flex-end', fontSize: 11 },
  userTime: { color: 'rgba(255,247,237,0.7)' },
  assistantTime: { color: WARM },

  msgActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8, maxWidth: '86%' },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(11,104,82,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(11,104,82,0.4)',
    borderRadius: BORDER_RADIUS.full,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  actionChipText: { ...TYPOGRAPHY.captionStrong, color: TEAL_DEEP, fontSize: 12.5 },
  regenBtn: {
    borderRadius: BORDER_RADIUS.full,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: WARM_LINE,
    backgroundColor: CARD,
  },
  regenText: { ...TYPOGRAPHY.captionStrong, color: WARM, fontSize: 12.5 },

  followRow: { flexDirection: 'row', gap: 8, paddingHorizontal: SPACING.md, paddingBottom: 10 },
  followChip: {
    flex: 1,
    borderRadius: BORDER_RADIUS.full,
    borderWidth: 1,
    borderColor: 'rgba(232,89,12,0.45)',
    backgroundColor: '#FFF1E2',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  followChipText: { ...TYPOGRAPHY.captionStrong, color: '#9A3412', fontSize: 12 },

  typingContainer: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.md, paddingBottom: SPACING.sm, paddingTop: 2, gap: SPACING.sm },
  typingDots: { flexDirection: 'row', gap: 5 },
  typingDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: EMBER },
  typingText: { ...TYPOGRAPHY.caption, color: WARM, fontStyle: 'italic', fontSize: 12.5 },

  // ── Composer — Gemini-style: one pill, send lives inside ────────────────
  attachButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-end',
  },
  attachGlyph: {
    fontSize: 20,
  },
  // ── Live processing chip ──────────────────────────────────────────────
  processingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    marginHorizontal: SPACING.md,
    marginTop: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 6,
    borderRadius: BORDER_RADIUS.full,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: WARM_LINE,
    alignSelf: 'flex-start',
    maxWidth: '90%',
  },
  processingChipText: {
    ...TYPOGRAPHY.caption,
    color: INK,
    fontSize: 12,
    flexShrink: 1,
  },
  // ── Records sheet ─────────────────────────────────────────────────────
  sheetBody: {
    gap: SPACING.md,
    paddingBottom: SPACING.md,
  },
  sheetDrop: {
    borderWidth: 2,
    borderColor: WARM_LINE,
    borderStyle: 'dashed',
    borderRadius: BORDER_RADIUS.lg,
    paddingVertical: SPACING.xl,
    alignItems: 'center',
    gap: SPACING.xs,
  },
  sheetDropIcon: { fontSize: 40 },
  sheetDropTitle: { ...TYPOGRAPHY.bodyStrong, color: INK },
  sheetPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    padding: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: PAPER,
    borderWidth: 1,
    borderColor: WARM_LINE,
  },
  sheetPreviewIcon: { fontSize: 28 },
  sheetPreviewInfo: { flex: 1, gap: 2 },
  sheetFileName: { ...TYPOGRAPHY.bodyStrong, color: INK },
  sheetMeta: { ...TYPOGRAPHY.caption, color: WARM },
  sheetError: { ...TYPOGRAPHY.caption, color: TITLE_RED },
  sheetHint: { ...TYPOGRAPHY.caption, color: WARM, textAlign: 'center' },
  sheetPrimary: {
    paddingVertical: SPACING.sm + 2,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: EMBER,
    alignItems: 'center',
  },
  sheetPrimaryText: { ...TYPOGRAPHY.bodyStrong, color: '#fff' },
  sheetGhost: {
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: WARM_LINE,
  },
  sheetGhostText: { ...TYPOGRAPHY.bodyStrong, color: INK },
  sheetStageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: 4,
  },
  sheetDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: WARM_LINE,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CARD,
  },
  sheetDotDone: { backgroundColor: TEAL_DEEP, borderColor: TEAL_DEEP },
  sheetDotCurrent: { borderColor: EMBER },
  sheetCheck: { color: '#fff', fontSize: 13, fontWeight: '700' },
  sheetStageLabel: { ...TYPOGRAPHY.body, color: WARM, flex: 1 },
  sheetStageLabelOn: { color: INK, fontWeight: '600' },
  inputContainer: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
    paddingBottom: Platform.OS === 'ios' ? SPACING.sm + 84 : SPACING.md + 84,
    backgroundColor: PAPER,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(154,52,18,0.10)',
  },
  composerShell: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: CARD,
    borderWidth: 1.5,
    borderColor: WARM_LINE,
    borderRadius: 28,
    borderCurve: 'continuous',
    paddingLeft: 6,
    paddingRight: 6,
    paddingVertical: 6,
    gap: 8,
    minHeight: 56,
    boxShadow: '0 2px 14px rgba(124,45,18,0.08)',
  },
  composerShellFocused: {
    borderColor: 'rgba(232,89,12,0.45)',
    backgroundColor: CARD,
    boxShadow: '0 4px 20px rgba(232,89,12,0.16)',
  },
  inputInner: {
    flex: 1,
    ...TYPOGRAPHY.body,
    fontSize: 15.5,
    lineHeight: 21,
    color: INK,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxHeight: 120,
    minHeight: 36,
    backgroundColor: 'transparent',
  },
  composerAction: {
    width: 44,
    alignItems: 'center',
    justifyContent: 'flex-end',
    alignSelf: 'flex-end',
    paddingBottom: 2,
  },
  // legacy aliases (no longer used by JSX but keep to avoid dead-style confusion)
  inputWrapper: { flexDirection: 'row', alignItems: 'flex-end', gap: SPACING.sm },
  input: {
    flex: 1,
    ...TYPOGRAPHY.body,
    fontSize: 15,
    color: INK,
    backgroundColor: CARD,
    borderWidth: 1.5,
    borderColor: WARM_LINE,
    borderRadius: 24,
    borderCurve: 'continuous',
    paddingHorizontal: SPACING.md,
    paddingVertical: 12,
    maxHeight: 120,
    minHeight: 50,
  },
  inputFocused: {
    borderColor: EMBER,
    backgroundColor: CARD,
  },
  sendWrap: { width: 52, alignItems: 'center', justifyContent: 'flex-end' },
  sparkField: {
    position: 'absolute',
    bottom: 42,
    left: -6,
    width: 56,
    height: 88,
  },
  sparkDot: {
    position: 'absolute',
    bottom: 0,
    backgroundColor: '#84CC16',
    borderWidth: 1,
    borderColor: '#FFFFFF',
    shadowColor: '#65A30D',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
  },
  sparkPlus: {
    position: 'absolute',
    bottom: 0,
    color: '#65A30D',
    fontSize: 14,
    fontWeight: '900',
    backgroundColor: 'transparent',
  },
  // Gemini send — compact ink pill tucked inside the composer, not floating outside.
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1A0F0A',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 4px 14px rgba(26,15,10,0.28)',
  },
  sendButtonPressed: {
    transform: [{ scale: 0.92 }],
    opacity: 0.92,
  },
  sendButtonDisabled: {
    opacity: 0.32,
    backgroundColor: '#B9A99A',
    boxShadow: '0 0 0 rgba(0,0,0,0)',
  },
  sendButtonText: {
    color: '#FFF7ED',
    fontSize: 18,
    fontWeight: '900',
    marginTop: -1,
    letterSpacing: 0.2,
  },
  stopButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#E03131',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 4px 14px rgba(224,49,49,0.35)',
  },
  stopButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
});
