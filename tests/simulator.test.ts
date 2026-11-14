import { describe, expect, it } from 'vitest';
import { generateRound, verifyRoundSolvability } from '@/lib/generator';
import { buildPracticePath, createPrng, parsePracticeParams } from '@/lib/prng';
import { applyScrambleWave, toggleSeatSelection } from '@/lib/rules';
import { evaluateRound } from '@/lib/scoring';
import {
  appendHistory,
  createSafeStorage,
  DEFAULT_SETTINGS,
  loadActiveRound,
  loadHistory,
  loadSettings,
  saveActiveRound,
  saveSettings,
  type StorageLike,
} from '@/lib/storage';
import {
  createClockState,
  formatRemainingTime,
  getElapsedMs,
  pauseClock,
  resumeClock,
} from '@/lib/timer';
import type { Difficulty, GameMode } from '@/lib/types';
import { areSeatsAdjacent, calculateSeatsCost, DEMO_VENUE } from '@/lib/venue';

describe('Venue layout & explicit adjacency graph', () => {
  it('treats same-row consecutive seats on the same side of the aisle as adjacent', () => {
    expect(areSeatsAdjacent(['FL-A-R1-S1', 'FL-A-R1-S2'])).toEqual({ adjacent: true });
    expect(areSeatsAdjacent(['FL-A-R1-S1', 'FL-A-R1-S2', 'FL-A-R1-S3', 'FL-A-R1-S4'])).toEqual({
      adjacent: true,
    });
    expect(areSeatsAdjacent(['LOW-101-R2-S5', 'LOW-101-R2-S6', 'LOW-101-R2-S7'])).toEqual({
      adjacent: true,
    });
  });

  it('rejects consecutive seat numbers S4 and S5 that cross the central aisle', () => {
    const res = areSeatsAdjacent(['FL-A-R1-S4', 'FL-A-R1-S5']);
    expect(res.adjacent).toBe(false);
    expect(res.reason).toBe('crossed_aisle');

    const res4 = areSeatsAdjacent(['LOW-102-R3-S3', 'LOW-102-R3-S4', 'LOW-102-R3-S5', 'LOW-102-R3-S6']);
    expect(res4.adjacent).toBe(false);
    expect(res4.reason).toBe('crossed_aisle');
  });

  it('rejects gaps in the same row and seats in different rows or sections', () => {
    expect(areSeatsAdjacent(['FL-A-R1-S1', 'FL-A-R1-S3'])).toEqual({
      adjacent: false,
      reason: 'gap_in_row',
    });
    expect(areSeatsAdjacent(['FL-A-R1-S1', 'FL-A-R2-S1'])).toEqual({
      adjacent: false,
      reason: 'different_section_or_row',
    });
    expect(areSeatsAdjacent(['FL-A-R1-S1', 'FL-B-R1-S1'])).toEqual({
      adjacent: false,
      reason: 'different_section_or_row',
    });
  });

  it('has 5 sections, 120 seats, and exact pricing lookup', () => {
    expect(DEMO_VENUE.sections).toHaveLength(5);
    expect(DEMO_VENUE.seats).toHaveLength(120);
    expect(calculateSeatsCost(['FL-A-R1-S1', 'FL-A-R1-S2'])).toBe(390);
    expect(calculateSeatsCost(['UP-201-R1-S1', 'UP-201-R1-S2', 'UP-201-R1-S3'])).toBe(225);
  });
});

