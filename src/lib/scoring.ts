import type { RoundEvaluationInput, RoundResult, ScoreBreakdown } from './types';
import { DEMO_VENUE, areSeatsAdjacent, calculateSeatsCost } from './venue';

/**
 * Evaluates a completed or timed-out practice round against transparent rules.
 * Strictly computes a Practice Score (never a real-world ticket success rate).
 */
export function evaluateRound(input: RoundEvaluationInput): RoundResult {
  const {
    round,
    selectedSeatIds,
    elapsedMs,
    invalidClicks,
    hadSelectionConflict,
    appliedWaveCount,
    timedOut,
  } = input;

  const { mission } = round;
  const selectedCount = selectedSeatIds.length;
  const countMet = selectedCount === mission.targetCount;
  const totalCost = calculateSeatsCost(selectedSeatIds, DEMO_VENUE);
  const withinBudget = selectedCount > 0 && totalCost <= mission.totalBudget;

  const adjCheck = areSeatsAdjacent(selectedSeatIds, DEMO_VENUE);
  const adjacent =
    mission.targetCount === 1 ? countMet : selectedCount >= 2 && adjCheck.adjacent;

  const selectedSections = new Set(
    selectedSeatIds
      .map((id) => DEMO_VENUE.seatById[id]?.sectionId)
      .filter((s): s is NonNullable<typeof s> => Boolean(s)),
  );

  const singleSection = selectedSections.size === 1;
  const chosenSection = singleSection ? Array.from(selectedSections)[0] : undefined;

  const inPreferredSection = Boolean(
    chosenSection && mission.preferredSections.includes(chosenSection),
  );
  const inBackupSection = Boolean(
    chosenSection && mission.backupSections.includes(chosenSection),
  );
  const sectionMet = inPreferredSection || inBackupSection;
  const pivotedToBackup =
    inBackupSection && (hadSelectionConflict || appliedWaveCount > 0);

  const passed = !timedOut && countMet && adjacent && withinBudget && sectionMet;

  // Transparent 100-point Practice Score breakdown
  const seatCountPts = countMet
    ? 20
    : Math.round((Math.min(selectedCount, mission.targetCount) / mission.targetCount) * 12);

  const adjacencyPts =
    mission.targetCount === 1
      ? countMet
        ? 20
        : 0
      : adjacent && countMet
        ? 20
        : adjacent
          ? 10
          : 0;

  const budgetPts =
    selectedCount === 0 ? 0 : withinBudget ? 20 : totalCost <= mission.totalBudget * 1.15 ? 8 : 0;

  const sectionPts = inPreferredSection
    ? 20
    : pivotedToBackup
      ? 20
      : inBackupSection
        ? 16
        : 0;

  let speedPts = 0;
  if (!timedOut && countMet && adjacent && withinBudget) {
    if (round.timeLimitMs === null) {
      speedPts = 10;
    } else {
      const remainingRatio = Math.max(
        0,
        Math.min(1, (round.timeLimitMs - elapsedMs) / round.timeLimitMs),
      );
      speedPts = Math.round(4 + remainingRatio * 6);
    }
  }

  const precisionPts = Math.max(0, 10 - invalidClicks * 2);

  const breakdown: ScoreBreakdown = {
    seatCountPts,
    adjacencyPts,
    budgetPts,
    sectionPts,
    speedPts,
    precisionPts,
  };

  const score = Math.max(
    0,
    Math.min(
      100,
      seatCountPts + adjacencyPts + budgetPts + sectionPts + speedPts + precisionPts,
    ),
  );

  const feedbackItems: string[] = [];

  if (timedOut) {
    feedbackItems.push(
      `Time expired before confirming ${mission.targetCount} valid seats (${selectedCount}/${mission.targetCount} selected).`,
    );
  }

  if (!countMet) {
    feedbackItems.push(
      `Selected ${selectedCount} of ${mission.targetCount} required ${mission.targetCount === 1 ? 'seat' : 'seats'}.`,
    );
    if (mission.targetCount > 1 && selectedCount === 1) {
      feedbackItems.push(
        `A single confirmed seat has no adjacent neighbor pair for a ${mission.targetCount}-seat mission, so Adjacency scores 0/20.`,
      );
    }
  } else if (mission.targetCount === 1) {
    if (withinBudget) {
      feedbackItems.push(
        `Confirmed 1 seat within your $${mission.totalBudget} virtual budget ($${totalCost} total). 1-seat drills have no neighbor requirement, so the 20/20 Adjacency baseline is awarded automatically.`,
      );
    }
  } else if (mission.targetCount > 1 && adjacent) {
    if (!withinBudget) {
      feedbackItems.push(
        `Found ${mission.targetCount} adjacent seats, but total price ($${totalCost}) exceeds your $${mission.totalBudget} virtual budget. (已找到 ${mission.targetCount} 张相邻座位，但总价超过预算。)`,
      );
    } else {
      feedbackItems.push(
        `Locked ${mission.targetCount} connected seats within $${mission.totalBudget} virtual budget ($${totalCost} total).`,
      );
    }
  }

  if (mission.targetCount > 1 && selectedCount > 1 && !adjacent) {
    if (adjCheck.reason === 'crossed_aisle') {
      feedbackItems.push(
        `Selected seats cross the center aisle (Seats 4 and 5 are separated by an aisle and are not adjacent). (所选座位跨越了过道，不能算相邻座位。)`,
      );
    } else if (adjCheck.reason === 'different_section_or_row') {
      feedbackItems.push(
        `Selected seats span different rows or sections instead of sitting together in one row.`,
      );
    } else {
      feedbackItems.push(`Selected seats leave an empty gap between seats in the row.`);
    }
  }

  if (countMet && adjacent && !withinBudget && mission.targetCount === 1) {
    feedbackItems.push(
      `Selected seat ($${totalCost}) exceeds your $${mission.totalBudget} virtual budget. (1-seat drills award the 20/20 Adjacency baseline automatically once count is met.)`,
    );
  }

  if (pivotedToBackup && passed) {
    feedbackItems.push(
      `After primary section availability shifted, you successfully pivoted to backup section ${chosenSection} within budget. (原区域不可选后，成功切换到备选区域。)`,
    );
  } else if (hadSelectionConflict && !passed) {
    feedbackItems.push(
      `A simulated scramble wave claimed one of your selected seats mid-round; re-pick a complete block before confirming.`,
    );
  } else if (countMet && !sectionMet) {
    feedbackItems.push(
      `Selected seats are outside the mission's target (${mission.preferredSections.join(', ')}) and backup (${mission.backupSections.join(', ')}) sections.`,
    );
  }

  if (invalidClicks === 0 && passed) {
    feedbackItems.push(`Clean execution with 0 invalid clicks.`);
  } else if (invalidClicks > 0) {
    feedbackItems.push(
      `${invalidClicks} invalid ${invalidClicks === 1 ? 'click' : 'clicks'} recorded on unavailable or capped seats (-${Math.min(10, invalidClicks * 2)} precision pts).`,
    );
  }

  let headline = 'Practice Complete — Mission Passed';
  if (timedOut) {
    headline = 'Time Up — Review & Retry Seed';
  } else if (!passed && adjacent && countMet && !withinBudget) {
    headline = 'Adjacent Seats Found, Over Virtual Budget';
  } else if (!passed && adjCheck.reason === 'crossed_aisle') {
    headline = 'Aisle Split Detected — Not Adjacent';
  } else if (!passed) {
    headline = 'Requirements Incomplete — Review Breakdown';
  } else if (pivotedToBackup) {
    headline = 'Clean Backup Pivot — Mission Passed';
  }

  return {
    passed,
    score,
    breakdown,
    selectedCount,
    totalCost,
    adjacent,
    adjacencyReason: adjCheck.reason,
    withinBudget,
    inPreferredSection,
    inBackupSection,
    pivotedToBackup,
    elapsedMs,
    invalidClicks,
    hadSelectionConflict,
    timedOut,
    feedbackItems,
    headline,
  };
}
