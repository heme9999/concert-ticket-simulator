import type { Difficulty, GameMode } from './types';

export interface Prng {
  next: () => number;
  int: (minInclusive: number, maxInclusive: number) => number;
  pick: <T>(items: readonly T[]) => T;
  shuffle: <T>(items: readonly T[]) => T[];
}

/**
 * Deterministic xmur3 string hash so any text seed maps reliably to a 32-bit integer.
 */
export function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Mulberry32 deterministic PRNG seeded by any string.
 */
export function createPrng(seed: string): Prng {
  let state = hashSeed(seed || 'stagedrill-default');

  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (minInclusive: number, maxInclusive: number): number => {
    const low = Math.ceil(minInclusive);
    const high = Math.floor(maxInclusive);
    if (high <= low) return low;
    return low + Math.floor(next() * (high - low + 1));
  };

  const pick = <T>(items: readonly T[]): T => {
    if (items.length === 0) {
      throw new Error('Cannot pick from an empty array');
    }
    return items[int(0, items.length - 1)]!;
  };

  const shuffle = <T>(items: readonly T[]): T[] => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = int(0, i);
      const tmp = copy[i]!;
      copy[i] = copy[j]!;
      copy[j] = tmp;
    }
    return copy;
  };

  return { next, int, pick, shuffle };
}

export function sanitizeSeed(raw: string | null | undefined, fallback = 'arena-101'): string {
  if (!raw) return fallback;
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
  return cleaned || fallback;
}

export function generateRandomSeed(): string {
  const prefixes = ['arena', 'encore', 'stage', 'floor', 'terrace', 'spotlight'];
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)] ?? 'arena';
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${suffix}`;
}

export interface PracticeQueryParams {
  mode: GameMode;
  difficulty: Difficulty;
  seed: string;
}

const VALID_MODES: readonly GameMode[] = ['quick', 'scramble', 'drill'];
const VALID_DIFFICULTIES: readonly Difficulty[] = ['easy', 'hard', 'untimed'];

export function parsePracticeParams(
  search: string,
  defaults: PracticeQueryParams = { mode: 'quick', difficulty: 'easy', seed: 'arena-101' },
): PracticeQueryParams {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const rawMode = params.get('mode');
  const rawDifficulty = params.get('difficulty');
  const rawSeed = params.get('seed');

  const mode: GameMode = VALID_MODES.includes(rawMode as GameMode)
    ? (rawMode as GameMode)
    : defaults.mode;

  const difficulty: Difficulty = VALID_DIFFICULTIES.includes(rawDifficulty as Difficulty)
    ? (rawDifficulty as Difficulty)
    : defaults.difficulty;

  const seed = sanitizeSeed(rawSeed, defaults.seed);
  return { mode, difficulty, seed };
}

export function buildPracticePath(params: PracticeQueryParams): string {
  const search = new URLSearchParams({
    mode: params.mode,
    difficulty: params.difficulty,
    seed: sanitizeSeed(params.seed),
  });
  return `/practice/?${search.toString()}`;
}
