import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useAuth } from '@/context/AuthContext';

/**
 * BootSplash — video loading animation shown while the app opens.
 *
 * Plays the bundled boot video (muted, looping) fullscreen while internal
 * startup work finishes (auth restore, providers, first navigation). The
 * cover deliberately outlasts the raw init so the user never watches the
 * app assemble itself: it lifts only when auth is ready AND a minimum
 * show time has passed, then fades out. Never blocks the app: a video
 * error or an absolute timeout lifts it immediately (the regular
 * loading spinner underneath takes over).
 */

const MIN_SHOW_MS = 4000;
const MAX_SHOW_MS = 12000;
const FADE_MS = 450;

// Metro literal require so the file is bundled (see assetBundlePatterns).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const BOOT_VIDEO = require('../../assets/app-load.mp4');

export function BootSplash() {
  const { loading: authLoading } = useAuth();
  const [minElapsed, setMinElapsed] = useState(false);
  const [maxElapsed, setMaxElapsed] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const [gone, setGone] = useState(false);
  const opacity = useRef(new Animated.Value(1)).current;
  const fading = useRef(false);

  const player = useVideoPlayer(BOOT_VIDEO, (p) => {
    p.loop = true;
    p.muted = true;
  });

  useEffect(() => {
    // Fail fast if the bundled video errors (missing asset, bad encode):
    // the overlay lifts and the regular loader underneath takes over.
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status === 'error') setVideoFailed(true);
    });
    try {
      player.play();
    } catch {
      setVideoFailed(true);
    }
    return () => {
      sub.remove();
      try {
        player.pause();
      } catch {
        // Best-effort teardown.
      }
    };
  }, [player]);

  useEffect(() => {
    const min = setTimeout(() => setMinElapsed(true), MIN_SHOW_MS);
    const max = setTimeout(() => setMaxElapsed(true), MAX_SHOW_MS);
    return () => {
      clearTimeout(min);
      clearTimeout(max);
    };
  }, []);

  useEffect(() => {
    if (gone || fading.current) return;
    const ready = (!authLoading && minElapsed) || maxElapsed || videoFailed;
    if (!ready) return;
    fading.current = true;
    Animated.timing(opacity, {
      toValue: 0,
      duration: FADE_MS,
      useNativeDriver: true,
    }).start(() => setGone(true));
  }, [authLoading, minElapsed, maxElapsed, videoFailed, gone, opacity]);

  if (gone) return null;

  return (
    <Animated.View
      style={[styles.overlay, { opacity }]}
      pointerEvents={videoFailed ? 'none' : 'auto'}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading HealthGraph"
    >
      {videoFailed ? (
        <View style={styles.fallback} />
      ) : (
        <VideoView
          player={player}
          contentFit="cover"
          nativeControls={false}
          style={styles.video}
        />
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 999,
    elevation: 999,
    backgroundColor: '#000',
  },
  video: {
    flex: 1,
  },
  fallback: {
    flex: 1,
    backgroundColor: '#000',
  },
});
