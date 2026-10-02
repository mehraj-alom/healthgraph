/**
 * nativeAdapter.ts — Health Connect native binding (Slice 2).
 *
 * This module is the ONLY place that touches `react-native-health-connect`,
 * and it does so lazily: without the native module (iOS, Expo Go, unit
 * tests) every function degrades to "unavailable" instead of throwing.
 * Never import this module from node-tested code — inject the ImportAdapter
 * interface from importer.ts instead.
 */

import { Platform } from 'react-native';
import type { HealthConnectAdapter } from './capability.ts';
import { UNAVAILABLE_REASON } from './capability.ts';
import type { ImportAdapter } from './importer.ts';

declare function require(id: string): unknown;

type NativeApi = {
  getSdkStatus: () => Promise<number>;
  initialize: () => Promise<boolean>;
  requestPermission: (permissions: { accessType: 'read'; recordType: string }[]) => Promise<unknown>;
  getGrantedPermissions: () => Promise<{ accessType?: string; recordType?: string }[]>;
  readRecords: (
    recordType: string,
    options: {
      timeRangeFilter: { operator: 'between'; startTime: string; endTime: string };
      ascendingOrder?: boolean;
      pageSize?: number;
    },
  ) => Promise<{ records: unknown[] }>;
  openHealthConnectSettings: () => void;
};

const SDK_AVAILABLE = 3;
const READ_PAGE_SIZE = 500;

let cached: NativeApi | null | undefined;

function loadNative(): NativeApi | null {
  if (cached !== undefined) return cached;
  if (Platform.OS !== 'android') {
    cached = null;
    return cached;
  }
  try {
    const mod = require('react-native-health-connect') as unknown;
    const api = ((mod as { default?: unknown }).default ?? mod) as Partial<NativeApi>;
    cached = typeof api?.getSdkStatus === 'function' ? (api as NativeApi) : null;
  } catch {
    cached = null;
  }
  return cached;
}

function recordUid(record: unknown, fallback: string): string {
  if (typeof record === 'object' && record !== null) {
    const metadata = (record as { metadata?: { id?: unknown } }).metadata;
    if (metadata !== null && typeof metadata === 'object' && typeof metadata.id === 'string' && metadata.id.length > 0) {
      return metadata.id;
    }
  }
  return fallback;
}

const EXERCISE_NUMBER_TO_NAME: Record<number, string> = {
  56: 'RUNNING',
  57: 'RUNNING_TREADMILL',
  79: 'WALKING',
  8: 'CYCLING',
  9: 'CYCLING',
  37: 'HIKING',
  83: 'YOGA',
  70: 'STRENGTH_TRAINING',
  81: 'WEIGHTLIFTING',
  74: 'SWIMMING_POOL',
  73: 'SWIMMING_OPEN_WATER',
  53: 'ROWING',
  48: 'PILATES',
  16: 'DANCING',
  32: 'GOLF',
  76: 'TENNIS',
  64: 'SOCCER',
  5: 'BASKETBALL',
};

function exerciseName(record: unknown): string {
  if (typeof record === 'object' && record !== null) {
    const n = (record as { exerciseType?: unknown }).exerciseType;
    if (typeof n === 'number' && EXERCISE_NUMBER_TO_NAME[n] !== undefined) {
      return EXERCISE_NUMBER_TO_NAME[n];
    }
  }
  return 'OTHER_WORKOUT';
}

function weightInputs(record: unknown): { weightKg?: number; weightLb?: number } {
  if (typeof record !== 'object' || record === null) return {};
  const weight = (record as { weight?: { value?: unknown; unit?: unknown } }).weight;
  if (weight === null || typeof weight !== 'object') return {};
  if (typeof weight.value !== 'number' || !Number.isFinite(weight.value)) return {};
  if (weight.unit === 'kilograms') return { weightKg: weight.value };
  if (weight.unit === 'pounds') return { weightLb: weight.value };
  if (weight.unit === 'grams') return { weightKg: weight.value / 1000 };
  if (weight.unit === 'ounces') return { weightLb: weight.value / 16 };
  return {};
}

function instantOf(record: unknown): string | null {
  if (typeof record !== 'object' || record === null) return null;
  const time = (record as { time?: unknown }).time;
  return typeof time === 'string' ? time : null;
}

