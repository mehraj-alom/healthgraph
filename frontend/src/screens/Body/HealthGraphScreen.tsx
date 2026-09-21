/**
 * HealthGraphScreen — 3D health graph using Three.js + expo-gl.
 *
 * Night instrument voice (Oura formula): cool near-black canvas, flat crisp
 * nodes in domain hues, floating labels so every major node reads without a
 * tap, verdicts in teal/soft-coral only. Same proven rendering approach:
 * - expo-gl GLView for native GL context
 * - Canvas shim for Three.js compatibility
 * - THREE.WebGLRenderer with the shimmed canvas
 * - PerspectiveCamera with group-based orbit
 *
 * Visual hierarchy:
 * - Patient: large white hub + teal glow
 * - Observations / events: domain hue by metric family (sleep indigo,
 *   energy amber, move teal, fuel sky, heart rose, mind violet)
 * - Body structures: neutral slate anchors
 * - Documents: soft violet records
 * - Edges: domain-tinted arcs; semantic links thicker + brighter
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Dimensions,
  ScrollView,
  Platform,
  Vibration,
  type GestureResponderEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { GLView } from 'expo-gl';
import * as THREE from 'three';
import { useReducedMotion } from '@/theme';

import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
import { Chip } from '@/components';
import { useHealthGraph, useGraphNodeDetail, type GraphNode, type GraphEdge, type NodeDetailPayload, type GraphCitation } from '@/hooks/useHealthGraph';
import { useTrends } from '@/hooks/useTrends';
import { useDailyMetrics } from '@/hooks/useDailyMetrics';
import { useCorrelationFeed } from '@/screens/Dashboard/correlations';
import { buildSemanticEdges, neighborVerdictsFor, relationshipLabel, type NeighborVerdict } from '@/screens/Body/semanticEdges';
import { formatSleepMinutes, formatWaterMl, formatDurationMinutes } from '@/screens/Dashboard/homeData';
import { SPOKE_GUIDANCE } from '@/components/home/HGraphMap';
import type { DailyCheckInDetail, RootStackParamList } from '@/types';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const CANVAS_HEIGHT = SCREEN_HEIGHT * 0.55;

// On-screen build fingerprint (dev only) — proves which bundle a screenshot runs.
const GRAPH_BUILD_TAG = 'labels-v1';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'HealthGraph'>;

// ═══════════════════════════════════════════════════════════════════════════════
// Visual constants
// ═══════════════════════════════════════════════════════════════════════════════

// ═══ Domain color system (night instrument — color is information) ═══
// Sleep indigo · energy amber · move teal · fuel sky · heart rose ·
// mind violet. Off-track verdicts speak soft coral, on-track teal.
// (Per-node hues resolve in nodeDomainColor below — the single source.)

const NODE_COLORS: Record<string, string> = {
  patient: '#FFFFFF',
  body_structure: '#7C8DA6',
  observation: '#4FD1C5',
  document: '#8A7BC8',
  timeline_event: '#F5A623',
  medication: '#4FD1C5',
  medication_taken_event: '#3AA79D',
  // P0 Concept-lite (shared terminology reference, terminal for traversal).
  concept: '#9AA8B8',
  // P1 clinical graph expansion.
  medication_request: '#4FD1C5',
  condition_occurrence: '#F28B7E',
  visit: '#5B6B82',
  patient_statement: '#B8A6E8',
  medication_canonical: '#3AA79D',
  // P2 measurement split + regimen versions.
  measurement: '#F27E93',
  medication_version: '#3AA79D',
  // P3 longitudinal personal-health domains (USER_REPORTED/device hues).
  sleep_episode: '#7C6FF0',
  activity_event: '#4FD1C5',
  nutrition_intake: '#6EC1E4',
  food_scan: '#6EC1E4',
  food_entry: '#6EC1E4',
  ppg_measurement: '#F27E93',
};

const NODE_SIZES: Record<string, number> = {
  patient: 0.30,
  body_structure: 0.17,
  observation: 0.15,
  document: 0.09,
  timeline_event: 0.08,
  medication: 0.15,
  medication_taken_event: 0.08,
  concept: 0.06,
  medication_request: 0.13,
  condition_occurrence: 0.14,
  visit: 0.12,
  patient_statement: 0.08,
  medication_canonical: 0.10,
  measurement: 0.10,
  medication_version: 0.07,
  sleep_episode: 0.10,
  activity_event: 0.10,
  nutrition_intake: 0.10,
  food_scan: 0.11,
  food_entry: 0.07,
  ppg_measurement: 0.10,
};

const CATEGORY_LABELS: Record<string, string> = {
  patient: 'You',
  body_structure: 'Body',
  observation: 'Observation',
  document: 'Record',
  timeline_event: 'Event',
  medication: 'Medication',
  medication_taken_event: 'Dose Taken',
  concept: 'Concept',
  medication_request: 'Med Request',
  condition_occurrence: 'Condition',
  visit: 'Visit',
  patient_statement: 'Statement',
  medication_canonical: 'Medication',
  measurement: 'Measurement',
  medication_version: 'Regimen v.',
  sleep_episode: 'Sleep',
  activity_event: 'Activity',
  nutrition_intake: 'Nutrition',
  food_scan: 'Food Scan',
  food_entry: 'Food',
  ppg_measurement: 'Heart',
};

// Renderer budgets (mobile-GPU-first: everything merged + instanced).
const MAX_PULSES = 40;
const MAX_BADGES = 64;
// Dim factor for non-focused nodes/edges in focus mode.
const DIM = 0.14;

/**
 * Domain hue for ANY node — single source for the 3D instances, the filter
 * dots, and the floating labels. Observations resolve by metric family so a
 * sleep dot is indigo everywhere it appears.
 */
export function nodeDomainColor(node: GraphNode): string {
  if (node.type === 'patient') return '#FFFFFF';
  if (node.type === 'body_structure') return '#7C8DA6';
  if (node.type === 'document') return '#8A7BC8';
  if (node.type === 'medication') return '#4FD1C5';
  if (node.type === 'medication_taken_event') return '#3AA79D';
  // P0–P3 graph types resolve by type first (metric sniffing below stays
  // as a fallback for legacy observation/timeline_event nodes).
  if (node.type === 'concept' || node.type === 'medication_canonical') return '#9AA8B8';
  if (node.type === 'medication_request') return '#4FD1C5';
  if (node.type === 'condition_occurrence') return '#F28B7E';
  if (node.type === 'visit') return '#5B6B82';
  if (node.type === 'patient_statement') return '#B8A6E8';
  if (node.type === 'measurement' || node.type === 'ppg_measurement') return '#F27E93';
  if (node.type === 'medication_version') return '#3AA79D';
  if (node.type === 'sleep_episode') return '#7C6FF0';
  if (node.type === 'activity_event') return '#4FD1C5';
  if (node.type === 'nutrition_intake' || node.type === 'food_scan' || node.type === 'food_entry') return '#6EC1E4';
  const hay = `${node.label ?? ''} ${node.properties?.observation_type ?? ''} ${node.properties?.category ?? ''} ${node.properties?.event_type ?? ''}`.toLowerCase();
  if (/(heart|pulse|bpm|blood|pressure|oxygen|spo2|glucose|temperatur|respir|hrv)/.test(hay)) return '#F27E93';
  if (/(sleep|wake|bedtime|insomnia)/.test(hay)) return '#7C6FF0';
  if (/(energy)/.test(hay)) return '#F5A623';
  if (/(activ|move|exercise|walk|step|workout|strain)/.test(hay)) return '#4FD1C5';
  if (/(water|drink|hydrat|meal|nutri|appetite|food|calori)/.test(hay)) return '#6EC1E4';
  if (/(wellbeing|well-being|mood)/.test(hay)) return '#4FD1C5';
  if (/(stress|anxiety|pain|symptom|ache)/.test(hay)) return '#B8A6E8';
  if (node.type === 'timeline_event') return '#F5A623';
  if (node.type === 'observation') return '#9A9AA5';
  return '#9AA8B8';
}

// ═══════════════════════════════════════════════════════════════════════════════
// Deterministic hash
// ═══════════════════════════════════════════════════════════════════════════════

function stableHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3D Layout — simple radial with visual hierarchy
// ═══════════════════════════════════════════════════════════════════════════════

interface LayoutPos { x: number; y: number; z: number; }

/** Screen-space projection of one labeled node (floating label overlay). */
export interface NodeLabelProjection {
  id: string;
  x: number;
  y: number;
  behind: boolean;
}

/** A node worth naming on the canvas (computed by the parent from data). */
export interface NodeLabelDef {
  id: string;
  text: string;
  color: string;
}

