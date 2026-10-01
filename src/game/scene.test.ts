import { describe, expect, it } from 'vitest';
import { advanceOperator, commandOperator, createOperatorPose, reactOperator } from './scene';

describe('game operator movement', () => {
  it('walks toward the requested implementation station', () => {
    const start = createOperatorPose();
    const commanded = commandOperator(start, 'weightBits', 1_000, false);
    const moving = advanceOperator(commanded, 40, 1_040, false);
    expect(moving.x).toBeLessThan(start.x);
    expect(moving.targetY).toBe(159);
    expect(moving.walking).toBe(true);
  });

  it('treats repeated steps at one knob as one continuous turn', () => {
    const atStation = commandOperator(createOperatorPose(), 'mathBits', 1_000, false);
    const repeated = commandOperator(atStation, 'mathBits', 1_200, false);
    expect(repeated.walking).toBe(false);
    expect(repeated.turningUntil).toBe(1_520);
  });

  it('teleports to the station when reduced motion is requested', () => {
    const commanded = commandOperator(createOperatorPose(), 'kvBits', 1_000, true);
    expect(commanded.x).toBe(commanded.targetX);
    expect(commanded.y).toBe(commanded.targetY);
    expect(advanceOperator(commanded, 100, 1_100, true).walking).toBe(false);
  });

  it('keeps a service reaction independent from later scene events', () => {
    const reacted = reactOperator(createOperatorPose(), 'serve', 2_000);
    expect(reacted.reaction).toBe('serve');
    expect(reacted.reactionUntil).toBe(2_900);
  });
});
