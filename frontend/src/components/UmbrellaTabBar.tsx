import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { BlurView } from 'expo-blur';
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
import { GV, SPACE, FONT } from '@/theme/guava';
import { LG } from '@/theme/liquidGlass';
import { PressScale } from './PressScale';
import {
  isTabBarHidden,
  resetTabBarScroll,
  subscribeTabBarVisibility,
} from './tabBarVisibility';

// Guava-flat dock, rebuilt as Apple Liquid Glass (regular variant):
// floating functional layer only — BlurView + translucent dark fill +
// hairline highlight over the scrolling content. Content cards stay opaque.
// iOS tab contract: glyph over label; the red pulse is the center action
// INSIDE the capsule, tinted glass like the rest of the bar.
const BAR_H = 64;
const PULSE_W = 76;
const PULSE_H = 46;

/** Opaque fallback when the OS asks for reduced transparency. */
function useReduceTransparency(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let mounted = true;
    const api = AccessibilityInfo as unknown as {
      isReduceTransparencyEnabled?: () => Promise<boolean>;
    };
    if (typeof api.isReduceTransparencyEnabled === 'function') {
      api.isReduceTransparencyEnabled().then((v) => {
        if (mounted) setReduced(v);
      }).catch(() => undefined);
    }
    return () => {
      mounted = false;
    };
  }, []);
  return reduced;
}

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

// Keep the Guava contract import shape honest — FONT styles the tab labels.
void FONT;

/**
 * UmbrellaTabBar — Liquid Glass floating dock (regular variant).
 *
 * Blur + translucent dark fill + hairline highlight over scrolling content;
 * opaque fallback under Reduce Transparency. Side tabs are monochrome
 * (white / 72% white); the red pulse button is the single tinted primary
 * action. 44pt targets, press-scale feedback, heartbeat gated by
 * reduced motion.
 *
 * Standard tab contract: emits tabPress, navigates only when not focused.
 */
