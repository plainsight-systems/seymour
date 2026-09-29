import { DEFAULT_SETTINGS, getHardware } from '../../data/profiles';
import { buildForwardPass, type ForwardStage, type StageId } from '../../model/forwardPass';
import { modelFor } from '../../model/strategy';
import type { SimulationSettings } from '../../types';

// The Act 2 challenge: given a workload, find the slowest stage of one
// forward pass and what limits it. Pure: answers come from the same
// forward-pass model as the stage scenes, so they change with the chip and
// are never written down by hand.

export type Limit = ForwardStage['limit'];

export interface BottleneckScenario {
  id: string;
  title: string;
  story: string;
  phase: SimulationSettings['phase'];
  batch: number;
  sequenceLength: number;
}

export const SCENARIOS: BottleneckScenario[] = [
  { id: 'chat-reply', title: 'One user, writing a reply', story: 'A single user is chatting. The model writes the reply one token at a time, with 2,048 tokens of conversation so far.', phase: 'decode', batch: 1, sequenceLength: 2048 },
  { id: 'team-chats', title: 'A team assistant, long chats', story: '16 users, each 8,192 tokens into a conversation. The model writes one token for every user in each pass.', phase: 'decode', batch: 16, sequenceLength: 8192 },
  { id: 'busy-long', title: 'A busy service, long documents', story: '64 users each asking questions about a 32,768-token document. The model is writing their answers.', phase: 'decode', batch: 64, sequenceLength: 32768 },
  { id: 'short-prompts', title: 'Reading short prompts', story: '8 users send 512-token prompts at once. The model reads them before writing the first word of any answer.', phase: 'prefill', batch: 8, sequenceLength: 512 },
  // 131,072 tokens is Llama 3.1's longest context. Causal attention only
  // clearly outgrows the MLP's math at prompts well beyond 32K tokens.
  { id: 'summarize', title: 'Summarize a whole book', story: 'One user pastes a 131,072-token book, the longest context this model accepts. The model reads all of it before the first word appears.', phase: 'prefill', batch: 1, sequenceLength: 131072 },
];

export interface BottleneckAnswer {
  stage: StageId;
  limit: Limit;
  /** Every stage with its time floor, in pass order. */
  stages: ForwardStage[];
  totalMs: number;
}

export function stageTimeMs(stage: ForwardStage): number {
  return Math.max(stage.computeMs, stage.memoryMs);
}

export function scenarioSettings(scenario: BottleneckScenario, hardwareId: string): SimulationSettings {
  return { ...DEFAULT_SETTINGS, hardwareId, phase: scenario.phase, batch: scenario.batch, sequenceLength: scenario.sequenceLength, reusePromptPrefixes: false, prefixCachePercent: 0 };
}

export function solve(scenario: BottleneckScenario, hardwareId: string): BottleneckAnswer {
  const settings = scenarioSettings(scenario, hardwareId);
  const stages = buildForwardPass(settings, modelFor(settings), getHardware(hardwareId));
  const slowest = stages.reduce((best, stage) => (stageTimeMs(stage) > stageTimeMs(best) ? stage : best));
  return { stage: slowest.id, limit: slowest.limit, stages, totalMs: stages.reduce((sum, stage) => sum + stageTimeMs(stage), 0) };
}

export interface BottleneckVerdict {
  stageRight: boolean;
  limitRight: boolean;
}

export function judge(answer: BottleneckAnswer, pick: { stage: StageId; limit: Limit }): BottleneckVerdict {
  return { stageRight: pick.stage === answer.stage, limitRight: pick.limit === answer.limit };
}

export interface Tally {
  answered: number;
  right: number;
  total: number;
  complete: boolean;
}

/** The running score: results maps scenario id → both parts right. Unknown ids are ignored. */
export function tally(results: ReadonlyMap<string, boolean>): Tally {
  const answered = SCENARIOS.filter((scenario) => results.has(scenario.id));
  const right = answered.filter((scenario) => results.get(scenario.id)).length;
  return { answered: answered.length, right, total: SCENARIOS.length, complete: answered.length === SCENARIOS.length };
}

/** Why a stage ends up slowest under a given limit. Absent pairs get no invented reason. */
export const WHY: Partial<Record<StageId, Partial<Record<Limit, string>>>> = {
  attention: {
    memory: 'The KV cache. Every step re-reads each user’s whole context, so bytes grow with users × context while the math per byte stays small.',
    math: 'Scores grow with the square of the prompt: every token compares itself against every earlier token, so long prompts pile up math.',
  },
  mlp: {
    memory: 'The weights. Every step reads all the MLP weights, and with few tokens in the step there is little math to do per byte read.',
    math: 'Many tokens share each weight read, so the matrix units, not memory, set the pace.',
  },
  unembed: {
    memory: 'The vocabulary matrix is read in full on every step, whatever the batch.',
    math: 'Many users each score the whole vocabulary, so the math outgrows the one matrix read.',
  },
};
