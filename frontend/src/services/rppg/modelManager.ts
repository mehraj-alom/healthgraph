/**
 * rppgModel.ts — Versioned on-demand manager for the PhysFormer ONNX model.
 *
 * The ~17 MB model is NOT bundled: Metro only packages statically require()d
 * assets, and nothing in the app references the .onnx path anymore, so the
 * base install stays thin. First rPPG use downloads it once; every later
 * measurement (including fully offline ones) reuses the validated cache.
 *
 * Integrity: the manifest pins exact byte size + SHA-256 over the file's
 * base64 encoding (expo-crypto digests strings; base64 ASCII is UTF-8
 * stable, so the digest is deterministic — see sha256Base64 below).
 * Install is atomic (temp → verify → move); partial/corrupt files are
 * deleted, never loaded. Version bumps invalidate old caches.
 *
 * Conventions mirror services/anatomyDownload.ts: same storage root, same
 * temp-file discipline, same error-prefix scheme for friendly UI mapping.
 */

import { Paths, File, Directory } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { assetUrl } from '../assetHost';
import {
  RPPG_MODEL_MANIFEST,
  RPPG_DOWNLOAD_SUFFIX,
  base64Encode,
  friendlyRppgModelMessage,
  tempDownloadName,
  type RppgModelManifest,
} from './modelMeta';

export type { RppgModelManifest };
export { RPPG_MODEL_MANIFEST, friendlyRppgModelMessage };

export function getRppgModelUrl(): string {
  return assetUrl(RPPG_MODEL_MANIFEST.remotePath);
}

// ---------------------------------------------------------------------------
// Install record (metadata only — the 17 MB binary never touches AsyncStorage)
// ---------------------------------------------------------------------------

const INSTALL_KEY = '@medgraph/rppg_model_install';

interface ModelInstallRecord {
  version: string;
  sha256Base64: string;
  size: number;
  installedAt: number;
}

async function readInstallRecord(): Promise<ModelInstallRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(INSTALL_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ModelInstallRecord;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function modelDir(): Directory {
  return new Directory(Paths.document, 'medgraph', 'models', 'rppg');
}

function modelFile(): File {
  return new File(modelDir(), RPPG_MODEL_MANIFEST.filename);
}

/**
 * Unique temp file for ONE download attempt. Concurrent ensure() calls must
 * never share a temp path: the old shared name let one caller's clean-slate
 * delete corrupt another caller's in-flight bytes (surfacing later as a
 * bogus checksum failure). The install stays atomic: verify temp, then
 * move over the destination.
 */
function attemptTempFile(): File {
  const nonce =
    typeof Math !== 'undefined'
      ? Math.random().toString(36).slice(2, 10) +
        Date.now().toString(36)
      : 'fallback';
  return new File(modelDir(), tempDownloadName(RPPG_MODEL_MANIFEST.filename, nonce));
}

/** Remove stale temp files from interrupted attempts (bounded storage). */
async function sweepStaleTempFiles(dir: Directory): Promise<void> {
  let entries: Array<Directory | File>;
  try {
    entries = dir.list();
  } catch {
    return;
  }
  for (const entry of entries) {
    try {
      if (
        entry instanceof File &&
        (entry.name.endsWith(RPPG_DOWNLOAD_SUFFIX) ||
          entry.name.includes(`${RPPG_DOWNLOAD_SUFFIX}.`))
      ) {
        await entry.delete();
      }
    } catch {
      /* best-effort per file */
    }
  }
}

async function ensureDir(dir: Directory): Promise<void> {
  try {
    await dir.create({ intermediates: true, idempotent: true });
  } catch {
    await dir.create({ intermediates: true, idempotent: true });
  }
}

// ---------------------------------------------------------------------------
// Integrity
// ---------------------------------------------------------------------------


/** SHA-256 hex over the file's base64 — comparable to the manifest. */
export async function sha256OfFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const b64 = base64Encode(bytes);
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, b64);
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export type RppgModelStatus =
  | 'missing'
  | 'installed'
  | 'updating'
  | 'corrupt';

