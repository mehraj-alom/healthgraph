/**
 * drugInteractions.ts — label-verified drug interaction checker (v1).
 *
 * Ten interaction pairs, each verified against an FDA label (via DailyMed),
 * MedlinePlus, or a peer-reviewed meta-analysis — the source is recorded on
 * every rule. Matching is class-based over normalized ingredient names
 * (brands, doses, and salt suffixes resolve to ingredients).
 *
 * Deliberate v1 boundaries (documented, tested):
 * - atorvastatin is NOT in the statin class: its label carries dose-cap
 *   guidance where simvastatin/lovastatin carry an explicit
 *   contraindication, and this checker only fires label-grade pairs;
 * - Z-drugs (zolpidem etc.) are not in the benzodiazepine class;
 * - thiazides are not paired with lithium (verified pair is NSAIDs only).
 *
 * Copy contract: information only, never advice. No rule may tell the user
 * to stop, start, skip, or dose-adjust anything; every flag directs to a
 * doctor or pharmacist. Pinned by tests in drugInteractions.test.mts.
 *
 * Zero value-imports (type-only): safe for node unit tests.
 */
import type { Medication } from '@/types';
import type { SafetyFlag } from './medicationAdherence';

export type InteractionSeverity = 'major' | 'moderate';

export interface InteractionRule {
  id: string;
  classes: [string, string];
  severity: InteractionSeverity;
  headline: string;
  detail: string;
  source: string;
}

export interface DrugInteraction {
  ruleId: string;
  medicines: [string, string];
  severity: InteractionSeverity;
  text: string;
}

const ASK_PROFESSIONAL = 'Ask your doctor or pharmacist about this combination before making any change.';

export const INTERACTION_RULES: InteractionRule[] = [
  {
    id: 'warfarin-nsaid',
    classes: ['warfarin', 'nsaid'],
    severity: 'major',
    headline: 'Bleeding risk',
    detail:
      'Blood thinners plus NSAID painkillers can raise bleeding risk well above either alone — FDA labels describe the combined effect on stomach bleeding as synergistic. Watch for unusual bruising, nosebleeds, or black stools and bring them up promptly.',
    source: 'FDA ibuprofen label via DailyMed',
  },
  {
    id: 'warfarin-aspirin',
    classes: ['warfarin', 'aspirin'],
    severity: 'major',
    headline: 'Bleeding risk',
    detail:
      'Blood thinners plus aspirin or other antiplatelet medicines raise bleeding risk; studies show meaningfully higher bleeding rates for the combination than for either alone.',
    source: 'Warfarin antiplatelet meta-analysis, Br J Clin Pharmacol 2021',
  },
  {
    id: 'acei-ksparing',
    classes: ['ace_inhibitor', 'k_sparing'],
    severity: 'major',
    headline: 'High potassium risk',
    detail:
      'ACE inhibitors plus potassium-sparing diuretics can drive potassium to dangerous levels (severe hyperkalemia); FDA labels urge extreme caution and potassium monitoring with this combination.',
    source: 'FDA spironolactone label via DailyMed',
  },
  {
    id: 'ssri-nsaid',
    classes: ['ssri', 'nsaid'],
    severity: 'major',
    headline: 'Bleeding risk',
    detail:
      'Antidepressants of the SSRI type plus NSAID painkillers raise the risk of stomach bleeding several-fold versus either alone; labels advise telling your prescriber about both.',
    source: 'Sertraline guide via DailyMed; GI-bleed meta-analysis (PubMed)',
  },
  {
    id: 'ssri-maoi',
    classes: ['ssri', 'maoi'],
    severity: 'major',
    headline: 'Serotonin syndrome — contraindicated combination',
    detail:
      'SSRI antidepressants with MAO inhibitors can trigger serotonin syndrome, a potentially life-threatening reaction; FDA labels contraindicate the combination, including within 14 days of stopping either.',
    source: 'FDA SSRI labels via DailyMed',
  },
  {
    id: 'pde5-nitrate',
    classes: ['pde5', 'nitrate'],
    severity: 'major',
    headline: 'Dangerously low blood pressure — contraindicated',
    detail:
      'Erectile-dysfunction medicines of the PDE-5 type with nitrates in any form can drop blood pressure to dangerous levels; FDA labels contraindicate every such combination.',
    source: 'FDA sildenafil + nitroglycerin labels',
  },
  {
    id: 'opioid-benzo',
    classes: ['opioid', 'benzodiazepine'],
    severity: 'major',
    headline: 'Breathing risk — boxed-warning combination',
    detail:
      'Opioid painkillers with benzodiazepine sedatives carry FDA boxed warnings for extreme sleepiness, slowed or stopped breathing, coma, and death — prescribers are told to use exceptional caution.',
    source: 'FDA boxed warnings 2016/2020',
  },
  {
    id: 'statin-cyp3a4',
    classes: ['statin_cyp3a4', 'cyp3a4_inhibitor'],
    severity: 'major',
    headline: 'Muscle injury risk — contraindicated combination',
    detail:
      'Simvastatin or lovastatin with strong CYP3A4 blockers (certain antibiotics and antifungals) can raise statin levels and cause muscle injury up to rhabdomyolysis; FDA labels contraindicate the combination.',
    source: 'FDA simvastatin (Zocor) label via DailyMed',
  },
  {
    id: 'clopidogrel-cyp2c19',
    classes: ['clopidogrel', 'cyp2c19_inhibitor'],
    severity: 'major',
    headline: 'Weaker blood-thinner effect',
    detail:
      'Omeprazole and esomeprazole blunt the activation of clopidogrel, leaving its anti-clotting effect significantly reduced; FDA labels say to avoid the combination.',
    source: 'FDA clopidogrel (Plavix) label via DailyMed',
  },
  {
    id: 'lithium-nsaid',
    classes: ['lithium', 'nsaid'],
    severity: 'moderate',
    headline: 'Lithium level can rise',
    detail:
      'NSAID painkillers can raise lithium blood levels by slowing its clearance; labels advise watching for signs of lithium toxicity when the two overlap.',
    source: 'FDA naproxen/esomeprazole (Vimovo) label',
  },
];

