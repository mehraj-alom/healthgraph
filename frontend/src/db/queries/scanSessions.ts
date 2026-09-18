/**
 * scanSessions.ts — Local record of multipage prescription scans.
 *
 * A scan session groups the document pages captured in one scanner run so
 * the Medications screen can show "Review scanned prescription" with per-page
 * status and, once extraction exists, the extracted text to verify against.
 * No server schema involved: sessions are a local organizing concept.
 */

import { getDatabase } from '@/db/connection';

export type ScanSessionStatus =
  | 'capturing'
  | 'uploading'
  | 'awaiting_extraction'
  | 'reviewed';

export interface ScanSession {
  session_id: string;
  patient_id: string;
  kind: string;
  document_ids: string[];
  status: ScanSessionStatus;
  created_at: string;
}

function generateSessionId(): string {
  return (
    'scan-' +
    Date.now().toString(36) +
    '-' +
    Math.random().toString(36).slice(2, 9)
  );
}

function parseDocIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === 'string')
      : [];
  } catch {
    return [];
  }
}

function toSession(row: {
  session_id: string;
  patient_id: string;
  kind: string;
  document_ids: string;
  status: string;
  created_at: string;
}): ScanSession {
  return {
    session_id: row.session_id,
    patient_id: row.patient_id,
    kind: row.kind,
    document_ids: parseDocIds(row.document_ids),
    status: row.status as ScanSessionStatus,
    created_at: row.created_at,
  };
}

/** Start a session when the scanner opens (status 'capturing'). */
export async function createScanSession(
  patientId: string,
  kind = 'prescription',
): Promise<string> {
  const db = await getDatabase();
  const sessionId = generateSessionId();

  await db.runAsync(
    `INSERT INTO scan_sessions (session_id, patient_id, kind, document_ids, status, created_at)
     VALUES (?, ?, ?, ?, 'capturing', datetime('now'))`,
    [sessionId, patientId, kind, JSON.stringify([])],
  );

  return sessionId;
}

/** Append an uploaded page document to the session. */
export async function addScanDocument(
  sessionId: string,
  documentId: string,
): Promise<void> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ document_ids: string }>(
    'SELECT document_ids FROM scan_sessions WHERE session_id = ?',
    [sessionId],
  );
  if (!row) return;

  const ids = parseDocIds(row.document_ids);
  if (!ids.includes(documentId)) ids.push(documentId);

  await db.runAsync(
    'UPDATE scan_sessions SET document_ids = ? WHERE session_id = ?',
    [JSON.stringify(ids), sessionId],
  );
}

/** Move a session along its lifecycle (uploading → awaiting → reviewed). */
export async function setScanStatus(
  sessionId: string,
  status: ScanSessionStatus,
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE scan_sessions SET status = ? WHERE session_id = ?',
    [status, sessionId],
  );
}

/** Sessions for a patient, newest first. */
export async function listScanSessions(
  patientId: string,
): Promise<ScanSession[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{
    session_id: string;
    patient_id: string;
    kind: string;
    document_ids: string;
    status: string;
    created_at: string;
  }>(
    `SELECT session_id, patient_id, kind, document_ids, status, created_at
     FROM scan_sessions WHERE patient_id = ? ORDER BY created_at DESC`,
    [patientId],
  );
  return rows.map(toSession);
}

/** Remove a session record (documents themselves are untouched). */
export async function deleteScanSession(sessionId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM scan_sessions WHERE session_id = ?', [
    sessionId,
  ]);
}