/** No network involved: record + file existence + exact size. */
export async function getRppgModelStatus(): Promise<{
  status: RppgModelStatus;
  record: ModelInstallRecord | null;
}> {
  const record = await readInstallRecord();
  let exists = false;
  let size = 0;
  try {
    const info = await modelFile().info();
    exists = info.exists;
    size = info.size ?? 0;
  } catch {
    exists = false;
  }
  if (!exists || size <= 0 || !record) {
    return { status: 'missing', record: null };
  }
  if (
    record.version !== RPPG_MODEL_MANIFEST.version ||
    record.sha256Base64 !== RPPG_MODEL_MANIFEST.sha256Base64 ||
    record.size !== RPPG_MODEL_MANIFEST.size
  ) {
    return { status: 'updating', record };
  }
  if (size !== RPPG_MODEL_MANIFEST.size) {
    return { status: 'corrupt', record };
  }
  return { status: 'installed', record };
}

export async function isRppgModelInstalled(): Promise<boolean> {
  return (await getRppgModelStatus()).status === 'installed';
}

/** Absolute local path for ONNX Runtime. Throws when not installed. */
export async function getLocalRppgModelPath(): Promise<string> {
  const { status } = await getRppgModelStatus();
  if (status !== 'installed') {
    throw new RppgModelError(
      'missing',
      'The pulse model is not on this device yet.',
    );
  }
  return modelFile().uri;
}

// ---------------------------------------------------------------------------
// Errors (coded for friendly UI mapping — never raw internals)
// ---------------------------------------------------------------------------

export type RppgModelErrorCode =
  | 'missing'
  | 'network'
  | 'checksum'
  | 'storage'
  | 'cancelled';

export class RppgModelError extends Error {
  readonly code: RppgModelErrorCode;
  constructor(code: RppgModelErrorCode, message: string) {
    super(message);
    this.name = 'RppgModelError';
    this.code = code;
  }
}

export interface RppgModelProgress {
  totalBytes: number;
  receivedBytes: number;
  percent: number;
}

// ---------------------------------------------------------------------------
// Download + atomic install
// ---------------------------------------------------------------------------

/**
 * Ensure the model is installed, downloading once when needed.
 * Repeat calls with a valid cache return immediately (no network).
 * Throws RppgModelError with a machine-readable code on failure.
 */
