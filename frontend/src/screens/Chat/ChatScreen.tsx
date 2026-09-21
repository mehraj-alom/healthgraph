import {
  ActivityIndicator,
  StyleSheet,
  View,
  Text,
  TextInput,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  useWindowDimensions,
} from 'react-native';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import { BottomSheet } from '@/components/BottomSheet';
import { useHideTabBarOnScroll } from '@/components/tabBarVisibility';
import { formatFileSize } from '@/services/documents';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  Easing,
  type SharedValue,
} from 'react-native-reanimated';
import axios from 'axios';
import Svg, { Path } from 'react-native-svg';

import { api } from '@/services/api';
import { BrandLogo } from '@/components/BrandLogo';
import { MEDICAL_DISCLAIMER } from '@/constants';
import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
import { useReducedMotion } from '@/theme/useReducedMotion';
import { useDocuments, type ProcessingStage } from '@/context/DocumentsContext';
import { useDailyMetrics } from '@/hooks/useDailyMetrics';

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
  citations?: {
    node_id?: string | null;
    document_id?: string | null;
    quote?: string | null;
    evidence_level?: string | null;
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
  text: string;
  category: 'sleep' | 'symptom' | 'energy' | 'stress' | 'record' | 'general';
}

const ALL_SUGGESTIONS: SuggestionDef[] = [
  { text: 'How has my sleep been this week?', category: 'sleep' },
  { text: 'What symptoms have I logged recently?', category: 'symptom' },
  { text: 'How has my energy been lately?', category: 'energy' },
  { text: 'Has my stress changed recently?', category: 'stress' },
  { text: 'What changed in my recent health records?', category: 'record' },
  { text: 'Show me my recent health trends.', category: 'general' },
  { text: 'What should I log today?', category: 'general' },
  { text: 'Have I had any abnormal lab results?', category: 'record' },
  { text: 'How was my sleep last night?', category: 'sleep' },
  { text: 'Summarize my recent medical records.', category: 'record' },
];

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

