import {
  StyleSheet,
  View,
  Text,
  TextInput,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState, useRef, useEffect, useCallback } from 'react';

import { api } from '@/services/api';
import { Button } from '@/components';
import {
  COLORS,
  SPACING,
  BORDER_RADIUS,
  TYPOGRAPHY,
  MEDICAL_DISCLAIMER,
} from '@/constants';
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

function SuggestionCard({ suggestion, index, onPress }: { suggestion: SuggestionDef; index: number; onPress: () => void }) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const entranceAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(entranceAnim, {
      toValue: 1,
      duration: 200,
      delay: index * 40,
      useNativeDriver: true,
    }).start();
  }, [entranceAnim, index]);

  const handlePressIn = () => {
    Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, speed: 50, bounciness: 3 }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 50, bounciness: 3 }).start();
  };

  return (
    <Animated.View style={{ opacity: entranceAnim, transform: [{ scale: scaleAnim }, { translateY: entranceAnim.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }] }}>
      <Pressable style={styles.suggestionCard} onPress={onPress} onPressIn={handlePressIn} onPressOut={handlePressOut}>
        <Text style={styles.suggestionIcon}>{suggestion.icon}</Text>
        <Text style={styles.suggestionText}>{suggestion.text}</Text>
        <Text style={styles.suggestionArrow}>→</Text>
      </Pressable>
    </Animated.View>
  );
}

function AnimatedMessage({ children }: { children: React.ReactNode }) {
  const entranceAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(entranceAnim, { toValue: 1, duration: 180, useNativeDriver: true }).start();
  }, [entranceAnim]);

  return (
    <Animated.View style={{ opacity: entranceAnim, transform: [{ translateY: entranceAnim.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }) }] }}>
      {children}
    </Animated.View>
  );
}

