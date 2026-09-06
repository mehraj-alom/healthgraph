import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';

export interface GraphNode {
  id: string;
  type: 'patient' | 'body_structure' | 'observation' | 'document' | 'timeline_event' | 'medication' | 'medication_taken_event';
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

export interface GraphNodeDetail {
  node: GraphNode;
  connected_nodes: GraphNode[];
  connected_edges: GraphEdge[];
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
      console.log('[HealthGraphNeo4j] raw nodes=', data.nodes?.length ?? 0, 'relationships=', data.edges?.length ?? 0);
      console.log('[HealthGraphNeo4j] relationship types:', JSON.stringify(edgesByType));
      console.log('[HealthGraph] patient=', nodesByType['patient'] ?? 0,
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
      console.log('[HealthGraphDetail] request=start nodeId=', nodeId);
      const http = await api.getClient().get<GraphNodeDetail>(url);
      console.log('[HealthGraphDetail] request=done status=', http.status, 'nodeId=', nodeId, 'loaded=true');
      return http.data as unknown as GraphNodeDetail;
    },
    enabled: !!nodeId,
    staleTime: 60 * 1000,
  });
}
