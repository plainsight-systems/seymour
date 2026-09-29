import { describe, expect, it } from 'vitest';
import { HARDWARE_PROFILES, getHardware } from '../../data/profiles';
import { calculateSimulation } from '../../model/calculate';
import { modelFor } from '../../model/strategy';
import { challengesFor, getChallenge } from './data';
import { evaluateChallenge, everyAttempt, validateChallenge } from './engine';

const CHIPS = HARDWARE_PROFILES.map((hardware) => hardware.id);

describe('challenge engine', () => {
  it('reports each target with the model\'s own numbers', () => {
    for (const challenge of challengesFor('h100-sxm')) {
      for (const settings of [challenge.naive, challenge.solution]) {
        const decode = calculateSimulation({ ...settings, phase: 'decode' }, getHardware(settings.hardwareId), modelFor(settings));
        const prefill = calculateSimulation({ ...settings, phase: 'prefill' }, getHardware(settings.hardwareId), modelFor(settings));
        const expected: Partial<Record<string, number | boolean>> = {
          msPerToken: decode.msPerToken,
          timeToFirstTokenMs: prefill.totalMs,
          totalTokensPerSec: decode.tokenRate,
          concurrentUsers: settings.batch,
          weightBits: settings.weightBits,
          kvBits: settings.kvBits,
        };
        const results = evaluateChallenge(challenge, settings).results;
        expect(results).toHaveLength(challenge.constraints.length);
        for (const result of results) {
          if (result.constraint.metric in expected) expect(result.actual, `${challenge.id} ${result.constraint.metric}`).toBe(expected[result.constraint.metric]);
        }
      }
    }
  });

  it('counts KV outside GPU memory as not fitting in GPU memory, however much room it frees', () => {
    const challenge = challengesFor('h100-sxm').find((candidate) => candidate.id === 'long-document')!;
    const inHost = { ...challenge.naive, kvPlacement: 'host' as const };
    expect(evaluateChallenge(challenge, inHost).results.find((result) => result.constraint.metric === 'fitsInGpuMemory')!.actual).toBe(false);
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
