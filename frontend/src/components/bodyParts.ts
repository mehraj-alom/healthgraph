import type { Slug } from 'react-native-body-highlighter';
import type { PainSide } from './SymptomBodyMap';

/**
 * Highlightable body-part catalog.
 *
 * The figure stays the library's full human body; only catalog parts light
 * up. Each entry pins one library slug plus a side, which turns 24 SVG
 * regions into 37 separately highlightable zones (e.g. left vs right knee).
 */

export interface CatalogPart {
  /** Stable key: `${slug}:${side ?? 'whole'}`. */
  key: string;
  slug: Slug;
  side: PainSide | null;
  label: string;
}

const entry = (
  slug: Slug,
  side: PainSide | null,
  label: string,
): CatalogPart => ({ key: `${slug}:${side ?? 'whole'}`, slug, side, label });

export const BODY_PART_CATALOG: CatalogPart[] = [
  // Front
  entry('head', null, 'Head'),
  entry('neck', null, 'Neck'),
  entry('chest', null, 'Chest'),
  entry('abs', null, 'Abs'),
  entry('obliques', 'left', 'Left obliques'),
  entry('obliques', 'right', 'Right obliques'),
  entry('deltoids', 'left', 'Left shoulder'),
  entry('deltoids', 'right', 'Right shoulder'),
  entry('biceps', 'left', 'Left biceps'),
  entry('biceps', 'right', 'Right biceps'),
  entry('triceps', 'left', 'Left triceps'),
  entry('triceps', 'right', 'Right triceps'),
  entry('forearm', 'left', 'Left forearm'),
  entry('forearm', 'right', 'Right forearm'),
  entry('hands', 'left', 'Left hand'),
  entry('hands', 'right', 'Right hand'),
  entry('quadriceps', 'left', 'Left front thigh'),
  entry('quadriceps', 'right', 'Right front thigh'),
  entry('adductors', 'left', 'Left inner thigh'),
  entry('adductors', 'right', 'Right inner thigh'),
  entry('knees', 'left', 'Left knee'),
  entry('knees', 'right', 'Right knee'),
  entry('tibialis', 'left', 'Left shin'),
  entry('tibialis', 'right', 'Right shin'),
  entry('feet', 'left', 'Left foot'),
  entry('feet', 'right', 'Right foot'),
  // Back
  entry('trapezius', null, 'Traps'),
  entry('upper-back', null, 'Upper back'),
  entry('lower-back', null, 'Lower back'),
  entry('gluteal', 'left', 'Left glute'),
  entry('gluteal', 'right', 'Right glute'),
  entry('hamstring', 'left', 'Left back thigh'),
  entry('hamstring', 'right', 'Right back thigh'),
  entry('calves', 'left', 'Left calf'),
  entry('calves', 'right', 'Right calf'),
  entry('ankles', 'left', 'Left ankle'),
  entry('ankles', 'right', 'Right ankle'),
];

/** Humanlike display names for every slug the library supports. */
export const BODY_PART_NAMES: Record<Slug, string> = {
  abs: 'Abs',
  adductors: 'Inner thigh',
  ankles: 'Ankle',
  biceps: 'Biceps',
  calves: 'Calf',
  chest: 'Chest',
  deltoids: 'Shoulder',
  feet: 'Foot',
  forearm: 'Forearm',
  gluteal: 'Glute',
  hamstring: 'Back thigh',
  hands: 'Hand',
  hair: 'Scalp',
  head: 'Head',
  knees: 'Knee',
  'lower-back': 'Lower back',
  neck: 'Neck',
  obliques: 'Obliques',
  quadriceps: 'Front thigh',
  tibialis: 'Shin',
  trapezius: 'Traps',
  triceps: 'Triceps',
  'upper-back': 'Upper back',
};

export function formatPartName(slug: Slug, side: PainSide | null): string {
  const name = BODY_PART_NAMES[slug] ?? slug;
  if (!side) return name;
  const sideLabel = side === 'left' ? 'Left' : 'Right';
  return `${sideLabel} ${name.charAt(0).toLowerCase() + name.slice(1)}`;
}

