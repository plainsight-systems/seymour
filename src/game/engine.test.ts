import { describe, expect, it } from 'vitest';
import { CAMPAIGN_SHIFTS } from './content';
import { advanceGame, beginShift, createGameState, feedSelected, nextShift, pauseGame, resumeGame, selectCustomer, serviceCooldownMs, servicePoints, setCustomerControl, toggleBatchTray } from './engine';
import { evaluateOrder } from './evaluate';
import { gradeFor } from './scoring';
import type { GameShift } from './types';

function playIdealShift(shift: GameShift) {
  let state = beginShift(createGameState(shift));
  for (let guard = 0; guard < 500 && state.screen === 'playing'; guard += 1) {
    const nextArrival = shift.orders
      .filter((order) => !state.spawnedOrderIds.includes(order.id))
      .reduce((soonest, order) => Math.min(soonest, order.arrivalMs), Number.POSITIVE_INFINITY);
    const untilArrival = Number.isFinite(nextArrival) ? Math.max(0, nextArrival - state.elapsedMs) : Number.POSITIVE_INFINITY;

    if (state.feedCooldownMs > 0) {
      state = advanceGame(state, Math.min(state.feedCooldownMs, untilArrival));
      continue;
    }

    const selected = state.active[0];
    if (!selected) {
      state = advanceGame(state, untilArrival);
      continue;
    }

    const family = selected.order.batchFamily;
    const group = family ? state.active.filter((customer) => customer.order.batchFamily === family) : [selected];
    if (family && group.length < 3) {
      state = advanceGame(state, untilArrival);
      continue;
    }

    if (family) {
      for (const customer of group) state = toggleBatchTray(state, customer.order.id);
    }
    state = selectCustomer(state, selected.order.id);
    for (const control of shift.controls) {
      state = setCustomerControl(state, selected.order.id, control, selected.order.solution[control] as never);
    }
    state = feedSelected(state);
  }
  return state;
}

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
    expect(state.stats.served).toBe(1);
    expect(state.stats.peakTokensPerSec).toBeGreaterThan(0);
  });

  it('carries the current rig configuration into later arrivals', () => {
    let state = beginShift(createGameState(CAMPAIGN_SHIFTS[0]!));
    state = setCustomerControl(state, state.active[0]!.order.id, 'weightBits', 8);
    state = advanceGame(state, 7_000);
    expect(state.active[1]!.config.weightBits).toBe(8);
  });

  it('applies the current physical rig when selecting a ticket that was already waiting', () => {
    let state = advanceGame(beginShift(createGameState(CAMPAIGN_SHIFTS[0]!)), 7_000);
    const first = state.active[0]!;
    const second = state.active[1]!;
    state = setCustomerControl(state, first.order.id, 'weightBits', 8);
    state = selectCustomer(state, second.order.id);
    expect(state.active.find((customer) => customer.order.id === second.order.id)?.config.weightBits).toBe(8);
  });

  it('carries the rig onto the next waiting ticket after a feed', () => {
    let state = advanceGame(beginShift(createGameState(CAMPAIGN_SHIFTS[0]!)), 7_000);
    const first = state.active[0]!;
    state = setCustomerControl(state, first.order.id, 'weightBits', 8);
    state = setCustomerControl(state, first.order.id, 'mathBits', 8);
    state = feedSelected(state);
    expect(state.active[0]?.config.weightBits).toBe(8);
    expect(state.active[0]?.config.mathBits).toBe(8);
  });

  it('shares one configuration across tickets on the same tray', () => {
    let state = advanceGame(beginShift(createGameState(CAMPAIGN_SHIFTS[1]!)), 5_000);
    state = toggleBatchTray(state, state.active[0]!.order.id);
    state = setCustomerControl(state, state.active[0]!.order.id, 'weightBits', 8);
    state = toggleBatchTray(state, state.active[1]!.order.id);
    state = toggleBatchTray(state, state.active[2]!.order.id);
    expect(state.active.slice(0, 3).map((customer) => customer.config.weightBits)).toEqual([8, 8, 8]);
  });

  it('reveals the concrete fix only after the first failed feed', () => {
    const state = beginShift(createGameState(CAMPAIGN_SHIFTS[0]!));
    const firstMiss = feedSelected(state);
    expect(firstMiss.event.detail).toContain('memory-bound');
    expect(firstMiss.event.detail).not.toContain('Move fewer weight bytes');
    const secondMiss = feedSelected(firstMiss);
    expect(secondMiss.event.detail).toContain('Move fewer weight bytes');
    expect(secondMiss.stats.failedFeeds).toBe(2);
  });

  it('forces matrix math back to 16-bit when model weights require it', () => {
    let state = beginShift(createGameState(CAMPAIGN_SHIFTS[0]!));
    const id = state.active[0]!.order.id;
    state = setCustomerControl(state, id, 'weightBits', 8);
    state = setCustomerControl(state, id, 'mathBits', 8);
    state = setCustomerControl(state, id, 'weightBits', 16);
    expect(state.active[0]!.config.mathBits).toBe(16);
    expect(state.rigConfiguration.mathBits).toBe(16);
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

  it('lets a batch share one modeled GPU service window', () => {
    let single = advanceGame(beginShift(createGameState(CAMPAIGN_SHIFTS[1]!)), 5_000);
    single = setCustomerControl(single, single.active[0]!.order.id, 'weightBits', 8);
    single = feedSelected(single);

    let batch = advanceGame(beginShift(createGameState(CAMPAIGN_SHIFTS[1]!)), 5_000);
    for (const customer of batch.active) batch = toggleBatchTray(batch, customer.order.id);
    batch = setCustomerControl(batch, batch.active[0]!.order.id, 'weightBits', 8);
    batch = feedSelected(batch);

    expect(single.seatedOrderIds).toHaveLength(1);
    expect(batch.seatedOrderIds).toHaveLength(3);
    expect(batch.feedCooldownMs).toBeLessThan(single.feedCooldownMs * 3);
    expect(batch.score).toBeLessThan(batch.shift.targetScore);
  });

  it('compresses service time without flattening long jobs at a fixed cap', () => {
    const audit = CAMPAIGN_SHIFTS[1]!.orders.find((order) => order.orderName === 'Audit chat')!;
    const singleMetrics = evaluateOrder(audit, audit.solution, 1).metrics;
    const batchMetrics = evaluateOrder(audit, audit.solution, 3).metrics;
    const single = serviceCooldownMs(audit, singleMetrics);
    const batch = serviceCooldownMs(audit, batchMetrics);

    expect(single).toBeGreaterThan(900);
    expect(batch).toBeGreaterThan(single);
    expect(batch).toBeLessThan(single * 3);
    expect(batch).not.toBe(6_000);
  });

  it('keeps Tangle’s accepted one-token peer path cheaper on the kitchen clock', () => {
    const tangle = CAMPAIGN_SHIFTS[4]!.orders.find((order) => order.id === 'closing-tangle')!;
    const local = evaluateOrder(tangle, tangle.initial).metrics;
    const peer = evaluateOrder(tangle, tangle.solution).metrics;

    expect(serviceCooldownMs(tangle, peer)).toBeLessThan(serviceCooldownMs(tangle, local));
  });

  it('weights correct service and batching more heavily than reaction speed', () => {
    const fastSingle = servicePoints(1, 1, 0);
    const slowSingle = servicePoints(1, 0.2, 0);
    const fullBatch = servicePoints(3, 3, 0);

    expect(fastSingle - slowSingle).toBe(80);
    expect(slowSingle).toBeGreaterThan(450);
    expect(fullBatch).toBeGreaterThan(fastSingle * 3);
    const unhurriedCleanShift = servicePoints(1, 0.2, 0) + servicePoints(1, 0.2, 1) + servicePoints(1, 0.2, 2);
    expect(gradeFor(unhurriedCleanShift, 1_600)).toBe('A');
  });

  it('makes an S grade reachable through ideal play in every authored shift', () => {
    for (const shift of CAMPAIGN_SHIFTS) {
      const result = playIdealShift(shift);
      expect(result.screen, shift.id).toBe('shift-complete');
      expect(result.stats.failedFeeds, shift.id).toBe(0);
      expect(result.stats.served, shift.id).toBe(shift.orders.length);
      expect(gradeFor(result.score, shift.targetScore, result.stats.failedFeeds, result.fuses), `${shift.id}: ${result.score}/${shift.targetScore}`).toBe('S');
    }
  });

  it('calls a partial advance a survived shift and pluralizes one served order', () => {
    const started = beginShift(createGameState(CAMPAIGN_SHIFTS[3]!));
    const doomed = { ...started.active[0]!, patienceMs: 100 };
    const partial = {
      ...started,
      active: [doomed],
      spawnedOrderIds: started.shift.orders.map((order) => order.id),
      fuses: 2,
      stats: { ...started.stats, served: 1 },
    };
    const survived = advanceGame(partial, 101);

    expect(survived.screen).toBe('shift-complete');
    expect(survived.event.title).toBe('Shift survived');
    expect(survived.event.detail).toContain('1 order served');
    expect(survived.event.detail).not.toContain('1 orders');
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
