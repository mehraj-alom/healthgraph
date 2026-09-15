/**
 * semanticEdges.ts — frontend-derived cross-metric edges for the 3D graph.
 *
 * The graph API only knows clinical topology + time/proximity edges; all
 * between-metric knowledge (sleep↔wellbeing, stress↔sleep, …) lives in the
 * correlations feed. This module reuses that exact math
 * (computeCorrelationPairs — single source of truth) and anchors each end to
 * a real timeline_event node, emitting `derived: true` edges the renderer
 * draws as its own alive arcs. Nothing is written to Neo4j.
 */

import type { GraphEdge, GraphNode } from '@/hooks/useHealthGraph';
import type { DailyCheckInDetail, TrendsResponse } from '@/types';
import type { DailyMetrics } from '@/hooks/useDailyMetrics';
import {
  baseId,
  computeCorrelationPairs,
  localStreams,
  trendStreams,
  vitalLabelMap,
} from '@/screens/Dashboard/correlations';
/** Max semantic edges merged into the graph (flat regardless of limit). */
export const MAX_SEMANTIC_EDGES = 8;
/** Minimum paired days + |r| for an edge (stricter than the feed's ≥3). */
const MIN_PAIRED = 5;
const MIN_R = 0.35;

interface Anchor {
  /** Match tokens tried in order (specific → generic), uppercase includes(). */
  tokens: string[];
  label: string;
}

/**
 * Stream base id → graph event anchor. Energy/stress/mood ride inside the
 * wellbeing log (see EventType: WELLBEING_LOG = "Mood, Energy, Stress"), so
 * they anchor there; water/meals/appetite → nutrition; hr/vitals → vital.
 */
const STREAM_ANCHORS: Record<string, Anchor> = {
  sleepDur: { tokens: ['SLEEP_LOG', 'SLEEP'], label: 'Sleep' },
  sleepQual: { tokens: ['SLEEP_LOG', 'SLEEP'], label: 'Sleep' },
  awakenings: { tokens: ['SLEEP_LOG', 'SLEEP'], label: 'Sleep' },
  wellbeing: { tokens: ['WELLBEING_LOG', 'WELLBEING'], label: 'Wellbeing' },
  energy: { tokens: ['WELLBEING_LOG', 'WELLBEING', 'ENERGY'], label: 'Energy' },
  stress: { tokens: ['STRESS', 'WELLBEING_LOG', 'WELLBEING'], label: 'Stress' },
  mood: { tokens: ['WELLBEING_LOG', 'MOOD', 'WELLBEING'], label: 'Mood' },
  water: { tokens: ['NUTRITION_LOG', 'WATER', 'NUTRITION'], label: 'Water' },
  meals: { tokens: ['NUTRITION_LOG', 'NUTRITION'], label: 'Nutrition' },
  appetite: { tokens: ['NUTRITION_LOG', 'NUTRITION'], label: 'Appetite' },
  activity: { tokens: ['ACTIVITY_LOG', 'ACTIVITY'], label: 'Activity' },
  calories: { tokens: ['ACTIVITY_LOG', 'ACTIVITY'], label: 'Activity' },
  pain: { tokens: ['PAIN_LOG', 'PAIN'], label: 'Pain' },
  hr: { tokens: ['VITAL_SIGN', 'HEART', 'VITAL'], label: 'Heart' },
  symptom: { tokens: ['SYMPTOM'], label: 'Symptoms' },
  vital: { tokens: ['VITAL_SIGN', 'VITAL'], label: 'Vitals' },
};

const SKIPPED_BASES = new Set(['records', 'rhythm']);

function eventTimeOf(n: GraphNode): number {
  const t = n.properties?.event_time ?? n.properties?.date ?? n.properties?.created_at;
  const ms = t ? new Date(String(t)).getTime() : NaN;
  return Number.isFinite(ms) ? ms : 0;
}

export interface SemanticEdgeOptions {
  trends: TrendsResponse | null;
  dailyMetrics: DailyMetrics | null;
  localDetails: DailyCheckInDetail[];
  nodes: GraphNode[];
}

