import { describe, expect, it } from 'vitest';
import { getChallenge } from './data';
import { evaluateChallenge } from './engine';

describe('The long document challenge', () => {
  const challenge = getChallenge('long-document', 'h100-sxm');
  it('has a passing solution and a failing naive attempt', () => {
    expect(evaluateChallenge(challenge, challenge.solution).passed).toBe(true);
    expect(evaluateChallenge(challenge, challenge.naive).passed).toBe(false);
  });
});
