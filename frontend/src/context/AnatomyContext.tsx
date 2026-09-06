/**
 * AnatomyContext.tsx — Background anatomy download manager.
 *
 * The download lifecycle is COMPLETELY owned by this context.
 * No component needs to remain mounted for the download to continue.
 * No component should await downloadGender() — it fires and forgets.
 *
 * Architecture:
 * - downloadGender() fires the download and returns immediately
 * - Progress updates are throttled to avoid re-render storms
 * - All callbacks are ref-stabilized so the context value rarely changes
 * - NavigationContainer children re-render ONLY when meaningful state changes
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  type Gender,
  type DownloadProgress,
  type DownloadState,
  type GenderManifest,
  type InstallRecord,
  getSelectedGender,
  setSelectedGender as persistGender,
  getInstallationStatus,
  downloadAnatomy,
  deleteAnatomy,
} from '@/services/anatomyDownload';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GenderStatus {
  state: DownloadState;
  manifest: GenderManifest | null;
  installRecord: InstallRecord | null;
}

export interface AnatomyContextValue {
  selectedGender: Gender;
  maleStatus: GenderStatus;
  femaleStatus: GenderStatus;
  downloadProgress: DownloadProgress | null;
  downloadError: string | null;
  isReady: boolean;
  isDownloading: boolean;
  selectGender: (gender: Gender) => void;
  /** Fire-and-forget. Do NOT await this from UI handlers. */
  downloadGender: () => void;
  cancelDownload: () => void;
  retryDownload: () => void;
  deleteGender: (gender: Gender) => void;
  refreshStatus: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EMPTY_STATUS: GenderStatus = {
  state: 'NOT_INSTALLED',
  manifest: null,
  installRecord: null,
};

