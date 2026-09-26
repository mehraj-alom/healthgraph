/**
 * diaryViewModel.test.mts — DiaryDay pages from existing timeline items.
 *
 * Pure view-model contract (no UI, no DB):
 * - days group newest-first with stable dayKey identity
 * - Today / Yesterday / weekday labels (injected now)
 * - hero primary follows report-worthiness (vital > meds > records…)
 * - counts + strip summaries derive from real items only
 * - empty input → empty journal (no invented pages)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDiaryDays,
  labelDay,
  stripSummary,
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

describe('labelDay', () => {
  it('labels Today / Yesterday / weekday deterministically', () => {
    assert.equal(labelDay('2026-09-26', NOW).context, 'Today');
    assert.equal(labelDay('2026-09-25', NOW).context, 'Yesterday');
    assert.equal(labelDay('2026-09-24', NOW).context, 'Thursday');
  });

  it('engraves uppercase day-month titles', () => {
    assert.equal(labelDay('2026-09-26', NOW).title, '26 SEP');
    assert.equal(labelDay('2026-06-25', NOW).title, '25 JUN');
  });
});

describe('buildDiaryDays', () => {
  it('empty input yields an empty journal (no invented pages)', () => {
    assert.deepEqual(buildDiaryDays([], NOW), []);
  });

  it('groups items per day newest-first with counts', () => {
    const days = buildDiaryDays(
      [
        {
          dayKey: '2026-09-26',
          items: [
            item({ key: 'a', category: 'vital', title: 'Heart rate', detail: '72 BPM', icon: '♥' }),
            item({ key: 'b', category: 'medication', title: 'Aspirin', detail: '100mg' }),
          ],
        },
        { dayKey: '2026-09-25', items: [item({ key: 'c', category: 'symptom', title: 'Headache' })] },
      ],
      NOW,
    );
    assert.equal(days.length, 2);
    assert.equal(days[0].dayKey, '2026-09-26');
    assert.equal(days[0].total, 2);
    assert.deepEqual(days[0].counts, { vital: 1, medication: 1 });
    assert.equal(days[1].context, 'Yesterday');
  });

  it('hero primary prefers vitals over meds over logs', () => {
    const days = buildDiaryDays(
      [
        {
          dayKey: '2026-09-26',
          items: [
            item({ key: 'a', category: 'daily_log', title: 'Daily log' }),
            item({ key: 'b', category: 'medication', title: 'Aspirin' }),
            item({ key: 'c', category: 'vital', title: 'Heart rate', detail: '72 BPM' }),
          ],
        },
      ],
      NOW,
    );
    assert.equal(days[0].primary?.key, 'c');
    assert.equal(days[0].secondary?.key, 'b');
  });

  it('side box is empty without a runner-up', () => {
    const days = buildDiaryDays(
      [{ dayKey: '2026-09-26', items: [item({ key: 'a', category: 'vital', title: 'HR' })] }],
      NOW,
    );
    assert.equal(days[0].primary?.key, 'a');
    assert.equal(days[0].secondary, null);
  });

  it('single-item day still forms a page', () => {
    const days = buildDiaryDays(
      [{ dayKey: '2026-09-20', items: [item({ key: 'x', category: 'medical_record', title: 'Blood report', documentId: 'd1' })] }],
      NOW,
    );
    assert.equal(days.length, 1);
    assert.equal(days[0].primary?.documentId, 'd1');
    assert.equal(days[0].total, 1);
  });
});

describe('stripSummary', () => {
  it('leads with the hero, then compact category counts', () => {
    const [day] = buildDiaryDays(
      [
        {
          dayKey: '2026-09-26',
          items: [
            item({ key: 'a', category: 'vital', title: 'Heart rate', detail: '72 BPM', icon: '♥' }),
            item({ key: 'b', category: 'medication', title: 'A' }),
            item({ key: 'c', category: 'medication', title: 'B' }),
            item({ key: 'd', category: 'daily_log', title: 'Log' }),
          ],
        },
      ],
      NOW,
    );
    const strip = stripSummary(day);
    assert.ok(strip[0].includes('72 BPM'), 'hero first');
    assert.ok(strip.some((p) => p.includes('2 meds')), 'med count compacted');
    assert.ok(strip.length <= 3, 'bounded strip');
  });
});