function intervalOf(record: unknown): { startTime: unknown; endTime: unknown } {
  if (typeof record !== 'object' || record === null) return { startTime: null, endTime: null };
  const r = record as { startTime?: unknown; endTime?: unknown };
  return { startTime: r.startTime, endTime: r.endTime };
}

export const nativeCapability: HealthConnectAdapter = {
  isAvailable: () => loadNative() !== null,
  reason: null,
};

export function nativeAvailabilityReason(): string {
  if (Platform.OS !== 'android') return 'requires-android-build';
  return loadNative() === null ? UNAVAILABLE_REASON : 'ready';
}

async function readType(recordType: string, startISO: string, endISO: string): Promise<unknown[]> {
  const api = loadNative();
  if (api === null) return [];
  const result = await api.readRecords(recordType, {
    timeRangeFilter: { operator: 'between', startTime: startISO, endTime: endISO },
    ascendingOrder: true,
    pageSize: READ_PAGE_SIZE,
  });
  return Array.isArray(result?.records) ? result.records : [];
}

/**
 * The live adapter behind the ImportAdapter interface. Passed into
 * runHealthConnectImport by the wiring layer — never constructed in tests.
 */
export const nativeImportAdapter: ImportAdapter = {
  isAvailable: () => loadNative() !== null,

  async ensurePermissions(): Promise<boolean> {
    const api = loadNative();
    if (api === null) return false;
    try {
      const status = await api.getSdkStatus();
      if (status !== SDK_AVAILABLE) return false;
      const ok = await api.initialize();
      if (!ok) return false;
      // Slice 3 imports sleep + exercise + weight + steps — request exactly that.
      await api.requestPermission([
        { accessType: 'read', recordType: 'SleepSession' },
        { accessType: 'read', recordType: 'ExerciseSession' },
        { accessType: 'read', recordType: 'Weight' },
        { accessType: 'read', recordType: 'Steps' },
      ]);
      const granted = await api.getGrantedPermissions();
      const names = new Set(granted.map((p) => p?.recordType));
      return (
        names.has('SleepSession') &&
        names.has('ExerciseSession') &&
        names.has('Weight') &&
        names.has('Steps')
      );
    } catch {
      return false;
    }
  },

  async readSleep(startISO: string, endISO: string): Promise<unknown[]> {
    const records = await readType('SleepSession', startISO, endISO);
    return records.map((r) => {
      const { startTime, endTime } = intervalOf(r);
      return { uid: recordUid(r, `${startTime}|${endTime}`), startTime, endTime };
    });
  },

  async readExercise(startISO: string, endISO: string): Promise<unknown[]> {
    const records = await readType('ExerciseSession', startISO, endISO);
    return records.map((r) => {
      const { startTime, endTime } = intervalOf(r);
      return {
        uid: recordUid(r, `${startTime}|${endTime}`),
        startTime,
        endTime,
        exerciseType: exerciseName(r),
      };
    });
  },

  async readWeight(startISO: string, endISO: string): Promise<unknown[]> {
    const records = await readType('Weight', startISO, endISO);
    return records.map((r) => {
      const time = instantOf(r);
      return { uid: recordUid(r, String(time)), time, ...weightInputs(r) };
    });
  },

  async readSteps(startISO: string, endISO: string): Promise<unknown[]> {
    const records = await readType('Steps', startISO, endISO);
    return records.map((r) => {
      const { startTime, endTime } = intervalOf(r);
      const count =
        typeof r === 'object' && r !== null
          ? (r as { count?: unknown }).count
          : undefined;
      return { uid: recordUid(r, `${startTime}|${endTime}`), startTime, endTime, steps: count };
    });
  },
};

/** Weight/stub readers for Slice 3 — shaped now, wired when weight ships. */
export async function readWeightStub(startISO: string, endISO: string): Promise<unknown[]> {
  const records = await readType('Weight', startISO, endISO);
  return records.map((r) => ({
    uid: recordUid(r, String(instantOf(r))),
    time: instantOf(r),
    ...weightInputs(r),
  }));
}

export function openHealthConnectSettings(): boolean {
  const api = loadNative();
  if (api === null) return false;
  try {
    api.openHealthConnectSettings();
    return true;
  } catch {
    return false;
  }
}