/** Throttle progress UI updates to max once per 200ms to avoid re-render storms */
const PROGRESS_THROTTLE_MS = 200;

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AnatomyContext = createContext<AnatomyContextValue | undefined>(undefined);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AnatomyProvider({ children }: { children: ReactNode }) {
  const [selectedGender, setSelectedGenderState] = useState<Gender>('male');
  const [maleStatus, setMaleStatus] = useState<GenderStatus>(EMPTY_STATUS);
  const [femaleStatus, setFemaleStatus] = useState<GenderStatus>(EMPTY_STATUS);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  // Refs for stable callbacks — these never cause re-renders
  const selectedGenderRef = useRef(selectedGender);
  const isDownloadingRef = useRef(isDownloading);
  const abortRef = useRef<AbortController | null>(null);
  const lastProgressTimeRef = useRef(0);

  // Keep refs in sync with state
  useEffect(() => { selectedGenderRef.current = selectedGender; }, [selectedGender]);
  useEffect(() => { isDownloadingRef.current = isDownloading; }, [isDownloading]);

  // -----------------------------------------------------------------------
  // Hydrate persisted gender on mount
  // -----------------------------------------------------------------------
  useEffect(() => {
    (async () => {
      try {
        const saved = await getSelectedGender();
        if (saved) setSelectedGenderState(saved);
      } catch { /* use default */ }
    })();
  }, []);

  // -----------------------------------------------------------------------
  // Refresh installation status — fire-and-forget on mount, never blocks UI
  // -----------------------------------------------------------------------
  const refreshStatus = useCallback(async () => {
    try {
      const [male, female] = await Promise.all([
        getInstallationStatus('male'),
        getInstallationStatus('female'),
      ]);
      setMaleStatus({ state: male.state, manifest: male.manifest, installRecord: male.installRecord });
      setFemaleStatus({ state: female.state, manifest: female.manifest, installRecord: female.installRecord });
    } catch (err) {
      console.error('[Anatomy] Failed to refresh status:', err);
    }
  }, []);

  // Fire-and-forget: do not block children from rendering
  useEffect(() => { refreshStatus(); }, [refreshStatus]);

  // -----------------------------------------------------------------------
  // Gender selection (persisted)
  // -----------------------------------------------------------------------
  const selectGender = useCallback((gender: Gender) => {
    setSelectedGenderState(gender);
    persistGender(gender).catch(() => {});
  }, []);

  // -----------------------------------------------------------------------
  // Background download — fire-and-forget, completely independent of components
  // -----------------------------------------------------------------------
  const fireDownload = useCallback((gender: Gender) => {
    // Guard: only one download at a time
    if (isDownloadingRef.current) {
      console.log('[AnatomyDownload] Download already in progress, ignoring');
      return;
    }

    console.log(`[AnatomyDownload] START ${gender}`);
    isDownloadingRef.current = true;
    setIsDownloading(true);
    setDownloadError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    // Immediate UI feedback — no delay
    setDownloadProgress({
      totalBytes: 0,
      receivedBytes: 0,
      currentFile: 'Preparing anatomy…',
      fileIndex: 0,
      fileCount: 0,
      percent: 0,
    });

    // The download runs as a detached promise.
    // Nothing awaits it. Nothing blocks on it.
    downloadAnatomy(
      gender,
      (progress) => {
        // Throttle state updates to avoid re-render storms
        const now = Date.now();
        if (now - lastProgressTimeRef.current >= PROGRESS_THROTTLE_MS || progress.percent >= 100) {
          lastProgressTimeRef.current = now;
          console.log(
            `[AnatomyDownload] File ${progress.fileIndex + 1}/${progress.fileCount} ` +
            `${progress.percent}% ${progress.currentFile}`
          );
          setDownloadProgress(progress);
        }
      },
      controller.signal,
    )
      .then(async () => {
        console.log(`[AnatomyDownload] COMPLETE ${gender}`);
        setDownloadProgress((prev) => prev ? { ...prev, percent: 100 } : null);
        await refreshStatus();
      })
      .catch((err: any) => {
        if (err?.message === 'Download cancelled') {
          console.log(`[AnatomyDownload] CANCELLED ${gender}`);
          return;
        }
        console.error(`[AnatomyDownload] FAILED ${gender}:`, err);
        const msg = String(err?.message || err);
        if (msg.includes('LOCAL_STORAGE_ERROR')) {
          setDownloadError('Unable to save anatomy files on this device. Please check available storage space.');
        } else if (msg.includes('NETWORK_ERROR')) {
          setDownloadError('Cannot reach the anatomy server. Please check your network connection and try again.');
        } else {
          setDownloadError('Download interrupted. Please try again.');
        }
      })
      .finally(() => {
        isDownloadingRef.current = false;
        setIsDownloading(false);
        abortRef.current = null;
        // Clear progress after a brief delay so success state is visible
        setTimeout(() => {
          setDownloadProgress(null);
        }, 1200);
      });
  }, [refreshStatus]);

  // -----------------------------------------------------------------------
  // Cancel
  // -----------------------------------------------------------------------
  const cancelDownload = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  // -----------------------------------------------------------------------
  // Retry — re-fire the download for the current gender
  // -----------------------------------------------------------------------
  const retryDownload = useCallback(() => {
    setDownloadError(null);
    fireDownload(selectedGenderRef.current);
  }, [fireDownload]);

  // -----------------------------------------------------------------------
  // Delete a specific gender's package
  // -----------------------------------------------------------------------
  const deleteGender = useCallback(async (gender: Gender) => {
    try {
      await deleteAnatomy(gender);
      await refreshStatus();
    } catch (err) {
      console.error('[Anatomy] Delete failed:', err);
    }
  }, [refreshStatus]);

  // -----------------------------------------------------------------------
  // Derived state
  // -----------------------------------------------------------------------
  const currentStatus = selectedGender === 'male' ? maleStatus : femaleStatus;
  const isReady = currentStatus.state === 'INSTALLED';

  // -----------------------------------------------------------------------
  // Stable context value — only changes when meaningful state changes
  // -----------------------------------------------------------------------
  const value: AnatomyContextValue = useMemo(() => ({
    selectedGender,
    maleStatus,
    femaleStatus,
    downloadProgress,
    downloadError,
    isReady,
    isDownloading,
    selectGender,
    downloadGender: () => fireDownload(selectedGenderRef.current),
    cancelDownload,
    retryDownload,
    deleteGender,
    refreshStatus,
  }), [
    selectedGender,
    maleStatus,
    femaleStatus,
    downloadProgress,
    downloadError,
    isReady,
    isDownloading,
    selectGender,
    fireDownload,
    cancelDownload,
    retryDownload,
    deleteGender,
    refreshStatus,
  ]);

  return (
    <AnatomyContext.Provider value={value}>
      {children}
    </AnatomyContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAnatomy(): AnatomyContextValue {
  const ctx = useContext(AnatomyContext);
  if (!ctx) throw new Error('useAnatomy must be used within AnatomyProvider');
  return ctx;
}
