/**
 * anatomyDownload.ts — Offline-first 3D anatomy download service.
 *
 * Downloads gender-specific GLB model packages to persistent device storage.
 * Each gender is independent: downloading Male never touches Female and vice versa.
 * Downloads use atomic temp-file-then-rename to prevent partial installs.
 * Installation state is verified by checking actual file existence on disk.
 *
 * Uses expo-file-system SDK 57 new API (Paths, File, Directory).
 */

import { Paths, File, Directory } from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { getAssetBaseUrl } from './assetHost';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Gender = 'male' | 'female';
export type DownloadState = 'NOT_INSTALLED' | 'DOWNLOADING' | 'INSTALLED' | 'UPDATING' | 'ERROR';

export interface ModelEntry {
  id: string;
  filename: string;
  size: number;
  version: string;
}

export interface GenderManifest {
  version: string;
  models: ModelEntry[];
}

export interface InstallRecord {
  version: string;
  installedAt: number;
  fileCount: number;
}

export interface DownloadProgress {
  totalBytes: number;
  receivedBytes: number;
  currentFile: string;
  fileIndex: number;
  fileCount: number;
  percent: number;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Base URL for remote GLB assets (download root — filenames are unique, so
 * no gender/version subpath is appended; see getRemoteUrl).
 *
 * Priority (shared with the rPPG model manager via assetHost):
 * 1. EXPO_PUBLIC_ANATOMY_CDN_URL (legacy explicit override, used as-is)
 * 2. EXPO_PUBLIC_ASSET_CDN_URL (unified host)
 * 3. __DEV__: derived Metro host + /anatomy (local frontend/public)
 * 4. Public GitHub Release healthgraph-assets-v1 (default).
 */
function resolveRemoteBase(): string {
  // Explicit legacy override always wins, used verbatim.
  if (process.env.EXPO_PUBLIC_ANATOMY_CDN_URL) {
    return process.env.EXPO_PUBLIC_ANATOMY_CDN_URL;
  }

  if (__DEV__) {
    // Derive host from the existing API URL (which already uses LAN IP).
    // Metro dev server runs on port 8081.
    const apiUrl = process.env.EXPO_PUBLIC_API_URL || '';
    if (apiUrl) {
      try {
        const url = new URL(apiUrl);
        return `${url.protocol}//${url.hostname}:8081/anatomy`;
      } catch { /* ignore parse errors */ }
    }
    return 'http://localhost:8081/anatomy';
  }

  // Release assets live in a flat namespace (see getRemoteUrl) — the base
  // IS the download root. (ASSET_ANATOMY_PATH documents the logical
  // versioned layout, not a URL prefix.)
  return getAssetBaseUrl();
}

const REMOTE_BASE = resolveRemoteBase();

const ASYNC_KEYS = {
  gender: '@medgraph/selected_gender',
  maleInstall: '@medgraph/anatomy_male_install',
  femaleInstall: '@medgraph/anatomy_female_install',
};

/** Base directory for anatomy storage: <Documents>/medgraph/anatomy/ */
function anatomyBaseDir(): Directory {
  return new Directory(Paths.document, 'medgraph', 'anatomy');
}

function genderDir(gender: Gender): Directory {
  return new Directory(anatomyBaseDir(), gender);
}

// ---------------------------------------------------------------------------
// Manifest definitions (bundled — no network needed for manifest lookup)
// ---------------------------------------------------------------------------

const MALE_MANIFEST: GenderManifest = {
  version: '1.0.0',
  models: [
    { id: 'regional_male',       filename: 'regional_male.glb',       size: 786432,   version: '1.0.0' },
    { id: 'muscular_male',       filename: 'muscular_male.glb',       size: 12582912, version: '1.0.0' },
    { id: 'skeletal_male',       filename: 'skeletal_male.glb',       size: 2831360,  version: '1.0.0' },
    { id: 'digestive_male',      filename: 'digestive_male.glb',      size: 933888,   version: '1.0.0' },
    { id: 'renal_male',          filename: 'renal_male.glb',          size: 61440,    version: '1.0.0' },
    { id: 'reproductive_male',   filename: 'reproductive_male.glb',   size: 65536,    version: '1.0.0' },
    { id: 'respiratory_male',    filename: 'respiratory_male.glb',    size: 585728,   version: '1.0.0' },
    { id: 'endocrine_male',      filename: 'endocrine_male.glb',      size: 40960,    version: '1.0.0' },
    { id: 'lymphatic_male',      filename: 'lymphatic_male.glb',      size: 512000,   version: '1.0.0' },
    { id: 'articular_male',      filename: 'articular_male.glb',      size: 1572864,  version: '1.0.0' },
    { id: 'nervous_male',        filename: 'nervous_male.glb',        size: 8598528,  version: '1.0.0' },
    { id: 'visceral_male',       filename: 'visceral_male.glb',       size: 1782579,  version: '1.0.0' },
    { id: 'cardiovascular_male', filename: 'cardiovascular_male.glb', size: 7237632,  version: '1.0.0' },
  ],
};

const FEMALE_MANIFEST: GenderManifest = {
  version: '1.0.0',
  models: [
    { id: 'skeletal_female',       filename: 'skeletal_female.glb',       size: 1363149,  version: '1.0.0' },
    { id: 'digestive_female',      filename: 'digestive_female.glb',      size: 479232,   version: '1.0.0' },
    { id: 'renal_female',          filename: 'renal_female.glb',          size: 618496,   version: '1.0.0' },
    { id: 'reproductive_female',   filename: 'reproductive_female.glb',   size: 430080,   version: '1.0.0' },
    { id: 'cardiovascular_female', filename: 'cardiovascular_female.glb', size: 450560,   version: '1.0.0' },
    { id: 'lymphatic_female',      filename: 'lymphatic_female.glb',      size: 45056,    version: '1.0.0' },
    { id: 'integumentary_female',  filename: 'integumentary_female.glb',  size: 2202009,  version: '1.0.0' },
  ],
};

function getManifest(gender: Gender): GenderManifest {
  return gender === 'male' ? MALE_MANIFEST : FEMALE_MANIFEST;
}

function getRemoteUrl(_gender: Gender, filename: string): string {
  // Release assets live in a flat namespace (filenames are unique across
  // genders); gender only selects the local cache directory + manifest.
  return `${REMOTE_BASE}/${filename}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fileExists(dir: Directory, filename: string): Promise<boolean> {
  try {
    const file = new File(dir, filename);
    const info = await file.info();
    return info.exists && info.size !== undefined && info.size > 0;
  } catch {
    return false;
  }
}

/**
 * Delete stale `.download` temp files left by an interrupted/cancelled run.
 * A killed app between downloadFileAsync and move() leaves
 * `<name>.glb.download` on disk while the viewer only reads `<name>.glb`,
 * so the package stays NOT_INSTALLED forever. Sweep before each run and
 * surface leftovers in status logs.
 */
export async function sweepStaleAnatomyTemps(gender: Gender): Promise<number> {
  const manifest = getManifest(gender);
  const dir = genderDir(gender);
  let swept = 0;
  for (const model of manifest.models) {
    try {
      const temp = new File(dir, `${model.filename}.download`);
      const info = await temp.info();
      if (info.exists) {
        await temp.delete();
        swept += 1;
      }
    } catch {
      // Best-effort — a missing dir just means nothing to sweep.
    }
  }
  if (swept > 0) console.log(`[AnatomyDownload] Swept ${swept} stale .download temps (${gender})`);
  return swept;
}

async function ensureDir(dir: Directory): Promise<void> {
  try {
    await dir.create({ intermediates: true, idempotent: true });
  } catch (err) {
    console.warn('[AnatomyDownload] ensureDir fallback:', err);
    // Second attempt — directory creation can be flaky on first call
    try {
      await dir.create({ intermediates: true, idempotent: true });
    } catch { /* ignore — will fail later with clear error */ }
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Gender persistence
// ---------------------------------------------------------------------------

export async function getSelectedGender(): Promise<Gender | null> {
  try {
    const val = await AsyncStorage.getItem(ASYNC_KEYS.gender);
    if (val === 'male' || val === 'female') return val;
  } catch { /* ignore */ }
  return null;
}

export async function setSelectedGender(gender: Gender): Promise<void> {
  await AsyncStorage.setItem(ASYNC_KEYS.gender, gender);
}

// ---------------------------------------------------------------------------
// Installation check — verifies actual files on disk
// ---------------------------------------------------------------------------

export async function getInstallationStatus(gender: Gender): Promise<{
  state: DownloadState;
  manifest: GenderManifest;
  installRecord: InstallRecord | null;
}> {
  const manifest = getManifest(gender);
  const dir = genderDir(gender);

  let installRecord: InstallRecord | null = null;
  try {
    const raw = await AsyncStorage.getItem(
      gender === 'male' ? ASYNC_KEYS.maleInstall : ASYNC_KEYS.femaleInstall,
    );
    if (raw) installRecord = JSON.parse(raw) as InstallRecord;
  } catch { /* ignore */ }

  // Verify ALL files actually exist on disk. Log stale `.download`
  // leftovers so "downloaded but not showing" is diagnosable.
  let allExist = true;
  let staleTemps = 0;
  for (const model of manifest.models) {
    const exists = await fileExists(dir, model.filename);
    if (!exists) {
      allExist = false;
      try {
        const tempInfo = await new File(dir, `${model.filename}.download`).info();
        if (tempInfo.exists) staleTemps += 1;
      } catch { /* ignore */ }
    }
  }
  if (!allExist && staleTemps > 0 && __DEV__) {
    console.log(`[AnatomyDownload] ${gender}: ${staleTemps} stale .download temps — resume to complete`);
  }

  if (!allExist || !installRecord) {
    return { state: 'NOT_INSTALLED', manifest, installRecord: null };
  }

  // Check if an update is available
  if (installRecord.version !== manifest.version) {
    return { state: 'UPDATING', manifest, installRecord };
  }

  return { state: 'INSTALLED', manifest, installRecord };
}

// ---------------------------------------------------------------------------
// Get all installed genders
// ---------------------------------------------------------------------------

export async function getInstalledGenders(): Promise<Gender[]> {
  const result: Gender[] = [];
  for (const g of ['male', 'female'] as Gender[]) {
    const status = await getInstallationStatus(g);
    if (status.state === 'INSTALLED') result.push(g);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Download a gender package
// ---------------------------------------------------------------------------

export async function downloadAnatomy(
  gender: Gender,
  onProgress?: (progress: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  const manifest = getManifest(gender);
  const dir = genderDir(gender);
  await ensureDir(dir);
  // Clear interrupted-run leftovers up front so a resume never reads them
  // as installed and a stale temp never blocks the atomic move.
  await sweepStaleAnatomyTemps(gender).catch(() => 0);

  const totalSize = manifest.models.reduce((sum, m) => sum + m.size, 0);
  let receivedBytes = 0;

  // Log the actual URL and destination being used
  const sampleUrl = getRemoteUrl(gender, manifest.models[0].filename);
  console.log(`[AnatomyDownload] REMOTE_BASE: ${REMOTE_BASE}`);
  console.log(`[AnatomyDownload] Sample URL: ${sampleUrl}`);
  console.log(`[AnatomyDownload] Destination dir: ${dir.uri}`);
  const dirInfo = await dir.info();
  console.log(`[AnatomyDownload] Directory exists: ${dirInfo.exists}`);
  if (REMOTE_BASE.includes('localhost') || REMOTE_BASE.includes('127.0.0.1')) {
    console.warn('[AnatomyDownload] ⚠ URL contains localhost — will NOT work on physical Android device!');
  }

  for (let i = 0; i < manifest.models.length; i++) {
    if (signal?.aborted) throw new Error('Download cancelled');

    const model = manifest.models[i];
    const finalFile = new File(dir, model.filename);
    const tempFile = new File(dir, `${model.filename}.download`);

    // Skip if already downloaded with a plausible size (within 10% tolerance)
    // The manifest size is an estimate — the actual file may differ slightly
    // due to compression, platform differences, or server-side rounding.
    try {
      const existingInfo = await finalFile.info();
      if (existingInfo.exists && existingInfo.size !== undefined && existingInfo.size > 0) {
        const sizeRatio = existingInfo.size / model.size;
        if (sizeRatio >= 0.9 && sizeRatio <= 1.1) {
          receivedBytes += model.size;
          onProgress?.({
            totalBytes: totalSize,
            receivedBytes,
            currentFile: model.filename,
            fileIndex: i,
            fileCount: manifest.models.length,
            percent: Math.round((receivedBytes / totalSize) * 100),
          });
          continue;
        }
        // File exists but wrong size — replace it.
        // Delete the existing file before downloading the replacement.
        try {
          await finalFile.delete();
          console.log(`[AnatomyDownload] Replacing ${model.filename} (size mismatch: ${existingInfo.size} vs ${model.size})`);
        } catch { /* ignore — move will handle it */ }
      }
    } catch { /* file doesn't exist — proceed to download */ }

    // Remove any leftover temp file
    try {
      const tempInfo = await tempFile.info();
      if (tempInfo.exists) await tempFile.delete();
    } catch { /* ignore */ }

    const remoteUrl = getRemoteUrl(gender, model.filename);
    console.log(`[AnatomyDownload] File ${i + 1}/${manifest.models.length}: ${model.filename}`);
    console.log(`[AnatomyDownload]   source: ${remoteUrl}`);
    console.log(`[AnatomyDownload]   dest: ${tempFile.uri}`);

    // Download using the new SDK 57 API
    try {
      await File.downloadFileAsync(remoteUrl, tempFile, {
        headers: { 'Cache-Control': 'no-cache' },
        idempotent: true,
        onProgress: (data) => {
          const fileReceived = receivedBytes + data.bytesWritten;
          onProgress?.({
            totalBytes: totalSize,
            receivedBytes: fileReceived,
            currentFile: model.filename,
            fileIndex: i,
            fileCount: manifest.models.length,
            percent: Math.round((fileReceived / totalSize) * 100),
          });
        },
        signal,
      });
    } catch (err: any) {
      // Clean up temp file on failure
      try { await tempFile.delete(); } catch { /* ignore */ }
      if (signal?.aborted) throw new Error('Download cancelled');

      // Differentiate error types for better user messaging
      const msg = String(err.message || err);
      if (msg.includes('FileNotFoundException') || msg.includes('IOException') || msg.includes('No such file')) {
        throw new Error(`LOCAL_STORAGE_ERROR: Cannot save ${model.filename} — storage directory missing or inaccessible.`);
      }
      if (msg.includes('ECONNREFUSED') || msg.includes('ConnectException') || msg.includes('fetch failed')) {
        throw new Error(`NETWORK_ERROR: Cannot reach anatomy server for ${model.filename}.`);
      }
      throw new Error(`Failed to download ${model.filename}: ${msg}`);
    }

    if (signal?.aborted) {
      try { await tempFile.delete(); } catch { /* ignore */ }
      throw new Error('Download cancelled');
    }

    // Validate downloaded file size
    try {
      const tempInfo = await tempFile.info();
      if (!tempInfo.exists || (tempInfo.size !== undefined && tempInfo.size < model.size * 0.9)) {
        await tempFile.delete();
        throw new Error(`Incomplete download: ${model.filename}`);
      }
    } catch (err: any) {
      if (err.message?.includes('Incomplete')) throw err;
      // If we can't check size, proceed — the file was downloaded
    }

    // Atomic rename: move temp → final.
    // Delete existing destination first to avoid "Destination already exists"
    // errors when a file was partially written or size check was missed.
    try {
      const destInfo = await finalFile.info();
      if (destInfo.exists) {
        console.log(`[AnatomyDownload] Removing existing ${model.filename} before move`);
        await finalFile.delete();
      }
    } catch { /* file doesn't exist — proceed */ }
    try {
      await tempFile.move(finalFile);
    } catch (err: any) {
      // Surface move failures (locked file, no space) instead of leaving a
      // .download that the viewer never reads.
      throw new Error(`Failed to install ${model.filename}: ${String(err?.message ?? err)}`);
    }
    // Verify the final file landed — guards against silent move no-ops.
    if (!(await fileExists(dir, model.filename))) {
      throw new Error(`Failed to install ${model.filename}: final file missing after move`);
    }

    receivedBytes += model.size;
    onProgress?.({
      totalBytes: totalSize,
      receivedBytes,
      currentFile: model.filename,
      fileIndex: i,
      fileCount: manifest.models.length,
      percent: Math.round((receivedBytes / totalSize) * 100),
    });
  }

  // Mark as installed
  const installRecord: InstallRecord = {
    version: manifest.version,
    installedAt: Date.now(),
    fileCount: manifest.models.length,
  };
  await AsyncStorage.setItem(
    gender === 'male' ? ASYNC_KEYS.maleInstall : ASYNC_KEYS.femaleInstall,
    JSON.stringify(installRecord),
  );
}

// ---------------------------------------------------------------------------
// Delete a gender package
// ---------------------------------------------------------------------------

export async function deleteAnatomy(gender: Gender): Promise<void> {
  try {
    const dir = genderDir(gender);
    const info = await dir.info();
    if (info.exists) {
      await dir.delete();
    }
  } catch { /* ignore */ }

  try {
    await AsyncStorage.removeItem(
      gender === 'male' ? ASYNC_KEYS.maleInstall : ASYNC_KEYS.femaleInstall,
    );
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Get local file URI for a model
// ---------------------------------------------------------------------------

export function getLocalModelUri(gender: Gender, filename: string): string {
  const dir = genderDir(gender);
  const file = new File(dir, filename);
  return file.uri;
}

// ---------------------------------------------------------------------------
// Get human-readable storage size for a gender
// ---------------------------------------------------------------------------

export async function getStorageSize(gender: Gender): Promise<string> {
  const manifest = getManifest(gender);
  const totalBytes = manifest.models.reduce((sum, m) => sum + m.size, 0);
  return formatBytes(totalBytes);
}

export { formatBytes };
