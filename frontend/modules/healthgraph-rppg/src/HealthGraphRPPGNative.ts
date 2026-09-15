import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import type {
  RppgCaptureOptions,
  RppgCaptureResult,
  RppgNativeEvent,
  RppgNativeState,
} from './HealthGraphRPPG.types';

/**
 * Minimal structural type for the natively-registered HealthGraphRPPG module.
 * Resolved via `requireOptionalNativeModule` (the documented Expo lookup).
 * React Native's own `NativeModules` does NOT list Expo modules.
 */
interface NativeRppgBinding {
  startCapture(args: { timeoutSeconds: number }): Promise<Record<string, unknown>>;
  cancelCapture(): Promise<unknown>;
  addListener(
    eventName: string,
    listener: (event: Record<string, unknown>) => void,
  ): { remove(): void };
}

function resolveNativeModule(): NativeRppgBinding | null {
  try {
    if (Platform.OS !== 'android' && Platform.OS !== 'ios') return null;
    const mod = requireOptionalNativeModule<NativeRppgBinding>('HealthGraphRPPG');
    if (!mod || typeof mod.startCapture !== 'function') return null;
    return mod;
  } catch {
    // Expo Go / web / any runtime without the custom native module.
    return null;
  }
}

// Resolved lazily and cached: importing this file must never crash,
// including in Expo Go where the native module does not exist.
let cached: NativeRppgBinding | null | undefined;
function nativeModule(): NativeRppgBinding | null {
  if (cached === undefined) cached = resolveNativeModule();
  return cached;
}

export const isRppgAvailable: boolean = nativeModule() != null;

type Listener = (event: RppgNativeEvent) => void;

const listeners = new Set<Listener>();
let nativeSubscription: { remove(): void } | null = null;

function emit(event: RppgNativeEvent): void {
  listeners.forEach((l) => {
    try {
      l(event);
    } catch {
      // Listener errors must never break capture.
    }
  });
}

function coerceStateEvent(raw: Record<string, unknown>): RppgNativeEvent {
  const states = [
    'STARTING',
    'FIND_FACE',
    'POSITION_FACE',
    'ACQUIRING',
    'FACE_LOST',
    'COMPLETING',
    'COMPLETE',
    'FAILED',
    'CANCELLED',
  ] as const;
  const state = states.includes(raw['state'] as (typeof states)[number])
    ? (raw['state'] as (typeof states)[number])
    : 'FAILED';
  const event: RppgNativeEvent = { state };
  if (typeof raw['framesCollected'] === 'number') {
    event.framesCollected = raw['framesCollected'] as number;
  }
  if (typeof raw['stability'] === 'number') {
    event.stability = raw['stability'] as number;
  }
  if (typeof raw['reason'] === 'string') event.reason = raw['reason'] as string;
  if (typeof raw['message'] === 'string') event.message = raw['message'] as string;
  return event;
}

export function addRppgStateListener(listener: Listener): () => void {
  listeners.add(listener);
  if (!nativeSubscription) {
    try {
      const mod = nativeModule();
      if (mod && typeof mod.addListener === 'function') {
        nativeSubscription = mod.addListener('HealthGraphRPPGState', (raw) =>
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
 * Run an on-device face capture producing a sealed 160-frame window file.
 * Resolves with the compact capture summary only (window URI + scalars).
 * Rejects on failure/cancel. Throws when the native module is unavailable
 * (Expo Go / web) so callers surface rPPG as unavailable.
 */
export async function startCapture(
  options: RppgCaptureOptions = {},
): Promise<RppgCaptureResult> {
  const mod = nativeModule();
  if (!mod) {
    throw new Error(
      'Face rPPG requires an Expo development or production build with the HealthGraphRPPG native module. It is not available in Expo Go or on web.',
    );
  }
  const timeoutSeconds = Math.max(
    10,
    Math.min(60, Math.round(options.timeoutSeconds ?? 30)),
  );
  emit({ state: 'STARTING' });
  try {
    const raw = await mod.startCapture({ timeoutSeconds });
    const result: RppgCaptureResult = {
      windowUri:
        typeof raw['windowUri'] === 'string' ? (raw['windowUri'] as string) : '',
      frameCount:
        typeof raw['frameCount'] === 'number' ? (raw['frameCount'] as number) : 0,
      fpsMeasured:
        typeof raw['fpsMeasured'] === 'number' ? (raw['fpsMeasured'] as number) : 0,
      durationMs:
        typeof raw['durationMs'] === 'number' ? (raw['durationMs'] as number) : 0,
      faceStableFrac:
        typeof raw['faceStableFrac'] === 'number'
          ? (raw['faceStableFrac'] as number)
          : 0,
      droppedFrames:
        typeof raw['droppedFrames'] === 'number'
          ? (raw['droppedFrames'] as number)
          : 0,
    };
    emit({ state: 'COMPLETE', framesCollected: result.frameCount });
    return result;
  } catch (e: any) {
    const cancelled =
      e?.code === 'CANCELLED' || /cancel/i.test(String(e?.message ?? ''));
    emit({ state: cancelled ? 'CANCELLED' : 'FAILED', message: e?.message });
    throw e;
  }
}

export async function cancelCapture(): Promise<void> {
  try {
    await nativeModule()?.cancelCapture();
  } catch {
    // Cancel is best-effort (e.g. already finished / unavailable).
  }
  emit({ state: 'CANCELLED' });
}

export type { RppgNativeState };
