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
import { BlurView } from 'expo-blur';

import { api } from '@/services/api';
import { MEDICAL_DISCLAIMER } from '@/constants';
import { useAuth } from '@/context/AuthContext';
import { getSelectedPlan, type PricingPlan } from '@/screens/Onboarding/PricingScreen';
import { SPACE } from '@/theme/guava';
import { LG } from '@/theme/liquidGlass';
import { GlassSurface } from '@/components/home/GlassSurface';
import { HomeStageBackdrop } from '@/components/home/HomeStageBackdrop';
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
import { useOpenPricing } from '@/components/PaywallGate';
import {
  consumeQuota,
  getLocalTier,
  getMonthlyUsage,
  monthlyQuota,
  usePremiumTier,
} from '@/services/premium';

const SECONDARY = 'rgba(233,240,255,0.66)';
const TERTIARY = 'rgba(233,240,255,0.45)';

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
  }, [reduced, t]);
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

const REVEAL_TICK_MS = 32;
const WORDS_PER_TICK = 4;

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
  }, [text, live, words.length]);

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
  }, [live, count, text, words.length, onDone, onTick]);

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
  actionsVisible: boolean;
  showRegen: boolean;
  onTick: () => void;
  onRevealDone: (id: string) => void;
  onRegenerate: () => void;
}

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
    const journalDays = list.filter((a) => a.action_type === 'open_timeline_day' && a.date_key);
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
        <GlassSurface tint="#FFFFFF" tintOpacity={0.10} style={[styles.messageBubble, styles.userBubble]}>
          <Text style={[styles.messageText, styles.userText]} selectable>
            {item.content}
          </Text>
          {showTime ? (
            <Text style={[styles.messageTime, styles.userTime]}>
              {item.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
          ) : null}
        </GlassSurface>
      ) : (
        <GlassSurface strong style={styles.assistantBlock}>
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
        </GlassSurface>
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
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Ask: ${suggestion.text}`}
      style={styles.suggestionRow}
      hitSlop={{ top: 6, bottom: 6 }}
    >
      <View style={styles.suggestionDot} />
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

function Composer({
  sending,
  busy,
  keyboardOpen,
  planPill,
  planLine,
  quotaNote,
  onSend,
  onStop,
}: {
  sending: boolean;
  busy: boolean;
  keyboardOpen: boolean;
  planPill: string;
  planLine: string;
  quotaNote?: string | null;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const reduceTransparency = useReducedMotion();
  const insets = useSafeAreaInsets();

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    onSend(trimmed);
    setText('');
    inputRef.current?.blur();
    Keyboard.dismiss();
  };

  return (
    <View
      style={[
        styles.inputContainer,
        { paddingBottom: keyboardOpen ? 8 : insets.bottom + 8 },
      ]}
    >
      <View style={styles.glassCard}>
        {reduceTransparency ? null : (
          <BlurView tint="dark" intensity={LG.blurIntensity} style={styles.glassFill} />
        )}
        <View style={[styles.glassTint, reduceTransparency && styles.glassTintOpaque]} />
        <View style={styles.creditRow}>
          <Text style={styles.creditText} numberOfLines={1}>{planLine}</Text>
          <View style={styles.proPill}>
            <Text style={styles.proText}>{planPill}</Text>
          </View>
        </View>
        {quotaNote ? (
          <Text style={styles.quotaHint} numberOfLines={1}>{quotaNote}</Text>
        ) : null}
        <View style={[styles.inputBox, focused && styles.inputBoxFocused]}>
          <TextInput
            ref={inputRef}
            style={styles.inputBoxInput}
            value={text}
            onChangeText={setText}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={sending ? 'Waiting for response…' : 'Ask about your health…'}
            placeholderTextColor={TERTIARY}
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

function openCrisisUrl(url: string): void {
  void Linking.openURL(url).catch(() => {});
}

function CrisisCard() {
  return (
    <GlassSurface strong style={styles.crisisCard}>
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
    </GlassSurface>
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
        <Text style={styles.dnHeadText}>Wellness info only. Not medical advice.</Text>
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
  const reduceTransparency = useReducedMotion();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [revealingId, setRevealingId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [planId, setPlanId] = useState<PricingPlan>('free');
  const tier = usePremiumTier();
  const openPricing = useOpenPricing();
  const [quotaNote, setQuotaNote] = useState<string | null>(null);

  useEffect(() => {
    getSelectedPlan().then(setPlanId).catch(() => {});
  }, []);

  // Remaining AI-chat quota for the composer line. Read-only hint: the
  // enforcing check runs at send time, never blocking render.
  useEffect(() => {
    let live = true;
    void (async () => {
      const quota = monthlyQuota(tier, 'aiChat');
      if (quota == null) {
        if (live) setQuotaNote(null);
        return;
      }
      const used = await getMonthlyUsage('aiChat');
      if (!live) return;
      const left = Math.max(0, quota - used);
      setQuotaNote(
        tier === 'free'
          ? `${left} of ${quota} free messages left this month`
          : `${left} of ${quota} messages left this month`,
      );
    })();
    return () => {
      live = false;
    };
  }, [tier, messages.length]);
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

  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const { height: windowHeight } = useWindowDimensions();
  const baseHeightRef = useRef(0);
  useEffect(() => {
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
  const heightShrunk = Math.max(0, baseHeightRef.current - windowHeight);
  const keyboardSpacer =
    keyboardHeight > 0 ? Math.max(0, keyboardHeight - heightShrunk) : 0;

  useEffect(() => {
    const last = messages[messages.length - 1];
    if (last && last.role === 'assistant' && !sending) {
      if (__DEV__) console.log(`[Chat] rendered=true textLength=${last.content.length}`);
    }
  }, [messages, sending]);

  const sendMessage = async (text?: string) => {
    const trimmedMessage = (text ?? '').trim();
    if (!trimmedMessage || sending) return;

    // Monthly AI-chat quota is enforced here, at action time. Handlers
    // can't use hooks, so the tier is read fresh (free-safe default).
    const tierNow = await getLocalTier();
    const quotaOk = await consumeQuota(tierNow, 'aiChat');
    if (!quotaOk) {
      openPricing();
      const quota = monthlyQuota(tierNow, 'aiChat') ?? 0;
      const used = await getMonthlyUsage('aiChat');
      const left = Math.max(0, quota - used);
      setQuotaNote(
        tierNow === 'free'
          ? `${left} of ${quota} free messages left this month`
          : `${left} of ${quota} messages left this month`,
      );
      return;
    }

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

      const http = await api.getClient().post<ChatResponse>(
        chatUrl,
        chatPayload,
        { timeout: 180000, signal: controller.signal },
      );
      const elapsed = Date.now() - t0;
      if (__DEV__) console.log(`[Chat] httpStatus=${http.status} duration=${elapsed}ms`);

      const body: any = http.data ?? {};
      if (__DEV__) console.log('[Chat] response keys=', Object.keys(body));

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
      const citations = Array.isArray(body?.citations)
        ? body.citations.filter(
            (c: any) => c && (typeof c.node_id === 'string' || typeof c.document_id === 'string'),
          ).slice(0, 5)
        : [];

      if (__DEV__) console.log(`[Chat] responseParsed=${assistantText.length > 0}`);
      if (__DEV__) console.log(`[Chat] assistantTextLength=${assistantText.length}`);

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
      if (axios.isAxiosError(error) && error.code === 'ERR_CANCELED') {
        if (__DEV__) console.log('[Chat] requestStoppedByUser=true');
        return;
      }
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
    if (abortRef.current) abortRef.current.abort();
    setRevealingId(null);
  }, []);

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
    if (regenerateTimer.current) clearTimeout(regenerateTimer.current);
    regenerateTimer.current = setTimeout(() => {
      regenerateTimer.current = null;
      void sendMessage(lastUser.content);
    }, 60);
  }, [sending, messages]);

  const busy = sending || revealingId != null;
  const isEmpty = messages.length === 0;

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setConversationId(null);
    setRevealingId(null);
  }, []);

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
    <View style={styles.root}>
      <HomeStageBackdrop />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboardAvoiding}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : undefined}
          enabled={Platform.OS === 'ios'}
        >
          <View style={styles.container}>
            <View style={styles.topbar}>
              {reduceTransparency ? null : (
                <BlurView tint="dark" intensity={LG.blurIntensity} style={styles.glassFill} />
              )}
              <View style={[styles.topbarTint, reduceTransparency && styles.topbarTintOpaque]} />
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

            {isEmpty && suggestions.length > 0 && !busy ? (
              <View style={styles.suggestionsContainer}>
                {suggestions.map((s) => (
                  <SuggestionRow key={s.text} suggestion={s} onPress={() => sendMessage(s.text)} />
                ))}
              </View>
            ) : null}

            <Composer
              sending={sending}
              busy={busy}
              keyboardOpen={keyboardOpen}
              planPill={planMeta.pill}
              planLine={planMeta.line}
              quotaNote={quotaNote}
              onSend={(text) => void sendMessage(text)}
              onStop={stopAll}
            />
            {keyboardSpacer > 0 ? <View style={{ height: keyboardSpacer }} /> : null}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

function prettyStructure(structureId: string | null): string {
  if (!structureId) return 'area';
  return structureId.replace(/_/g, ' ').toLowerCase();
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05070F' },
  safe: { flex: 1 },
  container: { flex: 1 },
  keyboardAvoiding: { flex: 1 },
  glassFill: {
    ...StyleSheet.absoluteFill,
  },

  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
    gap: 8,
  },
  topbarTint: {
    ...StyleSheet.absoluteFill,
    backgroundColor: LG.fill,
  },
  topbarTintOpaque: {
    backgroundColor: LG.fillOpaque,
  },
  topBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  topGlyph: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '600',
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
    fontWeight: '600',
    fontSize: 16,
    lineHeight: 22,
    color: '#FFFFFF',
    textAlign: 'center',
  },

  messagesContainer: { flex: 1 },
  messagesContent: {
    paddingHorizontal: SPACE.screenH,
    paddingVertical: 16,
    gap: 12,
    flexGrow: 1,
  },

  emptyContainer: { alignItems: 'center', paddingTop: 72, gap: 8 },
  helloSmall: {
    fontWeight: '500',
    fontSize: 15,
    lineHeight: 22,
    color: SECONDARY,
    textAlign: 'center',
  },
  helloBig: {
    fontWeight: '600',
    fontSize: 30,
    lineHeight: 37,
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: -0.4,
  },
  helloAccent: {
    fontStyle: 'italic',
  },

  dnWrap: { gap: 6 },
  dnFoot: { paddingHorizontal: SPACE.screenH, paddingTop: 4, paddingBottom: 12 },
  dnHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 4 },
  dnHeadText: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: SECONDARY },
  dnChevron: { color: SECONDARY, fontSize: 11, fontWeight: '600' },
  disclaimerText: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: SECONDARY, textAlign: 'center' },
  crisisCard: {
    padding: 14,
    gap: 6,
    marginTop: 8,
    width: '100%',
  },
  crisisTitle: { fontWeight: '600', fontSize: 13, lineHeight: 18, letterSpacing: 0.5, color: SECONDARY, textTransform: 'uppercase' },
  crisisRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  crisisMain: { flex: 1, gap: 1 },
  crisisLabel: { fontWeight: '600', fontSize: 14, lineHeight: 20, color: '#FFFFFF' },
  crisisSub: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: SECONDARY },
  crisisChev: { fontSize: 18, color: SECONDARY },
  crisisFoot: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: TERTIARY },
  crisisLineHit: { minHeight: 32, alignItems: 'center', justifyContent: 'center' },
  crisisLine: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: SECONDARY, textDecorationLine: 'underline' },

  suggestionsContainer: { paddingHorizontal: SPACE.screenH, paddingBottom: 4, gap: 0 },
  suggestionRow: { paddingVertical: 5, flexDirection: 'row', alignItems: 'center', gap: 8 },
  suggestionDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: LG.card.mint },
  suggestionText: { fontWeight: '400', fontSize: 13, lineHeight: 17, color: '#FFFFFF' },

  userRow: { alignItems: 'flex-end' },
  aiRow: { alignItems: 'flex-start' },
  messageBubble: {
    maxWidth: '86%',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomRightRadius: 6,
  },
  userBubble: {
    alignSelf: 'flex-end',
  },
  assistantBlock: {
    alignSelf: 'stretch',
    padding: 14,
    marginRight: 8,
  },
  messageText: { fontWeight: '400', fontSize: 15, lineHeight: 24, color: '#FFFFFF' },
  userText: { color: '#FFFFFF' },
  caret: { color: LG.card.mint, fontWeight: '400' },
  messageTime: { fontWeight: '400', fontSize: 13, lineHeight: 18, marginTop: 6, alignSelf: 'flex-end', fontVariant: ['tabular-nums'] },
  userTime: { color: SECONDARY, opacity: 0.9 },
  assistantTime: { color: TERTIARY, alignSelf: 'flex-start' },

  msgActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8, maxWidth: '100%' },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 9999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  actionChipText: { fontWeight: '600', fontSize: 13, lineHeight: 18, color: '#FFFFFF' },
  regenBtn: {
    borderRadius: 9999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'transparent',
  },
  regenText: { fontWeight: '600', fontSize: 13, lineHeight: 18, color: SECONDARY },
  citeBlock: { flexBasis: '100%', marginTop: 4, gap: 4 },
  citeTitle: { fontWeight: '400', fontSize: 11, lineHeight: 14, color: TERTIARY },
  citeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  citeRowInner: { flex: 1, gap: 1 },
  citeLabel: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: '#FFFFFF' },
  citeQuote: { fontWeight: '400', fontSize: 11, lineHeight: 14, color: SECONDARY, fontStyle: 'italic' },
  citeGo: { fontWeight: '600', fontSize: 20, lineHeight: 26, color: SECONDARY },

  followRow: { flexDirection: 'row', gap: 8, paddingHorizontal: SPACE.screenH, paddingBottom: 8 },
  followChip: {
    flex: 1,
    borderRadius: 9999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  followChipText: { fontWeight: '600', fontSize: 12, lineHeight: 16, color: '#FFFFFF' },

  typingContainer: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACE.screenH, paddingBottom: 8, paddingTop: 2, gap: 8 },
  typingDots: { flexDirection: 'row', gap: 5 },
  typingDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: LG.card.mint },
  typingText: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: SECONDARY },

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
    borderColor: 'rgba(255,255,255,0.16)',
    padding: 12,
    gap: 10,
  },
  glassTint: {
    ...StyleSheet.absoluteFill,
    backgroundColor: LG.fill,
  },
  glassTintOpaque: {
    backgroundColor: LG.fillOpaque,
  },
  creditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  creditText: {
    fontWeight: '500',
    fontSize: 12,
    lineHeight: 16,
    color: SECONDARY,
    flex: 1,
  },
  quotaHint: {
    fontWeight: '400',
    fontSize: 12,
    lineHeight: 16,
    color: TERTIARY,
  },
  proPill: {
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 9999,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  proText: {
    fontWeight: '700',
    fontSize: 10.5,
    lineHeight: 14,
    letterSpacing: 0.6,
    color: '#FFFFFF',
  },
  inputBox: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingLeft: 4,
    paddingRight: 4,
    paddingVertical: 4,
    gap: 4,
    minHeight: 88,
  },
  inputBoxFocused: {
    borderColor: LG.card.mint,
  },
  inputBoxInput: {
    flex: 1,
    fontWeight: '400',
    fontSize: 15,
    lineHeight: 21,
    color: '#FFFFFF',
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
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  sendButtonPressed: {
    transform: [{ scale: 0.92 }],
    opacity: 0.92,
  },
  sendButtonText: {
    color: '#0B0F1A',
    fontSize: 18,
    fontWeight: '700',
    marginTop: -1,
    letterSpacing: 0.2,
  },
  sendButtonGhostText: {
    color: SECONDARY,
    fontSize: 18,
    fontWeight: '700',
    marginTop: -1,
    letterSpacing: 0.2,
  },
  stopButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: LG.card.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
});