export function buildSemanticEdges({
  trends,
  dailyMetrics,
  localDetails,
  nodes,
}: SemanticEdgeOptions): GraphEdge[] {
  if (nodes.length === 0) return [];

  const streams = [
    ...trendStreams(trends),
    ...localStreams(localDetails, vitalLabelMap(dailyMetrics)),
  ];
  if (streams.length < 2) return [];

  // Latest-first timeline events for anchoring.
  const events = nodes
    .filter((n) => n.type === 'timeline_event')
    .map((n) => ({
      node: n,
      type: String(n.properties?.event_type ?? '').toUpperCase(),
      time: eventTimeOf(n),
    }))
    .sort((a, b) => b.time - a.time);
  if (events.length === 0) return [];

  const anchorFor = (streamId: string): { node: GraphNode; label: string } | null => {
    const base = baseId(streamId);
    if (SKIPPED_BASES.has(base)) return null;
    const anchor = STREAM_ANCHORS[base];
    if (!anchor) return null;
    for (const token of anchor.tokens) {
      const hit = events.find((e) => e.type.includes(token));
      if (hit) return { node: hit.node, label: anchor.label };
    }
    return null;
  };

  const pairs = computeCorrelationPairs(streams);
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();

  for (const p of pairs) {
    if (p.verdict === 'neutral' || p.r == null || !Number.isFinite(p.r)) continue;
    if (Math.abs(p.r) < MIN_R || p.paired < MIN_PAIRED) continue;
    const a = anchorFor(p.aId);
    const b = anchorFor(p.bId);
    if (!a || !b || a.node.id === b.node.id) continue;
    // One edge per unordered node pair — keep the strongest |r|.
    const key = [a.node.id, b.node.id].sort().join('~');
    if (seen.has(key)) continue;
    seen.add(key);
    const positive = p.r > 0;
    edges.push({
      id: `sem-${baseId(p.aId)}-${baseId(p.bId)}`,
      source: a.node.id,
      target: b.node.id,
      type: positive ? 'CORRELATES' : 'INVERSES',
      relationship: positive ? 'CORRELATES' : 'INVERSES',
      derived: true,
      properties: {
        r: Math.round(p.r * 100) / 100,
        paired_days: p.paired,
        verdict: p.verdict,
        aLabel: a.label,
        bLabel: b.label,
      },
    });
  }

  // Attention first, then strongest — same ranking language as the feed.
  const rank = (v: string) => (v === 'bad' ? 0 : v === 'good' ? 1 : 2);
  edges.sort((x, y) => {
    const xv = rank(String(x.properties?.verdict));
    const yv = rank(String(y.properties?.verdict));
    if (xv !== yv) return xv - yv;
    return Math.abs(Number(y.properties?.r ?? 0)) - Math.abs(Number(x.properties?.r ?? 0));
  });
  return edges.slice(0, MAX_SEMANTIC_EDGES);
}

export type NeighborVerdict = 'good' | 'bad' | 'neutral';

/**
 * Clinical band verdict for a single event node from its day's check-in.
 * Same bands as the dashboard dial — guarantees green/red even before enough
 * history exists for correlation edges. Binary by design (good = green, else
 * red); only MISSING data reads neutral.
 */
function clinicalVerdictFor(node: GraphNode, localDetails: DailyCheckInDetail[]): NeighborVerdict | null {
  const et = String(node.properties?.event_type ?? '').toUpperCase();
  const day = String(node.properties?.event_time ?? node.properties?.date ?? '').slice(0, 10);
  const d = day ? localDetails.find((x) => x.log_date === day) : undefined;
  if (!d) return null;
  if (et.includes('SLEEP')) {
    const v = d.sleep_duration_minutes;
    if (v == null) return null;
    return v >= 420 && v <= 540 ? 'good' : 'bad';
  }
  if (et.includes('WELLBEING') || et.includes('MOOD') || et.includes('ENERGY') || et.includes('STRESS')) {
    const v = d.overall_wellbeing;
    if (v == null) return null;
    return v >= 4 ? 'good' : 'bad';
  }
  if (et.includes('ACTIVITY')) {
    const mins = (d.activities ?? []).reduce((s, a) => s + (a.duration_minutes ?? 0), 0);
    if (!(mins > 0)) return null;
    return mins >= 30 ? 'good' : 'neutral';
  }
  if (et.includes('NUTRITION') || et.includes('WATER') || et.includes('MEAL')) {
    const v = d.water_ml;
    if (v == null || v <= 0) return null;
    return v >= 2000 ? 'good' : 'bad';
  }
  if (et.includes('PAIN')) {
    const sevs = (d.pain ?? []).map((p) => p.severity).filter((v) => v != null);
    if (sevs.length === 0) return null;
    return Math.max(...sevs) <= 2 ? 'good' : 'bad';
  }
  if (et.includes('SYMPTOM')) {
    const syms = d.symptoms ?? [];
    if (syms.length === 0) return null;
    return Math.max(...syms.map((s) => s.severity ?? 0)) <= 3 ? 'good' : 'bad';
  }
  if (et.includes('VITAL') || et.includes('HEART') || et.includes('BLOOD') || et.includes('GLUCOSE')) {
    const hr = (d.vitals ?? []).find((v) => v.value != null && String(v.unit ?? '').toLowerCase().includes('bpm'));
    if (!hr || hr.value == null) return null;
    return hr.value >= 60 && hr.value <= 100 ? 'good' : 'bad';
  }
  if (et.includes('MEDICATION')) return 'good';
  return null;
}

