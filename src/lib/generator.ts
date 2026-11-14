import { createPrng, sanitizeSeed } from './prng';
import type {
  Difficulty,
  GameMode,
  GeneratedRound,
  PracticeMission,
  ScrambleWave,
  SectionId,
} from './types';
import { DEMO_VENUE, findValidSeatBlocks } from './venue';

interface MissionTemplate {
  id: string;
  label: string;
  preferredSections: SectionId[];
  backupSections: SectionId[];
  maxPerTicket: number;
}

const MISSION_TEMPLATES: readonly MissionTemplate[] = [
  {
    id: 'lower-bowl-standard',
    label: 'Lower Bowl Target',
    preferredSections: ['LOW-101', 'LOW-102'],
    backupSections: ['UP-201'],
    maxPerTicket: 140,
  },
  {
    id: 'floor-east-value',
    label: 'Floor East Cap',
    preferredSections: ['FL-B'],
    backupSections: ['LOW-101', 'LOW-102'],
    maxPerTicket: 185,
  },
  {
    id: 'floor-center-premium',
    label: 'Floor Center Hunt',
    preferredSections: ['FL-A', 'FL-B'],
    backupSections: ['LOW-101', 'LOW-102'],
    maxPerTicket: 200,
  },
  {
    id: 'east-budget-saver',
    label: 'Budget Saver Hunt',
    preferredSections: ['LOW-102'],
    backupSections: ['UP-201'],
    maxPerTicket: 125,
  },
];

export function getTimeLimitMs(mode: GameMode, difficulty: Difficulty): number | null {
  if (difficulty === 'untimed') return null;
  if (mode === 'quick') {
    return difficulty === 'hard' ? 18000 : 35000;
  }
  if (mode === 'scramble') {
    return difficulty === 'hard' ? 22000 : 45000;
  }
  // Full drill gives slightly longer total selection window after waiting room
  return difficulty === 'hard' ? 24000 : 48000;
}

export function getWaitStageMs(mode: GameMode): number {
  return mode === 'drill' ? 3500 : 0;
}

