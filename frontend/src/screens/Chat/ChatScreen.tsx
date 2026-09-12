import {
  StyleSheet,
  View,
  Text,
  TextInput,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useState, useRef, useEffect, useCallback } from 'react';
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
import { useDocuments } from '@/context/DocumentsContext';
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
  sleep: '#6C7AE0',
  symptom: '#E67E22',
  energy: '#F4C51B',
  stress: '#31B7A5',
  record: '#9B6CFF',
  general: '#4D8DFF',
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
        style={({ pressed }) => [styles.suggestionCard, pressed && { opacity: 0.75, transform: [{ scale: 0.98 }] }]}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Ask: ${suggestion.text}`}
      >
        <View style={[styles.suggestionIconWrap, { backgroundColor: `${tint}22`, borderColor: `${tint}55` }]}>
          <Text style={styles.suggestionIcon}>{suggestion.icon}</Text>
        </View>
        <Text style={styles.suggestionText}>{suggestion.text}</Text>
        <Text style={[styles.suggestionArrow, { color: tint }]}>→</Text>
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
 * SendSparkles — light-green bubbles and "+" motes drifting up from the send
 * button. One shared UI-thread loop; each mote reads a phase-shifted window
 * of it, so eight particles cost one animation. Static when reduced motion.
 */
const SPARK_SEEDS = [
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
      <Animated.Text style={[styles.sparkPlus, { left: 26 + dx - 7 }, s]}>
        +
      </Animated.Text>
    );
  }
  return (
    <Animated.View
      style={[styles.sparkDot, { width: size, height: size, borderRadius: size / 2, left: 26 + dx - size / 2 }, s]}
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
 * faint dot grid. Pure decoration, never intercepts touches. */
function ChatBackdrop() {
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

export default function ChatScreen() {
  const { userProfile } = useAuth();
  const navigation = useNavigation<any>();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [revealingId, setRevealingId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [composerFocused, setComposerFocused] = useState(false);

  const flatListRef = useRef<FlatList<ChatMessage>>(null);
  const inputRef = useRef<TextInput>(null);
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

  // Once the newest assistant message has been committed to state and the
  // list rendered it (sending == false), report it for the success diagnostic.
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (last && last.role === 'assistant' && !sending) {
      console.log(`[Chat] rendered=true textLength=${last.content.length}`);
    }
  }, [messages, sending]);

  const sendMessage = async (text?: string) => {
    const trimmedMessage = (text ?? inputText).trim();
    if (!trimmedMessage || sending) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: trimmedMessage,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    if (!text) setInputText('');
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
      console.log('[Chat] requestStarted=true');
      console.log(`[Chat] request URL = ${chatUrl}`);
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
      console.log(`[Chat] httpStatus=${http.status} duration=${elapsed}ms`);

      const body: any = http.data ?? {};
      console.log('[Chat] response keys=', Object.keys(body));

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

      console.log(`[Chat] responseParsed=${assistantText.length > 0}`);
      console.log(`[Chat] assistantTextLength=${assistantText.length}`);

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
      console.log('[Chat] messageInserted=true');
    } catch (error: any) {
      // Client-side stop (Stop button) is not a failure — keep the prompt,
      // show no error bubble.
      if (axios.isAxiosError(error) && error.code === 'ERR_CANCELED') {
        console.log('[Chat] requestStoppedByUser=true');
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
  const displayName = userProfile?.displayName ?? null;
  const firstName = (displayName ?? '').trim().split(' ')[0] || null;
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

          {/* Composer — send morphs into stop while busy, same slot */}
          <View style={styles.inputContainer}>
            <View style={styles.inputWrapper}>
              <TextInput
                ref={inputRef}
                style={[styles.input, composerFocused && styles.inputFocused]}
                value={inputText}
                onChangeText={setInputText}
                onFocus={() => setComposerFocused(true)}
                onBlur={() => setComposerFocused(false)}
                placeholder={sending ? 'Waiting for reply…' : 'Ask about your health…'}
                placeholderTextColor="#C9BBA9"
                multiline
                maxLength={2000}
                editable={!sending}
                returnKeyType="send"
                blurOnSubmit={false}
                onSubmitEditing={() => { void sendMessage(); }}
                keyboardAppearance="light"
                underlineColorAndroid="transparent"
                accessibilityLabel="Message input"
              />
              <View style={styles.sendWrap}>
                <SendSparkles />
                {busy ? (
                  <Pressable
                    onPress={stopAll}
                    accessibilityRole="button"
                    accessibilityLabel="Stop generating"
                    style={({ pressed }) => [styles.stopButton, pressed && { opacity: 0.7, transform: [{ scale: 0.94 }] }]}
                  >
                    <Text style={styles.stopButtonText}>■</Text>
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={() => { void sendMessage(); }}
                    disabled={!inputText.trim()}
                    accessibilityRole="button"
                    accessibilityLabel="Send message"
                    style={({ pressed }) => [
                      styles.sendButton,
                      !inputText.trim() && styles.sendButtonDisabled,
                      pressed && inputText.trim() && styles.sendButtonPressed,
                    ]}
                  >
                    <Text style={styles.sendButtonText}>↑</Text>
                  </Pressable>
                )}
              </View>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function prettyStructure(structureId: string | null): string {
  if (!structureId) return 'area';
  return structureId.replace(/_/g, ' ').toLowerCase();
}

// Sunset paper palette — identical to the correlation cards.
const PAPER = '#FFF8F0';
const CARD = '#FFFFFF';
const INK = '#3F1D0B';
const EMBER = '#E8590C';
const TITLE_RED = '#C1121F';
const WARM = '#8A6D5B';
const WARM_LINE = 'rgba(154,52,18,0.14)';
const TEAL_DEEP = '#0B6852';

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

  suggestionsContainer: { gap: SPACING.sm, paddingBottom: SPACING.md },
  suggestionsLabel: { ...TYPOGRAPHY.label, color: WARM, marginBottom: 2 },
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
    boxShadow: '0 4px 14px rgba(124,45,18,0.10)',
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

  // ── Composer ──
  inputContainer: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    backgroundColor: PAPER,
    borderTopWidth: 1,
    borderTopColor: WARM_LINE,
  },
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
    shadowColor: EMBER,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 4,
  },
  // ── Modern send: lime puck, dark arrow, halo ring ──
  // ── ChatGPT-style ink send puck + rising light-green sparkles ──
  sendWrap: { width: 52, alignItems: 'center', justifyContent: 'flex-end' },
  sparkField: {
    position: 'absolute',
    bottom: 50,
    left: 0,
    width: 52,
    height: 92,
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
  sendButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#431407',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 6px 18px rgba(67,20,7,0.35)',
  },
  sendButtonPressed: {
    transform: [{ scale: 0.92 }],
  },
  sendButtonDisabled: { opacity: 0.35, boxShadow: '0 0 0 rgba(0,0,0,0)' },
  sendButtonText: { color: '#FFF7ED', fontSize: 24, fontWeight: '900', marginTop: -3 },
  stopButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#E03131',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 4px 16px rgba(224,49,49,0.4)',
  },
  stopButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
});
