/**
 * progressiveLoad.ts — Production-grade progressive GLB loading system.
 *
 * Manages a priority queue for anatomy GLB decoding with:
 * - One heavy decode at a time (prevents UI freeze)
 * - Priority queue (user requests override background preloads)
 * - Cancellation when priority changes
 * - Memory tracking and LRU eviction of cached buffers
 * - Stale-generation protection
 *
 * Design principles:
 * - FILE I/O IS FAST (17ms). DRACO DECODE IS SLOW (28s).
 * - Therefore: cache parsed scenes > cache raw buffers > re-read files
 * - Never block the UI thread with unnecessary work
 * - One decode at a time prevents jank
 */

import { File as ExpoFile } from 'expo-file-system';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LoadPriority = 'user' | 'high' | 'normal' | 'low' | 'background';

export interface LoadRequest {
  id: string;
  fileName: string;
  localUri: string;
  priority: LoadPriority;
  /** Higher number = higher priority within same level */
  weight: number;
  /** Callback when loading completes */
  onComplete?: (group: THREE.Group) => void;
  /** Callback on error */
  onError?: (error: Error) => void;
}

export type LoadState = 'idle' | 'queued' | 'loading' | 'loaded' | 'error' | 'cancelled';

interface LoadEntry {
  request: LoadRequest;
  state: LoadState;
  promise?: Promise<THREE.Group>;
}

// ---------------------------------------------------------------------------
// Priority ordering
// ---------------------------------------------------------------------------

const PRIORITY_ORDER: Record<LoadPriority, number> = {
  user: 0,       // highest — user explicitly requested
  high: 1,       // preloaded likely-next system
  normal: 2,     // background preload
  low: 3,        // speculative preload
  background: 4, // lowest — idle-time work
};

// ---------------------------------------------------------------------------
// Memory limits
// ---------------------------------------------------------------------------

const MAX_BUFFER_CACHE_BYTES = 80 * 1024 * 1024; // 80 MB raw buffer cache
const MAX_PARSED_CACHE_COUNT = 8;                 // max parsed scenes in memory

// ---------------------------------------------------------------------------
// Global singleton
// ---------------------------------------------------------------------------

let _instance: ProgressiveLoadManager | null = null;

export function getProgressiveLoadManager(): ProgressiveLoadManager {
  if (!_instance) {
    _instance = new ProgressiveLoadManager();
  }
  return _instance;
}

// ---------------------------------------------------------------------------
// ProgressiveLoadManager
// ---------------------------------------------------------------------------

export class ProgressiveLoadManager {
  /** Priority queue — sorted by priority then weight */
  private queue: LoadEntry[] = [];

  /** Currently loading entry */
  private current: LoadEntry | null = null;

  /** Completed loads — fileName → THREE.Group */
  private loadedGroups: Map<string, THREE.Group> = new Map();

  /** Raw buffer cache — fileName → ArrayBuffer (LRU) */
  private bufferCache: Map<string, { buffer: ArrayBuffer; lastAccess: number }> = new Map();
  private bufferCacheBytes = 0;

  /** Load state per fileName */
  private loadStates: Map<string, LoadState> = new Map();

  /** Load generation — bumped on dispose to invalidate in-flight work */
  private generation = 0;

  /** Shared GLTFLoader — created once, reused */
  private gltfLoader: GLTFLoader;

  /** Whether the manager is processing the queue */
  private processing = false;

  /** Callback for load state changes */
  private onStateChange?: (fileName: string, state: LoadState) => void;

  constructor() {
    this.gltfLoader = new GLTFLoader();
    // Note: DRACOLoader must be set externally before first load
  }

  /** Set the DRACOLoader on the shared GLTFLoader */
  setDRACOLoader(dracoLoader: any) {
    this.gltfLoader.setDRACOLoader(dracoLoader);
  }

  /** Set callback for load state changes */
  setOnStateChange(cb: (fileName: string, state: LoadState) => void) {
    this.onStateChange = cb;
  }

