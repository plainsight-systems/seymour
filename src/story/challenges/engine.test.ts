import { describe, expect, it } from 'vitest';
import { CHALLENGES } from './data';
import { evaluateChallenge, validateChallenge } from './engine';

describe('challenge engine', () => {
  it('evaluates every constraint with its actual value', () => {
    const challenge = CHALLENGES[0]!;
    const evaluation = evaluateChallenge(challenge, challenge.solution);
    expect(evaluation.results).toHaveLength(challenge.constraints.length);
    expect(evaluation.results.every((result) => typeof result.actual === 'number' || typeof result.actual === 'boolean')).toBe(true);
  });

  it('enforces the four challenge rules', () => {
    for (const challenge of CHALLENGES) expect(validateChallenge(challenge)).toEqual([]);
  });
});
