import { describe, expect, it } from 'vitest';
import { CAMPAIGN_SHIFTS, endlessShift } from './content';
import { evaluateOrder } from './evaluate';

describe('game campaign content', () => {
  it('has five authored shifts with cumulative modeled controls', () => {
    expect(CAMPAIGN_SHIFTS).toHaveLength(5);
    expect(CAMPAIGN_SHIFTS.map((shift) => shift.number)).toEqual([1, 2, 3, 4, 5]);
    expect(CAMPAIGN_SHIFTS[0]!.controls).toEqual(['weightBits', 'mathBits']);
    expect(CAMPAIGN_SHIFTS[4]!.controls).toContain('kvPlacement');
    expect(CAMPAIGN_SHIFTS[4]!.controls).toContain('idleKvPlacement');
  });

  it('gives every order a passing solution and a failing obvious attempt', () => {
    for (const shift of CAMPAIGN_SHIFTS) {
      for (const order of shift.orders) {
        const groupSize = order.solutionGroupSize ?? 1;
        expect(evaluateOrder(order, order.solution, groupSize).passed, `${shift.id}/${order.id} solution`).toBe(true);
        expect(evaluateOrder(order, order.initial, 1).passed, `${shift.id}/${order.id} initial`).toBe(false);
      }
    }
  });

  it('uses only controls unlocked in that shift to move from the initial attempt to the solution', () => {
    for (const shift of CAMPAIGN_SHIFTS) {
      for (const order of shift.orders) {
        const changed = Object.keys(order.solution).filter((key) => order.solution[key as keyof typeof order.solution] !== order.initial[key as keyof typeof order.initial]);
        expect(changed.every((key) => shift.controls.includes(key as typeof shift.controls[number])), `${shift.id}/${order.id}: ${changed.join(', ')}`).toBe(true);
      }
    }
  });

  it('makes batching a throughput optimization rather than a fabricated pass condition', () => {
    const order = CAMPAIGN_SHIFTS[1]!.orders[0]!;
    const single = evaluateOrder(order, order.solution, 1);
    const batch = evaluateOrder(order, order.solution, 3);
    expect(single.passed).toBe(true);
    expect(batch.passed).toBe(true);
    expect(batch.metrics.totalTokensPerSec).toBeGreaterThan(single.metrics.totalTokensPerSec);
    expect(batch.metrics.msPerToken).toBeGreaterThan(single.metrics.msPerToken);
  });

  it('reports the bottleneck for the phase named by the ticket', () => {
    const firstToken = CAMPAIGN_SHIFTS[0]!.orders.find((order) => order.phase === 'first-token')!;
    const nextToken = CAMPAIGN_SHIFTS[0]!.orders.find((order) => order.phase === 'next-token')!;
    expect(evaluateOrder(firstToken, firstToken.initial).metrics.bottleneck).toBe('compute');
    expect(evaluateOrder(nextToken, nextToken.initial).metrics.bottleneck).toBe('memory');
  });

  it('includes decoys where carrying forward the familiar lower precision is wrong', () => {
    expect(CAMPAIGN_SHIFTS[0]!.orders.find((order) => order.id === 'opening-bud')!.solution.weightBits).toBe(16);
    expect(CAMPAIGN_SHIFTS[1]!.orders.find((order) => order.id === 'rush-vine')!.solution.weightBits).toBe(16);
    expect(CAMPAIGN_SHIFTS[2]!.orders.find((order) => order.id === 'long-lacy')!.solution.kvBits).toBe(16);
    expect(CAMPAIGN_SHIFTS[3]!.orders.find((order) => order.id === 'regular-bloom')!.solution.reusePromptPrefixes).toBe(false);
    expect(CAMPAIGN_SHIFTS[4]!.orders.find((order) => order.id === 'closing-tangle')!.solution.kvPlacement).toBe('peer');
  });

  it('prices Tangle’s live KV migration instead of pretending peer memory is faster than local HBM', () => {
    const tangle = CAMPAIGN_SHIFTS[4]!.orders.find((order) => order.id === 'closing-tangle')!;
    const local = evaluateOrder(tangle, tangle.initial);
    const peer = evaluateOrder(tangle, tangle.solution);
    const outputTokens = tangle.workload.outputLength!;

    expect(outputTokens).toBe(1);
    expect(local.metrics.msPerToken).toBeLessThan(peer.metrics.msPerToken);
    expect(local.metrics.migrationMs).toBeGreaterThan(0);
    expect(local.metrics.readyNextTokenMs).toBeGreaterThan(peer.metrics.readyNextTokenMs);
    expect(peer.metrics.migrationMs + peer.metrics.msPerToken * outputTokens)
      .toBeLessThan(local.metrics.migrationMs + local.metrics.msPerToken * outputTokens);
    expect(local.passed).toBe(false);
    expect(peer.metrics.migrationMs).toBe(0);
    expect(peer.passed).toBe(true);
  });

  it('requires a configuration change for each sequential non-batch order', () => {
    for (const shift of [CAMPAIGN_SHIFTS[0]!, CAMPAIGN_SHIFTS[2]!, CAMPAIGN_SHIFTS[3]!, CAMPAIGN_SHIFTS[4]!]) {
      const orders = [...shift.orders].sort((a, b) => a.arrivalMs - b.arrivalMs);
      let carried = orders[0]!.initial;
      for (const order of orders) {
        expect(evaluateOrder(order, carried).passed, `${shift.id}/${order.id} should not arrive pre-solved`).toBe(false);
        carried = order.solution;
      }
    }
  });

  it('builds reproducible endless shifts from proven campaign orders', () => {
    expect(endlessShift(42, 3)).toEqual(endlessShift(42, 3));
    expect(endlessShift(42, 3)).not.toEqual(endlessShift(43, 3));
    expect(endlessShift(42, 3).orders).toHaveLength(11);
  });

  it('keeps every generated endless order servable across 800 sampled rounds', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      for (let round = 1; round <= 4; round += 1) {
        const shift = endlessShift(seed, round);
        for (const order of shift.orders) {
          expect(evaluateOrder(order, order.solution, 1).passed, `${shift.id}/${order.id}`).toBe(true);
        }
        const families = new Map<string, typeof shift.orders>();
        for (const order of shift.orders) {
          if (!order.batchFamily) continue;
          families.set(order.batchFamily, [...(families.get(order.batchFamily) ?? []), order]);
        }
        for (const [family, orders] of families) {
          expect(orders, `${shift.id}/${family}`).toHaveLength(3);
          expect(Math.max(...orders.map((order) => order.arrivalMs))).toBeLessThan(Math.min(...orders.map((order) => order.arrivalMs + order.patienceMs)));
        }
      }
    }
  });
});
