/**
 * HealthGraphScreen — 3D health graph using Three.js + expo-gl.
 *
 * Uses the same proven rendering approach as the original BodyScreen:
 * - expo-gl GLView for native GL context
 * - Canvas shim for Three.js compatibility
 * - THREE.WebGLRenderer with the shimmed canvas
 * - PerspectiveCamera with group-based orbit
 *
 * Visual hierarchy (simplified):
 * - Patient: large central gold sphere
 * - Observations: medium blue spheres
 * - Body structures: medium teal spheres
 * - Documents: small purple spheres
 * - Timeline events: tiny orange dots (subtle)
 * - Edges: thin semi-transparent lines
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
  type GestureResponderEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { GLView } from 'expo-gl';
import * as THREE from 'three';

import { COLORS, SPACING, BORDER_RADIUS, TYPOGRAPHY } from '@/constants';
import { Chip } from '@/components';
import { useHealthGraph, useGraphNodeDetail, type GraphNode, type GraphEdge } from '@/hooks/useHealthGraph';
import type { RootStackParamList } from '@/types';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const CANVAS_HEIGHT = SCREEN_HEIGHT * 0.55;

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'HealthGraph'>;

// ═══════════════════════════════════════════════════════════════════════════════
// Visual constants
// ═══════════════════════════════════════════════════════════════════════════════

// ═══ Event-type color system ═══
const EVENT_TYPE_COLORS: Record<string, number> = {
  sleep: 0x5b6abf,
  vitals: 0xe74c6f,
  nutrition: 0x27ae60,
  activity: 0x00b4d8,
  pain: 0xe84393,
  medication: 0x9b59b6,
  wellbeing: 0xf1c40f,
  symptom: 0xe67e22,
  mood: 0xfd79a8,
};

const NODE_COLORS: Record<string, string> = {
  patient: '#F4C51B',
  body_structure: '#31B7A5',
  observation: '#4D8DFF',
  document: '#9B6CFF',
  timeline_event: '#F4B740',
  medication: '#7C3AED',
  medication_taken_event: '#A78BFA',
};

const NODE_SIZES: Record<string, number> = {
  patient: 0.45,
  body_structure: 0.22,
  observation: 0.20,
  document: 0.10,
  timeline_event: 0.06,
  medication: 0.18,
  medication_taken_event: 0.10,
};

const CATEGORY_LABELS: Record<string, string> = {
  patient: 'You',
  body_structure: 'Body',
  observation: 'Observation',
  document: 'Record',
  timeline_event: 'Event',
  medication: 'Medication',
  medication_taken_event: 'Dose Taken',
};

function getEventColor(node: GraphNode): number {
  // Handle medication nodes directly
  if (node.type === 'medication') return 0x7C3AED;
  if (node.type === 'medication_taken_event') return 0xA78BFA;
  
  if (node.type !== 'timeline_event') return 0xf4b740;
  const et = (node.properties?.event_type || '').toLowerCase();
  for (const [key, color] of Object.entries(EVENT_TYPE_COLORS)) {
    if (et.includes(key)) return color;
  }
  return 0xf4b740;
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

  // Body structures: ring at radius 2.5
  const bodyCount = bodyStructures.length || 1;
  bodyStructures.forEach((bs, i) => {
    const angle = ((2 * Math.PI) / bodyCount) * i;
    positions.set(bs.id, {
      x: Math.cos(angle) * 2.5,
      y: Math.sin(angle) * 2.5 * 0.5,
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
        x: bp.x + Math.cos(step * i) * 1.0,
        y: bp.y + Math.sin(step * i) * 1.0,
        z: bp.z + ((stableHash(obs.id) % 60) / 60 - 0.5) * 0.4,
      });
    });
  }
  // Free observations: secondary ring
  if (obsFree.length > 0) {
    obsFree.forEach((obs, i) => {
      const a = ((2 * Math.PI) / obsFree.length) * i;
      positions.set(obs.id, {
        x: Math.cos(a) * 3.5,
        y: Math.sin(a) * 3.5 * 0.5,
        z: ((stableHash(obs.id) % 80) / 80 - 0.5) * 0.6,
      });
    });
  }

  // Documents: near source observation (tight cluster)
  for (const doc of documents) {
    let src: string | null = null;
    for (const e of edges) { if (e.relationship === 'SOURCE_DOCUMENT' && e.target === doc.id) { src = e.source; break; } }
    const op = src ? positions.get(src) : null;
    const h = stableHash(doc.id);
    const a = ((h % 360) / 360) * Math.PI * 2;
    if (op) {
      positions.set(doc.id, { x: op.x + Math.cos(a) * 0.5, y: op.y + Math.sin(a) * 0.5, z: op.z + ((h % 40) / 40 - 0.5) * 0.2 });
    } else {
      positions.set(doc.id, { x: Math.cos(a) * 4.0, y: Math.sin(a) * 4.0 * 0.4, z: 0 });
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
    const r = 0.6 + evts.length * 0.04;
    evts.forEach((te, i) => {
      const a = ((2 * Math.PI) / Math.max(evts.length, 1)) * i;
      const h = stableHash(te.id);
      positions.set(te.id, {
        x: sp.x + Math.cos(a) * r,
        y: sp.y + Math.sin(a) * r,
        z: sp.z + ((h % 50) / 50 - 0.5) * 0.3,
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
  const typeRadius = 5.0;
  typeKeys.forEach((etype, ti) => {
    const evts = eventsByType.get(etype)!;
    const typeAngle = ((2 * Math.PI) / typeKeys.length) * ti;
    const typeCenterX = Math.cos(typeAngle) * typeRadius;
    const typeCenterY = Math.sin(typeAngle) * typeRadius * 0.4;
    evts.forEach((te, i) => {
      const h = stableHash(te.id);
      const localAngle = ((2 * Math.PI) / Math.max(evts.length, 1)) * i;
      const localR = 0.3 + (i % 3) * 0.25;
      positions.set(te.id, {
        x: typeCenterX + Math.cos(localAngle) * localR,
        y: typeCenterY + Math.sin(localAngle) * localR,
        z: ((h % 60) / 60 - 0.5) * 0.5,
      });
    });
  });

  return positions;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Scene Manager — Three.js + expo-gl (same pattern as original BodyScreen)
// ═══════════════════════════════════════════════════════════════════════════════

class GraphSceneManager {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer | null = null;
  private gl: any = null;
  private graphGroup: THREE.Group;

  // Orbit state (same as AnatomySceneManager)
  private rotationY = 0;
  private rotationX = 0.3;
  private zoom = 1;
  private panX = 0;
  private panY = 0;

  // Node meshes for raycasting
  private nodeMeshes: Map<string, THREE.Mesh> = new Map();
  private nodeSpheres: THREE.Mesh[] = [];

  // Shared geometries and materials
  private sphereGeo: THREE.SphereGeometry;
  private nodeMaterials: Map<string, THREE.MeshStandardMaterial> = new Map();
  private highlightMaterial: THREE.MeshStandardMaterial;
  private selectedId: string | null = null;
  private viewport = { width: SCREEN_WIDTH, height: SCREEN_HEIGHT - 120 };

  constructor(width = SCREEN_WIDTH, height = SCREEN_HEIGHT - 120) {
    this.viewport = { width, height };
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1B222C);

    this.camera = new THREE.PerspectiveCamera(50, width / Math.max(height, 1), 0.1, 100);
    this.camera.position.set(0, 1.5, 8);
    this.camera.lookAt(0, 0, 0);

    // Lighting
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 0.8);
    key.position.set(5, 8, 5);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x88aaff, 0.3);
    fill.position.set(-4, 2, 3);
    this.scene.add(fill);

    // Shared sphere geometry (low poly for performance)
    this.sphereGeo = new THREE.SphereGeometry(1, 16, 12);

    // Materials per type (base colors — event types get per-node colors)
    const baseColors: Record<string, number> = {
      patient: 0xf4c51b,
      body_structure: 0x31b7a5,
      observation: 0x4d8dff,
      document: 0x9b6cff,
      timeline_event: 0xf4b740,
    };
    for (const [type, color] of Object.entries(baseColors)) {
      this.nodeMaterials.set(type, new THREE.MeshStandardMaterial({
        color,
        roughness: 0.45,
        metalness: 0.15,
      }));
    }

    this.highlightMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x4d8dff,
      emissiveIntensity: 0.5,
      roughness: 0.3,
      metalness: 0.2,
    });

    this.graphGroup = new THREE.Group();
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
  }

  /** Build the graph from data */
  buildGraph(
    nodes: GraphNode[],
    edges: GraphEdge[],
    positions: Map<string, LayoutPos>,
    selectedNodeId: string | null,
  ) {
    // Clear previous
    this.clearGraph();

    this.selectedId = selectedNodeId;

    // Create node meshes
    for (const node of nodes) {
      const pos = positions.get(node.id);
      if (!pos) continue;

      const size = NODE_SIZES[node.type] || 0.06;
      // Use event-type color for timeline events
      const nodeColor = node.type === 'timeline_event' ? getEventColor(node) : undefined;
      const mat = nodeColor != null
        ? new THREE.MeshStandardMaterial({ color: nodeColor, roughness: 0.45, metalness: 0.15 })
        : this.nodeMaterials.get(node.type);
      if (!mat) continue;

      const mesh = new THREE.Mesh(this.sphereGeo, mat.clone());
      mesh.scale.setScalar(size);
      mesh.position.set(pos.x, pos.y, pos.z);
      mesh.userData = {
        graphNodeId: node.id,
        graphNodeType: node.type,
        eventType: node.properties?.event_type ?? null,
        nodeId: node.id,
        nodeType: node.type,
      };

      // Selected node gets highlight material
      if (node.id === selectedNodeId) {
        mesh.material = this.highlightMaterial.clone();
        mesh.scale.setScalar(size * 1.4);
      }

      this.graphGroup.add(mesh);
      this.nodeMeshes.set(node.id, mesh);
      this.nodeSpheres.push(mesh);
    }

    // Create edges as LineSegments
    const edgeVerts: number[] = [];
    const edgeColors: number[] = [];
    const activeVerts: number[] = [];
    const activeColors: number[] = [];

    const edgeColorsByType: Record<string, THREE.Color> = {
      HAS_OBSERVATION: new THREE.Color(0x6f9fd0),
      AFFECTS: new THREE.Color(0xff6b6b),
      SOURCE_DOCUMENT: new THREE.Color(0xb28cff),
      LOGGED_ON: new THREE.Color(0xf0b95a),
      HAS_TIMELINE_EVENT: new THREE.Color(0x66819b),
      DERIVED_SAME_TYPE: new THREE.Color(0x7d8ee8),
      DERIVED_SAME_BODY_SITE: new THREE.Color(0x53c7b5),
      DERIVED_SAME_DAY: new THREE.Color(0x64707c),
    };
    const activeColor = new THREE.Color(0x4d8dff);

    for (const edge of edges) {
      const from = positions.get(edge.source);
      const to = positions.get(edge.target);
      if (!from || !to) continue;

      const isActive = selectedNodeId != null && (edge.source === selectedNodeId || edge.target === selectedNodeId);

      if (isActive) {
        activeVerts.push(from.x, from.y, from.z, to.x, to.y, to.z);
        activeColors.push(activeColor.r, activeColor.g, activeColor.b, activeColor.r, activeColor.g, activeColor.b);
      } else {
        edgeVerts.push(from.x, from.y, from.z, to.x, to.y, to.z);
        const color = edgeColorsByType[edge.relationship] || new THREE.Color(0x3a6a9b);
        const op = selectedNodeId != null ? 0.06 : edge.derived ? 0.18 : 0.42;
        edgeColors.push(color.r * op, color.g * op, color.b * op, color.r * op, color.g * op, color.b * op);
      }
    }

    if (edgeVerts.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(edgeVerts, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(edgeColors, 3));
      const line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, toneMapped: false }));
      this.graphGroup.add(line);
    }

    if (activeVerts.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(activeVerts, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(activeColors, 3));
      const line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, toneMapped: false }));
      this.graphGroup.add(line);
    }
  }

  private clearGraph() {
    this.graphGroup.children.forEach((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry !== this.sphereGeo && child.geometry.dispose();
        if (child.material !== this.highlightMaterial) {
          if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
          else child.material.dispose();
        }
      } else if (child instanceof THREE.LineSegments) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
        else child.material.dispose();
      }
      this.graphGroup.remove(child);
    });
    this.nodeMeshes.clear();
    this.nodeSpheres = [];
  }

  render() {
    if (!this.renderer) return;

    // Apply orbit to group (same as AnatomySceneManager)
    this.graphGroup.rotation.y = this.rotationY;
    this.graphGroup.rotation.x = this.rotationX;
    this.graphGroup.scale.setScalar(this.zoom);
    this.graphGroup.position.x = this.panX;
    this.graphGroup.position.y = this.panY;

    this.renderer.render(this.scene, this.camera);

    if (this.gl && Platform.OS !== 'web' && typeof this.gl.endFrameEXP === 'function') {
      this.gl.endFrameEXP();
    }
  }

  handlePanMove(dx: number, dy: number) {
    this.rotationY += dx * 0.005;
    this.rotationX = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, this.rotationX + dy * 0.005));
  }

  handlePinch(scale: number) {
    this.zoom = Math.max(0.3, Math.min(3, this.zoom * scale));
  }

  resetView() {
    this.rotationY = 0;
    this.rotationX = 0.3;
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
  }

  getSelectedNodeScreenPosition(): { x: number; y: number } | null {
    if (!this.selectedId || !this.renderer) return null;
    const mesh = this.nodeMeshes.get(this.selectedId);
    if (!mesh) return null;

    // Get world position
    const worldPos = new THREE.Vector3();
    mesh.getWorldPosition(worldPos);

    // Project to screen
    const screenPos = worldPos.clone().project(this.camera);

    // Convert NDC to screen coordinates
    const hw = this.viewport.width / 2;
    const hh = this.viewport.height / 2;
    const sx = screenPos.x * hw + hw;
    const sy = -(screenPos.y * hh) + hh;

    // Check if behind camera
    if (screenPos.z > 1) return null;

    return { x: sx, y: sy };
  }

  handleTap(x: number, y: number, graphX = 0, graphY = 0): string | null {
    if (!this.renderer) return null;

    const graphWidth = this.viewport.width;
    const graphHeight = this.viewport.height;
    const mouse = new THREE.Vector2(
      ((x - graphX) / graphWidth) * 2 - 1,
      -((y - graphY) / graphHeight) * 2 + 1,
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, this.camera);

    const intersects = raycaster.intersectObjects(this.nodeSpheres, true);
    let graphNodeId: string | null = null;
    let graphNodeType: string | null = null;
    if (intersects.length > 0) {
      // B2/B5: walk the parent chain — meshes can live under Groups — until the
      // logical graph node metadata is found.
      let object: THREE.Object3D | null = intersects[0].object;
      while (object) {
        graphNodeId ??= object.userData?.graphNodeId ?? null;
        graphNodeType ??= object.userData?.graphNodeType ?? null;
        object = object.parent;
      }
      if (graphNodeId) {
        console.log('[HealthGraphTap] touch=', { x, y }, 'graphBounds=', { x: graphX, y: graphY, width: graphWidth, height: graphHeight }, 'ndc=', { x: mouse.x, y: mouse.y }, 'hitCount=', intersects.length, 'hit=true', 'nodeId=', graphNodeId, 'nodeType=', graphNodeType);
        return graphNodeId;
      }
    }
    console.log('[HealthGraphTap] touch=', { x, y }, 'graphBounds=', { x: graphX, y: graphY, width: graphWidth, height: graphHeight }, 'ndc=', { x: mouse.x, y: mouse.y }, 'hitCount=', intersects.length, 'hit=false', 'nodeId=', graphNodeId ?? '', 'nodeType=', graphNodeType ?? '');
    return null;
  }

  dispose() {
    this.clearGraph();
    this.sphereGeo.dispose();
    this.nodeMaterials.forEach((m) => m.dispose());
    this.highlightMaterial.dispose();
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
    default: return '';
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
  return formatNaturalDate(n.properties?.event_time || n.properties?.created_at || n.properties?.date);
}

