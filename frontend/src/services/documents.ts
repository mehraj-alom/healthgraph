import * as FileSystem from 'expo-file-system/legacy';

import { api, getApiBaseUrl } from '@/services/api';
import { auth } from '@/context/AuthContext';
import { UPLOAD_TIMEOUT_MS } from './uploadPolicy';
import type {
  DocumentListItem,
  DocumentExtraction,
  ProvenanceResponse,
} from '@/types';

/**
 * Upload a medical document (PDF, PNG, JPG, JPEG).
 * Returns the created document record.
 */
export async function uploadDocument(
  file: { uri: string; name: string; type: string },
  options?: {
    /** Per-request timeout ms. Body upload on mobile uplinks is slow:
     *  the shared 120s default trips on multi-MB PDFs. Default 10 min. */
    timeoutMs?: number;
    /** 0..1 upload progress for live UI. Called on upload events only. */
    onProgress?: (fraction: number) => void;
  },
): Promise<DocumentListItem> {
  if (__DEV__) console.log(`[Upload] ▶ POST /api/v1/documents/upload name=${file.name} type=${file.type}`);
  const formData = new FormData();
  formData.append('file', {
    uri: file.uri,
    name: file.name,
    type: file.type,
  } as unknown as Blob);

  // Do NOT set Content-Type manually — Axios must generate the multipart
  // boundary automatically. A manual "multipart/form-data" without the
  // boundary causes FastAPI to reject the body and the connection to drop.
  const response = await api.getClient().post<DocumentListItem>(
    '/api/v1/documents/upload',
    formData,
    {
      timeout: options?.timeoutMs ?? UPLOAD_TIMEOUT_MS,
      onUploadProgress: options?.onProgress
        ? (event) => {
            const total = event.total ?? 0;
            if (total > 0) {
              options.onProgress?.(Math.min(1, Math.max(0, event.loaded / total)));
            }
          }
        : undefined,
    },
  );

  const doc = response.data;
  if (__DEV__) console.log(
    `[Upload] ✓ 201 document_id=${doc.document_id} status=${doc.status}`,
  );
  return doc;
}

/**
 * Upload retry/reconcile policy. Single source of truth lives in
 * uploadPolicy (dependency-free, unit tested); re-exported here so call
 * sites keep one import.
 */
export {
  isRetriableUploadError,
  matchRecentUpload,
  UPLOAD_TIMEOUT_MS,
  UPLOAD_MAX_ATTEMPTS,
  RECONCILE_MAX_AGE_MS,
} from './uploadPolicy';
export type { RecentUploadCandidate } from './uploadPolicy';

/**
 * List all documents for the authenticated patient (newest first).
 */
export async function listDocuments(): Promise<DocumentListItem[]> {
  return api.get<DocumentListItem[]>('/api/v1/documents');
}

/**
 * Get a single document by ID.
 */
export async function getDocument(
  documentId: string,
): Promise<DocumentListItem> {
  if (__DEV__) console.log(`[Poll]   ▶ GET /api/v1/documents/${documentId}`);
  const doc = await api.get<DocumentListItem>(
    `/api/v1/documents/${documentId}`,
  );
  if (__DEV__) console.log(`[Poll]   ✓ status=${doc.status} id=${doc.document_id}`);
  return doc;
}

/**
 * Get the raw extraction data for a document (for review/detail views).
 */
export async function getDocumentExtraction(
  documentId: string,
): Promise<DocumentExtraction> {
  return api.get<DocumentExtraction>(
    `/api/v1/documents/${documentId}/extraction`,
  );
}

/**
 * Get provenance (source document + evidence) for a clinical event.
 */
export async function getEventProvenance(
  eventId: string,
): Promise<ProvenanceResponse> {
  return api.get<ProvenanceResponse>(
    `/api/v1/events/${eventId}/provenance`,
  );
}

/**
 * Poll document status until it reaches a terminal state.
 * Returns the final document record.
 */
