import { useEffect, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Polyline } from 'react-native-svg';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { COLORS } from '@/constants';
import { useReducedMotion } from '@/theme';
import { PressScale } from './PressScale';
import {
  isTabBarHidden,
  resetTabBarScroll,
  subscribeTabBarVisibility,
} from './tabBarVisibility';

const RED = '#D7263D';
const RED_DARK = '#A8162B';
// Slim floating dock: the strip is fully transparent (content flows behind
// it like water); the red button rides half outside above it.
const BAR_H = 62;
const ARCH_TOP = 30;
const ARCH_H = 20;
const ARCH_HALF_W = 84;
const BTN = 68;
const BTN_TOP = -24;

const TABS = [
  { name: 'Dashboard', label: 'Home', glyph: '🏠' },
  { name: 'PpgMeasure', label: '', glyph: '' },
  { name: 'Chat', label: 'Chat', glyph: '💬' },
] as const;

/**
 * UmbrellaTabBar — straight line, umbrella arch, straight line.
 *
 * A custom bottom dock: the top edge runs straight, arches up over the
 * middle like an umbrella canopy, and runs straight again. The red PPG
 * button sits cradled under the arch with a bold ECG trace, a resting
 * heartbeat pop, and twin expanding halos — always alive, always
 * eye-catching. Static (no loops) under reduced motion.
 *
 * Standard tab contract: emits tabPress, navigates only when not focused.
 */
