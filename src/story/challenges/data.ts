import { DEFAULT_SETTINGS, getHardware } from '../../data/profiles';
import { calculateSimulation } from '../../model/calculate';
import { modelFor } from '../../model/strategy';
import type { SimulationSettings } from '../../types';
import { KNOB_VALUES, THROTTLES, type Challenge } from './engine';

// Every challenge offers every throttle; only the workload is fixed. Each is
// built for the chosen chip: its workload and targets come from that chip's
// own numbers (computed by the model, never typed in), so every chip gets the
// same puzzle and lesson. Each lesson claims only what every passing answer
// shares, which the tests prove on every chip by searching every throttle.

/**
 * The obvious attempt's throttles: every challenge starts from here, with no
 * throttle already pulled. (The app's defaults turn prompt reuse on.)
 */
const base = {
  ...DEFAULT_SETTINGS,
  batch: 1, weightBits: 16, mathBits: 16, kvBits: 16, reusePromptPrefixes: false, speculativeTokens: 0, kvPlacement: 'hbm', idleKvPlacement: 'host',
} satisfies SimulationSettings;

/** Open-ended chat: guesses copied from the prompt rarely land. */
const OPEN_CHAT = 0.2;

function run(settings: SimulationSettings) {
  const hardware = getHardware(settings.hardwareId);
  const model = modelFor(settings);
  return {
    decode: calculateSimulation({ ...settings, phase: 'decode' }, hardware, model),
    prefill: calculateSimulation({ ...settings, phase: 'prefill' }, hardware, model),
  };
}

/** Rounds a target to two significant figures, so it reads as a target rather than a measurement. */
function nice(value: number): number {
  return Number(value.toPrecision(2));
}

/** The smallest user count the controls offer that satisfies a condition; throws if none does. */
function usersWhere(label: string, condition: (batch: number) => boolean): number {
  const batch = KNOB_VALUES.batch.find(condition);
  if (batch === undefined) throw new Error(`No user count satisfies: ${label}`);
  return batch;
}

const chipName = (hardwareId: string) => getHardware(hardwareId).name;

function chatbot(hardwareId: string): Challenge {
  const workload = { ...base, hardwareId, sequenceLength: 4096, draftAcceptanceRate: OPEN_CHAT, prefixCachePercent: 0 };
  const obvious = run({ ...workload, batch: 1 }).decode;
  const msTarget = nice(obvious.msPerToken * 1.75);
  const rateTarget = nice(obvious.tokenRate * 20);
  return {
    id: 'chatbot',
    title: 'The chatbot',
    brief: `An open-ended chat service with 4,096-token conversations on the ${chipName(hardwareId)}. Serve at least ${rateTarget.toLocaleString()} tokens per second in total, while each user’s tokens arrive at most ${msTarget} ms apart.`,
    fixed: { hardwareId, sequenceLength: 4096, draftAcceptanceRate: OPEN_CHAT, prefixCachePercent: 0 },
    adjustable: THROTTLES,
    constraints: [
      { metric: 'msPerToken', op: '<=', value: msTarget },
      { metric: 'totalTokensPerSec', op: '>=', value: rateTarget },
    ],
    solution: { ...workload, batch: 32, weightBits: 8 },
    naive: { ...workload, batch: 1 },
    lesson: `Batching shares each read of the weights across users, but at 16-bit weights and KV, enough users to reach ${rateTarget.toLocaleString()} tokens per second push each token past ${msTarget} ms. Cutting the bytes each pass reads, in the weights or the KV, makes room; on a chip with math to spare, checking guessed tokens in the same pass can too, even when few land. The KV has to stay in GPU memory.`,
    lessonHolds: (settings) => settings.batch >= 8 && (settings.weightBits <= 8 || settings.kvBits === 8 || settings.speculativeTokens > 0) && settings.kvPlacement === 'hbm',
  };
}

