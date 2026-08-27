import {
  StyleSheet,
  View,
  Text,
  TextInput,
  FlatList,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
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

export default function ChatScreen() {
  const { user } = useAuth();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);

  const flatListRef = useRef<FlatList<ChatMessage>>(null);
  const inputRef = useRef<TextInput>(null);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const sendMessage = async () => {
    const trimmedMessage = inputText.trim();

    if (!trimmedMessage || sending) {
      return;
    }

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: trimmedMessage,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputText('');
    setSending(true);

    try {
      const response = await api.post<ChatResponse>('/api/v1/chat', {
        message: userMessage.content,
        conversation_id: conversationId,
        focused_structure_id: null,
      });

      const assistantMessage: ChatMessage = {
        id: `${Date.now()}-assistant`,
        role: 'assistant',
        content: response.response_text,
        timestamp: new Date(),
        ui_actions: response.ui_actions,
      };

      setMessages((prev) => [...prev, assistantMessage]);
      setConversationId(response.conversation_id);
    } catch (error) {
      console.error('Chat error:', error);

      const errorMessage: ChatMessage = {
        id: `${Date.now()}-error`,
        role: 'assistant',
        content:
          'I apologize, but I encountered an error. Please try again.',
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardAvoiding}
        keyboardVerticalOffset={0}
      >
        <View style={styles.container}>
          {/* Disclaimer */}
          <View style={styles.disclaimerBanner}>
            <Text style={styles.disclaimerText}>
              {MEDICAL_DISCLAIMER}
            </Text>
          </View>

          {/* Messages */}
          <View style={styles.messagesContainer}>
            <FlatList
              ref={flatListRef}
              data={messages}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.messagesContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <View
                  style={[
                    styles.messageBubble,
                    item.role === 'user'
                      ? styles.userBubble
                      : styles.assistantBubble,
                  ]}
                >
                  <Text
                    style={[
                      styles.messageText,
                      item.role === 'user'
                        ? styles.userText
                        : styles.assistantText,
                    ]}
                  >
                    {item.content}
                  </Text>

                  <Text
                    style={[
                      styles.messageTime,
                      item.role === 'user'
                        ? styles.userTime
                        : styles.assistantTime,
                    ]}
                  >
                    {item.timestamp.toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Text>
                </View>
              )}
            />

            {sending && (
              <View style={styles.typingContainer}>
                <Text style={styles.typingText}>MedGraph is thinking...</Text>
              </View>
            )}
          </View>

          {/* Input */}
          <View style={styles.inputContainer}>
            <View style={styles.inputWrapper}>
              <TextInput
                ref={inputRef}
                style={styles.input}
                value={inputText}
                onChangeText={setInputText}
                placeholder="Ask about your health..."
                placeholderTextColor={COLORS.textMuted}
                multiline
                maxLength={2000}
                editable={!sending}
                returnKeyType="send"
                onSubmitEditing={() => {
                  void sendMessage();
                }}
              />

              <Button
                title={sending ? 'Sending...' : 'Send'}
                onPress={() => {
                  void sendMessage();
                }}
                disabled={sending || !inputText.trim()}
                variant="primary"
                style={styles.sendButton}
              />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  keyboardAvoiding: {
    flex: 1,
  },

  disclaimerBanner: {
    backgroundColor: COLORS.accentBg,
    borderBottomWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.2)',
    padding: SPACING.md,
    paddingHorizontal: SPACING.xl,
  },

  disclaimerText: {
    ...TYPOGRAPHY.caption,
    color: COLORS.accent,
    lineHeight: 18,
    textAlign: 'center',
  },

  messagesContainer: {
    flex: 1,
  },

  messagesContent: {
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    gap: SPACING.md,
    flexGrow: 1,
  },

  messageBubble: {
    maxWidth: '80%',
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.lg,
  },

  userBubble: {
    backgroundColor: COLORS.primary,
    alignSelf: 'flex-end',
    borderBottomRightRadius: BORDER_RADIUS.sm,
  },

  assistantBubble: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignSelf: 'flex-start',
    borderBottomLeftRadius: BORDER_RADIUS.sm,
  },

  messageText: {
    ...TYPOGRAPHY.body,
    color: COLORS.textPrimary,
    lineHeight: 22,
  },

  userText: {
    color: COLORS.textPrimary,
  },

  assistantText: {
    color: COLORS.textPrimary,
  },

  messageTime: {
    ...TYPOGRAPHY.caption,
    marginTop: SPACING.xs,
    opacity: 0.6,
    alignSelf: 'flex-end',
  },

  userTime: {
    color: 'rgba(255, 255, 255, 0.6)',
  },

  assistantTime: {
    color: COLORS.textMuted,
  },

  typingContainer: {
    paddingHorizontal: SPACING.xl,
    paddingBottom: SPACING.sm,
  },

  typingText: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
  },

  inputContainer: {
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.background,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },

  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: SPACING.md,
  },

  input: {
    flex: 1,
    ...TYPOGRAPHY.body,
    color: COLORS.textPrimary,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.full,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    maxHeight: 120,
    minHeight: 48,
  },

  sendButton: {
    marginLeft: SPACING.sm,
  },
});