export function UmbrellaTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { width: W } = useWindowDimensions();
  const reduced = useReducedMotion();

  const H = BAR_H + insets.bottom;
  const cx = W / 2;
  const peakY = ARCH_TOP - ARCH_H;

  // The one and only line: just the umbrella canopy over the middle
  // button. No full-width straights, no filled block — the bar stays
  // transparent so content flows underneath.
  const topCurve =
    `M ${cx - ARCH_HALF_W} ${ARCH_TOP} ` +
    `C ${cx - ARCH_HALF_W + 36} ${ARCH_TOP}, ${cx - 46} ${peakY}, ${cx} ${peakY} ` +
    `C ${cx + 46} ${peakY}, ${cx + ARCH_HALF_W - 36} ${ARCH_TOP}, ${cx + ARCH_HALF_W} ${ARCH_TOP}`;

  // Resting heartbeat pop + twin halo rings (UI thread, perpetual).
  const pop = useSharedValue(1);
  const haloA = useSharedValue(0);
  const haloB = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    pop.value = withRepeat(
      withSequence(
        withTiming(1.06, { duration: 150, easing: Easing.out(Easing.quad) }),
        withTiming(1, { duration: 170 }),
        withTiming(1.1, { duration: 130, easing: Easing.out(Easing.quad) }),
        withTiming(1, { duration: 240 }),
        withTiming(1, { duration: 1100 }),
      ),
      -1,
    );
    const ring = withRepeat(
      withTiming(1, { duration: 2000, easing: Easing.out(Easing.quad) }),
      -1,
    );
    haloA.value = ring;
    haloB.value = withDelay(1000, ring);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  const popStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pop.value }],
  }));
  const haloAStyle = useAnimatedStyle(() => ({
    opacity: 0.55 * (1 - haloA.value),
    transform: [{ scale: 1 + haloA.value * 0.85 }],
  }));
  const haloBStyle = useAnimatedStyle(() => ({
    opacity: 0.55 * (1 - haloB.value),
    transform: [{ scale: 1 + haloB.value * 0.85 }],
  }));

  // Scroll-aware side tabs: hide on scroll down, return on scroll up.
  // The center pulse button is intentionally outside this animation and
  // never hides. Tab switches reset to visible.
  const [sidesHidden, setSidesHidden] = useState(isTabBarHidden());
  useEffect(() => subscribeTabBarVisibility(setSidesHidden), []);
  useEffect(() => {
    resetTabBarScroll();
  }, [state.index]);
  const sidesStyle = useAnimatedStyle(() => ({
    opacity: withTiming(sidesHidden ? 0 : 1, { duration: reduced ? 0 : 220 }),
    transform: [{ translateY: withTiming(sidesHidden ? 28 : 0, { duration: reduced ? 0 : 220 }) }],
  }));

  const onTabPress = (routeName: string, routeKey: string, isFocused: boolean) => {
    const event = navigation.emit({
      type: 'tabPress',
      target: routeKey,
      canPreventDefault: true,
    });
    if (!isFocused && !event.defaultPrevented) {
      navigation.navigate(routeName as never);
    }
  };

  const sideTab = (name: (typeof TABS)[number]['name'], label: string, glyph: string) => {
    const route = state.routes.find((r) => r.name === name);
    if (!route) return <View style={styles.side} />;
    const isFocused = state.routes[state.index]?.key === route.key;
    const color = isFocused ? COLORS.primary : COLORS.textMuted;
    return (
      <PressScale
        onPress={() => onTabPress(route.name, route.key, isFocused)}
        accessibilityLabel={label}
        accessibilityState={{ selected: isFocused }}
        scaleTo={0.9}
        style={styles.side}
      >
        <View style={styles.sidePill}>
          <Text style={[styles.glyph, { opacity: isFocused ? 1 : 0.7 }]}>{glyph}</Text>
          <Text style={[styles.sideLabel, { color }]}>{label}</Text>
          <View style={[styles.dot, { backgroundColor: isFocused ? color : 'transparent' }]} />
        </View>
      </PressScale>
    );
  };

  const ppgRoute = state.routes.find((r) => r.name === 'PpgMeasure');
  const ppgFocused = ppgRoute != null && state.routes[state.index]?.key === ppgRoute.key;

  return (
    <View style={[styles.bar, { height: H, paddingBottom: insets.bottom }]}>
      <Svg width={W} height={H} style={StyleSheet.absoluteFill}>
        <Path d={topCurve} fill="none" stroke={COLORS.border} strokeWidth={1.5} />
      </Svg>

      <Animated.View
        style={[styles.row, sidesStyle]}
        pointerEvents={sidesHidden ? 'none' : 'auto'}
      >
        {sideTab('Dashboard', 'Home', '🏠')}
        <View style={styles.centerSpacer} />
        {sideTab('Chat', 'Chat', '💬')}
      </Animated.View>

      {ppgRoute ? (
        <View style={[styles.centerWrap, { left: cx - BTN / 2, top: BTN_TOP }]} pointerEvents="box-none">
          {!reduced ? (
            <>
              <Animated.View style={[styles.halo, haloAStyle]} pointerEvents="none" />
              <Animated.View style={[styles.halo, haloBStyle]} pointerEvents="none" />
            </>
          ) : null}
          <PressScale
            onPress={() => onTabPress(ppgRoute.name, ppgRoute.key, ppgFocused)}
            accessibilityLabel="Measure pulse"
            accessibilityState={{ selected: ppgFocused }}
            scaleTo={0.88}
            style={[
              styles.ppgBtn,
              ppgFocused && styles.ppgBtnFocused,
            ]}
          >
            <Animated.View style={[styles.ppgInner, popStyle]}>
              <Svg width={44} height={34} viewBox="0 0 40 32">
                <Polyline
                  points="2,18 10,18 14,18 17,7 21,27 24,13 26,18 38,18"
                  fill="none"
                  stroke="#FFFFFF"
                  strokeWidth={3.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            </Animated.View>
          </PressScale>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent',
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  side: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 8,
  },
  // Translucent pill so Home/Chat stay legible over scrolling content while
  // keeping the floating transparent-dock feel (never a solid block).
  sidePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 9999,
    backgroundColor: 'rgba(255,251,243,0.82)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(29,27,23,0.10)',
  },
  glyph: {
    fontSize: 22,
  },
  sideLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  centerSpacer: {
    width: ARCH_HALF_W * 2 - 40,
  },
  centerWrap: {
    position: 'absolute',
    width: BTN,
    height: BTN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    width: BTN,
    height: BTN,
    borderRadius: BTN / 2,
    borderWidth: 2.5,
    borderColor: '#E8862E',
  },
  ppgBtn: {
    width: BTN,
    height: BTN,
    borderRadius: BTN / 2,
    backgroundColor: RED,
    borderWidth: 3,
    borderColor: RED_DARK,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: RED,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
    elevation: 8,
  },
  ppgBtnFocused: {
    borderColor: '#FFFFFF',
  },
  ppgInner: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
