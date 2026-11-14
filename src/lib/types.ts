export type GameMode = 'quick' | 'scramble' | 'drill';
export type Difficulty = 'easy' | 'hard' | 'untimed';
export type SectionId = 'FL-A' | 'FL-B' | 'LOW-101' | 'LOW-102' | 'UP-201';
export type SectionTier = 'floor' | 'lower' | 'upper';

export type SeatInitialStatus = 'available' | 'unavailable';
export type SeatVisualStatus =
  | 'available'
  | 'over_budget'
  | 'selected'
  | 'unavailable'
  | 'conflict_lost';

export interface SeatNode {
  id: string;
  sectionId: SectionId;
  row: number;
  rowLabel: string;
  seatNumber: number;
  side: 'left' | 'right';
  aisleAfter: boolean;
  price: number;
  /** SVG box coordinates inside 960x640 venue map */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VenueSection {
  id: SectionId;
  name: string;
  shortLabel: string;
  tier: SectionTier;
  basePrice: number;
  box: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  zoomViewBox: string;
  rowCount: number;
  seatsPerRow: number;
  aisleAfterSeat: number;
}

export interface VenueDefinition {
  id: string;
  name: string;
  disclaimer: string;
  viewBox: string;
  width: number;
  height: number;
  sections: VenueSection[];
  seats: SeatNode[];
  seatById: Record<string, SeatNode>;
  adjacencyGraph: Record<string, string[]>;
}

export interface PracticeMission {
  title: string;
  summary: string;
  targetCount: number;
  totalBudget: number;
  maxPerTicket: number;
  preferredSections: SectionId[];
  backupSections: SectionId[];
  requireAdjacent: boolean;
}

export interface ScrambleWave {
  id: string;
  triggerAtElapsedMs: number;
  lockSeatIds: string[];
  headline: string;
  detail: string;
}

export interface GeneratedRound {
  seed: string;
  mode: GameMode;
  difficulty: Difficulty;
  mission: PracticeMission;
  timeLimitMs: number | null;
  waitStageMs: number;
  initialUnavailableSeatIds: string[];
  scrambleWaves: ScrambleWave[];
  reservedSolutionSeatIds: string[];
  primarySolutionSeatIds: string[];
}

export type AdjacencyReason =
  | 'empty'
  | 'unknown_seat'
  | 'different_section_or_row'
  | 'crossed_aisle'
  | 'gap_in_row';

export interface AdjacencyCheckResult {
  adjacent: boolean;
  reason?: AdjacencyReason;
}

export interface ScoreBreakdown {
  seatCountPts: number;
  adjacencyPts: number;
  budgetPts: number;
  sectionPts: number;
  speedPts: number;
  precisionPts: number;
}

export interface RoundEvaluationInput {
  round: GeneratedRound;
  selectedSeatIds: string[];
  elapsedMs: number;
  invalidClicks: number;
  hadSelectionConflict: boolean;
  appliedWaveCount: number;
  timedOut: boolean;
}

export interface RoundResult {
  passed: boolean;
  score: number;
  breakdown: ScoreBreakdown;
  selectedCount: number;
  totalCost: number;
  adjacent: boolean;
  adjacencyReason?: AdjacencyReason;
  withinBudget: boolean;
  inPreferredSection: boolean;
  inBackupSection: boolean;
  pivotedToBackup: boolean;
  elapsedMs: number;
  invalidClicks: number;
  hadSelectionConflict: boolean;
  timedOut: boolean;
  feedbackItems: string[];
  headline: string;
}

export interface PracticeSettings {
  mode: GameMode;
  difficulty: Difficulty;
  reducedMotion: boolean;
}

export interface PracticeHistoryEntry {
  id: string;
  completedAtIso: string;
  seed: string;
  mode: GameMode;
  difficulty: Difficulty;
  score: number;
  passed: boolean;
  elapsedMs: number;
  selectedCount: number;
  targetCount: number;
  totalCost: number;
  totalBudget: number;
  headline: string;
}

export type RoundPhase =
  | 'ready'
  | 'waiting_room'
  | 'active'
  | 'paused_visibility'
  | 'completed';

export interface ActiveRoundSnapshot {
  seed: string;
  mode: GameMode;
  difficulty: Difficulty;
  phase: RoundPhase;
  selectedSeatIds: string[];
  lockedSeatIds: string[];
  conflictSeatIds: string[];
  appliedWaveIds: string[];
  elapsedMs: number;
  waitRemainingMs: number;
  invalidClicks: number;
  hadSelectionConflict: boolean;
  savedAtIso: string;
}