/** Pain severity (1–10, per the logger dial) → ramp intensity 1–3. */
export function severityToIntensity(severity: number): 1 | 2 | 3 {
  if (!Number.isFinite(severity)) return 2;
  if (severity <= 3) return 1;
  if (severity <= 6) return 2;
  return 3;
}

interface MappedPart {
  slug: Slug;
  side: PainSide | null;
}

/**
 * Map a logged location (structure_id preferred; body_location_id is usually
 * a UUID and won't match) to a catalog part. Returns null when nothing
 * matches — callers count those as unmapped, never guess.
 *
 * Documented judgment calls for bare regions: BACK → lower back (most
 * common complaint site), ARM → biceps, LEG → quadriceps.
 */
export function mapLocationToPart(raw: string | null | undefined): MappedPart | null {
  if (!raw || typeof raw !== 'string') return null;
  const text = raw.toUpperCase().replace(/[_-]+/g, ' ').trim();
  if (!text) return null;

  let side: PainSide | null = null;
  let hay = text;
  if (/\bLEFT\b/.test(hay)) {
    side = 'left';
    hay = hay.replace(/\bLEFT\b/g, ' ').trim();
  } else if (/\bRIGHT\b/.test(hay)) {
    side = 'right';
    hay = hay.replace(/\bRIGHT\b/g, ' ').trim();
  }
  const has = (...words: string[]) => words.some((w) => hay.includes(w));
  const sided = (slug: Slug): MappedPart => ({ slug, side });

  if (has('NECK', 'CERVICAL')) return { slug: 'neck', side: null };
  if (has('HEAD', 'FACE', 'SKULL', 'JAW', 'FOREHEAD', 'TEMPLE')) return { slug: 'head', side: null };
  if (has('SHOULDER', 'DELTOID', 'CLAVICLE', 'COLLARBONE')) return sided('deltoids');
  if (has('TRAPEZIUS', 'TRAPS')) return { slug: 'trapezius', side: null };
  if (has('BICEP', 'UPPER ARM')) return sided('biceps');
  if (has('TRICEP')) return sided('triceps');
  if (has('FOREARM', 'ELBOW')) return sided('forearm');
  if (has('HAND', 'WRIST', 'FINGER', 'THUMB')) return sided('hands');
  if (has('CHEST', 'RIB', 'STERNUM', 'PECTORAL')) return { slug: 'chest', side: null };
  if (has('ABDOMEN', 'ABDOMINAL', 'STOMACH', 'BELLY')) return { slug: 'abs', side: null };
  if (has('OBLIQUE', 'SIDE BODY', 'FLANK')) return sided('obliques');
  if (has('THORACIC', 'MID BACK', 'MIDDLE BACK')) return { slug: 'upper-back', side: null };
  if (has('LUMBAR', 'LOWER BACK', 'LOW BACK')) return { slug: 'lower-back', side: null };
  if (has('BACK', 'SPINE')) return { slug: 'lower-back', side: null };
  if (has('GLUTE', 'HIP', 'BUTTOCK')) return sided('gluteal');
  if (has('HAMSTRING')) return sided('hamstring');
  if (has('QUADRICEPS', 'QUAD')) return sided('quadriceps');
  if (has('ADDUCTOR', 'INNER THIGH', 'GROIN')) return sided('adductors');
  if (has('THIGH')) return sided('quadriceps');
  if (has('KNEE')) return sided('knees');
  if (has('SHIN', 'TIBIA')) return sided('tibialis');
  if (has('CALF', 'CALVES')) return sided('calves');
  if (has('ANKLE')) return sided('ankles');
  if (has('FOOT', 'FEET', 'TOE', 'HEEL', 'SOLE')) return sided('feet');
  if (has('ARM')) return sided('biceps');
  if (has('LEG')) return sided('quadriceps');
  return null;
}
