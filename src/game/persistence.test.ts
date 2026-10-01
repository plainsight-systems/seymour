import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME_SAVE, loadGameSave, recordScore, recordShift, saveGame, setSoundPreference } from './persistence';

class MemoryStorage {
  value: string | null = null;
  getItem(): string | null { return this.value; }
  setItem(_key: string, value: string): void { this.value = value; }
}

describe('game persistence', () => {
  it('falls back safely when storage is empty or malformed', () => {
    const storage = new MemoryStorage();
    expect(loadGameSave(storage)).toEqual(DEFAULT_GAME_SAVE);
    storage.value = '{nope';
    expect(loadGameSave(storage)).toEqual(DEFAULT_GAME_SAVE);
  });

  it('records high scores, completion, and the endless unlock', () => {
    let save = recordShift(DEFAULT_GAME_SAVE, 'opening', 1200, false);
    save = recordShift(save, 'opening', 900, false);
    save = recordShift(save, 'closing', 2200, true);
    expect(save.highScores.opening).toBe(1200);
    expect(save.completedShiftIds).toEqual(['opening', 'closing']);
    expect(save.endlessUnlocked).toBe(true);
  });

  it('round-trips preferences without requiring a backend', () => {
    const storage = new MemoryStorage();
    const save = setSoundPreference(DEFAULT_GAME_SAVE, true);
    saveGame(save, storage);
    expect(loadGameSave(storage).soundEnabled).toBe(true);
  });

  it('records an endless score without marking a campaign shift complete', () => {
    const save = recordScore(DEFAULT_GAME_SAVE, 'endless', 4200);
    expect(save.completedShiftIds).toEqual([]);
    expect(save.highScores.endless).toBe(4200);
  });
});
