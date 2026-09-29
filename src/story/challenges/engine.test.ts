import { describe, expect, it } from 'vitest';
import { CHALLENGES, getChallenge } from './data';
import { evaluateChallenge, everyAttempt, validateChallenge } from './engine';

describe('challenge engine', () => {
  it('evaluates every constraint with its actual value', () => {
    const challenge = CHALLENGES[0]!;
    const evaluation = evaluateChallenge(challenge, challenge.solution);
    expect(evaluation.results).toHaveLength(challenge.constraints.length);
    expect(evaluation.results.every((result) => typeof result.actual === 'number' || typeof result.actual === 'boolean')).toBe(true);
  });

  it('enforces the challenge rules', () => {
    for (const challenge of CHALLENGES) expect(validateChallenge(challenge), challenge.id).toEqual([]);
  });

  it('never lets a lesson claim more than the challenge demands', () => {
    // Search every reachable setting of the adjustable knobs.
    for (const challenge of CHALLENGES) {
      const passing = everyAttempt(challenge).filter((attempt) => evaluateChallenge(challenge, attempt).passed);
      expect(passing.length, challenge.id).toBeGreaterThan(0);
      for (const attempt of passing) expect(challenge.lessonHolds(attempt), `${challenge.id}: ${JSON.stringify(challenge.adjustable.map((knob) => attempt[knob]))}`).toBe(true);
    }
  });

  it('refuses unknown challenge ids instead of silently picking another', () => {
    expect(() => getChallenge('nope')).toThrow('Unknown challenge');
  });
});
