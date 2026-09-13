import {
  StyleSheet,
  View,
  Text,
  Pressable,
  ScrollView,
  Modal as RNModal,
  KeyboardAvoidingView,
  Platform,
  PanResponder,
  Animated,
  type ViewStyle,
} from 'react-native';
import { useEffect, useRef } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme';
import { spacing, radius } from '@/theme/tokens';

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  /** Actions pinned under the scrollable content. */
  actions?: React.ReactNode;
  /** Close by tapping the scrim (default true). */
  allowTouchOutsideToClose?: boolean;
  /** Allow swipe-down to dismiss (default true). */
  swipeToClose?: boolean;
  contentStyle?: ViewStyle;
}

/**
 * HealthGraph bottom sheet — elevated surface, rounded top, drag handle,
 * scrollable + keyboard-aware content. Built on RN Modal (nothing stays
 * mounted after close); Android Back dismisses it.
 */
export const BottomSheet = ({
  visible,
  onClose,
  title,
  children,
  actions,
  allowTouchOutsideToClose = true,
  swipeToClose = true,
  contentStyle,
}: BottomSheetProps) => {
  const insets = useSafeAreaInsets();
  const { colors, typography, elevation } = useTheme();
  const panY = useRef(new Animated.Value(0)).current;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const swipeRef = useRef(swipeToClose);
  swipeRef.current = swipeToClose;

  useEffect(() => {
    if (visible) panY.setValue(0);
  }, [visible, panY]);

  const drag = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, gesture) =>
        swipeRef.current && gesture.dy > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.4,
      onPanResponderMove: Animated.event([null, { dy: panY }], { useNativeDriver: true }),
      onPanResponderRelease: (_evt, gesture) => {
        if (!swipeRef.current) return;
        if (gesture.dy > 90 || gesture.vy > 1) {
          closeRef.current();
        } else {
          Animated.spring(panY, {
            toValue: 0,
            useNativeDriver: true,
            speed: 24,
            bounciness: 4,
          }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(panY, { toValue: 0, useNativeDriver: true }).start();
      },
    }),
  ).current;

  return (
    <RNModal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <Pressable
          style={[styles.scrim, { backgroundColor: colors.overlayScrim }]}
          onPress={allowTouchOutsideToClose ? onClose : undefined}
          accessibilityLabel="Close sheet"
        />

        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.glassStrong,
              borderColor: colors.glassBorder,
            },
            elevation.deep,
            { transform: [{ translateY: panY }] },
          ]}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.kav}
          >
            {/* Drag region: handle + header */}
            <View
              style={styles.grabArea}
              {...(swipeToClose ? drag.panHandlers : {})}
            >
              <View style={[styles.handle, { backgroundColor: colors.borderStrong }]} />
              <View style={styles.header}>
                <Text style={[styles.title, typography.heading, { color: colors.textPrimary }]}>
                  {title ?? ''}
                </Text>
                <Pressable
                  onPress={onClose}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Close sheet"
                  style={({ pressed }) => [
                    styles.closeButton,
                    { backgroundColor: colors.glassHighlight, borderColor: colors.glassBorder },
                    pressed && [{ backgroundColor: colors.surfacePressed, transform: [{ scale: 0.94 }] }],
                  ]}
                >
                  <Text style={[styles.closeText, { color: colors.textSecondary }]}>✕</Text>
                </Pressable>
              </View>
            </View>

            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {children}
            </ScrollView>

            {actions ? (
              <View style={[styles.actions, { borderTopColor: colors.glassBorder, paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
                {actions}
              </View>
            ) : (
              <View style={{ height: Math.max(insets.bottom, spacing.sm) }} />
            )}
          </KeyboardAvoidingView>
        </Animated.View>
      </View>
    </RNModal>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  sheet: {
    borderTopLeftRadius: radius.xxl + 4,
    borderTopRightRadius: radius.xxl + 4,
    borderWidth: 1,
    borderBottomWidth: 0,
    maxHeight: '88%',
  },
  kav: {
    maxHeight: '100%',
  },
  grabArea: {
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    opacity: 0.7,
    marginBottom: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingBottom: spacing.sm,
  },
  title: {
    flex: 1,
    fontSize: 20,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    fontSize: 14,
    lineHeight: 16,
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
  },
});