function computeLayout(nodes: GraphNode[], edges: GraphEdge[]): Map<string, LayoutPos> {
  const positions = new Map<string, LayoutPos>();

  const obsToBody = new Map<string, string>();
  for (const edge of edges) {
    if (edge.relationship === 'AFFECTS') obsToBody.set(edge.source, edge.target);
  }

  const patient = nodes.find((n) => n.type === 'patient');
  const bodyStructures = nodes.filter((n) => n.type === 'body_structure');
  const observations = nodes.filter((n) => n.type === 'observation');
  const documents = nodes.filter((n) => n.type === 'document');
  const timelineEvents = nodes.filter((n) => n.type === 'timeline_event');

  // Patient at center
  if (patient) positions.set(patient.id, { x: 0, y: 0, z: 0 });

  // Body structures: tall ellipse (portrait screens are narrow + tall —
  // the graph must fill height, not width).
  const bodyCount = bodyStructures.length || 1;
  bodyStructures.forEach((bs, i) => {
    const angle = ((2 * Math.PI) / bodyCount) * i;
    positions.set(bs.id, {
      x: Math.cos(angle) * 0.8,
      y: Math.sin(angle) * 1.0,
      z: ((stableHash(bs.id) % 100) / 100 - 0.5) * 0.5,
    });
  });

  // Observations: cluster near their body structure
  const obsByBody = new Map<string, GraphNode[]>();
  const obsFree: GraphNode[] = [];
  for (const obs of observations) {
    const bid = obsToBody.get(obs.id);
    if (bid && positions.has(bid)) {
      const arr = obsByBody.get(bid) ?? []; arr.push(obs); obsByBody.set(bid, arr);
    } else { obsFree.push(obs); }
  }
  for (const [bid, list] of obsByBody) {
    const bp = positions.get(bid)!;
    const step = (2 * Math.PI) / Math.max(list.length, 1);
    list.forEach((obs, i) => {
      positions.set(obs.id, {
        x: bp.x + Math.cos(step * i) * 0.3,
        y: bp.y + Math.sin(step * i) * 0.3,
        z: bp.z + ((stableHash(obs.id) % 60) / 60 - 0.5) * 0.25,
      });
    });
  }
  // Free observations: secondary tall ellipse
  if (obsFree.length > 0) {
    obsFree.forEach((obs, i) => {
      const a = ((2 * Math.PI) / obsFree.length) * i;
      positions.set(obs.id, {
        x: Math.cos(a) * 1.0,
        y: Math.sin(a) * 1.25,
        z: ((stableHash(obs.id) % 80) / 80 - 0.5) * 0.6,
      });
    });
  }

  // Documents: near source observation (tight cluster)
  // P4: accept both the legacy SOURCE_DOCUMENT link and the canonical
  // DOCUMENTED_IN link (dual-written since P0).
  for (const doc of documents) {
    let src: string | null = null;
    for (const e of edges) {
      if ((e.relationship === 'SOURCE_DOCUMENT' || e.relationship === 'DOCUMENTED_IN') && e.target === doc.id) {
        src = e.source; break;
      }
    }
    const op = src ? positions.get(src) : null;
    const h = stableHash(doc.id);
    const a = ((h % 360) / 360) * Math.PI * 2;
    if (op) {
      positions.set(doc.id, { x: op.x + Math.cos(a) * 0.25, y: op.y + Math.sin(a) * 0.25, z: op.z + ((h % 40) / 40 - 0.5) * 0.15 });
    } else {
      positions.set(doc.id, { x: Math.cos(a) * 1.2, y: Math.sin(a) * 1.6, z: 0 });
    }
  }

  // Timeline events: cluster by event_type in distinct spatial regions
  // First: events connected to observations go near their observation
  const eventsWithObs: GraphNode[] = [];
  const eventsFree: GraphNode[] = [];
  for (const te of timelineEvents) {
    let hasObs = false;
    for (const e of edges) {
      if (e.relationship === 'LOGGED_ON' && e.target === te.id && !e.derived) {
        hasObs = true; break;
      }
    }
    if (hasObs) eventsWithObs.push(te); else eventsFree.push(te);
  }

  // Events with observation: cluster near their source
  const eventsBySource = new Map<string, GraphNode[]>();
  for (const te of eventsWithObs) {
    let src: string | null = null;
    for (const e of edges) { if (e.relationship === 'LOGGED_ON' && e.target === te.id && !e.derived) { src = e.source; break; } }
    if (src && positions.has(src)) {
      const arr = eventsBySource.get(src) ?? []; arr.push(te); eventsBySource.set(src, arr);
    } else { eventsFree.push(te); }
  }
  for (const [srcId, evts] of eventsBySource) {
    const sp = positions.get(srcId)!;
    const r = 0.25 + evts.length * 0.02;
    evts.forEach((te, i) => {
      const a = ((2 * Math.PI) / Math.max(evts.length, 1)) * i;
      const h = stableHash(te.id);
      positions.set(te.id, {
        x: sp.x + Math.cos(a) * r,
        y: sp.y + Math.sin(a) * r,
        z: sp.z + ((h % 50) / 50 - 0.5) * 0.2,
      });
    });
  }

  // Free events: group by event_type into distinct clusters
  const eventsByType = new Map<string, GraphNode[]>();
  for (const te of eventsFree) {
    const et = (te.properties?.event_type || 'other').toLowerCase();
    const arr = eventsByType.get(et) ?? []; arr.push(te); eventsByType.set(et, arr);
  }
  const typeKeys = Array.from(eventsByType.keys());
  const typeRadiusX = 1.05;
  const typeRadiusY = 1.75;
  typeKeys.forEach((etype, ti) => {
    const evts = eventsByType.get(etype)!;
    const typeAngle = ((2 * Math.PI) / typeKeys.length) * ti;
    const typeCenterX = Math.cos(typeAngle) * typeRadiusX;
    const typeCenterY = Math.sin(typeAngle) * typeRadiusY;
    evts.forEach((te, i) => {
      const h = stableHash(te.id);
      const localAngle = ((2 * Math.PI) / Math.max(evts.length, 1)) * i;
      const localR = 0.12 + (i % 3) * 0.1;
      positions.set(te.id, {
        x: typeCenterX + Math.cos(localAngle) * localR,
        y: typeCenterY + Math.sin(localAngle) * localR,
        z: ((h % 60) / 60 - 0.5) * 0.3,
      });
    });
  });

  // P4: P0–P3 graph types — hub-optional fallback bucket.
  // Previously any node outside the five legacy buckets was silently
  // dropped from the canvas (buildGraph skips unpositioned nodes), which
  // hid every Condition/Visit/Measurement/Sleep/Food/PPG node. This pass
  // guarantees every node a deterministic position with the existing
  // instanced-sphere pipeline — no layout rewrite, no new draw calls.
  // Patient stays central; Visit-centered clustering is the hub
  // alternative (members orbit their visit when it is positioned).
  const extraNodes = nodes.filter((n) => !positions.has(n.id));
  if (extraNodes.length > 0) {
    // Pass 1: type-grouped outer ellipses (every node placed).
    const byType = new Map<string, GraphNode[]>();
    for (const n of extraNodes) {
      const arr = byType.get(n.type) ?? []; arr.push(n); byType.set(n.type, arr);
    }
    const typeList = Array.from(byType.keys());
    typeList.forEach((t, ti) => {
      const group = byType.get(t)!;
      const baseAngle = ((2 * Math.PI) / typeList.length) * ti;
      const cx = Math.cos(baseAngle) * 1.5;
      const cy = Math.sin(baseAngle) * 2.0;
      group.forEach((n, i) => {
        const h = stableHash(n.id);
        const a = ((2 * Math.PI) / Math.max(group.length, 1)) * i;
        const r = 0.15 + (i % 3) * 0.1;
        positions.set(n.id, {
          x: cx + Math.cos(a) * r,
          y: cy + Math.sin(a) * r,
          z: ((h % 60) / 60 - 0.5) * 0.4,
        });
      });
    });
    // Pass 2: tighten children near already-positioned parents —
    // FoodEntry near its scan, MedicationVersion near its request, and
    // OCCURRED_DURING members orbiting their visit.
    const nearParent = (id: string, rel: string, radius: number) => {
      for (const e of edges) {
        if (e.relationship !== rel || e.target !== id) continue;
        const pp = positions.get(e.source);
        if (!pp) continue;
        const h = stableHash(id);
        const a = ((h % 360) / 360) * Math.PI * 2;
        positions.set(id, {
          x: pp.x + Math.cos(a) * radius,
          y: pp.y + Math.sin(a) * radius,
          z: pp.z + ((h % 40) / 40 - 0.5) * 0.15,
        });
        return;
      }
    };
    for (const n of extraNodes) {
      if (n.type === 'food_entry') nearParent(n.id, 'HAS_ENTRY', 0.22);
      else if (n.type === 'medication_version') nearParent(n.id, 'HAS_VERSION', 0.22);
      else nearParent(n.id, 'OCCURRED_DURING', 0.3);
    }
  }

  return positions;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Scene Manager — Three.js + expo-gl (same pattern as original BodyScreen)
// ═══════════════════════════════════════════════════════════════════════════════

interface ArcSample {
  points: THREE.Vector3[];
  edgeId: string;
  semantic: boolean;
}

interface Pulse {
  arc: number;
  t: number;
  speed: number;
}

class GraphSceneManager {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer | null = null;
  private gl: any = null;
  private graphGroup = new THREE.Group();

  // Orbit state (same as AnatomySceneManager)
  private rotationY = 0;
  private rotationX = 0.3;
  private zoom = 1;
  private panX = 0;
  private panY = 0;
  private lastInteract = 0;

  // Instanced nodes — 1 draw call for every node.
  private nodeMesh: THREE.InstancedMesh | null = null;
  // Invisible 2.6× hit-proxy (raycast-only, never drawn) for fat tap targets.
  private hitMesh: THREE.InstancedMesh | null = null;
  private nodeOrder: string[] = [];
  private nodeBase: { pos: THREE.Vector3; size: number; color: THREE.Color; phase: number }[] = [];
  private nodeIndexById: Map<string, number> = new Map();
  private dummy = new THREE.Object3D();
  private tmpV1 = new THREE.Vector3();
  private tmpV2 = new THREE.Vector2();
  private tmpQ1 = new THREE.Quaternion();
  private raycaster = new THREE.Raycaster();

  // Merged arc tubes — 1 draw call for every edge.
  private edgeMesh: THREE.Mesh | null = null;
  // Per-edge vertex ranges so selection can recolor in place (no rebuild).
  private edgeRanges: { start: number; count: number; color: THREE.Color; source: string; target: string; semantic: boolean; restOp: number }[] = [];
  private edgeColorAttr: THREE.BufferAttribute | null = null;
  private arcs: ArcSample[] = [];

  // Traveling pulses along semantic arcs (1 instanced draw call).
  private pulseMesh: THREE.InstancedMesh | null = null;
  private pulses: Pulse[] = [];

  // Selection halo + neighbor verdict badges.
  private halo: THREE.Mesh | null = null;
  private badgeMesh: THREE.InstancedMesh | null = null;

  // Atmosphere: polar grid floor + drifting dust (fills the void, ~2 draw calls).
  private gridHelper: THREE.PolarGridHelper | null = null;
  private dust: THREE.Points | null = null;
  private dustBase: THREE.Vector3[] = [];
  private dustPhase: number[] = [];

  private selectedId: string | null = null;
  private neighborVerdicts: Map<string, 'good' | 'bad' | 'neutral'> = new Map();
  private viewport = { width: SCREEN_WIDTH, height: SCREEN_HEIGHT - 120 };
  private clock = 0;
  // Last fitted extents (refit when the viewport aspect changes).
  private fitExtent = { x: 1.4, y: 2.1 };

  // Shared node geometry + single material (per-node color via instanceColor).
  private sphereGeo: THREE.SphereGeometry | null = null;
  private nodeMaterial: THREE.MeshBasicMaterial | null = null;

  // Edge visibility — dark canvas wants punch, not haze.
  private edgeBaseOp = 1.0;
  private derivedOp = 0.5;

  constructor(width = SCREEN_WIDTH, height = SCREEN_HEIGHT - 120, theme: 'dark' | 'panel' = 'dark') {
    this.viewport = { width, height };
    this.scene = new THREE.Scene();
    // Night instrument canvas (panel matches the dashboard insight card).
    const bgHex = theme === 'panel' ? 0x16161c : 0x0b0b0f;
    this.scene.background = new THREE.Color(bgHex);

    this.camera = new THREE.PerspectiveCamera(55, width / Math.max(height, 1), 0.1, 100);
    this.camera.position.set(0, 1.0, 6.5);
    this.camera.lookAt(0, 0, 0);

    // Flat precise instruments need no lights (unlit basic material below).

    // Depth cue + atmosphere: soft fog, a faint polar grid to ground the
    // constellation, and slow dust motes so the void feels designed.
    this.scene.fog = new THREE.Fog(bgHex, 10, 20);
    const grid = new THREE.PolarGridHelper(4.2, 12, 6, 48, 0x2a2a33, 0x2a2a33);
    const gridMat = grid.material as THREE.LineBasicMaterial;
    gridMat.transparent = true;
    gridMat.opacity = 0.5;
    gridMat.toneMapped = false;
    grid.position.y = -2.4;
    this.scene.add(grid);
    this.gridHelper = grid;

    const DUST = 60;
    const dustPos = new Float32Array(DUST * 3);
    for (let i = 0; i < DUST; i++) {
      const bx = (Math.random() - 0.5) * 7;
      const by = Math.random() * 5 - 2.5;
      const bz = (Math.random() - 0.5) * 7;
      this.dustBase.push(new THREE.Vector3(bx, by, bz));
      this.dustPhase.push(Math.random() * Math.PI * 2);
      dustPos[i * 3] = bx; dustPos[i * 3 + 1] = by; dustPos[i * 3 + 2] = bz;
    }
    const dustGeo = new THREE.BufferGeometry();
    const dustAttr = new THREE.Float32BufferAttribute(dustPos, 3);
    dustAttr.setUsage(THREE.DynamicDrawUsage);
    dustGeo.setAttribute('position', dustAttr);
    this.dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
      color: 0x9a9aa5,
      size: 0.035,
      transparent: true,
      opacity: 0.35,
      toneMapped: false,
      depthWrite: false,
      sizeAttenuation: true,
    }));
    this.dust.frustumCulled = false;
    this.dust.renderOrder = 0;
    this.scene.add(this.dust);

    // Shared sphere geometry (low poly for performance)
    this.sphereGeo = new THREE.SphereGeometry(1, 20, 14);

    // Single shared node material — unlit so domain hues stay crisp and
    // saturated on the dark canvas. Per-node color via instanceColor.
    this.nodeMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      toneMapped: false,
    });

    // Selection halo (billboard ring, parked on the selected node).
    this.halo = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.7, 48),
      new THREE.MeshBasicMaterial({
        color: 0x4fd1c5,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        toneMapped: false,
        depthWrite: false,
      }),
    );
    this.halo.visible = false;
    this.halo.renderOrder = 5;
    this.graphGroup.add(this.halo);

    // Traveling pulses (instanced dots riding the semantic arcs).
    this.pulseMesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 6, 5),
      new THREE.MeshBasicMaterial({ toneMapped: false }),
      MAX_PULSES,
    );
    this.pulseMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pulseMesh.frustumCulled = false;
    this.graphGroup.add(this.pulseMesh);

    // Neighbor verdict badges (instanced dots: green = good, red = strained).
    this.badgeMesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 8, 6),
      new THREE.MeshBasicMaterial({ toneMapped: false }),
      MAX_BADGES,
    );
    this.badgeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.badgeMesh.frustumCulled = false;
    this.graphGroup.add(this.badgeMesh);
    this.hideBadges();

    this.scene.add(this.graphGroup);
  }

  setRenderer(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
  }

  setExpoGLContext(gl: any) {
    this.gl = gl;
  }

  setViewport(width: number, height: number) {
    this.viewport = { width, height };
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
    // Rotation/resize changes the aspect — refit so nothing crops.
    if (this.nodeBase.length > 0) this.fitToView();
  }

  /** Fitted camera distance (for build diagnostics). */
  cameraDistance(): number {
    return this.camera.position.z;
  }

  // Last data (kept so selection can re-resolve adjacency without a rebuild).
  private lastEdges: GraphEdge[] = [];
  private selScale: number[] = [];
  private edgePalette: Record<string, THREE.Color> | null = null;
  private reduceMotion = false;

  /** Build the graph from data — full (re)build; selection is applied separately. */
  buildGraph(
    nodes: GraphNode[],
    edges: GraphEdge[],
    positions: Map<string, LayoutPos>,
    flowEdgeIds: Set<string> = new Set(),
  ) {
    this.clearGraph();
    this.lastEdges = edges;

    // ── Nodes: one InstancedMesh, per-instance color ──
    const placed: { id: string; size: number; color: THREE.Color; pos: THREE.Vector3; phase: number }[] = [];
    for (const node of nodes) {
      const pos = positions.get(node.id);
      if (!pos) continue;
      const size = NODE_SIZES[node.type] || 0.06;
      const color = new THREE.Color(this.nodeHexFor(node));
      placed.push({
        id: node.id,
        size,
        color,
        pos: new THREE.Vector3(pos.x, pos.y, pos.z),
        phase: ((stableHash(node.id) % 1000) / 1000) * Math.PI * 2,
      });
    }
    if (this.sphereGeo && this.nodeMaterial && placed.length > 0) {
      const mesh = new THREE.InstancedMesh(this.sphereGeo, this.nodeMaterial, placed.length);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      placed.forEach((p, i) => {
        this.dummy.position.copy(p.pos);
        this.dummy.scale.setScalar(p.size);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.updateMatrix();
        mesh.setMatrixAt(i, this.dummy.matrix);
        mesh.setColorAt(i, p.color);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.graphGroup.add(mesh);
      this.nodeMesh = mesh;
      // Hit proxy shares every matrix (scaled up), never renders.
      const hit = new THREE.InstancedMesh(
        this.sphereGeo,
        new THREE.MeshBasicMaterial({ visible: false }),
        placed.length,
      );
      hit.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      hit.frustumCulled = false;
      this.graphGroup.add(hit);
      this.hitMesh = hit;
    }
    this.nodeOrder = placed.map((p) => p.id);
    this.nodeBase = placed;
    this.nodeIndexById = new Map(placed.map((p, i) => [p.id, i] as [string, number]));
    this.selScale = placed.map(() => 1);

    // ── Edges: one merged arc-tube mesh ──
    this.buildEdgeTubes(edges, positions, flowEdgeIds);
    this.seedPulses();
    this.hideBadges();
    // Frame the fresh layout for this viewport — never cropped, any aspect.
    this.fitToView();

    // Re-apply any active focus on top of the fresh build.
    this.applySelection();
  }

  private nodeHexFor(node: GraphNode): string | number {
    switch (node.type) {
      case 'patient': return '#FFFFFF';
      case 'body_structure': return '#7C8DA6';
      case 'document': return '#8A7BC8';
      case 'medication': return '#4FD1C5';
      case 'medication_taken_event': return '#3AA79D';
      default: return nodeDomainColor(node);
    }
  }

  private edgeBaseColor(relationship: string): THREE.Color {
    if (!this.edgePalette) {
      this.edgePalette = {
        HAS_OBSERVATION: new THREE.Color(0x7c8da6),
        AFFECTS: new THREE.Color(0xe0746b),
        SOURCE_DOCUMENT: new THREE.Color(0x8a7bc8),
        DOCUMENTED_IN: new THREE.Color(0x8a7bc8),
        LOGGED_ON: new THREE.Color(0xf5a623),
        HAS_TIMELINE_EVENT: new THREE.Color(0x55606e),
        DERIVED_SAME_TYPE: new THREE.Color(0x4a5568),
        DERIVED_SAME_BODY_SITE: new THREE.Color(0x4fd1c5),
        DERIVED_SAME_DAY: new THREE.Color(0x3a4356),
        CORRELATES: new THREE.Color(0x4fd1c5),
        INVERSES: new THREE.Color(0xe0746b),
        // P0–P3 clinical + lifestyle topology (same hues as node domains).
        HAS_CONDITION: new THREE.Color(0xf28b7e),
        HAS_VISIT: new THREE.Color(0x5b6b82),
        HAS_STATEMENT: new THREE.Color(0xb8a6e8),
        HAS_MEDICATION_REQUEST: new THREE.Color(0x4fd1c5),
        PRESCRIBES: new THREE.Color(0x3aa79d),
        PRESCRIBED_FOR: new THREE.Color(0xf28b7e),
        REASON_STATED_BY_PATIENT: new THREE.Color(0xb8a6e8),
        ABOUT: new THREE.Color(0xb8a6e8),
        RESULTS_FROM: new THREE.Color(0x3aa79d),
        OCCURRED_DURING: new THREE.Color(0x5b6b82),
        HAS_MEASUREMENT: new THREE.Color(0xf27e93),
        HAS_CODE: new THREE.Color(0x9aa8b8),
        HAS_VERSION: new THREE.Color(0x3aa79d),
        SUPERSEDES: new THREE.Color(0x3aa79d),
        HAS_SLEEP: new THREE.Color(0x7c6ff0),
        HAS_ACTIVITY: new THREE.Color(0x4fd1c5),
        HAS_NUTRITION: new THREE.Color(0x6ec1e4),
        HAS_FOOD_SCAN: new THREE.Color(0x6ec1e4),
        HAS_ENTRY: new THREE.Color(0x6ec1e4),
        HAS_BIOMETRIC: new THREE.Color(0xf27e93),
      };
    }
    return this.edgePalette[relationship] ?? new THREE.Color(0x55606e);
  }

  private isSemanticEdge(edge: GraphEdge, flowEdgeIds: Set<string>): boolean {
    return edge.relationship === 'CORRELATES' || edge.relationship === 'INVERSES' || flowEdgeIds.has(edge.id);
  }

  /**
   * CPU-baked curved tubes, merged into ONE BufferGeometry (1 draw call).
   * Mobile-GPU-first: no shader arcs, no per-edge objects — static geometry
   * built once per dataset on the CPU; animation happens via pulses + bob.
   */
  private buildEdgeTubes(
    edges: GraphEdge[],
    positions: Map<string, LayoutPos>,
    flowEdgeIds: Set<string>,
  ) {
    const posArr: number[] = [];
    const normArr: number[] = [];
    const colArr: number[] = [];
    const idxArr: number[] = [];
    this.edgeRanges = [];
    this.arcs = [];

    const up = new THREE.Vector3(0, 1, 0);
    const radial = 4;
    let vBase = 0;

    for (const edge of edges) {
      const a = positions.get(edge.source);
      const b = positions.get(edge.target);
      if (!a || !b) continue;
      const v0 = new THREE.Vector3(a.x, a.y, a.z);
      const v1 = new THREE.Vector3(b.x, b.y, b.z);
      const len = v0.distanceTo(v1);
      if (len < 1e-4) continue;

      // Arc lift PERPENDICULAR to the edge (world-up lift leaves vertical
      // edges dead straight). Deterministic sway on the third axis separates
      // parallel arcs.
      const dir = new THREE.Vector3().subVectors(v1, v0).normalize();
      const lift = Math.min(0.9, Math.max(0.12, len * 0.16));
      const perp = new THREE.Vector3(0, 1, 0).addScaledVector(dir, -dir.y);
      if (perp.lengthSq() < 1e-6) perp.set(1, 0, 0);
      perp.normalize();
      const h = stableHash(edge.id);
      const swayDir = new THREE.Vector3().crossVectors(dir, perp).normalize();
      const sway = (((h % 100) + 100) % 100 / 100 - 0.5) * len * 0.14;
      const mid = new THREE.Vector3().addVectors(v0, v1).multiplyScalar(0.5)
        .addScaledVector(perp, lift).addScaledVector(swayDir, sway);
      const curve = new THREE.QuadraticBezierCurve3(v0, mid, v1);

      const tubular = Math.max(6, Math.min(14, Math.round(len * 5)));
      const semantic = this.isSemanticEdge(edge, flowEdgeIds);
      const radius = semantic ? 0.03 : 0.018;
      // Hub spokes (patient fan) carry little information — rest them so
      // semantic + clinical arcs star.
      const hubFan = edge.relationship === 'HAS_TIMELINE_EVENT' ? 0.5 : 1;
      const op = semantic ? 1 : (edge.derived ? this.derivedOp : this.edgeBaseOp) * hubFan;
      const col = this.edgeBaseColor(edge.relationship).clone().multiplyScalar(op);

      // Sampled centerline (reused by traveling pulses).
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= tubular; i++) pts.push(curve.getPoint(i / tubular));
      this.arcs.push({ points: pts, edgeId: edge.id, semantic });

      const ringStart = vBase;
      for (let i = 0; i <= tubular; i++) {
        const tan = curve.getTangent(i / tubular).normalize();
        const normal = new THREE.Vector3().crossVectors(tan, up);
        if (normal.lengthSq() < 1e-6) normal.set(1, 0, 0);
        normal.normalize();
        const binormal = new THREE.Vector3().crossVectors(tan, normal).normalize();
        for (let j = 0; j < radial; j++) {
          const ang = (j / radial) * Math.PI * 2;
          const n = new THREE.Vector3()
            .addScaledVector(normal, Math.cos(ang))
            .addScaledVector(binormal, Math.sin(ang));
          const p = pts[i];
          posArr.push(p.x + n.x * radius, p.y + n.y * radius, p.z + n.z * radius);
          normArr.push(n.x, n.y, n.z);
          colArr.push(col.r, col.g, col.b);
          vBase++;
        }
      }
      for (let i = 0; i < tubular; i++) {
        for (let j = 0; j < radial; j++) {
          const a0 = ringStart + i * radial + j;
          const b0 = ringStart + i * radial + ((j + 1) % radial);
          const a1 = ringStart + (i + 1) * radial + j;
          const b1 = ringStart + (i + 1) * radial + ((j + 1) % radial);
          idxArr.push(a0, a1, b0, b0, a1, b1);
        }
      }
      // Float ranges into the color attribute for in-place recoloring.
      this.edgeRanges.push({
        start: ringStart * 3,
        count: (tubular + 1) * radial * 3,
        color: this.edgeBaseColor(edge.relationship),
        source: edge.source,
        target: edge.target,
        semantic,
        restOp: op,
      });
    }

    if (vBase === 0) {
      this.edgeMesh = null;
      this.edgeColorAttr = null;
      return;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normArr, 3));
    const colorAttr = new THREE.Float32BufferAttribute(colArr, 3);
    colorAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('color', colorAttr);
    geo.setIndex(idxArr);
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      toneMapped: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    this.graphGroup.add(mesh);
    this.edgeMesh = mesh;
    this.edgeColorAttr = colorAttr;
  }

  /** Park pulses on semantic arcs first, then the longest plain arcs. */
  private seedPulses() {
    this.pulses = [];
    if (this.arcs.length === 0) {
      this.parkPulses();
      return;
    }
    const sem = this.arcs.map((a, i) => ({ a, i })).filter(({ a }) => a.semantic);
    const rest = this.arcs
      .map((a, i) => ({ a, i, len: a.points[0].distanceTo(a.points[a.points.length - 1]) }))
      .filter(({ a }) => !a.semantic)
      .sort((x, y) => y.len - x.len)
      .slice(0, 10);
    const chosen = [...sem, ...rest].slice(0, MAX_PULSES);
    chosen.forEach(({ i }, k) => {
      this.pulses.push({
        arc: i,
        t: (k / Math.max(chosen.length, 1) + 0.13 * k) % 1,
        speed: 0.1 + (((stableHash(this.arcs[i].edgeId) % 100) + 100) % 100) / 100 * 0.12,
      });
      const c = this.arcs[i].semantic
        ? new THREE.Color(0xffffff)
        : new THREE.Color(0x9a9aa5);
      this.pulseMesh?.setColorAt(k, c);
    });
    if (this.pulseMesh?.instanceColor) this.pulseMesh.instanceColor.needsUpdate = true;
    this.parkPulses();
  }

  /** Hide unused pulse instances at scale 0. */
  private parkPulses() {
    if (!this.pulseMesh) return;
    this.dummy.position.set(0, 0, 0);
    this.dummy.scale.setScalar(0.0001);
    this.dummy.rotation.set(0, 0, 0);
    this.dummy.updateMatrix();
    for (let k = this.pulses.length; k < MAX_PULSES; k++) {
      this.pulseMesh.setMatrixAt(k, this.dummy.matrix);
    }
    this.pulseMesh.instanceMatrix.needsUpdate = true;
  }

  private hideBadges() {
    if (!this.badgeMesh) return;
    this.dummy.position.set(0, 0, 0);
    this.dummy.scale.setScalar(0.0001);
    this.dummy.rotation.set(0, 0, 0);
    this.dummy.updateMatrix();
    for (let k = 0; k < MAX_BADGES; k++) this.badgeMesh.setMatrixAt(k, this.dummy.matrix);
    this.badgeMesh.instanceMatrix.needsUpdate = true;
  }

  /** Remove only data meshes — halo/pulses/badges persist across rebuilds. */
  private clearGraph() {
    if (this.nodeMesh) {
      this.graphGroup.remove(this.nodeMesh);
      this.nodeMesh.dispose();
      this.nodeMesh = null;
    }
    if (this.hitMesh) {
      this.graphGroup.remove(this.hitMesh);
      // Geometry is shared with nodeMesh — dispose() frees only instance buffers.
      this.hitMesh.dispose();
      (this.hitMesh.material as THREE.Material).dispose();
      this.hitMesh = null;
    }
    if (this.edgeMesh) {
      this.graphGroup.remove(this.edgeMesh);
      this.edgeMesh.geometry.dispose();
      (this.edgeMesh.material as THREE.Material).dispose();
      this.edgeMesh = null;
    }
    this.edgeColorAttr = null;
    this.nodeOrder = [];
    this.nodeBase = [];
    this.nodeIndexById.clear();
    this.selScale = [];
    this.edgeRanges = [];
    this.arcs = [];
    this.pulses = [];
    this.lastEdges = [];
  }

  setReducedMotion(v: boolean) {
    this.reduceMotion = v;
  }

  /**
   * Focus a node WITHOUT rebuilding: rescale/retint instances, recolor edge
   * ranges, park the halo + verdict badges. Pass null to clear focus.
   */
  setFocus(selectedId: string | null, verdicts: Map<string, 'good' | 'bad' | 'neutral'> = new Map()) {
    this.selectedId = selectedId;
    this.neighborVerdicts = verdicts;
    if (__DEV__ && selectedId) {
      let good = 0, bad = 0, neutral = 0;
      for (const v of verdicts.values()) { if (v === 'good') good++; else if (v === 'bad') bad++; else neutral++; }
      console.log('[HealthGraphFocus] selected=', selectedId, 'neighbors=', verdicts.size, 'good=', good, 'bad=', bad, 'neutral=', neutral);
    }
    this.applySelection();
  }

  /** Write node + hit-proxy matrices for instance i (single choke point). */
  private writeInstance(i: number, bobY: number) {
    const base = this.nodeBase[i];
    const s = base.size * this.selScale[i];
    this.dummy.position.set(base.pos.x, base.pos.y + bobY, base.pos.z);
    this.dummy.scale.setScalar(s);
    this.dummy.rotation.set(0, 0, 0);
    this.dummy.updateMatrix();
    this.nodeMesh?.setMatrixAt(i, this.dummy.matrix);
    if (this.hitMesh) {
      this.dummy.scale.setScalar(s * 2.6 + 0.05);
      this.dummy.updateMatrix();
      this.hitMesh.setMatrixAt(i, this.dummy.matrix);
    }
  }

  private applySelection() {
    const sel = this.selectedId;
    const mesh = this.nodeMesh;

    if (mesh) {
      const c = new THREE.Color();
      for (let i = 0; i < this.nodeOrder.length; i++) {
        const id = this.nodeOrder[i];
        const base = this.nodeBase[i];
        mesh.getColorAt(i, c);
        if (sel == null) {
          this.selScale[i] = 1;
          c.copy(base.color);
        } else if (id === sel) {
          this.selScale[i] = 1.4;
          c.copy(base.color).lerp(new THREE.Color(0xffffff), 0.35);
        } else if (this.neighborVerdicts.has(id)) {
          this.selScale[i] = 1.12;
          c.copy(base.color);
        } else {
          this.selScale[i] = 1;
          c.copy(base.color).multiplyScalar(DIM);
        }
        mesh.setColorAt(i, c);
        // Rewrite the matrix now so selection scale applies even when the
        // per-frame bob loop is disabled (reduced motion).
        this.writeInstance(i, 0);
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.instanceMatrix.needsUpdate = true;
      if (this.hitMesh) this.hitMesh.instanceMatrix.needsUpdate = true;
    }

    // Edges: incident edges take the neighbor's verdict color (teal = healthy,
    // soft coral = strained), everything else dims — recolored in place.
    if (this.edgeColorAttr) {
      const arr = this.edgeColorAttr.array as Float32Array;
      const tmp = new THREE.Color();
      const good = new THREE.Color(0x4fd1c5);
      const bad = new THREE.Color(0xe0746b);
      for (const r of this.edgeRanges) {
        const other = sel != null
          ? (r.source === sel ? r.target : r.target === sel ? r.source : null)
          : null;
        if (sel == null) {
          tmp.copy(r.color).multiplyScalar(r.restOp);
        } else if (other == null) {
          tmp.copy(r.color).multiplyScalar(DIM * 0.8);
        } else {
          const v = this.neighborVerdicts.get(other);
          if (v === 'good') tmp.copy(good);
          else if (v === 'bad') tmp.copy(bad);
          else tmp.copy(r.color);
        }
        for (let k = r.start; k < r.start + r.count; k += 3) {
          arr[k] = tmp.r; arr[k + 1] = tmp.g; arr[k + 2] = tmp.b;
        }
      }
      this.edgeColorAttr.needsUpdate = true;
    }

    // Halo on the selected node; badges on good/bad neighbors.
    if (this.halo) this.halo.visible = sel != null;
    this.updateBadges();
  }

  private updateBadges() {
    if (!this.badgeMesh) return;
    let k = 0;
    const good = new THREE.Color(0x4fd1c5);
    const bad = new THREE.Color(0xe0746b);
    if (this.selectedId) {
      for (const [id, v] of this.neighborVerdicts) {
        if (k >= MAX_BADGES) break;
        if (v === 'neutral') continue;
        const i = this.nodeIndexById.get(id);
        if (i == null || !this.nodeBase[i]) continue;
        const p = this.nodeBase[i].pos;
        this.dummy.position.set(p.x * 1.18, p.y * 1.18 + 0.12, p.z * 1.18);
        this.dummy.scale.setScalar(this.nodeBase[i].size * 0.42 + 0.02);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.updateMatrix();
        this.badgeMesh.setMatrixAt(k, this.dummy.matrix);
        this.badgeMesh.setColorAt(k, v === 'good' ? good : bad);
        k++;
      }
    }
    this.dummy.position.set(0, 0, 0);
    this.dummy.scale.setScalar(0.0001);
    this.dummy.rotation.set(0, 0, 0);
    this.dummy.updateMatrix();
    for (; k < MAX_BADGES; k++) this.badgeMesh.setMatrixAt(k, this.dummy.matrix);
    this.badgeMesh.instanceMatrix.needsUpdate = true;
    if (this.badgeMesh.instanceColor) this.badgeMesh.instanceColor.needsUpdate = true;
  }

  /** World position of a node instance (including idle bob). */
  private nodeWorldPos(index: number, out: THREE.Vector3): THREE.Vector3 {
    const base = this.nodeBase[index];
    out.copy(base.pos);
    if (!this.reduceMotion) {
      out.y += Math.sin(this.clock * 1.2 + base.phase) * 0.03;
    }
    return out.applyMatrix4(this.graphGroup.matrixWorld);
  }

  private sampleArc(arc: ArcSample, t: number, out: THREE.Vector3): THREE.Vector3 {
    const pts = arc.points;
    const f = Math.max(0, Math.min(0.9999, t)) * (pts.length - 1);
    const i = Math.floor(f);
    return out.copy(pts[i]).lerp(pts[Math.min(i + 1, pts.length - 1)], f - i);
  }

  render(dt: number) {
    if (!this.renderer) return;
    this.clock += dt;
    const t = this.clock;

    // Gentle sway — alive, but the framing never drifts away. (An unbounded
    // idle spin turned the tall ellipse edge-on: the "half screen" column.)
    this.graphGroup.rotation.y = this.rotationY + (this.reduceMotion ? 0 : Math.sin(t * 0.15) * 0.12);
    this.graphGroup.rotation.x = this.rotationX;
    this.graphGroup.scale.setScalar(this.zoom);
    this.graphGroup.position.x = this.panX;
    this.graphGroup.position.y = this.panY;

    // Node bob (CPU-cheap: one matrix compose per node).
    if (this.nodeMesh && !this.reduceMotion) {
      for (let i = 0; i < this.nodeOrder.length; i++) {
        const base = this.nodeBase[i];
        this.writeInstance(i, Math.sin(t * 1.2 + base.phase) * 0.03);
      }
      this.nodeMesh.instanceMatrix.needsUpdate = true;
      if (this.hitMesh) this.hitMesh.instanceMatrix.needsUpdate = true;
    } else if (this.nodeMesh) {
      // Reduced motion: write selection scales once per frame is wasteful
      // but harmless; matrices were set at build — skip.
    }

    // Halo billboard tracks the selected node.
    if (this.halo && this.halo.visible && this.selectedId) {
      const i = this.nodeIndexById.get(this.selectedId);
      if (i != null) {
        const v = new THREE.Vector3();
        this.nodeWorldPos(i, v);
        // Back into graph-local space for a child of graphGroup (billboard
        // against the camera in world space, corrected for group rotation).
        this.graphGroup.worldToLocal(v);
        this.halo.position.copy(v);
        this.graphGroup.getWorldQuaternion(this.tmpQ1).invert();
        this.halo.quaternion.copy(this.tmpQ1.multiply(this.camera.quaternion));
        const s = (this.nodeBase[i]?.size ?? 0.2) * (this.reduceMotion ? 1.4 : 1.4 + 0.08 * Math.sin(t * 3));
        this.halo.scale.setScalar(Math.max(s * 2.2, 0.3));
      }
    }

    // Traveling pulses ride the arcs.
    if (this.pulseMesh && this.pulses.length > 0 && !this.reduceMotion) {      const v = new THREE.Vector3();
      this.pulses.forEach((p, k) => {
        p.t = (p.t + dt * p.speed) % 1;
        const arc = this.arcs[p.arc];
        if (!arc) return;
        this.sampleArc(arc, p.t, v);
        this.dummy.position.copy(v);
        this.dummy.scale.setScalar(arc.semantic ? 0.055 : 0.04);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.updateMatrix();
        this.pulseMesh!.setMatrixAt(k, this.dummy.matrix);
      });
      this.pulseMesh.instanceMatrix.needsUpdate = true;
    }

    // Dust drift (one 60-vert attribute rewrite — negligible).
    if (this.dust && !this.reduceMotion) {
      const attr = this.dust.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      for (let i = 0; i < this.dustBase.length; i++) {
        const b = this.dustBase[i];
        const ph = this.dustPhase[i];
        arr[i * 3] = b.x + Math.sin(t * 0.1 + ph) * 0.4;
        arr[i * 3 + 1] = b.y + Math.sin(t * 0.13 + ph * 2) * 0.35;
        arr[i * 3 + 2] = b.z + Math.cos(t * 0.08 + ph) * 0.4;
      }
      attr.needsUpdate = true;
    }

    this.renderer.render(this.scene, this.camera);

    if (this.gl && Platform.OS !== 'web' && typeof this.gl.endFrameEXP === 'function') {
      this.gl.endFrameEXP();
    }
  }

  handlePanMove(dx: number, dy: number) {
    this.lastInteract = this.clock;
    this.rotationY += dx * 0.005;
    this.rotationX = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, this.rotationX + dy * 0.005));
  }

  handlePinch(scale: number) {
    this.lastInteract = this.clock;
    this.zoom = Math.max(0.3, Math.min(3, this.zoom * scale));
  }

  resetView() {
    this.rotationY = 0;
    this.rotationX = 0.3;
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.fitToView();
  }

  /**
   * Auto-fit: bounding box → camera distance, so the constellation fills
   * (never overflows) any viewport aspect. No more hand-tuned z per device.
   */
  private fitToView() {
    if (this.nodeBase.length === 0) return;
    let ex = 0.5, ey = 0.5;
    for (const n of this.nodeBase) {
      ex = Math.max(ex, Math.abs(n.pos.x) + n.size);
      ey = Math.max(ey, Math.abs(n.pos.y) + n.size);
    }
    this.fitExtent = { x: ex, y: ey };
    const aspect = this.viewport.width / Math.max(this.viewport.height, 1);
    const halfFovTan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const needH = ey / halfFovTan;
    const needW = ex / (halfFovTan * Math.max(aspect, 0.3));
    const dist = Math.max(needH, needW) * 1.1;
    this.camera.position.set(0, 1.0, Math.max(4.5, Math.min(14, dist)));
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
  }

  getSelectedNodeScreenPosition(): { x: number; y: number } | null {
    if (!this.selectedId || !this.renderer) return null;
    const i = this.nodeIndexById.get(this.selectedId);
    if (i == null) return null;

    this.tmpV1.set(0, 0, 0);
    this.nodeWorldPos(i, this.tmpV1);
    this.tmpV1.project(this.camera);

    // Check if behind camera
    if (this.tmpV1.z > 1) return null;

    // Convert NDC to screen coordinates
    const hw = this.viewport.width / 2;
    const hh = this.viewport.height / 2;
    return { x: this.tmpV1.x * hw + hw, y: -(this.tmpV1.y * hh) + hh };
  }

  /**
   * Project any set of nodes to screen space — drives the floating label
   * overlay so major nodes read without a tap. Same math as the popup path.
   */
  projectNodes(ids: string[]): NodeLabelProjection[] {
    if (!this.renderer || this.nodeBase.length === 0) return [];
    const hw = this.viewport.width / 2;
    const hh = this.viewport.height / 2;
    const out: NodeLabelProjection[] = [];
    for (const id of ids) {
      const i = this.nodeIndexById.get(id);
      if (i == null) continue;
      this.tmpV1.set(0, 0, 0);
      this.nodeWorldPos(i, this.tmpV1);
      this.tmpV1.project(this.camera);
      out.push({
        id,
        x: this.tmpV1.x * hw + hw,
        y: -(this.tmpV1.y * hh) + hh,
        behind: this.tmpV1.z > 1,
      });
    }
    return out;
  }

  handleTap(x: number, y: number, graphX = 0, graphY = 0): string | null {
    // Raycast the invisible hit-proxy (2.6× nodes) — fat tap targets.
    const target = this.hitMesh ?? this.nodeMesh;
    if (!this.renderer || !target) return null;

    const graphWidth = this.viewport.width;
    const graphHeight = this.viewport.height;
    this.tmpV2.set(
      ((x - graphX) / graphWidth) * 2 - 1,
      -((y - graphY) / graphHeight) * 2 + 1,
    );

    this.raycaster.setFromCamera(this.tmpV2 as unknown as THREE.Vector2, this.camera);

    const intersects = this.raycaster.intersectObject(target);
    if (intersects.length > 0) {
      const idx = (intersects[0] as unknown as { instanceId?: number }).instanceId;
      if (idx != null && this.nodeOrder[idx] != null) {
        this.lastInteract = this.clock;
        return this.nodeOrder[idx];
      }
    }
    return null;
  }

  dispose() {
    this.clearGraph();
    this.sphereGeo?.dispose();
    this.nodeMaterial?.dispose();
    if (this.gridHelper) {
      this.scene.remove(this.gridHelper);
      this.gridHelper.geometry.dispose();
      (this.gridHelper.material as THREE.Material).dispose();
      this.gridHelper = null;
    }
    if (this.dust) {
      this.scene.remove(this.dust);
      this.dust.geometry.dispose();
      (this.dust.material as THREE.Material).dispose();
      this.dust = null;
      this.dustBase = [];
      this.dustPhase = [];
    }
    if (this.halo) {
      this.graphGroup.remove(this.halo);
      this.halo.geometry.dispose();
      (this.halo.material as THREE.Material).dispose();
      this.halo = null;
    }
    if (this.pulseMesh) {
      this.graphGroup.remove(this.pulseMesh);
      this.pulseMesh.geometry.dispose();
      (this.pulseMesh.material as THREE.Material).dispose();
      this.pulseMesh = null;
    }
    if (this.badgeMesh) {
      this.graphGroup.remove(this.badgeMesh);
      this.badgeMesh.geometry.dispose();
      (this.badgeMesh.material as THREE.Material).dispose();
      this.badgeMesh = null;
    }
    this.renderer?.dispose();
    this.renderer = null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Natural language helpers
// ═══════════════════════════════════════════════════════════════════════════════

function formatNaturalDate(dateStr: string | undefined): string {
  if (!dateStr) return 'Date not recorded';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'Date not recorded';
    const diffDays = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (diffDays === 0) return `Today at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    if (diffDays === 1) return `Yesterday at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    return `${d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  } catch { return 'Date not recorded'; }
}

function genDesc(n: GraphNode): string {
  switch (n.type) {
    case 'patient': return 'Your personal health graph.';
    case 'body_structure': return `Observations related to your ${n.label.toLowerCase()}.`;
    case 'observation': {
      const v = n.properties?.value, u = n.properties?.unit;
      const s = n.properties?.visual_status ? ` Status: ${String(n.properties.visual_status).replace(/_/g, ' ')}.` : '';
      if (v != null && u) return `${n.label} — ${v} ${u}.${s}`;
      if (v != null) return `${n.label} — ${v}.${s}`;
      return `${n.label} observation recorded.${s}`;
    }
    case 'document': return `${n.properties?.document_type || 'Medical document'} added to records.`;
    case 'timeline_event': return `${n.properties?.source_type?.replace(/_/g, ' ').toLowerCase() || 'Health event'} recorded.`;
    // P4: P0–P3 types fall back to the server-provided label (value-qualified
    // for measurements/PPG/sleep/nutrition); the rich detail payload renders
    // in NodeDetailContent when present.
    default: return n.label ? `${n.label} recorded.` : '';
  }
}

function genWhat(n: GraphNode): string {
  switch (n.type) {
    case 'patient': return 'Personal health graph';
    case 'body_structure': return n.properties?.category?.replace(/_/g, ' ') || n.label;
    case 'observation': {
      const v = n.properties?.value, u = n.properties?.unit;
      const s = n.properties?.visual_status ? ` (${String(n.properties.visual_status).replace(/_/g, ' ')})` : '';
      if (v != null && u) return `${n.label} — ${v} ${u}${s}`;
      if (v != null) return `${n.label} — ${v}${s}`;
      return `${n.label}${s}`;
    }
    case 'document': return n.properties?.document_type || n.label;
    case 'timeline_event': return n.properties?.event_type?.replace(/_/g, ' ') || n.label;
    default: return n.label;
  }
}

function genWhen(n: GraphNode): string {
  return formatNaturalDate(n.properties?.event_time || n.properties?.measured_at || n.properties?.recorded_at || n.properties?.created_at || n.properties?.date);
}

function genSource(n: GraphNode): string | null {
  switch (n.type) {
    case 'observation': { const s = n.properties?.source_type; return s ? s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (l: string) => l.toUpperCase()) : 'Health data'; }
    case 'document': return 'Uploaded medical record';
    case 'timeline_event': { const s = n.properties?.source_type; return s ? s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (l: string) => l.toUpperCase()) : 'Health timeline'; }
    // P4: provenance-backed source line for P0–P3 types.
    case 'condition_occurrence':
    case 'measurement':
    case 'sleep_episode':
    case 'activity_event':
    case 'nutrition_intake':
    case 'food_scan':
    case 'food_entry':
    case 'ppg_measurement':
    case 'patient_statement':
    case 'visit': {
      const s = n.properties?.source_type || n.properties?.method;
      return s ? String(s).replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (l: string) => l.toUpperCase()) : 'Health data';
    }
    default: return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Detail Panel
// ═══════════════════════════════════════════════════════════════════════════════

/** Event type → glance spoke (for zones + guidance language). */
const EVENT_SPOKE: Record<string, string> = {
  SLEEP_LOG: 'sleepDur',
  WELLBEING_LOG: 'wellbeing',
  ACTIVITY_LOG: 'activity',
  NUTRITION_LOG: 'water',
  PAIN_LOG: 'pain',
  VITAL_SIGN: 'heart',
  MEDICATION_TAKEN: 'doses',
};

interface HeroStat {
  value: string;
  label: string;
  rows: { key: string; value: string }[];
  zone?: string;
  flag?: string;
}

/** Real measured values for a timeline event, joined from local check-in data. */
function eventHero(node: GraphNode, localDetails: DailyCheckInDetail[]): HeroStat | null {
  if (node.type !== 'timeline_event') return null;
  const et = String(node.properties?.event_type ?? '').toUpperCase();
  const day = String(node.properties?.event_time ?? node.properties?.date ?? '').slice(0, 10);
  const d = day ? localDetails.find((x) => x.log_date === day) : undefined;
  if (!d) return null;

  const rows: { key: string; value: string }[] = [];
  let value = '';
  let label = '';
  if (et.includes('SLEEP')) {
    if (d.sleep_duration_minutes != null) {
      value = formatSleepMinutes(d.sleep_duration_minutes);
      label = 'Sleep duration';
    }
    if (d.sleep_quality != null) rows.push({ key: 'Quality', value: `${d.sleep_quality}/5` });
    if (d.sleep_awakenings != null) rows.push({ key: 'Wake-ups', value: String(d.sleep_awakenings) });
  } else if (et.includes('WELLBEING') || et.includes('MOOD') || et.includes('ENERGY') || et.includes('STRESS')) {
    if (d.overall_wellbeing != null) {
      value = `${d.overall_wellbeing}/5`;
      label = 'Overall wellbeing';
    }
    if (d.energy_level != null) rows.push({ key: 'Energy', value: `${d.energy_level}/5` });
    if (d.stress_level != null) rows.push({ key: 'Stress', value: `${d.stress_level}/5` });
  } else if (et.includes('ACTIVITY')) {
    const mins = (d.activities ?? []).reduce((s, a) => s + (a.duration_minutes ?? 0), 0);
    const kcal = (d.activities ?? []).reduce((s, a) => s + (a.calories_burned ?? 0), 0);
    if (mins > 0) {
      value = formatDurationMinutes(mins);
      label = 'Active time';
    }
    if (kcal > 0) rows.push({ key: 'Calories', value: `${Math.round(kcal)} kcal` });
    rows.push({ key: 'Sessions', value: String((d.activities ?? []).length) });
  } else if (et.includes('NUTRITION') || et.includes('WATER') || et.includes('MEAL')) {
    if (d.water_ml != null && d.water_ml > 0) {
      value = formatWaterMl(d.water_ml);
      label = 'Water intake';
    }
    if (d.meals_count != null) rows.push({ key: 'Meals', value: String(d.meals_count) });
    if (d.appetite_level != null) rows.push({ key: 'Appetite', value: `${d.appetite_level}/5` });
  } else if (et.includes('PAIN')) {
    const sevs = (d.pain ?? []).map((p) => p.severity).filter((v) => v != null);
    if (sevs.length > 0) {
      value = `${Math.max(...sevs)}/10`;
      label = 'Worst pain';
      rows.push({ key: 'Sites', value: String(sevs.length) });
    }
  } else if (et.includes('SYMPTOM')) {
    const syms = d.symptoms ?? [];
    if (syms.length > 0) {
      const worst = Math.max(...syms.map((s) => s.severity ?? 0));
      value = `${worst}/10`;
      label = syms.length === 1 ? 'Symptom severity' : `Worst of ${syms.length} symptoms`;
    }
  } else if (et.includes('VITAL') || et.includes('HEART') || et.includes('BLOOD') || et.includes('GLUCOSE')) {
    const vitals = (d.vitals ?? []).filter((v) => v.value != null).slice(0, 3);
    if (vitals.length > 0) {
      const first = vitals[0];
      value = `${first.value}${first.unit ? ` ${first.unit}` : ''}`;
      label = 'Reading';
      for (const v of vitals.slice(1)) {
        rows.push({ key: 'Also', value: `${v.value}${v.unit ? ` ${v.unit}` : ''}` });
      }
    }
  } else if (et.includes('MEDICATION')) {
    const meds = d.medications ?? [];
    if (meds.length > 0) {
      value = meds[0].medication_name || 'Dose';
      label = meds.length === 1 ? 'Medication' : `1 of ${meds.length} logged`;
      for (const m of meds.slice(1, 3)) {
        rows.push({ key: 'Also', value: m.medication_name || 'Dose' });
      }
    }
  } else if (et.includes('NOTE') && d.notes) {
    value = d.notes.length > 60 ? `${d.notes.slice(0, 60)}…` : d.notes;
    label = 'Note';
  }
  if (!value) return null;

  const spoke = Object.keys(EVENT_SPOKE).find((k) => et.includes(k));
  const guide = spoke ? SPOKE_GUIDANCE[EVENT_SPOKE[spoke]] : undefined;
  return { value, label, rows, zone: guide?.zone, flag: guide?.flag };
}

/** Evidence-tier pill color. AI-inferred content must never look
 *  equivalent to source facts — amber/grey vs teal/violet. */
function evidenceBadgeColor(badge: string | null | undefined): string {
  const b = (badge || '').toUpperCase();
  if (b.includes('SOURCE-STATED') || b === 'SOURCE_FACT' || b === 'CONFIRMED') return '#4FD1C5';
  if (b.includes('USER-REPORTED')) return '#B8A6E8';
  if (b.includes('AI-INFERRED')) return '#F5A623';
  if (b === 'NORMALIZED' || b.includes('SYSTEM-DERIVED')) return '#7C8DA6';
  return '#9AA8B8';
}

function formatDetailValue(v: any): string | null {
  if (v == null) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
    const s = String(v);
    return s.length > 220 ? `${s.slice(0, 220)}…` : s;
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return null;
    // Compact scalar arrays only; object rows render via citations/entries.
    if (v.every((x) => typeof x === 'string' || typeof x === 'number')) {
      const s = v.slice(0, 6).join(', ');
      return v.length > 6 ? `${s} (+${v.length - 6} more)` : s;
    }
    return `${v.length} items`;
  }
  return null;
}

/** Server-backed rich detail (P0–P3 NodeDetailPayload). Renders only fields
 *  the API actually provides; absent data stays absent, never invented. */
function RichDetailContent({ detail, onOpenDocument }: { detail: NodeDetailPayload; onOpenDocument?: (documentId: string) => void }) {
  const rows: { key: string; value: string }[] = [];
  for (const [k, v] of Object.entries(detail.structured_fields ?? {})) {
    if (rows.length >= 12) break;
    const fv = formatDetailValue(v);
    if (fv == null || fv === '') continue;
    rows.push({ key: k.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()), value: fv });
  }
  for (const [k, v] of Object.entries(detail.status ?? {})) {
    if (rows.length >= 14) break;
    const fv = formatDetailValue(v);
    if (fv == null || fv === '') continue;
    rows.push({ key: k.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()), value: fv });
  }
  const citations = (detail.citations ?? []).filter((c) => c && (c.quote || c.document_id));
  return (
    <>
      {detail.evidence_badge ? (
        <View style={styles.evBadgeRow}>
          <View style={[styles.evBadge, { backgroundColor: evidenceBadgeColor(detail.evidence_badge) }]}>
            <Text style={styles.evBadgeText}>{detail.evidence_badge}</Text>
          </View>
        </View>
      ) : null}
      {detail.summary ? <Text style={styles.detailDesc}>{detail.summary}</Text> : null}
      {rows.length > 0 && (
        <View style={styles.dt}>
          <Text style={styles.dtt}>Details</Text>
          {rows.map((p) => (<View key={p.key} style={styles.dpr}><Text style={styles.dpk}>{p.key}</Text><Text style={styles.dpv}>{p.value}</Text></View>))}
        </View>
      )}
      {detail.evidence?.quote ? (
        <View style={styles.dt}>
          <Text style={styles.dtt}>Evidence</Text>
          <View style={styles.evQuoteBox}>
            <Text style={styles.evQuote} numberOfLines={6}>{String(detail.evidence.quote)}</Text>
          </View>
        </View>
      ) : null}
      {citations.length > 0 && (
        <View style={styles.dc}>
          <Text style={styles.dct}>Sources ({citations.length})</Text>
          {citations.slice(0, 3).map((c: GraphCitation, i: number) => {
            const docId = c.document_id;
            const label = docId ? 'Open source document' : (c.node_id || 'Evidence');
            const sub = c.quote ? String(c.quote).slice(0, 90) : null;
            const Body = (
              <View style={styles.nbRowText}>
                <Text style={styles.clbl} numberOfLines={1}>{label}</Text>
                {sub ? <Text style={styles.nbRel} numberOfLines={2}>{sub}</Text> : null}
              </View>
            );
            return docId && onOpenDocument ? (
              <Pressable key={`${docId}-${i}`} style={styles.dci} onPress={() => onOpenDocument(docId)}>
                {Body}
                <Text style={styles.nbGo}>›</Text>
              </Pressable>
            ) : (
              <View key={`${docId || c.node_id || i}`} style={styles.dci}>{Body}</View>
            );
          })}
        </View>
      )}
    </>
  );
}

function NodeDetailContent({ nodeDetail, onSelectNode, onViewBody, onOpenDocument, localDetails = [], allEdges = [], nodesById = new Map() }: { nodeDetail: any; onSelectNode: (id: string) => void; onViewBody: (sid?: string) => void; onOpenDocument?: (documentId: string) => void; localDetails?: DailyCheckInDetail[]; allEdges?: GraphEdge[]; nodesById?: Map<string, GraphNode> }) {
  const node = nodeDetail.node;
  const color = NODE_COLORS[node.type] || '#9AA8B8';
  const title = node.label || CATEGORY_LABELS[node.type] || node.type;

  const techProps: { key: string; value: string }[] = [];
  if (node.type === 'observation') {
    if (node.properties?.observation_type) techProps.push({ key: 'Type', value: String(node.properties.observation_type).replace(/_/g, ' ') });
    if (node.properties?.finding_code) techProps.push({ key: 'Code', value: String(node.properties.finding_code) });
    if (node.properties?.value != null) techProps.push({ key: 'Value', value: String(node.properties.value) });
    if (node.properties?.unit) techProps.push({ key: 'Unit', value: String(node.properties.unit) });
    if (node.properties?.visual_status) techProps.push({ key: 'Status', value: String(node.properties.visual_status).replace(/_/g, ' ') });
    if (node.properties?.visual_severity_score != null) techProps.push({ key: 'Severity', value: `${Math.round(node.properties.visual_severity_score * 100)}%` });
    if (node.properties?.trend) techProps.push({ key: 'Trend', value: String(node.properties.trend) });
    if (node.properties?.source_type) techProps.push({ key: 'Source', value: String(node.properties.source_type).replace(/_/g, ' ') });
    if (node.properties?.body_site) techProps.push({ key: 'Body Site', value: String(node.properties.body_site).replace(/_/g, ' ') });
    if (node.properties?.body_system) techProps.push({ key: 'Body System', value: String(node.properties.body_system).replace(/_/g, ' ') });
    if (node.properties?.clinical_summary) techProps.push({ key: 'Summary', value: String(node.properties.clinical_summary) });
    if (node.properties?.interpretation) techProps.push({ key: 'Interpretation', value: String(node.properties.interpretation).replace(/_/g, ' ') });
    if (node.properties?.reference_range) techProps.push({ key: 'Ref Range', value: String(node.properties.reference_range) });
    if (node.properties?.event_time) techProps.push({ key: 'Time', value: String(node.properties.event_time) });
  } else {
    if (node.properties?.category) techProps.push({ key: 'Category', value: String(node.properties.category).replace(/_/g, ' ') });
    if (node.properties?.event_type) techProps.push({ key: 'Event', value: String(node.properties.event_type).replace(/_/g, ' ') });
    // Generic scalar passthrough — every node type deserves real details,
    // not just observations.
    const SKIP = new Set(['id', 'label', 'type', 'category', 'event_type', 'event_time', 'created_at', 'date']);
    let extra = 0;
    for (const [k, v] of Object.entries(node.properties ?? {})) {
      if (extra >= 10 || SKIP.has(k) || v == null) continue;
      if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') continue;
      techProps.push({ key: k.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()), value: String(v) });
      extra++;
    }
  }

  const hero = eventHero(node, localDetails);

  // Semantic cross-metric links for this node (from local edges — the server
  // detail doesn't know about frontend-derived edges).
  const semanticRows: { id: string; label: string; rel: string; verdict: string }[] = [];
  for (const e of allEdges) {
    if (e.relationship !== 'CORRELATES' && e.relationship !== 'INVERSES') continue;
    const other = e.source === node.id ? e.target : e.target === node.id ? e.source : null;
    if (!other) continue;
    const on = nodesById.get(other);
    if (!on) continue;
    semanticRows.push({
      id: other,
      label: on.label || CATEGORY_LABELS[on.type] || on.type,
      rel: relationshipLabel(e, on.label || ''),
      verdict: String(e.properties?.verdict ?? 'neutral'),
    });
  }

  // Relationship labels for the server-known connections.
  const edgeByPair = new Map<string, GraphEdge>();
  for (const e of nodeDetail.connected_edges ?? []) {
    edgeByPair.set(`${e.source}~${e.target}`, e);
    edgeByPair.set(`${e.target}~${e.source}`, e);
  }

  return (
    <>
      <View style={styles.detailHeader}>
        <View style={styles.detailTypeBadge}>
          <View style={[styles.detailTypeDot, { backgroundColor: color }]} />
          <Text style={styles.detailTypeText}>{CATEGORY_LABELS[node.type] || node.type}</Text>
        </View>
        <Pressable onPress={() => onSelectNode('')}><Text style={styles.detailClose}>✕</Text></Pressable>
      </View>
      <Text style={styles.detailTitle}>{title}</Text>
      {nodeDetail.detail ? (
        <RichDetailContent detail={nodeDetail.detail} onOpenDocument={onOpenDocument} />
      ) : null}
      {hero ? (
        <View style={styles.heroBox}>
          <Text style={styles.heroValue} numberOfLines={2}>{hero.value}</Text>
          <Text style={styles.heroLabel}>{hero.label}</Text>
          {hero.rows.map((r) => (
            <View key={r.key} style={styles.heroRow}>
              <Text style={styles.heroRowKey}>{r.key}</Text>
              <Text style={styles.heroRowVal}>{r.value}</Text>
            </View>
          ))}
          {hero.zone ? <Text style={styles.heroZone}>Usual zone · {hero.zone}</Text> : null}
          {hero.flag ? <Text style={styles.heroFlag}>{hero.flag}</Text> : null}
        </View>
      ) : (
        <Text style={styles.detailDesc}>{genDesc(node)}</Text>
      )}
      <View style={styles.df}><Text style={styles.dfl}>What</Text><Text style={styles.dfv}>{genWhat(node)}</Text></View>
      <View style={styles.df}><Text style={styles.dfl}>When</Text><Text style={styles.dfv}>{genWhen(node)}</Text></View>
      {genSource(node) && <View style={styles.df}><Text style={styles.dfl}>Source</Text><Text style={styles.dfv}>{genSource(node)}</Text></View>}
      {semanticRows.length > 0 && (
        <View style={styles.dc}>
          <Text style={styles.dct}>Linked patterns ({semanticRows.length})</Text>
          {semanticRows.map((s) => (
              <Pressable key={s.id} style={styles.dci} onPress={() => onSelectNode(s.id)}>
                <View style={[styles.dot, { backgroundColor: s.verdict === 'bad' ? '#E0746B' : s.verdict === 'good' ? '#4FD1C5' : '#9AA8B8' }]} />
              <View style={styles.nbRowText}>
                <Text style={styles.clbl} numberOfLines={1}>{s.label}</Text>
                <Text style={styles.nbRel} numberOfLines={1}>{s.rel}</Text>
              </View>
              <Text style={styles.nbGo}>›</Text>
            </Pressable>
          ))}
        </View>
      )}
      {nodeDetail.connected_nodes.length > 0 && (
        <View style={styles.dc}>
          <Text style={styles.dct}>Connected ({nodeDetail.connected_nodes.length})</Text>
          {nodeDetail.connected_nodes.slice(0, 5).map((cn: any) => {
            const edge = edgeByPair.get(`${node.id}~${cn.id}`);
            return (
              <Pressable key={cn.id} style={styles.dci} onPress={() => onSelectNode(cn.id)}>
                <View style={[styles.dot, { backgroundColor: NODE_COLORS[cn.type] || '#9AA8B8' }]} />
                <View style={styles.nbRowText}>
                  <Text style={styles.clbl} numberOfLines={1}>{cn.label}</Text>
                  {edge ? <Text style={styles.nbRel} numberOfLines={1}>{relationshipLabel(edge, cn.label)}</Text> : null}
                </View>
                <Text style={styles.nbGo}>›</Text>
              </Pressable>
            );
          })}
        </View>
      )}
      {techProps.length > 0 && (
        <View style={styles.dt}>
          <Text style={styles.dtt}>Details</Text>
          {techProps.map((p) => (<View key={p.key} style={styles.dpr}><Text style={styles.dpk}>{p.key}</Text><Text style={styles.dpv}>{p.value}</Text></View>))}
        </View>
      )}
      {node.type === 'body_structure' && (
        <Pressable style={styles.vbb} onPress={() => { const s = node.id.split(':')[1]; if (s) onViewBody(s); }}>
          <Text style={styles.vbbt}>View in 3D Body</Text>
        </Pressable>
      )}
    </>
  );
}

/**
 * Neighbor focus card (tap): what is this node connected to, and are those
 * links healthy or strained? Rows re-focus on tap; footer opens full details.
 */
function NeighborFocusCard({
  node,
  nodes,
  edges,
  verdicts,
  onSelectNode,
  onShowDetails,
}: {
  node: GraphNode;
  nodes: GraphNode[];
  edges: GraphEdge[];
  verdicts: Map<string, NeighborVerdict>;
  onSelectNode: (id: string) => void;
  onShowDetails: () => void;
}) {
  const color = NODE_COLORS[node.type] || '#9AA8B8';
  const title = node.label || CATEGORY_LABELS[node.type] || node.type;
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const rows = useMemo(() => {
    const out: { id: string; label: string; type: string; rel: string; verdict: NeighborVerdict; semantic: boolean }[] = [];
    for (const e of edges) {
      const other = e.source === node.id ? e.target : e.target === node.id ? e.source : null;
      if (!other) continue;
      const on = byId.get(other);
      if (!on) continue;
      const semantic = e.relationship === 'CORRELATES' || e.relationship === 'INVERSES';
      const label = on.label || CATEGORY_LABELS[on.type] || on.type;
      out.push({
        id: other,
        label,
        type: on.type,
        rel: relationshipLabel(e, label),
        verdict: verdicts.get(other) ?? 'neutral',
        semantic,
      });
    }
    const rank = (v: NeighborVerdict) => (v === 'bad' ? 0 : v === 'good' ? 1 : 2);
    out.sort((a, b) => rank(a.verdict) - rank(b.verdict) || Number(b.semantic) - Number(a.semantic));
    return out.slice(0, 8);
  }, [node.id, nodes, edges, verdicts, byId]);

  const bad = rows.filter((r) => r.verdict === 'bad').length;
  const good = rows.filter((r) => r.verdict === 'good').length;
  const summary = rows.length === 0
    ? 'No connections yet'
    : bad > 0 && good > 0
      ? `${bad} strained · ${good} healthy`
      : bad > 0
        ? `${bad} strained link${bad === 1 ? '' : 's'}`
        : good > 0
          ? `${good} healthy link${good === 1 ? '' : 's'}`
          : `${rows.length} connection${rows.length === 1 ? '' : 's'}`;

  return (
    <>
      <View style={styles.detailHeader}>
        <View style={styles.detailTypeBadge}>
          <View style={[styles.detailTypeDot, { backgroundColor: color }]} />
          <Text style={styles.detailTypeText}>{CATEGORY_LABELS[node.type] || node.type}</Text>
        </View>
        <Pressable onPress={() => onSelectNode('')}><Text style={styles.detailClose}>✕</Text></Pressable>
      </View>
      <Text style={styles.detailTitle}>{title}</Text>
      <Text style={styles.nbSummary}>{summary}</Text>
      {rows.map((r) => {
        const dot = r.verdict === 'bad' ? '#E0746B' : r.verdict === 'good' ? '#4FD1C5' : NODE_COLORS[r.type] || '#9AA8B8';
        return (
          <Pressable key={r.id} style={styles.dci} onPress={() => onSelectNode(r.id)}>
            <View style={[styles.dot, { backgroundColor: dot }]} />
            <View style={styles.nbRowText}>
              <Text style={styles.clbl} numberOfLines={1}>{r.label}</Text>
              <Text style={styles.nbRel} numberOfLines={1}>{r.rel}</Text>
            </View>
            <Text style={styles.nbGo}>›</Text>
          </Pressable>
        );
      })}
      <Pressable style={styles.nbFooter} onPress={onShowDetails}>
        <Text style={styles.nbFooterText}>Full details  →</Text>
      </Pressable>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Native Canvas — same pattern as original BodyScreen
// ═══════════════════════════════════════════════════════════════════════════════

function NativeCanvas({
  nodes,
  edges,
  layout,
  selectedNodeId,
  onNodeTap,
  onNodeLongPress,
  onLayout,
  sceneOut,
  theme = 'dark',
  flowEdgeIds,
  focusVerdicts,
  labelDefs = [],
  dimIds = null,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  layout: Map<string, LayoutPos>;
  selectedNodeId: string | null;
  onNodeTap: (id: string) => void;
  onNodeLongPress?: (id: string) => void;
  onLayout?: (w: number, h: number) => void;
  sceneOut?: React.MutableRefObject<GraphSceneManager | null>;
  theme?: 'dark' | 'panel';
  flowEdgeIds?: Set<string>;
  focusVerdicts?: Map<string, NeighborVerdict>;
  labelDefs?: NodeLabelDef[];
  dimIds?: Set<string> | null;
}) {
  const sceneRef = useRef<GraphSceneManager | null>(null);
  const animFrameRef = useRef<number>(0);
  // Latest data for context creation — GLView fires onContextCreate once, which
  // can race the query resolving, so never rely on callback-closure data.
  const dataRef = useRef({ nodes, edges, layout, flowEdgeIds });
  dataRef.current = { nodes, edges, layout, flowEdgeIds };
  const gestureState = useRef({ lastX: 0, lastY: 0, startX: 0, startY: 0, startTime: 0, moved: false, lastDist: 0, isPinching: false, longPressTimer: null as ReturnType<typeof setTimeout> | null, longPressFired: false });
  // Latest long-press callback (props change across renders).
  const longPressRef = useRef(onNodeLongPress);
  longPressRef.current = onNodeLongPress;
  // Latest focus (a tap can land before GL context creation finishes).
  const focusRef = useRef({ id: selectedNodeId, verdicts: focusVerdicts });
  focusRef.current = { id: selectedNodeId, verdicts: focusVerdicts };
  // Reduced-motion mirror for the scene (static graph, no bob/drift/pulses).
  const reduceMotion = useReducedMotion();
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;
  const canvasSize = useRef({ w: SCREEN_WIDTH, h: SCREEN_HEIGHT - 120 });
  const graphBounds = useRef({ x: 0, y: 0, width: SCREEN_WIDTH, height: SCREEN_HEIGHT - 120 });
  // Floating labels: projected positions refreshed ~8Hz (cheap setState, tiny views).
  const [labelProjs, setLabelProjs] = useState<NodeLabelProjection[]>([]);
  const labelDefsRef = useRef(labelDefs);
  labelDefsRef.current = labelDefs;
  const dimIdsRef = useRef(dimIds);
  dimIdsRef.current = dimIds;
  const selectedRef = useRef(selectedNodeId);
  selectedRef.current = selectedNodeId;

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animFrameRef.current);
      if (gestureState.current.longPressTimer) clearTimeout(gestureState.current.longPressTimer);
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, []);

  // Rebuild graph when DATA changes — never on selection (in-place focus).
  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.buildGraph(nodes, edges, layout, flowEdgeIds);
    }
  }, [nodes, edges, layout, flowEdgeIds]);

  // Selection is a cheap in-place recolor/rescale — no rebuild, no jank.
  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.setFocus(selectedNodeId, focusVerdicts);
    }
  }, [selectedNodeId, focusVerdicts]);

  useEffect(() => {
    sceneRef.current?.setReducedMotion(reduceMotion);
  }, [reduceMotion]);

  // Expose scene to parent
  useEffect(() => {
    if (sceneOut) sceneOut.current = sceneRef.current;
    return () => { if (sceneOut) sceneOut.current = null; };
  });

  const handleContextCreate = useCallback(async (gl: any) => {
    try {
      const w = canvasSize.current.w;
      const h = canvasSize.current.h;
      // Canvas shim — same as original BodyScreen
      const canvas = {
        width: w,
        height: h,
        style: {} as Record<string, any>,
        getContext: (name: string, _attrs?: any) => {
          if (name === 'webgl2') {
            if (!(gl as any).canvas) (gl as any).canvas = canvas;
            return gl;
          }
          return null;
        },
        addEventListener: () => {},
        removeEventListener: () => {},
        setAttribute: () => {},
        removeAttribute: () => {},
      };

      const renderer = new THREE.WebGLRenderer({ canvas: canvas as any, antialias: true, alpha: true });
      // Size from the REAL surface: if three's viewport is smaller than expo's
      // drawing buffer, geometry renders into a sub-rect (the "cut halfway"
      // look). Never guess from CSS pixels + ratio.
      const dbW = (gl as any).drawingBufferWidth as number | undefined;
      const dbH = (gl as any).drawingBufferHeight as number | undefined;
      if (dbW && dbH) {
        renderer.setPixelRatio(1);
        renderer.setSize(dbW, dbH, false);
      } else {
        // Mobile-GPU-first: cap pixel ratio (MSAA + high DPR is the top jank source).
        renderer.setPixelRatio(Platform.OS === 'web' ? Math.min(window.devicePixelRatio, 2) : 1.5);
        renderer.setSize(w, h);
      }
      if (__DEV__) console.log('[HealthGraphGL] surface=', dbW ?? '?', 'x', dbH ?? '?', 'view=', w, 'x', h);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.1;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.sortObjects = true;

      const scene = new GraphSceneManager(w, h, theme);
      scene.setRenderer(renderer);
      scene.setExpoGLContext(gl);
      scene.setReducedMotion(reduceMotionRef.current);
      scene.buildGraph(dataRef.current.nodes, dataRef.current.edges, dataRef.current.layout, dataRef.current.flowEdgeIds);
      sceneRef.current = scene;
      if (__DEV__) {
        let maxX = 0, maxY = 0;
        dataRef.current.layout.forEach((p) => { maxX = Math.max(maxX, Math.abs(p.x)); maxY = Math.max(maxY, Math.abs(p.y)); });
        console.log('[HealthGraphBuild] theme=', theme, 'nodes=', dataRef.current.nodes.length, 'edges=', dataRef.current.edges.length, 'extentX=', maxX.toFixed(2), 'extentY=', maxY.toFixed(2), 'camDist=', sceneRef.current ? sceneRef.current.cameraDistance().toFixed(2) : 'none');
      }

      let last = typeof performance !== 'undefined' ? performance.now() : Date.now();
      let lastLabels = 0;
      const animate = () => {
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        scene.render(dt);
        // Floating labels track the camera — throttled, skipped when idle
        // and static (reduced motion parks everything anyway).
        if (now - lastLabels > 125 && labelDefsRef.current.length > 0) {
          lastLabels = now;
          setLabelProjs(scene.projectNodes(labelDefsRef.current.map((d) => d.id)));
        }
        animFrameRef.current = requestAnimationFrame(animate);
      };
      animate();
    } catch (err) {
      console.error('[HealthGraph] GL init failed:', err);
    }
  }, []);

  // Gesture handlers — same pattern as original BodyScreen
  const clearLongPressTimer = () => {
    if (gestureState.current.longPressTimer) {
      clearTimeout(gestureState.current.longPressTimer);
      gestureState.current.longPressTimer = null;
    }
  };

  const handleTouchStart = (e: GestureResponderEvent) => {
    const touches = e.nativeEvent.touches;
    if (touches.length === 1) {
      gestureState.current.lastX = touches[0].pageX;
      gestureState.current.lastY = touches[0].pageY;
      gestureState.current.startX = touches[0].pageX;
      gestureState.current.startY = touches[0].pageY;
      gestureState.current.startTime = Date.now();
      gestureState.current.moved = false;
      gestureState.current.isPinching = false;
      gestureState.current.longPressFired = false;
      // Long-press: hold ≥500ms without drifting → full detail sheet.
      // NOTE: read nativeEvent fields NOW — the synthetic event is pooled and
      // null by the time the timer fires.
      clearLongPressTimer();
      const sx = touches[0].pageX;
      const sy = touches[0].pageY;
      const ne = e.nativeEvent as any;
      const gx0 = graphBounds.current.x;
      const gy0 = graphBounds.current.y;
      const lx0 = typeof ne.locationX === 'number' ? ne.locationX : sx - gx0;
      const ly0 = typeof ne.locationY === 'number' ? ne.locationY : sy - gy0;
      gestureState.current.longPressTimer = setTimeout(() => {
        gestureState.current.longPressTimer = null;
        const st = gestureState.current;
        if (st.moved || st.isPinching || !sceneRef.current) return;
        const id = sceneRef.current.handleTap(lx0, ly0, 0, 0);
        if (id) {
          st.longPressFired = true;
          st.moved = true; // suppress the tap that follows on release
          if (__DEV__) console.log('[HealthGraphLongPress] nodeId=', id);
          try { Vibration.vibrate(25); } catch { /* best-effort */ }
          longPressRef.current?.(id);
        } else if (__DEV__) {
          console.log('[HealthGraphLongPress] hit=false');
        }
      }, 500);
    } else if (touches.length === 2) {
      clearLongPressTimer();
      const dx = touches[0].pageX - touches[1].pageX;
      const dy = touches[0].pageY - touches[1].pageY;
      gestureState.current.lastDist = Math.sqrt(dx * dx + dy * dy);
      gestureState.current.isPinching = true;
    }
  };

  const handleTouchMove = (e: GestureResponderEvent) => {
    if (!sceneRef.current) return;
    const touches = e.nativeEvent.touches;
    if (touches.length === 1 && !gestureState.current.isPinching) {
      const dx = touches[0].pageX - gestureState.current.lastX;
      const dy = touches[0].pageY - gestureState.current.lastY;
      const totalDx = touches[0].pageX - gestureState.current.startX;
      const totalDy = touches[0].pageY - gestureState.current.startY;
      if (Math.hypot(totalDx, totalDy) > 10) {
        gestureState.current.moved = true;
        clearLongPressTimer();
      }
      sceneRef.current.handlePanMove(dx, dy);
      gestureState.current.lastX = touches[0].pageX;
      gestureState.current.lastY = touches[0].pageY;
    } else if (touches.length === 2) {
      const dx = touches[0].pageX - touches[1].pageX;
      const dy = touches[0].pageY - touches[1].pageY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      gestureState.current.moved = true;
      if (gestureState.current.lastDist > 0) {
        sceneRef.current.handlePinch(dist / gestureState.current.lastDist);
      }
      gestureState.current.lastDist = dist;
    }
  };

  const handleTouchEnd = (e: GestureResponderEvent) => {
    clearLongPressTimer();
    if (e.nativeEvent.touches.length < 2) {
      gestureState.current.isPinching = false;
      gestureState.current.lastDist = 0;
    }
  };

  const handleResponderRelease = (e: GestureResponderEvent) => {
    if (!sceneRef.current) return;
    const gestureDuration = Date.now() - gestureState.current.startTime;
    // B4: a simple tap (little movement, short duration) must not be treated as
    // orbit/pan. Anything that moved >= 10px or lasted > 450ms is a gesture.
    if (gestureState.current.moved || gestureDuration > 450 || gestureState.current.isPinching) return;

    // B3: convert the actual touch point inside the measured graph container.
    // locationX/locationY are relative to this view (which fills the GLView), so
    // they map 1:1 onto the renderer viewport. Fall back to pageX/pageY minus
    // the measured graph origin only when local coordinates are unavailable.
    const nativeEvent = e.nativeEvent as any;
    const graphX = graphBounds.current.x;
    const graphY = graphBounds.current.y;
    const locationX =
      typeof nativeEvent.locationX === 'number'
        ? nativeEvent.locationX
        : (nativeEvent.pageX ?? 0) - graphX;
    const locationY =
      typeof nativeEvent.locationY === 'number'
        ? nativeEvent.locationY
        : (nativeEvent.pageY ?? 0) - graphY;
    const tappedId = sceneRef.current.handleTap(locationX, locationY, 0, 0);
    if (tappedId) onNodeTap(tappedId);
  };

  const handleReset = useCallback(() => {
    sceneRef.current?.resetView();
  }, []);

  return (
    <View
      style={styles.canvasWrap}
      onLayout={(e) => {
        const { x, y, width, height } = e.nativeEvent.layout;
        canvasSize.current = { w: width, h: height };
        graphBounds.current = { x, y, width, height };
        sceneRef.current?.setViewport(width, height);
        onLayout?.(width, height);
      }}
      // Restores the working tap flow from the original BodyScreen canvas:
      // the View wrapping the GLView claims the responder on touch start so
      // onResponderRelease (tap detection) actually fires. Without this the
      // GLView never becomes responder and taps are silently dropped.
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onResponderRelease={handleResponderRelease}
      onStartShouldSetResponder={() => true}
    >
      <GLView
        style={{ width: '100%' as any, height: '100%' as any }}
        onContextCreate={handleContextCreate}
      />
      {/* Floating labels — every major node reads without a tap. */}
      <NodeLabels
        defs={labelDefs}
        projs={labelProjs}
        width={canvasSize.current.w}
        height={canvasSize.current.h}
        selectedId={selectedRef.current}
        dimIds={dimIdsRef.current}
      />
    </View>
  );
}

/** Screen-space label pills projected from the 3D scene (pointer-transparent). */
function NodeLabels({
  defs,
  projs,
  width,
  height,
  selectedId,
  dimIds,
}: {
  defs: NodeLabelDef[];
  projs: NodeLabelProjection[];
  width: number;
  height: number;
  selectedId: string | null;
  dimIds: Set<string> | null;
}) {
  const meta = useMemo(() => new Map(defs.map((d) => [d.id, d])), [defs]);
  if (projs.length === 0) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {projs.map((p) => {
        const m = meta.get(p.id);
        if (!m || p.behind || p.x < -60 || p.x > width + 60 || p.y < -16 || p.y > height + 16) return null;
        const dimmed = dimIds != null && dimIds.has(p.id);
        const selected = selectedId === p.id;
        return (
          <View
            key={p.id}
            style={[
              labelStyles.pill,
              selected && labelStyles.pillSelected,
              { left: p.x + 12, top: p.y - 12, opacity: dimmed ? 0.22 : 1 },
            ]}
          >
            <View style={[labelStyles.dot, { backgroundColor: m.color }]} />
            <Text style={labelStyles.text} numberOfLines={1}>{m.text}</Text>
          </View>
        );
      })}
    </View>
  );
}

const labelStyles = StyleSheet.create({
  pill: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: 140,
    backgroundColor: GV.stage,
    borderWidth: 1,
    borderColor: GV.stageline,
    borderRadius: SPACE.rPill,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  pillSelected: {
    borderColor: GV.teal,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { color: '#FFFFFF', fontSize: 11, fontFamily: FONT.semi, flexShrink: 1 },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Main Screen
// ═══════════════════════════════════════════════════════════════════════════════

export default function HealthGraphScreen({
  embedded = false,
  focusStructureId: focusStructureIdProp,
  focusSource: focusSourceProp,
}: {
  embedded?: boolean;
  focusStructureId?: string;
  focusSource?: 'body' | 'graph';
}) {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const focusStructureId = focusStructureIdProp ?? route.params?.focusStructureId;
  const focusSource = focusSourceProp ?? route.params?.source;

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  /** Tap opens the neighbor card; long-press (or "Full details") opens the sheet. */
  const [sheetMode, setSheetMode] = useState<'neighbors' | 'full'>('neighbors');
  const [popupPos, setPopupPos] = useState<{ x: number; y: number } | null>(null);
  const hasAppliedFocus = useRef(false);
  const [graphHeight, setGraphHeight] = useState(SCREEN_HEIGHT - 120);
  const [embedSize, setEmbedSize] = useState({ w: SCREEN_WIDTH, h: SCREEN_HEIGHT - 120 });

  const { data: graphData, isLoading, error, refetch } = useHealthGraph({ depth: 2, limit: 100, category: activeFilter ?? undefined });
  const { data: nodeDetail } = useGraphNodeDetail(selectedNodeId);

  // Cross-metric knowledge for semantic edges (sleep↔wellbeing, …) — same
  // feeds the dashboard already loads; no extra backend calls.
  const trendsQ = useTrends();
  const metricsQ = useDailyMetrics();
  const feedQ = useCorrelationFeed(trendsQ.data ?? null, metricsQ.data ?? null);

  const semanticEdges = useMemo(() => buildSemanticEdges({
    trends: trendsQ.data ?? null,
    dailyMetrics: metricsQ.data ?? null,
    localDetails: feedQ.localDetails,
    nodes: graphData?.nodes ?? [],
  }), [trendsQ.data, metricsQ.data, feedQ.localDetails, graphData]);

  const allEdges = useMemo<GraphEdge[]>(
    () => [...(graphData?.edges ?? []), ...semanticEdges],
    [graphData, semanticEdges],
  );
  const flowEdgeIds = useMemo(() => new Set(semanticEdges.map((e) => e.id)), [semanticEdges]);

  // Live pattern counts for the HUD strip under the filters.
  const patternCounts = useMemo(() => {
    let bad = 0, good = 0;
    for (const e of semanticEdges) {
      const v = e.properties?.verdict;
      if (v === 'bad') bad++;
      else if (v === 'good') good++;
    }
    return { bad, good, total: semanticEdges.length };
  }, [semanticEdges]);

  // Verdict per 1-hop neighbor — drives badge dots + the neighbor card.
  const focusVerdicts = useMemo(() => {
    const v = neighborVerdictsFor(selectedNodeId, graphData?.nodes ?? [], allEdges, feedQ.localDetails);
    if (__DEV__ && selectedNodeId) {
      // Prove the data chain: details loaded? event_time present? dates match?
      let sampleTime: string | null = null;
      for (const e of allEdges) {
        const other = e.source === selectedNodeId ? e.target : e.target === selectedNodeId ? e.source : null;
        if (other) {
          sampleTime = String(graphData?.nodes.find((n) => n.id === other)?.properties?.event_time ?? null);
          break;
        }
      }
      const dateKeys = (feedQ.localDetails ?? []).slice(0, 3).map((d) => d.log_date).join(',');
      console.log('[HealthGraphVerdicts] details=', (feedQ.localDetails ?? []).length, 'dates=[', dateKeys, '] sampleNeighborEventTime=', sampleTime);
    }
    return v;
  }, [selectedNodeId, graphData, allEdges, feedQ.localDetails]);

  const selectedNode = useMemo(
    () => graphData?.nodes.find((n) => n.id === selectedNodeId) ?? null,
    [graphData, selectedNodeId],
  );

  const nodesById = useMemo(
    () => new Map((graphData?.nodes ?? []).map((n) => [n.id, n] as [string, GraphNode])),
    [graphData],
  );

  // Floating labels: patient → structures → observations → meds, capped so
  // the canvas reads instead of crowds (8 embedded, 24 full screen).
  const labelDefs = useMemo<NodeLabelDef[]>(() => {
    if (!graphData) return [];
    const rank: Record<string, number> = {
      patient: 0,
      body_structure: 1,
      observation: 2,
      condition_occurrence: 2,
      measurement: 3,
      ppg_measurement: 3,
      medication: 3,
      medication_request: 4,
      medication_taken_event: 4,
      medication_canonical: 5,
      visit: 5,
      sleep_episode: 5,
      activity_event: 5,
      nutrition_intake: 5,
      food_scan: 5,
      document: 6,
      timeline_event: 6,
      patient_statement: 7,
      food_entry: 7,
      medication_version: 7,
      concept: 8,
    };
    const cap = embedded ? 8 : 24;
    return [...graphData.nodes]
      .sort((a, b) => (rank[a.type] ?? 9) - (rank[b.type] ?? 9))
      .slice(0, cap)
      .map((n) => ({
        id: n.id,
        text: (n.label || CATEGORY_LABELS[n.type] || n.type).slice(0, 22),
        color: nodeDomainColor(n),
      }));
  }, [graphData, embedded]);

  // In focus mode the dimmed nodes' labels dim with them.
  const labelDimIds = useMemo<Set<string> | null>(() => {
    if (!selectedNodeId) return null;
    const dim = new Set<string>();
    for (const d of labelDefs) {
      if (d.id !== selectedNodeId && !focusVerdicts.has(d.id)) dim.add(d.id);
    }
    return dim;
  }, [selectedNodeId, focusVerdicts, labelDefs]);

  const availableCategories = useMemo(() => {
    if (!graphData) return [];
    return Array.from(new Set(graphData.nodes.map((n) => n.type))).filter((t) => t !== 'patient');
  }, [graphData]);

  const layout = useMemo(() => {
    if (!graphData) return new Map();
    return computeLayout(graphData.nodes, allEdges);
  }, [graphData, allEdges]);

  useEffect(() => {
    if (hasAppliedFocus.current || !focusStructureId || !graphData) return;
    hasAppliedFocus.current = true;
    const fn = `body_structure:${focusStructureId}`;
    const t = graphData.nodes.find((n) => n.id === fn);
    if (t) { setSelectedNodeId(t.id); setShowDetail(true); }
  }, [focusStructureId, graphData]);

  const handleFilterPress = useCallback((cat: string | null) => {
    setActiveFilter(cat);
    if (selectedNodeId && cat) {
      const n = graphData?.nodes.find((nd) => nd.id === selectedNodeId);
      if (n && n.type !== cat) { setSelectedNodeId(null); setShowDetail(false); }
    }
  }, [selectedNodeId, graphData]);

  const handleReset = useCallback(() => {
    setSelectedNodeId(null); setShowDetail(false); setActiveFilter(null);
  }, []);

  const handleNodeTap = useCallback((id: string) => {
    if (id === selectedNodeId) { setSelectedNodeId(null); setShowDetail(false); }
    else { setSelectedNodeId(id); setShowDetail(true); setSheetMode('neighbors'); }
  }, [selectedNodeId]);

  const handleNodeLongPress = useCallback((id: string) => {
    setSelectedNodeId(id);
    setShowDetail(true);
    setSheetMode('full');
  }, []);

  const handleSelectNode = useCallback((id: string) => {
    if (!id) { setSelectedNodeId(null); setShowDetail(false); return; }
    setSelectedNodeId(id); setShowDetail(true); setSheetMode('neighbors');
  }, []);

  const handleViewBody = useCallback((sid?: string) => {
    if (embedded) {
      // Mounted inside a tab screen — navigate straight to the Body tab.
      const nav = navigation as unknown as { navigate: (screen: string, params?: object) => void };
      nav.navigate('Body', sid ? { focusStructureId: sid } : undefined);
      return;
    }
    navigation.navigate('Main', { screen: 'Body', params: sid ? { focusStructureId: sid } : undefined } as any);
  }, [navigation, embedded]);

  // Dynamic popup position tracking — MUST be before any early returns
  const sceneOutRef = useRef<GraphSceneManager | null>(null);
  const popupAnimRef = useRef<number>(0);
  const lastPopupUpdateRef = useRef(0);

  useEffect(() => {
    if (!showDetail || !selectedNodeId) { setPopupPos(null); return; }
    const update = () => {
      const scene = sceneOutRef.current;
      if (!scene) { popupAnimRef.current = requestAnimationFrame(update); return; }
      const pos = scene.getSelectedNodeScreenPosition();
      const now = Date.now();
      if (pos && now - lastPopupUpdateRef.current >= 50) {
        lastPopupUpdateRef.current = now;
        setPopupPos(pos);
      }
      popupAnimRef.current = requestAnimationFrame(update);
    };
    popupAnimRef.current = requestAnimationFrame(update);
    return () => cancelAnimationFrame(popupAnimRef.current);
  }, [showDetail, selectedNodeId]);

  const popupPlacement = useMemo(() => {
    if (!popupPos) return null;
    const pw = 240, ph = 300;
    const clampW = embedded ? embedSize.w : SCREEN_WIDTH;
    const clampH = embedded ? embedSize.h : SCREEN_HEIGHT;
    let x = popupPos.x + 20;
    let y = popupPos.y - ph / 2;
    if (x + pw > clampW - 8) x = popupPos.x - pw - 20;
    if (x < 8) x = 8;
    if (y < (embedded ? 8 : 80)) y = embedded ? 8 : 80;
    if (y + ph > clampH - 24) y = clampH - ph - 24;
    return { x, y };
  }, [popupPos, embedded, embedSize]);

  if (isLoading) return embedded ? (
    <View style={[styles.embeddedState, styles.embeddedStateLight]}>
      <ActivityIndicator size="small" color="#FFFFFF" />
      <Text style={styles.embeddedHintDark}>Building graph…</Text>
    </View>
  ) : (
    <SafeAreaView style={styles.container}>
      <View style={styles.loading}><ActivityIndicator size="large" color="#FFFFFF" /><Text style={styles.loadingTxt}>Building your Health Graph…</Text></View>
    </SafeAreaView>
  );

  if (error) return embedded ? (
    <View style={[styles.embeddedState, styles.embeddedStateLight]}>
      <Text style={styles.embeddedErrTitleDark}>Unable to load your Health Graph</Text>
      <Pressable style={styles.embeddedRetry} onPress={() => refetch()}><Text style={styles.embeddedRetryTxtDark}>Try again</Text></Pressable>
    </View>
  ) : (
    <SafeAreaView style={styles.container}>
      <View style={styles.loading}>
        <Text style={styles.errTitle}>Unable to load your Health Graph</Text>
        <Text style={styles.errTxt}>Please check your connection and try again.</Text>
        <Pressable style={styles.retry} onPress={() => refetch()}><Text style={styles.retryTxt}>Try again</Text></Pressable>
      </View>
    </SafeAreaView>
  );

  const isEmpty = !graphData || graphData.nodes.length <= 1;

  return (
    <View
      style={[styles.fullScreen, embedded && styles.fullScreenEmbedded]}
      onLayout={embedded ? (e) => setEmbedSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height }) : undefined}
    >
      {/* Full-screen graph canvas */}
      {isEmpty ? (
        embedded ? (
          <View style={[styles.embeddedState, styles.embeddedStateLight]}>
            <Text style={styles.emptyIcon}>+</Text>
            <Text style={styles.embeddedErrTitleDark}>Your Health Graph</Text>
            <Text style={styles.embeddedHintDark}>Your connections will appear here as you log health info.</Text>
          </View>
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>+</Text>
            <Text style={styles.emptyTitle}>Your Health Graph</Text>
            <Text style={styles.emptyTxt}>As you add health information, your connections will appear here.</Text>
            <Pressable style={styles.emptyBtn} onPress={() => handleViewBody()}><Text style={styles.emptyBtnTxt}>Explore 3D Body</Text></Pressable>
          </View>
        )
      ) : (
        <NativeCanvas
          nodes={graphData!.nodes}
          edges={allEdges}
          layout={layout}
          selectedNodeId={selectedNodeId}
          onNodeTap={handleNodeTap}
          onNodeLongPress={handleNodeLongPress}
          sceneOut={sceneOutRef}
          theme={embedded ? 'panel' : 'dark'}
          flowEdgeIds={flowEdgeIds}
          focusVerdicts={focusVerdicts}
          labelDefs={labelDefs}
          dimIds={labelDimIds}
        />
      )}

      {/* Overlay: Header (full-screen mode only) */}
      {!embedded && (
        <View style={styles.overlayHeader}>
          <View style={styles.headerL}>
            <Text style={styles.headerTitle}>Health Graph</Text>
            <Text style={styles.headerSub}>{focusSource === 'body' && focusStructureId ? `Focused on ${focusStructureId.replace(/_/g, ' ').toLowerCase()}` : 'Tap a node for links · hold for details'}</Text>
          </View>
          <Pressable style={styles.resetBtn} onPress={handleReset}><Text style={styles.resetTxt}>Reset</Text></Pressable>
        </View>
      )}

      {/* Overlay: Filters (full-screen mode only) */}
      {!embedded && availableCategories.length > 0 && (
        <View style={styles.overlayFilters}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            <Chip
              label="All"
              selected={!activeFilter}
              color={GV.cta}
              onPress={() => handleFilterPress(null)}
            />
            {availableCategories.map((cat) => (
              <Chip
                key={cat}
                label={CATEGORY_LABELS[cat] || cat}
                selected={activeFilter === cat}
                color={GV.cta}
                onPress={() => handleFilterPress(cat)}
              />
            ))}
          </ScrollView>
        </View>
      )}

      {/* Overlay: live pattern counts (full-screen, rests while focused) */}
      {!embedded && patternCounts.total > 0 && !selectedNodeId && (
        <View style={styles.patternStrip} pointerEvents="none">
          <Text style={styles.patternStripText}>
            {patternCounts.bad} strained · {patternCounts.good} healthy · {patternCounts.total} patterns
          </Text>
        </View>
      )}

      {/* Overlay: Dynamic node-attached popup */}
      {showDetail && popupPlacement && selectedNode != null && (
        <View style={[styles.popup, embedded && styles.popupEmbedded, { left: popupPlacement.x, top: popupPlacement.y }]}>
          <ScrollView
            style={styles.popupScroll}
            contentContainerStyle={styles.popupScrollContent}
            showsVerticalScrollIndicator={false}
          >
            {sheetMode === 'neighbors' ? (
              <NeighborFocusCard
                node={selectedNode}
                nodes={graphData?.nodes ?? []}
                edges={allEdges}
                verdicts={focusVerdicts}
                onSelectNode={handleSelectNode}
                onShowDetails={() => setSheetMode('full')}
              />
            ) : nodeDetail ? (
              <NodeDetailContent
                nodeDetail={nodeDetail}
                onSelectNode={handleSelectNode}
                onViewBody={handleViewBody}
                onOpenDocument={(docId: string) => navigation.navigate('DocumentDetail', { documentId: docId } as any)}
                localDetails={feedQ.localDetails}
                allEdges={allEdges}
                nodesById={nodesById}
              />
            ) : (
              <ActivityIndicator size="small" color="#FFFFFF" />
            )}
          </ScrollView>
        </View>
      )}

      {/* Overlay: Stats bar (full-screen mode only, hidden while focused) */}
      {!embedded && graphData && !selectedNodeId && (
        <View style={styles.overlayStats}>
          <Text style={styles.statsTxt}>{graphData.total_nodes} nodes · {allEdges.length} connections{__DEV__ ? ` · ${GRAPH_BUILD_TAG}` : ''}</Text>
        </View>
      )}
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════════════════════════════════════════

const styles = StyleSheet.create({
  fullScreen: { flex: 1, backgroundColor: GV.stage },
  fullScreenEmbedded: { backgroundColor: 'transparent' },
  container: { flex: 1, backgroundColor: GV.stage },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, backgroundColor: GV.stage },
  loadingTxt: { ...TYPE.body, color: GV.fog },
  errTitle: { ...TYPE.title, color: '#FFFFFF', marginBottom: 8 },
  errTxt: { ...TYPE.body, color: GV.fog, textAlign: 'center', marginBottom: 24 },
  retry: { backgroundColor: GV.cta, paddingHorizontal: 32, paddingVertical: 8, borderRadius: SPACE.rPill },
  retryTxt: { ...TYPE.button, fontSize: 15, color: '#FFFFFF' },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACE.screenH, paddingVertical: 8, backgroundColor: GV.stage },
  overlayHeader: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACE.screenH, paddingTop: 56, paddingBottom: 12, backgroundColor: GV.stage, zIndex: 10 },
  overlayFilters: { position: 'absolute', top: 124, left: 0, right: 0, paddingVertical: 8, backgroundColor: GV.stage, justifyContent: 'center', zIndex: 10 },
  overlayStats: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: SPACE.screenH, paddingVertical: 12, backgroundColor: GV.stage, zIndex: 10 },
  popup: { position: 'absolute', width: 248, maxHeight: 360, backgroundColor: GV.card, borderRadius: SPACE.rCard, zIndex: 20 },
  popupScroll: { flexShrink: 1 },
  popupScrollContent: { padding: SPACE.cardPad },
  headerL: { flex: 1 },
  headerTitle: { ...TYPE.display, fontSize: 22, lineHeight: 28, color: '#FFFFFF' },
  headerSub: { ...TYPE.caption, color: GV.fog, marginTop: 2 },
  resetBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: SPACE.rPill, backgroundColor: GV.card },
  resetTxt: { ...TYPE.caption, fontFamily: FONT.semi, color: GV.ink },

  filterBar: { paddingVertical: 8, backgroundColor: GV.stage, justifyContent: 'center' },
  filterRow: { flexDirection: 'row', paddingHorizontal: SPACE.screenH, alignItems: 'center', gap: 8 },
  patternStrip: {
    position: 'absolute',
    top: 180,
    alignSelf: 'center',
    backgroundColor: GV.card,
    borderRadius: SPACE.rPill,
    paddingHorizontal: 12,
    paddingVertical: 5,
    zIndex: 10,
  },
  patternStripText: { ...TYPE.caption, fontFamily: FONT.semi, color: GV.ink, fontSize: 11 },

  canvasWrap: { flex: 1, backgroundColor: GV.stage },
  glView: { width: SCREEN_WIDTH, height: CANVAS_HEIGHT },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACE.cardPad, gap: 16, backgroundColor: GV.stage },
  emptyIcon: { ...TYPE.display, color: GV.fog },
  emptyTitle: { ...TYPE.display, color: '#FFFFFF' },
  emptyTxt: { ...TYPE.body, color: GV.fog, textAlign: 'center' },
  emptyBtn: { backgroundColor: GV.cta, paddingHorizontal: 32, paddingVertical: 16, borderRadius: SPACE.rPill, marginTop: 16 },
  emptyBtnTxt: { ...TYPE.button, fontSize: 15, color: '#FFFFFF' },

  embeddedState: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent', padding: 16, gap: 8 },
  // Embedded states sit on the dark insight card — quiet greys, no chrome.
  embeddedStateLight: { backgroundColor: 'transparent' },
  embeddedHintDark: { ...TYPE.caption, color: GV.fog, textAlign: 'center' },
  embeddedErrTitleDark: { ...TYPE.body, fontFamily: FONT.semi, color: '#FFFFFF', textAlign: 'center' },
  embeddedRetryTxtDark: { ...TYPE.caption, fontFamily: FONT.semi, color: GV.teal },
  embeddedHint: { ...TYPE.caption, color: GV.fog, textAlign: 'center' },
  embeddedErrTitle: { ...TYPE.body, fontFamily: FONT.semi, color: '#FFFFFF', textAlign: 'center' },
  embeddedRetry: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12, backgroundColor: GV.card, marginTop: 8 },
  embeddedRetryTxt: { ...TYPE.caption, fontFamily: FONT.semi, color: GV.ink },

  popupEmbedded: { maxHeight: 245 },

  detailPanel: { backgroundColor: GV.card, padding: SPACE.cardPad, maxHeight: SCREEN_HEIGHT * 0.38 },
  detailHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  detailTypeBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: GV.wash, paddingHorizontal: 12, paddingVertical: 8, borderRadius: SPACE.rPill, gap: 8 },
  detailTypeDot: { width: 6, height: 6, borderRadius: 3 },
  detailTypeText: { ...TYPE.caption, fontFamily: FONT.semi, fontSize: 11, color: GV.ink },
  detailClose: { fontSize: 18, color: GV.muted },
  detailTitle: { ...TYPE.title, color: GV.ink, marginBottom: 8 },
  detailDesc: { ...TYPE.body, color: GV.body, marginBottom: 16 },
  // P4: evidence-tier badge + quote + source rows (RichDetailContent).
  evBadgeRow: { flexDirection: 'row', marginBottom: 8 },
  evBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: SPACE.rPill },
  evBadgeText: { ...TYPE.caption, fontFamily: FONT.semi, fontSize: 10, color: '#10151C' },
  evQuoteBox: { marginTop: 4, padding: 10, borderRadius: 10, backgroundColor: GV.wash, borderLeftWidth: 3, borderLeftColor: GV.muted },
  evQuote: { ...TYPE.body, color: GV.body, fontSize: 13, fontStyle: 'italic' },
  df: { marginBottom: 8 },
  dfl: { ...TYPE.caption, color: GV.muted, marginBottom: 2 },
  dfv: { ...TYPE.body, fontFamily: FONT.semi, color: GV.ink },
  dc: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: GV.line },
  dct: { ...TYPE.caption, fontFamily: FONT.semi, color: GV.muted, marginBottom: 8 },
  dci: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5, gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  clbl: { ...TYPE.body, color: GV.ink, flex: 1, fontSize: 13 },
  ctype: { ...TYPE.caption, color: GV.muted, fontSize: 11 },
  nbSummary: { ...TYPE.caption, fontFamily: FONT.semi, color: GV.muted, marginTop: 2, marginBottom: 6 },
  nbRowText: { flex: 1, gap: 1 },
  nbRel: { ...TYPE.caption, color: GV.muted, fontSize: 11 },
  nbGo: { ...TYPE.title, color: GV.muted },
  nbFooter: { marginTop: 8, paddingVertical: 8, borderRadius: 12, backgroundColor: GV.cta, alignItems: 'center' },
  nbFooterText: { ...TYPE.body, fontFamily: FONT.semi, color: '#FFFFFF' },
  heroBox: { marginTop: 8, marginBottom: 8, padding: 16, borderRadius: 12, backgroundColor: GV.wash },
  heroValue: { ...TYPE.display, color: GV.ink, fontVariant: ['tabular-nums'] },
  heroLabel: { ...TYPE.caption, color: GV.muted, marginTop: 2, marginBottom: 6 },
  heroRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  heroRowKey: { ...TYPE.caption, color: GV.muted },
  heroRowVal: { ...TYPE.body, fontFamily: FONT.semi, color: GV.ink, fontSize: 13 },
  heroZone: { ...TYPE.caption, color: GV.muted, marginTop: 6 },
  heroFlag: { ...TYPE.caption, fontFamily: FONT.semi, color: GV.ink, marginTop: 4 },
  dt: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: GV.line },
  dtt: { ...TYPE.caption, fontFamily: FONT.semi, color: GV.muted, marginBottom: 8, fontSize: 10 },
  dpr: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  dpk: { ...TYPE.caption, color: GV.muted, textTransform: 'capitalize', fontSize: 11 },
  dpv: { ...TYPE.body, fontFamily: FONT.semi, color: GV.body, fontSize: 11 },
  vbb: { backgroundColor: GV.cta, paddingVertical: 8, paddingHorizontal: 16, borderRadius: SPACE.rPill, alignItems: 'center', marginTop: 8 },
  vbbt: { ...TYPE.body, fontFamily: FONT.semi, color: '#FFFFFF' },

  stats: { paddingHorizontal: SPACE.screenH, paddingVertical: 8, backgroundColor: GV.stage },
  statsTxt: { ...TYPE.caption, color: GV.fog, textAlign: 'center' },
});
