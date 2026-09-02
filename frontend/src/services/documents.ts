import { api } from '@/services/api';
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
): Promise<DocumentListItem> {
  console.log(`[Upload] ▶ POST /api/v1/documents/upload name=${file.name} type=${file.type}`);
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
      timeout: 120000,
    },
  );

  const doc = response.data;
  console.log(
    `[Upload] ✓ 201 document_id=${doc.document_id} status=${doc.status}`,
  );
  return doc;
}

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
  console.log(`[Poll]   ▶ GET /api/v1/documents/${documentId}`);
  const doc = await api.get<DocumentListItem>(
    `/api/v1/documents/${documentId}`,
  );
  console.log(`[Poll]   ✓ status=${doc.status} id=${doc.document_id}`);
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

  console.log(
    `[Poll]   Start polling documentId=${documentId} interval=${intervalMs}ms maxAttempts=${maxAttempts}`,
  );

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const doc = await getDocument(documentId);
      console.log(
        `[Poll]   attempt=${attempt + 1}/${maxAttempts} status=${doc.status}`,
      );
      onStatusChange?.(doc.status);

      if (terminalStatuses.has(doc.status)) {
        console.log(`[Poll]   ★ Terminal reached: ${doc.status}`);
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
 * Format file size for display.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Map document status to a human-readable label.
 */
export function statusLabel(status: string): string {
  switch (status) {
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