function genSource(n: GraphNode): string | null {
  switch (n.type) {
    case 'observation': { const s = n.properties?.source_type; return s ? s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (l: string) => l.toUpperCase()) : 'Health data'; }
    case 'document': return 'Uploaded medical record';
    case 'timeline_event': { const s = n.properties?.source_type; return s ? s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (l: string) => l.toUpperCase()) : 'Health timeline'; }
    default: return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Detail Panel
// ═══════════════════════════════════════════════════════════════════════════════

function NodeDetailContent({ nodeDetail, onSelectNode, onViewBody }: { nodeDetail: any; onSelectNode: (id: string) => void; onViewBody: (sid?: string) => void }) {
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
  }

  return (
    <>
      <View style={styles.detailHeader}>
        <View style={[styles.detailTypeBadge, { backgroundColor: color + '20' }]}>
          <View style={[styles.detailTypeDot, { backgroundColor: color }]} />
          <Text style={[styles.detailTypeText, { color }]}>{CATEGORY_LABELS[node.type] || node.type}</Text>
        </View>
        <Pressable onPress={() => onSelectNode('')}><Text style={styles.detailClose}>✕</Text></Pressable>
      </View>
      <Text style={styles.detailTitle}>{title}</Text>
      <Text style={styles.detailDesc}>{genDesc(node)}</Text>
      <View style={styles.df}><Text style={styles.dfl}>What</Text><Text style={styles.dfv}>{genWhat(node)}</Text></View>
      <View style={styles.df}><Text style={styles.dfl}>When</Text><Text style={styles.dfv}>{genWhen(node)}</Text></View>
      {genSource(node) && <View style={styles.df}><Text style={styles.dfl}>Source</Text><Text style={styles.dfv}>{genSource(node)}</Text></View>}
      {nodeDetail.connected_nodes.length > 0 && (
        <View style={styles.dc}>
          <Text style={styles.dct}>Connected ({nodeDetail.connected_nodes.length})</Text>
          {nodeDetail.connected_nodes.slice(0, 5).map((cn: any) => (
            <Pressable key={cn.id} style={styles.dci} onPress={() => onSelectNode(cn.id)}>
              <View style={[styles.dot, { backgroundColor: NODE_COLORS[cn.type] || '#9AA8B8' }]} />
              <Text style={styles.clbl}>{cn.label}</Text>
              <Text style={styles.ctype}>{CATEGORY_LABELS[cn.type]}</Text>
            </Pressable>
          ))}
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

// ═══════════════════════════════════════════════════════════════════════════════
// Native Canvas — same pattern as original BodyScreen
// ═══════════════════════════════════════════════════════════════════════════════

function NativeCanvas({
  nodes,
  edges,
  layout,
  selectedNodeId,
  onNodeTap,
  onLayout,
  sceneOut,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  layout: Map<string, LayoutPos>;
  selectedNodeId: string | null;
  onNodeTap: (id: string) => void;
  onLayout?: (w: number, h: number) => void;
  sceneOut?: React.MutableRefObject<GraphSceneManager | null>;
}) {
  const sceneRef = useRef<GraphSceneManager | null>(null);
  const animFrameRef = useRef<number>(0);
  const gestureState = useRef({ lastX: 0, lastY: 0, startX: 0, startY: 0, startTime: 0, moved: false, lastDist: 0, isPinching: false });
  const canvasSize = useRef({ w: SCREEN_WIDTH, h: SCREEN_HEIGHT - 120 });
  const graphBounds = useRef({ x: 0, y: 0, width: SCREEN_WIDTH, height: SCREEN_HEIGHT - 120 });

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animFrameRef.current);
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, []);

  // Rebuild graph when data changes
  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.buildGraph(nodes, edges, layout, selectedNodeId);
    }
  }, [nodes, edges, layout, selectedNodeId]);

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
      renderer.setPixelRatio(Math.min(Platform.OS === 'web' ? window.devicePixelRatio : 2, 2));
      renderer.setSize(w, h);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.1;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.sortObjects = true;

      const scene = new GraphSceneManager(w, h);
      scene.setRenderer(renderer);
      scene.setExpoGLContext(gl);
      scene.buildGraph(nodes, edges, layout, selectedNodeId);
      sceneRef.current = scene;

      console.log('[HealthGraph] renderer=three-js-native nodes=', nodes.length, 'edges=', edges.length);

      const animate = () => {
        scene.render();
        animFrameRef.current = requestAnimationFrame(animate);
      };
      animate();
    } catch (err) {
      console.error('[HealthGraph] GL init failed:', err);
    }
  }, [nodes, edges, layout, selectedNodeId]);

  // Gesture handlers — same pattern as original BodyScreen
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
    } else if (touches.length === 2) {
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
      if (Math.hypot(totalDx, totalDy) > 10) gestureState.current.moved = true;
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
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main Screen
// ═══════════════════════════════════════════════════════════════════════════════

export default function HealthGraphScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const focusStructureId = route.params?.focusStructureId;
  const focusSource = route.params?.source;

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [popupPos, setPopupPos] = useState<{ x: number; y: number } | null>(null);
  const hasAppliedFocus = useRef(false);
  const [graphHeight, setGraphHeight] = useState(SCREEN_HEIGHT - 120);

  const { data: graphData, isLoading, error, refetch } = useHealthGraph({ depth: 2, limit: 100, category: activeFilter ?? undefined });
  const { data: nodeDetail } = useGraphNodeDetail(selectedNodeId);

  useEffect(() => {
    if (selectedNodeId && nodeDetail) {
      console.log('[HealthGraphDetail] nodeId=', selectedNodeId, 'status=200 loaded=true panelVisible=', showDetail);
    }
  }, [selectedNodeId, nodeDetail, showDetail]);

  const availableCategories = useMemo(() => {
    if (!graphData) return [];
    return Array.from(new Set(graphData.nodes.map((n) => n.type))).filter((t) => t !== 'patient');
  }, [graphData]);

  const connectedNodeIds = useMemo(() => {
    const ids = new Set<string>();
    if (!selectedNodeId || !graphData) return ids;
    for (const e of graphData.edges) {
      if (e.source === selectedNodeId) ids.add(e.target);
      if (e.target === selectedNodeId) ids.add(e.source);
    }
    return ids;
  }, [selectedNodeId, graphData]);

  const layout = useMemo(() => {
    if (!graphData) return new Map();
    return computeLayout(graphData.nodes, graphData.edges);
  }, [graphData]);

  useEffect(() => {
    if (!graphData) return;
    const byType: Record<string, number> = {};
    graphData.nodes.forEach((n) => { byType[n.type] = (byType[n.type] ?? 0) + 1; });
    console.log('[HealthGraph] renderer=three-js-native');
    console.log('[HealthGraph] filter=', activeFilter ?? 'ALL', 'nodes=', graphData.nodes.length, 'edges=', graphData.edges.length);
    console.log('[HealthGraph] patient=', byType['patient'] ?? 0, 'observation=', byType['observation'] ?? 0, 'timeline_event=', byType['timeline_event'] ?? 0);
  }, [graphData, activeFilter]);

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
    else { setSelectedNodeId(id); setShowDetail(true); }
  }, [selectedNodeId]);

  const handleSelectNode = useCallback((id: string) => {
    if (!id) { setSelectedNodeId(null); setShowDetail(false); return; }
    setSelectedNodeId(id); setShowDetail(true);
  }, []);

  const handleViewBody = useCallback((sid?: string) => {
    navigation.navigate('Main', { screen: 'Body', params: sid ? { focusStructureId: sid } : undefined } as any);
  }, [navigation]);

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
    let x = popupPos.x + 20;
    let y = popupPos.y - ph / 2;
    if (x + pw > SCREEN_WIDTH - 16) x = popupPos.x - pw - 20;
    if (x < 16) x = 16;
    if (y < 80) y = 80;
    if (y + ph > SCREEN_HEIGHT - 80) y = SCREEN_HEIGHT - ph - 80;
    return { x, y };
  }, [popupPos]);

  if (isLoading) return (
    <SafeAreaView style={styles.container}>
      <View style={styles.loading}><ActivityIndicator size="large" color={COLORS.primary} /><Text style={styles.loadingTxt}>Building your Health Graph…</Text></View>
    </SafeAreaView>
  );

  if (error) return (
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
    <View style={styles.fullScreen}>
      {/* Full-screen graph canvas */}
      {isEmpty ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>🔗</Text>
          <Text style={styles.emptyTitle}>Your Health Graph</Text>
          <Text style={styles.emptyTxt}>As you add health information, your connections will appear here.</Text>
          <Pressable style={styles.emptyBtn} onPress={() => handleViewBody()}><Text style={styles.emptyBtnTxt}>Explore 3D Body</Text></Pressable>
        </View>
      ) : (
        <NativeCanvas
          nodes={graphData!.nodes}
          edges={graphData!.edges}
          layout={layout}
          selectedNodeId={selectedNodeId}
          onNodeTap={handleNodeTap}
          sceneOut={sceneOutRef}
        />
      )}

      {/* Overlay: Header */}
      <View style={styles.overlayHeader}>
        <View style={styles.headerL}>
          <Text style={styles.headerTitle}>Health Graph</Text>
          <Text style={styles.headerSub}>{focusSource === 'body' && focusStructureId ? `Focused on ${focusStructureId.replace(/_/g, ' ').toLowerCase()}` : 'Your health, connected.'}</Text>
        </View>
        <Pressable style={styles.resetBtn} onPress={handleReset}><Text style={styles.resetTxt}>Reset</Text></Pressable>
      </View>

      {/* Overlay: Filters */}
      {availableCategories.length > 0 && (
        <View style={styles.overlayFilters}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            <Chip
              label="All"
              selected={!activeFilter}
              color={COLORS.accentBlue}
              onPress={() => handleFilterPress(null)}
            />
            {availableCategories.map((cat) => (
              <Chip
                key={cat}
                label={CATEGORY_LABELS[cat] || cat}
                selected={activeFilter === cat}
                color={NODE_COLORS[cat] || COLORS.accentBlue}
                onPress={() => handleFilterPress(cat)}
              />
            ))}
          </ScrollView>
        </View>
      )}

      {/* Overlay: Dynamic node-attached popup */}
      {showDetail && nodeDetail && popupPlacement && (
        <View style={[styles.popup, { left: popupPlacement.x, top: popupPlacement.y }]}>
          <ScrollView
            style={styles.popupScroll}
            contentContainerStyle={styles.popupScrollContent}
            showsVerticalScrollIndicator={false}
          >
            <NodeDetailContent nodeDetail={nodeDetail} onSelectNode={handleSelectNode} onViewBody={handleViewBody} />
          </ScrollView>
        </View>
      )}

      {/* Overlay: Stats bar */}
      {graphData && (
        <View style={styles.overlayStats}>
          <Text style={styles.statsTxt}>{graphData.total_nodes} nodes · {graphData.total_edges} connections</Text>
        </View>
      )}
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════════════════════════════════════════

