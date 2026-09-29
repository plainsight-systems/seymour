import { DEFAULT_SETTINGS, getHardware } from '../../data/profiles';
import { calculateSimulation } from '../../model/calculate';
import { modelFor } from '../../model/strategy';
import type { SimulationSettings } from '../../types';

// The Act 3 challenge: for a stuck workload, which one throttle helps most?
// Pure: every move is a settings change run through the same model as the
// rest of the story, so the answer follows the chip and is never written
// down by hand.

export type MoveId = 'fp8' | 'kv8' | 'reuse' | 'speculate' | 'users2';
export type Goal = 'token' | 'first';

export interface ThrottleMove {
  id: MoveId;
  label: string;
  detail: string;
}

export const MOVES: ThrottleMove[] = [
  { id: 'fp8', label: '8-bit weights and math', detail: 'Halve the weight bytes and use the FP8 math rate.' },
  { id: 'kv8', label: '8-bit KV cache', detail: 'Halve the bytes of every stored key and value.' },
  { id: 'reuse', label: 'Reuse a shared prompt', detail: 'Skip the part of the prompt already processed for an earlier request.' },
  { id: 'speculate', label: 'Guess 4 tokens ahead', detail: 'Draft 4 tokens by copying from the prompt and check them in one pass.' },
  { id: 'users2', label: 'Serve twice the users', detail: 'Put twice as many users into each pass.' },
];

export const GOAL_LABEL: Record<Goal, string> = {
  token: 'Time per token for each user',
  first: 'Time to the first token',
};

export interface PickScenario {
  id: string;
  title: string;
  story: string;
  goal: Goal;
  phase: SimulationSettings['phase'];
  batch: number;
  sequenceLength: number;
  /** Share of guessed tokens accepted: high when the output copies the prompt, low for open-ended text. */
  acceptance: number;
  /** Percent of each prompt shared with earlier requests (0 when every prompt is different). */
  sharedPrefixPercent: number;
}

export const PICK_SCENARIOS: PickScenario[] = [
  { id: 'code-edit', title: 'A code-editing assistant', story: 'One developer asks for edits to a 4,096-token file. The answer copies most of the file back with small changes, so guesses copied from the prompt usually land (80%). Replies stream too slowly.', goal: 'token', phase: 'decode', batch: 1, sequenceLength: 4096, acceptance: 0.8, sharedPrefixPercent: 0 },
  { id: 'team-chat', title: 'A team assistant with long histories', story: '24 users, each 16,384 tokens into an open-ended conversation. Guesses copied from the prompt rarely land (20%). Everyone’s replies stream too slowly.', goal: 'token', phase: 'decode', batch: 24, sequenceLength: 16384, acceptance: 0.2, sharedPrefixPercent: 0 },
  { id: 'solo-chat', title: 'One user, open-ended chat', story: 'A single user in a short (2,048-token) open-ended chat. Guesses rarely land (20%). The reply streams too slowly.', goal: 'token', phase: 'decode', batch: 1, sequenceLength: 2048, acceptance: 0.2, sharedPrefixPercent: 0 },
  { id: 'support-bot', title: 'A support bot with a long system prompt', story: '8 users at a time send 4,096-token prompts. Three quarters of every prompt is the same system prompt and product manual. The first word takes too long to appear.', goal: 'first', phase: 'prefill', batch: 8, sequenceLength: 4096, acceptance: 0.2, sharedPrefixPercent: 75 },
  { id: 'unique-docs', title: 'Reading unique documents', story: 'One user uploads a different 32,768-token contract each time; nothing is shared between requests. The first word takes too long to appear.', goal: 'first', phase: 'prefill', batch: 1, sequenceLength: 32768, acceptance: 0.2, sharedPrefixPercent: 0 },
];

export function scenarioSettings(scenario: PickScenario, hardwareId: string): SimulationSettings {
  return {
    ...DEFAULT_SETTINGS, hardwareId, phase: scenario.phase, batch: scenario.batch, sequenceLength: scenario.sequenceLength,
    draftAcceptanceRate: scenario.acceptance, reusePromptPrefixes: false, prefixCachePercent: 0, speculativeTokens: 0,
  };
}

export function applyMove(settings: SimulationSettings, move: MoveId, scenario: PickScenario): SimulationSettings {
  switch (move) {
    case 'fp8': return { ...settings, weightBits: 8, mathBits: 8 };
    case 'kv8': return { ...settings, kvBits: 8 };
    case 'reuse': return { ...settings, reusePromptPrefixes: scenario.sharedPrefixPercent > 0, prefixCachePercent: scenario.sharedPrefixPercent };
    case 'speculate': return { ...settings, speculativeTokens: 4 };
    case 'users2': return { ...settings, batch: settings.batch * 2 };
  }
}

/** The goal's time in milliseconds (lower is better), and whether weights plus KV overflow GPU memory. */
export function measure(goal: Goal, settings: SimulationSettings): { ms: number; spills: boolean } {
  const result = calculateSimulation(settings, getHardware(settings.hardwareId), modelFor(settings));
  return { ms: goal === 'token' ? result.msPerToken : result.totalMs, spills: result.hbmUsedFraction > 1 };
}

export interface MoveResult {
  move: MoveId;
  ms: number;
  /** Baseline time ÷ time with the move: above 1 helps, below 1 hurts. */
  speedup: number;
  /** The move pushes weights plus KV past GPU memory, so the overflow is read over PCIe. */
  spills: boolean;
}

export interface PickAnswer {
  baselineMs: number;
  /** Every move, best first. */
  ranked: MoveResult[];
  best: MoveId;
}

export function rankMoves(scenario: PickScenario, hardwareId: string): PickAnswer {
  const base = scenarioSettings(scenario, hardwareId);
  const baselineMs = measure(scenario.goal, base).ms;
  const ranked = MOVES
    .map(({ id }) => {
      const { ms, spills } = measure(scenario.goal, applyMove(base, id, scenario));
      return { move: id, ms, speedup: baselineMs / ms, spills };
    })
    .sort((a, b) => b.speedup - a.speedup);
  return { baselineMs, ranked, best: ranked[0]!.move };
}

/** Why the best move wins, by move and goal. Absent pairs get no invented reason. */
export const WHY: Partial<Record<`${MoveId}/${Goal}`, string>> = {
  'speculate/token': 'Each later pass mostly waits on reading memory, so checking four guessed tokens in the same pass costs little extra. When most guesses land, one pass yields several tokens.',
  'kv8/token': 'The KV cache is the biggest read in each pass here, so halving its bytes saves the most time. Guesses rarely land in open chat, so guessing ahead helps less.',
  'fp8/token': 'With one user and a short context, the weights are almost the whole read in each pass; 8-bit weights halve it. Guesses rarely land, so guessing ahead helps less.',
  'reuse/first': 'Most of each prompt was already processed for an earlier request. Skipping it removes most of the first pass’s math, more than a faster math rate can.',
  'fp8/first': 'The first pass is limited by math, and nothing is shared to skip, so the FP8 math rate (twice the 16-bit rate) is the lever that helps.',
};