export async function ensureRppgModelAvailable(
  onProgress?: (progress: RppgModelProgress) => void,
  signal?: AbortSignal,
): Promise<string> {
  const { status } = await getRppgModelStatus();
  if (status === 'installed') {
    return modelFile().uri;
  }

  const dir = modelDir();
  try {
    await ensureDir(dir);
  } catch {
    throw new RppgModelError(
      'storage',
      'Could not prepare storage for the pulse model. Check free space and try again.',
    );
  }
  // Sweep interrupted attempts first (bounded storage, includes the legacy
  // shared temp name), then download to a unique temp path so concurrent
  // callers can never share — or delete — each other's bytes.
  await sweepStaleTempFiles(dir);
  const finalFile = modelFile();
  const tmp = attemptTempFile();

  const url = getRppgModelUrl();
  // HTTP verdict BEFORE bytes: File.downloadFileAsync exposes no status, so
  // a 404 error page would otherwise masquerade as a checksum failure. A
  // cheap HEAD surfaces the real server verdict; an inconclusive HEAD
  // (throw) falls through to the download, where size + SHA still guard
  // integrity. Abort during HEAD is a genuine cancel.
  try {
    const head = await fetch(url, {
      method: 'HEAD',
      headers: { 'Cache-Control': 'no-cache' },
      signal,
    });
    if (!head.ok) {
      try {
        await tmp.delete();
      } catch {
        /* ignore */
      }
      throw new RppgModelError(
        'network',
        `The model server answered HTTP ${head.status} for ${RPPG_MODEL_MANIFEST.filename}. Check the asset host and try again.`,
      );
    }
  } catch (err: unknown) {
    if (err instanceof RppgModelError) throw err;
    if (signal?.aborted) {
      try {
        await tmp.delete();
      } catch {
        /* ignore */
      }
      throw new RppgModelError('cancelled', 'Model download cancelled.');
    }
    // Inconclusive (DNS/TLS/CORS on HEAD): proceed; integrity gates hold.
  }
  try {
    await File.downloadFileAsync(url, tmp, {
      headers: { 'Cache-Control': 'no-cache' },
      idempotent: true,
      onProgress: (data) => {
        onProgress?.({
          totalBytes: RPPG_MODEL_MANIFEST.size,
          receivedBytes: Math.min(data.bytesWritten, RPPG_MODEL_MANIFEST.size),
          percent: Math.min(
            100,
            Math.round((data.bytesWritten / RPPG_MODEL_MANIFEST.size) * 100),
          ),
        });
      },
      signal,
    });
  } catch (err: unknown) {
    try {
      await tmp.delete();
    } catch {
      /* ignore */
    }
    if (signal?.aborted) {
      throw new RppgModelError('cancelled', 'Model download cancelled.');
    }
    const msg = String((err as Error)?.message ?? err);
    if (
      msg.includes('ECONNREFUSED') ||
      msg.includes('ConnectException') ||
      msg.includes('fetch failed') ||
      msg.includes('Network request failed')
    ) {
      throw new RppgModelError(
        'network',
        'Could not reach the model server. Check your connection and try again.',
      );
    }
    throw new RppgModelError(
      'network',
      'Model download interrupted. Check your connection and try again.',
    );
  }

  if (signal?.aborted) {
    try {
      await tmp.delete();
    } catch {
      /* ignore */
    }
    throw new RppgModelError('cancelled', 'Model download cancelled.');
  }

  // Verify exact size first (cheap), then SHA-256 (definitive).
  let actualSize = 0;
  try {
    const info = await tmp.info();
    actualSize = info.size ?? 0;
  } catch {
    /* fall through to checksum failure */
  }
  if (actualSize !== RPPG_MODEL_MANIFEST.size) {
    try {
      await tmp.delete();
    } catch {
      /* ignore */
    }
    throw new RppgModelError(
      'checksum',
      'Downloaded model failed verification. Please try again.',
    );
  }

  let digest = '';
  try {
    digest = (await sha256OfFile(tmp)).toLowerCase();
  } catch {
    digest = '';
  }
  if (digest !== RPPG_MODEL_MANIFEST.sha256Base64.toLowerCase()) {
    try {
      await tmp.delete();
    } catch {
      /* ignore */
    }
    throw new RppgModelError(
      'checksum',
      'Downloaded model failed verification. Please try again.',
    );
  }

  // Atomic install: clear any stale destination, then move.
  try {
    const destInfo = await finalFile.info();
    if (destInfo.exists) await finalFile.delete();
  } catch {
    /* ignore */
  }
  try {
    await tmp.move(finalFile);
  } catch {
    throw new RppgModelError(
      'storage',
      'Could not save the model on this device. Check storage space and try again.',
    );
  }

  const record: ModelInstallRecord = {
    version: RPPG_MODEL_MANIFEST.version,
    sha256Base64: RPPG_MODEL_MANIFEST.sha256Base64,
    size: RPPG_MODEL_MANIFEST.size,
    installedAt: Date.now(),
  };
  try {
    await AsyncStorage.setItem(INSTALL_KEY, JSON.stringify(record));
  } catch {
    /* record loss only forces re-verification next time */
  }

  onProgress?.({
    totalBytes: RPPG_MODEL_MANIFEST.size,
    receivedBytes: RPPG_MODEL_MANIFEST.size,
    percent: 100,
  });
  return finalFile.uri;
}

/** Remove the cached model (storage management). Never touches sessions. */
export async function deleteRppgModel(): Promise<void> {
  try {
    const info = await modelFile().info();
    if (info.exists) await modelFile().delete();
  } catch {
    /* ignore */
  }
  try {
    await AsyncStorage.removeItem(INSTALL_KEY);
  } catch {
    /* ignore */
  }
}
