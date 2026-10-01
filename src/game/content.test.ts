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

  it('requires the lunch-rush orders to share a real batch', () => {
    const order = CAMPAIGN_SHIFTS[1]!.orders[0]!;
    expect(evaluateOrder(order, order.solution, 1).passed).toBe(false);
    expect(evaluateOrder(order, order.solution, 3).passed).toBe(true);
  });

  it('builds reproducible endless shifts from proven campaign orders', () => {
    expect(endlessShift(42, 3)).toEqual(endlessShift(42, 3));
    expect(endlessShift(42, 3)).not.toEqual(endlessShift(43, 3));
    expect(endlessShift(42, 3).orders).toHaveLength(11);
  });
});
