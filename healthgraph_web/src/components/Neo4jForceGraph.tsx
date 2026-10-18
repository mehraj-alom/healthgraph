import { useEffect, useRef, useState, useCallback } from 'react';

type NodeType = 'patient' | 'body_structure' | 'observation' | 'document' | 'timeline_event' | 'medication' | 'medication_taken_event' | 'concept' | 'medication_request' | 'condition_occurrence' | 'visit' | 'patient_statement' | 'medication_canonical' | 'measurement' | 'medication_version' | 'sleep_episode' | 'activity_event' | 'nutrition_intake' | 'food_scan' | 'food_entry' | 'ppg_measurement' | string;

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  properties: Record<string, any>;
  x?: number;
  y?: number;
}

export interface GraphEdge {
  id: string;
  source: string | GraphNode;
  target: string | GraphNode;
  type: string;
  relationship: string;
  derived?: boolean;
  properties?: Record<string, any>;
}

interface HealthGraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  total_nodes: number;
  total_edges: number;
  rev?: string | null;
}

// Force simulation (zero-deps, lightweight)
type SimNode = GraphNode & { vx: number; vy: number; fx?: number; fy?: number; degree: number; radius: number };
type SimEdge = GraphEdge & { source: SimNode; target: SimNode };

function runSimulation(nodes: GraphNode[], edges: GraphEdge[], width: number, height: number) {
  const simNodes: SimNode[] = nodes.map((n) => ({ ...n, vx: (Math.random() - 0.5) * 4, vy: (Math.random() - 0.5) * 4, degree: 0, radius: 14 }));
  const idToNode = new Map(simNodes.map((n) => [n.id, n]));

  // degree
  for (const e of edges) {
    const s = idToNode.get(typeof e.source === 'string' ? e.source : e.source.id);
    const t = idToNode.get(typeof e.target === 'string' ? e.target : e.target.id);
    if (s) s.degree += 1;
    if (t) t.degree += 1;
  }
  for (const n of simNodes) {
    n.radius = 10 + Math.sqrt(n.degree) * 7; // size by importance
  }

  const simEdges: SimEdge[] = edges.map((e) => {
    const s = idToNode.get(typeof e.source === 'string' ? e.source : e.source.id)!;
    const t = idToNode.get(typeof e.target === 'string' ? e.target : e.target.id)!;
    return { ...e, source: s, target: t };
  });

  // Verlet-style force integration
  const centerX = width / 2;
  const centerY = height / 2;
  const chargeStrength = -45;
  const linkStrength = 0.06;
  const linkDistance = 90;
  const collideStrength = 1;

  const alpha = 1;
  const steps = 120;

  // fixed positions for patient root
  const patient = simNodes.find((n) => n.type === 'patient');
  if (patient) { patient.fx = centerX; patient.fy = centerY; }

  for (let step = 0; step < steps; step++) {
    const a = alpha * (1 - step / steps);

    // charge (repulsion)
    for (let i = 0; i < simNodes.length; i++) {
      const ni = simNodes[i];
      for (let j = i + 1; j < simNodes.length; j++) {
        const nj = simNodes[j];
        const dx = ni.x! - nj.x!;
        const dy = ni.y! - nj.y!;
        const d2 = dx * dx + dy * dy || 0.01;
        const d = Math.sqrt(d2);
        const force = (chargeStrength * ni.radius * nj.radius) / d2;
        const fx = (force * dx) / d;
        const fy = (force * dy) / d;
        ni.vx += fx; ni.vy += fy;
        nj.vx -= fx; nj.vy -= fy;
      }
      // center gravity
      const gx = (centerX - (ni.x ?? centerX)) * 0.015 * a;
      const gy = (centerY - (ni.y ?? centerY)) * 0.015 * a;
      ni.vx += gx; ni.vy += gy;
      if (ni.fx != null) { ni.vx = (ni.fx - ni.x!) * 0.1; ni.x = ni.fx; }
      if (ni.fy != null) { ni.vy = (ni.fy - ni.y!) * 0.1; ni.y = ni.fy; }
    }

    // links (springs)
    for (const e of simEdges) {
      const s = e.source; const t = e.target;
      const dx = t.x! - s.x!;
      const dy = t.y! - s.y!;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = ((d - linkDistance) * linkStrength * a) / d;
      const fx = dx * force; const fy = dy * force;
      if (!s.fx) { s.vx -= fx; s.x = (s.x ?? centerX) + s.vx * 0.5; }
      if (!s.fy) { s.vy -= fy; s.y = (s.y ?? centerY) + s.vy * 0.5; }
      if (!t.fx) { t.vx += fx; t.x = (t.x ?? centerX) + t.vx * 0.5; }
      if (!t.fy) { t.vy += fy; t.y = (t.y ?? centerY) + t.vy * 0.5; }
    }

    // collision
    for (let i = 0; i < simNodes.length; i++) {
      const ni = simNodes[i];
      for (let j = i + 1; j < simNodes.length; j++) {
        const nj = simNodes[j];
        const dx = ni.x! - nj.x!;
        const dy = ni.y! - nj.y!;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const minDist = ni.radius + nj.radius + 6;
        if (d < minDist) {
          const overlap = (minDist - d) / d * collideStrength * a;
          const mx = dx * overlap * 0.5;
          const my = dy * overlap * 0.5;
          if (!ni.fx) { ni.vx += mx; ni.x = (ni.x ?? centerX) + ni.vx * 0.5; }
          if (!ni.fy) { ni.vy += my; ni.y = (ni.y ?? centerY) + ni.vy * 0.5; }
          if (!nj.fx) { nj.vx -= mx; nj.x = (nj.x ?? centerX) + nj.vx * 0.5; }
          if (!nj.fy) { nj.vy -= my; nj.y = (nj.y ?? centerY) + nj.vy * 0.5; }
        }
      }
    }

    // velocity decay
    for (const n of simNodes) {
      if (!n.fx) n.x = (n.x ?? centerX) + n.vx * 0.5;
      if (!n.fy) n.y = (n.y ?? centerY) + n.vy * 0.5;
      n.vx *= 0.85; n.vy *= 0.85;
    }
  }

  return { nodes: simNodes, edges: simEdges };
}

