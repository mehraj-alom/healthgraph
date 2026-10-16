import { StyleSheet, View } from 'react-native';

/**
 * AmbientBackground — the shared aurora wash (single source of truth for
 * tinted canvases; extend here, never per-screen copies).
 *
 * - `dark` (default): teal/blue/purple/gold wash for the deep-navy screens.
 * - `clinical`: pale red + slate wash for the light medical Timeline.
 * - `algae`: black-teal liquid-glass wash matching the web stage
 *   (algae + teal-blue ambient on near-black, no purple/gold).
 *
 * Static translucent blobs only — no animation, so it is reduced-motion
 * safe by construction and costs one composite, not frames.
 */
export function AmbientBackground({ tone = 'dark' }: { tone?: 'dark' | 'clinical' | 'algae' }) {
  if (tone === 'algae') {
    return (
      <View style={styles.ambient} pointerEvents="none">
        <View style={[styles.blob, styles.algaeTop]} />
        <View style={[styles.blob, styles.algaeBlue]} />
        <View style={[styles.blob, styles.algaeDeep]} />
      </View>
    );
  }
  if (tone === 'clinical') {
    return (
      <View style={styles.ambient} pointerEvents="none">
        <View style={[styles.blob, styles.clinicalRed]} />
        <View style={[styles.blob, styles.clinicalSlate]} />
        <View style={[styles.blob, styles.clinicalRose]} />
      </View>
    );
  }
  return (
    <View style={styles.ambient} pointerEvents="none">
      <View style={[styles.blob, styles.blobTeal]} />
      <View style={[styles.blob, styles.blobBlue]} />
      <View style={[styles.blob, styles.blobPurple]} />
      <View style={[styles.blob, styles.blobGold]} />
    </View>
  );
}

const styles = StyleSheet.create({
  ambient: {
    ...StyleSheet.absoluteFill,
  },
  blob: {
    position: 'absolute',
    borderRadius: 9999,
  },
  blobTeal: {
    width: 300,
    height: 300,
    top: -110,
    right: -90,
    backgroundColor: 'rgba(49, 183, 165, 0.13)',
  },
  blobBlue: {
    width: 340,
    height: 340,
    top: 220,
    left: -130,
    backgroundColor: 'rgba(77, 141, 255, 0.12)',
  },
  blobPurple: {
    width: 280,
    height: 280,
    top: 640,
    right: -110,
    backgroundColor: 'rgba(155, 108, 255, 0.11)',
  },
  blobGold: {
    width: 220,
    height: 220,
    top: 1080,
    left: -80,
    backgroundColor: 'rgba(244, 197, 27, 0.08)',
  },
  // Black-teal liquid glass (web body parity): algae glow top-left,
  // teal-blue lift top-right, deep algae pool at the bottom.
  algaeTop: {
    width: 340,
    height: 220,
    top: -90,
    left: -70,
    backgroundColor: 'rgba(20, 122, 101, 0.28)',
  },
  algaeBlue: {
    width: 300,
    height: 220,
    top: -60,
    right: -80,
    backgroundColor: 'rgba(56, 189, 248, 0.14)',
  },
  algaeDeep: {
    width: 420,
    height: 300,
    top: 640,
    left: -60,
    backgroundColor: 'rgba(11, 74, 63, 0.5)',
  },
  clinicalRed: {
    width: 320,
    height: 320,
    top: -120,
    right: -100,
    backgroundColor: 'rgba(215, 38, 61, 0.06)',
  },
  clinicalSlate: {
    width: 300,
    height: 300,
    top: 420,
    left: -120,
    backgroundColor: 'rgba(43, 108, 176, 0.06)',
  },
  clinicalRose: {
    width: 260,
    height: 260,
    top: 900,
    right: -100,
    backgroundColor: 'rgba(215, 38, 61, 0.05)',
  },
});
