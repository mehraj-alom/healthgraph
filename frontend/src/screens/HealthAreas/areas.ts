/**
 * areas.ts — health-area status model (pure, testable).
 *
 * One entry per area the product discusses. Status is derived ONLY from
 * real local rows — an area with no source data reports NO DATA YET, never
 * a placeholder metric. Provenance distinguishes DEVICE (never leaves the
 * phone: camera pulse, substance, cycle) from SERVER (synced domain data).
 * Zero imports: safe for node unit tests.
 */

export type HealthAreaId =
  | 'heart'
  | 'sleep'
  | 'activity'
  | 'nutrition'
  | 'weight'
  | 'wellbeing'
  | 'medications'
  | 'records'
  | 'skin'
  | 'substance'
  | 'cycle'
  | 'discipline';

export type HealthAreaStatus = 'available' | 'no-data';
export type HealthAreaSource = 'device' | 'server' | 'none';

/** Engine → hub-area mapping for active-engine pinning (null = no area). */
const ENGINE_AREA: Record<string, HealthAreaId | null> = {
  sleep: 'sleep',
  weight: 'weight',
  discipline: 'discipline',
  fitness: 'activity',
  nutrition: 'nutrition',
  wellbeing: 'wellbeing',
  heart: 'heart',
};

/**
 * Order hub areas with active-engine areas first (stable otherwise). The
 * single influence engines exert on the hub in this batch — no dashboards,
 * no reordering logic duplicated elsewhere.
 */
export function orderAreasByEngines<T extends { id: HealthAreaId }>(
  areas: readonly T[],
  activeEngineIds: readonly string[],
): T[] {
  const pinned = new Set<HealthAreaId>();
  for (const id of activeEngineIds) {
    const area = (ENGINE_AREA as Record<string, HealthAreaId | null>)[id];
    if (area) pinned.add(area);
  }
  if (pinned.size === 0) return [...areas];
  const indexed = new Map(areas.map((a, i) => [a.id, i] as const));
  return [...areas].sort((a, b) => {
    const pa = pinned.has(a.id) ? 0 : 1;
    const pb = pinned.has(b.id) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return (indexed.get(a.id) ?? 0) - (indexed.get(b.id) ?? 0);
  });
}

/** Navigation target name for an area card (plain data — screens execute typed navigations). */
export type AreaRouteName =
  | 'Main'
  | 'DailyLog'
  | 'Medications'
  | 'Timeline'
  | 'Substance'
  | 'Cycle'
  | 'SleepEngine'
  | 'WeightEngine'
  | 'DisciplineEngine'
  | 'FitnessEngine'
  | 'NutritionEngine'
  | 'WellbeingEngine'
  | 'HeartEngine';

/**
 * Deep-link target per area, or null when no destination exists (skin
 * renders non-pressable rather than leading somewhere fake). Every
 * other id MUST map (pinned by test).
 */
export function areaRouteName(id: HealthAreaId): AreaRouteName | null {
  switch (id) {
    case 'heart':
      return 'HeartEngine';
    case 'sleep':
      return 'SleepEngine';
    case 'activity':
      return 'FitnessEngine';
    case 'nutrition':
      return 'NutritionEngine';
    case 'wellbeing':
      return 'WellbeingEngine';
    case 'medications':
      return 'Medications';
    case 'records':
      return 'Timeline';
    case 'substance':
      return 'Substance';
    case 'cycle':
      return 'Cycle';
    case 'weight':
      return 'WeightEngine';
    case 'discipline':
      return 'DisciplineEngine';
    case 'skin':
      return null;
  }
}

export interface HealthAreaState {
  id: HealthAreaId;
  label: string;
  status: HealthAreaStatus;
  source: HealthAreaSource;
  headline: string;
  detail: string | null;
}

export interface HealthAreaInputs {
  heartBpm: number | null;
  serverHeartBpm: number | null;
  loggedDays: number;
  activeMedications: number;
  documentCount: number;
  substanceEntries: number;
  cycleEntries: number;
  /** Profile weight in kg (server snapshot); null when unrecorded. */
  profileWeightKg: number | null;
  /** Trailing-7-day active days (tracked-action union); 0 when none. */
  activeDays7: number;
  /** Trailing-7-day logged activity sessions; 0 when none. */
  activitySessions7: number;
  /** Trailing-7-day logged meal counts; 0 when none. */
  nutritionMeals7: number;
  /** Trailing-7-day days with a wellbeing rating; 0 when none. */
  wellbeingDays7: number;
}

function countCopy(n: number, one: string, many: string): string {
  return n === 1 ? `1 ${one}` : `${n} ${many}`;
}