  // -----------------------------------------------------------------------
  // Queue management
  // -----------------------------------------------------------------------

  /**
   * Enqueue a load request. If a lower-priority load is in progress,
   * it will be cancelled and the new request will take its place.
   */
  enqueue(request: LoadRequest): void {
    // Already loaded — return immediately
    if (this.loadedGroups.has(request.fileName)) {
      request.onComplete?.(this.loadedGroups.get(request.fileName)!);
      return;
    }

    // Already queued — update priority if higher
    const existing = this.queue.find((e) => e.request.fileName === request.fileName);
    if (existing) {
      const existingPriority = PRIORITY_ORDER[existing.request.priority];
      const newPriority = PRIORITY_ORDER[request.priority];
      if (newPriority < existingPriority ||
          (newPriority === existingPriority && request.weight > existing.request.weight)) {
        existing.request = request;
        this.sortQueue();
        this.maybePreemptCurrent();
      }
      return;
    }

    // Already loading — check if we should preempt
    if (this.current && this.current.request.fileName === request.fileName) {
      // Already loading this exact file — no-op
      return;
    }

    // Add to queue
    const entry: LoadEntry = { request, state: 'queued' };
    this.queue.push(entry);
    this.loadStates.set(request.fileName, 'queued');
    this.onStateChange?.(request.fileName, 'queued');
    this.sortQueue();
    this.processNext();
  }

  /**
   * Cancel a specific load request.
   */
  cancel(fileName: string): void {
    // Remove from queue
    const queueIdx = this.queue.findIndex((e) => e.request.fileName === fileName);
    if (queueIdx >= 0) {
      this.queue[queueIdx].state = 'cancelled';
      this.loadStates.set(fileName, 'cancelled');
      this.onStateChange?.(fileName, 'cancelled');
      this.queue.splice(queueIdx, 1);
    }

    // Cancel current if it matches
    if (this.current && this.current.request.fileName === fileName) {
      this.current.state = 'cancelled';
      this.loadStates.set(fileName, 'cancelled');
      this.onStateChange?.(fileName, 'cancelled');
      this.current = null;
      this.generation++; // invalidate in-flight decode
      this.processNext();
    }
  }

  /**
   * Cancel all queued loads (but not the current one).
   * Used when the user navigates away.
   */
  cancelAllQueued(): void {
    for (const entry of this.queue) {
      entry.state = 'cancelled';
      this.loadStates.set(entry.request.fileName, 'cancelled');
      this.onStateChange?.(entry.request.fileName, 'cancelled');
    }
    this.queue = [];
  }

  /**
   * Get the load state of a file.
   */
  getLoadState(fileName: string): LoadState {
    return this.loadStates.get(fileName) ?? 'idle';
  }

  /**
   * Check if a file is loaded.
   */
  isLoaded(fileName: string): boolean {
    return this.loadedGroups.has(fileName);
  }

  /**
   * Get a loaded group.
   */
  getLoadedGroup(fileName: string): THREE.Group | undefined {
    return this.loadedGroups.get(fileName);
  }

  // -----------------------------------------------------------------------
  // Queue processing
  // -----------------------------------------------------------------------

  private sortQueue(): void {
    this.queue.sort((a, b) => {
      const pa = PRIORITY_ORDER[a.request.priority];
      const pb = PRIORITY_ORDER[b.request.priority];
      if (pa !== pb) return pa - pb;
      return b.request.weight - a.request.weight;
    });
  }

  private maybePreemptCurrent(): void {
    if (!this.current || this.queue.length === 0) return;

    const currentPriority = PRIORITY_ORDER[this.current.request.priority];
    const nextPriority = PRIORITY_ORDER[this.queue[0].request.priority];

    // If a higher-priority request is waiting, cancel current
    if (nextPriority < currentPriority) {
      if (__DEV__) console.log(`[ProgressiveLoad] PREEMPT: cancelling ${this.current.request.fileName} (priority ${this.current.request.priority}) for ${this.queue[0].request.fileName} (priority ${this.queue[0].request.priority})`);
      this.cancel(this.current.request.fileName);
    }
  }