describe('Deterministic PRNG, seed replay & URL parameters', () => {
  it('replays identical rounds for the same seed, mode, and difficulty', () => {
    const roundA = generateRound({ mode: 'scramble', difficulty: 'hard', seed: 'tour-2026' });
    const roundB = generateRound({ mode: 'scramble', difficulty: 'hard', seed: 'tour-2026' });
    expect(roundA).toEqual(roundB);

    const prng1 = createPrng('tour-2026');
    const prng2 = createPrng('tour-2026');
    expect(Array.from({ length: 10 }, () => prng1.next())).toEqual(
      Array.from({ length: 10 }, () => prng2.next()),
    );
  });

  it('round-trips practice URL parameters safely with sanitization', () => {
    const path = buildPracticePath({ mode: 'drill', difficulty: 'hard', seed: 'Arena 99!' });
    expect(path).toBe('/practice/?mode=drill&difficulty=hard&seed=arena-99');
    const parsed = parsePracticeParams(path.split('?')[1]!);
    expect(parsed).toEqual({ mode: 'drill', difficulty: 'hard', seed: 'arena-99' });

    expect(parsePracticeParams('?mode=unknown&difficulty=nope&seed=')).toEqual({
      mode: 'quick',
      difficulty: 'easy',
      seed: 'arena-101',
    });
  });
});

describe('Solvability guarantee across modes, difficulties & seeds', () => {
  it('guarantees solvable blocks initially and after all scramble waves across 135 rounds', () => {
    const modes: GameMode[] = ['quick', 'scramble', 'drill'];
    const difficulties: Difficulty[] = ['easy', 'hard', 'untimed'];

    for (const mode of modes) {
      for (const difficulty of difficulties) {
        for (let i = 0; i < 15; i++) {
          const round = generateRound({ mode, difficulty, seed: `seed-check-${i}` });
          expect(round.mission.targetCount).toBeGreaterThanOrEqual(1);
          expect(round.mission.targetCount).toBeLessThanOrEqual(4);
          expect(verifyRoundSolvability(round, false)).toBe(true);
          expect(verifyRoundSolvability(round, true)).toBe(true);
        }
      }
    }
  });
});