const styles = StyleSheet.create({
  fullScreen: { flex: 1, backgroundColor: '#1B222C' },
  container: { flex: 1, backgroundColor: COLORS.background },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SPACING.md },
  loadingTxt: { ...TYPOGRAPHY.body, color: COLORS.textMuted },
  errTitle: { ...TYPOGRAPHY.h3, color: COLORS.textPrimary, marginBottom: SPACING.sm },
  errTxt: { ...TYPOGRAPHY.body, color: COLORS.textMuted, textAlign: 'center', marginBottom: SPACING.lg },
  retry: { backgroundColor: COLORS.primary, paddingHorizontal: SPACING.xl, paddingVertical: SPACING.sm, borderRadius: BORDER_RADIUS.md },
  retryTxt: { ...TYPOGRAPHY.bodyStrong, color: '#07111F' },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border, backgroundColor: COLORS.surface },
  overlayHeader: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.md, paddingTop: 48, paddingBottom: SPACING.sm, backgroundColor: 'rgba(10, 18, 30, 0.72)', borderBottomWidth: 1, borderBottomColor: COLORS.borderFaint, zIndex: 10 },
  overlayFilters: { position: 'absolute', top: 86, left: 0, right: 0, height: 48, backgroundColor: 'rgba(8, 15, 25, 0.72)', justifyContent: 'center', zIndex: 10 },
  overlayStats: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs, backgroundColor: 'rgba(10, 18, 30, 0.72)', borderTopWidth: 1, borderTopColor: COLORS.borderFaint, zIndex: 10 },
  popup: { position: 'absolute', width: 240, maxHeight: 340, backgroundColor: COLORS.surfaceElevated, borderRadius: BORDER_RADIUS.lg, borderWidth: 1, borderColor: COLORS.borderFaint, zIndex: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.4, shadowRadius: 14, elevation: 10 },
  popupScroll: { flexShrink: 1 },
  popupScrollContent: { padding: SPACING.md },
  headerL: { flex: 1 },
  headerTitle: { ...TYPOGRAPHY.h3, color: COLORS.textPrimary },
  headerSub: { ...TYPOGRAPHY.caption, color: COLORS.textMuted, marginTop: 2 },
  resetBtn: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderRadius: BORDER_RADIUS.pill, borderWidth: 1, borderColor: COLORS.border, backgroundColor: 'rgba(255,255,255,0.04)' },
  resetTxt: { ...TYPOGRAPHY.captionStrong, color: COLORS.textSecondary },

  filterBar: { height: 44, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.border, justifyContent: 'center' },
  filterRow: { flexDirection: 'row', paddingHorizontal: SPACING.md, alignItems: 'center', gap: SPACING.sm },

  canvasWrap: { flex: 1, backgroundColor: '#1B222C' },
  glView: { width: SCREEN_WIDTH, height: CANVAS_HEIGHT },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl, gap: SPACING.md },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { ...TYPOGRAPHY.h2, color: COLORS.textPrimary },
  emptyTxt: { ...TYPOGRAPHY.body, color: COLORS.textMuted, textAlign: 'center', lineHeight: 22 },
  emptyBtn: { backgroundColor: COLORS.primary, paddingHorizontal: SPACING.xl, paddingVertical: SPACING.md, borderRadius: BORDER_RADIUS.lg, marginTop: SPACING.md },
  emptyBtnTxt: { ...TYPOGRAPHY.bodyStrong, color: '#07111F' },

  detailPanel: { backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border, padding: SPACING.md, maxHeight: SCREEN_HEIGHT * 0.38 },
  detailHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACING.sm },
  detailTypeBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.sm, paddingVertical: SPACING.xs, borderRadius: BORDER_RADIUS.full, gap: SPACING.xs },
  detailTypeDot: { width: 6, height: 6, borderRadius: 3 },
  detailTypeText: { ...TYPOGRAPHY.captionStrong, fontSize: 11 },
  detailClose: { fontSize: 18, color: COLORS.textMuted },
  detailTitle: { ...TYPOGRAPHY.h3, color: COLORS.textPrimary, marginBottom: SPACING.xs },
  detailDesc: { ...TYPOGRAPHY.body, color: COLORS.textSecondary, marginBottom: SPACING.md, lineHeight: 20 },
  df: { marginBottom: SPACING.sm },
  dfl: { ...TYPOGRAPHY.label, color: COLORS.textMuted, marginBottom: 2 },
  dfv: { ...TYPOGRAPHY.bodyStrong, color: COLORS.textPrimary },
  dc: { marginTop: SPACING.sm, paddingTop: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.borderLight },
  dct: { ...TYPOGRAPHY.captionStrong, color: COLORS.textSecondary, marginBottom: SPACING.xs },
  dci: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3, gap: SPACING.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  clbl: { ...TYPOGRAPHY.body, color: COLORS.textPrimary, flex: 1, fontSize: 13 },
  ctype: { ...TYPOGRAPHY.caption, color: COLORS.textMuted, fontSize: 11 },
  dt: { marginTop: SPACING.sm, paddingTop: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.borderLight },
  dtt: { ...TYPOGRAPHY.captionStrong, color: COLORS.textMuted, marginBottom: SPACING.xs, fontSize: 10 },
  dpr: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  dpk: { ...TYPOGRAPHY.caption, color: COLORS.textMuted, textTransform: 'capitalize', fontSize: 11 },
  dpv: { ...TYPOGRAPHY.bodyStrong, color: COLORS.textSecondary, fontSize: 11 },
  vbb: { backgroundColor: COLORS.teal, paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md, borderRadius: BORDER_RADIUS.md, alignItems: 'center', marginTop: SPACING.sm },
  vbbt: { ...TYPOGRAPHY.bodyStrong, color: '#07111F' },

  stats: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs, backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border },
  statsTxt: { ...TYPOGRAPHY.caption, color: COLORS.textMuted, textAlign: 'center' },
});
