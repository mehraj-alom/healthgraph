/**
 * deviceNodes.ts — device-local heart nodes for the HealthGraph canvas.
 *
 * The server graph only contains synced measurements. Unsynced camera
 * readings (pending rows) would otherwise be invisible until the next
 * sync + server recompute. This projection exposes them as genuine
 * ppg_measurement nodes marked device_local — positioned by the existing
 * fallback bucket, needing NO edges (fabricating edges is forbidden).
 *
 * Dedupe is structural, not heuristic: callers pass ONLY pending rows,
 * and node ids carry a `local-` prefix that can never collide with server
 * UUIDs. Once a row syncs it leaves the pending set, so the server node
 * (when projected) never doubles it. Zero imports: node-testable.
 */

import type { GraphNode } from '@/hooks/useHealthGraph';
import type { LocalPpgMeasurement } from '@/db/queries/ppg';
import type { LocalRppgMeasurement } from '@/db/queries/rppg';

export interface DeviceHeartRow {
  measurement_id: string;
  measured_at: string;
  heart_rate_bpm: number | null;
}

const MAX_DEVICE_NODES = 20;

function toNode(
  row: DeviceHeartRow,
  prefix: 'ppg' | 'rppg',
): GraphNode | null {
  const bpm = row.heart_rate_bpm;
  if (typeof bpm !== 'number' || !Number.isFinite(bpm)) return null;
  const at = String(row.measured_at ?? '');
  if (!at) return null;
  const face = prefix === 'rppg';
  return {
    id: `local-${prefix}-${row.measurement_id}`,
    type: 'ppg_measurement',
    label: 'Heart rate',
    properties: {
      heart_rate_bpm: bpm,
      measured_at: at,
      event_time: at,
      method: face ? 'face' : 'fingertip',
      measurement_type: face ? 'face_rppg' : 'camera_ppg',
      device_local: true,
      sync_status: 'pending',
    },
  };
}

/**
 * Build device-local nodes from PENDING camera rows (newest first, capped).
 * Returns nodes only — never edges. Null/non-finite BPM rows are refused,
 * mirroring the persistence gates (failed runs never reach the graph).
 */
export function buildDeviceHeartNodes(
  ppgRows: readonly DeviceHeartRow[],
  rppgRows: readonly DeviceHeartRow[],
): GraphNode[] {
  const out: GraphNode[] = [];
  for (const row of ppgRows) {
    const node = toNode(row, 'ppg');
    if (node) out.push(node);
  }
  for (const row of rppgRows) {
    const node = toNode(row, 'rppg');
    if (node) out.push(node);
  }
  out.sort((a, b) => {
    const ta = String(a.properties?.measured_at ?? '');
    const tb = String(b.properties?.measured_at ?? '');
    return ta < tb ? 1 : ta > tb ? -1 : 0;
  });
  return out.slice(0, MAX_DEVICE_NODES);
}

/** True for nodes produced by buildDeviceHeartNodes (never server nodes). */
export function isDeviceHeartNode(node: GraphNode | null | undefined): boolean {
  if (!node) return false;
  return (
    node.type === 'ppg_measurement' &&
    node.properties?.device_local === true &&
    typeof node.id === 'string' &&
    node.id.startsWith('local-')
  );
}

export type { LocalPpgMeasurement, LocalRppgMeasurement };