/** Generic/brand ingredient → interaction class. */
const INGREDIENT_CLASS: Record<string, string> = {
  // Anticoagulant / antiplatelet
  warfarin: 'warfarin',
  coumadin: 'warfarin',
  jantoven: 'warfarin',
  aspirin: 'aspirin',
  acetylsalicylic: 'aspirin',
  bayer: 'aspirin',
  ecotrin: 'aspirin',
  bufferin: 'aspirin',
  // NSAIDs
  ibuprofen: 'nsaid',
  advil: 'nsaid',
  motrin: 'nsaid',
  nurofen: 'nsaid',
  naproxen: 'nsaid',
  aleve: 'nsaid',
  naprosyn: 'nsaid',
  diclofenac: 'nsaid',
  voltaren: 'nsaid',
  voltarol: 'nsaid',
  cataflam: 'nsaid',
  celecoxib: 'nsaid',
  celebrex: 'nsaid',
  meloxicam: 'nsaid',
  mobic: 'nsaid',
  indomethacin: 'nsaid',
  indocin: 'nsaid',
  ketorolac: 'nsaid',
  toradol: 'nsaid',
  // ACE inhibitors
  lisinopril: 'ace_inhibitor',
  zestril: 'ace_inhibitor',
  prinivil: 'ace_inhibitor',
  enalapril: 'ace_inhibitor',
  vasotec: 'ace_inhibitor',
  ramipril: 'ace_inhibitor',
  altace: 'ace_inhibitor',
  benazepril: 'ace_inhibitor',
  lotensin: 'ace_inhibitor',
  captopril: 'ace_inhibitor',
  capoten: 'ace_inhibitor',
  fosinopril: 'ace_inhibitor',
  monopril: 'ace_inhibitor',
  quinapril: 'ace_inhibitor',
  accupril: 'ace_inhibitor',
  perindopril: 'ace_inhibitor',
  coversyl: 'ace_inhibitor',
  aceon: 'ace_inhibitor',
  // Potassium-sparing diuretics
  spironolactone: 'k_sparing',
  aldactone: 'k_sparing',
  eplerenone: 'k_sparing',
  inspra: 'k_sparing',
  amiloride: 'k_sparing',
  midamor: 'k_sparing',
  triamterene: 'k_sparing',
  dyrenium: 'k_sparing',
  // SSRIs
  fluoxetine: 'ssri',
  prozac: 'ssri',
  sertraline: 'ssri',
  zoloft: 'ssri',
  paroxetine: 'ssri',
  paxil: 'ssri',
  citalopram: 'ssri',
  celexa: 'ssri',
  escitalopram: 'ssri',
  lexapro: 'ssri',
  cipralex: 'ssri',
  fluvoxamine: 'ssri',
  luvox: 'ssri',
  // MAOIs (incl. antibiotic linezolid + EU-common moclobemide)
  phenelzine: 'maoi',
  nardil: 'maoi',
  tranylcypromine: 'maoi',
  parnate: 'maoi',
  isocarboxazid: 'maoi',
  marplan: 'maoi',
  selegiline: 'maoi',
  emsam: 'maoi',
  eldepryl: 'maoi',
  zelapar: 'maoi',
  moclobemide: 'maoi',
  manerix: 'maoi',
  amira: 'maoi',
  linezolid: 'maoi',
  zyvox: 'maoi',
  // PDE-5 inhibitors
  sildenafil: 'pde5',
  viagra: 'pde5',
  revatio: 'pde5',
  tadalafil: 'pde5',
  cialis: 'pde5',
  adcirca: 'pde5',
  vardenafil: 'pde5',
  levitra: 'pde5',
  avanafil: 'pde5',
  stendra: 'pde5',
  // Nitrates
  nitroglycerin: 'nitrate',
  nitrostat: 'nitrate',
  nitromist: 'nitrate',
  nitro: 'nitrate',
  isosorbide: 'nitrate',
  isordil: 'nitrate',
  dilatrate: 'nitrate',
  imdur: 'nitrate',
  monoket: 'nitrate',
  // Opioids
  oxycodone: 'opioid',
  oxycontin: 'opioid',
  roxicodone: 'opioid',
  percocet: 'opioid',
  endocet: 'opioid',
  hydrocodone: 'opioid',
  vicodin: 'opioid',
  norco: 'opioid',
  lortab: 'opioid',
  morphine: 'opioid',
  codeine: 'opioid',
  tramadol: 'opioid',
  ultram: 'opioid',
  fentanyl: 'opioid',
  duragesic: 'opioid',
  actiq: 'opioid',
  hydromorphone: 'opioid',
  dilaudid: 'opioid',
  methadone: 'opioid',
  dolophine: 'opioid',
  methadose: 'opioid',
  oxymorphone: 'opioid',
  opana: 'opioid',
  buprenorphine: 'opioid',
  suboxone: 'opioid',
  subutex: 'opioid',
  tapentadol: 'opioid',
  nucynta: 'opioid',
  // Benzodiazepines (strict — Z-drugs deferred)
  alprazolam: 'benzodiazepine',
  xanax: 'benzodiazepine',
  lorazepam: 'benzodiazepine',
  ativan: 'benzodiazepine',
  clonazepam: 'benzodiazepine',
  klonopin: 'benzodiazepine',
  diazepam: 'benzodiazepine',
  valium: 'benzodiazepine',
  temazepam: 'benzodiazepine',
  restoril: 'benzodiazepine',
  midazolam: 'benzodiazepine',
  versed: 'benzodiazepine',
  chlordiazepoxide: 'benzodiazepine',
  librium: 'benzodiazepine',
  oxazepam: 'benzodiazepine',
  serax: 'benzodiazepine',
  // CYP3A4-sensitive statins (explicit contraindication only)
  simvastatin: 'statin_cyp3a4',
  zocor: 'statin_cyp3a4',
  lovastatin: 'statin_cyp3a4',
  mevacor: 'statin_cyp3a4',
  altoprev: 'statin_cyp3a4',
  // Strong CYP3A4 inhibitors
  clarithromycin: 'cyp3a4_inhibitor',
  biaxin: 'cyp3a4_inhibitor',
  erythromycin: 'cyp3a4_inhibitor',
  ketoconazole: 'cyp3a4_inhibitor',
  nizoral: 'cyp3a4_inhibitor',
  itraconazole: 'cyp3a4_inhibitor',
  sporanox: 'cyp3a4_inhibitor',
  voriconazole: 'cyp3a4_inhibitor',
  vfend: 'cyp3a4_inhibitor',
  posaconazole: 'cyp3a4_inhibitor',
  noxafil: 'cyp3a4_inhibitor',
  nefazodone: 'cyp3a4_inhibitor',
  serzone: 'cyp3a4_inhibitor',
  ritonavir: 'cyp3a4_inhibitor',
  norvir: 'cyp3a4_inhibitor',
  telithromycin: 'cyp3a4_inhibitor',
  // Clopidogrel + CYP2C19 inhibitors
  clopidogrel: 'clopidogrel',
  plavix: 'clopidogrel',
  omeprazole: 'cyp2c19_inhibitor',
  prilosec: 'cyp2c19_inhibitor',
  losec: 'cyp2c19_inhibitor',
  esomeprazole: 'cyp2c19_inhibitor',
  nexium: 'cyp2c19_inhibitor',
  // Lithium
  lithium: 'lithium',
  eskalith: 'lithium',
  lithobid: 'lithium',
};

