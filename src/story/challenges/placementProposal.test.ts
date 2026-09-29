import { describe, expect, it } from 'vitest';
import { getChallenge } from './data';
import { evaluateChallenge } from './engine';

describe('The object-storage proposal challenge', () => {
  const challenge = getChallenge('placement-proposal');

  it('rejects active KV in object storage and accepts it beside the GPU', () => {
    expect(evaluateChallenge(challenge, challenge.naive).passed).toBe(false);
    expect(evaluateChallenge(challenge, challenge.solution).passed).toBe(true);
  });

  it('makes the idle-session choice a real decision: object storage loses to rebuilding, nearer tiers win', () => {
    const restore = (idleKvPlacement: typeof challenge.solution.idleKvPlacement) => evaluateChallenge(challenge, { ...challenge.solution, idleKvPlacement }).results.find((result) => result.constraint.metric === 'restoreBeatsRecompute')!.met;
    expect(restore('object')).toBe(false);
    for (const tier of ['host', 'peer', 'peers', 'ssd'] as const) expect(restore(tier), tier).toBe(true);
  });
});
