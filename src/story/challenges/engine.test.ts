import { describe, expect, it } from 'vitest';
import { HARDWARE_PROFILES } from '../../data/profiles';
import { challengesFor, getChallenge } from './data';
import { evaluateChallenge, everyAttempt, validateChallenge } from './engine';

const CHIPS = HARDWARE_PROFILES.map((hardware) => hardware.id);

describe('challenge engine', () => {
  it('evaluates every constraint with its actual value', () => {
    const challenge = challengesFor('h100-sxm')[0]!;
    const evaluation = evaluateChallenge(challenge, challenge.solution);
    expect(evaluation.results).toHaveLength(challenge.constraints.length);
    expect(evaluation.results.every((result) => typeof result.actual === 'number' || typeof result.actual === 'boolean')).toBe(true);
  });

  it('builds every challenge for every chip, and enforces the challenge rules on each', () => {
    for (const chip of CHIPS) {
      for (const challenge of challengesFor(chip)) expect(validateChallenge(challenge), `${challenge.id} on ${chip}`).toEqual([]);
    }
  });

  it('never lets a lesson claim more than the challenge demands, on any chip', () => {
    // Search every reachable combination of every throttle.
    for (const chip of CHIPS) {
      for (const challenge of challengesFor(chip)) {
        const passing = everyAttempt(challenge).filter((attempt) => evaluateChallenge(challenge, attempt).passed);
        expect(passing.length, `${challenge.id} on ${chip}`).toBeGreaterThan(0);
        for (const attempt of passing) expect(challenge.lessonHolds(attempt), `${challenge.id} on ${chip}: ${JSON.stringify(challenge.adjustable.map((knob) => attempt[knob]))}`).toBe(true);
      }
    }
  });

  it('runs each chip-scaled challenge on the chip it was built for', () => {
    for (const chip of CHIPS) {
      for (const challenge of challengesFor(chip).filter((candidate) => !candidate.adjustable.includes('hardwareId'))) {
        expect(challenge.fixed.hardwareId, challenge.id).toBe(chip);
      }
    }
  });

  it('refuses unknown challenge ids instead of silently picking another', () => {
    expect(() => getChallenge('nope', 'h100-sxm')).toThrow('Unknown challenge');
  });
});