// ─── Typing signal (Reanimated, UI thread; static under reduced motion) ───
// One honest indicator: dots breathe while the reply generates. No staged
// activity theater — the backend is a single call, so the UI claims nothing
// more than "working".
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
      {live && count < words.length ? <Text style={styles.caret}>▏</Text> : null}
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
  return (
    <Pressable
      style={({ pressed }) => [styles.suggestionPlain, pressed && { opacity: 0.55 }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Ask: ${suggestion.text}`}
    >
      <Text style={styles.suggestionIndex}>{String(index + 1).padStart(2, '0')}</Text>
      <Text style={styles.suggestionPlainText}>{suggestion.text}</Text>
      <Text style={styles.suggestionPlainArrow}>›</Text>
    </Pressable>
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
  keyboardOpen,
  onSend,
  onStop,
  onAttach,
}: {
  sending: boolean;
  busy: boolean;
  /** True while the soft keyboard is open (tab bar hidden then). */
  keyboardOpen: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  onAttach: () => void;
}) {
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);
  // No dock on this screen (system back handles exit), so the composer
  // sits on the safe-area inset — not on tab-clearing clearance.
  const insets = useSafeAreaInsets();

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    onSend(trimmed);
    setText('');
    // Sending hands the floor to the reply: dismiss the keyboard so the
    // incoming answer is visible instead of the composer staying covered.
    inputRef.current?.blur();
    Keyboard.dismiss();
  };

  return (
    <View
      style={[
        styles.inputContainer,
        // Keyboard open → hug it. Closed → rest on the safe-area inset.
        { paddingBottom: keyboardOpen ? 8 : insets.bottom + 8 },
      ]}
    >
      <View style={[styles.composerShell, focused && styles.composerShellFocused]}>
        <Pressable
          onPress={onAttach}
          accessibilityRole="button"
          accessibilityLabel="Attach a medical record"
          hitSlop={8}
          style={({ pressed }) => [styles.attachButton, pressed && { opacity: 0.6 }]}
        >
          <AttachGlyph color={focused ? GV.cta : GV.muted} />
        </Pressable>
        <TextInput
          ref={inputRef}
          style={styles.inputInner}
          value={text}
          onChangeText={setText}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={sending ? 'Waiting for reply…' : 'Ask about your health…'}
          placeholderTextColor={GV.muted}
          multiline
          maxLength={2000}
          editable={!sending}
          returnKeyType="send"
          blurOnSubmit={false}
          onSubmitEditing={submit}
          keyboardAppearance="dark"
          underlineColorAndroid="transparent"
          accessibilityLabel="Message input"
        />
        <View style={styles.composerAction}>
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
                !text.trim() && styles.sendButtonGhost,
                pressed && text.trim() && styles.sendButtonPressed,
              ]}
            >
              <Text style={!text.trim() ? styles.sendButtonGhostText : styles.sendButtonText}>↑</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

/**
 * AttachGlyph — a plain paperclip drawn in strokes, not an emoji. Tints via
 * the composer so it quiets when idle and sharpens on focus.
 */
function AttachGlyph({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path
        d="M21 11.5 12.3 20.2a5.5 5.5 0 0 1-7.78-7.78l8.16-8.16a3.67 3.67 0 0 1 5.19 5.19l-8.16 8.16a1.83 1.83 0 0 1-2.6-2.59L14.5 7.6"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

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
                  {current ? <ActivityIndicator size="small" color={GV.cta} /> : null}
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
              <View style={styles.sheetExtTag}>
                <Text style={styles.sheetExtText}>
                  {file.type.includes('pdf') ? 'PDF' : 'IMG'}
                </Text>
              </View>
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
              <View style={styles.sheetDropIconWrap}>
                <Text style={styles.sheetDropIcon}>↑</Text>
              </View>
              <Text style={styles.sheetDropTitle}>Choose a file to upload</Text>
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

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [revealingId, setRevealingId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);

  const flatListRef = useRef<FlatList<ChatMessage>>(null);
  // Side tabs hide on scroll down, return on scroll up (pulse tab stays).
  const onTabScroll = useHideTabBarOnScroll();
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

  // Keyboard-aware composer spacing: the floating tab bar hides while the
  // keyboard is open (tabBarHideOnKeyboard), so the tall tab-clearing
  // padding is only needed while the keyboard is closed. Tracks open state
  // explicitly instead of assuming it, so the input can never end up
  // buried under — or floating far above — the keyboard.
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const { height: windowHeight } = useWindowDimensions();
  const baseHeightRef = useRef(0);
  useEffect(() => {
    // Baseline tracks the keyboard-closed window height (orientation-safe:
    // refreshed whenever the keyboard is closed).
    if (keyboardHeight === 0) baseHeightRef.current = windowHeight;
  }, [windowHeight, keyboardHeight]);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) => {
      setKeyboardOpen(true);
      setKeyboardHeight(e.endCoordinates.height);
      scrollToBottom();
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardOpen(false);
      setKeyboardHeight(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [scrollToBottom]);
  // Adaptive bottom spacer: under adjustResize the window shrinks by the
  // keyboard height and no spacer is needed; under adjustPan / Expo Go's
  // runtime (no shrink) the spacer lifts the composer by exactly the
  // uncovered remainder. Never negative, zero when closed.
  const heightShrunk = Math.max(0, baseHeightRef.current - windowHeight);
  const keyboardSpacer =
    keyboardHeight > 0 ? Math.max(0, keyboardHeight - heightShrunk) : 0;

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
      // P7: citations are part of the chat contract (schemas/chat.py).
      // Only well-formed entries with a node or document reference render.
      const citations = Array.isArray(body?.citations)
        ? body.citations.filter(
            (c: any) => c && (typeof c.node_id === 'string' || typeof c.document_id === 'string'),
          ).slice(0, 5)
        : [];

      if (__DEV__) console.log(`[Chat] responseParsed=${assistantText.length > 0}`);
      if (__DEV__) console.log(`[Chat] assistantTextLength=${assistantText.length}`);

      const assistantMessage: ChatMessage = {
        id: `${Date.now()}-assistant`,
        role: 'assistant',
        content: assistantText.length > 0 ? assistantText : 'Processing incomplete.',
        timestamp: new Date(),
        ui_actions: uiActions,
        citations,
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

  // Deferred-resend timer: cleared on unmount so a regenerate tap cannot
  // fire sendMessage after the screen is gone.
  const regenerateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (regenerateTimer.current) {
        clearTimeout(regenerateTimer.current);
        regenerateTimer.current = null;
      }
    };
  }, []);

  const regenerate = useCallback(() => {
    if (sending) return;
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastAssistant || !lastUser) return;
    setMessages((prev) => prev.filter((m) => m.id !== lastAssistant.id));
    // Defer the resend until the removal has committed.
    if (regenerateTimer.current) clearTimeout(regenerateTimer.current);
    regenerateTimer.current = setTimeout(() => {
      regenerateTimer.current = null;
      void sendMessage(lastUser.content);
    }, 60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sending, messages]);

  const busy = sending || revealingId != null;
  const isEmpty = messages.length === 0;

  const lastAssistantId =
    messages.length > 0 && messages[messages.length - 1].role === 'assistant'
      ? messages[messages.length - 1].id
      : null;

  const renderMessageActions = (item: ChatMessage, isLast: boolean) => {
    if (item.role !== 'assistant' || sending) return null;
    const actions = item.ui_actions ?? [];
    const structures = actions.filter((a) => a.structure_id);
    // P7: validated citations from the backend (filtered server-side to
    // tool-output references). Document rows deep-link to the record.
    const citations = (item.citations ?? []).filter((c) => c.node_id || c.document_id);
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
              View {prettyStructure(a.structure_id)} in 3D ›
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
        {citations.length > 0 ? (
          <View style={styles.citeBlock}>
            <Text style={styles.citeTitle}>Sources ({citations.length})</Text>
            {citations.slice(0, 3).map((c, i) => {
              const label = c.document_id ? 'Open source document' : (c.node_id ?? 'Evidence');
              const key = `${c.document_id ?? c.node_id ?? i}`;
              const sub = typeof c.quote === 'string' && c.quote.length > 0
                ? (c.quote.length > 90 ? `${c.quote.slice(0, 90)}…` : c.quote)
                : null;
              const row = (
                <View style={styles.citeRowInner}>
                  <Text style={styles.citeLabel} numberOfLines={1}>{label}</Text>
                  {sub ? <Text style={styles.citeQuote} numberOfLines={2}>{sub}</Text> : null}
                </View>
              );
              return c.document_id ? (
                <Pressable
                  key={key}
                  style={styles.citeRow}
                  onPress={() => navigation.navigate('DocumentDetail', { documentId: c.document_id })}
                  accessibilityRole="button"
                  accessibilityLabel="Open source document"
                >
                  {row}
                  <Text style={styles.citeGo}>›</Text>
                </Pressable>
              ) : (
                <View key={key} style={styles.citeRow}>{row}</View>
              );
            })}
          </View>
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
          {/* Header — tinted lockup on dark, one quiet capability line. */}
          <View style={styles.header}>
            <BrandLogo height={20} tint={GV.teal} />
            <View style={styles.headerText}>
              <Text style={styles.headerTitle}>Assistant</Text>
              <Text style={styles.headerSub}>Can read your logs and records</Text>
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
              <ActivityIndicator size="small" color={GV.cta} />
              <Text style={styles.processingChipText} numberOfLines={1}>
                {firstActive.fileName} · {firstActive.stage}
              </Text>
            </Pressable>
          ) : null}

          <View style={styles.messagesContainer}>
            {isEmpty ? (
              <FlatList
                data={[]}
                keyExtractor={() => 'empty'}
                renderItem={null}
                ListHeaderComponent={
                  <View style={styles.emptyContainer}>
                    <Text style={styles.emptyOverline}>Healthgraph Assistant</Text>
                    <Text style={styles.emptyPersona}>
                      I read your <Text style={styles.emptyPersonaAccent}>sleep, symptoms and records</Text>. Ask in plain words.
                    </Text>

                    <View style={styles.suggestionsContainer}>
                      <Text style={styles.suggestionsLabel}>Try asking</Text>
                      {suggestions.map((s, i) => (
                        <SuggestionRow key={s.text} suggestion={s} index={i} onPress={() => sendMessage(s.text)} />
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
                  onScroll={onTabScroll}
                  scrollEventThrottle={16}
                  ListFooterComponent={<DisclaimerNote style={styles.dnFoot} />}
                  renderItem={({ item, index }) => {
                    const isLast = index === messages.length - 1;
                    const live = revealingId === item.id;
                    // Timestamps only close out a same-role run — a back-and-
                    // forth of 6 bubbles shows 2 times, not 6.
                    const next = messages[index + 1];
                    const showTime = isLast || next == null || next.role !== item.role;
                    const isUser = item.role === 'user';
                    return (
                      <View style={isUser ? styles.userRow : styles.aiRow}>
                        {isUser ? (
                          <View style={[styles.messageBubble, styles.userBubble]}>
                            <Text style={[styles.messageText, styles.userText]} selectable>
                              {item.content}
                            </Text>
                            {showTime ? (
                              <Text style={[styles.messageTime, styles.userTime]}>
                                {item.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </Text>
                            ) : null}
                          </View>
                        ) : (
                          <View style={styles.assistantBlock}>
                            <StreamText
                              text={item.content}
                              live={live}
                              onTick={scrollToBottom}
                              onDone={() => setRevealingId((cur) => (cur === item.id ? null : cur))}
                            />
                            {showTime ? (
                              <Text style={[styles.messageTime, styles.assistantTime]}>
                                {item.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </Text>
                            ) : null}
                          </View>
                        )}
                        {renderMessageActions(item, isLast && !live)}
                      </View>
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
                <Text style={styles.typingText} accessibilityLiveRegion="polite">
                  Thinking
                </Text>
              </View>
            )}
          </View>

          {/* Composer — draft lives inside it; keystrokes never re-render chat */}
          <Composer
            sending={sending}
            busy={busy}
            keyboardOpen={keyboardOpen}
            onSend={(text) => void sendMessage(text)}
            onStop={stopAll}
            onAttach={() => setDocSheet({ open: true, track: null })}
          />
          {/* Adaptive spacer: lifts the composer when the runtime doesn't
              shrink the window for the keyboard (adjustPan / Expo Go). Zero
              under adjustResize — purely a no-op there. */}
          {keyboardSpacer > 0 ? <View style={{ height: keyboardSpacer }} /> : null}
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

// Guava-flat: every color below is GV. Stage is the only background;
// cards are flat white, the CTA is the one green, caret rides GV.teal.

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: GV.stage },
  keyboardAvoiding: { flex: 1 },

  // Header — lockup + one quiet capability line, hairline rule.
  // No presence theater ("Online ·"), no status dots.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACE.screenH,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: GV.stageline,
    backgroundColor: GV.stage,
    gap: 8,
  },
  headerText: { flex: 1, gap: 0 },
  headerTitle: { ...TYPE.button, color: '#FFFFFF', fontSize: 16 },
  headerSub: { ...TYPE.caption, color: GV.fog, fontSize: 12 },

  messagesContainer: { flex: 1 },
  messagesContent: {
    paddingHorizontal: SPACE.screenH,
    paddingVertical: 16,
    gap: SPACE.cardGap,
    flexGrow: 1,
  },

  // ── Empty state: overline + one editorial line, left-aligned. ──
  emptyContainer: { paddingTop: 24, gap: SPACE.cardGap },
  emptyOverline: {
    ...TYPE.chip,
    color: GV.teal,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    fontSize: 11,
  },
  emptyPersona: {
    ...TYPE.display,
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  emptyPersonaAccent: { color: GV.teal },

  // Quiet disclaimer footnote — present, never in the way.
  dnWrap: { gap: 6 },
  dnFoot: { paddingHorizontal: SPACE.screenH, paddingTop: 4, paddingBottom: 12 },
  dnHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 4 },
  dnHeadText: { ...TYPE.caption, color: GV.fog, fontSize: 11 },
  dnChevron: { color: GV.fog, fontSize: 11, fontFamily: FONT.semi },
  disclaimerText: { ...TYPE.caption, color: GV.fog, lineHeight: 18, textAlign: 'center' },

  // Starters — hairline ledger rows with editorial numerals. One hue.
  suggestionsContainer: { paddingBottom: SPACE.screenH, gap: 0 },
  suggestionsLabel: {
    ...TYPE.chip,
    color: GV.fog,
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
    paddingVertical: 12,
    paddingHorizontal: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: GV.stageline,
  },
  suggestionIndex: {
    ...TYPE.chip,
    fontSize: 12,
    color: GV.teal,
    fontVariant: ['tabular-nums'],
    width: 20,
    opacity: 0.9,
  },
  suggestionPlainText: {
    ...TYPE.body,
    color: '#FFFFFF',
    flex: 1,
    lineHeight: 20,
    fontSize: 15,
  },
  suggestionPlainArrow: {
    color: GV.fog,
    fontSize: 20,
    fontFamily: FONT.regular,
    opacity: 0.6,
    marginLeft: 4,
    marginTop: -1,
  },

  // ── Messages: two voices, never twin bubbles. ──
  // You: solid CTA pill, right, white type. Assistant: flat full-width
  // prose on stage, no chrome — the serious-tool framing, not SMS.
  userRow: { alignItems: 'flex-end' },
  aiRow: { alignItems: 'flex-start' },
  messageBubble: {
    maxWidth: '86%',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: SPACE.rCard,
    borderCurve: 'continuous',
  },
  userBubble: {
    backgroundColor: GV.cta,
    alignSelf: 'flex-end',
    borderBottomRightRadius: 6,
  },
  assistantBlock: {
    alignSelf: 'stretch',
    paddingRight: 8,
  },
  messageText: { ...TYPE.body, color: '#FFFFFF', lineHeight: 24, fontSize: 15 },
  userText: { color: '#FFFFFF' },
  caret: { color: GV.teal, fontFamily: FONT.regular },
  messageTime: { ...TYPE.caption, marginTop: 6, opacity: 0.6, alignSelf: 'flex-end', fontSize: 11 },
  userTime: { color: '#FFFFFF', opacity: 0.75 },
  assistantTime: { color: GV.fog, alignSelf: 'flex-start' },

  msgActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8, maxWidth: '100%' },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: GV.card,
    borderRadius: SPACE.rPill,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  actionChipText: { ...TYPE.chip, color: GV.ink, fontSize: 13 },
  regenBtn: {
    borderRadius: SPACE.rPill,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: GV.stageline,
    backgroundColor: 'transparent',
  },
  regenText: { ...TYPE.chip, color: GV.fog, fontSize: 13 },
  // P7: validated citation rows (backend-filtered to tool references).
  citeBlock: { flexBasis: '100%', marginTop: 4, gap: 4 },
  citeTitle: { ...TYPE.caption, color: GV.fog, fontSize: 11 },
  citeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  citeRowInner: { flex: 1, gap: 1 },
  citeLabel: { ...TYPE.body, color: GV.ink, fontSize: 13 },
  citeQuote: { ...TYPE.caption, color: GV.fog, fontSize: 11, fontStyle: 'italic' },
  citeGo: { ...TYPE.title, color: GV.fog },

  followRow: { flexDirection: 'row', gap: 8, paddingHorizontal: SPACE.screenH, paddingBottom: 8 },
  followChip: {
    flex: 1,
    borderRadius: SPACE.rPill,
    backgroundColor: GV.card,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  followChipText: { ...TYPE.chip, color: GV.ink, fontSize: 12 },

  typingContainer: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACE.screenH, paddingBottom: 8, paddingTop: 2, gap: 8 },
  typingDots: { flexDirection: 'row', gap: 5 },
  typingDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: GV.teal },
  typingText: { ...TYPE.caption, color: GV.fog, fontSize: 13 },

  // ── Composer: one white pill, send lives inside ────────────────────────
  attachButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-end',
  },
  // ── Live processing chip ──────────────────────────────────────────────
  processingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: SPACE.screenH,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: SPACE.rPill,
    backgroundColor: GV.card,
    alignSelf: 'flex-start',
    maxWidth: '90%',
  },
  processingChipText: {
    ...TYPE.caption,
    color: GV.ink,
    fontSize: 12,
    flexShrink: 1,
  },
  // ── Records sheet ─────────────────────────────────────────────────────
  sheetBody: {
    gap: SPACE.cardGap,
    paddingBottom: 16,
  },
  sheetDrop: {
    borderRadius: 12,
    backgroundColor: GV.wash,
    paddingVertical: 32,
    alignItems: 'center',
    gap: 8,
  },
  sheetDropIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: GV.cta,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetDropIcon: { color: '#FFFFFF', fontSize: 20, fontFamily: FONT.bold, marginTop: -2 },
  sheetDropTitle: { ...TYPE.button, fontSize: 15, color: GV.ink },
  sheetPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: GV.wash,
  },
  sheetExtTag: {
    borderRadius: 8,
    backgroundColor: GV.cta,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  sheetExtText: { ...TYPE.chip, color: '#FFFFFF', fontSize: 11, letterSpacing: 0.6 },
  sheetPreviewInfo: { flex: 1, gap: 2 },
  sheetFileName: { ...TYPE.button, fontSize: 15, color: GV.ink },
  sheetMeta: { ...TYPE.caption, color: GV.muted },
  sheetError: { ...TYPE.caption, color: GV.danger },
  sheetHint: { ...TYPE.caption, color: GV.muted, textAlign: 'center' },
  sheetPrimary: {
    paddingVertical: 12,
    borderRadius: SPACE.rPill,
    backgroundColor: GV.cta,
    alignItems: 'center',
  },
  sheetPrimaryText: { ...TYPE.button, color: '#FFFFFF' },
  sheetGhost: {
    paddingVertical: 12,
    borderRadius: SPACE.rPill,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: GV.line,
  },
  sheetGhostText: { ...TYPE.button, color: GV.ink },
  sheetStageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  sheetDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: GV.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GV.wash,
  },
  sheetDotDone: { backgroundColor: GV.cta, borderColor: GV.cta },
  sheetDotCurrent: { borderColor: GV.cta },
  sheetCheck: { color: '#FFFFFF', fontSize: 13, fontFamily: FONT.bold },
  sheetStageLabel: { ...TYPE.body, color: GV.muted, flex: 1 },
  sheetStageLabelOn: { ...TYPE.body, fontFamily: FONT.semi, color: GV.ink, flex: 1 },
  inputContainer: {
    paddingHorizontal: SPACE.screenH,
    paddingTop: 8,
    paddingBottom: 8,
    backgroundColor: GV.stage,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: GV.stageline,
  },
  composerShell: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: GV.card,
    borderWidth: 2,
    borderColor: GV.card,
    borderRadius: 28,
    borderCurve: 'continuous',
    paddingLeft: 6,
    paddingRight: 6,
    paddingVertical: 6,
    gap: 4,
    minHeight: 56,
  },
  composerShellFocused: {
    borderColor: GV.cta,
  },
  inputInner: {
    flex: 1,
    ...TYPE.body,
    fontSize: 15,
    lineHeight: 21,
    color: GV.ink,
    paddingHorizontal: 12,
    paddingVertical: 8,
    textAlignVertical: 'center',
    maxHeight: 120,
    minHeight: 40,
    backgroundColor: 'transparent',
  },
  composerAction: {
    width: 44,
    alignItems: 'center',
    justifyContent: 'flex-end',
    alignSelf: 'flex-end',
    paddingBottom: 2,
  },
  // Send — ghost ring when empty, floods solid CTA green the moment there's
  // text. The affordance flip is the feedback; no muddy gray state.
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: GV.cta,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: GV.line,
  },
  sendButtonPressed: {
    transform: [{ scale: 0.92 }],
    opacity: 0.92,
  },
  sendButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontFamily: FONT.bold,
    marginTop: -1,
    letterSpacing: 0.2,
  },
  sendButtonGhostText: {
    color: GV.muted,
    fontSize: 18,
    fontFamily: FONT.bold,
    marginTop: -1,
    letterSpacing: 0.2,
  },
  stopButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: GV.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopButtonText: { color: '#FFFFFF', fontSize: 13, fontFamily: FONT.bold },
});
