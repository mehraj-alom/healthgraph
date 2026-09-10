/**
 * Local-first repository for document metadata.
 *
 * Strategy:
 *   - Document metadata is cached in SQLite for offline display.
 *   - Binary files (PDF, images) remain on the server.
 *   - URLs are local filesystem paths (no expiration).
 *   - No delete support exists in the backend.
 *   - Upload remains online-only (binary cannot be uploaded offline).
 *   - After successful upload, metadata is stored in SQLite.
 *
 * Maps to:
 *   - models/events.py Document
 *   - frontend/src/types/index.ts DocumentListItem
 */

import type { SQLiteDatabase } from 'expo-sqlite';
import { getDatabase } from '../connection';
import type { DocumentListItem, DocumentStatus } from '@/types';

// ============================================================================
// READ
// ============================================================================

/**
 * Get all documents for a patient.
 * Returns from local SQLite. Caller should hydrate from server if needed.
 */
export async function getDocuments(
  patientId: string,
  options?: { limit?: number; offset?: number },
): Promise<DocumentListItem[]> {
  const db = await getDatabase();

  let query = `
    SELECT
      document_id,
      patient_id,
      file_hash,
      storage_url,
      status,
      created_at,
      updated_at
    FROM documents
    WHERE patient_id = ?
  `;
  const params: any[] = [patientId];

  query += ` ORDER BY created_at DESC`;

  if (options?.limit) {
    query += ` LIMIT ?`;
    params.push(options.limit);
  }

  if (options?.offset) {
    query += ` OFFSET ?`;
    params.push(options.offset);
  }

  const rows = await db.getAllAsync<{
    document_id: string;
    patient_id: string;
    file_hash: string;
    storage_url: string;
    status: string;
    created_at: string;
    updated_at: string;
  }>(query, params);

  return rows.map(mapRowToDocumentListItem);
}

/**
 * Get a single document by ID.
 */
export async function getDocumentById(
  patientId: string,
  documentId: string,
): Promise<DocumentListItem | null> {
  const db = await getDatabase();

  const row = await db.getFirstAsync<{
    document_id: string;
    patient_id: string;
    file_hash: string;
    storage_url: string;
    status: string;
    created_at: string;
    updated_at: string;
  }>(
    `
    SELECT
      document_id,
      patient_id,
      file_hash,
      storage_url,
      status,
      created_at,
      updated_at
    FROM documents
    WHERE patient_id = ? AND document_id = ?
    `,
    [patientId, documentId],
  );

  return row ? mapRowToDocumentListItem(row) : null;
}

/**
 * Get documents by status.
 */
export async function getDocumentsByStatus(
  patientId: string,
  status: DocumentStatus,
): Promise<DocumentListItem[]> {
  const db = await getDatabase();

  const rows = await db.getAllAsync<{
    document_id: string;
    patient_id: string;
    file_hash: string;
    storage_url: string;
    status: string;
    created_at: string;
    updated_at: string;
  }>(
    `
    SELECT
      document_id,
      patient_id,
      file_hash,
      storage_url,
      status,
      created_at,
      updated_at
    FROM documents
    WHERE patient_id = ? AND status = ?
    ORDER BY created_at DESC
    `,
    [patientId, status],
  );

  return rows.map(mapRowToDocumentListItem);
}

// ============================================================================
// WRITE — Metadata Only
// ============================================================================

/**
 * Upsert document metadata after successful server upload.
 * Used when upload completes and we want to cache the metadata locally.
 */
export async function upsertDocument(
  patientId: string,
  document: {
    document_id: string;
    file_hash: string;
    storage_url: string;
    status: string;
    created_at: string;
    updated_at?: string;
  },
): Promise<void> {
  const db = await getDatabase();

  // The server DocumentResponse does not include updated_at, so fall back to
  // created_at for the NOT NULL column rather than inserting undefined/NULL.
  const updatedAt = document.updated_at ?? document.created_at;

  await db.runAsync(
    `
    INSERT INTO documents (
      document_id, patient_id, file_hash, storage_url,
      status, created_at, updated_at, cached_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(document_id) DO UPDATE SET
      patient_id = excluded.patient_id,
      file_hash = excluded.file_hash,
      storage_url = excluded.storage_url,
      status = excluded.status,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      cached_at = datetime('now')
    `,
    [
      document.document_id,
      patientId,
      document.file_hash,
      document.storage_url,
      document.status,
      document.created_at,
      updatedAt,
    ],
  );
}

/**
 * Update document status after processing completes.
 */
export async function updateDocumentStatus(
  patientId: string,
  documentId: string,
  status: string,
): Promise<void> {
  const db = await getDatabase();

  await db.runAsync(
    `
    UPDATE documents
    SET status = ?, updated_at = datetime('now'), cached_at = datetime('now')
    WHERE patient_id = ? AND document_id = ?
    `,
    [status, patientId, documentId],
  );
}

// ============================================================================
// HYDRATION — Server → Local
// ============================================================================

/**
 * Hydrate document metadata from server response.
 *
 * Rules:
 *   - Server documents enter as synced data.
 *   - Always overwrite (document metadata is read-only from frontend).
 *   - Repeated hydration is idempotent.
 *   - Binary files are NOT downloaded.
 */
export async function hydrateDocuments(
  patientId: string,
  serverDocuments: Array<{
    document_id: string;
    patient_id?: string;
    file_hash: string;
    storage_url: string;
    status: string;
    created_at: string;
    updated_at?: string;
  }>,
): Promise<void> {
  const db = await getDatabase();

  await db.withTransactionAsync(async () => {
    for (const doc of serverDocuments) {
      // The server DocumentResponse does not include updated_at, so fall back
      // to created_at for the NOT NULL column rather than inserting NULL.
      const updatedAt = doc.updated_at ?? doc.created_at;

      await db.runAsync(
        `
        INSERT INTO documents (
          document_id, patient_id, file_hash, storage_url,
          status, created_at, updated_at, cached_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(document_id) DO UPDATE SET
          patient_id = excluded.patient_id,
          file_hash = excluded.file_hash,
          storage_url = excluded.storage_url,
          status = excluded.status,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          cached_at = datetime('now')
        `,
        [
          doc.document_id,
          patientId,
          doc.file_hash,
          doc.storage_url,
          doc.status,
          doc.created_at,
          updatedAt,
        ],
      );
    }
  });
}

// ============================================================================
// INTERNAL — Row Mappers
// ============================================================================

function mapRowToDocumentListItem(row: {
  document_id: string;
  patient_id: string;
  file_hash: string;
  storage_url: string;
  status: string;
  created_at: string;
  updated_at: string;
}): DocumentListItem {
  return {
    document_id: row.document_id,
    patient_id: row.patient_id,
    file_hash: row.file_hash,
    storage_url: row.storage_url,
    status: row.status as DocumentStatus,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