export function buildHealthAreas(input: HealthAreaInputs): HealthAreaState[] {
  const areas: HealthAreaState[] = [];

  if (input.heartBpm !== null) {
    areas.push({
      id: 'heart',
      label: 'Heart',
      status: 'available',
      source: 'device',
      headline: `${Math.round(input.heartBpm)} bpm`,
      detail: 'Measured on this device',
    });
  } else if (input.serverHeartBpm !== null) {
    areas.push({
      id: 'heart',
      label: 'Heart',
      status: 'available',
      source: 'server',
      headline: `${Math.round(input.serverHeartBpm)} bpm`,
      detail: 'Latest logged reading',
    });
  } else {
    areas.push({
      id: 'heart',
      label: 'Heart',
      status: 'no-data',
      source: 'none',
      headline: 'No pulse readings yet',
      detail: null,
    });
  }

  areas.push(
    input.loggedDays > 0
      ? {
          id: 'sleep',
          label: 'Sleep',
          status: 'available',
          source: 'server',
          headline: countCopy(input.loggedDays, 'logged day', 'logged days'),
          detail: 'From your daily logs',
        }
      : {
          id: 'sleep',
          label: 'Sleep',
          status: 'no-data',
          source: 'none',
          headline: 'No sleep logs yet',
          detail: null,
        },
    input.activitySessions7 > 0
      ? {
          id: 'activity',
          label: 'Activity',
          status: 'available',
          source: 'server',
          headline: countCopy(input.activitySessions7, 'workout this week', 'workouts this week'),
          detail: 'From your logged activity',
        }
      : input.loggedDays > 0
        ? {
            id: 'activity',
            label: 'Activity',
            status: 'available',
            source: 'server',
            headline: countCopy(input.loggedDays, 'logged day', 'logged days'),
            detail: 'From your daily logs',
          }
        : {
            id: 'activity',
            label: 'Activity',
            status: 'no-data',
            source: 'none',
            headline: 'No activity logs yet',
            detail: null,
          },
    input.nutritionMeals7 > 0
      ? {
          id: 'nutrition',
          label: 'Nutrition',
          status: 'available',
          source: 'server',
          headline: countCopy(input.nutritionMeals7, 'meal logged this week', 'meals logged this week'),
          detail: 'From your daily logs',
        }
      : input.loggedDays > 0
        ? {
            id: 'nutrition',
            label: 'Nutrition',
            status: 'available',
            source: 'server',
            headline: countCopy(input.loggedDays, 'logged day', 'logged days'),
            detail: 'From your daily logs',
          }
        : {
            id: 'nutrition',
            label: 'Nutrition',
            status: 'no-data',
            source: 'none',
            headline: 'No nutrition logs yet',
            detail: null,
          },
    input.profileWeightKg !== null
      ? {
          id: 'weight',
          label: 'Weight',
          status: 'available',
          source: 'server',
          headline: `${Math.round(input.profileWeightKg * 10) / 10} kg`,
          detail: 'From your profile',
        }
      : {
          id: 'weight',
          label: 'Weight',
          status: 'no-data',
          source: 'none',
          headline: 'No weight entries yet',
          detail: 'Log weight as a vital in your daily check-in',
        },
    input.activeDays7 > 0
      ? {
          id: 'discipline',
          label: 'Discipline',
          status: 'available',
          source: 'device',
          headline: `Active ${input.activeDays7} of 7 days`,
          detail: 'From your tracked actions',
        }
      : {
          id: 'discipline',
          label: 'Discipline',
          status: 'no-data',
          source: 'none',
          headline: 'No tracked actions yet',
          detail: null,
        },
    input.wellbeingDays7 > 0
      ? {
          id: 'wellbeing',
          label: 'Wellbeing',
          status: 'available',
          source: 'server',
          headline: countCopy(input.wellbeingDays7, 'rated day this week', 'rated days this week'),
          detail: 'From your daily check-ins',
        }
      : input.loggedDays > 0
        ? {
            id: 'wellbeing',
            label: 'Wellbeing',
            status: 'available',
            source: 'server',
            headline: countCopy(input.loggedDays, 'logged day', 'logged days'),
            detail: 'From your daily logs',
          }
        : {
            id: 'wellbeing',
            label: 'Wellbeing',
            status: 'no-data',
            source: 'none',
            headline: 'No wellbeing logs yet',
            detail: null,
          },
    input.activeMedications > 0
      ? {
          id: 'medications',
          label: 'Medications',
          status: 'available',
          source: 'server',
          headline: countCopy(input.activeMedications, 'active', 'active'),
          detail: 'Synced prescriptions and schedule',
        }
      : {
          id: 'medications',
          label: 'Medications',
          status: 'no-data',
          source: 'none',
          headline: 'No active medications',
          detail: null,
        },
    input.documentCount > 0
      ? {
          id: 'records',
          label: 'Medical records',
          status: 'available',
          source: 'server',
          headline: countCopy(input.documentCount, 'document', 'documents'),
          detail: 'Processed and searchable',
        }
      : {
          id: 'records',
          label: 'Medical records',
          status: 'no-data',
          source: 'none',
          headline: 'No documents yet',
          detail: null,
        },
    {
      id: 'skin',
      label: 'Skin',
      status: 'no-data',
      source: 'none',
      headline: 'No skin tracking yet',
      detail: 'Not tracked in this version',
    },
    input.substanceEntries > 0
      ? {
          id: 'substance',
          label: 'Substance use',
          status: 'available',
          source: 'device',
          headline: countCopy(input.substanceEntries, 'entry', 'entries'),
          detail: 'On this device only',
        }
      : {
          id: 'substance',
          label: 'Substance use',
          status: 'no-data',
          source: 'none',
          headline: 'Nothing tracked yet',
          detail: null,
        },
    input.cycleEntries > 0
      ? {
          id: 'cycle',
          label: 'Cycle',
          status: 'available',
          source: 'device',
          headline: countCopy(input.cycleEntries, 'entry', 'entries'),
          detail: 'On this device only',
        }
      : {
          id: 'cycle',
          label: 'Cycle',
          status: 'no-data',
          source: 'none',
          headline: 'Nothing tracked yet',
          detail: null,
        },
  );

  return areas;
}
