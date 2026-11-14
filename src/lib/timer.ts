export interface MonotonicClockState {
  accumulatedActiveMs: number;
  lastResumeTimestampMs: number | null;
  pausedByVisibility: boolean;
}

export function createClockState(nowMs: number, startActive = true): MonotonicClockState {
  return {
    accumulatedActiveMs: 0,
    lastResumeTimestampMs: startActive ? nowMs : null,
    pausedByVisibility: false,
  };
}

export function getElapsedMs(state: MonotonicClockState, nowMs: number): number {
  if (state.lastResumeTimestampMs === null) {
    return state.accumulatedActiveMs;
  }
  return state.accumulatedActiveMs + Math.max(0, nowMs - state.lastResumeTimestampMs);
}

export function pauseClock(
  state: MonotonicClockState,
  nowMs: number,
  byVisibility: boolean,
): MonotonicClockState {
  const elapsed = getElapsedMs(state, nowMs);
  return {
    accumulatedActiveMs: elapsed,
    lastResumeTimestampMs: null,
    pausedByVisibility: byVisibility,
  };
}

export function resumeClock(
  state: MonotonicClockState,
  nowMs: number,
): MonotonicClockState {
  return {
    accumulatedActiveMs: state.accumulatedActiveMs,
    lastResumeTimestampMs: nowMs,
    pausedByVisibility: false,
  };
}

export function formatRemainingTime(
  timeLimitMs: number | null,
  elapsedMs: number,
): string {
  if (timeLimitMs === null) {
    const secs = Math.floor(elapsedMs / 1000);
    const mins = Math.floor(secs / 60);
    const remSecs = secs % 60;
    return `${String(mins).padStart(2, '0')}:${String(remSecs).padStart(2, '0')} · UNTIMED`;
  }

  const remainingMs = Math.max(0, timeLimitMs - elapsedMs);
  const totalSeconds = Math.floor(remainingMs / 1000);
  const tenths = Math.floor((remainingMs % 1000) / 100);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
}

/**
 * Calculates total time the page was in the visible state using the
 * VisibilityStateEntry PerformanceTimeline API, with performance.now() fallback.
 */
export function getTotalForegroundTime(): number {
  if (typeof performance === 'undefined') {
    return 0;
  }
  const entries =
    typeof performance.getEntriesByType === 'function'
      ? performance.getEntriesByType('visibility-state')
      : [];

  if (entries.length === 0) {
    return typeof performance.now === 'function' ? performance.now() : 0;
  }

  let totalForegroundTime = 0;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    if (entry.name === 'visible') {
      const start = entry.startTime;
      const end =
        i + 1 < entries.length ? entries[i + 1]!.startTime : performance.now();
      totalForegroundTime += Math.max(0, end - start);
    }
  }
  return totalForegroundTime;
}
