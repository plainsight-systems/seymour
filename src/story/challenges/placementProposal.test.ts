import { describe, expect, it } from 'vitest';
import { getChallenge } from './data';
import { evaluateChallenge } from './engine';

describe('The object-storage proposal challenge', () => {
  const challenge = getChallenge('placement-proposal');
  it('rejects active object storage and accepts near active state plus cheaper idle restore', () => {
    expect(evaluateChallenge(challenge, challenge.naive).passed).toBe(false);
    expect(evaluateChallenge(challenge, challenge.solution).passed).toBe(true);
  });
});
