/**
 * FilamentHealthGraph.tsx — Native 3D health graph using react-native-filament.
 *
 * Renders an interactive 3D graph with:
 * - GPU-rendered sphere nodes for each resource type
 * - 3D edge connections between related nodes
 * - Orbit camera with inertia
 * - Pinch zoom
 * - Node selection with visual highlighting
 * - Detail panel for selected nodes
 *
 * Requires EAS development build with native Filament support.
 * Falls back to a placeholder on Expo Go.
 */

import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  memo,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
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
  Skybox,
  useCameraManipulator,
  useFilamentContext,
} from 'react-native-filament';
import type { Entity } from 'react-native-filament';
import Svg, { Line } from 'react-native-svg';

import { COLORS, SPACING, BORDER_RADIUS, TYPOGRAPHY } from '@/constants';
import type { GraphNode, GraphEdge } from '@/hooks/useHealthGraph';
import {
  compute3DLayout,
  type LayoutPos3D,
  type LayoutResult,
} from '@/services/graph/dayTreeLayout';


const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const GRAPH_HEIGHT = SCREEN_HEIGHT * 0.55;

// ═══════════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════════

const NODE_COLORS: Record<string, string> = {
  patient: '#E8862E',
  body_structure: '#4A90C2',
  observation: '#4A90C2',
  document: '#8A7BC8',
  timeline_event: '#C96A1E',
  date: '#0F6D66',
};

const NODE_COLORS_VEC: Record<string, [number, number, number, number]> = {
  patient: [0.91, 0.53, 0.18, 1.0],
  body_structure: [0.29, 0.56, 0.76, 1.0],
  observation: [0.29, 0.56, 0.76, 1.0],
  document: [0.54, 0.48, 0.78, 1.0],
  timeline_event: [0.79, 0.42, 0.11, 1.0],
  date: [0.06, 0.43, 0.4, 1.0],
};

const NODE_SIZES: Record<string, number> = {
  patient: 0.22,
  body_structure: 0.15,
  observation: 0.10,
  document: 0.08,
  timeline_event: 0.07,
  date: 0.13,
};

const CATEGORY_LABELS: Record<string, string> = {
  patient: 'You',
  body_structure: 'Body',
  observation: 'Observation',
  document: 'Record',
  timeline_event: 'Event',
  date: 'Day',
};

const EDGE_COLORS: Record<string, string> = {
  HAS_OBSERVATION: '#3A6A9B',
  AFFECTS: '#354D60',
  SOURCE_DOCUMENT: '#5A4A8C',
  LOGGED_ON: '#6A5A30',
  HAS_DAY: '#7A8A96',
  ON_DAY: '#9AA8B8',
};

const EDGE_COLOR_VEC: Record<string, [number, number, number, number]> = {
  HAS_OBSERVATION: [0.23, 0.42, 0.61, 0.5],
  AFFECTS: [0.21, 0.30, 0.38, 0.35],
  SOURCE_DOCUMENT: [0.35, 0.29, 0.55, 0.25],
  LOGGED_ON: [0.42, 0.35, 0.19, 0.25],
  HAS_DAY: [0.48, 0.54, 0.59, 0.4],
  ON_DAY: [0.6, 0.66, 0.72, 0.3],
};

// ═══════════════════════════════════════════════════════════════════════════════
// GLB Assets — loaded via require() for Metro bundler
// ═══════════════════════════════════════════════════════════════════════════════

const GLB_NODES: Record<string, number> = {
  patient: require('../../assets/graph-nodes/node_patient.glb'),
  body_structure: require('../../assets/graph-nodes/node_body_structure.glb'),
  observation: require('../../assets/graph-nodes/node_observation.glb'),
  document: require('../../assets/graph-nodes/node_document.glb'),
  // Day markers reuse the event shell (layout-only nodes, never persisted).
  date: require('../../assets/graph-nodes/node_event.glb'),
  timeline_event: require('../../assets/graph-nodes/node_event.glb'),
};

const GLB_EDGE = require('../../assets/graph-nodes/edge_line.glb');



// ═══════════════════════════════════════════════════════════════════════════════
// Natural language helpers
// ═══════════════════════════════════════════════════════════════════════════════

