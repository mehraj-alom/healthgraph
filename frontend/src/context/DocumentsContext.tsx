/**
 * DocumentsContext.tsx — Global document processing manager.
 *
 * PERFORMANCE ARCHITECTURE:
 * - activeProcessing is stored in a useRef, NOT React state.
 * - Only meaningful state transitions (add/remove/terminal) bump a
 *   processingVersion counter, which triggers context re-renders.
 * - 3-second status polls update the ref and notify per-document
 *   subscribers WITHOUT bumping the version counter.
 * - This prevents NavigationContainer, tab screens, and unrelated
 *   components from re-rendering on every poll tick.
 *
 * SUBSCRIPTION MODEL:
 * - Components that need real-time stage updates (e.g. upload screen)
 *   call subscribeStage(docId, callback) and get a cleanup function.
 * - Components that only need coarse-grained updates (e.g. badge,
 *   dashboard) read processingVersion and call getActiveProcessing()
 *   at render time.
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

import { useAuth } from '@/context/AuthContext';
import {
  uploadDocument as apiUpload,
  listDocuments,
  getDocumentExtraction,
  pollDocumentStatus,
} from '@/services/documents';
import type {
  DocumentListItem,
  DocumentExtraction,
} from '@/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProcessingStage =
  | 'idle'
  | 'uploading'
  | 'uploaded'
  | 'processing'
  | 'extracted'
  | 'completed'
  | 'failed'
  | 'failed_triage';

export interface ActiveProcessing {
  documentId: string;
  fileName: string;
  stage: ProcessingStage;
  startedAt: number;
  error?: string;
}

export interface DocumentsContextValue {
  /** All documents for the current patient (newest first). */
  documents: DocumentListItem[];
  documentsLoading: boolean;

  /**
   * Increments only when the processing list is structurally modified
   * (add / terminal / remove). Use as a dependency to re-read from
   * getActiveProcessing() at render time.
   */
  processingVersion: number;

  /** Derived from the ref at render time — true when any entry is non-terminal. */
  isProcessing: boolean;

  /** Read the current processing list from the ref. O(1). */
  getActiveProcessing: () => ActiveProcessing[];

  /**
   * Subscribe to stage transitions for a specific document.
   * Returns an unsubscribe function (use in useEffect cleanup).
   */
  subscribeStage: (
    documentId: string,
    callback: (stage: ProcessingStage) => void,
  ) => () => void;

  /** Upload a new document. Fires-and-forget. */
  uploadAndProcess: (
    file: { uri: string; name: string; type: string },
    onUploaded?: (docId: string) => void,
    onError?: (message: string) => void,
  ) => void;

  /** Refetch the document list. */
  refetchDocuments: () => Promise<void>;

  /** Get extraction data for a specific document. */
  fetchExtraction: (documentId: string) => Promise<DocumentExtraction | null>;

  /** Clear a completed/failed processing entry. */
  dismissProcessing: (documentId: string) => void;

  /** Clear all completed/failed processing entries. */
  dismissAllProcessing: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const stageFromStatus = (status: string): ProcessingStage => {
  switch (status) {
    case 'UPLOADED': return 'uploaded';
    case 'PROCESSING': return 'processing';
    case 'EXTRACTED': return 'extracted';
    case 'COMPLETED': return 'completed';
    case 'FAILED': return 'failed';
    case 'FAILED_TRIAGE': return 'failed_triage';
    default: return 'idle';
  }
};

const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED', 'FAILED_TRIAGE']);

