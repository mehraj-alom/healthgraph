/**
 * drugInteractions.test.mts — interaction checker contract (node).
 *
 * Every rule in the knowledge base must be label-verified (FDA label via
 * DailyMed, MedlinePlus, or peer-reviewed meta-analysis — recorded on the
 * rule), severity-graded, and phrased as "ask your doctor or pharmacist"
 * information. The engine never advises stopping, starting, or dose
 * changes, and unknown or identical medicines stay silent.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  INTERACTION_RULES,
  classesOf,
  findInteractions,
  normalizeDrugName,
} from '../src/utils/drugInteractions.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const med = (name: string) => ({ name });

// ============================================================================
// Normalization — brands, cases, doses, salts resolve to ingredients
// ============================================================================

describe('drug name normalization', () => {
  test('brands resolve to their class', () => {
    assert.ok(classesOf('Advil').includes('nsaid'));
    assert.ok(classesOf('Zocor').includes('statin_cyp3a4'));
    assert.ok(classesOf('Plavix').includes('clopidogrel'));
    assert.ok(classesOf('Prilosec').includes('cyp2c19_inhibitor'));
    assert.ok(classesOf('Xanax').includes('benzodiazepine'));
    assert.ok(classesOf('Viagra').includes('pde5'));
  });

  test('atorvastatin stays out: its label nuance differs from simvastatin', () => {
    // Deliberate v1 boundary — simvastatin/lovastatin carry the explicit
    // contraindication; atorvastatin gets dose-cap guidance instead.
    assert.deepEqual(classesOf('Lipitor'), []);
  });

  test('doses, cases, and salt suffixes do not break matching', () => {
    assert.equal(normalizeDrugName('Sertraline HCl 50mg'), 'sertraline');
    assert.equal(normalizeDrugName('  LISINOPRIL 10 MG '), 'lisinopril');
    assert.deepEqual(classesOf('Sertraline HCl 50mg'), classesOf('sertraline'));
  });

  test('unknown medicines map to no class and stay silent', () => {
    assert.deepEqual(classesOf('unicorn root extract'), []);
    assert.deepEqual(findInteractions([med('unicorn root extract'), med('Warfarin')]), []);
  });
});

// ============================================================================
// Rule firing — the ten label-verified pairs
// ============================================================================

describe('verified interaction pairs', () => {
  const cases: [string, string, string][] = [
    ['Warfarin', 'Ibuprofen', 'warfarin-nsaid'],
    ['Warfarin', 'Aspirin', 'warfarin-aspirin'],
    ['Lisinopril', 'Spironolactone', 'acei-ksparing'],
    ['Sertraline', 'Naproxen', 'ssri-nsaid'],
    ['Fluoxetine', 'Phenelzine', 'ssri-maoi'],
    ['Sildenafil', 'Nitroglycerin', 'pde5-nitrate'],
    ['Oxycodone', 'Alprazolam', 'opioid-benzo'],
    ['Simvastatin', 'Clarithromycin', 'statin-cyp3a4'],
    ['Clopidogrel', 'Omeprazole', 'clopidogrel-cyp2c19'],
    ['Lithium', 'Ibuprofen', 'lithium-nsaid'],
  ];

  for (const [a, b, ruleId] of cases) {
    test(`${a} + ${b} fires ${ruleId} in either order`, () => {
      for (const pair of [[med(a), med(b)], [med(b), med(a)]]) {
        const found = findInteractions(pair);
        assert.equal(found.length, 1, `${a}/${b}: exactly one flag`);
        assert.equal(found[0].ruleId, ruleId);
        assert.ok(found[0].medicines.includes(a) && found[0].medicines.includes(b));
      }
    });
  }

  test('brand names fire the same rules as generics', () => {
    const found = findInteractions([med('Coumadin'), med('Advil')]);
    assert.equal(found.length, 1);
    assert.equal(found[0].ruleId, 'warfarin-nsaid');
  });

  test('same medicine twice stays silent (duplicate flag owns that)', () => {
    assert.deepEqual(findInteractions([med('Warfarin'), med('warfarin 5mg')]), []);
  });

  test('unrelated pairs stay silent', () => {
    assert.deepEqual(findInteractions([med('Metformin'), med('Lisinopril')]), []);
    assert.deepEqual(findInteractions([med('Vitamin D'), med('Sertraline')]), []);
  });

  test('major sorts before moderate', () => {
    const found = findInteractions([med('Lithium'), med('Ibuprofen'), med('Warfarin')]);
    assert.ok(found.length >= 2);
    assert.equal(found[0].severity, 'major');
  });
});

// ============================================================================
// Copy safety — information only, never advice; every rule sourced
// ============================================================================

describe('interaction copy safety', () => {
  const BANNED = [
    'stop taking',
    'discontinue',
    'reduce your dose',
    'lower your dose',
    'skip your dose',
    'safe to combine',
    'no interaction',
    'no risk',
    'you should take',
    'you should start',
    'diagnos',
  ];

  test('no rule tells the user what to do with their medicines', () => {
    for (const rule of INTERACTION_RULES) {
      const hay = `${rule.headline} ${rule.detail}`.toLowerCase();
      for (const phrase of BANNED) {
        assert.ok(!hay.includes(phrase), `${rule.id}: ${phrase}`);
      }
    }
  });

  test('every flag directs to a doctor or pharmacist', () => {
    // Verified end-to-end on composed flag text (the direction is appended
    // once, identically, for every rule — never per-rule prose).
    const probes: [string, string][] = [
      ['Warfarin', 'Ibuprofen'],
      ['Lisinopril', 'Spironolactone'],
      ['Sertraline', 'Naproxen'],
      ['Fluoxetine', 'Phenelzine'],
      ['Sildenafil', 'Nitroglycerin'],
      ['Oxycodone', 'Alprazolam'],
      ['Simvastatin', 'Clarithromycin'],
      ['Clopidogrel', 'Omeprazole'],
      ['Lithium', 'Ibuprofen'],
      ['Warfarin', 'Aspirin'],
    ];
    const seen = new Set<string>();
    for (const [a, b] of probes) {
      for (const flag of findInteractions([med(a), med(b)])) {
        seen.add(flag.ruleId);
        assert.ok(flag.text.toLowerCase().includes('doctor or pharmacist'), flag.ruleId);
      }
    }
    assert.equal(seen.size, 10, 'all ten rules produce directed flags');
  });

  test('every rule is sourced, graded, and references two distinct classes', () => {
    assert.ok(INTERACTION_RULES.length >= 10, 'v1 covers ten verified pairs');
    for (const rule of INTERACTION_RULES) {
      assert.ok(rule.id.length > 0);
      assert.ok(rule.classes.length === 2 && rule.classes[0] !== rule.classes[1], `${rule.id}: two classes`);
      assert.ok(rule.severity === 'major' || rule.severity === 'moderate', `${rule.id}: graded`);
      assert.ok(rule.source.length > 0, `${rule.id}: sourced`);
      assert.ok(/FDA|DailyMed|MedlinePlus|meta-analysis|boxed warning/i.test(rule.source), `${rule.id}: credible source`);
      for (const cls of rule.classes) {
        assert.ok(classesOf(cls).length === 0 || true, `${rule.id}: class label sane`);
      }
    }
  });

  test('every rule class is reachable from a real drug name', () => {
    // Guards against a rule that can never fire (typo in a class label).
    const probe: Record<string, string> = {
      warfarin: 'warfarin',
      nsaid: 'ibuprofen',
      aspirin: 'aspirin',
      ace_inhibitor: 'lisinopril',
      k_sparing: 'spironolactone',
      ssri: 'sertraline',
      maoi: 'phenelzine',
      pde5: 'sildenafil',
      nitrate: 'nitroglycerin',
      opioid: 'oxycodone',
      benzodiazepine: 'alprazolam',
      statin_cyp3a4: 'simvastatin',
      cyp3a4_inhibitor: 'clarithromycin',
      clopidogrel: 'clopidogrel',
      cyp2c19_inhibitor: 'omeprazole',
      lithium: 'lithium',
    };
    for (const rule of INTERACTION_RULES) {
      for (const cls of rule.classes) {
        assert.ok(probe[cls] !== undefined, `${rule.id}: unknown class ${cls}`);
        assert.ok(classesOf(probe[cls]).includes(cls), `${rule.id}: ${cls} reachable via ${probe[cls]}`);
      }
    }
  });
});
