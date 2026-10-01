import { describe, expect, it } from 'vitest';
import { CAMPAIGN_SHIFTS } from './content';
import { advanceGame, beginShift, createGameState, feedSelected, nextShift, pauseGame, resumeGame, selectCustomer, setCustomerControl, toggleBatchTray } from './engine';
import type { GameShift } from './types';

describe('game engine', () => {
  it('freezes all clocks while paused', () => {
    const playing = beginShift(createGameState(CAMPAIGN_SHIFTS[0]!));
    const paused = pauseGame(playing);
    const after = advanceGame(paused, 20_000);
    expect(after.elapsedMs).toBe(paused.elapsedMs);
    expect(after.active[0]!.patienceMs).toBe(paused.active[0]!.patienceMs);
    expect(resumeGame(after).screen).toBe('playing');
  });

  it('serves a correctly configured individual order without losing a fuse', () => {
    let state = beginShift(createGameState(CAMPAIGN_SHIFTS[0]!));
    const customer = state.active[0]!;
    state = setCustomerControl(state, customer.order.id, 'weightBits', 8);
    state = setCustomerControl(state, customer.order.id, 'mathBits', 8);
    state = feedSelected(state);
    expect(state.seatedOrderIds).toContain(customer.order.id);
    expect(state.fuses).toBe(3);
    expect(state.score).toBeGreaterThan(0);
  });

  it('blows a fuse for a severe capacity miss but leaves the plant available to correct', () => {
    const state = beginShift(createGameState(CAMPAIGN_SHIFTS[2]!));
    const failed = feedSelected(state);
    expect(failed.fuses).toBe(2);
    expect(failed.active).toHaveLength(1);
    expect(failed.event.type).toBe('fuse');
  });

  it('serves three independently configured matching tickets as one batch', () => {
    let state = beginShift(createGameState(CAMPAIGN_SHIFTS[1]!));
    state = advanceGame(state, 5_000);
    expect(state.active).toHaveLength(3);
    for (const customer of state.active) {
      state = setCustomerControl(state, customer.order.id, 'weightBits', 8);
      state = toggleBatchTray(state, customer.order.id);
    }
    state = selectCustomer(state, state.active[0]!.order.id);
    state = feedSelected(state);
    expect(state.seatedOrderIds).toHaveLength(3);
    expect(state.event.title).toBe('Batch served ×3');
  });

  it('ends the shift after three customers expire', () => {
    const source = CAMPAIGN_SHIFTS[0]!.orders[0]!;
    const shift: GameShift = {
      ...CAMPAIGN_SHIFTS[0]!, id: 'expiry-test', orders: [0, 1, 2].map((index) => ({ ...source, id: `expiry-${index}`, arrivalMs: 0, patienceMs: 100 })),
    };
    const state = advanceGame(beginShift(createGameState(shift)), 101);
    expect(state.fuses).toBe(0);
    expect(state.screen).toBe('game-over');
  });

  it('carries score and remaining fuses into the next endless round', () => {
    const complete = { ...createGameState(CAMPAIGN_SHIFTS[0]!, 'endless', 91, 2), screen: 'shift-complete' as const, score: 6400, fuses: 2 };
    const next = nextShift(complete);
    expect(next.mode).toBe('endless');
    expect(next.endlessRound).toBe(3);
    expect(next.score).toBe(6400);
    expect(next.fuses).toBe(2);
  });
});
