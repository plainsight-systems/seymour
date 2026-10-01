import type { GameSave } from './types';

const STORAGE_KEY = 'seymour-game-v1';

export const DEFAULT_GAME_SAVE: GameSave = {
  scoringVersion: 3,
  completedShiftIds: [],
  highScores: {},
  endlessUnlocked: false,
  soundEnabled: false,
};

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadGameSave(storage: StorageLike = window.localStorage): GameSave {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_GAME_SAVE };
    const parsed = JSON.parse(raw) as Partial<GameSave>;
    return {
      scoringVersion: 3,
      completedShiftIds: Array.isArray(parsed.completedShiftIds) ? parsed.completedShiftIds.filter((id): id is string => typeof id === 'string') : [],
      highScores: parsed.scoringVersion === 3 && parsed.highScores && typeof parsed.highScores === 'object' ? parsed.highScores : {},
      endlessUnlocked: parsed.endlessUnlocked === true,
      soundEnabled: parsed.soundEnabled === true,
    };
  } catch {
    return { ...DEFAULT_GAME_SAVE };
  }
}

export function saveGame(save: GameSave, storage: StorageLike = window.localStorage): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(save));
  } catch {
    // The game remains playable when storage is disabled or full.
  }
}

export function recordShift(save: GameSave, shiftId: string, score: number, campaignComplete: boolean): GameSave {
  return {
    ...save,
    completedShiftIds: save.completedShiftIds.includes(shiftId) ? save.completedShiftIds : [...save.completedShiftIds, shiftId],
    highScores: { ...save.highScores, [shiftId]: Math.max(score, save.highScores[shiftId] ?? 0) },
    endlessUnlocked: save.endlessUnlocked || campaignComplete,
  };
}

export function recordScore(save: GameSave, scoreId: string, score: number): GameSave {
  return {
    ...save,
    highScores: { ...save.highScores, [scoreId]: Math.max(score, save.highScores[scoreId] ?? 0) },
  };
}

export function setSoundPreference(save: GameSave, soundEnabled: boolean): GameSave {
  return { ...save, soundEnabled };
}

export function resetCampaignProgress(save: GameSave): GameSave {
  return { ...DEFAULT_GAME_SAVE, soundEnabled: save.soundEnabled };
}
