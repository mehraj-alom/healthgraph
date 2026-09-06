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
import { COLORS, SPACING, BORDER_RADIUS, TYPOGRAPHY, ELEVATION } from '@/constants';

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
 * MedGraph bottom sheet — dark elevated surface, rounded top corners, drag
 * handle, scrollable + keyboard-aware content. Built on RN Modal so no
 * invisible overlay remains after closing; Android Back dismisses it.
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
          style={styles.scrim}
          onPress={allowTouchOutsideToClose ? onClose : undefined}
          accessibilityLabel="Close sheet"
        />

        <Animated.View
          style={[styles.sheet, { transform: [{ translateY: panY }] }]}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.kav}
          >
            {/* Drag region: handle + header */}            <View
              style={styles.grabArea}
              {...(swipeToClose ? drag.panHandlers : {})}
            >
              <View style={styles.handle} />
              <View style={styles.header}>
                <Text style={styles.title}>{title ?? ''}</Text>
                <Pressable
                  onPress={onClose}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Close sheet"
                  style={({ pressed }) => [
                    styles.closeButton,
                    pressed && styles.closeButtonPressed,
                  ]}
                >
                  <Text style={styles.closeText}>✕</Text>
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
              <View style={[styles.actions, { paddingBottom: Math.max(insets.bottom, SPACING.md) }]}>
                {actions}
              </View>
            ) : (
              <View style={{ height: Math.max(insets.bottom, SPACING.sm) }} />
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
    backgroundColor: COLORS.overlayScrim,
  },
  sheet: {
    backgroundColor: COLORS.glassStrong,
    borderTopLeftRadius: BORDER_RADIUS.xl + 4,
    borderTopRightRadius: BORDER_RADIUS.xl + 4,
    borderWidth: 1,
    borderColor: COLORS.borderFaint,
    borderBottomWidth: 0,
    maxHeight: '88%',
    ...ELEVATION.deep,
  },
  kav: {
    maxHeight: '100%',
  },
  grabArea: {
    paddingTop: SPACING.sm,
    paddingHorizontal: SPACING.lg,
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.borderStrong,
    opacity: 0.7,
    marginBottom: SPACING.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.md,
    paddingBottom: SPACING.sm,
  },
  title: {
    ...TYPOGRAPHY.h3,
    color: COLORS.textPrimary,
    flex: 1,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: COLORS.borderFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonPressed: {
    backgroundColor: COLORS.surfacePressed,
    transform: [{ scale: 0.94 }],
  },
  closeText: {
    color: COLORS.textSecondary,
    fontSize: 14,
    lineHeight: 16,
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.md,
  },
  actions: {
    flexDirection: 'row',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderFaint,
  },
});
