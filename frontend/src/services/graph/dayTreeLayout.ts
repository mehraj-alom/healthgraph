/**
 * dayTreeLayout — pure inverted day-tree layout for the health graph.
 *
 * Patient at top, one marker row per calendar day (newest first), each
 * day's entries fanned beneath it. Zero imports: node-testable.
 */
import type { GraphNode, GraphEdge } from '@/hooks/useHealthGraph';

export type { GraphNode, GraphEdge };

export interface DayGroup {
  dayKey: string;
  items: GraphNode[];
}

/**
 * Group dated nodes newest-first; collect the undated. Shared by day-tree
 * renderers so grouping can never disagree between views. Patient nodes
 * are skipped unless includePatient is set (callers position the root).
 */
export function groupNodesByDay(
  nodes: GraphNode[],
  options?: { includePatient?: boolean },
): { groups: DayGroup[]; undated: GraphNode[] } {
  const byDay = new Map<string, GraphNode[]>();
  const undated: GraphNode[] = [];
  for (const node of nodes) {
    if (node.type === 'patient' && options?.includePatient !== true) continue;
    const day = nodeDayKey(node);
    if (!day) {
      undated.push(node);
      continue;
    }
    const arr = byDay.get(day) ?? [];
    arr.push(node);
    byDay.set(day, arr);
  }
  const groups = [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([dayKey, items]) => ({ dayKey, items }));
  return { groups, undated };
}

// Deterministic hash for stable positions
// ═══════════════════════════════════════════════════════════════════════════════

export function stableHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3D Layout Engine
// ═══════════════════════════════════════════════════════════════════════════════

export interface LayoutPos3D {
  x: number;
  y: number;
  z: number;
}

export interface LayoutResult {
  positions: Map<string, LayoutPos3D>;
  center: LayoutPos3D;
  radius: number;
  /** Layout-only day markers (never persisted, never synced). */
  dayNodes: GraphNode[];
  /** Layout-only tree links (patient→day, day→item). */
  dayEdges: GraphEdge[];
}

// Property keys that may carry a node's calendar date, in priority order
// (matches the backend projection: event_time / date / visit_date /
// measured_at / recorded_at).
const DAY_PROPERTY_KEYS = [
  'event_time',
  'date',
  'visit_date',
  'measured_at',
  'recorded_at',
  'created_at',
  'log_date',
];

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** Local YYYY-MM-DD for a node, or null when undated. */
export function nodeDayKey(node: GraphNode): string | null {
  const props = node.properties ?? {};
  for (const key of DAY_PROPERTY_KEYS) {
    const raw = props[key];
    if (typeof raw !== 'string' || !raw) continue;
    const d = new Date(raw);
    if (isNaN(d.getTime())) continue;
    const m = `${d.getMonth() + 1}`.padStart(2, '0');
    const day = `${d.getDate()}`.padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  }
  return null;
}

export function dayLabel(dayKey: string): string {
  const d = new Date(dayKey + 'T00:00:00');
  if (isNaN(d.getTime())) return dayKey;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/**
 * Inverted day-tree layout: patient at top, one marker row per calendar
 * day (newest first), and each day's entries fanned beneath it — BPM/PPG,
 * logs, medications, food, documents, everything with a date. Undated
 * nodes (e.g. anatomy) form a compact satellite annex to the left.
 * Deterministic (hash jitter only), so the tree never reshuffles.
 */
export function compute3DLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
): LayoutResult {
  const positions = new Map<string, LayoutPos3D>();
  const dayNodes: GraphNode[] = [];
  const dayEdges: GraphEdge[] = [];

  const LEVEL_GAP = 7;
  const DAY_GAP = 8;
  const ITEM_GAP = 2.4;
  const ITEMS_PER_ROW = 14;

  const patient = nodes.find((n) => n.type === 'patient');

  // Group dated nodes by day (newest day first); collect the undated.
  const byDay = new Map<string, GraphNode[]>();
  const undated: GraphNode[] = [];
  for (const node of nodes) {
    if (node.type === 'patient') continue;
    const day = nodeDayKey(node);
    if (!day) {
      undated.push(node);
      continue;
    }
    const arr = byDay.get(day) ?? [];
    arr.push(node);
    byDay.set(day, arr);
  }
  const dayKeys = [...byDay.keys()].sort((a, b) => (a < b ? 1 : -1));

  // 1. Patient at the top.
  if (patient) {
    positions.set(patient.id, { x: 0, y: 0, z: 0 });
  }

  // 2. Day markers in one row beneath the patient.
  dayKeys.forEach((dayKey, i) => {
    const x = (i - (dayKeys.length - 1) / 2) * DAY_GAP;
    const items = byDay.get(dayKey)!;
    const dayId = `__day:${dayKey}`;
    dayNodes.push({
      id: dayId,
      type: 'date',
      label: dayLabel(dayKey),
      properties: { date: dayKey, entryCount: items.length },
    });
    positions.set(dayId, { x, y: -LEVEL_GAP, z: 0 });
    if (patient) {
      dayEdges.push({
        id: `__e:day:${dayKey}`,
        source: patient.id,
        target: dayId,
        type: 'TREE',
        relationship: 'HAS_DAY',
      });
    }
    // 3. That day's entries fanned beneath the marker (wrapped rows).
    items.forEach((item, j) => {
      const row = Math.floor(j / ITEMS_PER_ROW);
      const col = j % ITEMS_PER_ROW;
      const rowCount = Math.min(ITEMS_PER_ROW, items.length - row * ITEMS_PER_ROW);
      const hash = stableHash(item.id);
      positions.set(item.id, {
        x: x + (col - (rowCount - 1) / 2) * ITEM_GAP,
        y: -LEVEL_GAP * 2 - row * 2.6,
        z: ((hash % 100) / 100 - 0.5) * 0.8,
      });
      dayEdges.push({
        id: `__e:item:${item.id}`,
        source: dayId,
        target: item.id,
        type: 'TREE',
        relationship: 'ON_DAY',
      });
    });
  });

  // 4. Undated satellite annex to the left of the day row.
  if (undated.length > 0) {
    const leftEdge = dayKeys.length > 0 ? (-(dayKeys.length - 1) / 2) * DAY_GAP : 0;
    const annexX = leftEdge - 5;
    const perRow = 6;
    undated.forEach((node, k) => {
      const hash = stableHash(node.id);
      positions.set(node.id, {
        x: annexX - Math.floor(k / perRow) * 2.4,
        y: -LEVEL_GAP + ((k % perRow) - (Math.min(perRow, undated.length) - 1) / 2) * -2.2,
        z: ((hash % 100) / 100 - 0.5) * 0.8,
      });
    });
  }

  // Any node missed above (defensive) falls back near the patient.
  for (const node of nodes) {
    if (!positions.has(node.id)) {
      const hash = stableHash(node.id);
      positions.set(node.id, {
        x: ((hash % 360) / 360 - 0.5) * 3,
        y: -2,
        z: 0,
      });
    }
  }

  // Compute bounding sphere
  let cx = 0, cy = 0, cz = 0, count = 0;
  for (const pos of positions.values()) {
    cx += pos.x; cy += pos.y; cz += pos.z; count++;
  }
  if (count > 0) { cx /= count; cy /= count; cz /= count; }

  let maxDist = 0;
  for (const pos of positions.values()) {
    const dx = pos.x - cx, dy = pos.y - cy, dz = pos.z - cz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > maxDist) maxDist = d;
  }

  return { positions, center: { x: cx, y: cy, z: cz }, radius: maxDist, dayNodes, dayEdges };
}


// ═══════════════════════════════════════════════════════════════════════════════