const NODE_COLORS: Record<string, string> = {
  patient: '#0f6d66',
  body_structure: '#7b8aa0',
  observation: '#4e8f88',
  document: '#8a7bc8',
  timeline_event: '#c08a3b',
  medication: '#45a29a',
  medication_taken_event: '#3d8e85',
  concept: '#9aa8b8',
  medication_request: '#45a29a',
  condition_occurrence: '#c26e54',
  visit: '#64748c',
  patient_statement: '#a394d6',
  medication_canonical: '#9aa8b8',
  measurement: '#d4818d',
  medication_version: '#3d8e85',
  sleep_episode: '#7e74d8',
  activity_event: '#4aa39b',
  nutrition_intake: '#6bafd4',
  food_scan: '#6bafd4',
  food_entry: '#6bafd4',
  ppg_measurement: '#d4818d',
};

function colorFor(type: string): string {
  return NODE_COLORS[type] ?? '#64748b';
}

const EDGE_COLORS: Record<string, string> = {
  HAS_OBSERVATION: '#6e7f96',
  AFFECTS: '#c46a60',
  SOURCE_DOCUMENT: '#8a7bc8',
  DOCUMENTED_IN: '#8a7bc8',
  LOGGED_ON: '#be8a3c',
  HAS_TIMELINE_EVENT: '#6b7686',
  DERIVED_SAME_TYPE: '#707a89',
  DERIVED_SAME_BODY_SITE: '#43a099',
  DERIVED_SAME_DAY: '#707a89',
  CORRELATES: '#43a099',
  INVERSES: '#c46a60',
  HAS_CONDITION: '#c26e54',
  HAS_VISIT: '#64748c',
  HAS_STATEMENT: '#a394d6',
  HAS_MEDICATION_REQUEST: '#45a29a',
  PRESCRIBES: '#3d8e85',
  PRESCRIBED_FOR: '#c26e54',
  REASON_STATED_BY_PATIENT: '#a394d6',
  ABOUT: '#a394d6',
  RESULTS_FROM: '#3d8e85',
  OCCURRED_DURING: '#64748c',
  HAS_MEASUREMENT: '#d4818d',
  HAS_CODE: '#9aa8b8',
  HAS_VERSION: '#3d8e85',
  SUPERSEDES: '#3d8e85',
  HAS_SLEEP: '#7e74d8',
  HAS_ACTIVITY: '#4aa39b',
  HAS_NUTRITION: '#6bafd4',
  HAS_FOOD_SCAN: '#6bafd4',
  HAS_ENTRY: '#6bafd4',
  HAS_BIOMETRIC: '#d4818d',
  HAS_DAY: '#0f6d66',
  ON_DAY: '#43a099',
};

