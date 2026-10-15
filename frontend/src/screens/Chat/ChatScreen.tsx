import {
  StyleSheet,
  View,
  Text,
  TextInput,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  Share,
  useWindowDimensions,
} from 'react-native';
import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHideTabBarOnScroll } from '@/components/tabBarVisibility';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  Easing,
  type SharedValue,
} from 'react-native-reanimated';
import axios from 'axios';
import Svg, { Path, Circle } from 'react-native-svg';
import { BlurView } from 'expo-blur';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { api } from '@/services/api';
import { MEDICAL_DISCLAIMER } from '@/constants';
import { useAuth } from '@/context/AuthContext';
import { getSelectedPlan, type PricingPlan } from '@/screens/Onboarding/PricingScreen';
import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
import { toneForCategory } from '@/theme/tones';
import { useReducedMotion } from '@/theme/useReducedMotion';
import { useDocuments } from '@/context/DocumentsContext';
import { useDailyMetrics } from '@/hooks/useDailyMetrics';
import { stripMarkdown } from '@/utils/stripMarkdown';
import { buildChatExport } from '@/services/chatExport';
import {
  CRISIS_FOOTER,
  CRISIS_RESOURCES,
  CRISIS_SLIM_LINE,
  CRISIS_TITLE,
} from '@/services/crisisResources';

// ─── Starry-night backdrop (pure code, static — no assets, no animation) ───
// Deep-night base, deterministic star field, moon, two mountain ridges.
// Replaces the flat stage on this screen only, mirroring the reference.
const STARS = Array.from({ length: 48 }, (_, i) => ({
  x: (i * 37.7 + 11) % 100,
  y: (i * 53.3 + 7) % 58,
  size: 1 + ((i * 7) % 3) * 0.8,
  opacity: 0.25 + (((i * 13) % 10) / 10) * 0.65,
}));

function NightSky() {
  const { width } = useWindowDimensions();
  return (
    <View style={styles.night} pointerEvents="none">
      {STARS.map((star, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            left: (star.x / 100) * width,
            top: (star.y / 100) * 640,
            width: star.size,
            height: star.size,
            borderRadius: star.size / 2,
            backgroundColor: '#FFFFFF',
            opacity: star.opacity,
          }}
        />
      ))}
      <Svg
        style={styles.ridges}
        width={width}
        height={230}
        viewBox="0 0 400 230"
        preserveAspectRatio="none"
      >
        <Circle cx={318} cy={46} r={30} fill="#FFFFFF" opacity={0.1} />
        <Circle cx={318} cy={46} r={15} fill="#F4F1DE" opacity={0.9} />
        <Path
          d="M0 150 L70 90 L130 140 L210 60 L290 150 L340 110 L400 160 L400 230 L0 230 Z"
          fill="#141C3D"
          opacity={0.92}
        />
        <Path
          d="M0 192 L90 142 L170 186 L260 132 L340 182 L400 156 L400 230 L0 230 Z"
          fill="#04060F"
        />
      </Svg>
    </View>
  );
}

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
    date_key?: string | null;
    highlight_event_id?: string | null;
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
    date_key?: string | null;
    highlight_event_id?: string | null;
  }[];
}

interface SuggestionDef {
  text: string;
  category: 'sleep' | 'symptom' | 'energy' | 'stress' | 'record' | 'general';
}