/**
 * Verdict per 1-hop neighbor of the focused node. Semantic edges carry the
 * feed verdict; otherwise clinical bands from the day's check-in decide, so
 * green/red works from day one; plain topology without signal stays neutral
 * (bright but badgeless). Drives badge dots + neighbor card rows.
 */
export function neighborVerdictsFor(
  selectedId: string | null,
  nodes: GraphNode[],
  edges: GraphEdge[],
  localDetails: DailyCheckInDetail[] = [],
): Map<string, NeighborVerdict> {
  const out = new Map<string, NeighborVerdict>();
  if (!selectedId) return out;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const e of edges) {
    const other = e.source === selectedId ? e.target
      : e.target === selectedId ? e.source
      : null;
    if (!other || out.has(other)) continue;
    if (e.relationship === 'CORRELATES' || e.relationship === 'INVERSES') {
      const v = e.properties?.verdict;
      out.set(other, v === 'bad' ? 'bad' : v === 'good' ? 'good' : 'neutral');
      continue;
    }
    const n = byId.get(other);
    if (!n) { out.set(other, 'neutral'); continue; }
    const vs = String(n.properties?.visual_status ?? '').toLowerCase();
    if (vs.includes('critical') || vs === 'warning') { out.set(other, 'bad'); continue; }
    if (vs.includes('normal')) { out.set(other, 'good'); continue; }
    out.set(other, clinicalVerdictFor(n, localDetails) ?? 'neutral');
  }
  return out;
}

/** Human relationship line for a neighbor row, e.g. "Sleep ↔ Stress · r −0.60". */
export function relationshipLabel(edge: GraphEdge, neighborLabel: string): string {
  const r = edge.properties?.r;
  const rTxt = typeof r === 'number' ? ` · r ${r > 0 ? '+' : ''}${r.toFixed(2).replace('-', '−')}` : '';
  const a = edge.properties?.aLabel as string | undefined;
  const b = edge.properties?.bLabel as string | undefined;
  const pair = a && b ? `${a} ↔ ${b}` : neighborLabel;
  switch (edge.relationship) {
    case 'CORRELATES': return `${pair}${rTxt}`;
    case 'INVERSES': return `${pair}${rTxt}`;
    case 'LOGGED_ON': return 'Logged together';
    case 'DERIVED_SAME_DAY': return edge.properties?.date ? `Same day · ${edge.properties.date}` : 'Same day';
    case 'DERIVED_SAME_TYPE': return 'Same type';
    case 'DERIVED_SAME_BODY_SITE': return 'Same body site';
    case 'AFFECTS': return 'Affects area';
    case 'HAS_OBSERVATION': return 'Has observation';
    case 'SOURCE_DOCUMENT': return 'From this record';
    case 'HAS_TIMELINE_EVENT': return 'Timeline entry';
    case 'ACTIVE_MEDICATION': return 'Active medication';
    case 'HAS_MEDICATION_TAKEN': return 'Dose taken';
    case 'TAKEN_FROM': return 'From medication';
    default: return String(edge.relationship).replace(/_/g, ' ').toLowerCase();
  }
}
