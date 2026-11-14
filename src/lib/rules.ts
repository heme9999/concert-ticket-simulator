import type { GeneratedRound, ScrambleWave, SectionId } from './types';
import { DEMO_VENUE, findValidSeatBlocks } from './venue';

export interface ToggleSeatOutcome {
  nextSelectedSeatIds: string[];
  changed: boolean;
  invalidClick: boolean;
  notice?: string;
}

/**
 * Pure state transition for clicking/tapping a seat on the SVG seat map.
 */
export function toggleSeatSelection(params: {
  seatId: string;
  selectedSeatIds: readonly string[];
  lockedSeatIds: ReadonlySet<string>;
  maxSelectable: number;
}): ToggleSeatOutcome {
  const { seatId, selectedSeatIds, lockedSeatIds, maxSelectable } = params;
  const seat = DEMO_VENUE.seatById[seatId];

  if (!seat) {
    return {
      nextSelectedSeatIds: [...selectedSeatIds],
      changed: false,
      invalidClick: true,
      notice: 'Unknown seat selected.',
    };
  }

  if (lockedSeatIds.has(seatId)) {
    return {
      nextSelectedSeatIds: [...selectedSeatIds],
      changed: false,
      invalidClick: true,
      notice: `${seat.sectionId} ${seat.rowLabel}-S${seat.seatNumber} is unavailable.`,
    };
  }

  if (selectedSeatIds.includes(seatId)) {
    return {
      nextSelectedSeatIds: selectedSeatIds.filter((id) => id !== seatId),
      changed: true,
      invalidClick: false,
      notice: `Removed ${seat.sectionId} ${seat.rowLabel}-S${seat.seatNumber}.`,
    };
  }

  const limit = Math.min(4, Math.max(1, maxSelectable));
  if (selectedSeatIds.length >= limit) {
    return {
      nextSelectedSeatIds: [...selectedSeatIds],
      changed: false,
      invalidClick: true,
      notice: `Maximum ${limit} ${limit === 1 ? 'seat' : 'seats'} allowed for this drill. Deselect a seat first.`,
    };
  }

  return {
    nextSelectedSeatIds: [...selectedSeatIds, seatId],
    changed: true,
    invalidClick: false,
    notice: `Selected ${seat.sectionId} ${seat.rowLabel}-S${seat.seatNumber} ($${seat.price}).`,
  };
}

export interface WaveApplicationResult {
  nextLockedSeatIds: Set<string>;
  nextSelectedSeatIds: string[];
  newlyConflictedSeatIds: string[];
  hadConflict: boolean;
  announcement: string;
}

/**
 * Applies a simulated scramble wave while preserving at least one guaranteed
 * solvable backup block. If the user currently selected seats in a preferred
 * section and the wave can safely snag one of them without breaking solvability,
 * it triggers a realistic selection conflict for practice.
 */
export function applyScrambleWave(params: {
  round: GeneratedRound;
  wave: ScrambleWave;
  currentLockedSeatIds: ReadonlySet<string>;
  currentSelectedSeatIds: readonly string[];
}): WaveApplicationResult {
  const { round, wave, currentLockedSeatIds, currentSelectedSeatIds } = params;
  const nextLocked = new Set(currentLockedSeatIds);
  const reservedSet = new Set(round.reservedSolutionSeatIds);

  for (const id of wave.lockSeatIds) {
    if (!reservedSet.has(id)) {
      nextLocked.add(id);
    }
  }

  // If the user is holding seats in a preferred section and none of the static
  // wave seats conflicted yet, lock one of their preferred seats only if a solvable
  // block in preferred/backup sections remains available afterwards.
  const currentlySelectedInPreferred = currentSelectedSeatIds.filter((id) => {
    const seat = DEMO_VENUE.seatById[id];
    return (
      seat &&
      round.mission.preferredSections.includes(seat.sectionId) &&
      !reservedSet.has(id)
    );
  });

  const staticConflict = currentSelectedSeatIds.some((id) => nextLocked.has(id));

  if (!staticConflict && currentlySelectedInPreferred.length > 0) {
    const candidateConflict = currentlySelectedInPreferred[0]!;
    const trialLocked = new Set(nextLocked);
    trialLocked.add(candidateConflict);
    const allowed: SectionId[] = [
      ...round.mission.preferredSections,
      ...round.mission.backupSections,
    ];
    const remainingValid = findValidSeatBlocks(
      round.mission.targetCount,
      trialLocked,
      allowed,
      round.mission.totalBudget,
      DEMO_VENUE,
    );
    if (remainingValid.length > 0) {
      nextLocked.add(candidateConflict);
    }
  }

  const newlyConflictedSeatIds = currentSelectedSeatIds.filter((id) => nextLocked.has(id));
  const nextSelectedSeatIds = currentSelectedSeatIds.filter((id) => !nextLocked.has(id));
  const hadConflict = newlyConflictedSeatIds.length > 0;

  const announcement = hadConflict
    ? `Seat conflict: ${newlyConflictedSeatIds.join(', ')} became unavailable during live demand. Switch to a backup block within $${round.mission.totalBudget}.`
    : wave.detail;

  return {
    nextLockedSeatIds: nextLocked,
    nextSelectedSeatIds,
    newlyConflictedSeatIds,
    hadConflict,
    announcement,
  };
}
