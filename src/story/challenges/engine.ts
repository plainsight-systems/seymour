import { getHardware } from '../../data/profiles';
import { calculateSimulation, restoreVsRecompute } from '../../model/calculate';
import { modelFor } from '../../model/strategy';
import type { KvPlacement, SimulationSettings } from '../../types';

export type KnobId = 'batch' | 'sequenceLength' | 'weightBits' | 'kvBits' | 'reusePromptPrefixes' | 'prefixCachePercent' | 'kvPlacement';
export type ConstraintMetric = 'msPerToken' | 'timeToFirstTokenMs' | 'totalTokensPerSec' | 'concurrentUsers' | 'fitsInGpuMemory' | 'activeKvInGpuMemory' | 'restoreBeatsRecompute';

export interface Constraint {
  metric: ConstraintMetric;
  op: '<=' | '>=' | '==';
  value: number | boolean;
}

export interface Challenge {
  id: string;
  title: string;
  brief: string;
  fixed: Partial<SimulationSettings>;
  adjustable: KnobId[];
  constraints: Constraint[];
  solution: SimulationSettings;
  naive: SimulationSettings;
  lesson: string;
  parkingTier?: KvPlacement;
}

export interface ConstraintResult {
  constraint: Constraint;
  actual: number | boolean;
  met: boolean;
}

export interface ChallengeEvaluation {
  passed: boolean;
  results: ConstraintResult[];
}

export function evaluateChallenge(challenge: Challenge, settings: SimulationSettings): ChallengeEvaluation {
  const hardware = getHardware(settings.hardwareId);
  const model = modelFor(settings);
  const decode = calculateSimulation({ ...settings, phase: 'decode' }, hardware, model);
  const prefill = calculateSimulation({ ...settings, phase: 'prefill' }, hardware, model);
  const parking = challenge.parkingTier
    ? restoreVsRecompute(settings, hardware, model, challenge.parkingTier)
    : null;

  const metrics: Record<ConstraintMetric, number | boolean> = {
    msPerToken: decode.msPerToken,
    // Prompt processing produces the first token.
    timeToFirstTokenMs: prefill.totalMs,
    totalTokensPerSec: decode.tokenRate,
    concurrentUsers: settings.batch,
    fitsInGpuMemory: decode.hbmUsedFraction <= 1 && decode.hostTrafficBytes === 0,
    activeKvInGpuMemory: settings.kvPlacement === 'hbm',
    restoreBeatsRecompute: parking?.cheaper === 'restore',
  };

  const results = challenge.constraints.map((constraint) => {
    const actual = metrics[constraint.metric];
    const met = constraint.op === '=='
      ? actual === constraint.value
      : constraint.op === '<='
        ? Number(actual) <= Number(constraint.value)
        : Number(actual) >= Number(constraint.value);
    return { constraint, actual, met };
  });
  return { passed: results.every((result) => result.met), results };
}

export function validateChallenge(challenge: Challenge): string[] {
  const errors: string[] = [];
  if (!evaluateChallenge(challenge, challenge.solution).passed) errors.push('Known solution does not pass.');
  if (evaluateChallenge(challenge, challenge.naive).passed) errors.push('Naive configuration must fail.');

  for (const [key, value] of Object.entries(challenge.fixed)) {
    if (challenge.solution[key as keyof SimulationSettings] !== value) {
      errors.push(`Solution changes fixed setting ${key}.`);
    }
  }

  const modeled: KnobId[] = ['batch', 'sequenceLength', 'weightBits', 'kvBits', 'reusePromptPrefixes', 'prefixCachePercent', 'kvPlacement'];
  for (const knob of challenge.adjustable) {
    if (!modeled.includes(knob)) errors.push(`${knob} is not modeled.`);
  }
  return errors;
}
