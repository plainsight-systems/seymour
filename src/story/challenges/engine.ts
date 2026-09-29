import { getHardware } from '../../data/profiles';
import { calculateSimulation, restoreVsRecompute } from '../../model/calculate';
import { modelFor } from '../../model/strategy';
import type { SimulationSettings } from '../../types';

export type KnobId = 'batch' | 'sequenceLength' | 'weightBits' | 'kvBits' | 'reusePromptPrefixes' | 'prefixCachePercent' | 'kvPlacement' | 'idleKvPlacement' | 'speculativeTokens' | 'mathBits' | 'modelId' | 'hardwareId';
export type ConstraintMetric = 'msPerToken' | 'timeToFirstTokenMs' | 'totalTokensPerSec' | 'fitsInGpuMemory' | 'restoreBeatsRecompute' | 'concurrentUsers' | 'weightBits' | 'kvBits';

/**
 * The throttles every challenge offers. Everything else (context length,
 * model, how much of the prompt is shared, how often guesses land) is the
 * workload: a fact of the challenge, not a choice. A challenge whose question
 * is the chip adds 'hardwareId'.
 */
export const THROTTLES: KnobId[] = ['batch', 'weightBits', 'mathBits', 'kvBits', 'reusePromptPrefixes', 'speculativeTokens', 'kvPlacement', 'idleKvPlacement'];

/** Every value the reader can give each knob, as the controls offer them. Tests search these exhaustively. */
export const KNOB_VALUES: { [K in KnobId]: SimulationSettings[K][] } = {
  batch: [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024],
  sequenceLength: [128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768],
  weightBits: [16, 8, 4],
  kvBits: [16, 8],
  reusePromptPrefixes: [false, true],
  prefixCachePercent: [0, 25, 50, 75, 90, 100],
  kvPlacement: ['hbm', 'host', 'peer', 'peers', 'ssd', 'object'],
  idleKvPlacement: ['host', 'peer', 'peers', 'ssd', 'object'],
  speculativeTokens: [0, 2, 4],
  mathBits: [16, 8],
  modelId: ['llama-3.1-8b', 'qwen3-30b-a3b'],
  hardwareId: ['h100-sxm', 'mi300x', 'h200-sxm', 'mi325x', 'mi355x'],
};

export interface Constraint {
  metric: ConstraintMetric;
  op: '<=' | '>=' | '==';
  value: number | boolean;
}

export interface Challenge {
  id: string;
  title: string;
  brief: string;
  /** The workload: settings that are facts of the challenge. Never a throttle. */
  fixed: Partial<SimulationSettings>;
  /** The knobs the reader can move: THROTTLES, plus the chip when that is the question. */
  adjustable: KnobId[];
  constraints: Constraint[];
  solution: SimulationSettings;
  naive: SimulationSettings;
  lesson: string;
  /**
   * What the lesson claims every passing answer does. Tests search every
   * combination of the adjustable knobs and require this of each pass, so
   * the lesson can never claim more than the challenge demands.
   */
  lessonHolds(settings: SimulationSettings): boolean;
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

/** Settings the controls cannot produce: FP8 math needs weights of 8 bits or fewer. */
export function isReachable(settings: SimulationSettings): boolean {
  return !(settings.mathBits === 8 && settings.weightBits === 16);
}

export function evaluateChallenge(challenge: Challenge, settings: SimulationSettings): ChallengeEvaluation {
  const hardware = getHardware(settings.hardwareId);
  const model = modelFor(settings);
  const decode = calculateSimulation({ ...settings, phase: 'decode' }, hardware, model);
  const prefill = calculateSimulation({ ...settings, phase: 'prefill' }, hardware, model);
  const needsParking = challenge.constraints.some((constraint) => constraint.metric === 'restoreBeatsRecompute');

  const metrics: Record<ConstraintMetric, number | boolean> = {
    msPerToken: decode.msPerToken,
    // The first pass produces the first token.
    timeToFirstTokenMs: prefill.totalMs,
    totalTokensPerSec: decode.tokenRate,
    // KV placed off the GPU is not "in GPU memory", however much room that frees.
    fitsInGpuMemory: settings.kvPlacement === 'hbm' && decode.hbmUsedFraction <= 1 && decode.hostTrafficBytes === 0,
    restoreBeatsRecompute: needsParking && restoreVsRecompute(settings, hardware, model, settings.idleKvPlacement).cheaper === 'restore',
    concurrentUsers: settings.batch,
    weightBits: settings.weightBits,
    kvBits: settings.kvBits,
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

/** Every reachable setting of the challenge's adjustable knobs, starting from its naive attempt. */
export function everyAttempt(challenge: Challenge): SimulationSettings[] {
  let attempts: SimulationSettings[] = [{ ...challenge.naive }];
  for (const knob of challenge.adjustable) {
    attempts = attempts.flatMap((attempt) => (KNOB_VALUES[knob] as SimulationSettings[KnobId][]).map((value) => ({ ...attempt, [knob]: value })));
  }
  return attempts.filter(isReachable);
}

export function validateChallenge(challenge: Challenge): string[] {
  const errors: string[] = [];
  if (!evaluateChallenge(challenge, challenge.solution).passed) errors.push('Known solution does not pass.');
  if (evaluateChallenge(challenge, challenge.naive).passed) errors.push('Naive configuration must fail.');
  if (!challenge.lessonHolds(challenge.solution)) errors.push('The lesson does not describe the known solution.');

  for (const [key, value] of Object.entries(challenge.fixed)) {
    if (challenge.solution[key as keyof SimulationSettings] !== value) errors.push(`Solution changes fixed setting ${key}.`);
    if (challenge.naive[key as keyof SimulationSettings] !== value) errors.push(`Naive attempt changes fixed setting ${key}.`);
  }
  for (const knob of challenge.adjustable) {
    if (knob in challenge.fixed) errors.push(`${knob} is both fixed and adjustable.`);
  }
  for (const throttle of THROTTLES) {
    if (!challenge.adjustable.includes(throttle)) errors.push(`${throttle} is a throttle but not offered.`);
  }
  if (challenge.adjustable.some((knob) => !THROTTLES.includes(knob) && knob !== 'hardwareId')) errors.push('Only throttles (and the chip) can be adjustable.');
  return errors;
}