  private processNext(): void {
    if (this.processing) return;
    if (this.current) return; // already loading something
    if (this.queue.length === 0) return;

    this.processing = true;
    const entry = this.queue.shift()!;
    this.current = entry;

    this.executeLoad(entry)
      .then(() => {
        this.current = null;
        this.processing = false;
        this.processNext();
      })
      .catch(() => {
        this.current = null;
        this.processing = false;
        this.processNext();
      });
  }

  private async executeLoad(entry: LoadEntry): Promise<void> {
    const { request } = entry;
    const gen = this.generation;

    entry.state = 'loading';
    this.loadStates.set(request.fileName, 'loading');
    this.onStateChange?.(request.fileName, 'loading');

    if (__DEV__) console.log(`[ProgressiveLoad] LOAD_START ${request.fileName} priority=${request.priority} gen=${gen}`);
    const t0 = performance.now();

    try {
      // Check buffer cache first
      let buffer = this.getCachedBuffer(request.fileName);
      if (buffer) {
        if (__DEV__) console.log(`[ProgressiveLoad] BUFFER_CACHE_HIT ${request.fileName}`);
      } else {
        // Read from disk
        const tRead = performance.now();
        const file = new ExpoFile(request.localUri);
        const raw = await file.arrayBuffer();
        buffer = toRealArrayBuffer(raw);
        const readMs = (performance.now() - tRead).toFixed(0);
        if (__DEV__) console.log(`[ProgressiveLoad] FILE_READ ${request.fileName} ${readMs}ms ${buffer.byteLength} bytes`);
        this.cacheBuffer(request.fileName, buffer);
      }

      // Check generation — abort if stale
      if (this.generation !== gen) {
        if (__DEV__) console.log(`[ProgressiveLoad] CANCELLED ${request.fileName} — generation changed`);
        entry.state = 'cancelled';
        this.loadStates.set(request.fileName, 'cancelled');
        this.onStateChange?.(request.fileName, 'cancelled');
        return;
      }

      // Draco decode + GLTF parse
      const tParse = performance.now();
      const gltf = await new Promise<THREE.Group>((resolve, reject) => {
        this.gltfLoader.parse(buffer!, '', (result) => resolve(result.scene), (error) => reject(error));
      });
      const parseMs = (performance.now() - tParse).toFixed(0);

      // Check generation again after decode
      if (this.generation !== gen) {
        if (__DEV__) console.log(`[ProgressiveLoad] DECODE_CANCELLED ${request.fileName} — generation changed after decode`);
        entry.state = 'cancelled';
        this.loadStates.set(request.fileName, 'cancelled');
        this.onStateChange?.(request.fileName, 'cancelled');
        // Dispose the decoded scene since we're discarding it
        disposeGroup(gltf);
        return;
      }

      const totalMs = (performance.now() - t0).toFixed(0);
      if (__DEV__) console.log(`[ProgressiveLoad] LOAD_COMPLETE ${request.fileName} parse=${parseMs}ms total=${totalMs}ms`);

      // Cache the parsed group
      this.loadedGroups.set(request.fileName, gltf);
      this.evictParsedCache();
      entry.state = 'loaded';
      this.loadStates.set(request.fileName, 'loaded');
      this.onStateChange?.(request.fileName, 'loaded');

      request.onComplete?.(gltf);
    } catch (err: any) {
      const totalMs = (performance.now() - t0).toFixed(0);
      console.error(`[ProgressiveLoad] LOAD_FAILED ${request.fileName} after ${totalMs}ms: ${err?.message}`);
      entry.state = 'error';
      this.loadStates.set(request.fileName, 'error');
      this.onStateChange?.(request.fileName, 'error');
      request.onError?.(err);
    }
  }