const isTerminal = (stage: ProcessingStage): boolean =>
  stage === 'completed' || stage === 'failed' || stage === 'failed_triage';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const DocumentsContext = createContext<DocumentsContextValue | undefined>(
  undefined,
);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function DocumentsProvider({ children }: { children: ReactNode }) {
  // ---- Auth gate: do not fetch until Firebase session is restored ----
  const { user, loading: authLoading } = useAuth();
  const authReady = !authLoading && user !== null;

  // ---- Documents list (changes rarely, normal React state) ----
  const [documents, setDocuments] = useState<DocumentListItem[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(true);

  // ---- Processing state (ref-based, does NOT cause re-renders) ----
  const activeProcessingRef = useRef<ActiveProcessing[]>([]);

  /**
   * Version counter — only bumped on structural changes to the list
   * (add, terminal transition, remove). This is the ONLY processing-related
   * state that triggers context re-renders.
   */
  const [processingVersion, setProcessingVersion] = useState(0);

  /**
   * Per-document stage subscribers. Components that need real-time
   * stage updates register here. The callback is invoked synchronously
   * when notifyStage fires — it is the caller's responsibility to
   * batch state updates (e.g. via React 18 automatic batching).
   */
  const stageSubscribersRef = useRef<
    Map<string, Set<(s: ProcessingStage) => void>>
  >(new Map());

  // ---- Helpers that mutate the ref + notify ----

  const notifyStage = useCallback(
    (docId: string, stage: ProcessingStage) => {
      const subs = stageSubscribersRef.current.get(docId);
      if (subs) {
        subs.forEach((cb) => {
          try {
            cb(stage);
          } catch (e) {
            console.error('[Documents] Subscriber callback error:', e);
          }
        });
      }
    },
    [],
  );

  const addProcessingEntry = useCallback(
    (entry: ActiveProcessing) => {
      activeProcessingRef.current = [
        ...activeProcessingRef.current,
        entry,
      ];
      setProcessingVersion((v) => v + 1);
    },
    [],
  );

  /** Update a single entry in the ref (does NOT bump version). */
  const updateEntry = useCallback(
    (docId: string, changes: Partial<ActiveProcessing>) => {
      activeProcessingRef.current = activeProcessingRef.current.map((e) =>
        e.documentId === docId ? { ...e, ...changes } : e,
      );
    },
    [],
  );

  /**
   * Mark an entry as terminal. Bumps version so coarse-grained
   * consumers (badge, dashboard) see the change.
   */
  const setEntryTerminal = useCallback(
    (docId: string, stage: ProcessingStage, error?: string) => {
      activeProcessingRef.current = activeProcessingRef.current.map((e) =>
        e.documentId === docId ? { ...e, stage, ...(error ? { error } : {}) } : e,
      );
      setProcessingVersion((v) => v + 1);
      notifyStage(docId, stage);
    },
    [notifyStage],
  );

  const removeEntry = useCallback((docId: string) => {
    activeProcessingRef.current = activeProcessingRef.current.filter(
      (e) => e.documentId !== docId,
    );
    setProcessingVersion((v) => v + 1);
    stageSubscribersRef.current.delete(docId);
  }, []);

  // ---- Fetch document list ----

  const refetchDocuments = useCallback(async () => {
    try {
      setDocumentsLoading(true);
      const docs = await listDocuments();
      setDocuments(docs);
    } catch (err) {
      console.error('[Documents] Failed to fetch documents:', err);
    } finally {
      setDocumentsLoading(false);
    }
  }, []);

  // ---- Initial fetch: only after auth is ready ----
  useEffect(() => {
    if (!authReady) return;
    refetchDocuments();
  }, [authReady, refetchDocuments]);

  // ---- If user signs out, clear document state ----
  useEffect(() => {
    if (authReady) return;
    // Auth not ready (loading or signed out) — clear stale data
    setDocuments([]);
    setDocumentsLoading(true);
  }, [authReady]);

  // ---- Upload and process ----

  const uploadAndProcess = useCallback(
    (
      file: { uri: string; name: string; type: string },
      onUploaded?: (docId: string) => void,
      onError?: (message: string) => void,
    ) => {
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      addProcessingEntry({
        documentId: tempId,
        fileName: file.name,
        stage: 'uploading',
        startedAt: Date.now(),
      });

      // Fire-and-forget — the async block runs independently of any component.
      (async () => {
        let resolvedId: string = tempId; // tracks which ID is current
        try {
          // 1. Upload
          console.log(`[UploadFlow] ▶ Starting upload: ${file.name}`);
          const doc = await apiUpload(file);
          const realId = doc.document_id;
          resolvedId = realId;
          console.log(`[UploadFlow] ✓ Upload succeeded → document_id=${realId}`);
          onUploaded?.(realId);

          // 2. Replace temp entry with real document ID
          activeProcessingRef.current = activeProcessingRef.current.map((e) =>
            e.documentId === tempId
              ? { ...e, documentId: realId, stage: stageFromStatus(doc.status) }
              : e,
          );
          stageSubscribersRef.current.delete(tempId);
          // Bump version so dashboard/badge see the swap
          setProcessingVersion((v) => v + 1);
          notifyStage(realId, stageFromStatus(doc.status));

          // 3. Poll if not already terminal
          if (!TERMINAL_STATUSES.has(doc.status)) {
            let lastStatus: string = doc.status;
            console.log(`[UploadFlow] ▶ Starting poll: status=${doc.status}`);

            await pollDocumentStatus(
              realId,
              (status) => {
                if (status !== lastStatus) {
                  lastStatus = status;
                  const s = stageFromStatus(status);
                  console.log(`[UploadFlow]   Status → ${status}`);
                  // Update ref (no version bump — subscriber-only)
                  updateEntry(realId, { stage: s });
                  notifyStage(realId, s);
                }
              },
              3000,
              120,
            );
          }

          // 4. Mark terminal and refresh list
          const finalStage = stageFromStatus(
            activeProcessingRef.current.find((e) => e.documentId === realId)
              ?.stage ?? 'completed',
          );
          console.log(`[UploadFlow] ★ Processing done: stage=${finalStage}`);
          setEntryTerminal(realId, finalStage);
          await refetchDocuments();
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Upload failed';
          const code = (err as any)?.code ?? 'UNKNOWN';
          console.error(
            `[UploadFlow] ✖ FAILED resolvedId=${resolvedId} code=${code} msg=${msg}`,
            err,
          );
          // Use resolvedId (realId if upload succeeded, tempId if it didn't)
          setEntryTerminal(resolvedId, 'failed', msg);
          onError?.(msg);
        }
      })();
    },
    [addProcessingEntry, updateEntry, setEntryTerminal, notifyStage, refetchDocuments],
  );

  // ---- Fetch extraction data ----

  const fetchExtraction = useCallback(
    async (documentId: string): Promise<DocumentExtraction | null> => {
      try {
        return await getDocumentExtraction(documentId);
      } catch (err) {
        console.error('[Documents] Failed to fetch extraction:', err);
        return null;
      }
    },
    [],
  );

  // ---- Subscribe to per-document stage updates ----

  const subscribeStage = useCallback(
    (
      documentId: string,
      callback: (stage: ProcessingStage) => void,
    ): (() => void) => {
      if (!stageSubscribersRef.current.has(documentId)) {
        stageSubscribersRef.current.set(documentId, new Set());
      }
      stageSubscribersRef.current.get(documentId)!.add(callback);

      return () => {
        stageSubscribersRef.current.get(documentId)?.delete(callback);
      };
    },
    [],
  );

  // ---- Dismiss ----

  const dismissProcessing = useCallback(
    (documentId: string) => {
      removeEntry(documentId);
    },
    [removeEntry],
  );

  const dismissAllProcessing = useCallback(() => {
    const toRemove = activeProcessingRef.current.filter((e) =>
      isTerminal(e.stage),
    );
    activeProcessingRef.current = activeProcessingRef.current.filter(
      (e) => !isTerminal(e.stage),
    );
    setProcessingVersion((v) => v + 1);
    toRemove.forEach((e) => stageSubscribersRef.current.delete(e.documentId));
  }, []);

  // ---- Derived values computed at render time from the ref ----

  const isProcessing = useMemo(
    () => activeProcessingRef.current.some((e) => !isTerminal(e.stage)),
    // Recompute whenever processingVersion or documents change
    [processingVersion, documents],
  );

  const getActiveProcessing = useCallback(
    () => activeProcessingRef.current,
    [],
  );

  // ---- Stable context value ----

  const value: DocumentsContextValue = useMemo(
    () => ({
      documents,
      documentsLoading,
      processingVersion,
      isProcessing,
      getActiveProcessing,
      subscribeStage,
      uploadAndProcess,
      refetchDocuments,
      fetchExtraction,
      dismissProcessing,
      dismissAllProcessing,
    }),
    [
      documents,
      documentsLoading,
      processingVersion,
      isProcessing,
      getActiveProcessing,
      subscribeStage,
      uploadAndProcess,
      refetchDocuments,
      fetchExtraction,
      dismissProcessing,
      dismissAllProcessing,
    ],
  );

  return (
    <DocumentsContext.Provider value={value}>
      {children}
    </DocumentsContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDocuments(): DocumentsContextValue {
  const ctx = useContext(DocumentsContext);
  if (!ctx)
    throw new Error('useDocuments must be used within DocumentsProvider');
  return ctx;
}
