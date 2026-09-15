import type { ReactNode } from 'react';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  cancelAnimation,
} from 'react-native-reanimated';
import { springSnappy } from '@/theme/motion';
import { useReducedMotion } from '@/theme/useReducedMotion';

interface PressScaleProps {
  children: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  /** Scale factor on press (default 0.96). */
  scaleTo?: number;
  accessibilityLabel?: string;
  accessibilityRole?: 'button' | 'link';
  accessibilityState?: { disabled?: boolean; selected?: boolean };
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Shared press feedback primitive.
 *
 * One fast spring runs the compress/release — identical feel across cards,
 * buttons and rows. Uses Reanimated so the transform runs on the UI thread.
 */
export function PressScale({
  children,
  onPress,
  onLongPress,
  disabled = false,
  scaleTo = 0.96,
  accessibilityLabel,
  accessibilityRole = 'button',
  accessibilityState,
  style,
  testID,
}: PressScaleProps) {
  const scale = useSharedValue(1);
  const reduced = useReducedMotion();

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const pressIn = () => {
    'worklet';
    if (reduced) return;
    cancelAnimation(scale);
    scale.value = withSpring(scaleTo, springSnappy);
  };

  const pressOut = () => {
    'worklet';
    if (reduced) return;
    cancelAnimation(scale);
    scale.value = withSpring(1, springSnappy);
  };

  return (
    <Animated.View style={[animatedStyle, style]}>
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        onPressIn={disabled ? undefined : pressIn}
        onPressOut={disabled ? undefined : pressOut}
        disabled={disabled}
        accessibilityRole={accessibilityRole}
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled, ...accessibilityState }}
        testID={testID}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}