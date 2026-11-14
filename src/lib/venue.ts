import type {
  AdjacencyCheckResult,
  SeatNode,
  SectionId,
  VenueDefinition,
  VenueSection,
} from './types';

interface SectionBlueprint {
  id: SectionId;
  name: string;
  shortLabel: string;
  tier: VenueSection['tier'];
  basePrice: number;
  x: number;
  y: number;
  width: number;
  height: number;
  zoomViewBox: string;
}

const SECTION_BLUEPRINTS: readonly SectionBlueprint[] = [
  {
    id: 'FL-A',
    name: 'Floor Center West',
    shortLabel: 'FL-A',
    tier: 'floor',
    basePrice: 195,
    x: 68,
    y: 112,
    width: 392,
    height: 152,
    zoomViewBox: '48 92 432 192',
  },
  {
    id: 'FL-B',
    name: 'Floor Center East',
    shortLabel: 'FL-B',
    tier: 'floor',
    basePrice: 185,
    x: 500,
    y: 112,
    width: 392,
    height: 152,
    zoomViewBox: '480 92 432 192',
  },
  {
    id: 'LOW-101',
    name: 'Lower Bowl West 101',
    shortLabel: 'LOW-101',
    tier: 'lower',
    basePrice: 135,
    x: 68,
    y: 288,
    width: 392,
    height: 152,
    zoomViewBox: '48 268 432 192',
  },
  {
    id: 'LOW-102',
    name: 'Lower Bowl East 102',
    shortLabel: 'LOW-102',
    tier: 'lower',
    basePrice: 125,
    x: 500,
    y: 288,
    width: 392,
    height: 152,
    zoomViewBox: '480 268 432 192',
  },
  {
    id: 'UP-201',
    name: 'Upper Terrace Center 201',
    shortLabel: 'UP-201',
    tier: 'upper',
    basePrice: 75,
    x: 244,
    y: 464,
    width: 472,
    height: 152,
    zoomViewBox: '224 444 512 192',
  },
];

const ROW_COUNT = 3;
const SEATS_PER_ROW = 8;
const AISLE_AFTER_SEAT = 4;

function buildDemoVenue(): VenueDefinition {
  const sections: VenueSection[] = [];
  const seats: SeatNode[] = [];
  const seatById: Record<string, SeatNode> = {};
  const adjacencyGraph: Record<string, string[]> = {};

  for (const bp of SECTION_BLUEPRINTS) {
    sections.push({
      id: bp.id,
      name: bp.name,
      shortLabel: bp.shortLabel,
      tier: bp.tier,
      basePrice: bp.basePrice,
      box: { x: bp.x, y: bp.y, width: bp.width, height: bp.height },
      zoomViewBox: bp.zoomViewBox,
      rowCount: ROW_COUNT,
      seatsPerRow: SEATS_PER_ROW,
      aisleAfterSeat: AISLE_AFTER_SEAT,
    });

    const headerHeight = 32;
    const innerPadX = 36;
    const aisleGap = 32;
    const seatGap = 6;
    const usableWidth = bp.width - innerPadX - 14 - aisleGap - seatGap * (SEATS_PER_ROW - 2);
    const seatWidth = Math.floor(usableWidth / SEATS_PER_ROW);
    const seatHeight = 30;
    const rowStep = 36;

    for (let row = 1; row <= ROW_COUNT; row++) {
      const rowLabel = `R${row}`;
      const rowY = bp.y + headerHeight + (row - 1) * rowStep;
      const rowSeatIds: string[] = [];

      for (let seatNum = 1; seatNum <= SEATS_PER_ROW; seatNum++) {
        const id = `${bp.id}-${rowLabel}-S${seatNum}`;
        const side: 'left' | 'right' = seatNum <= AISLE_AFTER_SEAT ? 'left' : 'right';
        const extraAisle = seatNum > AISLE_AFTER_SEAT ? aisleGap - seatGap : 0;
        const x = bp.x + innerPadX + (seatNum - 1) * (seatWidth + seatGap) + extraAisle;

        const node: SeatNode = {
          id,
          sectionId: bp.id,
          row,
          rowLabel,
          seatNumber: seatNum,
          side,
          aisleAfter: seatNum === AISLE_AFTER_SEAT,
          price: bp.basePrice,
          x,
          y: rowY,
          width: seatWidth,
          height: seatHeight,
        };

        seats.push(node);
        seatById[id] = node;
        adjacencyGraph[id] = [];
        rowSeatIds.push(id);
      }

      // Build explicit left/right adjacency edges; never link S4 <-> S5 across the center aisle.
      for (let i = 0; i < rowSeatIds.length - 1; i++) {
        const currentId = rowSeatIds[i]!;
        const nextId = rowSeatIds[i + 1]!;
        const currentSeat = seatById[currentId]!;
        if (currentSeat.aisleAfter) {
          continue;
        }
        adjacencyGraph[currentId]!.push(nextId);
        adjacencyGraph[nextId]!.push(currentId);
      }
    }
  }

  return {
    id: 'starlight-civic-arena-demo',
    name: 'Starlight Civic Arena (Fictional Demo Venue)',
    disclaimer: 'Fictional demo layout and virtual prices for practice only.',
    viewBox: '0 0 960 636',
    width: 960,
    height: 636,
    sections,
    seats,
    seatById,
    adjacencyGraph,
  };
}