/** Trailing salt forms stripped before lookup ('sertraline hcl' → 'sertraline'). */
const SALT_SUFFIXES = [
  'hydrochloride',
  'besylate',
  'maleate',
  'tartrate',
  'succinate',
  'fumarate',
  'mesylate',
  'sulfate',
  'phosphate',
  'citrate',
  'hydrobromide',
  'camsylate',
  'hcl',
  'hbr',
];

/** Normalize a user-entered medicine name to a lookup key. */
export function normalizeDrugName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  let s = raw.toLowerCase().replace(/[^a-z0-9 %]/g, ' ');
  s = s.replace(/\d+(\.\d+)?\s?(mg|mcg|g|ml|iu|%|units?)\b/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  for (const salt of SALT_SUFFIXES) {
    if (s.endsWith(` ${salt}`)) {
      s = s.slice(0, -(salt.length + 1)).trim();
      break;
    }
  }
  return s;
}

/** Interaction classes for a medicine name (empty when unknown). */
export function classesOf(rawName: unknown): string[] {
  const key = normalizeDrugName(rawName);
  if (!key) return [];
  const direct = INGREDIENT_CLASS[key];
  if (direct) return [direct];
  // Multi-word entries (e.g. 'acetylsalicylic acid'): match on first token.
  const first = key.split(' ')[0];
  const hit = INGREDIENT_CLASS[first];
  return hit ? [hit] : [];
}