describe('Dynamic scramble conflicts, selection caps & scoring diagnostics', () => {
  it('enforces max selectable seats and detects invalid clicks on unavailable seats', () => {
    const locked = new Set<string>(['FL-A-R1-S1']);
    const hitLocked = toggleSeatSelection({
      seatId: 'FL-A-R1-S1',
      selectedSeatIds: [],
      lockedSeatIds: locked,
      maxSelectable: 2,
    });
    expect(hitLocked.invalidClick).toBe(true);
    expect(hitLocked.changed).toBe(false);

    const s1 = toggleSeatSelection({
      seatId: 'FL-A-R1-S2',
      selectedSeatIds: [],
      lockedSeatIds: locked,
      maxSelectable: 2,
    });
    expect(s1.nextSelectedSeatIds).toEqual(['FL-A-R1-S2']);

    const s2 = toggleSeatSelection({
      seatId: 'FL-A-R1-S3',
      selectedSeatIds: s1.nextSelectedSeatIds,
      lockedSeatIds: locked,
      maxSelectable: 2,
    });
    expect(s2.nextSelectedSeatIds).toEqual(['FL-A-R1-S2', 'FL-A-R1-S3']);

    const overCap = toggleSeatSelection({
      seatId: 'FL-A-R1-S4',
      selectedSeatIds: s2.nextSelectedSeatIds,
      lockedSeatIds: locked,
      maxSelectable: 2,
    });
    expect(overCap.invalidClick).toBe(true);
    expect(overCap.nextSelectedSeatIds).toEqual(['FL-A-R1-S2', 'FL-A-R1-S3']);
  });

  it('handles scramble wave selection conflict while keeping reserved backup solvable', () => {
    const round = generateRound({ mode: 'scramble', difficulty: 'easy', seed: 'conflict-test-1' });
    const wave = round.scrambleWaves[0]!;
    const result = applyScrambleWave({
      round,
      wave,
      currentLockedSeatIds: new Set(round.initialUnavailableSeatIds),
      currentSelectedSeatIds: round.primarySolutionSeatIds,
    });

    expect(result.hadConflict).toBe(true);
    expect(result.newlyConflictedSeatIds.length).toBeGreaterThan(0);
    expect(result.nextSelectedSeatIds.length).toBeLessThan(round.primarySolutionSeatIds.length);
    for (const reservedId of round.reservedSolutionSeatIds) {
      expect(result.nextLockedSeatIds.has(reservedId)).toBe(false);
    }
  });

  it('produces clear diagnostic feedback for over-budget adjacent seats, aisle splits, and backup pivots', () => {
    const round = generateRound({ mode: 'scramble', difficulty: 'easy', seed: 'arena-101' });

    // Force a clean mission test case using round's structure
    const customRound = {
      ...round,
      mission: {
        ...round.mission,
        targetCount: 2,
        totalBudget: 280,
        preferredSections: ['LOW-101'] as const,
        backupSections: ['UP-201'] as const,
      },
    };

    const overBudgetEval = evaluateRound({
      round: {
        ...customRound,
        mission: {
          ...customRound.mission,
          preferredSections: [...customRound.mission.preferredSections],
          backupSections: [...customRound.mission.backupSections],
        },
      },
      selectedSeatIds: ['FL-A-R1-S1', 'FL-A-R1-S2'], // $390 > $280
      elapsedMs: 6000,
      invalidClicks: 0,
      hadSelectionConflict: false,
      appliedWaveCount: 0,
      timedOut: false,
    });
    expect(overBudgetEval.passed).toBe(false);
    expect(overBudgetEval.adjacent).toBe(true);
    expect(overBudgetEval.withinBudget).toBe(false);
    expect(overBudgetEval.feedbackItems.some((msg) => msg.includes('exceeds your $280 virtual budget'))).toBe(true);

    const aisleEval = evaluateRound({
      round: {
        ...customRound,
        mission: {
          ...customRound.mission,
          preferredSections: [...customRound.mission.preferredSections],
          backupSections: [...customRound.mission.backupSections],
        },
      },
      selectedSeatIds: ['LOW-101-R1-S4', 'LOW-101-R1-S5'],
      elapsedMs: 5000,
      invalidClicks: 0,
      hadSelectionConflict: false,
      appliedWaveCount: 0,
      timedOut: false,
    });
    expect(aisleEval.passed).toBe(false);
    expect(aisleEval.adjacent).toBe(false);
    expect(aisleEval.adjacencyReason).toBe('crossed_aisle');
    expect(aisleEval.feedbackItems.some((msg) => msg.includes('cross the center aisle'))).toBe(true);

    const backupEval = evaluateRound({
      round: {
        ...customRound,
        mission: {
          ...customRound.mission,
          preferredSections: [...customRound.mission.preferredSections],
          backupSections: [...customRound.mission.backupSections],
        },
      },
      selectedSeatIds: ['UP-201-R1-S1', 'UP-201-R1-S2'], // $150 <= $280
      elapsedMs: 9000,
      invalidClicks: 0,
      hadSelectionConflict: true,
      appliedWaveCount: 1,
      timedOut: false,
    });
    expect(backupEval.passed).toBe(true);
    expect(backupEval.pivotedToBackup).toBe(true);
    expect(backupEval.score).toBeGreaterThanOrEqual(90);
    expect(backupEval.feedbackItems.some((msg) => msg.includes('pivoted to backup section UP-201'))).toBe(true);

    // Selecting only 1 seat on a 2-seat mission should award 0/20 adjacency points (not 10/20)
    const singleSeatInTwoSeatMission = evaluateRound({
      round: {
        ...customRound,
        mission: {
          ...customRound.mission,
          targetCount: 2,
          totalBudget: 280,
          preferredSections: ['LOW-101'],
          backupSections: ['UP-201'],
        },
      },
      selectedSeatIds: ['LOW-101-R1-S1'],
      elapsedMs: 5000,
      invalidClicks: 0,
      hadSelectionConflict: false,
      appliedWaveCount: 0,
      timedOut: false,
    });
    expect(singleSeatInTwoSeatMission.passed).toBe(false);
    expect(singleSeatInTwoSeatMission.adjacent).toBe(false);
    expect(singleSeatInTwoSeatMission.breakdown.adjacencyPts).toBe(0);
    expect(
      singleSeatInTwoSeatMission.feedbackItems.some((msg) => msg.includes('Adjacency scores 0/20')),
    ).toBe(true);

    // A 1-seat mission explicitly documents auto 20/20 adjacency baseline
    const oneSeatMissionEval = evaluateRound({
      round: {
        ...customRound,
        mission: {
          ...customRound.mission,
          targetCount: 1,
          totalBudget: 150,
          preferredSections: ['LOW-101'],
          backupSections: ['UP-201'],
        },
      },
      selectedSeatIds: ['LOW-101-R1-S1'],
      elapsedMs: 4000,
      invalidClicks: 0,
      hadSelectionConflict: false,
      appliedWaveCount: 0,
      timedOut: false,
    });
    expect(oneSeatMissionEval.passed).toBe(true);
    expect(oneSeatMissionEval.breakdown.adjacencyPts).toBe(20);
    expect(
      oneSeatMissionEval.feedbackItems.some((msg) => msg.includes('20/20 Adjacency baseline')),
    ).toBe(true);
  });
});

