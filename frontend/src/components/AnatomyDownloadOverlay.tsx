/**
 * AnatomyDownloadOverlay.tsx — Premium glass overlay for 3D anatomy download.
 *
 * States:
 * 1. SELECTION — gender picker + download button
 * 2. DOWNLOADING — full progress UI with cancel
 * 3. SUCCESS — brief checkmark, then fades out
 * 4. ERROR — error message with retry
 * 5. Hidden — when installed (returns null)
 *
 * Positioned inside the Body screen's canvas container, NOT over the
 * NavigationContainer. Tab navigation remains fully functional.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  Animated,
  ActivityIndicator,
} from 'react-native';
import { useAnatomy } from '@/context/AnatomyContext';
import { type Gender, formatBytes } from '@/services/anatomyDownload';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AnatomyDownloadOverlay() {
  const {
    selectedGender,
    maleStatus,
    femaleStatus,
    downloadProgress,
    downloadError,
    isReady,
    isDownloading,
    selectGender,
    downloadGender,
    cancelDownload,
    retryDownload,
  } = useAnatomy();

  const fadeAnim = useRef(new Animated.Value(1)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Pulse animation for progress indicator
  useEffect(() => {
    if (isDownloading) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.08, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1.0, duration: 800, useNativeDriver: true }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isDownloading, pulseAnim]);

  // Fade out when ready
  useEffect(() => {
    if (isReady) {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 500,
        useNativeDriver: true,
      }).start();
    } else {
      fadeAnim.setValue(1);
    }
  }, [isReady, fadeAnim]);

  if (isReady) return null;

  const genderLabel = selectedGender === 'male' ? 'Male' : 'Female';
  const approxSize =
    selectedGender === 'male'
      ? maleStatus.manifest?.models.reduce((s, m) => s + m.size, 0)
      : femaleStatus.manifest?.models.reduce((s, m) => s + m.size, 0);
  const fileCount =
    selectedGender === 'male'
      ? maleStatus.manifest?.models.length ?? 0
      : femaleStatus.manifest?.models.length ?? 0;

  // ── STATE: DOWNLOADING ──────────────────────────────────────────────
  if (isDownloading) {
    const percent = downloadProgress?.percent ?? 0;
    const received = downloadProgress?.receivedBytes ?? 0;
    const total = downloadProgress?.totalBytes ?? 0;
    const currentFile = downloadProgress?.currentFile ?? 'Preparing…';
    const fileIndex = downloadProgress?.fileIndex ?? 0;
    const fileCountDL = downloadProgress?.fileCount ?? 0;

    return (
      <Animated.View style={[styles.overlay, { opacity: fadeAnim }]} pointerEvents="auto">
        <Animated.View style={[styles.card, { transform: [{ scale: pulseAnim }] }]}>
          {/* Title */}
          <Text style={styles.progressTitle}>Downloading {genderLabel} Anatomy</Text>

          {/* Large percentage */}
          <Text style={styles.progressPercent}>{percent}%</Text>

          {/* Progress bar */}
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.max(percent, 1)}%` }]} />
          </View>

          {/* MB counter */}
          <Text style={styles.progressBytes}>
            {total > 0 ? `${formatBytes(received)} / ${formatBytes(total)}` : 'Starting…'}
          </Text>

          {/* Current file */}
          <Text style={styles.progressFile}>
            {currentFile.replace(/_/g, ' ').replace('.glb', '')}
          </Text>

          {/* File number */}
          {fileCountDL > 0 && (
            <Text style={styles.progressFileCount}>
              File {fileIndex + 1} of {fileCountDL}
            </Text>
          )}

          {/* Cancel button */}
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={cancelDownload}
            activeOpacity={0.7}
          >
            <Text style={styles.cancelButtonText}>Cancel Download</Text>
          </TouchableOpacity>
        </Animated.View>
      </Animated.View>
    );
  }

  // ── STATE: ERROR ────────────────────────────────────────────────────
  if (downloadError) {
    return (
      <Animated.View style={[styles.overlay, { opacity: fadeAnim }]} pointerEvents="auto">
        <View style={styles.card}>
          <Text style={styles.errorIcon}>⚠</Text>
          <Text style={styles.errorTitle}>Download Interrupted</Text>
          <Text style={styles.errorMessage}>{downloadError}</Text>
          <View style={styles.errorButtonRow}>
            <TouchableOpacity
              style={styles.retryButton}
              onPress={retryDownload}
              activeOpacity={0.8}
            >
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => {}}
              activeOpacity={0.7}
            >
              <Text style={styles.cancelButtonText}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Animated.View>
    );
  }

  // ── STATE: SELECTION (default) ──────────────────────────────────────
  return (
    <Animated.View style={[styles.overlay, { opacity: fadeAnim }]} pointerEvents="auto">
      <View style={styles.card}>
        {/* Title */}
        <Text style={styles.title}>3D Anatomy</Text>
        <Text style={styles.subtitle}>Choose your anatomy</Text>

        {/* Gender selector */}
        <View style={styles.genderRow}>
          <TouchableOpacity
            style={[
              styles.genderButton,
              selectedGender === 'male' && styles.genderButtonActive,
            ]}
            onPress={() => selectGender('male')}
            disabled={isDownloading}
          >
            <Text
              style={[
                styles.genderButtonText,
                selectedGender === 'male' && styles.genderButtonTextActive,
              ]}
            >
              Male
            </Text>
            {maleStatus.state === 'INSTALLED' && (
              <Text style={styles.installedBadge}>✓</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.genderButton,
              selectedGender === 'female' && styles.genderButtonActive,
            ]}
            onPress={() => selectGender('female')}
            disabled={isDownloading}
          >
            <Text
              style={[
                styles.genderButtonText,
                selectedGender === 'female' && styles.genderButtonTextActive,
              ]}
            >
              Female
            </Text>
            {femaleStatus.state === 'INSTALLED' && (
              <Text style={styles.installedBadge}>✓</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Package info */}
        <Text style={styles.packageName}>{genderLabel} Anatomy</Text>
        <Text style={styles.packageSize}>
          {approxSize ? formatBytes(approxSize) : '…'}
        </Text>

        {/* Download button */}
        <TouchableOpacity
          style={styles.downloadButton}
          onPress={downloadGender}
          disabled={isDownloading}
          activeOpacity={0.8}
        >
          <Text style={styles.downloadButtonText}>↓ Download 3D Anatomy</Text>
        </TouchableOpacity>

        <Text style={styles.hint}>
          One-time download · Available offline
        </Text>
      </View>
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Not-installed prompt for gender switch (used inside BodyScreen)
// ---------------------------------------------------------------------------

interface NotInstalledPromptProps {
  gender: Gender;
  onDownload: () => void;
  onCancel: () => void;
  isDownloading: boolean;
}

export function NotInstalledPrompt({ gender, onDownload, onCancel, isDownloading }: NotInstalledPromptProps) {
  const label = gender === 'male' ? 'Male' : 'Female';
  return (
    <View style={styles.miniOverlay}>
      <View style={styles.miniCard}>
        <Text style={styles.miniTitle}>{label} Anatomy isn't downloaded yet.</Text>
        <View style={styles.miniButtonRow}>
          <TouchableOpacity style={styles.miniCancelButton} onPress={onCancel}>
            <Text style={styles.miniCancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.miniDownloadButton, isDownloading && styles.downloadButtonDisabled]}
            onPress={onDownload}
            disabled={isDownloading}
          >
            {isDownloading ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={styles.miniDownloadText}>Download {label} Anatomy</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(7, 17, 31, 0.92)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    zIndex: 100,
  },
  card: {
    backgroundColor: '#2A3049',
    borderRadius: 8,
    padding: 20,
    width: SCREEN_WIDTH - 48,
    maxWidth: 380,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
  },

  // ── Selection UI ──
  title: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '600',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: '#A7B8B2',
    textAlign: 'center',
    marginBottom: 16,
  },
  genderRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  genderButton: {
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 9999,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  genderButtonActive: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFFFF',
  },
  genderButtonText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.75)',
  },
  genderButtonTextActive: {
    color: '#080A11',
  },
  installedBadge: {
    fontSize: 14,
    color: '#4FD1C5',
    fontWeight: '700',
  },
  packageName: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  packageSize: {
    fontSize: 13,
    lineHeight: 18,
    color: '#A7B8B2',
    fontVariant: ['tabular-nums'],
    marginBottom: 16,
  },
  downloadButton: {
    backgroundColor: '#FFFFFF',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 9999,
    width: '100%',
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  downloadButtonDisabled: {
    opacity: 0.7,
  },
  downloadButtonText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    color: '#080A11',
  },
  hint: {
    fontSize: 13,
    lineHeight: 18,
    color: '#A7B8B2',
    textAlign: 'center',
  },

  // ── Progress UI ──
  progressTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 12,
  },
  progressPercent: {
    fontSize: 48,
    lineHeight: 52,
    fontWeight: '700',
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
    marginBottom: 12,
  },
  progressTrack: {
    width: '100%',
    height: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 4,
  },
  progressBytes: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.8)',
    fontVariant: ['tabular-nums'],
    marginBottom: 2,
  },
  progressFile: {
    fontSize: 13,
    lineHeight: 18,
    color: '#A7B8B2',
    textTransform: 'capitalize',
    marginBottom: 2,
  },
  progressFileCount: {
    fontSize: 13,
    lineHeight: 18,
    color: '#A7B8B2',
    marginBottom: 12,
  },

  // ── Cancel ──
  cancelButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    backgroundColor: 'transparent',
    marginTop: 8,
  },
  cancelButtonText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    color: '#FFFFFF',
  },

  // ── Error UI ──
  errorIcon: {
    fontSize: 36,
    marginBottom: 8,
  },
  errorTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 8,
  },
  errorMessage: {
    fontSize: 15,
    lineHeight: 22,
    color: '#A7B8B2',
    textAlign: 'center',
    marginBottom: 16,
  },
  errorButtonRow: {
    flexDirection: 'row',
    gap: 8,
    width: '100%',
  },
  retryButton: {
    flex: 2,
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 9999,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
  },
  retryButtonText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    color: '#080A11',
  },

  // ── Mini prompt (gender switch) ──
  miniOverlay: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(7, 17, 31, 0.90)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    zIndex: 100,
  },
  miniCard: {
    backgroundColor: '#2A3049',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    padding: 16,
    width: SCREEN_WIDTH - 48,
    maxWidth: 340,
    alignItems: 'center',
  },
  miniTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 12,
  },
  miniButtonRow: {
    flexDirection: 'row',
    gap: 8,
  },
  miniCancelButton: {
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    backgroundColor: 'transparent',
    alignItems: 'center',
  },
  miniCancelText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  miniDownloadButton: {
    flex: 2,
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 9999,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
  },
  miniDownloadText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    color: '#080A11',
  },
});
