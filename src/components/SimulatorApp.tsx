import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { registerCopyInvoker } from '@/lib/clipboard';
import { generateRound, getTimeLimitMs } from '@/lib/generator';
import {
  buildPracticePath,
  generateRandomSeed,
  parsePracticeParams,
  sanitizeSeed,
} from '@/lib/prng';
import { applyScrambleWave, toggleSeatSelection } from '@/lib/rules';
import { evaluateRound } from '@/lib/scoring';
import {
  appendHistory,
  createSafeStorage,
  loadActiveRound,
  loadHistory,
  loadSettings,
  saveActiveRound,
  saveSettings,
} from '@/lib/storage';
import {
  createClockState,
  formatRemainingTime,
  getElapsedMs,
  getTotalForegroundTime,
  pauseClock,
  resumeClock,
  type MonotonicClockState,
} from '@/lib/timer';
import type {
  Difficulty,
  GameMode,
  PracticeHistoryEntry,
  PracticeSettings,
  RoundPhase,
  RoundResult,
} from '@/lib/types';
import { areSeatsAdjacent, calculateSeatsCost, DEMO_VENUE } from '@/lib/venue';
import { SeatMapSvg, type MapZoomTarget } from './SeatMapSvg';

interface SimulatorAppProps {
  initialMode?: GameMode;
  initialDifficulty?: Difficulty;
  initialSeed?: string;
  compactHeader?: boolean;
}

const MODE_META: Record<
  GameMode,
  { label: string; badge: string; shortDesc: string }
> = {
  quick: {
    label: 'Quick Pick',
    badge: 'Mode 1',
    shortDesc: 'Spot adjacent seats within budget without crossing an aisle.',
  },
  scramble: {
    label: 'Live Scramble',
    badge: 'Mode 2',
    shortDesc: 'Seats lock mid-round—pivot cleanly to an affordable backup zone.',
  },
  drill: {
    label: 'Full Drill',
    badge: 'Mode 3',
    shortDesc: 'Skippable queue handoff into timed live seat selection & review.',
  },
};

const DIFFICULTY_META: Record<Difficulty, { label: string; hint: string }> = {
  easy: { label: 'Easy', hint: 'Generous clock · Fewer waves' },
  hard: { label: 'Hard', hint: 'Short clock · More waves' },
  untimed: { label: 'Untimed', hint: 'No countdown · Learn rules' },
};