describe('Monotonic timer & visibility pause rules', () => {
  it('freezes elapsed time while paused and resumes cleanly from monotonic clock', () => {
    let clock = createClockState(1000, true);
    expect(getElapsedMs(clock, 3500)).toBe(2500);

    clock = pauseClock(clock, 3500, true);
    expect(clock.pausedByVisibility).toBe(true);
    expect(getElapsedMs(clock, 12500)).toBe(2500);

    clock = resumeClock(clock, 12500);
    expect(clock.pausedByVisibility).toBe(false);
    expect(getElapsedMs(clock, 14500)).toBe(4500);
    expect(formatRemainingTime(20000, 4500)).toBe('00:15.5');
    expect(formatRemainingTime(null, 4500)).toBe('00:04 · UNTIMED');
  });
});

describe('Storage graceful degradation when localStorage throws or is unavailable', () => {
  it('falls back to in-memory storage without throwing when localStorage throws SecurityError', () => {
    const brokenStorage: StorageLike = {
      getItem: () => {
        throw new Error('SecurityError: storage disabled');
      },
      setItem: () => {
        throw new Error('SecurityError: storage disabled');
      },
      removeItem: () => {
        throw new Error('SecurityError: storage disabled');
      },
    };

    const safe = createSafeStorage(brokenStorage);
    expect(safe.isPersistent()).toBe(false);
    expect(loadSettings(safe)).toEqual(DEFAULT_SETTINGS);

    saveSettings({ mode: 'drill', difficulty: 'hard', reducedMotion: true }, safe);
    expect(loadSettings(safe)).toEqual({
      mode: 'drill',
      difficulty: 'hard',
      reducedMotion: true,
    });

    appendHistory(
      {
        id: 'r-1',
        completedAtIso: '2026-11-14T12:00:00Z',
        seed: 'arena-101',
        mode: 'quick',
        difficulty: 'easy',
        score: 96,
        passed: true,
        elapsedMs: 7400,
        selectedCount: 2,
        targetCount: 2,
        totalCost: 270,
        totalBudget: 280,
        headline: 'Practice Complete — Mission Passed',
      },
      safe,
    );
    expect(loadHistory(safe)).toHaveLength(1);

    saveActiveRound(
      {
        seed: 'arena-101',
        mode: 'quick',
        difficulty: 'easy',
        phase: 'active',
        selectedSeatIds: ['LOW-101-R1-S1'],
        lockedSeatIds: [],
        conflictSeatIds: [],
        appliedWaveIds: [],
        elapsedMs: 3200,
        waitRemainingMs: 0,
        invalidClicks: 0,
        hadSelectionConflict: false,
        savedAtIso: '2026-11-14T12:00:00Z',
      },
      safe,
    );
    expect(loadActiveRound(safe)?.selectedSeatIds).toEqual(['LOW-101-R1-S1']);
    saveActiveRound(null, safe);
    expect(loadActiveRound(safe)).toBeNull();
  });
});