function longDocument(hardwareId: string): Challenge {
  const workload = { ...base, hardwareId, sequenceLength: 32768, prefixCachePercent: 75, draftAcceptanceRate: OPEN_CHAT };
  // Enough conversations that 16-bit KV overflows even beside 4-bit weights, while 8-bit KV fits beside 16-bit weights.
  const users = usersWhere('16-bit KV overflows, 8-bit KV fits', (batch) =>
    run({ ...workload, batch, weightBits: 4 }).decode.hbmUsedFraction > 1.0
    && run({ ...workload, batch, kvBits: 8 }).decode.hbmUsedFraction <= 0.95);
  const firstTarget = nice(run({ ...workload, batch: users }).prefill.totalMs * 0.45);
  return {
    id: 'long-document',
    title: 'The long document',
    brief: `${users} conversations of 32K tokens about the same contract: three quarters of every prompt is that shared document. Serve all ${users} at once from the ${chipName(hardwareId)}’s memory, and return the first token within ${(firstTarget / 1000).toLocaleString()} seconds.`,
    fixed: { hardwareId, sequenceLength: 32768, prefixCachePercent: 75, draftAcceptanceRate: OPEN_CHAT },
    adjustable: THROTTLES,
    constraints: [
      { metric: 'concurrentUsers', op: '>=', value: users },
      { metric: 'fitsInGpuMemory', op: '==', value: true },
      { metric: 'timeToFirstTokenMs', op: '<=', value: firstTarget },
    ],
    solution: { ...workload, batch: users, kvBits: 8, reusePromptPrefixes: true },
    naive: { ...workload, batch: users },
    lesson: `${users} conversations of 32K tokens in 16-bit KV do not fit beside the weights, even with 4-bit weights; 8-bit KV moves the wall. The first token is a first pass over the whole prompt, and only skipping the shared part gets it under the target: a faster math rate is not enough.`,
    lessonHolds: (settings) => settings.kvBits === 8 && settings.reusePromptPrefixes,
  };
}

function placementProposal(hardwareId: string): Challenge {
  const workload = { ...base, hardwareId, sequenceLength: 2048, draftAcceptanceRate: OPEN_CHAT, prefixCachePercent: 0 };
  const msTarget = nice(run({ ...workload, batch: 64 }).decode.msPerToken * 1.5);
  return {
    id: 'placement-proposal',
    title: 'The object-storage proposal',
    brief: `A teammate proposes keeping KV in network object storage. Serve 64 users with 2,048-token conversations, each user’s tokens at most ${msTarget} ms apart, then choose where an idle session’s KV waits so that bringing it back beats rebuilding it.`,
    fixed: { hardwareId, sequenceLength: 2048, draftAcceptanceRate: OPEN_CHAT, prefixCachePercent: 0 },
    adjustable: THROTTLES,
    constraints: [
      { metric: 'concurrentUsers', op: '>=', value: 64 },
      { metric: 'msPerToken', op: '<=', value: msTarget },
      { metric: 'restoreBeatsRecompute', op: '==', value: true },
    ],
    solution: { ...workload, batch: 64, kvPlacement: 'hbm', idleKvPlacement: 'host' },
    naive: { ...workload, batch: 64, kvPlacement: 'object', idleKvPlacement: 'object' },
    lesson: 'Every token re-reads the active KV, so it must live on a GPU: this one, or its neighbors over the fast GPU-to-GPU link. Behind PCIe or in storage it is far too slow. An idle session can wait farther away, as long as bringing it back beats rebuilding it; network object storage loses even that.',
    lessonHolds: (settings) => ['hbm', 'peer', 'peers'].includes(settings.kvPlacement) && settings.idleKvPlacement !== 'object',
  };
}

function codeAssistant(hardwareId: string): Challenge {
  const workload = { ...base, hardwareId, sequenceLength: 4096, draftAcceptanceRate: 0.8, prefixCachePercent: 0 };
  const msTarget = nice(run({ ...workload, batch: 1 }).decode.msPerToken * 0.175);
  return {
    id: 'code-assistant',
    title: 'The code assistant',
    brief: `One developer asks for edits to a 4,096-token file. The answer copies most of the file back, so 80% of guessed tokens land. Stream each token within ${msTarget} ms.`,
    fixed: { hardwareId, sequenceLength: 4096, draftAcceptanceRate: 0.8, prefixCachePercent: 0 },
    adjustable: THROTTLES,
    constraints: [{ metric: 'msPerToken', op: '<=', value: msTarget }],
    solution: { ...workload, batch: 1, weightBits: 8, speculativeTokens: 4 },
    naive: { ...workload, batch: 1 },
    lesson: `One user’s pass is almost all weight reading. Fewer weight bytes shrink that read, and when guesses usually land, checking several in one pass turns one read into several tokens. Neither alone reaches ${msTarget} ms here.`,
    lessonHolds: (settings) => settings.speculativeTokens > 0 && settings.weightBits <= 8,
  };
}

