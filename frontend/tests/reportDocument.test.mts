/**
 * reportDocument.test.mts — Daily Health Report view-model contract.
 *
 * Pure grouping (no UI, no DB):
 * - items land in the right sections, day order preserved per section
 * - empty sections are omitted (never fabricated); empty day → no sections
 * - summary line counts real rows only
 * - clock/slot formatters never throw on bad input
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReportDocument,
  formatClock,
  formatSlot,
} from '../src/screens/Timeline/reportDocument.ts';
import {
  buildDiaryDays,
  type DiaryItemInput,
} from '../src/screens/Timeline/diary.ts';

const NOW = new Date('2026-09-26T12:00:00');

function item(over: Partial<DiaryItemInput> & { key: string }): DiaryItemInput {
  return {
    time: '8:00 AM',
    category: 'other',
    title: 'Item',
    detail: '',
    icon: '',
    documentId: null,
    node: null,
    ...over,
  };
}

function day(
  dayKey: string,
  items: DiaryItemInput[],
) {
  const [d] = buildDiaryDays([{ dayKey, items }], NOW);
  return d;
}

describe('buildReportDocument', () => {
  it('routes each category to its section in day order', () => {
    const d = day('2026-09-26', [
      item({ key: 'a', category: 'vital', title: 'Heart rate', detail: '72 BPM' }),
      item({ key: 'b', category: 'symptom', title: 'Headache', detail: 'Headache · 4/10' }),
      item({ key: 'c', category: 'medication', title: 'Medication taken', detail: 'Aspirin' }),
      item({ key: 'd', category: 'daily_log', title: 'Daily log', detail: 'Sleep 7h' }),
      item({ key: 'e', category: 'medical_record', title: 'Blood report', documentId: 'doc-1' }),
      item({ key: 'f', category: 'observation', title: 'Mole check', detail: 'Stable' }),
      item({ key: 'g', category: 'pain', title: 'Pain', detail: 'Back · 3/10' }),
    ]);
    const doc = buildReportDocument(d);
    assert.deepEqual(
      doc.sections.map((s) => s.key),
      ['symptoms', 'pain', 'measurements', 'medications', 'daily_logs', 'records', 'observations'],
    );
    assert.equal(doc.sections[0].rows[0].title, 'Headache');
    assert.equal(doc.sections[2].rows[0].detail, '72 BPM');
    assert.equal(doc.sections[5].rows[0].documentId, 'doc-1');
    assert.equal(doc.total, 7);
  });

  it('omits empty sections and summarizes real counts only', () => {
    const d = day('2026-09-20', [
      item({ key: 'x', category: 'medical_record', title: 'Blood report', documentId: 'd1' }),
    ]);
    const doc = buildReportDocument(d);
    assert.deepEqual(doc.sections.map((s) => s.key), ['records']);
    assert.equal(doc.summaryLine, '1 entry · 1 record');
  });

  it('empty day yields no sections and no summary', () => {
    const d = day('2026-09-20', []);
    const doc = buildReportDocument(d);
    assert.deepEqual(doc.sections, []);
    assert.equal(doc.summaryLine, '');
    assert.equal(doc.total, 0);
  });

  it('keeps multi-item order inside a section', () => {
    const d = day('2026-09-26', [
      item({ key: 'a', category: 'vital', title: 'First', detail: '1' }),
      item({ key: 'b', category: 'vital', title: 'Second', detail: '2' }),
    ]);
    const doc = buildReportDocument(d);
    assert.deepEqual(doc.sections[0].rows.map((r) => r.title), ['First', 'Second']);
    assert.equal(doc.summaryLine, '2 entries · 2 measurements');
  });
});

describe('formatters', () => {
  it('formatClock renders clock time or null', () => {
    assert.equal(formatClock('2026-09-26T08:42:00.000Z')?.includes(':'), true);
    assert.equal(formatClock(null), null);
    assert.equal(formatClock('not-a-date'), null);
    assert.equal(formatClock(''), null);
  });

  it('formatSlot converts 24h slots, passes through garbage', () => {
    assert.equal(formatSlot('08:00'), '8:00 AM');
    assert.equal(formatSlot('20:30'), '8:30 PM');
    assert.equal(formatSlot('12:00'), '12:00 PM');
    assert.equal(formatSlot('morning'), 'morning');
  });
});
