import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
} from 'react-native-reanimated';
import { useTheme } from '@/theme';
import { spacing, radius } from '@/theme/tokens';
import { bezier, curves, durations } from '@/theme/motion';

interface ToastOptions {
  message: string;
  tone?: 'default' | 'success' | 'error' | 'warning' | 'info';
  duration?: number;
}

interface ToastItem extends Required<Pick<ToastOptions, 'message' | 'tone'>> {
  id: number;
  duration: number;
}

interface ToastContextValue {
  show: (opts: ToastOptions) => void;
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const TONE_COLOR = {
  default: 'accentBlue',
  success: 'healthPositive',
  error: 'error',
  warning: 'healthAttention',
  info: 'info',
} as const;

export function ToastProvider({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const [toast, setToast] = useState<ToastItem | null>(null);
  const seq = useRef(0);

  const show = useCallback((opts: ToastOptions) => {
    const id = ++seq.current;
    const tone = opts.tone ?? 'default';
    setToast({
      id,
      message: opts.message,
      tone,
      duration: opts.duration ?? 2600,
    });
  }, []);

  const api = useMemo<ToastContextValue>(
    () => ({
      show,
      success: (m, d) => show({ message: m, tone: 'success', duration: d }),
      error: (m, d) => show({ message: m, tone: 'error', duration: d }),
      info: (m, d) => show({ message: m, tone: 'info', duration: d }),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastView toast={toast} />
    </ToastContext.Provider>
  );
}

function ToastView({ toast }: { toast: ToastItem | null }) {
  const { colors, typography } = useTheme();
  const insets = useSafeAreaInsets();
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(-12);

  useEffect(() => {
    if (!toast) return;
    opacity.value = withTiming(1, { duration: durations.fast, easing: bezier(curves.snappy) });
    translateY.value = withTiming(0, { duration: durations.fast, easing: bezier(curves.snappy) });
    opacity.value = withDelay(toast.duration, withTiming(0, { duration: durations.standard }));
    translateY.value = withDelay(toast.duration, withTiming(-8, { duration: durations.standard }));
  }, [toast, opacity, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  if (!toast) return null;

  const toneKey = TONE_COLOR[toast.tone];
  const accent = colors[toneKey];

  return (
    <View pointerEvents="none" style={[styles.wrap, { top: insets.top + spacing.sm }]}>
      <Animated.View
        style={[
          styles.toast,
          {
            backgroundColor: colors.glassStrong,
            borderColor: colors.borderFaint,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 6 },
            shadowOpacity: 0.18,
            shadowRadius: 12,
            elevation: 8,
          },
          animatedStyle,
        ]}
        accessibilityRole="alert"
        accessibilityLiveRegion="assertive"
      >
        {toast.tone !== 'default' ? (
          <View style={[styles.dot, { backgroundColor: accent }]} accessibilityElementsHidden />
        ) : null}
        <Text style={[styles.message, typography.body, { color: colors.textPrimary }]}>
          {toast.message}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    alignItems: 'center',
    zIndex: 1000,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    maxWidth: 480,
    borderWidth: 1,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  message: {
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 18,
  },
});

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return ctx;
}