function biggerModel(hardwareId: string): Challenge {
  const workload = { ...base, hardwareId, modelId: 'qwen3-30b-a3b', sequenceLength: 4096, draftAcceptanceRate: OPEN_CHAT, prefixCachePercent: 0 };
  // Enough users that the 16-bit model and its KV clearly overflow, while halving both clearly fits.
  const users = usersWhere('16-bit overflows, 8-bit fits', (batch) =>
    run({ ...workload, batch }).decode.hbmUsedFraction > 1.1
    && run({ ...workload, batch, weightBits: 8, kvBits: 8 }).decode.hbmUsedFraction <= 0.95);
  return {
    id: 'bigger-model',
    title: 'The bigger model',
    brief: `Serve Qwen3 30B-A3B, a mixture-of-experts model, to ${users} users with 4,096-token conversations on one ${chipName(hardwareId)}, from GPU memory.`,
    fixed: { hardwareId, modelId: 'qwen3-30b-a3b', sequenceLength: 4096, draftAcceptanceRate: OPEN_CHAT, prefixCachePercent: 0 },
    adjustable: THROTTLES,
    constraints: [
      { metric: 'concurrentUsers', op: '>=', value: users },
      { metric: 'fitsInGpuMemory', op: '==', value: true },
    ],
    solution: { ...workload, batch: users, weightBits: 8, kvBits: 8 },
    naive: { ...workload, batch: users },
    lesson: 'Each token reads only the few experts it is routed to, but every expert must be stored, so memory capacity is the wall before bandwidth is. Cutting bytes, in the weights, the KV, or both, is what makes room.',
    lessonHolds: (settings) => settings.weightBits <= 8 || settings.kvBits === 8,
  };
}

/** The chip is this challenge's question, so it does not depend on the chip picked above. */
function pickTheChip(): Challenge {
  const workload = { ...base, sequenceLength: 32768, draftAcceptanceRate: OPEN_CHAT, prefixCachePercent: 0 };
  return {
    id: 'pick-the-chip',
    title: 'Pick the chip',
    brief: 'Sixteen 32K-token conversations, all different, with weights and KV kept at 16 bits for quality. Choose a chip that holds them all in GPU memory and returns the first token within 20 seconds.',
    fixed: { sequenceLength: 32768, draftAcceptanceRate: OPEN_CHAT, prefixCachePercent: 0 },
    adjustable: [...THROTTLES, 'hardwareId'],
    constraints: [
      { metric: 'concurrentUsers', op: '>=', value: 16 },
      { metric: 'weightBits', op: '==', value: 16 },
      { metric: 'kvBits', op: '==', value: 16 },
      { metric: 'fitsInGpuMemory', op: '==', value: true },
      { metric: 'timeToFirstTokenMs', op: '<=', value: 20000 },
    ],
    solution: { ...workload, batch: 16, hardwareId: 'mi300x' },
    naive: { ...workload, batch: 16, hardwareId: 'h100-sxm' },
    lesson: 'Memory capacity decides whether the conversations fit: the H100 cannot hold them. The first token is a first pass, limited by math: the H200 holds them but has the H100’s math rate, so it misses 20 seconds.',
    lessonHolds: (settings) => settings.hardwareId !== 'h100-sxm' && settings.hardwareId !== 'h200-sxm',
  };
}

/** Every challenge, built for the chip picked above. */
export function challengesFor(hardwareId: string): Challenge[] {
  return [chatbot(hardwareId), longDocument(hardwareId), placementProposal(hardwareId), codeAssistant(hardwareId), biggerModel(hardwareId), pickTheChip()];
}

export function getChallenge(id: string, hardwareId: string): Challenge {
  const challenge = challengesFor(hardwareId).find((candidate) => candidate.id === id);
  if (!challenge) throw new Error(`Unknown challenge: ${id}`);
  return challenge;
}
