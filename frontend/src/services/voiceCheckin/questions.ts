/**
 * Voice check-in interview script — the questions Sanotts asks on the
 * scheduled call, in order. Every answer parses to a daily-check-in
 * field; anything unparseable is re-asked once, then skipped (never
 * guessed — a skipped field simply stays out of the saved log).
 */

export type AnswerField =
  | 'overall_wellbeing'
  | 'energy_level'
  | 'stress_level'
  | 'sleep_hours'
  | 'water_glasses';

export interface InterviewQuestion {
  field: AnswerField;
  /** Spoken verbatim by the voice agent. Short, one breath. */
  prompt: string;
  /** On-screen hint under the live transcript. */
  hint: string;
  parse: (text: string) => number | null;
  format: (value: number) => string;
}

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  half: 0.5,
};

/** First digit run wins ("about 7 hours" → 7), else first number word. */
export function parseSpokenNumber(text: string): number | null {
  const lower = text.toLowerCase();
  // "seven and a half" / "7 and a half" → 7.5 (checked before bare digits).
  const half = lower.match(/(\d+(?:\.\d+)?|[a-z]+)\s+and\s+(?:a\s+)?half\b/);
  if (half) {
    const base = /^\d/.test(half[1]) ? Number(half[1]) : NUMBER_WORDS[half[1]];
    if (typeof base === 'number' && Number.isFinite(base) && Number.isInteger(base)) {
      return base + 0.5;
    }
  }
  const digits = lower.match(/(\d+(?:\.\d+)?)/);
  if (digits) {
    const v = Number(digits[1]);
    return Number.isFinite(v) ? v : null;
  }
  for (const [word, value] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(lower)) return value;
  }
  return null;
}

function clamp(n: number, lo: number, hi: number): number | null {
  if (!Number.isFinite(n) || n < lo || n > hi) return null;
  return n;
}

/** 1–5 scale answers snap to the nearest whole step. */
function scale(parse: (text: string) => number | null) {
  return (text: string): number | null => {
    const v = parse(text);
    if (v == null) return null;
    return clamp(Math.round(v), 1, 5);
  };
}

export const INTERVIEW_SCRIPT: InterviewQuestion[] = [
  {
    field: 'overall_wellbeing',
    prompt: 'How is your mood today, from 1 to 5?',
    hint: 'Say a number from 1 to 5',
    parse: scale(parseSpokenNumber),
    format: (v) => `${v} out of 5`,
  },
  {
    field: 'energy_level',
    prompt: 'And your energy, from 1 to 5?',
    hint: 'Say a number from 1 to 5',
    parse: scale(parseSpokenNumber),
    format: (v) => `${v} out of 5`,
  },
  {
    field: 'stress_level',
    prompt: 'How stressed do you feel, from 1 to 5?',
    hint: '1 is calm, 5 is very stressed',
    parse: scale(parseSpokenNumber),
    format: (v) => `${v} out of 5`,
  },
  {
    field: 'sleep_hours',
    prompt: 'How many hours did you sleep last night?',
    hint: 'Say a number, like 7 and a half',
    parse: (text) => {
      const v = parseSpokenNumber(text);
      if (v == null) return null;
      return clamp(Math.round(v * 2) / 2, 0, 24);
    },
    format: (v) => `${v} hours`,
  },
  {
    field: 'water_glasses',
    prompt: 'How many glasses of water have you had today?',
    hint: 'Say a number',
    parse: (text) => {
      const v = parseSpokenNumber(text);
      if (v == null) return null;
      return clamp(Math.round(v), 0, 20);
    },
    format: (v) => `${v} ${v === 1 ? 'glass' : 'glasses'}`,
  },
];

/** Closing line before the summary — always spoken, never skipped. */
export const CLOSING_PROMPT =
  'Thanks, that is everything. Let me read back what I heard.';
