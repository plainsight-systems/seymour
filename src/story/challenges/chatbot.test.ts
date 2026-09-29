import { describe, expect, it } from 'vitest';
import { getChallenge } from './data';
import { evaluateChallenge } from './engine';

describe('The chatbot challenge', () => {
  const challenge = getChallenge('chatbot', 'h100-sxm');
  it('has a passing solution and a failing naive attempt', () => {
    expect(evaluateChallenge(challenge, challenge.solution).passed).toBe(true);
    expect(evaluateChallenge(challenge, challenge.naive).passed).toBe(false);
  });
});
