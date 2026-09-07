import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { getCachedPatientId } from '@/services/patientIdentity';
import { api } from '@/services/api';
import {
  getMedications as dbGetMedications,
  getActiveMedicationsForDailyLog as dbGetActiveMedicationsForDailyLog,
  hydrateMedications as dbHydrateMedications,
} from '@/db/queries/medications';
import {
  getMedicationTakenEvents as dbGetTakenEvents,
  getMedicationTakenEventsForDate as dbGetTakenEventsForDate,
  insertMedicationTakenEvent as dbInsertTakenEvent,
  reconcileTakenEvent as dbReconcileTakenEvent,
  hydrateTakenEvents as dbHydrateTakenEvents,
  areTakenEventsHydrated,
  markTakenEventsHydrated,
  computeLocalSchedule,
} from '@/db/queries/medicationTakenEvents';
import type {
  Medication,
  MedicationStatus,
  MedicationTakenEvent,
  ActiveMedicationForDailyLog,
  DailyMedicationSchedule,
  DoseTakenStatus,
} from '@/types';

// ─── useMedications ──────────────────────────────────────────────────────────

export function useMedications(status?: MedicationStatus) {
  const { user } = useAuth();
  const patientId = getCachedPatientId();
  const [data, setData] = useState<Medication[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isFromCache, setIsFromCache] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  const fetchData = useCallback(async (showRefreshing = false) => {
    if (!user || !patientId) {
      if (mountedRef.current) {
        setData([]);
        setIsLoading(false);
      }
      return;
    }

    try {
      if (showRefreshing) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError(null);

      const medications = await dbGetMedications(patientId, status);

      if (mountedRef.current) {
        if (medications.length > 0) {
          setData(medications);
          setIsFromCache(true);
          setIsLoading(false);
          setIsRefreshing(false);
          return;
        }

        try {
          const serverResult = await api.get<{ medications: Medication[]; total: number }>(
            `/api/v1/medications${status ? `?status=${status}` : ''}`,
          );
          if (mountedRef.current) {
            setData(serverResult.medications);
            setIsFromCache(false);
            dbHydrateMedications(patientId, serverResult.medications).catch(() => {});
          }
        } catch {
          if (mountedRef.current) {
            setData([]);
          }
        }
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [user, patientId, status]);

  useEffect(() => {
    fetchData(false);
  }, [fetchData]);

  const refetch = useCallback(async () => {
    await fetchData(true);
  }, [fetchData]);

  return {
    data,
    isLoading,
    isRefreshing,
    error,
    refetch,
    isFromCache,
  };
}

// ─── useActiveMedications ────────────────────────────────────────────────────

export function useActiveMedications() {
  const { user } = useAuth();
  const patientId = getCachedPatientId();
  const [data, setData] = useState<ActiveMedicationForDailyLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isFromCache, setIsFromCache] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  const fetchData = useCallback(async (showRefreshing = false) => {
    if (!user || !patientId) {
      if (mountedRef.current) {
        setData([]);
        setIsLoading(false);
      }
      return;
    }

    try {
      if (showRefreshing) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError(null);

      const medications = await dbGetActiveMedicationsForDailyLog(patientId);

      if (mountedRef.current) {
        if (medications.length > 0) {
          setData(medications);
          setIsFromCache(true);
          setIsLoading(false);
          setIsRefreshing(false);
          return;
        }

        try {
          const activeMeds = await api.get<ActiveMedicationForDailyLog[]>('/api/v1/medications/active');
          if (mountedRef.current) {
            setData(activeMeds);
            setIsFromCache(false);
            const fullMedsResult = await api.get<{ medications: Medication[]; total: number }>('/api/v1/medications');
            dbHydrateMedications(patientId, fullMedsResult.medications).catch(() => {});
          }
        } catch {
          if (mountedRef.current) {
            setData([]);
          }
        }
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [user, patientId]);

  useEffect(() => {
    fetchData(false);
  }, [fetchData]);

  const refetch = useCallback(async () => {
    await fetchData(true);
  }, [fetchData]);

  return {
    data,
    isLoading,
    isRefreshing,
    error,
    refetch,
    isFromCache,
  };
}

// ─── useMedicationSchedule ───────────────────────────────────────────────────

/**
 * Local-first medication schedule with hydration awareness.
 *
 * Flow:
 * 1. Check if taken events have been hydrated for this patient
 * 2. If not hydrated:
 *    a. Fetch taken events from server for this date
 *    b. Hydrate SQLite
 *    c. Mark as hydrated
 * 3. Compute schedule locally from SQLite
 *
 * What remains server-backed:
 * - ClinicalEvent creation (POST /taken)
 * - Graph sync enqueuing
 * - Outbox processing
 */
export function useMedicationSchedule(targetDate: string) {
  const { user } = useAuth();
  const patientId = getCachedPatientId();
  const [data, setData] = useState<DailyMedicationSchedule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isFromCache, setIsFromCache] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  const fetchData = useCallback(async (showRefreshing = false) => {
    if (!user || !patientId) {
      if (mountedRef.current) {
        setData([]);
        setIsLoading(false);
      }
      return;
    }

    try {
      if (showRefreshing) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError(null);

      // Step 1: Check if taken events have been hydrated
      const hydrated = await areTakenEventsHydrated(patientId);

      if (!hydrated) {
        // Step 2: Hydrate taken events from server
        try {
          const takenResult = await api.get<{ events: MedicationTakenEvent[]; total: number }>(
            `/api/v1/medications/schedule/${targetDate}/taken`,
          );
          if (mountedRef.current && takenResult.events) {
            await dbHydrateTakenEvents(patientId, takenResult.events);
          }
        } catch {
          // If the combined endpoint doesn't exist, try fetching all taken events
          try {
            // Get all active medications to fetch their taken events
            const meds = await api.get<{ medications: Medication[]; total: number }>('/api/v1/medications');
            if (mountedRef.current && meds.medications) {
              for (const med of meds.medications) {
                try {
                  const events = await api.get<{ events: MedicationTakenEvent[]; total: number }>(
                    `/api/v1/medications/${med.medication_id}/taken`,
                  );
                  if (mountedRef.current && events.events) {
                    await dbHydrateTakenEvents(patientId, events.events);
                  }
                } catch {
                  // Skip failed medication fetch
                }
              }
            }
          } catch {
            // Offline or API unavailable — proceed with local data
          }
        }

        // Mark as hydrated (even if fetch failed — prevents repeated fetches)
        await markTakenEventsHydrated(patientId);
      }

      // Step 3: Compute schedule locally from SQLite
      const schedule = await computeLocalSchedule(patientId, targetDate);

      if (mountedRef.current) {
        if (schedule.length > 0) {
          setData(schedule);
          setIsFromCache(true);
          setIsLoading(false);
          setIsRefreshing(false);
          return;
        }

        // Fallback: fetch from API if no medications in SQLite
        try {
          const serverSchedule = await api.get<DailyMedicationSchedule[]>(
            `/api/v1/medications/schedule/${targetDate}`,
          );
          if (mountedRef.current) {
            setData(serverSchedule);
            setIsFromCache(false);
            // Hydrate medications in background
            const fullMedsResult = await api.get<{ medications: Medication[]; total: number }>('/api/v1/medications');
            dbHydrateMedications(patientId, fullMedsResult.medications).catch(() => {});
          }
        } catch {
          if (mountedRef.current) {
            setData([]);
          }
        }
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [user, patientId, targetDate]);

  useEffect(() => {
    fetchData(false);
  }, [fetchData]);

  const refetch = useCallback(async () => {
    await fetchData(true);
  }, [fetchData]);

  return {
    data,
    isLoading,
    isRefreshing,
    error,
    refetch,
    isFromCache,
  };
}

// ─── useMedicationTakenEvents ────────────────────────────────────────────────

/**
 * Local-first taken events for a specific medication.
 *
 * Primary: SQLite
 * Fallback: API only when SQLite has no events for this medication
 *
 * Safety: Server records may hydrate only when local records are synced.
 * Pending local mutations are never overwritten.
 */
export function useMedicationTakenEvents(medicationId: string) {
  const { user } = useAuth();
  const patientId = getCachedPatientId();
  const [data, setData] = useState<MedicationTakenEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isFromCache, setIsFromCache] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  const fetchData = useCallback(async (showRefreshing = false) => {
    if (!user || !patientId || !medicationId) {
      if (mountedRef.current) {
        setData([]);
        setIsLoading(false);
      }
      return;
    }

    try {
      if (showRefreshing) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError(null);

      // Read from SQLite
      const events = await dbGetTakenEvents(patientId, 50);

      // Filter to this medication
      const filtered = events.filter((e) => e.medication_id === medicationId);

      if (mountedRef.current) {
        if (filtered.length > 0) {
          setData(filtered);
          setIsFromCache(true);
          setIsLoading(false);
          setIsRefreshing(false);
          return;
        }

        // Fallback: fetch from API if no local events
        try {
          const takenResult = await api.get<{ events: MedicationTakenEvent[]; total: number }>(
            `/api/v1/medications/${medicationId}/taken`,
          );
          if (mountedRef.current) {
            setData(takenResult.events);
            setIsFromCache(false);
            // Hydrate in background
            dbHydrateTakenEvents(patientId, takenResult.events).catch(() => {});
          }
        } catch {
          if (mountedRef.current) {
            setData([]);
          }
        }
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [user, patientId, medicationId]);

  useEffect(() => {
    fetchData(false);
  }, [fetchData]);

  const refetch = useCallback(async () => {
    await fetchData(true);
  }, [fetchData]);

  return {
    data,
    isLoading,
    isRefreshing,
    error,
    refetch,
    isFromCache,
  };
}

// ─── recordMedicationTaken ───────────────────────────────────────────────────

/**
 * Record a medication as taken — local-first with server reconciliation.
 *
 * Flow:
 * 1. Write to SQLite immediately (sync_status = pending_create)
 * 2. Add sync_queue entry
 * 3. If online, POST to API
 * 4. On API success: reconcile local record with server event_id, mark synced
 * 5. On reconciliation failure: retry once, then leave for hydration recovery
 * 6. On API failure: leave local event pending (user action preserved)
 *
 * Returns the event_id (local or server).
 */
export async function recordMedicationTaken(
  patientId: string,
  medicationId: string,
  doseAmount: number | null,
  doseUnit: string | null,
  scheduledTime: string,
): Promise<{ localEventId: string; serverEventId: string | null }> {
  const now = new Date();

  // Build scheduled_for as today + scheduledTime (local time)
  const [hours, minutes] = scheduledTime.split(':').map(Number);
  const scheduledFor = new Date(now);
  scheduledFor.setHours(hours, minutes, 0, 0);

  // Step 1: Write to SQLite immediately
  const localEventId = await dbInsertTakenEvent(patientId, {
    medication_id: medicationId,
    taken_at: now.toISOString(),
    scheduled_for: scheduledFor.toISOString(),
    dose_taken: doseAmount,
    dose_unit: doseUnit,
    status: 'TAKEN' as DoseTakenStatus,
    notes: null,
    clinical_event_id: null,
  });

  // Step 2: Try server persistence with reconciliation retry
  let serverEventId: string | null = null;
  try {
    const response = await api.post<{
      event_id: string;
      medication_id: string;
      patient_id: string;
      taken_at: string;
      scheduled_for: string | null;
      dose_taken: number | null;
      dose_unit: string | null;
      status: string;
      notes: string | null;
      clinical_event_id: string | null;
      created_at: string;
      updated_at: string;
    }>('/api/v1/medications/taken', {
      medication_id: medicationId,
      taken_at: now.toISOString(),
      scheduled_for: scheduledFor.toISOString(),
      dose_taken: doseAmount,
      dose_unit: doseUnit,
      status: 'TAKEN',
    });

    serverEventId = response.event_id;

    // Step 3: Reconcile — replace local event_id with server event_id
    const reconcileResult = await dbReconcileTakenEvent(patientId, localEventId, serverEventId);

    if (!reconcileResult) {
      // Reconciliation failed — retry once
      await new Promise(resolve => setTimeout(resolve, 100));
      const retryResult = await dbReconcileTakenEvent(patientId, localEventId, serverEventId);

      if (!retryResult) {
        // Retry also failed — the hydration process will detect and reconcile this later
        // The local event stays pending, but we have the serverEventId for recovery
        console.warn('[MedGraph] Reconciliation deferred — will be resolved during hydration');
      }
    }
  } catch {
    // API failed — local event stays pending, will sync later
  }

  return { localEventId, serverEventId };
}