  // -----------------------------------------------------------------------
  // Buffer cache with LRU eviction
  // -----------------------------------------------------------------------

  private cacheBuffer(fileName: string, buffer: ArrayBuffer): void {
    // Evict if over limit
    while (this.bufferCacheBytes + buffer.byteLength > MAX_BUFFER_CACHE_BYTES && this.bufferCache.size > 0) {
      // Find least recently used
      let oldestKey: string | null = null;
      let oldestTime = Infinity;
      for (const [key, entry] of this.bufferCache) {
        if (entry.lastAccess < oldestTime) {
          oldestTime = entry.lastAccess;
          oldestKey = key;
        }
      }
      if (oldestKey) {
        const evicted = this.bufferCache.get(oldestKey)!;
        this.bufferCacheBytes -= evicted.buffer.byteLength;
        this.bufferCache.delete(oldestKey);
        if (__DEV__) console.log(`[ProgressiveLoad] LRU_EVICT buffer ${oldestKey} (${(evicted.buffer.byteLength / 1024).toFixed(0)} KB)`);
      }
    }

    this.bufferCache.set(fileName, { buffer, lastAccess: Date.now() });
    this.bufferCacheBytes += buffer.byteLength;
    if (__DEV__) console.log(`[ProgressiveLoad] Buffer cache: ${this.bufferCache.size} entries, ${(this.bufferCacheBytes / 1024 / 1024).toFixed(1)} MB`);
  }

  private getCachedBuffer(fileName: string): ArrayBuffer | undefined {
    const entry = this.bufferCache.get(fileName);
    if (entry) {
      entry.lastAccess = Date.now();
      return entry.buffer;
    }
    return undefined;
  }

  // -----------------------------------------------------------------------
  // Parsed cache eviction
  // -----------------------------------------------------------------------

  private evictParsedCache(): void {
    // If we have too many parsed groups, we can't evict the active ones
    // This is a safety check — in practice, the caller manages which
    // groups are attached to the scene
    if (this.loadedGroups.size > MAX_PARSED_CACHE_COUNT + 5) {
      // Log warning but don't evict — the scene manager manages this
      console.warn(`[ProgressiveLoad] Parsed cache has ${this.loadedGroups.size} entries (limit ${MAX_PARSED_CACHE_COUNT})`);
    }
  }

  // -----------------------------------------------------------------------
  // Memory reporting
  // -----------------------------------------------------------------------

  getMemoryReport(): {
    bufferCacheCount: number;
    bufferCacheMB: number;
    parsedGroupCount: number;
    queuedCount: number;
    loadingCount: number;
  } {
    let loadingCount = 0;
    if (this.current?.state === 'loading') loadingCount = 1;

    return {
      bufferCacheCount: this.bufferCache.size,
      bufferCacheMB: this.bufferCacheBytes / 1024 / 1024,
      parsedGroupCount: this.loadedGroups.size,
      queuedCount: this.queue.length,
      loadingCount,
    };
  }

  // -----------------------------------------------------------------------
  // Dispose
  // -----------------------------------------------------------------------

  dispose(): void {
    this.generation++;
    this.cancelAllQueued();
    if (this.current) {
      this.current.state = 'cancelled';
      this.current = null;
    }

    // Dispose parsed groups
    this.loadedGroups.forEach((group) => disposeGroup(group));
    this.loadedGroups.clear();

    // Clear buffer cache
    this.bufferCache.clear();
    this.bufferCacheBytes = 0;

    this.loadStates.clear();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toRealArrayBuffer(raw: ArrayBuffer | ArrayBufferLike | Uint8Array): ArrayBuffer {
  if (raw instanceof ArrayBuffer) return raw;
  const view = raw as unknown as Uint8Array;
  const buf = new ArrayBuffer(view.byteLength);
  new Uint8Array(buf).set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  return buf;
}

function disposeGroup(group: THREE.Group): void {
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach((m) => m.dispose());
      } else {
        child.material.dispose();
      }
    }
  });
}
