/**
 * FilamentBody.tsx — Native 3D anatomy body using react-native-filament.
 *
 * Replaces the Three.js/Expo GL pipeline on native platforms.
 * Key performance gains:
 * - Draco decode happens in native C++ on background thread (not JS)
 * - GLTF parsing happens natively (not JS)
 * - Rendering uses Metal (iOS) / Vulkan (Android) instead of WebGL
 * - No JS thread blocking during model loading
 *
 * Web platforms continue using Three.js via WebCanvas.
 */

import React, {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
  useImperativeHandle,
  forwardRef,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import {
  FilamentScene,
  FilamentView,
  Camera,
  DefaultLight,
  Model,
  EntitySelector,
  useCameraManipulator,
  useFilamentContext,
} from 'react-native-filament';
import type { Entity } from 'react-native-filament';
import { COLORS, SPACING, TYPOGRAPHY } from '@/constants';
import { HealthFact } from '@/components/HealthFact';
import { getMapping, buildNodeToStructureMap } from '@/assets/anatomy/anatomyMap';
import {
  getProceduralBodyUri,
  getProceduralFemaleUri,
  proceduralHighlightNodes,
  proceduralNodeEntries,
} from '@/services/proceduralBody';
import type { LayerLoadState } from './BodyScreen';
import type { Gender } from '@/services/anatomyDownload';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const CANVAS_HEIGHT = SCREEN_HEIGHT * 0.6;

/** Highlight color (teal, matching current Three.js highlight) */
const HIGHLIGHT_BASE_COLOR: [number, number, number, number] = [0.05, 0.58, 0.53, 1.0];
const HIGHLIGHT_EMISSIVE: [number, number, number, number] = [0.05, 0.58, 0.53, 0.3];

// ---------------------------------------------------------------------------
// Scene handle — compatible with BodyScreen's sceneRef usage
// ---------------------------------------------------------------------------

/**
 * Provides the same interface that BodyScreen expects from AnatomySceneManager.
 * The key methods:
 *   loadedGroups.has(), isLayerLoading(), getLayerLoadState(),
 *   loadLayerOnDemand(), setSystemVisibility(), fitCameraToScene(),
 *   loadGeneration, selectStructure(), setOnAutoLoadLayer(), setOnStructureSelected()
 */
export interface FilamentSceneHandle {
  /** Map-like object with has() — matches AnatomySceneManager.loadedGroups API */
  loadedGroups: { has(fileName: string): boolean };
  setSystemVisibility(sysKey: string, visible: boolean): void;
  getSystemVisibility(sysKey: string): boolean;
  selectStructure(structureId: string | null): void;
  fitCameraToScene(): void;
  loadLayerOnDemand(
    fileName: string,
    localUri?: string,
    assetModule?: number,
  ): Promise<void>;
  isLayerLoading(sysKey: string): boolean;
  getLayerLoadState(sysKey: string): LayerLoadState;
  loadGeneration: number;
  setOnAutoLoadLayer(cb: ((layerKey: string) => Promise<void>) | null): void;
  setOnStructureSelected(cb: ((structureId: string | null) => void) | null): void;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface FilamentBodyProps {
  gender: Gender;
  onStructureSelected: (structureId: string | null) => void;
  sceneRef: React.MutableRefObject<FilamentSceneHandle | null>;
  localFiles?: Map<string, string>;
  isFocused: boolean;
}

// ---------------------------------------------------------------------------
// Inner component (must be inside FilamentScene)
// ---------------------------------------------------------------------------

const FilamentBodyInner = forwardRef<FilamentSceneHandle, FilamentBodyProps>(
  function FilamentBodyInner(
    { gender, onStructureSelected, sceneRef, localFiles, isFocused },
    _ref,
  ) {
    const { nameComponentManager } = useFilamentContext();
    const [selectedStructure, setSelectedStructure] = useState<string | null>(null);
    const [activeLayers, setActiveLayers] = useState<Set<string>>(
      new Set(['regional']),
    );
    const layerLoadStates = useRef<Map<string, LayerLoadState>>(new Map());
    const pendingLoads = useRef<Map<string, Promise<void>>>(new Map());
    const loadGenerationRef = useRef(0);
    const onAutoLoadLayerRef = useRef<((layerKey: string) => Promise<void>) | null>(null);
    const onStructureSelectedRef = useRef<((id: string | null) => void) | null>(null);
    const nodeToStructureRef = useRef(buildNodeToStructureMap(gender));
    const [proceduralUri, setProceduralUri] = useState<string | null>(null);

    // Bundled procedural shells (v2, male + female): resolve once,
    // offline-safe. Merged into the tap map (identity entries never
    // collide with Anatria node names) and used as the base layer whenever
    // the downloaded regional model is missing — the blank-screen killer.
    useEffect(() => {
      let live = true;
      for (const [node, structure] of proceduralNodeEntries()) {
        if (!nodeToStructureRef.current.has(node)) {
          nodeToStructureRef.current.set(node, structure);
        }
      }
      void (gender === 'male' ? getProceduralBodyUri() : getProceduralFemaleUri()).then((uri) => {
        if (live) setProceduralUri(uri);
      });
      return () => {
        live = false;
      };
    }, [gender]);
    const loadedFilesRef = useRef<Set<string>>(new Set(['regional']));

    // Camera manipulator
    const cameraManipulator = useCameraManipulator({
      orbitHomePosition: [0, 0.3, 2.5],
      targetPosition: [0, 0.3, 0],
      upVector: [0, 1, 0],
    });

    // Regional model URI
    const regionalFile = gender === 'male' ? 'regional_male.glb' : 'skeletal_female.glb';
    const regionalUri = localFiles?.get(regionalFile);

    // Procedural fallback: bundled shell renders when the download missed.
    const proceduralActive = !regionalUri && proceduralUri !== null;
    const displayRegionalUri = regionalUri ?? proceduralUri;

    // Highlighted node names
    const highlightedNodes = useMemo(() => {
      if (!selectedStructure) return new Set<string>();
      if (proceduralActive) return new Set(proceduralHighlightNodes(selectedStructure));
      const mapping = getMapping(selectedStructure);
      if (!mapping) return new Set<string>();
      return new Set([...mapping.male, ...mapping.female].map((r) => r.nodeName));
    }, [selectedStructure, proceduralActive]);

    // ----- Focus-aware lifecycle -----
    // FilamentView handles surface lifecycle automatically.
    // We use opacity to hide when not focused, preserving the GL surface.

    // ----- Entity press handler -----
    const handleEntityPress = useCallback(
      (entity: Entity) => {
        if (!nameComponentManager) return;
        const name = nameComponentManager.getEntityName(entity);
        if (name) {
          const structureId = nodeToStructureRef.current.get(name);
          if (structureId) {
            setSelectedStructure(structureId);
            onStructureSelected(structureId);
            onStructureSelectedRef.current?.(structureId);
          }
        }
      },
      [nameComponentManager, onStructureSelected],
    );

    // ----- Expose handle to parent via useImperativeHandle -----
    useImperativeHandle(
      _ref,
      () => ({
        loadedGroups: {
          has(fileName: string): boolean {
            return loadedFilesRef.current.has(fileName);
          },
        },

        setSystemVisibility(sysKey: string, visible: boolean) {
          if (visible) {
            setActiveLayers((prev) => new Set([...prev, sysKey]));
          } else {
            setActiveLayers((prev) => {
              const next = new Set(prev);
              next.delete(sysKey);
              return next;
            });
          }
          console.log(`[FilamentBody] System "${sysKey}" visibility → ${visible}`);
        },

        getSystemVisibility(sysKey: string): boolean {
          return activeLayers.has(sysKey);
        },

        selectStructure(structureId: string | null) {
          setSelectedStructure(structureId);
        },

        fitCameraToScene() {
          console.log('[FilamentBody] fitCameraToScene — handled by CameraManipulator');
        },

        async loadLayerOnDemand(
          fileName: string,
          localUri?: string,
          _assetModule?: number,
        ): Promise<void> {
          const sysKey = fileName.replace(/_male\.glb$/, '').replace(/_female\.glb$/, '');

          if (loadedFilesRef.current.has(fileName)) return;

          const pending = pendingLoads.current.get(fileName);
          if (pending) return pending;

          layerLoadStates.current.set(sysKey, 'loading');
          loadGenerationRef.current++;
          const gen = loadGenerationRef.current;
          const t0 = performance.now();
          console.log(`[FilamentBody] LAYER_LOAD_START ${fileName} gen=${gen}`);

          const promise = (async () => {
            try {
              // Filament <Model> handles native decode — just add to active layers
              if (localUri) {
                setActiveLayers((prev) => new Set([...prev, sysKey]));
                loadedFilesRef.current.add(fileName);
              }

              if (loadGenerationRef.current !== gen) {
                console.log(`[FilamentBody] LAYER_LOAD_DISCARDED ${fileName} — gen changed`);
                return;
              }

              layerLoadStates.current.set(sysKey, 'loaded');
              const elapsed = (performance.now() - t0).toFixed(0);
              console.log(`[FilamentBody] LAYER_LOAD_COMPLETE ${fileName} ${elapsed}ms gen=${gen}`);
            } catch (err: any) {
              layerLoadStates.current.set(sysKey, 'error');
              const elapsed = (performance.now() - t0).toFixed(0);
              console.error(
                `[FilamentBody] LAYER_LOAD_FAILED ${fileName} after ${elapsed}ms error=${err?.message ?? err}`,
              );
            } finally {
              pendingLoads.current.delete(fileName);
            }
          })();

          pendingLoads.current.set(fileName, promise);
          return promise;
        },

        isLayerLoading(sysKey: string): boolean {
          return layerLoadStates.current.get(sysKey) === 'loading';
        },

        getLayerLoadState(sysKey: string): LayerLoadState {
          return layerLoadStates.current.get(sysKey) ?? 'idle';
        },

        get loadGeneration() {
          return loadGenerationRef.current;
        },

        setOnAutoLoadLayer(cb: ((layerKey: string) => Promise<void>) | null) {
          onAutoLoadLayerRef.current = cb;
        },

        setOnStructureSelected(cb: ((id: string | null) => void) | null) {
          onStructureSelectedRef.current = cb;
        },
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [activeLayers, gender],
    );

    // ----- Render callback for camera update -----
    // Must be a worklet: FilamentView calls this on the worklet thread.
    const renderCallback = useCallback(() => {
      'worklet';
      if (cameraManipulator) {
        cameraManipulator.update(1 / 60);
      }
    }, [cameraManipulator]);

    return (
      <View style={styles.container}>
        <FilamentView
          style={{ width: SCREEN_WIDTH, height: CANVAS_HEIGHT, opacity: isFocused ? 1 : 0 }}
          renderCallback={renderCallback}
        >
          <Camera
            cameraManipulator={cameraManipulator}
            cameraPosition={[0, 0.3, 2.5]}
            cameraTarget={[0, 0.3, 0]}
            cameraUp={[0, 1, 0]}
          />
          <DefaultLight />

          {/* Regional body — downloaded when present, bundled procedural shell otherwise */}
          {displayRegionalUri && (
            <Model
              key={proceduralActive ? 'procedural-shell' : regionalUri}
              source={{ uri: displayRegionalUri }}
              onPress={handleEntityPress}
              castShadow
              receiveShadow
            />
          )}

          {/* Active layers (on-demand) */}
          {Array.from(activeLayers)
            .filter((l) => l !== 'regional')
            .map((layer) => {
              const file = `${layer}_${gender}.glb`;
              const uri = localFiles?.get(file);
              if (!uri) return null;
              return (
                <Model
                  key={`${layer}-${gender}-${uri}`}
                  source={{ uri }}
                  onPress={handleEntityPress}
                  castShadow
                  receiveShadow
                />
              );
            })}

          {/* Highlighted nodes */}
          {Array.from(highlightedNodes).map((nodeName) => (
            <EntitySelector
              key={nodeName}
              byName={nodeName}
              materialParameters={{
                index: 0,
                parameters: {
                  baseColorFactor: HIGHLIGHT_BASE_COLOR,
                  emissiveFactor: HIGHLIGHT_EMISSIVE,
                  roughnessFactor: 0.3,
                  metallicFactor: 0.15,
                },
              }}
            />
          ))}
        </FilamentView>
      </View>
    );
  },
);

// ---------------------------------------------------------------------------
// Exported wrapper — provides FilamentScene context
// ---------------------------------------------------------------------------

export default function FilamentBody(props: FilamentBodyProps) {
  const innerRef = useRef<FilamentSceneHandle>(null);

  // Forward the inner ref to the parent's sceneRef
  useEffect(() => {
    props.sceneRef.current = innerRef.current;
    return () => {
      props.sceneRef.current = null;
    };
  }, [props.sceneRef]);

  return (
    <FilamentScene fallback={<LoadingFallback />}>
      <FilamentBodyInner ref={innerRef} {...props} />
    </FilamentScene>
  );
}

// ---------------------------------------------------------------------------
// Loading fallback
// ---------------------------------------------------------------------------

function LoadingFallback() {
  return (
    <View style={styles.loadingOverlay}>
      <ActivityIndicator size="large" color={COLORS.primary} />
      <Text style={styles.loadingText}>Initializing 3D engine…</Text>
      <HealthFact style={styles.factText} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    width: SCREEN_WIDTH,
    height: CANVAS_HEIGHT,
    backgroundColor: COLORS.background,
    overflow: 'hidden',
  },
  filamentView: {
    width: SCREEN_WIDTH,
    height: CANVAS_HEIGHT,
  },
  loadingOverlay: {
    width: SCREEN_WIDTH,
    height: CANVAS_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
  },
  loadingText: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
    marginTop: SPACING.sm,
  },
  factText: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
    textAlign: 'center',
    maxWidth: 300,
    marginTop: SPACING.sm,
  },
});