const ALL_SUGGESTIONS: SuggestionDef[] = [
  { text: 'How did I sleep this week?', category: 'sleep' },
  { text: 'What symptoms have I logged lately?', category: 'symptom' },
  { text: 'How has my energy been?', category: 'energy' },
  { text: 'How has my stress been?', category: 'stress' },
  { text: 'Anything new in my records?', category: 'record' },
  { text: 'What should I log today?', category: 'general' },
  { text: 'Summarize my recent health.', category: 'general' },
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

    // Relevance order, deduplicated, stable across renders — no shuffle.
    // Shuffling showed different prompts on every visit, which reads as
    // jitter rather than intelligence.
    const seen = new Set<string>();
    const unique = priorities.filter((s) => {
      if (seen.has(s.text)) return false;
      seen.add(s.text);
      return true;
    });

    setSelected(unique.slice(0, 3));
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
      accessibilityLabel="Assistant is working"
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

const StreamTextMemo = memo(StreamText);

interface MessageRowProps {
  item: ChatMessage;
  live: boolean;
  showTime: boolean;
  /** Action chips block (hidden while sending). */
  actionsVisible: boolean;
  /** Regenerate button (only the settled last row). */
  showRegen: boolean;
  onTick: () => void;
  onRevealDone: (id: string) => void;
  onRegenerate: () => void;
}

/**
 * MessageRow — one memoized chat bubble. The list re-renders on every
 * keystroke of state (send/reveal/suggestions); without memo every one of
 * those passes re-laid-out the whole history. Props are all primitives or
 * stable callbacks, so settled rows skip re-render entirely.
 */
const MessageRow = memo(function MessageRow({
  item,
  live,
  showTime,
  actionsVisible,
  showRegen,
  onTick,
  onRevealDone,
  onRegenerate,
}: MessageRowProps) {
  const navigation = useNavigation<any>();
  const handleDone = useCallback(() => onRevealDone(item.id), [onRevealDone, item.id]);
  const actions = useMemo(() => {
    if (item.role !== 'assistant' || !actionsVisible) return null;
    const list = item.ui_actions ?? [];
    const structures = list.filter((a) => a.structure_id);
    // Journal navigation: the backend emits open_timeline_day when the user
    // asks about a dated record. The Timeline screen scrolls to that page,
    // opens its 2/3 report, and highlights the evidence row.
    const journalDays = list.filter((a) => a.action_type === 'open_timeline_day' && a.date_key);
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
              View {prettyStructure(a.structure_id)} in 3D body
            </Text>
          </Pressable>
        ))}
        {journalDays.slice(0, 2).map((a, i) => (
          <Pressable
            key={`${a.date_key}-${i}`}
            onPress={() =>
              navigation.navigate('Timeline', {
                dateKey: a.date_key ?? undefined,
                highlightEventId: a.highlight_event_id ?? undefined,
              })
            }
            style={({ pressed }) => [styles.actionChip, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel={`Open ${a.date_key} in the health journal`}
          >
            <Text style={styles.actionChipText}>Open {a.date_key} in journal</Text>
          </Pressable>
        ))}
        {showRegen ? (
          <Pressable
            style={({ pressed }) => [styles.regenBtn, pressed && { opacity: 0.7 }]}
            onPress={onRegenerate}
            accessibilityRole="button"
            accessibilityLabel="Regenerate response"
          >
            <Text style={styles.regenText}>Regenerate</Text>
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
  }, [item, actionsVisible, showRegen, navigation, onRegenerate]);

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
          <StreamTextMemo
            text={item.content}
            live={live}
            onTick={onTick}
            onDone={handleDone}
          />
          {showTime ? (
            <Text style={[styles.messageTime, styles.assistantTime]}>
              {item.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
          ) : null}
        </View>
      )}
      {actions}
    </View>
  );
});