export default function ChatScreen() {
  const { user, userProfile } = useAuth();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [composerFocused, setComposerFocused] = useState(false);

  const flatListRef = useRef<FlatList<ChatMessage>>(null);
  const inputRef = useRef<TextInput>(null);

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
        { timeout: 180000 },
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
      if (nextConversationId) setConversationId(nextConversationId);
      console.log('[Chat] messageInserted=true');
    } catch (error: any) {
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
      setSending(false);
    }
  };

  const isEmpty = messages.length === 0;
  const displayName = userProfile?.displayName ?? null;
  const greeting = getGreetingTime();
  const greetingText = displayName ? `${greeting}, ${displayName}` : greeting;

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardAvoiding}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : undefined}
        enabled={Platform.OS === 'ios'}
      >
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>MedGraph AI</Text>
            <View style={styles.headerDot} />
          </View>

          <View style={styles.messagesContainer}>
            {isEmpty ? (
              <FlatList
                data={[]}
                keyExtractor={() => 'empty'}
                renderItem={null}
                ListHeaderComponent={
                  <View style={styles.emptyContainer}>
                    <View style={styles.companionHeader}>
                      <View style={styles.companionIconCircle}>
                        <Text style={styles.companionIcon}>🩺</Text>
                      </View>
                      <Text style={styles.emptyGreeting}>Hi {displayName || 'there'}! 👋</Text>
                      <Text style={styles.emptyQuestion}>How can I help you today?</Text>
                    </View>

                    <View style={styles.disclaimerBanner}>
                      <Text style={styles.disclaimerText}>{MEDICAL_DISCLAIMER}</Text>
                    </View>

                    <View style={styles.suggestionsContainer}>
                      <Text style={styles.suggestionsLabel}>You might want to ask</Text>
                      {suggestions.map((s, i) => (
                        <SuggestionCard key={i} suggestion={s} index={i} onPress={() => sendMessage(s.text)} />
                      ))}
                    </View>
                  </View>
                }
                contentContainerStyle={styles.messagesContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              />
            ) : (
              <>
                <View style={styles.disclaimerBannerSmall}>
                  <Text style={styles.disclaimerTextSmall}>{MEDICAL_DISCLAIMER}</Text>
                </View>
                <FlatList
                  ref={flatListRef}
                  data={messages}
                  keyExtractor={(item) => item.id}
                  contentContainerStyle={styles.messagesContent}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  renderItem={({ item }) => (
                    <AnimatedMessage>
                      <View
                        style={[
                          styles.messageBubble,
                          item.role === 'user' ? styles.userBubble : styles.assistantBubble,
                        ]}
                      >
                        {item.role === 'assistant' && (
                          <View style={styles.assistantAvatar}>
                            <Text style={styles.assistantAvatarText}>🩺</Text>
                          </View>
                        )}
                        <View style={styles.messageContent}>
                          <Text
                            style={[
                              styles.messageText,
                              item.role === 'user' ? styles.userText : styles.assistantText,
                            ]}
                          >
                            {item.content}
                          </Text>
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
                    </AnimatedMessage>
                  )}
                />
              </>
            )}

            {sending && (
              <View style={styles.typingContainer}>
                <View style={styles.typingDots}>
                  <View style={[styles.typingDot, styles.typingDot1]} />
                  <View style={[styles.typingDot, styles.typingDot2]} />
                  <View style={[styles.typingDot, styles.typingDot3]} />
                </View>
                <Text style={styles.typingText}>Thinking…</Text>
              </View>
            )}
          </View>

          {/* Input */}
          <View style={styles.inputContainer}>
            <View style={styles.inputWrapper}>
               <TextInput
                ref={inputRef}
                style={[styles.input, composerFocused && styles.inputFocused]}
                value={inputText}
                onChangeText={setInputText}
                onFocus={() => setComposerFocused(true)}
                onBlur={() => setComposerFocused(false)}
                placeholder="Type your message…"
                placeholderTextColor={COLORS.textDisabled}
                multiline
                maxLength={2000}
                editable={!sending}
                returnKeyType="send"
                blurOnSubmit={false}
                onSubmitEditing={() => { void sendMessage(); }}
                keyboardAppearance="dark"
                underlineColorAndroid="transparent"
              />
              <Pressable
                onPress={() => { void sendMessage(); }}
                disabled={sending || !inputText.trim()}
                accessibilityRole="button"
                accessibilityLabel="Send message"
                style={({ pressed }) => [
                  styles.sendButton,
                  (!inputText.trim() || sending) && styles.sendButtonDisabled,
                  pressed && !sending && styles.sendButtonPressed,
                ]}
              >
                <Text style={styles.sendButtonText}>↑</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  keyboardAvoiding: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.surface,
    gap: SPACING.sm,
  },
  headerTitle: { ...TYPOGRAPHY.bodyStrong, color: COLORS.textPrimary },
  headerDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.success },
  headerSub: { ...TYPOGRAPHY.caption, color: COLORS.textMuted },

  messagesContainer: { flex: 1 },
  messagesContent: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    gap: SPACING.md,
    flexGrow: 1,
  },

  emptyContainer: { paddingTop: SPACING.lg, gap: SPACING.lg },
  companionHeader: { alignItems: 'center', paddingVertical: SPACING.lg, gap: SPACING.sm },
  companionIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.primaryBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.sm,
  },
  companionIcon: { fontSize: 28 },
  emptyGreeting: { ...TYPOGRAPHY.h2, color: COLORS.textPrimary },
  emptyQuestion: { ...TYPOGRAPHY.body, color: COLORS.primary, marginTop: SPACING.xs },

  disclaimerBanner: { backgroundColor: COLORS.surfaceSecondary, borderRadius: BORDER_RADIUS.sm, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border },
  disclaimerText: { ...TYPOGRAPHY.caption, color: COLORS.textMuted, lineHeight: 18, textAlign: 'center' },
  disclaimerBannerSmall: { backgroundColor: COLORS.surfaceSecondary, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm, borderBottomWidth: 1, borderColor: COLORS.border },
  disclaimerTextSmall: { ...TYPOGRAPHY.caption, color: COLORS.textMuted, fontSize: 11, textAlign: 'center', lineHeight: 16 },

  suggestionsContainer: { gap: SPACING.sm },
  suggestionsLabel: { ...TYPOGRAPHY.label, color: COLORS.textMuted, marginBottom: SPACING.xs },
  suggestionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1,
    borderColor: COLORS.borderFaint,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    gap: SPACING.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 5,
    elevation: 2,
  },
  suggestionIcon: { fontSize: 18, width: 24, textAlign: 'center' },
  suggestionText: { ...TYPOGRAPHY.body, color: COLORS.textPrimary, flex: 1, lineHeight: 20 },
  suggestionArrow: { fontSize: 16, color: COLORS.primary, opacity: 0.6 },

  messageBubble: {
    maxWidth: '85%',
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.lg,
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  userBubble: {
    backgroundColor: COLORS.accentBlue,
    alignSelf: 'flex-end',
    borderBottomRightRadius: BORDER_RADIUS.sm,
    maxWidth: '82%',
    shadowColor: COLORS.accentBlue,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 3,
  },
  assistantBubble: {
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1,
    borderColor: COLORS.borderFaint,
    alignSelf: 'flex-start',
    borderBottomLeftRadius: BORDER_RADIUS.sm,
    maxWidth: '85%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 2,
  },
  assistantAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.accentBlueSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  assistantAvatarText: { fontSize: 14 },
  messageContent: { flex: 1 },
  messageText: { ...TYPOGRAPHY.body, color: COLORS.textPrimary, lineHeight: 22 },
  userText: { color: '#FFFFFF' },
  assistantText: { color: COLORS.textPrimary },
  messageTime: { ...TYPOGRAPHY.caption, marginTop: SPACING.xs, opacity: 0.65, alignSelf: 'flex-end' },
  userTime: { color: 'rgba(255, 255, 255, 0.65)' },
  assistantTime: { color: COLORS.textMuted },

  typingContainer: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.lg, paddingBottom: SPACING.sm, gap: SPACING.sm },
  typingDots: { flexDirection: 'row', gap: 4 },
  typingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.accentBlue },
  typingDot1: { opacity: 0.35 },
  typingDot2: { opacity: 0.65 },
  typingDot3: { opacity: 1 },
  typingText: { ...TYPOGRAPHY.caption, color: COLORS.textMuted, fontStyle: 'italic' },

  inputContainer: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    backgroundColor: '#0C1522',
    borderTopWidth: 1,
    borderTopColor: COLORS.borderFaint,
  },
  inputWrapper: { flexDirection: 'row', alignItems: 'flex-end', gap: SPACING.sm },
  input: {
    flex: 1,
    ...TYPOGRAPHY.body,
    color: COLORS.textPrimary,
    backgroundColor: COLORS.surfaceSunken,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.xl,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    maxHeight: 120,
    minHeight: 48,
  },
  inputFocused: {
    borderColor: COLORS.accentBlue,
    backgroundColor: '#0E1A2C',
    shadowColor: COLORS.accentBlue,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 4,
  },
  sendButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: COLORS.accentBlue,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.accentBlue,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  sendButtonPressed: {
    transform: [{ scale: 0.94 }],
    backgroundColor: '#3A7AE0',
    shadowOpacity: 0.1,
  },
  sendButtonDisabled: { opacity: 0.35, shadowOpacity: 0, elevation: 0 },
  sendButtonText: { color: '#FFFFFF', fontSize: 20, fontWeight: '600' },
});
