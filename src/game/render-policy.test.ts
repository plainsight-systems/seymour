import { describe, expect, it } from 'vitest';
import { CAMPAIGN_SHIFTS } from './content';
import { advanceGame, beginShift, createGameState } from './engine';
import { requiresStructuralRender } from './render-policy';

describe('game render policy', () => {
  it('keeps controls mounted during ordinary clock and patience ticks', () => {
    const playing = beginShift(createGameState(CAMPAIGN_SHIFTS[0]!));
    const ticked = advanceGame(playing, 100);
    expect(ticked.elapsedMs).toBeGreaterThan(playing.elapsedMs);
    expect(requiresStructuralRender(playing, ticked)).toBe(false);
  });

  it('rebuilds when customers, screens, events, or cooldown availability change', () => {
    const playing = beginShift(createGameState(CAMPAIGN_SHIFTS[0]!));
    expect(requiresStructuralRender(playing, advanceGame(playing, 7_000))).toBe(true);
    expect(requiresStructuralRender(playing, { ...playing, screen: 'paused' })).toBe(true);
    expect(requiresStructuralRender(playing, { ...playing, event: { ...playing.event, id: playing.event.id + 1 } })).toBe(true);
    expect(requiresStructuralRender({ ...playing, feedCooldownMs: 20 }, { ...playing, feedCooldownMs: 0 })).toBe(true);
  });
});
