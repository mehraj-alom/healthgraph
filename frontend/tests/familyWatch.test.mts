/**
 * familyWatch.test.mts — user-invited family missed-dose alerts.
 *
 * RED: familyWatch.ts does not exist yet.
 *
 * Model (deliberately local-first): the patient invites a contact
 * (name + phone, device-only) and links medications. When a linked dose
 * is missed, the app shows a card on the patient's phone with a
 * patient-tapped "notify" action (system SMS composer). No server,
 * no push tokens, no automatic delivery — the invite IS the consent,
 * removable by deleting the contact.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWatchMessage,
  missedDoses,
  normalizeWatchContact,
  normalizeWatchLink,
} from '../src/services/familyWatch.ts';

describe('normalizeWatchContact', () => {
  it('accepts a name and phone', () => {
    const c = normalizeWatchContact({ name: 'Mira', phone: '+14155552671' });
    assert.equal(c.name, 'Mira');
    assert.equal(c.phone, '+14155552671');
  });
  it('rejects junk', () => {
    assert.throws(() => normalizeWatchContact({ name: '', phone: '+14155552671' }));
    assert.throws(() => normalizeWatchContact({ name: 'Mira', phone: 'abc' }));
    assert.throws(() => normalizeWatchContact({ name: 'Mira', phone: '12' }));
  });
});

describe('normalizeWatchLink', () => {
  it('links a contact to medication ids', () => {
    const l = normalizeWatchLink({ contactId: 'c1', medicationIds: ['m1', 'm2'] });
    assert.deepEqual(l.medicationIds, ['m1', 'm2']);
  });
  it('rejects empty links and junk ids', () => {
    assert.throws(() => normalizeWatchLink({ contactId: 'c1', medicationIds: [] }));
    assert.throws(() => normalizeWatchLink({ contactId: '', medicationIds: ['m1'] }));
    assert.throws(() => normalizeWatchLink({ contactId: 'c1', medicationIds: [''] }));
  });
});

describe('missedDoses', () => {
  const schedule = [
    { medicationId: 'm1', medicationName: 'Metformin', day: '2026-10-03', time: '08:00' },
    { medicationId: 'm1', medicationName: 'Metformin', day: '2026-10-03', time: '20:00' },
  ];
  it('flags slots past grace with no taken event', () => {
    const missed = missedDoses(schedule, [], '2026-10-03T10:00:00', 60);
    assert.equal(missed.length, 1);
    assert.equal(missed[0].medicationId, 'm1');
    assert.equal(missed[0].time, '08:00');
  });
  it('ignores taken slots and future slots', () => {
    const missed = missedDoses(
      schedule,
      [{ medicationId: 'm1', day: '2026-10-03', time: '08:00' }],
      '2026-10-03T10:00:00',
      60,
    );
    assert.equal(missed.length, 0);
  });
  it('respects the grace window', () => {
    const missed = missedDoses(schedule, [], '2026-10-03T08:30:00', 60);
    assert.equal(missed.length, 0);
  });
});

describe('buildWatchMessage', () => {
  it('names the dose, gives no medical advice', () => {
    const msg = buildWatchMessage({
      contactName: 'Mira',
      medicationName: 'Metformin',
      time: '08:00',
    });
    assert.match(msg, /Mira/);
    assert.match(msg, /Metformin/);
    assert.match(msg, /08:00/);
    assert.match(msg, /not automatic/);
    const lower = msg.toLowerCase();
    assert.doesNotMatch(lower, /take |dose|mg\b|double|skip/);
  });
});