function SuggestionRow({
  suggestion,
  onPress,
}: {
  suggestion: SuggestionDef;
  onPress: () => void;
}) {
  const dot = toneForCategory(suggestion.category)[0];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Ask: ${suggestion.text}`}
      style={styles.suggestionRow}
      hitSlop={{ top: 6, bottom: 6 }}
    >
      <View style={[styles.suggestionDot, { backgroundColor: dot }]} />
      <Text style={styles.suggestionText} numberOfLines={1}>{suggestion.text}</Text>
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
  planPill,
  planLine,
  onSend,
  onStop,
}: {
  sending: boolean;
  busy: boolean;
  /** True while the soft keyboard is open (tab bar hidden then). */
  keyboardOpen: boolean;
  /** Tier pill + allowance line (real plan facts, never a fake counter). */
  planPill: string;
  planLine: string;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const glassOff = useReducedMotion();
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
      <View style={styles.glassCard}>
        {glassOff ? (
          <View style={styles.glassSolid} />
        ) : (
          <BlurView tint="dark" intensity={70} style={styles.glassFill} />
        )}
        <View style={styles.glassTint} />
        <View style={styles.creditRow}>
          <Text style={styles.creditText} numberOfLines={1}>{planLine}</Text>
          <View style={styles.proPill}>
            <Text style={styles.proText}>{planPill}</Text>
          </View>
        </View>
        <View style={[styles.whiteBox, focused && styles.whiteBoxFocused]}>
          <TextInput
            ref={inputRef}
            style={styles.whiteBoxInput}
            value={text}
            onChangeText={setText}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={sending ? 'Waiting for response…' : 'Ask about your health…'}
            placeholderTextColor="#8A8F9E"
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
          <View style={styles.sendSlot}>
            {busy ? (
              <Pressable
                onPress={onStop}
                accessibilityRole="button"
                accessibilityLabel="Stop response"
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
    </View>
  );
}

/**
 * Crisis support: static US resources, opened through core Linking.
 * Always visible (empty state card + slim line in the disclaimer
 * footnote). No detection, no triage — the rows never see the chat.
 */
function openCrisisUrl(url: string): void {
  void Linking.openURL(url).catch(() => {});
}

function CrisisCard() {
  return (
    <View style={styles.crisisCard}>
      <Text style={styles.crisisTitle}>{CRISIS_TITLE}</Text>
      {CRISIS_RESOURCES.map((r) => (
        <Pressable
          key={r.url}
          onPress={() => openCrisisUrl(r.url)}
          accessibilityRole="button"
          accessibilityLabel={`${r.label}. ${r.sub}`}
          hitSlop={8}
          style={({ pressed }) => [styles.crisisRow, pressed && { opacity: 0.7 }]}
        >
          <View style={styles.crisisMain}>
            <Text style={styles.crisisLabel}>{r.label}</Text>
            <Text style={styles.crisisSub}>{r.sub}</Text>
          </View>
          <Text style={styles.crisisChev}>›</Text>
        </Pressable>
      ))}
      <Text style={styles.crisisFoot}>{CRISIS_FOOTER}</Text>
    </View>
  );
}

function CrisisLine() {
  return (
    <Pressable
      onPress={() => openCrisisUrl('tel:988')}
      accessibilityRole="button"
      accessibilityLabel="In crisis? Call or text 988"
      hitSlop={8}
      style={styles.crisisLineHit}
    >
      <Text style={styles.crisisLine}>{CRISIS_SLIM_LINE}</Text>
    </Pressable>
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
        <Text style={styles.dnHeadText}>AI-generated wellness info. Not medical advice.</Text>
        <Text style={styles.dnChevron}>{open ? '▾' : '▸'}</Text>
      </Pressable>
      {open ? (
        <Text style={styles.disclaimerText}>{MEDICAL_DISCLAIMER}</Text>
      ) : null}
      <CrisisLine />
    </View>
  );
}


export default function ChatScreen() {
  const navigation = useNavigation<any>();
  const { userProfile } = useAuth();
  const glassOff = useReducedMotion();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [revealingId, setRevealingId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [planId, setPlanId] = useState<PricingPlan>('free');

  // Display-only tier facts (the locally picked plan — billing is separate).
  useEffect(() => {
    getSelectedPlan().then(setPlanId).catch(() => {});
  }, []);
  const planMeta =
    planId === 'allin'
      ? { pill: 'ALL-IN', line: 'Unlimited AI chat' }
      : planId === 'general'
        ? { pill: 'GENERAL', line: 'Limited AI messages / month' }
        : { pill: 'FREE', line: '2 AI messages / month' };

  const firstName =
    userProfile?.displayName?.trim().split(/\s+/)[0] ||
    userProfile?.email?.split('@')[0] ||
    'there';

  const flatListRef = useRef<FlatList<ChatMessage>>(null);
  // Side tabs hide on scroll down, return on scroll up (pulse tab stays).
  const onTabScroll = useHideTabBarOnScroll();
  const abortRef = useRef<AbortController | null>(null);

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

      // Client-side safety net: bubbles render raw <Text>, so strip any
      // markdown the model emitted (stale backend can still send it).
      const cleanText = stripMarkdown(assistantText);
      const assistantMessage: ChatMessage = {
        id: `${Date.now()}-assistant`,
        role: 'assistant',
        content: cleanText.length > 0 ? cleanText : 'No response received.',
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
          content: 'Request failed. Please try again.',
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

  // New chat: stop anything in flight and start a blank conversation.
  const newChat = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setConversationId(null);
    setRevealingId(null);
  }, []);

  // Share chat: export the visible turns as labeled text through the OS
  // share sheet. Nothing is uploaded — the text never leaves the device
  // except through the user's own share action.
  const shareChat = useCallback(() => {
    if (sending) return;
    const text = buildChatExport(messages);
    if (!text) return;
    void Share.share({ message: text, title: 'HealthGraph chat export' }).catch(() => {});
  }, [sending, messages]);

  const lastAssistantId =
    messages.length > 0 && messages[messages.length - 1].role === 'assistant'
      ? messages[messages.length - 1].id
      : null;

  // Stable row callbacks: settled rows keep identical props, so memo rows
  // skip re-render on every unrelated state change.
  const handleRevealDone = useCallback((id: string) => {
    setRevealingId((cur) => (cur === id ? null : cur));
  }, []);

  const regenerateRef = useRef(regenerate);
  regenerateRef.current = regenerate;
  const handleRegenerate = useCallback(() => {
    regenerateRef.current();
  }, []);

  const renderItem = useCallback(
    ({ item, index }: { item: ChatMessage; index: number }) => {
      const isLast = index === messages.length - 1;
      const live = revealingId === item.id;
      const next = messages[index + 1];
      return (
        <MessageRow
          item={item}
          live={live}
          showTime={isLast || next == null || next.role !== item.role}
          actionsVisible={!sending}
          showRegen={isLast && !live && !sending}
          onTick={scrollToBottom}
          onRevealDone={handleRevealDone}
          onRegenerate={handleRegenerate}
        />
      );
    },
    [messages, revealingId, sending, scrollToBottom, handleRevealDone, handleRegenerate],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <NightSky />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardAvoiding}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : undefined}
        enabled={Platform.OS === 'ios'}
      >
        <View style={styles.container}>
          {/* Frosted top bar: back, title, new-chat. All three do something. */}
          <View style={styles.topbar}>
            {!glassOff ? (
              <BlurView tint="dark" intensity={60} style={styles.glassFill} />
            ) : null}
            <Pressable
              onPress={() => navigation.goBack()}
              accessibilityRole="button"
              accessibilityLabel="Go back"
              hitSlop={12}
              style={({ pressed }) => [styles.topBtn, pressed && { opacity: 0.6 }]}
            >
              <Text style={styles.topGlyph}>‹</Text>
            </Pressable>
            <Text style={styles.topTitle}>New chat</Text>
            <Pressable
              onPress={shareChat}
              accessibilityRole="button"
              accessibilityLabel="Share chat"
              accessibilityState={{ disabled: isEmpty || sending }}
              hitSlop={12}
              disabled={isEmpty || sending}
              style={({ pressed }) => [
                styles.topBtn,
                pressed && { opacity: 0.6 },
                (isEmpty || sending) && styles.topBtnDisabled,
              ]}
            >
              <Text style={[styles.topGlyph, styles.topShareGlyph]}>⤴</Text>
            </Pressable>
            <Pressable
              onPress={newChat}
              accessibilityRole="button"
              accessibilityLabel="Start a new chat"
              hitSlop={12}
              style={({ pressed }) => [styles.topBtn, pressed && { opacity: 0.6 }]}
            >
              <Text style={styles.topGlyph}>•••</Text>
            </Pressable>
          </View>

          <View style={styles.messagesContainer}>
            {isEmpty ? (
              <FlatList
                data={[]}
                keyExtractor={() => 'empty'}
                renderItem={null}
                ListHeaderComponent={
                  <View style={styles.emptyContainer}>
                    <Text style={styles.helloSmall}>
                      {`Hello, ${firstName}`}
                    </Text>
                    <Text style={styles.helloBig}>
                      {'How may I\n'}
                      <Text style={styles.helloAccent}>Assist you today</Text>
                    </Text>

                    <DisclaimerNote />
                    <CrisisCard />
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
                  renderItem={renderItem}
                  contentContainerStyle={styles.messagesContent}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  onScroll={onTabScroll}
                  scrollEventThrottle={16}
                  ListFooterComponent={<DisclaimerNote style={styles.dnFoot} />}
                  windowSize={11}
                  maxToRenderPerBatch={8}
                  initialNumToRender={15}
                  removeClippedSubviews
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
                  Working
                </Text>
              </View>
            )}
          </View>

          {/* Pre-built questions sit just above the input, plain text —
              no cards, no numerals. Only before the first message. */}
          {isEmpty && suggestions.length > 0 && !busy ? (
            <View style={styles.suggestionsContainer}>
              {suggestions.map((s) => (
                <SuggestionRow key={s.text} suggestion={s} onPress={() => sendMessage(s.text)} />
              ))}
            </View>
          ) : null}

          {/* Composer — draft lives inside it; keystrokes never re-render chat */}
          <Composer
            sending={sending}
            busy={busy}
            keyboardOpen={keyboardOpen}
            planPill={planMeta.pill}
            planLine={planMeta.line}
            onSend={(text) => void sendMessage(text)}
            onStop={stopAll}
          />
          {/* Adaptive spacer: lifts the composer when the runtime doesn't
              shrink the window for the keyboard (adjustPan / Expo Go). Zero
              under adjustResize — purely a no-op there. */}
          {keyboardSpacer > 0 ? <View style={{ height: keyboardSpacer }} /> : null}
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
  container: { flex: 1, backgroundColor: '#070B1D' },
  keyboardAvoiding: { flex: 1 },

  // ── Starry-night backdrop ──
  night: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#070B1D',
  },
  ridges: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  glassFill: {
    ...StyleSheet.absoluteFill,
  },

  // ── Frosted top bar ──
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255, 255, 255, 0.12)',
    overflow: 'hidden',
  },
  topBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
  },
  topGlyph: {
    color: '#FFFFFF',
    fontSize: 20,
    fontFamily: FONT.semi,
    marginTop: -2,
  },
  topShareGlyph: {
    fontSize: 17,
    marginTop: -1,
  },
  topBtnDisabled: {
    opacity: 0.35,
  },
  topTitle: {
    flex: 1,
    ...TYPE.button,
    color: '#FFFFFF',
    fontSize: 16,
    textAlign: 'center',
  },

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

  // ── Empty-state hero: centered serif greeting over the night. ──
  emptyContainer: { alignItems: 'center', paddingTop: 72, gap: 8 },
  helloSmall: {
    fontFamily: FONT.medium,
    fontSize: 15,
    lineHeight: 22,
    color: 'rgba(255, 255, 255, 0.8)',
    textAlign: 'center',
  },
  helloBig: {
    fontFamily: FONT.semi,
    fontSize: 30,
    lineHeight: 37,
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: -0.3,
    textShadowColor: 'rgba(255, 255, 255, 0.18)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 24,
  },
  helloAccent: {
    fontStyle: 'italic',
  },

  // Quiet disclaimer footnote — present, never in the way.
  dnWrap: { gap: 6 },
  dnFoot: { paddingHorizontal: SPACE.screenH, paddingTop: 4, paddingBottom: 12 },
  dnHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 4 },
  dnHeadText: { ...TYPE.caption, color: GV.fog },
  dnChevron: { color: GV.fog, fontSize: 11, fontFamily: FONT.semi },
  disclaimerText: { ...TYPE.caption, color: GV.fog, lineHeight: 18, textAlign: 'center' },
  crisisCard: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    borderRadius: 16,
    padding: 14,
    gap: 6,
    marginTop: 8,
  },
  crisisTitle: { ...TYPE.chip, color: GV.fog, letterSpacing: 1 },
  crisisRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  crisisMain: { flex: 1, gap: 1 },
  crisisLabel: { ...TYPE.button, fontSize: 14, color: '#FFFFFF' },
  crisisSub: { ...TYPE.caption, color: GV.fog },
  crisisChev: { fontSize: 18, color: GV.fog },
  crisisFoot: { ...TYPE.caption, color: GV.fog },
  crisisLineHit: { minHeight: 32, alignItems: 'center', justifyContent: 'center' },
  crisisLine: { ...TYPE.caption, color: GV.fog, textDecorationLine: 'underline' },

  // Starters — plain text rows, small and tight. No cards, no numerals.
  suggestionsContainer: { paddingHorizontal: SPACE.screenH, paddingBottom: 4, gap: 0 },
  suggestionRow: { paddingVertical: 5, flexDirection: 'row', alignItems: 'center', gap: 8 },
  suggestionDot: { width: 8, height: 8, borderRadius: 4 },
  suggestionText: { ...TYPE.body, fontSize: 13, lineHeight: 17, color: '#FFFFFF' },

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
  messageTime: { ...TYPE.caption, marginTop: 6, opacity: 0.6, alignSelf: 'flex-end' },
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
  citeLabel: { ...TYPE.body, color: '#FFFFFF', fontSize: 13 },
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

  // ── Composer: frosted glass card, plan row, white input box ──────────
  inputContainer: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
    backgroundColor: 'transparent',
  },
  glassCard: {
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    padding: 12,
    gap: 10,
  },
  glassSolid: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  glassTint: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(10, 15, 36, 0.55)',
  },
  creditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  creditText: {
    fontFamily: FONT.medium,
    fontSize: 12,
    lineHeight: 16,
    color: 'rgba(255, 255, 255, 0.75)',
    flex: 1,
  },
  proPill: {
    backgroundColor: '#0C0C0E',
    borderRadius: 9999,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  proText: {
    fontFamily: FONT.bold,
    fontSize: 10.5,
    lineHeight: 14,
    letterSpacing: 0.6,
    color: '#FFFFFF',
  },
  whiteBox: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    paddingLeft: 4,
    paddingRight: 4,
    paddingVertical: 4,
    gap: 4,
    minHeight: 88,
  },
  whiteBoxFocused: {
    borderColor: GV.teal,
  },
  whiteBoxInput: {
    flex: 1,
    ...TYPE.body,
    fontSize: 15,
    lineHeight: 21,
    color: '#14151D',
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlignVertical: 'top',
    maxHeight: 120,
    minHeight: 64,
    backgroundColor: 'transparent',
  },
  sendSlot: {
    width: 44,
    alignItems: 'center',
    justifyContent: 'flex-end',
    alignSelf: 'flex-end',
    paddingBottom: 2,
  },
  // Send — black disc like the reference; ghost ring when empty.
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#0C0C0E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(12, 12, 14, 0.25)',
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
    color: 'rgba(12, 12, 14, 0.4)',
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