function formatNaturalDate(dateStr: string | undefined): string {
  if (!dateStr) return 'Date not recorded';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'Date not recorded';
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return `Today at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    if (diffDays === 1) return `Yesterday at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    return `${d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  } catch { return 'Date not recorded'; }
}

function generateNodeDescription(node: GraphNode): string {
  switch (node.type) {
    case 'patient': return 'This is your personal health graph, connecting your body, observations, and health records.';
    case 'body_structure': {
      const cat = node.properties?.category?.replace(/_/g, ' ').toLowerCase() || 'body area';
      return `Health observations and records related to your ${node.label.toLowerCase()} (${cat}).`;
    }
    case 'observation': {
      const val = node.properties?.value;
      const unit = node.properties?.unit;
      const status = node.properties?.visual_status;
      const statusText = status ? ` Status: ${String(status).replace(/_/g, ' ')}.` : '';
      if (val != null && unit) return `A ${node.label.toLowerCase()} measurement of ${val} ${unit} was recorded.${statusText}`;
      if (val != null) return `A ${node.label.toLowerCase()} measurement of ${val} was recorded.${statusText}`;
      return `A ${node.label.toLowerCase()} observation was recorded in your health data.${statusText}`;
    }
    case 'document': {
      const docType = node.properties?.document_type || 'medical document';
      return `A ${docType.toLowerCase()} was added to your health records.`;
    }
    case 'timeline_event': {
      const src = node.properties?.source_type?.replace(/_/g, ' ').toLowerCase() || 'health event';
      return `A ${src} was recorded in your health timeline.`;
    }
    case 'date': {
      const count = node.properties?.entryCount;
      return typeof count === 'number'
        ? `${count} health ${count === 1 ? 'entry' : 'entries'} recorded on this day — BPM, logs, medications, meals and records.`
        : 'Health entries recorded on this day.';
    }
    default: return '';
  }
}

function generateNodeWhat(node: GraphNode): string {
  switch (node.type) {
    case 'patient': return 'Personal health graph';
    case 'body_structure': return node.properties?.category?.replace(/_/g, ' ') || node.label;
    case 'observation': {
      const val = node.properties?.value;
      const unit = node.properties?.unit;
      const status = node.properties?.visual_status;
      const s = status ? ` (${String(status).replace(/_/g, ' ')})` : '';
      if (val != null && unit) return `${node.label} — ${val} ${unit}${s}`;
      if (val != null) return `${node.label} — ${val}${s}`;
      return `${node.label}${s}`;
    }
    case 'document': return node.properties?.document_type || node.label;
    case 'timeline_event': return node.properties?.event_type?.replace(/_/g, ' ') || node.label;
    case 'date': return `${node.label} · day`;
    default: return node.label;
  }
}

function generateNodeWhen(node: GraphNode): string {
  return formatNaturalDate(node.properties?.event_time || node.properties?.created_at || node.properties?.date);
}

function generateNodeSource(node: GraphNode): string | null {
  switch (node.type) {
    case 'observation': {
      const src = node.properties?.source_type;
      return src ? src.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (l: string) => l.toUpperCase()) : 'Health data';
    }
    case 'document': return 'Uploaded medical record';
    case 'timeline_event': {
      const src = node.properties?.source_type;
      return src ? src.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (l: string) => l.toUpperCase()) : 'Health timeline';
    }
    default: return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Detail Panel
// ═══════════════════════════════════════════════════════════════════════════════

function NodeDetailContent({
  nodeDetail,
  onSelectNode,
  onViewBody,
}: {
  nodeDetail: any;
  onSelectNode: (id: string) => void;
  onViewBody: (structureId?: string) => void;
}) {
  const node = nodeDetail.node;
  const color = NODE_COLORS[node.type] || '#9AA8B8';
  const title = node.label || CATEGORY_LABELS[node.type] || node.type;
  const description = generateNodeDescription(node);
  const what = generateNodeWhat(node);
  const when = generateNodeWhen(node);
  const source = generateNodeSource(node);

  const techProps: { key: string; value: string }[] = [];
  if (node.type === 'observation') {
    if (node.properties?.observation_type) techProps.push({ key: 'Observation Type', value: String(node.properties.observation_type).replace(/_/g, ' ') });
    if (node.properties?.finding_code) techProps.push({ key: 'Finding Code', value: String(node.properties.finding_code) });
    if (node.properties?.value != null) techProps.push({ key: 'Value', value: String(node.properties.value) });
    if (node.properties?.unit) techProps.push({ key: 'Unit', value: String(node.properties.unit) });
    if (node.properties?.display_name) techProps.push({ key: 'Display Name', value: String(node.properties.display_name) });
    if (node.properties?.visual_status) techProps.push({ key: 'Status', value: String(node.properties.visual_status).replace(/_/g, ' ') });
    if (node.properties?.visual_severity_score != null) techProps.push({ key: 'Severity', value: `${Math.round(node.properties.visual_severity_score * 100)}%` });
    if (node.properties?.trend) techProps.push({ key: 'Trend', value: String(node.properties.trend) });
    if (node.properties?.source_type) techProps.push({ key: 'Source Type', value: String(node.properties.source_type).replace(/_/g, ' ') });
    if (node.properties?.body_site) techProps.push({ key: 'Body Site', value: String(node.properties.body_site).replace(/_/g, ' ') });
    if (node.properties?.body_system) techProps.push({ key: 'Body System', value: String(node.properties.body_system).replace(/_/g, ' ') });
    if (node.properties?.clinical_summary) techProps.push({ key: 'Summary', value: String(node.properties.clinical_summary) });
    if (node.properties?.interpretation) techProps.push({ key: 'Interpretation', value: String(node.properties.interpretation).replace(/_/g, ' ') });
    if (node.properties?.reference_range) techProps.push({ key: 'Reference Range', value: String(node.properties.reference_range) });
    if (node.properties?.event_time) techProps.push({ key: 'Event Time', value: String(node.properties.event_time) });
    if (node.properties?.created_at) techProps.push({ key: 'Created', value: String(node.properties.created_at) });
  } else {
    if (node.properties?.category) techProps.push({ key: 'Category', value: String(node.properties.category).replace(/_/g, ' ') });
    if (node.properties?.severity != null) techProps.push({ key: 'Severity', value: String(node.properties.severity) });
    if (node.properties?.event_type) techProps.push({ key: 'Event type', value: String(node.properties.event_type).replace(/_/g, ' ') });
  }

  return (
    <>
      <View style={styles.detailHeader}>
        <View style={[styles.detailTypeBadge, { backgroundColor: color + '20' }]}>
          <View style={[styles.detailTypeDot, { backgroundColor: color }]} />
          <Text style={[styles.detailTypeText, { color }]}>{CATEGORY_LABELS[node.type] || node.type}</Text>
        </View>
        <Pressable onPress={() => onSelectNode('')}>
          <Text style={styles.detailClose}>✕</Text>
        </Pressable>
      </View>
      <Text style={styles.detailTitle}>{title}</Text>
      <Text style={styles.detailDescription}>{description}</Text>

      <View style={styles.detailField}>
        <Text style={styles.detailFieldLabel}>What</Text>
        <Text style={styles.detailFieldValue}>{what}</Text>
      </View>
      <View style={styles.detailField}>
        <Text style={styles.detailFieldLabel}>When</Text>
        <Text style={styles.detailFieldValue}>{when}</Text>
      </View>
      {source && (
        <View style={styles.detailField}>
          <Text style={styles.detailFieldLabel}>Source</Text>
          <Text style={styles.detailFieldValue}>{source}</Text>
        </View>
      )}

      {nodeDetail.connected_nodes.length > 0 && (
        <View style={styles.detailConnections}>
          <Text style={styles.detailConnectionsTitle}>Connected ({nodeDetail.connected_nodes.length})</Text>
          {nodeDetail.connected_nodes.slice(0, 6).map((cn: any) => (
            <Pressable key={cn.id} style={styles.detailConnectionItem} onPress={() => onSelectNode(cn.id)}>
              <View style={[styles.connectionDot, { backgroundColor: NODE_COLORS[cn.type] || '#9AA8B8' }]} />
              <Text style={styles.connectionLabel}>{cn.label}</Text>
              <Text style={styles.connectionType}>{CATEGORY_LABELS[cn.type]}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {techProps.length > 0 && (
        <View style={styles.detailTech}>
          <Text style={styles.detailTechTitle}>Technical Details</Text>
          {techProps.map((p) => (
            <View key={p.key} style={styles.detailPropRow}>
              <Text style={styles.detailPropKey}>{p.key}</Text>
              <Text style={styles.detailPropValue}>{p.value}</Text>
            </View>
          ))}
        </View>
      )}

      {node.type === 'body_structure' && (
        <Pressable
          style={styles.viewBodyButton}
          onPress={() => {
            const structureId = node.id.split(':')[1];
            if (structureId) onViewBody(structureId);
          }}
        >
          <Text style={styles.viewBodyButtonText}>View in 3D Body</Text>
        </Pressable>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Graph Node — renders a single sphere via Filament Model
// ═══════════════════════════════════════════════════════════════════════════════

const GraphNodeModel = memo(function GraphNodeModel({
  node,
  position,
  isSelected,
  isConnected,
  onPress,
}: {
  node: GraphNode;
  position: LayoutPos3D;
  isSelected: boolean;
  isConnected: boolean;
  onPress: (nodeId: string) => void;
}) {
  const glbSource = GLB_NODES[node.type];
  if (!glbSource) return null;

  const baseSize = NODE_SIZES[node.type] || 0.07;
  const size = isSelected ? baseSize * 1.4 : baseSize;

  // Material highlight for selected/connected nodes
  const color = NODE_COLORS_VEC[node.type] || [0.6, 0.6, 0.6, 1.0];
  const emissiveStrength = isSelected ? 0.4 : isConnected ? 0.15 : 0.05;

  return (
    <Model
      key={node.id}
      source={glbSource}
      translate={[position.x, position.y, position.z]}
      scale={[size, size, size]}
      castShadow
      onPress={() => onPress(node.id)}
    >
      <EntitySelector
        byName="*"
        materialParameters={{
          index: 0,
          parameters: {
            baseColorFactor: color,
            emissiveFactor: [color[0] * emissiveStrength, color[1] * emissiveStrength, color[2] * emissiveStrength, 1.0],
            roughnessFactor: isSelected ? 0.25 : 0.45,
            metallicFactor: 0.15,
          },
        }}
      />
    </Model>
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// Graph Edge — renders a thin cylinder between two 3D points
// ═══════════════════════════════════════════════════════════════════════════════

const GraphEdgeModel = memo(function GraphEdgeModel({
  edge,
  from,
  to,
  isSelected,
}: {
  edge: GraphEdge;
  from: LayoutPos3D;
  to: LayoutPos3D;
  isSelected: boolean;
}) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist < 0.001) return null;

  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  const midZ = (from.z + to.z) / 2;

  // Edge color
  const edgeColor = EDGE_COLOR_VEC[edge.relationship] || [0.23, 0.42, 0.61, 0.3];
  const alpha = isSelected ? 0.8 : edgeColor[3];

  // Rotation to align cylinder between two points
  // Default cylinder is along Y axis
  const angle = Math.acos(dy / dist);
  const axisX = -dz;
  const axisZ = dx;
  const axisLen = Math.sqrt(axisX * axisX + axisZ * axisZ);

  return (
    <Model
      key={`edge-${edge.id}`}
      source={GLB_EDGE}
      translate={[midX, midY, midZ]}
      scale={[1, dist / 2, 1]}
      rotate={axisLen > 0.001 ? [angle * (axisX / axisLen), 0, angle * (axisZ / axisLen)] : [0, 0, 0]}
    >
      <EntitySelector
        byName="*"
        materialParameters={{
          index: 0,
          parameters: {
            baseColorFactor: [edgeColor[0], edgeColor[1], edgeColor[2], alpha],
            roughnessFactor: 0.8,
            metallicFactor: 0.0,
          },
        }}
      />
    </Model>
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// Inner Filament Scene Component
// ═══════════════════════════════════════════════════════════════════════════════

function FilamentHealthGraphInner({
  nodes,
  edges,
  layout,
  selectedNodeId,
  connectedNodeIds,
  onNodePress,
  onNodeLongPress,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  layout: LayoutResult;
  selectedNodeId: string | null;
  connectedNodeIds: Set<string>;
  onNodePress: (nodeId: string) => void;
  onNodeLongPress?: (nodeId: string) => void;
}) {
  const cameraManipulator = useCameraManipulator({
    orbitHomePosition: [0, 1.5, layout.radius + 4],
    targetPosition: [layout.center.x, layout.center.y, layout.center.z],
    upVector: [0, 1, 0],
  });

  const renderCallback = useCallback(() => {
    'worklet';
    if (cameraManipulator) {
      cameraManipulator.update(1 / 60);
    }
  }, [cameraManipulator]);

  // Group nodes by type for efficient rendering (day markers merged in —
  // they are layout-only: rendered and selectable, never persisted).
  const allNodes = useMemo(() => [...nodes, ...layout.dayNodes], [nodes, layout.dayNodes]);
  const allEdges = useMemo(() => [...edges, ...layout.dayEdges], [edges, layout.dayEdges]);
  const nodesByType = useMemo(() => {
    const grouped = new Map<string, GraphNode[]>();
    for (const node of allNodes) {
      const arr = grouped.get(node.type) ?? [];
      arr.push(node);
      grouped.set(node.type, arr);
    }
    return grouped;
  }, [allNodes]);

  // Compute connected node IDs
  const selectedEdges = useMemo(() => {
    if (!selectedNodeId) return [];
    return allEdges.filter((e) => e.source === selectedNodeId || e.target === selectedNodeId);
  }, [selectedNodeId, allEdges]);

  // Valid positions only
  const validLayout = useMemo(() => {
    const valid = new Map<string, LayoutPos3D>();
    for (const [id, pos] of layout.positions) {
      if (Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.z)) {
        valid.set(id, pos);
      }
    }
    return valid;
  }, [layout]);

  return (
    <FilamentView
      style={{ width: SCREEN_WIDTH, height: GRAPH_HEIGHT }}
      renderCallback={renderCallback}
    >
      {/* White infinite canvas: flat clinical backdrop, no bounds. */}
      <Skybox colorInHex="#FFFFFF" />
      <Camera
        cameraManipulator={cameraManipulator}
        cameraPosition={[0, 1.5, layout.radius + 4]}
        cameraTarget={[layout.center.x, layout.center.y, layout.center.z]}
        cameraUp={[0, 1, 0]}
      />
      <DefaultLight />

      {/* Render nodes grouped by type */}
      {Array.from(nodesByType.entries()).map(([type, typeNodes]) => (
        <React.Fragment key={`group-${type}`}>
          {typeNodes.map((node) => {
            const pos = validLayout.get(node.id);
            if (!pos) return null;
            return (
              <GraphNodeModel
                key={node.id}
                node={node}
                position={pos}
                isSelected={node.id === selectedNodeId}
                isConnected={connectedNodeIds.has(node.id)}
                onPress={onNodePress}
              />
            );
          })}
        </React.Fragment>
      ))}

      {/* Render edges (clinical links + day-tree links) */}
      {allEdges.map((edge) => {
        const from = validLayout.get(edge.source);
        const to = validLayout.get(edge.target);
        if (!from || !to) return null;
        const isActive = selectedNodeId != null
          && (edge.source === selectedNodeId || edge.target === selectedNodeId);
        return (
          <GraphEdgeModel
            key={edge.id}
            edge={edge}
            from={from}
            to={to}
            isSelected={isActive}
          />
        );
      })}
    </FilamentView>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main Exported Component
// ═══════════════════════════════════════════════════════════════════════════════

interface FilamentHealthGraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedNodeId: string | null;
  onNodePress: (nodeId: string) => void;
}

export default function FilamentHealthGraph({
  nodes,
  edges,
  selectedNodeId,
  onNodePress,
}: FilamentHealthGraphProps) {
  const layout = useMemo(() => compute3DLayout(nodes, edges), [nodes, edges]);

  const connectedNodeIds = useMemo(() => {
    const ids = new Set<string>();
    if (!selectedNodeId) return ids;
    const all = [...edges, ...layout.dayEdges];
    for (const edge of all) {
      if (edge.source === selectedNodeId) ids.add(edge.target);
      if (edge.target === selectedNodeId) ids.add(edge.source);
    }
    return ids;
  }, [selectedNodeId, edges, layout.dayEdges]);

  const handleNodePress = useCallback((nodeId: string) => {
    onNodePress(nodeId);
  }, [onNodePress]);

  return (
    <View style={styles.graphContainer}>
      <FilamentScene fallback={<GraphFallback />}>
        <FilamentHealthGraphInner
          nodes={nodes}
          edges={edges}
          layout={layout}
          selectedNodeId={selectedNodeId}
          connectedNodeIds={connectedNodeIds}
          onNodePress={handleNodePress}
        />
      </FilamentScene>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Fallback for when Filament is not available (Expo Go)
// ═══════════════════════════════════════════════════════════════════════════════

function GraphFallback() {
  return (
    <View style={styles.fallbackContainer}>
      <Text style={styles.fallbackIcon}>🔬</Text>
      <Text style={styles.fallbackTitle}>3D Graph requires a native build</Text>
      <Text style={styles.fallbackText}>
        The Health Graph uses GPU-rendered 3D graphics{'\n'}
        via react-native-filament.{'\n\n'}
        Please use the EAS development build{'\n'}
        instead of Expo Go for this feature.
      </Text>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════════════════════════════════════════

const styles = StyleSheet.create({
  graphContainer: {
    width: SCREEN_WIDTH,
    height: GRAPH_HEIGHT,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  fallbackContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1B222C',
    padding: SPACING.xl,
  },
  fallbackIcon: { fontSize: 48, marginBottom: SPACING.md },
  fallbackTitle: { ...TYPOGRAPHY.h3, color: COLORS.textPrimary, marginBottom: SPACING.sm },
  fallbackText: { ...TYPOGRAPHY.body, color: COLORS.textMuted, textAlign: 'center', lineHeight: 20 },

  // Detail panel
  detailHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACING.sm },
  detailTypeBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.sm, paddingVertical: SPACING.xs, borderRadius: BORDER_RADIUS.full, gap: SPACING.xs },
  detailTypeDot: { width: 6, height: 6, borderRadius: 3 },
  detailTypeText: { ...TYPOGRAPHY.captionStrong, fontSize: 11 },
  detailClose: { fontSize: 18, color: COLORS.textMuted },
  detailTitle: { ...TYPOGRAPHY.h3, color: COLORS.textPrimary, marginBottom: SPACING.xs },
  detailDescription: { ...TYPOGRAPHY.body, color: COLORS.textSecondary, marginBottom: SPACING.md, lineHeight: 20 },
  detailField: { marginBottom: SPACING.sm },
  detailFieldLabel: { ...TYPOGRAPHY.label, color: COLORS.textMuted, marginBottom: 2 },
  detailFieldValue: { ...TYPOGRAPHY.bodyStrong, color: COLORS.textPrimary },
  detailConnections: { marginTop: SPACING.sm, paddingTop: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.borderLight },
  detailConnectionsTitle: { ...TYPOGRAPHY.captionStrong, color: COLORS.textSecondary, marginBottom: SPACING.xs },
  detailConnectionItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3, gap: SPACING.sm },
  connectionDot: { width: 8, height: 8, borderRadius: 4 },
  connectionLabel: { ...TYPOGRAPHY.body, color: COLORS.textPrimary, flex: 1, fontSize: 13 },
  connectionType: { ...TYPOGRAPHY.caption, color: COLORS.textMuted, fontSize: 11 },
  detailTech: { marginTop: SPACING.sm, paddingTop: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.borderLight },
  detailTechTitle: { ...TYPOGRAPHY.captionStrong, color: COLORS.textMuted, marginBottom: SPACING.xs, fontSize: 10 },
  detailPropRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  detailPropKey: { ...TYPOGRAPHY.caption, color: COLORS.textMuted, textTransform: 'capitalize', fontSize: 11 },
  detailPropValue: { ...TYPOGRAPHY.bodyStrong, color: COLORS.textSecondary, fontSize: 11 },
  viewBodyButton: { backgroundColor: COLORS.teal, paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md, borderRadius: BORDER_RADIUS.md, alignItems: 'center', marginTop: SPACING.sm },
  viewBodyButtonText: { ...TYPOGRAPHY.bodyStrong, color: '#FFFFFF' },
});
