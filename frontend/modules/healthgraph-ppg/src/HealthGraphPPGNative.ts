import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import type {
  PpgMeasurementResult,
  PpgMeasureOptions,
  PpgStateEvent,
} from './HealthGraphPPG.types';
import { PPG_ALGORITHM_VERSION } from './HealthGraphPPG.types';

/**
 * Minimal structural type for the natively-registered HealthGraphPPG module.
 * Resolved via `requireOptionalNativeModule` (the documented Expo lookup:
 * JSI host object → NativeModulesProxy → TurboModule proxy). React Native's
 * own `NativeModules` does NOT list Expo modules, so it must not be used.
 */
interface NativePpgBinding {
  measure(args: {
    durationSeconds: number;
    exportRawSignal: boolean;
  }): Promise<Record<string, unknown>>;
  cancel(): Promise<unknown>;
  addListener(
    eventName: string,
    listener: (event: Record<string, unknown>) => void,
  ): { remove(): void };
}

function resolveNativeModule(): NativePpgBinding | null {
  try {
    if (Platform.OS !== 'android' && Platform.OS !== 'ios') return null;
    const mod = requireOptionalNativeModule<NativePpgBinding>('HealthGraphPPG');
    if (!mod || typeof mod.measure !== 'function') return null;
    return mod;
  } catch {
    // Expo Go / web / any runtime without the custom native module.
    return null;
  }
}

// Resolved lazily and cached: importing this file must never crash,
// including in Expo Go where the native module does not exist.
let cached: NativePpgBinding | null | undefined;
function nativeModule(): NativePpgBinding | null {
  if (cached === undefined) cached = resolveNativeModule();
  return cached;
}

export const isPpgAvailable: boolean = nativeModule() != null;

type Listener = (event: PpgStateEvent) => void;

const listeners = new Set<Listener>();
let nativeSubscription: { remove(): void } | null = null;

function emit(event: PpgStateEvent): void {
  listeners.forEach((l) => {
    try {
      l(event);
    } catch {
      // Listener errors must never break measurement.
    }
  });
}

function coerceStateEvent(raw: Record<string, unknown>): PpgStateEvent {
  const states = [
    'IDLE',
    'STARTING',
    'WAITING_FOR_FINGER',
    'ACQUIRING',
    'MEASURING',
    'SIGNAL_WEAK',
    'FINGER_REMOVED',
    'QUALITY_WARNING',
    'COMPLETING',
    'COMPLETE',
    'FAILED',
    'CANCELLED',
  ] as const;
  const state = states.includes(raw['state'] as (typeof states)[number])
    ? (raw['state'] as (typeof states)[number])
    : 'FAILED';
  const event: PpgStateEvent = { state };
  if (typeof raw['signalQuality'] === 'number') event.signalQuality = raw['signalQuality'];
  // Live BPM only crosses as a real number; anything else means "no
  // trustworthy live value" and the UI must clear any displayed BPM.
  if (typeof raw['liveBpm'] === 'number') event.liveBpm = raw['liveBpm'];
  if (typeof raw['message'] === 'string') event.message = raw['message'];
  return event;
}

export function addPpgStateListener(listener: Listener): () => void {
  listeners.add(listener);
  // Attach the single native subscription while JS listeners exist so
  // OnStartObserving/observing lifecycle stays correct.
  if (!nativeSubscription) {
    try {
      const mod = nativeModule();
      if (mod && typeof mod.addListener === 'function') {
        nativeSubscription = mod.addListener('HealthGraphPPGState', (raw) =>
          emit(coerceStateEvent(raw)),
        );
      }
    } catch {
      nativeSubscription = null;
    }
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && nativeSubscription) {
      try {
        nativeSubscription.remove();
      } catch {
        // Detach is best-effort.
      }
      nativeSubscription = null;
    }
  };
}

/**
 * Run an on-device fingertip PPG measurement.
 * Resolves with the compact derived result only. Rejects on failure/cancel.
 * Throws when the native module is unavailable (Expo Go / web) so callers
 * can fall back to the clearly-marked simulation provider.
 */
export async function measure(
  options: PpgMeasureOptions = {},
): Promise<PpgMeasurementResult> {
  const mod = nativeModule();
  if (!mod) {
    throw new Error(
      'Camera PPG requires an Expo development or production build with the HealthGraphPPG native module. It is not available in Expo Go or on web.',
    );
  }
  const durationSeconds = Math.max(
    10,
    Math.min(300, Math.round(options.durationSeconds ?? 60)),
  );
  emit({ state: 'STARTING' });
  try {
    const raw = await mod.measure({
      durationSeconds,
      exportRawSignal: options.exportRawSignal === true,
    });
    const result: PpgMeasurementResult = {
      heartRateBpm:
        typeof raw['heartRateBpm'] === 'number' ? (raw['heartRateBpm'] as number) : null,
      signalQuality:
        typeof raw['signalQuality'] === 'number' ? (raw['signalQuality'] as number) : 0,
      durationSeconds:
        typeof raw['durationSeconds'] === 'number'
          ? (raw['durationSeconds'] as number)
          : durationSeconds,
      algorithmVersion:
        typeof raw['algorithmVersion'] === 'string'
          ? (raw['algorithmVersion'] as string)
          : PPG_ALGORITHM_VERSION,
    };
    if (Array.isArray(raw['rrIntervalsMs']))
      result.rrIntervalsMs = raw['rrIntervalsMs'] as number[];
    if (typeof raw['rmssdMs'] === 'number') result.rmssdMs = raw['rmssdMs'] as number;
    if (typeof raw['sdnnMs'] === 'number') result.sdnnMs = raw['sdnnMs'] as number;
    if (Array.isArray(raw['rawSignal'])) result.rawSignal = raw['rawSignal'] as number[];
    // Native diagnostics (optional, Android only): pass through untouched.
    if (typeof raw['torchEnabled'] === 'boolean') result.torchEnabled = raw['torchEnabled'] as boolean;
    if (typeof raw['framesReceived'] === 'number') result.framesReceived = raw['framesReceived'] as number;
    if (typeof raw['samplesCollected'] === 'number') result.samplesCollected = raw['samplesCollected'] as number;
    if (typeof raw['failureReason'] === 'string') result.failureReason = raw['failureReason'] as string;
    emit({ state: 'COMPLETE', signalQuality: result.signalQuality });
    return result;
  } catch (e: any) {
    const cancelled =
      e?.code === 'CANCELLED' || /cancel/i.test(String(e?.message ?? ''));
    emit({ state: cancelled ? 'CANCELLED' : 'FAILED', message: e?.message });
    throw e;
  }
}

export async function cancelMeasure(): Promise<void> {
  try {
    await nativeModule()?.cancel();
  } catch {
    // Cancel is best-effort (e.g. already finished / unavailable).
  }
  emit({ state: 'CANCELLED' });
}