/**
 * Pairwise interaction flags over the active list. Same medicine twice is
 * skipped (the duplicate-therapy flag owns that); unknown medicines stay
 * silent; majors sort first.
 */
export function findInteractions(
  meds: Pick<Medication, 'name'>[],
): DrugInteraction[] {
  const out: DrugInteraction[] = [];
  for (let i = 0; i < meds.length; i++) {
    for (let j = i + 1; j < meds.length; j++) {
      const a = meds[i];
      const b = meds[j];
      if (normalizeDrugName(a.name) === normalizeDrugName(b.name)) continue;
      const classesA = classesOf(a.name);
      const classesB = classesOf(b.name);
      if (classesA.length === 0 || classesB.length === 0) continue;
      for (const rule of INTERACTION_RULES) {
        const [c1, c2] = rule.classes;
        const hit =
          (classesA.includes(c1) && classesB.includes(c2)) ||
          (classesA.includes(c2) && classesB.includes(c1));
        if (!hit) continue;
        out.push({
          ruleId: rule.id,
          medicines: [a.name, b.name],
          severity: rule.severity,
          text: `${rule.headline}: ${a.name} + ${b.name} — ${rule.detail} ${ASK_PROFESSIONAL}`,
        });
      }
    }
  }
  return out.sort((x, y) => (x.severity === y.severity ? 0 : x.severity === 'major' ? -1 : 1));
}

/**
 * Interaction flags in the shared SafetyFlag shape, sorted majors-first.
 * The screen prepends these ahead of duplicate/polypharmacy flags.
 */
export function interactionFlags(
  meds: Pick<Medication, 'medication_id' | 'name'>[],
): SafetyFlag[] {
  return findInteractions(meds).map((d) => ({
    kind: 'interaction' as const,
    text: d.text,
    medicationIds: meds
      .filter((m) => d.medicines.includes(m.name))
      .map((m) => m.medication_id),
  }));
}
