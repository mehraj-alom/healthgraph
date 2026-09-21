import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';

export type GraphNodeType =
  | 'patient'
  | 'body_structure'
  | 'observation'
  | 'document'
  | 'timeline_event'
  | 'medication'
  | 'medication_taken_event'
  // P0 Concept-lite (shared terminology reference, terminal for traversal).
  | 'concept'
  // P1 clinical graph expansion.
  | 'medication_request'
  | 'condition_occurrence'
  | 'visit'
  | 'patient_statement'
  | 'medication_canonical'
  // P2 measurement split + regimen versions.
  | 'measurement'
  | 'medication_version'
  // P3 longitudinal personal-health domains.
  | 'sleep_episode'
  | 'activity_event'
  | 'nutrition_intake'
  | 'food_scan'
  | 'food_entry'
  | 'ppg_measurement';

export interface GraphNode {
  id: string;
  type: GraphNodeType | string;
  label: string;
  properties: Record<string, any>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  relationship: string;
  derived?: boolean;
  properties?: Record<string, any>;
}

export interface HealthGraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  total_nodes: number;
  total_edges: number;
  has_more: boolean;
}

/** Provenance object attached to clinical answers (mirrors backend Citation). */
export interface GraphCitation {
  node_id?: string | null;
  observation_id?: string | null;
  event_id?: string | null;
  document_id?: string | null;
  page_number?: number | null;
  quote?: string | null;
  verification_status?: string | null;
  source_type?: string | null;
  evidence_level?: string | null;
  concept_display_name?: string | null;
  prescriber?: string | null;
  storage_url?: string | null;
}

/** Evidence tier badge. The UI must render these distinctly — AI-inferred
 *  content must never look equivalent to source facts. */
export type EvidenceBadge =
  | 'CONFIRMED / SOURCE-STATED'
  | 'USER-REPORTED'
  | 'SYSTEM-DERIVED'
  | 'AI-INFERRED'
  | 'UNVERIFIED'
  | 'SOURCE_FACT'
  | 'NORMALIZED'
  | string;

/** Rich node-detail contract (mirrors backend NodeDetailPayload). Absent
 *  fields are null — never invented. Rendered when present; the legacy
 *  property passthrough remains the fallback when detail is null. */
export interface NodeDetailPayload {
  summary?: string | null;
  canonical_name?: string | null;
  original_text?: string | null;
  structured_fields?: Record<string, any>;
  status?: Record<string, any>;
  verification?: Record<string, any>;
  timestamps?: Record<string, any>;
  relationships?: Array<{ predicate?: string; target_id?: string; target_type?: string; evidence_level?: string }>;
  source?: Record<string, any>;
  evidence?: Record<string, any>;
  confidence?: number | null;
  provenance?: Record<string, any>;
  evidence_badge?: EvidenceBadge | null;
  citations?: GraphCitation[];
  linked?: Record<string, { id: string; label: string }[]>;
}

export interface GraphNodeDetail {
  node: GraphNode;
  connected_nodes: GraphNode[];
  connected_edges: GraphEdge[];
  detail?: NodeDetailPayload | null;
}

export function useHealthGraph(options?: {
  depth?: number;
  limit?: number;
  category?: string;
}) {
  return useQuery<HealthGraphData>({
    queryKey: ['health-graph', options?.depth ?? 2, options?.limit ?? 100, options?.category ?? null],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (options?.depth) params.append('depth', String(options.depth));
      if (options?.limit) params.append('limit', String(options.limit));
      if (options?.category) params.append('category', options.category);

      const queryString = params.toString();
      const url = `/api/v1/health-graph${queryString ? `?${queryString}` : ''}`;

      const response = await api.get<HealthGraphData>(url);
      const data = response as unknown as HealthGraphData;

      // ── Diagnostics ──
      const nodesByType: Record<string, number> = {};
      (data.nodes ?? []).forEach((n) => { nodesByType[n.type] = (nodesByType[n.type] ?? 0) + 1; });
      const edgesByType: Record<string, number> = {};
      let derivedCount = 0;
      (data.edges ?? []).forEach((e) => { edgesByType[e.relationship] = (edgesByType[e.relationship] ?? 0) + 1; if (e.derived) derivedCount++; });
      if (__DEV__) console.log('[HealthGraphNeo4j] raw nodes=', data.nodes?.length ?? 0, 'relationships=', data.edges?.length ?? 0);
      if (__DEV__) console.log('[HealthGraphNeo4j] relationship types:', JSON.stringify(edgesByType));
      if (__DEV__) console.log('[HealthGraph] patient=', nodesByType['patient'] ?? 0,
        'body_structure=', nodesByType['body_structure'] ?? 0,
        'observation=', nodesByType['observation'] ?? 0,
        'document=', nodesByType['document'] ?? 0,
        'timeline_event=', nodesByType['timeline_event'] ?? 0);

      return data;
    },
    staleTime: 30 * 1000, // 30 seconds
    retry: 2,
  });
}

export function useGraphNodeDetail(nodeId: string | null) {
  return useQuery<GraphNodeDetail>({
    queryKey: ['health-graph-node', nodeId],
    queryFn: async () => {
      const url = `/api/v1/health-graph/${encodeURIComponent(nodeId!)}`;
      if (__DEV__) console.log('[HealthGraphDetail] request=start nodeId=', nodeId);
      const http = await api.getClient().get<GraphNodeDetail>(url);
      if (__DEV__) console.log('[HealthGraphDetail] request=done status=', http.status, 'nodeId=', nodeId, 'loaded=true');
      return http.data as unknown as GraphNodeDetail;
    },
    enabled: !!nodeId,
    staleTime: 60 * 1000,
  });
}
