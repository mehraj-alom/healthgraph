import { useEffect, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Circle } from 'react-native-svg';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useReducedMotion } from '@/theme';
import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
import { PressScale } from './PressScale';
import {
  isTabBarHidden,
  resetTabBarScroll,
  subscribeTabBarVisibility,
} from './tabBarVisibility';

// Guava-flat dock — one floating white bar on the dark stage, dark-ink
// vector glyphs for the side tabs, one CTA-green pulse button. Flat fills
// only; the pulse button's resting heartbeat is the only loop.
const BAR_H = 62;
const BTN = 72;
const BTN_TOP = -26;
const CENTER_W = 128;

const TABS = [
  { name: 'Dashboard', label: 'Home' },
  { name: 'PpgMeasure', label: '' },
  { name: 'Chat', label: 'Chat' },
] as const;

function HomeGlyph({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 11.5 12 4l8 7.5M6 10.5V20h4.5v-5.5h3V20H18v-9.5"
        stroke={color}
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function ChatGlyph({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 6.5h16v9.5H9.5L4 20v-13.5Z"
        stroke={color}
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={9} cy={11.2} r={1.15} fill={color} stroke="none" />
      <Circle cx={13.5} cy={11.2} r={1.15} fill={color} stroke="none" />
    </Svg>
  );
}

// Keep FONT referenced for the Guava contract import shape.
void FONT;

/**
 * UmbrellaTabBar — Guava-style floating dock.
 *
 * A white pill bar (GV.card, radius 28) with dark-ink Home / Chat tabs and
 * a red pulse button riding half above center — white ECG trace,
 * resting double-thump heartbeat, press-scale feedback. No orbit ring, no
 * halos: the button stays one clean flat circle. The whole pulse assembly
 * mounts ONLY on Home; every other tab gets a quiet two-tab dock. Static
 * (no loops) under reduced motion.
 *
 * Standard tab contract: emits tabPress, navigates only when not focused.
 */
export function UmbrellaTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { width: W } = useWindowDimensions();
  const reduced = useReducedMotion();

  const cx = W / 2;

  const focusedName = state.routes[state.index]?.name;
  const isHome = focusedName === 'Dashboard';

  // Resting double-thump heartbeat, UI-thread, perpetual; static at 1
  // under reduced motion.
  const pop = useSharedValue(1);
  useEffect(() => {
    if (reduced) return;
    pop.value = withRepeat(
      withSequence(
        withTiming(1.07, { duration: 140, easing: Easing.out(Easing.quad) }),
        withTiming(1, { duration: 160 }),
        withTiming(1.12, { duration: 120, easing: Easing.out(Easing.quad) }),
        withTiming(1, { duration: 240 }),
        withTiming(1, { duration: 1100 }),
      ),
      -1,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  const popStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pop.value }],
  }));

  // Scroll-aware side tabs: hide on scroll down, return on scroll up.
  // The pulse assembly is Home-only, so it never needs scroll logic.
  // Tab switches reset to visible.
  const [sidesHidden, setSidesHidden] = useState(isTabBarHidden());
  useEffect(() => subscribeTabBarVisibility(setSidesHidden), []);
  useEffect(() => {
    resetTabBarScroll();
  }, [state.index]);
  const sidesStyle = useAnimatedStyle(() => ({
    opacity: withTiming(sidesHidden ? 0 : 1, { duration: reduced ? 0 : 220 }),
    transform: [{ translateY: withTiming(sidesHidden ? 28 : 0, { duration: reduced ? 0 : 220 }) }],
  }));

  // Chat is a full-screen surface — no dock, the system back button (or the
  // Home pill's absence) handles exit. Hooks above always run; this only
  // skips rendering.
  if (focusedName === 'Chat') return null;

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

  const sideTab = (name: (typeof TABS)[number]['name'], label: string) => {
    const route = state.routes.find((r) => r.name === name);
    if (!route) return <View style={styles.side} />;
    const isFocused = state.routes[state.index]?.key === route.key;
    const color = isFocused ? GV.cta : GV.ink;
    const Glyph = name === 'Dashboard' ? HomeGlyph : ChatGlyph;
    return (
      <PressScale
        onPress={() => onTabPress(route.name, route.key, isFocused)}
        accessibilityLabel={label}
        accessibilityState={{ selected: isFocused }}
        scaleTo={0.9}
        style={styles.side}
      >
        <View style={[styles.sidePill, isFocused && styles.sidePillFocused]}>
          <Glyph color={color} />
          <Text style={[styles.sideLabel, { color }]}>{label}</Text>
        </View>
      </PressScale>
    );
  };

  const ppgRoute = state.routes.find((r) => r.name === 'PpgMeasure');
  const ppgFocused = ppgRoute != null && state.routes[state.index]?.key === ppgRoute.key;
  // Pulse lives on Home and Home alone — off Home the dock is two tabs.
  const showPulse = isHome && ppgRoute != null;

  return (
    <View style={[styles.bar, { height: BAR_H, bottom: insets.bottom + 8 }]}>
      <Animated.View
        style={[styles.row, sidesStyle]}
        pointerEvents={sidesHidden ? 'none' : 'auto'}
      >
        {sideTab('Dashboard', 'Home')}
        <View style={styles.centerSpacer} />
        {sideTab('Chat', 'Chat')}
      </Animated.View>

      {showPulse && ppgRoute ? (
        <View style={[styles.centerWrap, { left: cx - SPACE.screenH - BTN / 2, top: BTN_TOP }]} pointerEvents="box-none">
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
              <Svg width={46} height={36} viewBox="0 0 40 32">
                <Path
                  d="M2 18 H10 L14 18 L17 7 L21 27 L24 13 L26 18 H38"
                  fill="none"
                  stroke="#FFFFFF"
                  strokeWidth={3.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
              <View style={styles.coreDot} />
            </Animated.View>
          </PressScale>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Floating white dock on the stage — flat fill, no border, no shadow.
  bar: {
    position: 'absolute',
    left: SPACE.screenH,
    right: SPACE.screenH,
    backgroundColor: GV.card,
    borderRadius: 28,
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
  },
  // Quiet tab pill — transparent at rest, soft wash when focused.
  // Focus carries CTA green: glyph + label shift together.
  sidePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: SPACE.rPill,
    backgroundColor: 'transparent',
  },
  sidePillFocused: {
    backgroundColor: GV.wash,
  },
  sideLabel: {
    ...TYPE.chip,
  },
  centerSpacer: {
    width: CENTER_W,
  },
  centerWrap: {
    position: 'absolute',
    width: BTN,
    height: BTN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // One clean red circle, white ECG trace. No ring, no halos.
  ppgBtn: {
    width: BTN,
    height: BTN,
    borderRadius: BTN / 2,
    backgroundColor: GV.pulse,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ppgBtnFocused: {
    backgroundColor: GV.pulsePressed,
  },
  ppgInner: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Lit core under the trace — the one white point on the dock.
  coreDot: {
    position: 'absolute',
    width: 5,
    height: 5,
    borderRadius: 2.5,
    bottom: 1,
    backgroundColor: '#FFFFFF',
  },
});
