import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';

interface GlassCuboidProps {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Aura tint glowing on the black backdrop behind the slab. */
  auraColor?: string;
  auraOpacity?: number;
  /** Inner padding between the slab edge and the content. */
  pad?: number;
  radius?: number;
  intensity?: number;
  /**
   * Resin-sheet mode: the cuboid renders as an absolute glass cover over
   * the siblings (instruments stay interactive underneath). Touches pass
   * straight through; the sheet itself is nearly clear.
   */
  overlay?: boolean;
}

/**
 * GlassCuboid — the shared premium housing for instrument dials on the
 * near-black backdrop (#080A11).
 *
 * One language everywhere: a value-tinted aura, a dark thickness base
 * under the slab, a blurred dark-glass slab with a top chamfer light,
 * side shading, bottom weight, and diagonal sheens. Content sits on top
 * untouched — geometry, gestures, and animation stay with the caller.
 */
export function GlassCuboid({
  children,
  style,
  auraColor,
  auraOpacity = 0.12,
  pad = 14,
  radius = 24,
  intensity = 32,
  overlay = false,
}: GlassCuboidProps) {
  return (
    <View
      style={[styles.wrap, overlay && styles.overlayWrap, style]}
      pointerEvents={overlay ? 'none' : 'auto'}
    >
      {auraColor ? (
        <View
          pointerEvents="none"
          style={[
            styles.aura,
            {
              backgroundColor: auraColor,
              opacity: auraOpacity,
              borderRadius: radius + 8,
            },
          ]}
        />
      ) : null}
      {/* Cuboid side face: the dark thickness under the glass slab. */}
      <View
        pointerEvents="none"
        style={[styles.base, { borderRadius: Math.max(10, radius - 10) }]}
      />
      <View
        style={[
          styles.slab,
          { borderRadius: radius, padding: pad },
          overlay && styles.slabOverlay,
        ]}
      >
        {overlay ? null : (
          <BlurView tint="dark" intensity={intensity} style={StyleSheet.absoluteFill} />
        )}
        <View pointerEvents="none" style={[styles.tint, overlay && styles.tintOverlay]} />
        <View pointerEvents="none" style={styles.topEdge} />
        <View pointerEvents="none" style={styles.leftEdge} />
        <View
          pointerEvents="none"
          style={[styles.bottomShade, overlay && styles.bottomShadeOverlay]}
        />
        <View pointerEvents="none" style={styles.sheenWide} />
        <View pointerEvents="none" style={styles.sheenThin} />
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  // Resin-sheet mode: absolute cover over the stack; the slab stretches
  // to fill while touches fall through to the instruments below.
  overlayWrap: {
    position: 'absolute',
    top: 0,
    left: 10,
    right: 10,
    bottom: 0,
  },
  slabOverlay: {
    flex: 1,
    backgroundColor: 'rgba(20,26,40,0.08)',
    padding: 0,
  },
  tintOverlay: {
    backgroundColor: 'rgba(8,11,18,0.02)',
  },
  bottomShadeOverlay: {
    height: 18,
    backgroundColor: 'rgba(0,0,0,0.12)',
  },
  aura: {
    position: 'absolute',
    left: -6,
    right: -6,
    top: 6,
    bottom: 0,
  },
  base: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: -8,
    height: 16,
    backgroundColor: '#02040A',
    opacity: 0.95,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  slab: {
    position: 'relative',
    alignSelf: 'stretch',
    backgroundColor: 'rgba(17,22,34,0.78)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.13)',
    borderTopColor: 'rgba(255,255,255,0.24)',
    borderLeftColor: 'rgba(255,255,255,0.08)',
    borderRightColor: 'rgba(0,0,0,0.55)',
    borderBottomColor: 'rgba(0,0,0,0.7)',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.55,
    shadowRadius: 22,
    elevation: 12,
  },
  tint: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(8,11,18,0.28)',
  },
  topEdge: {
    position: 'absolute',
    top: 0,
    left: 18,
    right: 18,
    height: 1,
    borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  leftEdge: {
    position: 'absolute',
    top: 18,
    bottom: 18,
    left: 0,
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  bottomShade: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 30,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  sheenWide: {
    position: 'absolute',
    top: -30,
    bottom: -30,
    left: -42,
    width: 84,
    backgroundColor: 'rgba(255,255,255,0.05)',
    transform: [{ rotate: '18deg' }],
  },
  sheenThin: {
    position: 'absolute',
    top: -30,
    bottom: -30,
    left: 34,
    width: 22,
    backgroundColor: 'rgba(255,255,255,0.05)',
    transform: [{ rotate: '18deg' }],
  },
});
