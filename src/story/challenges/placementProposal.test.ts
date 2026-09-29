import { describe, expect, it } from 'vitest';
import { HARDWARE_PROFILES } from '../../data/profiles';
import { getChallenge } from './data';
import { evaluateChallenge } from './engine';

describe('The object-storage proposal challenge', () => {
  for (const { id: chip } of HARDWARE_PROFILES) {
    const challenge = getChallenge('placement-proposal', chip);

    it(`rejects active KV in object storage and accepts it beside the GPU (${chip})`, () => {
      expect(evaluateChallenge(challenge, challenge.naive).passed).toBe(false);
      expect(evaluateChallenge(challenge, challenge.solution).passed).toBe(true);
    });

    it(`makes the idle-session choice a real decision (${chip})`, () => {
      const restore = (idleKvPlacement: typeof challenge.solution.idleKvPlacement) => evaluateChallenge(challenge, { ...challenge.solution, idleKvPlacement }).results.find((result) => result.constraint.metric === 'restoreBeatsRecompute')!.met;
      expect(restore('object')).toBe(false);
      expect(restore('host')).toBe(true);
    });
  }
});
