import type {
  ActiveRoundSnapshot,
  PracticeHistoryEntry,
  PracticeSettings,
} from './types';

export const STORAGE_KEYS = {
  settings: 'stagedrill_settings_v1',
  history: 'stagedrill_history_v1',
  activeRound: 'stagedrill_active_round_v1',
} as const;

export const DEFAULT_SETTINGS: PracticeSettings = {
  mode: 'quick',
  difficulty: 'easy',
  reducedMotion: false,
};

export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

const memoryFallback = new Map<string, string>();

export function createSafeStorage(backend?: StorageLike | null) {
  let persistentAvailable = false;

  const resolveBackend = (): StorageLike | null => {
    if (backend !== undefined) return backend;
    if (typeof window === 'undefined') return null;
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  };

  const probe = resolveBackend();
  if (probe) {
    try {
      const testKey = '__stagedrill_probe__';
      probe.setItem(testKey, '1');
      probe.removeItem(testKey);
      persistentAvailable = true;
    } catch {
      persistentAvailable = false;
    }
  }

  const getItem = (key: string): string | null => {
    const target = resolveBackend();
    if (target && persistentAvailable) {
      try {
        const val = target.getItem(key);
        if (val !== null) return val;
      } catch {
        persistentAvailable = false;
      }
    }
    return memoryFallback.get(key) ?? null;
  };

  const setItem = (key: string, value: string): void => {
    memoryFallback.set(key, value);
    const target = resolveBackend();
    if (target && persistentAvailable) {
      try {
        target.setItem(key, value);
      } catch {
        persistentAvailable = false;
      }
    }
  };

  const removeItem = (key: string): void => {
    memoryFallback.delete(key);
    const target = resolveBackend();
    if (target && persistentAvailable) {
      try {
        target.removeItem(key);
      } catch {
        persistentAvailable = false;
      }
    }
  };

  const isPersistent = (): boolean => persistentAvailable;

  return {
    getItem,
    setItem,
    removeItem,
    isPersistent,
  };
}

export function loadSettings(storage = createSafeStorage()): PracticeSettings {
  const raw = storage.getItem(STORAGE_KEYS.settings);
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    const parsed = JSON.parse(raw) as Partial<PracticeSettings>;
    return {
      mode:
        parsed.mode === 'quick' || parsed.mode === 'scramble' || parsed.mode === 'drill'
          ? parsed.mode
          : DEFAULT_SETTINGS.mode,
      difficulty:
        parsed.difficulty === 'easy' ||
        parsed.difficulty === 'hard' ||
        parsed.difficulty === 'untimed'
          ? parsed.difficulty
          : DEFAULT_SETTINGS.difficulty,
      reducedMotion: Boolean(parsed.reducedMotion),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(
  settings: PracticeSettings,
  storage = createSafeStorage(),
): void {
  try {
    storage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
  } catch {
    // Graceful no-op fallback already handled inside storage
  }
}

export function loadHistory(storage = createSafeStorage()): PracticeHistoryEntry[] {
  const raw = storage.getItem(STORAGE_KEYS.history);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PracticeHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

export function appendHistory(
  entry: PracticeHistoryEntry,
  storage = createSafeStorage(),
  maxEntries = 10,
): PracticeHistoryEntry[] {
  const current = loadHistory(storage);
  const next = [entry, ...current].slice(0, maxEntries);
  try {
    storage.setItem(STORAGE_KEYS.history, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}

export function loadActiveRound(
  storage = createSafeStorage(),
): ActiveRoundSnapshot | null {
  const raw = storage.getItem(STORAGE_KEYS.activeRound);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ActiveRoundSnapshot;
    if (!parsed || typeof parsed.seed !== 'string' || !Array.isArray(parsed.selectedSeatIds)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveActiveRound(
  snapshot: ActiveRoundSnapshot | null,
  storage = createSafeStorage(),
): void {
  if (!snapshot) {
    storage.removeItem(STORAGE_KEYS.activeRound);
    return;
  }
  try {
    storage.setItem(STORAGE_KEYS.activeRound, JSON.stringify(snapshot));
  } catch {
    // ignore
  }
}