export function UmbrellaTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const reduceTransparency = useReduceTransparency();

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
    // Monochrome labels on glass (Apple color-on-glass rule): white when
    // focused, 72% white otherwise. White-on-dark-glass stays ≥ 4.5:1.
    const color = isFocused ? LG.label : LG.labelSecondary;
    const Glyph = name === 'Dashboard' ? HomeGlyph : ChatGlyph;
    return (
      <PressScale
        onPress={() => onTabPress(route.name, route.key, isFocused)}
        accessibilityLabel={label}
        accessibilityState={{ selected: isFocused }}
        scaleTo={0.9}
        style={styles.side}
        hitSlop={8}
      >
        {/* iOS tab contract: glyph on top, label underneath. */}
        <View style={[styles.sideItem, isFocused && styles.sideItemFocused]}>
          <Glyph color={color} />
          <Text style={[styles.sideLabel, { color }]} maxFontSizeMultiplier={1.3}>{label}</Text>
        </View>
      </PressScale>
    );
  };

  const ppgRoute = state.routes.find((r) => r.name === 'PpgMeasure');
  const ppgFocused = ppgRoute != null && state.routes[state.index]?.key === ppgRoute.key;
  // Pulse lives on Home and Home alone — off Home the dock is two tabs.
  const showPulse = isHome && ppgRoute != null;

  return (
    <Animated.View
      style={[styles.bar, { height: BAR_H, bottom: insets.bottom + 8 }, sidesStyle]}
      pointerEvents={sidesHidden ? 'none' : 'auto'}
    >
      {/* Liquid Glass regular variant: system blur + translucent fill +
          hairline highlight. Opaque fallback under Reduce Transparency.
          The whole capsule minimizes on scroll down (iOS tab-bar behavior)
          and returns on scroll up. */}
      {reduceTransparency ? null : (
        <BlurView tint="dark" intensity={LG.blurIntensity} style={StyleSheet.absoluteFill} />
      )}
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          styles.glassFill,
          reduceTransparency && styles.glassFillOpaque,
        ]}
      />
      <View pointerEvents="none" style={styles.glassTopEdge} />
      <View style={styles.row}>
        {sideTab('Dashboard', 'Home')}
        {/* Pulse lives INSIDE the capsule as the center action: a tinted
            glass pill between the two tabs, same material language. */}
        {showPulse && ppgRoute ? (
          <View style={styles.centerWrap} pointerEvents="box-none">
            <PressScale
              onPress={() => onTabPress(ppgRoute.name, ppgRoute.key, ppgFocused)}
              accessibilityLabel="Measure pulse"
              accessibilityState={{ selected: ppgFocused }}
              scaleTo={0.92}
              style={styles.ppgBtn}
            >
              {reduceTransparency ? null : (
                <BlurView tint="dark" intensity={LG.blurIntensity + 8} style={StyleSheet.absoluteFill} />
              )}
              <View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFill,
                  styles.ppgTint,
                  ppgFocused && styles.ppgTintFocused,
                  reduceTransparency && styles.ppgTintOpaque,
                ]}
              />
              <View pointerEvents="none" style={styles.ppgTopEdge} />
              <Animated.View style={[styles.ppgInner, popStyle]}>
                <Svg width={38} height={26} viewBox="0 0 40 32">
                  <Path
                    d="M2 18 H10 L14 18 L17 7 L21 27 L24 13 L26 18 H38"
                    fill="none"
                    stroke="#FFFFFF"
                    strokeWidth={4}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </Svg>
              </Animated.View>
            </PressScale>
          </View>
        ) : (
          <View style={styles.centerWrap} />
        )}
        {sideTab('Chat', 'Chat')}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Floating Liquid Glass dock — blur + translucent dark fill, hairline
  // highlight, no solid white. 62pt tall so every tab keeps a 44pt target.
  bar: {
    position: 'absolute',
    left: SPACE.screenH,
    right: SPACE.screenH,
    backgroundColor: 'transparent',
    borderRadius: LG.dockRadius,
    borderWidth: 1,
    borderColor: LG.border,
    overflow: 'hidden',
  },
  glassFill: {
    backgroundColor: LG.fill,
    borderRadius: LG.dockRadius,
  },
  glassFillOpaque: {
    backgroundColor: LG.fillOpaque,
  },
  glassTopEdge: {
    position: 'absolute',
    top: 0,
    left: 20,
    right: 20,
    height: 1,
    backgroundColor: LG.hairlineTop,
    borderRadius: 1,
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
  // iOS tab contract: glyph on top, label underneath. Quiet item —
  // transparent at rest, white wash when focused.
  sideItem: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minWidth: 88,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: LG.targetDefault,
    borderRadius: 18,
    backgroundColor: 'transparent',
  },
  sideItemFocused: {
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  sideLabel: {
    fontFamily: FONT.medium,
    fontSize: 11,
    lineHeight: 13,
  },
  // Center lane inside the capsule: hosts the pulse (or empty on non-Home).
  centerWrap: {
    width: PULSE_W + 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Pulse — tinted Liquid Glass pill INSIDE the capsule: same blur + fill +
  // hairline recipe as the dock, accent laid on the glass background
  // (Apple's "color the background" rule), soft red glow. ECG stays white.
  ppgBtn: {
    width: PULSE_W,
    height: PULSE_H,
    borderRadius: PULSE_H / 2,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.30)',
    backgroundColor: 'rgba(30,16,22,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#D7263D',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 14,
    elevation: 8,
  },
  ppgTint: {
    backgroundColor: 'rgba(215,38,61,0.42)',
  },
  ppgTintFocused: {
    backgroundColor: 'rgba(168,22,43,0.55)',
  },
  ppgTintOpaque: {
    backgroundColor: GV.pulsePressed,
  },
  ppgTopEdge: {
    position: 'absolute',
    top: 0,
    left: 16,
    right: 16,
    height: 1,
    borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.38)',
  },
  ppgInner: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