export const DEMO_VENUE: VenueDefinition = buildDemoVenue();

export function getSectionById(sectionId: SectionId, venue = DEMO_VENUE): VenueSection {
  const found = venue.sections.find((s) => s.id === sectionId);
  if (!found) {
    throw new Error(`Unknown section: ${sectionId}`);
  }
  return found;
}

/**
 * Checks whether a list of seat IDs forms a single connected contiguous block
 * in the venue's explicit adjacency graph (never bridging across an aisle).
 */
export function areSeatsAdjacent(
  seatIds: readonly string[],
  venue: VenueDefinition = DEMO_VENUE,
): AdjacencyCheckResult {
  if (seatIds.length === 0) {
    return { adjacent: false, reason: 'empty' };
  }

  const uniqueIds = Array.from(new Set(seatIds));
  const nodes: SeatNode[] = [];

  for (const id of uniqueIds) {
    const node = venue.seatById[id];
    if (!node) {
      return { adjacent: false, reason: 'unknown_seat' };
    }
    nodes.push(node);
  }

  if (nodes.length === 1) {
    return { adjacent: true };
  }

  const first = nodes[0]!;
  const sameRowAndSection = nodes.every(
    (n) => n.sectionId === first.sectionId && n.row === first.row,
  );
  if (!sameRowAndSection) {
    return { adjacent: false, reason: 'different_section_or_row' };
  }

  // BFS in the explicit adjacency graph restricted to selected seats
  const selectedSet = new Set(uniqueIds);
  const visited = new Set<string>([first.id]);
  const queue: string[] = [first.id];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbors = venue.adjacencyGraph[current] ?? [];
    for (const neighbor of neighbors) {
      if (selectedSet.has(neighbor) && !visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  if (visited.size === selectedSet.size) {
    return { adjacent: true };
  }

  // Distinguish crossing an aisle vs leaving an empty gap in the same side
  const sortedNumbers = [...nodes].map((n) => n.seatNumber).sort((a, b) => a - b);
  let consecutiveNumbers = true;
  for (let i = 1; i < sortedNumbers.length; i++) {
    if (sortedNumbers[i]! !== sortedNumbers[i - 1]! + 1) {
      consecutiveNumbers = false;
      break;
    }
  }

  const section = getSectionById(first.sectionId, venue);
  const crossesAisle =
    sortedNumbers.some((n) => n <= section.aisleAfterSeat) &&
    sortedNumbers.some((n) => n > section.aisleAfterSeat);

  if (consecutiveNumbers && crossesAisle) {
    return { adjacent: false, reason: 'crossed_aisle' };
  }
  if (crossesAisle) {
    return { adjacent: false, reason: 'crossed_aisle' };
  }
  return { adjacent: false, reason: 'gap_in_row' };
}

/**
 * Enumerates every valid contiguous block of `count` seats on one side of an aisle
 * within the specified sections and not present in `blockedSet`.
 */
export function findValidSeatBlocks(
  count: number,
  blockedSet: ReadonlySet<string>,
  allowedSections?: readonly SectionId[],
  maxTotalBudget?: number,
  venue: VenueDefinition = DEMO_VENUE,
): string[][] {
  if (count < 1 || count > 4) return [];

  const blocks: string[][] = [];
  const targetSections = allowedSections
    ? venue.sections.filter((s) => allowedSections.includes(s.id))
    : venue.sections;

  for (const section of targetSections) {
    for (let row = 1; row <= section.rowCount; row++) {
      // Split strictly into left side (1..4) and right side (5..8)
      const sides: number[][] = [
        [1, 2, 3, 4],
        [5, 6, 7, 8],
      ];
      for (const sideSeats of sides) {
        for (let startIdx = 0; startIdx <= sideSeats.length - count; startIdx++) {
          const sliceIds = sideSeats
            .slice(startIdx, startIdx + count)
            .map((seatNum) => `${section.id}-R${row}-S${seatNum}`);

          if (sliceIds.some((id) => blockedSet.has(id))) {
            continue;
          }

          const totalCost = sliceIds.reduce(
            (sum, id) => sum + (venue.seatById[id]?.price ?? 0),
            0,
          );
          if (maxTotalBudget !== undefined && totalCost > maxTotalBudget) {
            continue;
          }

          blocks.push(sliceIds);
        }
      }
    }
  }

  return blocks;
}

export function calculateSeatsCost(
  seatIds: readonly string[],
  venue: VenueDefinition = DEMO_VENUE,
): number {
  return seatIds.reduce((sum, id) => sum + (venue.seatById[id]?.price ?? 0), 0);
}
