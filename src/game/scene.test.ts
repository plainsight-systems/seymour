import { describe, expect, it } from 'vitest';
import { advanceOperator, commandOperator, createOperatorPose } from './scene';

describe('game operator movement', () => {
  it('walks toward the requested implementation station', () => {
    const start = createOperatorPose();
    const commanded = commandOperator(start, 'weightBits', 1_000, false);
    const moving = advanceOperator(commanded, 100, 1_100, false);
    expect(moving.x).toBeLessThan(start.x);
    expect(moving.targetY).toBe(159);
    expect(moving.walking).toBe(true);
  });

  it('teleports to the station when reduced motion is requested', () => {
    const commanded = commandOperator(createOperatorPose(), 'kvBits', 1_000, true);
    expect(commanded.x).toBe(commanded.targetX);
    expect(commanded.y).toBe(commanded.targetY);
    expect(advanceOperator(commanded, 100, 1_100, true).walking).toBe(false);
  });
});