export const SimulatorApp: React.FC<SimulatorAppProps> = ({
  initialMode = 'quick',
  initialDifficulty = 'easy',
  initialSeed = 'arena-101',
  compactHeader = false,
}) => {
  const storage = useMemo(() => createSafeStorage(), []);
  const [storagePersistent, setStoragePersistent] = useState<boolean>(true);

  const [mode, setMode] = useState<GameMode>(initialMode);
  const [difficulty, setDifficulty] = useState<Difficulty>(initialDifficulty);
  const [seed, setSeed] = useState<string>(() => sanitizeSeed(initialSeed));
  const [reducedMotion, setReducedMotion] = useState<boolean>(false);

  const round = useMemo(
    () => generateRound({ mode, difficulty, seed }),
    [mode, difficulty, seed],
  );

  const [phase, setPhase] = useState<RoundPhase>('ready');
  const [selectedSeatIds, setSelectedSeatIds] = useState<string[]>([]);
  const [lockedSeatIds, setLockedSeatIds] = useState<Set<string>>(
    () => new Set(round.initialUnavailableSeatIds),
  );
  const [conflictSeatIds, setConflictSeatIds] = useState<Set<string>>(() => new Set());
  const [appliedWaveIds, setAppliedWaveIds] = useState<string[]>([]);
  const [invalidClicks, setInvalidClicks] = useState<number>(0);
  const [hadSelectionConflict, setHadSelectionConflict] = useState<boolean>(false);
  const [statusNotice, setStatusNotice] = useState<string>(
    'Select a mode above and tap seats on the map (or press Start Drill) to begin.',
  );
  const [waitRemainingMs, setWaitRemainingMs] = useState<number>(round.waitStageMs);
  const [elapsedDisplayMs, setElapsedDisplayMs] = useState<number>(0);
  const [result, setResult] = useState<RoundResult | null>(null);
  const [history, setHistory] = useState<PracticeHistoryEntry[]>([]);
  const [resumePromptVisible, setResumePromptVisible] = useState<boolean>(false);
  const [savedRoundPreview, setSavedRoundPreview] = useState<{
    mode: GameMode;
    difficulty: Difficulty;
    seed: string;
    selectedCount: number;
    remainingLabel: string;
  } | null>(null);
  const [foregroundFocusSec, setForegroundFocusSec] = useState<number | null>(null);

  const [zoomTarget, setZoomTarget] = useState<MapZoomTarget>('ALL');
  const [zoomScale, setZoomScale] = useState<number>(1);
  const [focusedSeatId, setFocusedSeatId] = useState<string>(
    () => DEMO_VENUE.seats[0]?.id ?? 'FL-A-R1-S1',
  );
  const [originUrl, setOriginUrl] = useState<string>('https://concert-ticket-simulator.pages.dev');

  const clockRef = useRef<MonotonicClockState>(createClockState(0, false));
  const appliedWavesRef = useRef<Set<string>>(new Set());
  const roundFinishedRef = useRef<boolean>(false);
  const selectedIdsRef = useRef<string[]>(selectedSeatIds);
  const lockedIdsRef = useRef<Set<string>>(lockedSeatIds);

  selectedIdsRef.current = selectedSeatIds;
  lockedIdsRef.current = lockedSeatIds;

  // Sync Invoker Command copy button & hydrate settings/URL params/saved progress on client mount
  useEffect(() => {
    const cleanupCopy = registerCopyInvoker();
    setOriginUrl(window.location.origin);

    const savedSettings = loadSettings(storage);
    const hasSearch = Boolean(window.location.search);
    const queryParams = hasSearch
      ? parsePracticeParams(window.location.search, {
          mode: savedSettings.mode,
          difficulty: savedSettings.difficulty,
          seed: initialSeed,
        })
      : {
          mode: initialMode !== 'quick' ? initialMode : savedSettings.mode,
          difficulty:
            initialDifficulty !== 'easy' ? initialDifficulty : savedSettings.difficulty,
          seed: sanitizeSeed(initialSeed),
        };

    const prefersReduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    setReducedMotion(savedSettings.reducedMotion || prefersReduced);
    setStoragePersistent(storage.isPersistent());
    setMode(queryParams.mode);
    setDifficulty(queryParams.difficulty);
    setSeed(queryParams.seed);
    setHistory(loadHistory(storage));

    const savedActive = loadActiveRound(storage);
    if (
      savedActive &&
      (savedActive.phase === 'active' || savedActive.phase === 'paused_visibility') &&
      savedActive.selectedSeatIds.length > 0
    ) {
      const savedLimitMs = getTimeLimitMs(savedActive.mode, savedActive.difficulty);
      const remainingMs =
        savedLimitMs === null ? null : Math.max(0, savedLimitMs - savedActive.elapsedMs);
      if (remainingMs !== null && remainingMs <= 1000) {
        saveActiveRound(null, storage);
      } else {
        setSavedRoundPreview({
          mode: savedActive.mode,
          difficulty: savedActive.difficulty,
          seed: savedActive.seed,
          selectedCount: savedActive.selectedSeatIds.length,
          remainingLabel:
            savedLimitMs === null
              ? `${(savedActive.elapsedMs / 1000).toFixed(1)}s elapsed (Untimed)`
              : `${formatRemainingTime(savedLimitMs, savedActive.elapsedMs)} left`,
        });
        setResumePromptVisible(true);
      }
    } else if (savedActive) {
      saveActiveRound(null, storage);
    }

    return cleanupCopy;
  }, [initialDifficulty, initialMode, initialSeed, storage]);

  // Reset round state cleanly whenever generated round changes
  const resetRoundState = useCallback(
    (targetMode: GameMode, targetDifficulty: Difficulty, targetSeed: string, autoStart = false) => {
      const nextRound = generateRound({
        mode: targetMode,
        difficulty: targetDifficulty,
        seed: targetSeed,
      });
      setSelectedSeatIds([]);
      setLockedSeatIds(new Set(nextRound.initialUnavailableSeatIds));
      setConflictSeatIds(new Set());
      setAppliedWaveIds([]);
      appliedWavesRef.current = new Set();
      roundFinishedRef.current = false;
      setInvalidClicks(0);
      setHadSelectionConflict(false);
      setResult(null);
      setForegroundFocusSec(null);
      setElapsedDisplayMs(0);
      setWaitRemainingMs(nextRound.waitStageMs);
      clockRef.current = createClockState(performance.now(), false);

      if (autoStart) {
        if (nextRound.waitStageMs > 0) {
          setPhase('waiting_room');
          setStatusNotice(
            'Simulated queue transition active — review your target mission or skip straight to the map.',
          );
        } else {
          clockRef.current = createClockState(performance.now(), true);
          setPhase('active');
          setStatusNotice(nextRound.mission.summary);
        }
      } else {
        setPhase('ready');
        setStatusNotice(
          nextRound.mode === 'drill'
            ? 'Full Drill ready: press Start Practice to run the skippable queue transition.'
            : 'Ready: tap any open seat on the map or press Start Practice to begin.',
        );
      }
      saveActiveRound(null, storage);
    },
    [storage],
  );

  // Persist settings changes
  useEffect(() => {
    const nextSettings: PracticeSettings = {
      mode,
      difficulty,
      reducedMotion,
    };
    saveSettings(nextSettings, storage);
  }, [mode, difficulty, reducedMotion, storage]);

  const finishRound = useCallback(
    (
      finalSelectedIds: readonly string[],
      timedOut: boolean,
      finalElapsedMs?: number,
    ) => {
      roundFinishedRef.current = true;
      const elapsed =
        finalElapsedMs ?? getElapsedMs(clockRef.current, performance.now());
      clockRef.current = pauseClock(clockRef.current, performance.now(), false);
      setElapsedDisplayMs(elapsed);
      setPhase('completed');
      setForegroundFocusSec(Math.round(getTotalForegroundTime() / 100) / 10);

      const evaluated = evaluateRound({
        round,
        selectedSeatIds: [...finalSelectedIds],
        elapsedMs: elapsed,
        invalidClicks,
        hadSelectionConflict,
        appliedWaveCount: appliedWaveIds.length,
        timedOut,
      });
      setResult(evaluated);
      setStatusNotice(evaluated.headline);

      const nextHistory = appendHistory(
        {
          id: `${Date.now()}-${round.seed}`,
          completedAtIso: new Date().toISOString(),
          seed: round.seed,
          mode: round.mode,
          difficulty: round.difficulty,
          score: evaluated.score,
          passed: evaluated.passed,
          elapsedMs: evaluated.elapsedMs,
          selectedCount: evaluated.selectedCount,
          targetCount: round.mission.targetCount,
          totalCost: evaluated.totalCost,
          totalBudget: round.mission.totalBudget,
          headline: evaluated.headline,
        },
        storage,
      );
      setHistory(nextHistory);
      saveActiveRound(null, storage);
    },
    [appliedWaveIds.length, hadSelectionConflict, invalidClicks, round, storage],
  );

  // Save in-progress round snapshot to localStorage for refresh recovery
  useEffect(() => {
    if (phase === 'completed') {
      saveActiveRound(null, storage);
      return;
    }
    if ((phase === 'active' || phase === 'paused_visibility') && !roundFinishedRef.current) {
      saveActiveRound(
        {
          seed: round.seed,
          mode: round.mode,
          difficulty: round.difficulty,
          phase,
          selectedSeatIds,
          lockedSeatIds: Array.from(lockedSeatIds),
          conflictSeatIds: Array.from(conflictSeatIds),
          appliedWaveIds,
          elapsedMs: elapsedDisplayMs,
          waitRemainingMs,
          invalidClicks,
          hadSelectionConflict,
          savedAtIso: new Date().toISOString(),
        },
        storage,
      );
    }
  }, [
    appliedWaveIds,
    conflictSeatIds,
    elapsedDisplayMs,
    hadSelectionConflict,
    invalidClicks,
    lockedSeatIds,
    phase,
    round.difficulty,
    round.mode,
    round.seed,
    selectedSeatIds,
    storage,
    waitRemainingMs,
  ]);

  // Consistent visibility pause rule: never let background throttling distort countdowns
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        if (phase === 'active') {
          const now = performance.now();
          clockRef.current = pauseClock(clockRef.current, now, true);
          setElapsedDisplayMs(getElapsedMs(clockRef.current, now));
          setPhase('paused_visibility');
          setStatusNotice(
            'Practice paused because this tab moved to the background. Resume when ready.',
          );
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [phase]);

  // Waiting room timer (Mode 3)
  useEffect(() => {
    if (phase !== 'waiting_room') return;
    const startAt = performance.now();
    const initialRemain = waitRemainingMs > 0 ? waitRemainingMs : round.waitStageMs;

    const id = window.setInterval(() => {
      const elapsed = performance.now() - startAt;
      const remain = Math.max(0, initialRemain - elapsed);
      setWaitRemainingMs(remain);
      if (remain <= 0) {
        window.clearInterval(id);
        clockRef.current = createClockState(performance.now(), true);
        setPhase('active');
        setStatusNotice('Map unlocked! Select your seats and confirm within budget.');
      }
    }, 80);

    return () => window.clearInterval(id);
  }, [phase, round.waitStageMs]);

  // Active monotonic clock + scramble wave trigger loop
  useEffect(() => {
    if (phase !== 'active') return;

    const intervalId = window.setInterval(() => {
      const now = performance.now();
      const elapsed = getElapsedMs(clockRef.current, now);
      setElapsedDisplayMs(elapsed);

      if (round.timeLimitMs !== null && elapsed >= round.timeLimitMs) {
        window.clearInterval(intervalId);
        finishRound(selectedIdsRef.current, true, round.timeLimitMs);
        return;
      }

      for (const wave of round.scrambleWaves) {
        if (
          elapsed >= wave.triggerAtElapsedMs &&
          !appliedWavesRef.current.has(wave.id)
        ) {
          appliedWavesRef.current.add(wave.id);
          setAppliedWaveIds((prev) => [...prev, wave.id]);

          const waveOutcome = applyScrambleWave({
            round,
            wave,
            currentLockedSeatIds: lockedIdsRef.current,
            currentSelectedSeatIds: selectedIdsRef.current,
          });

          lockedIdsRef.current = waveOutcome.nextLockedSeatIds;
          setLockedSeatIds(waveOutcome.nextLockedSeatIds);
          if (waveOutcome.hadConflict) {
            setHadSelectionConflict(true);
            setConflictSeatIds((prev) => {
              const next = new Set(prev);
              for (const id of waveOutcome.newlyConflictedSeatIds) {
                next.add(id);
              }
              return next;
            });
            selectedIdsRef.current = waveOutcome.nextSelectedSeatIds;
            setSelectedSeatIds(waveOutcome.nextSelectedSeatIds);
          }
          setStatusNotice(waveOutcome.announcement);
        }
      }
    }, 100);

    return () => window.clearInterval(intervalId);
  }, [finishRound, phase, round]);

  const handleStartPractice = () => {
    setResumePromptVisible(false);
    resetRoundState(mode, difficulty, seed, true);
  };

  const handleSkipWaitingRoom = () => {
    setWaitRemainingMs(0);
    clockRef.current = createClockState(performance.now(), true);
    setPhase('active');
    setStatusNotice('Skipped waiting room — map unlocked! Pick your adjacent seats.');
  };

  const handleResumeFromVisibilityPause = () => {
    clockRef.current = resumeClock(clockRef.current, performance.now());
    setPhase('active');
    setStatusNotice('Practice resumed.');
  };

  const handleResumeSavedSession = () => {
    const saved = loadActiveRound(storage);
    if (!saved) {
      setResumePromptVisible(false);
      setSavedRoundPreview(null);
      return;
    }
    const savedLimitMs = getTimeLimitMs(saved.mode, saved.difficulty);
    if (savedLimitMs !== null && saved.elapsedMs >= savedLimitMs - 1000) {
      saveActiveRound(null, storage);
      setResumePromptVisible(false);
      setSavedRoundPreview(null);
      resetRoundState(saved.mode, saved.difficulty, saved.seed, false);
      return;
    }
    const targetRound = generateRound({
      mode: saved.mode,
      difficulty: saved.difficulty,
      seed: saved.seed,
    });
    roundFinishedRef.current = false;
    setMode(saved.mode);
    setDifficulty(saved.difficulty);
    setSeed(saved.seed);
    setSelectedSeatIds(saved.selectedSeatIds);
    setLockedSeatIds(new Set(saved.lockedSeatIds));
    setConflictSeatIds(new Set(saved.conflictSeatIds));
    setAppliedWaveIds(saved.appliedWaveIds);
    appliedWavesRef.current = new Set(saved.appliedWaveIds);
    setInvalidClicks(saved.invalidClicks);
    setHadSelectionConflict(saved.hadSelectionConflict);
    setElapsedDisplayMs(saved.elapsedMs);
    clockRef.current = {
      accumulatedActiveMs: saved.elapsedMs,
      lastResumeTimestampMs: performance.now(),
      pausedByVisibility: false,
    };
    setResult(null);
    setForegroundFocusSec(null);
    setPhase('active');
    setResumePromptVisible(false);
    setSavedRoundPreview(null);
    setStatusNotice(
      `Resumed unfinished ${MODE_META[saved.mode].label} (${DIFFICULTY_META[saved.difficulty].label}) drill · Seed "${saved.seed}" (${saved.selectedSeatIds.length}/${targetRound.mission.targetCount} seats).`,
    );
  };

  const handleSeatClick = (seatId: string) => {
    if (phase === 'completed' || phase === 'waiting_room' || phase === 'paused_visibility') {
      return;
    }

    // In ready state, tapping an available seat auto-starts the clock seamlessly
    if (phase === 'ready') {
      if (mode === 'drill') {
        handleStartPractice();
        return;
      }
      clockRef.current = createClockState(performance.now(), true);
      setPhase('active');
    }

    const outcome = toggleSeatSelection({
      seatId,
      selectedSeatIds,
      lockedSeatIds,
      maxSelectable: round.mission.targetCount,
    });

    if (outcome.invalidClick) {
      setInvalidClicks((c) => c + 1);
    }
    if (outcome.changed) {
      setSelectedSeatIds(outcome.nextSelectedSeatIds);
    }
    if (outcome.notice) {
      setStatusNotice(outcome.notice);
    }
  };

  const handleClearSelection = () => {
    setSelectedSeatIds([]);
    setStatusNotice('Selection cleared.');
  };

  const handleConfirm = () => {
    if (phase === 'ready' && selectedSeatIds.length === 0) {
      handleStartPractice();
      return;
    }
    if (selectedSeatIds.length === 0) {
      setInvalidClicks((c) => c + 1);
      setStatusNotice('Pick at least one seat before confirming.');
      return;
    }
    finishRound(selectedSeatIds, false);
  };

  const handleModeSwitch = (nextMode: GameMode) => {
    setMode(nextMode);
    setResumePromptVisible(false);
    resetRoundState(nextMode, difficulty, seed, false);
  };

  const handleDifficultySwitch = (nextDiff: Difficulty) => {
    setDifficulty(nextDiff);
    setResumePromptVisible(false);
    resetRoundState(mode, nextDiff, seed, false);
  };

  const handleReplaySameSeed = () => {
    resetRoundState(mode, difficulty, seed, true);
  };

  const handleRandomSeed = () => {
    const nextSeed = generateRandomSeed();
    setSeed(nextSeed);
    resetRoundState(mode, difficulty, nextSeed, false);
  };

  const totalCost = useMemo(
    () => calculateSeatsCost(selectedSeatIds, DEMO_VENUE),
    [selectedSeatIds],
  );
  const liveAdjacency = useMemo(
    () => areSeatsAdjacent(selectedSeatIds, DEMO_VENUE),
    [selectedSeatIds],
  );

  const sharePath = buildPracticePath({ mode, difficulty, seed });
  const shareUrl = `${originUrl}${sharePath}`;

  const timeString = formatRemainingTime(round.timeLimitMs, elapsedDisplayMs);
  const isUrgent =
    phase === 'active' &&
    round.timeLimitMs !== null &&
    round.timeLimitMs - elapsedDisplayMs <= 5000;

  return (
    <section
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      aria-label="Concert seat selection practice simulator"
      className="w-full rounded-3xl border border-slate-800/80 bg-[#0b0e17] p-3 text-slate-100 shadow-2xl sm:p-5"
    >
      {/* Top Controls: Mode, Difficulty, Seed & Accessibility */}
      <div className="mb-2 flex flex-col gap-3 border-b border-white/10 pb-3 lg:flex-row lg:items-center lg:justify-between">
        {/* Mode pills */}
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Practice mode">
          {(['quick', 'scramble', 'drill'] as const).map((m) => {
            const active = mode === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => handleModeSwitch(m)}
                aria-pressed={active}
                className={`pressable rounded-xl px-3 py-2 text-left text-xs font-semibold sm:text-sm ${
                  active
                    ? 'bg-indigo-500 text-white shadow-md shadow-indigo-500/25'
                    : 'bg-white/5 text-slate-300 hover:bg-white/10'
                }`}
              >
                <span className="mr-1.5 text-[10px] uppercase tracking-wider opacity-75">
                  {MODE_META[m].badge}
                </span>
                {MODE_META[m].label}
              </button>
            );
          })}
        </div>

        {/* Difficulty + Seed + Reduced Motion */}
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="inline-flex rounded-xl border border-white/10 bg-white/5 p-0.5"
            role="group"
            aria-label="Difficulty level"
          >
            {(['easy', 'hard', 'untimed'] as const).map((d) => {
              const active = difficulty === d;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => handleDifficultySwitch(d)}
                  aria-pressed={active}
                  title={DIFFICULTY_META[d].hint}
                  className={`pressable rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
                    active
                      ? 'bg-white text-slate-950'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {DIFFICULTY_META[d].label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-2.5 py-1 text-xs">
            <label htmlFor="seed-input" className="text-slate-400">
              Seed:
            </label>
            <input
              id="seed-input"
              type="text"
              value={seed}
              onChange={(e) => {
                const next = sanitizeSeed(e.target.value, 'arena-101');
                setSeed(next);
              }}
              onBlur={() => resetRoundState(mode, difficulty, seed, false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  resetRoundState(mode, difficulty, seed, false);
                }
              }}
              aria-label="Practice seed"
              className="w-40 min-w-[10rem] bg-transparent font-mono text-xs font-semibold text-sky-300 focus:outline-none sm:w-48"
            />
            <button
              type="button"
              onClick={handleRandomSeed}
              className="pressable rounded-md bg-white/10 px-2 py-1 text-[11px] font-semibold text-slate-200 hover:bg-white/20"
            >
              New Seed
            </button>
          </div>

          <span className="copy-wrap">
            <button
              type="button"
              className="copy-button pressable min-h-[30px] rounded-xl border border-white/15 bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-200 hover:bg-white/10"
              {...({ command: '--copy', commandfor: 'stagedrill-share-url' } as Record<
                string,
                string
              >)}
            >
              Share Seed
            </button>
            <span className="copy-tip" role="status"></span>
          </span>

          <button
            type="button"
            onClick={() => setReducedMotion((v) => !v)}
            aria-pressed={reducedMotion}
            className={`pressable rounded-xl border px-2.5 py-1 text-xs font-semibold ${
              reducedMotion
                ? 'border-amber-400/50 bg-amber-500/20 text-amber-200'
                : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
            }`}
          >
            {reducedMotion ? 'Motion: Reduced' : 'Reduce Motion'}
          </button>
        </div>
      </div>

      {/* Full Share URL display (wraps cleanly without truncation) */}
      <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] text-slate-400">
        <span className="font-semibold text-slate-300">Share URL:</span>
        <code id="stagedrill-share-url" className="break-all font-mono text-sky-300">
          {shareUrl}
        </code>
      </div>

      {/* Saved unfinished round banner */}
      {resumePromptVisible && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-sky-400/40 bg-sky-950/50 px-3.5 py-2.5 text-xs text-sky-100">
          <span>
            {savedRoundPreview ? (
              <>
                Unfinished drill saved in localStorage:{' '}
                <strong>
                  {MODE_META[savedRoundPreview.mode].label} (
                  {DIFFICULTY_META[savedRoundPreview.difficulty].label})
                </strong>{' '}
                &middot; Seed <code className="text-sky-300">{savedRoundPreview.seed}</code>{' '}
                &middot; {savedRoundPreview.selectedCount} seat(s) selected &middot;{' '}
                <strong className="text-white">{savedRoundPreview.remainingLabel}</strong>. Resume
                this drill or discard it to start fresh?
              </>
            ) : (
              'You have an unfinished practice drill saved locally in localStorage. Resume or discard to start fresh?'
            )}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleResumeSavedSession}
              className="pressable rounded-lg bg-sky-500 px-3 py-1 font-semibold text-slate-950"
            >
              Resume Saved Drill
            </button>
            <button
              type="button"
              onClick={() => {
                setResumePromptVisible(false);
                setSavedRoundPreview(null);
                saveActiveRound(null, storage);
              }}
              className="pressable rounded-lg bg-white/10 px-2.5 py-1 font-semibold text-slate-200"
            >
              Discard &amp; Start Fresh
            </button>
          </div>
        </div>
      )}

      {!storagePersistent && (
        <div className="mb-3 rounded-xl border border-amber-400/30 bg-amber-950/40 px-3 py-1.5 text-xs text-amber-200">
          Browser storage is restricted; settings and history stay active in memory for this session only.
        </div>
      )}

      {/* Translucent Sticky-Ready Mission & Live Metrics HUD */}
      <div className="glass-hud mb-3 grid gap-3 rounded-2xl p-3 sm:p-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-emerald-300">
              Virtual Demo · {MODE_META[mode].label}
            </span>
            <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-semibold text-slate-300">
              Target: {round.mission.preferredSections.join(' / ')}
            </span>
            <span className="rounded-full bg-sky-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-sky-300">
              Backup: {round.mission.backupSections.join(' / ')}
            </span>
          </div>
          {!compactHeader && (
            <p className="text-sm font-bold text-white sm:text-base">
              {round.mission.title}
            </p>
          )}
          <p className="text-xs text-slate-300 sm:text-sm">{round.mission.summary}</p>
        </div>

        {/* Always-visible counters: Timer, Seats Selected, Virtual Total */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div
            className={`rounded-xl border px-2 py-2 ${
              isUrgent
                ? 'border-rose-400/70 bg-rose-950/60 text-rose-100'
                : 'border-white/10 bg-black/30 text-white'
            }`}
          >
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              {phase === 'completed'
                ? 'Round Time'
                : round.timeLimitMs === null
                  ? 'Clock'
                  : 'Time Left'}
            </div>
            <div
              data-testid="hud-timer"
              className="tabular-nums mt-0.5 text-sm font-extrabold sm:text-base"
            >
              {phase === 'completed'
                ? `${(elapsedDisplayMs / 1000).toFixed(1)}s`
                : timeString}
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/30 px-2 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Seats
            </div>
            <div
              data-testid="hud-seats"
              className={`tabular-nums mt-0.5 text-sm font-extrabold sm:text-base ${
                selectedSeatIds.length === round.mission.targetCount
                  ? 'text-emerald-300'
                  : 'text-white'
              }`}
            >
              {selectedSeatIds.length} / {round.mission.targetCount}
            </div>
          </div>

          <div
            className={`rounded-xl border px-2 py-2 ${
              totalCost > round.mission.totalBudget
                ? 'border-amber-400/70 bg-amber-950/50 text-amber-200'
                : 'border-white/10 bg-black/30 text-white'
            }`}
          >
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Budget
            </div>
            <div
              data-testid="hud-budget"
              className="tabular-nums mt-0.5 text-sm font-extrabold sm:text-base"
            >
              ${totalCost} / ${round.mission.totalBudget}
            </div>
          </div>
        </div>
      </div>

      {/* Live Status / Event Announcement Banner */}
      <div
        role="status"
        aria-live="polite"
        className={`mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs sm:text-sm ${
          hadSelectionConflict && phase === 'active'
            ? 'border-rose-400/50 bg-rose-950/60 text-rose-100'
            : selectedSeatIds.length > 1 && !liveAdjacency.adjacent
              ? 'border-amber-400/50 bg-amber-950/50 text-amber-100'
              : 'border-white/10 bg-white/5 text-slate-200'
        }`}
      >
        <span>
          {selectedSeatIds.length > 1 && liveAdjacency.reason === 'crossed_aisle'
            ? 'Warning: Selected seats cross the center aisle (Seats 4 and 5 are not adjacent).'
            : statusNotice}
        </span>

        {phase === 'ready' && (
          <button
            type="button"
            onClick={handleStartPractice}
            className="pressable rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-emerald-400"
          >
            {mode === 'drill' ? 'Start Full Drill →' : 'Start Practice →'}
          </button>
        )}
      </div>

      {/* Zoom & Section Filter Controls (Large touch targets for mobile) */}
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Section zoom">
          <button
            type="button"
            onClick={() => {
              setZoomTarget('ALL');
              setZoomScale(1);
            }}
            className={`pressable rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
              zoomTarget === 'ALL'
                ? 'bg-sky-500 text-slate-950'
                : 'bg-white/5 text-slate-300 hover:bg-white/10'
            }`}
          >
            All Sections
          </button>
          {DEMO_VENUE.sections.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setZoomTarget(s.id);
                setZoomScale(1);
              }}
              className={`pressable rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
                zoomTarget === s.id
                  ? 'bg-sky-500 text-slate-950'
                  : 'bg-white/5 text-slate-300 hover:bg-white/10'
              }`}
            >
              {s.shortLabel} (${s.basePrice})
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Zoom out seat map"
            onClick={() => setZoomScale((z) => Math.max(1, Number((z - 0.25).toFixed(2))))}
            className="pressable rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-xs font-bold text-slate-200 hover:bg-white/10"
          >
            −
          </button>
          <span className="tabular-nums min-w-[42px] text-center text-xs text-slate-400">
            {Math.round(zoomScale * 100)}%
          </span>
          <button
            type="button"
            aria-label="Zoom in seat map"
            onClick={() => setZoomScale((z) => Math.min(1.75, Number((z + 0.25).toFixed(2))))}
            className="pressable rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-xs font-bold text-slate-200 hover:bg-white/10"
          >
            +
          </button>
        </div>
      </div>

      {/* Main Workspace: Either Waiting Room Overlay, Paused Banner, Completed Debrief, or Interactive Map */}
      {phase === 'waiting_room' ? (
        <div className="flex min-h-[320px] flex-col items-center justify-center rounded-2xl border border-indigo-400/30 bg-slate-900/90 p-6 text-center">
          <div className="mb-2 rounded-full bg-indigo-500/20 px-3 py-1 text-xs font-bold uppercase tracking-wider text-indigo-300">
            Mode 3 · Simulated Queue Handoff
          </div>
          <h2 className="text-xl font-bold text-white sm:text-2xl">
            Preparing Demo Arena Map…
          </h2>
          <p className="mt-2 max-w-md text-sm text-slate-300">
            Review your mission while the practice transition completes:{' '}
            <strong className="text-white">{round.mission.title}</strong> in{' '}
            <strong className="text-emerald-300">
              {round.mission.preferredSections.join(' / ')}
            </strong>{' '}
            (backup: {round.mission.backupSections.join(' / ')}).
          </p>
          <div className="tabular-nums mt-4 text-2xl font-extrabold text-sky-300">
            {(waitRemainingMs / 1000).toFixed(1)}s
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Note: This brief transition simulates handoff timing only and does not represent real queue positions.
          </p>
          <button
            type="button"
            onClick={handleSkipWaitingRoom}
            className="pressable mt-5 rounded-xl bg-white px-5 py-2.5 text-sm font-bold text-slate-950 hover:bg-slate-200"
          >
            Skip Waiting Room →
          </button>
        </div>
      ) : phase === 'paused_visibility' ? (
        <div className="flex min-h-[320px] flex-col items-center justify-center rounded-2xl border border-amber-400/40 bg-slate-900/95 p-6 text-center">
          <span className="rounded-full bg-amber-500/20 px-3 py-1 text-xs font-bold uppercase tracking-wider text-amber-300">
            Timer Paused
          </span>
          <h2 className="mt-2 text-xl font-bold text-white">
            Practice Paused While Tab Was Hidden
          </h2>
          <p className="mt-2 max-w-md text-sm text-slate-300">
            To prevent browser background throttling from distorting your clock, the timer paused automatically.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={handleResumeFromVisibilityPause}
              className="pressable rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-bold text-slate-950 hover:bg-emerald-400"
            >
              Resume Practice →
            </button>
            <button
              type="button"
              onClick={handleReplaySameSeed}
              className="pressable rounded-xl border border-white/20 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/10"
            >
              Restart Seed
            </button>
          </div>
        </div>
      ) : phase === 'completed' && result ? (
        <div
          data-testid="debrief-panel"
          className="rounded-2xl border border-white/15 bg-slate-900/95 p-4 sm:p-6"
        >
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-4">
            <div>
              <span
                className={`inline-block rounded-full px-3 py-0.5 text-xs font-bold uppercase tracking-wider ${
                  result.passed
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'bg-rose-500/20 text-rose-300'
                }`}
              >
                {result.passed ? 'Mission Passed' : 'Needs Review'}
              </span>
              <h2 className="mt-2 text-xl font-extrabold text-white sm:text-2xl">
                {result.headline}
              </h2>
              <p className="mt-1 text-xs text-slate-400">
                Practice Score (Simulation Only — Never Real Ticket Odds) &middot; Seed:{' '}
                <code className="text-sky-300">{round.seed}</code> &middot; Round Time:{' '}
                <span className="font-semibold text-slate-200">
                  {(result.elapsedMs / 1000).toFixed(1)}s
                </span>
                {foregroundFocusSec !== null && (
                  <span> &middot; Session Cumulative Foreground: {foregroundFocusSec}s</span>
                )}
              </p>
            </div>

            <div className="rounded-2xl border border-white/15 bg-black/40 px-5 py-3 text-center">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Practice Score
              </div>
              <div className="tabular-nums text-3xl font-black text-white">
                {result.score}
                <span className="text-base font-semibold text-slate-400">/100</span>
              </div>
            </div>
          </div>

          {/* Diagnostic Feedback List */}
          <div className="mt-4 space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Rule Breakdown & Feedback
            </h3>
            <ul className="space-y-1.5 text-sm text-slate-200">
              {result.feedbackItems.map((item, idx) => (
                <li
                  key={idx}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2"
                >
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* 6-Part Score Grid */}
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3 lg:grid-cols-6">
            {[
              ['Seat Count', `${result.breakdown.seatCountPts}/20`],
              [
                round.mission.targetCount === 1 ? 'Adjacency (1-Seat Auto)' : 'Adjacency',
                `${result.breakdown.adjacencyPts}/20`,
              ],
              ['Budget', `${result.breakdown.budgetPts}/20`],
              ['Zone / Pivot', `${result.breakdown.sectionPts}/20`],
              ['Speed', `${result.breakdown.speedPts}/10`],
              ['Precision', `${result.breakdown.precisionPts}/10`],
            ].map(([label, val]) => (
              <div
                key={label}
                className="rounded-xl border border-white/10 bg-black/30 px-3 py-2"
              >
                <div className="text-slate-400">{label}</div>
                <div className="tabular-nums mt-0.5 text-sm font-bold text-white">
                  {val}
                </div>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={handleReplaySameSeed}
              className="pressable rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-bold text-slate-950 hover:bg-emerald-400"
            >
              Replay Same Seed
            </button>
            <button
              type="button"
              onClick={() => {
                const next = generateRandomSeed();
                setSeed(next);
                resetRoundState(mode, difficulty, next, true);
              }}
              className="pressable rounded-xl bg-indigo-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-400"
            >
              Next Random Challenge →
            </button>
          </div>
        </div>
      ) : (
        <SeatMapSvg
          mission={round.mission}
          selectedSeatIds={selectedSeatIds}
          lockedSeatIds={lockedSeatIds}
          conflictSeatIds={conflictSeatIds}
          focusedSeatId={focusedSeatId}
          zoomTarget={zoomTarget}
          zoomScale={zoomScale}
          disabled={false}
          onFocusSeat={setFocusedSeatId}
          onSelectSeat={handleSeatClick}
          onZoomSection={(target) => {
            setZoomTarget(target);
            setZoomScale(1);
          }}
        />
      )}

      {/* Legend (Color + Symbol / Pattern — never color alone) */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-slate-300">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3.5 w-3.5 rounded border border-sky-400 bg-[#0f2942]" />
          Available
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded border border-emerald-100 bg-emerald-500 text-[9px] font-black text-emerald-950">
            ✓
          </span>
          Selected
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded border border-dashed border-amber-400 bg-[#2a1c08] text-[8px] font-black text-amber-300">
            $
          </span>
          Over Per-Seat Budget
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded border border-slate-500 bg-slate-800 text-[9px] font-black text-slate-400">
            ×
          </span>
          Unavailable (Hatched)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded border border-dashed border-rose-400 bg-rose-950 text-[9px] font-black text-rose-200">
            !
          </span>
          Lost in Scramble
        </span>
        <span className="text-slate-400">
          Keyboard: Arrow keys move · Enter/Space selects · S4 | AISLE | S5 not adjacent
        </span>
      </div>

      {/* Non-Overlapping Bottom Action Dock (Always clear of the SVG map) */}
      {phase !== 'completed' && phase !== 'waiting_room' && (
        <div className="mt-3 flex flex-col gap-2.5 rounded-2xl border border-white/15 bg-slate-900/95 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-1.5">
            {selectedSeatIds.length === 0 ? (
              <span className="text-xs text-slate-400">
                No seats selected yet — choose {round.mission.targetCount}{' '}
                {round.mission.targetCount === 1 ? 'seat' : 'adjacent seats'} (same row & side of aisle).
              </span>
            ) : (
              selectedSeatIds.map((id) => {
                const s = DEMO_VENUE.seatById[id];
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => handleSeatClick(id)}
                    aria-label={`Remove ${id}`}
                    className="pressable inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25"
                  >
                    <span>
                      {s?.sectionId} {s?.rowLabel}-S{s?.seatNumber} (${s?.price})
                    </span>
                    <span aria-hidden="true" className="text-emerald-300">
                      ×
                    </span>
                  </button>
                );
              })
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleClearSelection}
              disabled={selectedSeatIds.length === 0}
              className="pressable rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={handleReplaySameSeed}
              className="pressable rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10"
            >
              Restart
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              data-testid="confirm-selection-btn"
              className="pressable rounded-xl bg-emerald-500 px-4 py-2 text-xs font-extrabold text-slate-950 shadow-lg shadow-emerald-500/20 hover:bg-emerald-400 sm:text-sm"
            >
              Confirm Selection (${totalCost}) →
            </button>
          </div>
        </div>
      )}

      {/* Recent Local History Strip */}
      {history.length > 0 && (
        <div className="mt-4 border-t border-white/10 pt-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Recent Local Drills (Saved in Browser)
            </h3>
            <span className="text-[11px] text-slate-500">
              Latest {Math.min(history.length, 4)} runs
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {history.slice(0, 4).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setMode(item.mode);
                  setDifficulty(item.difficulty);
                  setSeed(item.seed);
                  resetRoundState(item.mode, item.difficulty, item.seed, true);
                }}
                className="pressable rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left text-xs hover:bg-white/10"
              >
                <div className="flex items-center justify-between font-bold">
                  <span className={item.passed ? 'text-emerald-300' : 'text-amber-300'}>
                    {item.score}/100 · {MODE_META[item.mode].label}
                  </span>
                  <span className="tabular-nums text-slate-400">
                    {(item.elapsedMs / 1000).toFixed(1)}s
                  </span>
                </div>
                <div className="mt-0.5 truncate text-[11px] text-slate-400">
                  Seed: {item.seed} · ${item.totalCost}/${item.totalBudget}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};
