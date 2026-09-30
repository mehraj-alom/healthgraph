/**
 * prescriptionMeds.ts — review-and-confirm client for scanned prescriptions.
 *
 * The backend extracts one form-ready row per medicine
 * (POST /api/v1/documents/:id/prescription-meds). This module fetches those
 * rows and creates medications from them, so the user confirms or tweaks
 * instead of retyping. Shaped like Medication where the Add form expects it.
 */
import { api } from '@/services/api';
import { getCachedPatientId } from '@/services/patientIdentity';
import { hydrateMedications as dbHydrateMedications } from '@/db/queries/medications';
import type { Medication } from '@/types';

export interface ExtractedMed {
  name: string;
  generic_name: string | null;
  brand_name: string | null;
  strength: string | null;
  strength_unit: string | null;
  dose_amount: number | null;
  dose_unit: string | null;
  route: string | null;
  frequency: string;
  scheduled_times: string[];
  duration_text: string | null;
  start_date: string | null;
  end_date: string | null;
  quantity: string | null;
  refills: string | null;
  purpose: string | null;
  instructions: string | null;
  warnings: string[];
  confidence: number;
  needs_review: boolean;
  review_reasons: string[];
  /** Which scanned document this row came from (for source linkage). */
  source_document_id?: string;
}

export interface PrescriptionMedsResult {
  document_id: string;
  prescriber: string | null;
  prescription_date: string | null;
  pharmacy: string | null;
  medications: ExtractedMed[];
}

export async function fetchPrescriptionMeds(documentId: string): Promise<PrescriptionMedsResult> {
  const body = await api.post<PrescriptionMedsResult>(
    `/api/v1/documents/${documentId}/prescription-meds`,
    {},
  );
  const meds = Array.isArray((body as PrescriptionMedsResult)?.medications)
    ? (body as PrescriptionMedsResult).medications.map((m) => ({ ...m, source_document_id: documentId }))
    : [];
  return { ...(body as PrescriptionMedsResult), medications: meds };
}

export interface CreatedMed {
  medication_id?: string;
  name?: string;
}

/** Create one medication from a confirmed extracted row. */
export async function createMedicationFromExtract(
  med: ExtractedMed,
  opts?: { prescriber?: string | null },
): Promise<CreatedMed> {
  const payload = {
    name: med.name.trim(),
    generic_name: med.generic_name,
    brand_name: med.brand_name,
    strength: med.strength,
    strength_unit: med.strength_unit,
    dose_amount: med.dose_amount,
    dose_unit: med.dose_unit,
    route: med.route,
    frequency: med.frequency,
    scheduled_times: med.scheduled_times.length > 0 ? med.scheduled_times : null,
    start_date: med.start_date,
    end_date: med.end_date,
    purpose: med.purpose,
    instructions: med.instructions,
    prescriber: opts?.prescriber ?? null,
    prn: med.frequency === 'AS_NEEDED',
    reminder_enabled: med.scheduled_times.length > 0 && med.frequency !== 'AS_NEEDED',
    notes: med.warnings.length > 0 ? `Warnings on prescription: ${med.warnings.join('; ')}` : null,
    source_document_id: med.source_document_id ?? null,
  };
  const saved = await api.post<Medication>('/api/v1/medications', payload);
  const patientId = getCachedPatientId();
  if (patientId && saved && typeof saved.medication_id === 'string') {
    await dbHydrateMedications(patientId, [saved]).catch(() => {});
  }
  return saved;
}

export function medSubtitle(med: ExtractedMed): string {
  const dose = [
    med.strength ? `${med.strength}${med.strength_unit ?? ''}` : null,
    med.dose_amount != null ? `${med.dose_amount}${med.dose_unit ? ` ${med.dose_unit}` : ''}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const times = med.scheduled_times.length > 0 ? med.scheduled_times.join(', ') : null;
  return [dose || null, med.frequency.replace(/_/g, ' ').toLowerCase(), times].filter(Boolean).join(' · ');
}