export async function pollDocumentStatus(
  documentId: string,
  onStatusChange?: (status: string) => void,
  intervalMs = 3000,
  maxAttempts = 120,
): Promise<DocumentListItem> {
  const terminalStatuses = new Set([
    'COMPLETED',
    'FAILED',
    'FAILED_TRIAGE',
  ]);

  if (__DEV__) console.log(
    `[Poll]   Start polling documentId=${documentId} interval=${intervalMs}ms maxAttempts=${maxAttempts}`,
  );

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const doc = await getDocument(documentId);
      if (__DEV__) console.log(
        `[Poll]   attempt=${attempt + 1}/${maxAttempts} status=${doc.status}`,
      );
      onStatusChange?.(doc.status);

      if (terminalStatuses.has(doc.status)) {
        if (__DEV__) console.log(`[Poll]   ★ Terminal reached: ${doc.status}`);
        return doc;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const code = (err as any)?.code ?? 'UNKNOWN';
      console.warn(
        `[Poll]   attempt=${attempt + 1}/${maxAttempts} FAILED code=${code} msg=${msg}`,
      );
      // Transient network errors: log and continue polling.
      // Only throw on non-network errors (e.g. 404 means document gone).
      const status = (err as any)?.response?.status;
      if (status && status >= 400 && status < 600) {
        console.error(`[Poll]   ✖ Non-retryable HTTP ${status} — aborting poll`);
        throw err;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  console.warn(`[Poll]   ⚠ Max attempts (${maxAttempts}) reached — returning last known state`);
  // Return whatever we have after max attempts
  return getDocument(documentId);
}

/**
 * Offline file cache — download the original document bytes once, then open
 * from disk forever. Files live under the app's document directory so the
 * user can view reports with no connectivity.
 */
const DOC_CACHE_SUBDIR = 'documents/';

async function ensureDocCacheDir(): Promise<string> {
  const base = FileSystem.documentDirectory;
  if (!base) {
    throw new Error('On-device file storage is not available on this platform.');
  }
  const dir = `${base}${DOC_CACHE_SUBDIR}`;
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  return dir;
}

function safeCacheName(documentId: string, hint?: string | null): string {
  const clean = (hint ?? 'document').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'document';
  return `${documentId}-${clean}`;
}

/**
 * Check whether a cached file still exists on disk. Cached paths can go
 * stale (OS cleanup, reinstall) — always verify before opening.
 */
export async function cachedFileExists(localUri: string | null | undefined): Promise<boolean> {
  if (!localUri) return false;
  try {
    const info = await FileSystem.getInfoAsync(localUri);
    return info.exists;
  } catch {
    return false;
  }
}

/**
 * Download the original file for a document into the on-device cache.
 * Returns the local URI. Throws on auth/network errors (caller shows UI).
 */
export async function downloadDocumentFile(
  documentId: string,
  filenameHint?: string | null,
): Promise<string> {
  const dir = await ensureDocCacheDir();
  const target = `${dir}${safeCacheName(documentId, filenameHint)}`;

  const currentUser = auth.currentUser;
  const token = currentUser ? await currentUser.getIdToken() : null;

  const result = await FileSystem.downloadAsync(
    `${getApiBaseUrl()}/api/v1/documents/${documentId}/file`,
    target,
    token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
  );
  if (result.status !== 200) {
    throw new Error('The file could not be downloaded. Please try again.');
  }
  return result.uri;
}

/**
 * Copy an already-on-device file (e.g. freshly picked for upload) into the
 * persistent cache dir. Cheaper than re-downloading after upload.
 */
export async function cacheLocalCopy(
  documentId: string,
  sourceUri: string,
  filenameHint?: string | null,
): Promise<string> {
  const dir = await ensureDocCacheDir();
  const target = `${dir}${safeCacheName(documentId, filenameHint)}`;
  await FileSystem.copyAsync({ from: sourceUri, to: target });
  return target;
}

/**
 * Format file size for display.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Canonical document-status interpretation — the single source of truth
 * every screen must use so status never disagrees between views.
 *
 * - Processing: genuinely non-terminal backend states. EXTRACTED counts:
 *   the raw extraction committed but de-identification, vector indexing,
 *   timeline mapping and anatomical recording may still be running.
 * - Complete: ONLY backend-reported COMPLETED. Never claim success earlier.
 * - Failed: ONLY backend-reported FAILED / FAILED_TRIAGE. Transient
 *   client/network trouble must never render as failed.
 */
export function isDocumentProcessing(status: string): boolean {
  return status === 'UPLOADED' || status === 'PROCESSING' || status === 'EXTRACTED';
}

export function isDocumentComplete(status: string): boolean {
  return status === 'COMPLETED';
}

export function isDocumentFailed(status: string): boolean {
  return status === 'FAILED' || status === 'FAILED_TRIAGE';
}

/**
 * Map document status to a human-readable label.
 */
export function statusLabel(status: string): string {  switch (status) {
    case 'UPLOADED':
      return 'Uploaded';
    case 'PROCESSING':
      return 'Processing';
    case 'EXTRACTED':
      return 'Extracted';
    case 'COMPLETED':
      return 'Processed';
    case 'FAILED':
      return 'Failed';
    case 'FAILED_TRIAGE':
      return 'Not a medical document';
    default:
      return status;
  }
}

/**
 * Map document type from gateway to a display label.
 */
export function documentTypeLabel(type: string): string {
  switch (type) {
    case 'LAB_REPORT':
      return 'Lab Report';
    case 'PRESCRIPTION':
      return 'Prescription';
    case 'DISCHARGE':
      return 'Discharge Summary';
    case 'IMAGING':
      return 'Imaging Report';
    case 'JUNK':
      return 'Non-medical';
    default:
      return 'Medical Document';
  }
}