export default function Neo4jForceGraph({ width = 700, height = 600 }: { width?: number; height?: number }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [data, setData] = useState<HealthGraphData | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [sim, setSim] = useState<{ nodes: SimNode[]; edges: SimEdge[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/v1/health-graph?depth=2&limit=200');
        const json = (await res.json()) as HealthGraphData;
        if (!cancelled) setData(json);
      } catch {
        // offline / api down — show empty state
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!data) return;
    const { nodes: simNodes, edges: simEdges } = runSimulation(data.nodes, data.edges, width, height);
    setSim({ nodes: simNodes, edges: simEdges });
  }, [data, width, height]);

  const handleNodeClick = useCallback((id: string) => {
    setSelected((s) => (s === id ? null : id));
  }, []);

  // blast radius set: selected + direct neighbors
  const blastSet = useMemo(() => {
    if (!selected || !sim) return new Set<string>();
    const set = new Set<string>([selected]);
    for (const e of sim.edges) {
      const s = typeof e.source === 'string' ? e.source : e.source.id;
      const t = typeof e.target === 'string' ? e.target : e.target.id;
      if (s === selected) set.add(t);
      else if (t === selected) set.add(s);
    }
    return set;
  }, [selected, sim]);

  const blastEdges = useMemo(() => {
    if (!selected || !sim) return new Set<string>();
    const set = new Set<string>();
    for (const e of sim.edges) {
      const s = typeof e.source === 'string' ? e.source : e.source.id;
      const t = typeof e.target === 'string' ? e.target : e.target.id;
      if (blastSet.has(s) && blastSet.has(t)) set.add(e.id);
    }
    return set;
  }, [selected, sim, blastSet]);

  const nodeColor = (n: GraphNode) => {
    if (selected && !blastSet.has(n.id)) return '#94a3b8';
    if (selected && n.id === selected) return '#22d3ee';
    return colorFor(n.type);
  };

  const nodeOpacity = (n: GraphNode) => (selected && !blastSet.has(n.id) ? 0.15 : 1);

  const edgeColor = (e: GraphEdge) => {
    const rel = typeof e.relationship === 'string' ? e.relationship : e.type;
    const base = EDGE_COLORS[rel] ?? '#475569';
    if (selected && !blastEdges.has(e.id)) return '#334155';
    return base;
  };

  const edgeOpacity = (e: GraphEdge) => {
    const rel = typeof e.relationship === 'string' ? e.relationship : e.type;
    const base = e.derived ? 0.35 : 0.85;
    if (selected && !blastEdges.has(e.id)) return 0.12;
    return base;
  };

  const nodeSize = (n: SimNode) => n.radius;

  if (!data) {
    return (
      <div className="relative w-full h-full bg-[#0f172a] flex items-center justify-center">
        <div className="text-slate-400 text-sm animate-pulse">Loading health graph from Neo4j…</div>
      </div>
    );
  }

  const nodeCount = data.nodes.length;
  const edgeCount = data.edges.length;
  const healthScore = Math.round((nodeCount / Math.max(edgeCount + nodeCount, 1)) * 60 + 30);

  const selectedNode = selected ? data.nodes.find((n) => n.id === selected) : null;

  return (
    <div className="relative w-full h-full bg-[#0b1120] text-slate-200 overflow-hidden">
      {/* Surface */}
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="block"
        style={{ display: 'block' }}
      >
        <defs>
          <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L9,3 z" fill="#22d3ee" />
          </marker>
        </defs>

        {/* edges */}
        {sim?.edges.map((e) => {
          const s = e.source as SimNode;
          const t = e.target as SimNode;
          const midX = (s.x! + t.x!) / 2;
          const midY = (s.y! + t.y!) / 2;
          const dx = t.x! - s.x!;
          const dy = t.y! - s.y!;
          const dist = Math.hypot(dx, dy) || 1;
          const curveX = midX - (dy / dist) * 24;
          const curveY = midY + (dx / dist) * 24;
          return (
            <path
              key={e.id}
              d={`M${s.x},${s.y} Q${curveX},${curveY} ${t.x},${t.y}`}
              stroke={edgeColor(e)}
              strokeOpacity={edgeOpacity(e)}
              strokeWidth={e.derived ? 1 : 2}
              fill="none"
              className="transition-opacity duration-300"
              pointerEvents="none"
            />
          );
        })}

        {/* nodes */}
        {sim?.nodes.map((n) => {
          const isSel = selected === n.id;
          const inBlast = blastSet.has(n.id);
          const isDim = selected && !inBlast;
          return (
            <g
              key={n.id}
              onClick={(ev) => { ev.stopPropagation(); handleNodeClick(n.id); }}
              className="cursor-pointer transition-all duration-200"
              transform={`translate(${n.x},${n.y})`}
            >
              {isSel && (
                <circle cx={0} cy={0} r={nodeSize(n) + 8} fill="#22d3ee" fillOpacity={0.12} filter="url(#glow)" />
              )}
              <circle
                cx={0}
                cy={0}
                r={nodeSize(n)}
                fill={nodeColor(n)}
                fillOpacity={nodeOpacity(n)}
                stroke={isSel ? '#22d3ee' : 'rgba(255,255,255,0.6)'}
                strokeWidth={isSel ? 3 : 1.5}
                filter={isSel ? 'url(#glow)' : 'none'}
                className="transition-all duration-300"
              />
              {!isDim && n.label && n.label.length > 0 && (
                <text
                  x={0}
                  y={nodeSize(n) + 16}
                  textAnchor="middle"
                  fontSize={10}
                  fill={isSel ? '#22d3ee' : '#94a3b8'}
                  pointerEvents="none"
                  className="drop-shadow"
                >
                  {n.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* right panel */}
      <div className="absolute top-0 right-0 w-80 h-full bg-[#101828] border-l border-slate-700 p-4 overflow-y-auto shadow-2xl z-10">
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full bg-[#22d3ee]" />
            <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">Health Graph</h2>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs text-slate-400">
            <div>
              <div className="text-slate-500">Nodes</div>
              <div className="text-slate-200 font-mono">{nodeCount}</div>
            </div>
            <div>
              <div className="text-slate-500">Edges</div>
              <div className="text-slate-200 font-mono">{edgeCount}</div>
            </div>
          </div>
          <div className="mt-2 h-1.5 w-full bg-slate-800 rounded overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[#22d3ee] to-[#0f6d66]"
              style={{ width: `${Math.min(healthScore, 100)}%` }}
            />
          </div>
          <div className="mt-1 text-[10px] text-slate-400">Graph cohesion: {healthScore}</div>
        </div>

        {selectedNode ? (
          <>
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: colorFor(selectedNode.type) }} />
                <span className="text-xs font-semibold text-slate-200 capitalize">{selectedNode.type.replace(/_/g, ' ')}</span>
              </div>
              <div className="text-lg font-bold text-slate-100 truncate">{selectedNode.label}</div>
              {selectedNode.properties && Object.entries(selectedNode.properties).length > 0 && (
                <div className="mt-2">
                  <div className="text-[10px] text-slate-500 mb-1 uppercase tracking-wider">Properties</div>
                  <ul className="text-xs text-slate-400 space-y-1">
                    {Object.entries(selectedNode.properties).slice(0, 8).map(([k, v]) => (
                      <li key={k} className="flex justify-between">
                        <span className="text-slate-500">{k}</span>
                        <span className="text-slate-300 font-mono truncate">{String(v)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="mb-4 border-t border-slate-700 pt-3">
              <div className="text-[10px] text-slate-500 mb-2 uppercase tracking-wider">Blast radius</div>
              <div className="text-xs text-slate-400">
                {blastSet.size} nodes affected · {blastEdges.size} connections
              </div>
            </div>

            <div className="border-t border-slate-700 pt-3">
              <div className="text-[10px] text-slate-500 mb-2 uppercase tracking-wider">Neighbors</div>
              <div className="flex flex-wrap gap-1">
                {Array.from(blastSet).filter((id) => id !== selected).map((id) => {
                  const n = data.nodes.find((x) => x.id === id);
                  if (!n) return null;
                  return (
                    <span
                      key={id}
                      onClick={(ev) => { ev.stopPropagation(); handleNodeClick(id); }}
                      className="cursor-pointer px-2 py-1 text-[10px] rounded bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-slate-100 transition"
                    >
                      {n.label}
                    </span>
                  );
                })}
              </div>
            </div>
          </>
        ) : (
          <div className="text-center py-10">
            <div className="text-slate-500 text-xs">Tap a node to inspect its blast radius</div>
          </div>
        )}
      </div>

      {/* background hint */}
      <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[#22d3ee]/20 to-transparent pointer-events-none" />
    </div>
  );
}