export function generateRound(config: {
  mode: GameMode;
  difficulty: Difficulty;
  seed: string;
}): GeneratedRound {
  const cleanSeed = sanitizeSeed(config.seed);
  const prng = createPrng(`${cleanSeed}:${config.mode}:${config.difficulty}`);

  // Support 1 to 4 adjacent seats; deterministic from seed
  const targetCount = prng.pick([2, 2, 3, 3, 4, 1] as const);
  const template = prng.pick(MISSION_TEMPLATES);

  const totalBudget = targetCount * template.maxPerTicket;

  // Step 1: Pick one guaranteed primary block in preferredSections within budget
  const primaryCandidates = findValidSeatBlocks(
    targetCount,
    new Set(),
    template.preferredSections,
    totalBudget,
    DEMO_VENUE,
  );
  const backupCandidates = findValidSeatBlocks(
    targetCount,
    new Set(),
    template.backupSections,
    totalBudget,
    DEMO_VENUE,
  );

  if (primaryCandidates.length === 0 || backupCandidates.length === 0) {
    throw new Error(
      `Invalid mission template ${template.id} for count=${targetCount}: no valid blocks`,
    );
  }

  const primarySolutionSeatIds = prng.pick(primaryCandidates);
  const reservedSolutionSeatIds = prng.pick(backupCandidates);

  // Reserved blocks must never be blocked initially
  const protectedSeats = new Set<string>([
    ...primarySolutionSeatIds,
    ...reservedSolutionSeatIds,
  ]);

  // Step 2: Populate realistic initial unavailable seats while preserving protected blocks
  const unavailableRate =
    config.difficulty === 'hard' ? 0.44 : config.difficulty === 'easy' ? 0.28 : 0.32;

  const initialUnavailableSeatIds: string[] = [];
  for (const seat of DEMO_VENUE.seats) {
    if (protectedSeats.has(seat.id)) continue;
    if (prng.next() < unavailableRate) {
      initialUnavailableSeatIds.push(seat.id);
    }
  }

  // In quick mode, occasionally ensure some extra seats in preferred sections are open
  // while keeping aisle traps realistic (e.g. leaving S4 & S5 open in another row while S3 or S6 is taken)
  const initialBlockedSet = new Set(initialUnavailableSeatIds);

  // Step 3: Build deterministic scramble waves for 'scramble' and 'drill' modes
  const scrambleWaves: ScrambleWave[] = [];
  if (config.mode === 'scramble' || config.mode === 'drill') {
    const wave1Trigger = config.difficulty === 'hard' ? 4500 : 8000;
    // Wave 1 hits the primary preferred solution block + nearby preferred seats,
    // strictly avoiding reservedSolutionSeatIds so a solvable backup always remains!
    const wave1Targets = new Set<string>();
    const hitCount = Math.min(primarySolutionSeatIds.length, Math.max(1, targetCount - 1));
    for (let i = 0; i < hitCount; i++) {
      const seatId = primarySolutionSeatIds[i];
      if (seatId && !reservedSolutionSeatIds.includes(seatId)) {
        wave1Targets.add(seatId);
      }
    }

    const extraPreferredSeats = prng
      .shuffle(
        DEMO_VENUE.seats.filter(
          (s) =>
            template.preferredSections.includes(s.sectionId) &&
            !initialBlockedSet.has(s.id) &&
            !reservedSolutionSeatIds.includes(s.id) &&
            !wave1Targets.has(s.id),
        ),
      )
      .slice(0, config.difficulty === 'hard' ? 8 : 5);

    for (const seat of extraPreferredSeats) {
      wave1Targets.add(seat.id);
    }

    scrambleWaves.push({
      id: 'wave-1',
      triggerAtElapsedMs: wave1Trigger,
      lockSeatIds: Array.from(wave1Targets),
      headline: `${template.preferredSections.join('/')} inventory tightened`,
      detail: `Simulated demand claimed ${wave1Targets.size} seats in ${template.preferredSections.join(' / ')}. Check ${template.backupSections.join(' / ')} backups if needed.`,
    });

    if (config.difficulty === 'hard') {
      const wave1Set = new Set(wave1Targets);
      const wave2Targets = prng
        .shuffle(
          DEMO_VENUE.seats.filter(
            (s) =>
              !initialBlockedSet.has(s.id) &&
              !wave1Set.has(s.id) &&
              !reservedSolutionSeatIds.includes(s.id) &&
              (template.preferredSections.includes(s.sectionId) ||
                template.backupSections.includes(s.sectionId)),
          ),
        )
        .slice(0, 7)
        .map((s) => s.id);

      if (wave2Targets.length > 0) {
        scrambleWaves.push({
          id: 'wave-2',
          triggerAtElapsedMs: 10500,
          lockSeatIds: wave2Targets,
          headline: 'Second demand surge updated floor & lower sections',
          detail: `${wave2Targets.length} additional seats became unavailable across main sections.`,
        });
      }
    }
  }

  const mission: PracticeMission = {
    title: `${targetCount} Adjacent ${targetCount === 1 ? 'Seat' : 'Seats'} · Max $${totalBudget}`,
    summary: `Find ${targetCount} connected ${targetCount === 1 ? 'seat' : 'seats'} (same row, never across an aisle) within $${totalBudget} total virtual budget. Target ${template.preferredSections.join(' or ')} (backup: ${template.backupSections.join(' / ')}).`,
    targetCount,
    totalBudget,
    maxPerTicket: template.maxPerTicket,
    preferredSections: [...template.preferredSections],
    backupSections: [...template.backupSections],
    requireAdjacent: targetCount > 1,
  };

  return {
    seed: cleanSeed,
    mode: config.mode,
    difficulty: config.difficulty,
    mission,
    timeLimitMs: getTimeLimitMs(config.mode, config.difficulty),
    waitStageMs: getWaitStageMs(config.mode),
    initialUnavailableSeatIds,
    scrambleWaves,
    reservedSolutionSeatIds,
    primarySolutionSeatIds,
  };
}

/**
 * Verifies that the generated round has at least one valid contiguous, on-budget
 * seat block both initially and after every scheduled scramble wave.
 */
export function verifyRoundSolvability(
  round: GeneratedRound,
  afterAllWaves = true,
): boolean {
  const blocked = new Set(round.initialUnavailableSeatIds);

  if (afterAllWaves) {
    for (const wave of round.scrambleWaves) {
      for (const seatId of wave.lockSeatIds) {
        blocked.add(seatId);
      }
    }
  }

  const allowedSections: SectionId[] = [
    ...round.mission.preferredSections,
    ...round.mission.backupSections,
  ];
  const validBlocks = findValidSeatBlocks(
    round.mission.targetCount,
    blocked,
    allowedSections,
    round.mission.totalBudget,
    DEMO_VENUE,
  );
  return validBlocks.length > 0;
}
