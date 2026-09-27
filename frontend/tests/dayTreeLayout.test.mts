/**
 * dayTreeLayout.test.mts — inverted day-tree contracts.
 *
 * Patient at top → day markers newest-first → each day's entries beneath.
 * Undated nodes form a satellite annex. Day markers/edges are layout-only
 * (never persisted). Deterministic across runs.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  compute3DLayout,
  dayLabel,
  nodeDayKey,
  type GraphEdge,
  type GraphNode,
} from '../src/services/graph/dayTreeLayout.ts';

function node(id: string, type: string, properties: Record<string, unknown> = {}): GraphNode {
  return { id, type, label: id, properties } as GraphNode;
}

const BERLIN = [
  node('patient-1', 'patient'),
  node('ppg-1', 'measurement', { measured_at: '2026-09-26T08:10:00Z', value: 72 }),
  node('med-1', 'medication_taken_event', { event_time: '2026-09-26T09:00:00Z' }),
  node('meal-1', 'nutrition_intake', { log_date: '2026-09-25' }),
  node('doc-1', 'document', { created_at: '2026-09-25T12:00:00Z' }),
  node('body-1', 'body_structure', { category: 'Heart' }),
];

describe('nodeDayKey', () => {
  it('reads every backend date key, prefers event_time', () => {
    assert.equal(nodeDayKey(node('a', 'x', { event_time: '2026-09-26T10:00:00Z' })), '2026-09-26');
    assert.equal(nodeDayKey(node('b', 'x', { measured_at: '2026-06-25T10:00:00Z' })), '2026-06-25');
    assert.equal(nodeDayKey(node('c', 'x', { log_date: '2026-09-25' })), '2026-09-25');
    assert.equal(
      nodeDayKey(node('d', 'x', { event_time: '2026-09-20T00:00:00Z', date: '2026-09-21' })),
      '2026-09-20',
    );
  });

  it('returns null for missing/garbage dates', () => {
    assert.equal(nodeDayKey(node('a', 'x', {})), null);
    assert.equal(nodeDayKey(node('b', 'x', { event_time: 'not-a-date' })), null);
    assert.equal(nodeDayKey(node('c', 'x', { event_time: 12345 })), null);
  });

  it('labels days like the journal', () => {
    assert.equal(dayLabel('2026-06-25'), '25 JUN');
    assert.equal(dayLabel('2026-09-26'), '26 SEP');
  });
});

describe('compute3DLayout day tree', () => {
  it('patient on top, days newest-first, items beneath their day', () => {
    const out = compute3DLayout(BERLIN, []);
    const pos = out.positions;
    const patient = pos.get('patient-1')!;
    const day26 = pos.get('__day:2026-09-26')!;
    const day25 = pos.get('__day:2026-09-25')!;
    assert.ok(patient.y > day26.y && patient.y > day25.y, 'patient above days');
    assert.ok(day26.x < day25.x, 'newest day first (left)');
    assert.equal(day26.y, day25.y, 'day markers share a row');
    for (const id of ['ppg-1', 'med-1']) {
      assert.ok(pos.get(id)!.y < day26.y, `${id} beneath its day`);
    }
    for (const id of ['meal-1', 'doc-1']) {
      assert.ok(pos.get(id)!.y < day25.y, `${id} beneath its day`);
    }
    // Items fan horizontally around their day marker.
    assert.ok(Math.abs(pos.get('ppg-1')!.x - day26.x) < 6, 'items stay near their day');
  });

  it('emits layout-only day nodes + tree edges (never touching real edges)', () => {
    const out = compute3DLayout(BERLIN, []);
    assert.equal(out.dayNodes.length, 2);
    for (const d of out.dayNodes) {
      assert.equal(d.type, 'date');
      assert.ok(d.id.startsWith('__day:'));
    }
    const rels = out.dayEdges.map((e) => e.relationship).sort();
    assert.ok(rels.includes('HAS_DAY') && rels.includes('ON_DAY'));
    assert.ok(out.dayEdges.some((e) => e.source === 'patient-1'));
    assert.equal(out.dayEdges.filter((e) => e.target === 'ppg-1').length, 1);
  });

  it('undated anatomy forms a satellite annex, not the tree', () => {
    const out = compute3DLayout(BERLIN, []);
    assert.ok(!out.dayNodes.some((d) => d.id.includes('body-1')));
    assert.ok(out.positions.has('body-1'), 'satellite still positioned');
    const body = out.positions.get('body-1')!;
    const day26 = out.positions.get('__day:2026-09-26')!;
    assert.ok(body.x < day26.x, 'annex sits left of the day row');
  });

  it('empty and single-day graphs stay finite and centered', () => {
    const empty = compute3DLayout([], []);
    assert.equal(empty.dayNodes.length, 0);
    assert.ok(Number.isFinite(empty.radius));
    const single = compute3DLayout([node('p', 'patient'), node('m', 'measurement', { measured_at: '2026-09-26T08:00:00Z' })], []);
    assert.equal(single.dayNodes.length, 1);
    assert.ok(single.positions.get('m')!.y < single.positions.get('__day:2026-09-26')!.y);
  });

  it('layout is deterministic across runs', () => {
    const a = compute3DLayout(BERLIN, []);
    const b = compute3DLayout(BERLIN, []);
    for (const [id, p] of a.positions) {
      const q = b.positions.get(id)!;
      assert.deepEqual([p.x, p.y, p.z], [q.x, q.y, q.z]);
    }
  });
});
