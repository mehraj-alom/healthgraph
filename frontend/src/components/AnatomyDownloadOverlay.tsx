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
import { COLORS, SPACING, BORDER_RADIUS, SHADOWS, TYPOGRAPHY } from '@/constants';
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
    backgroundColor: 'rgba(247, 249, 248, 0.92)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    zIndex: 100,
  },
  card: {
    backgroundColor: 'rgba(255, 255, 255, 0.88)',
    borderRadius: BORDER_RADIUS.xl,
    padding: SPACING.xl,
    width: SCREEN_WIDTH - SPACING.xl * 2,
    maxWidth: 380,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(219, 229, 225, 0.6)',
    ...SHADOWS.lg,
  },

  // ── Selection UI ──
  title: {
    ...TYPOGRAPHY.h1,
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  subtitle: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
    marginBottom: SPACING.lg,
  },
  genderRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  genderButton: {
    flex: 1,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.lg,
    backgroundColor: COLORS.surface,
    borderWidth: 2,
    borderColor: COLORS.border,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  genderButtonActive: {
    backgroundColor: COLORS.primaryBg,
    borderColor: COLORS.primary,
  },
  genderButtonText: {
    ...TYPOGRAPHY.bodyStrong,
    color: COLORS.textSecondary,
  },
  genderButtonTextActive: {
    color: COLORS.primary,
  },
  installedBadge: {
    fontSize: 14,
    color: COLORS.success,
    fontWeight: '700',
  },
  packageName: {
    ...TYPOGRAPHY.bodyStrong,
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  packageSize: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
    marginBottom: SPACING.lg,
  },
  downloadButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.xl,
    borderRadius: BORDER_RADIUS.lg,
    width: '100%',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  downloadButtonDisabled: {
    opacity: 0.7,
  },
  downloadButtonText: {
    ...TYPOGRAPHY.bodyStrong,
    color: '#ffffff',
  },
  hint: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
    textAlign: 'center',
  },

  // ── Progress UI ──
  progressTitle: {
    ...TYPOGRAPHY.h3,
    color: COLORS.textPrimary,
    marginBottom: SPACING.lg,
  },
  progressPercent: {
    fontSize: 48,
    fontWeight: '700',
    color: COLORS.primary,
    marginBottom: SPACING.md,
  },
  progressTrack: {
    width: '100%',
    height: 10,
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: 5,
    overflow: 'hidden',
    marginBottom: SPACING.sm,
  },
  progressFill: {
    height: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 5,
  },
  progressBytes: {
    ...TYPOGRAPHY.bodyStrong,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xs,
  },
  progressFile: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
    textTransform: 'capitalize',
    marginBottom: 2,
  },
  progressFileCount: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
    marginBottom: SPACING.md,
  },

  // ── Cancel ──
  cancelButton: {
    paddingVertical: SPACING.sm + 2,
    paddingHorizontal: SPACING.lg,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    marginTop: SPACING.sm,
  },
  cancelButtonText: {
    ...TYPOGRAPHY.bodyStrong,
    color: COLORS.textSecondary,
  },

  // ── Error UI ──
  errorIcon: {
    fontSize: 36,
    marginBottom: SPACING.sm,
  },
  errorTitle: {
    ...TYPOGRAPHY.h3,
    color: COLORS.textPrimary,
    marginBottom: SPACING.sm,
  },
  errorMessage: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: SPACING.lg,
    lineHeight: 22,
  },
  errorButtonRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    width: '100%',
  },
  retryButton: {
    flex: 2,
    paddingVertical: SPACING.sm + 2,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
  },
  retryButtonText: {
    ...TYPOGRAPHY.bodyStrong,
    color: '#ffffff',
  },

  // ── Mini prompt (gender switch) ──
  miniOverlay: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(247, 249, 248, 0.90)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    zIndex: 100,
  },
  miniCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    width: SCREEN_WIDTH - SPACING.xl * 2,
    maxWidth: 340,
    alignItems: 'center',
    ...SHADOWS.md,
  },
  miniTitle: {
    ...TYPOGRAPHY.bodyStrong,
    color: COLORS.textPrimary,
    textAlign: 'center',
    marginBottom: SPACING.md,
  },
  miniButtonRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  miniCancelButton: {
    flex: 1,
    paddingVertical: SPACING.sm + 2,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.surfaceElevated,
    alignItems: 'center',
  },
  miniCancelText: {
    ...TYPOGRAPHY.bodyStrong,
    color: COLORS.textSecondary,
  },
  miniDownloadButton: {
    flex: 2,
    paddingVertical: SPACING.sm + 2,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
  },
  miniDownloadText: {
    ...TYPOGRAPHY.bodyStrong,
    color: '#ffffff',
  },
});
