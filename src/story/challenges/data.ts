import { DEFAULT_SETTINGS } from '../../data/profiles';
import type { SimulationSettings } from '../../types';
import { THROTTLES, type Challenge } from './engine';

// Every challenge offers every throttle; only the workload is fixed. Each
// lesson claims only what every passing answer shares, which the tests prove
// by searching every combination of throttles.

const base = { ...DEFAULT_SETTINGS } satisfies SimulationSettings;

/** Open-ended chat: guesses copied from the prompt rarely land. */
const OPEN_CHAT = 0.2;

export const CHALLENGES: Challenge[] = [
  {
    id: 'chatbot',
    title: 'The chatbot',
    brief: 'An open-ended chat service with 4,096-token conversations. Serve at least 3,000 tokens per second in total, while each user’s tokens arrive at most 12 ms apart.',
    fixed: { hardwareId: 'h100-sxm', sequenceLength: 4096, draftAcceptanceRate: OPEN_CHAT, prefixCachePercent: 0 },
    adjustable: THROTTLES,
    constraints: [
      { metric: 'msPerToken', op: '<=', value: 12 },
      { metric: 'totalTokensPerSec', op: '>=', value: 3000 },
    ],
    solution: { ...base, sequenceLength: 4096, draftAcceptanceRate: OPEN_CHAT, batch: 32, weightBits: 8 },
    naive: { ...base, sequenceLength: 4096, draftAcceptanceRate: OPEN_CHAT, batch: 1 },
    lesson: 'Batching shares each read of the weights across users, but at 16-bit weights and KV, enough users to reach 3,000 tokens per second push each token past 12 ms. Cutting the bytes each pass reads, in the weights or the KV, makes room; the KV has to stay in GPU memory.',
    lessonHolds: (settings) => settings.batch >= 8 && (settings.weightBits <= 8 || settings.kvBits === 8) && settings.kvPlacement === 'hbm',
  },
  {
    id: 'long-document',
    title: 'The long document',
    brief: 'Sixteen 32K-token conversations about the same contract: three quarters of every prompt is that shared document. Serve all sixteen at once from GPU memory, and return the first token within ten seconds.',
    fixed: { hardwareId: 'h100-sxm', sequenceLength: 32768, prefixCachePercent: 75, draftAcceptanceRate: OPEN_CHAT },
    adjustable: THROTTLES,
    constraints: [
      { metric: 'concurrentUsers', op: '>=', value: 16 },
      { metric: 'fitsInGpuMemory', op: '==', value: true },
      { metric: 'timeToFirstTokenMs', op: '<=', value: 10000 },
    ],
    solution: { ...base, sequenceLength: 32768, prefixCachePercent: 75, draftAcceptanceRate: OPEN_CHAT, batch: 16, kvBits: 8, reusePromptPrefixes: true },
    naive: { ...base, sequenceLength: 32768, prefixCachePercent: 75, draftAcceptanceRate: OPEN_CHAT, batch: 16 },
    lesson: 'Sixteen 32K conversations of 16-bit KV do not fit beside the weights, even with 4-bit weights; 8-bit KV moves the wall. The first token is a first pass over the whole prompt, and only skipping the shared part gets it under ten seconds: a faster math rate is not enough.',
    lessonHolds: (settings) => settings.kvBits === 8 && settings.reusePromptPrefixes,
  },
  {
    id: 'placement-proposal',
    title: 'The object-storage proposal',
    brief: 'A teammate proposes keeping KV in network object storage. Serve 64 users with 2,048-token conversations, each user’s tokens at most 30 ms apart, then choose where an idle session’s KV waits so that bringing it back beats rebuilding it.',
    fixed: { hardwareId: 'h100-sxm', sequenceLength: 2048, draftAcceptanceRate: OPEN_CHAT, prefixCachePercent: 0 },
    adjustable: THROTTLES,
    constraints: [
      { metric: 'concurrentUsers', op: '>=', value: 64 },
      { metric: 'msPerToken', op: '<=', value: 30 },
      { metric: 'restoreBeatsRecompute', op: '==', value: true },
    ],
    solution: { ...base, sequenceLength: 2048, draftAcceptanceRate: OPEN_CHAT, batch: 64, kvPlacement: 'hbm', idleKvPlacement: 'host' },
    naive: { ...base, sequenceLength: 2048, draftAcceptanceRate: OPEN_CHAT, batch: 64, kvPlacement: 'object', idleKvPlacement: 'object' },
    lesson: 'Every token re-reads the active KV, so it must live on a GPU: this one, or its neighbors over the fast GPU-to-GPU link. Behind PCIe or in storage it is far too slow. An idle session can wait farther away, even on local SSD, as long as bringing it back beats rebuilding it; network object storage loses even that.',
    lessonHolds: (settings) => ['hbm', 'peer', 'peers'].includes(settings.kvPlacement) && settings.idleKvPlacement !== 'object',
  },
  {
    id: 'code-assistant',
    title: 'The code assistant',
    brief: 'One developer asks for edits to a 4,096-token file. The answer copies most of the file back, so 80% of guessed tokens land. Stream each token within 1.2 ms.',
    fixed: { hardwareId: 'h100-sxm', sequenceLength: 4096, draftAcceptanceRate: 0.8, prefixCachePercent: 0 },
    adjustable: THROTTLES,
    constraints: [{ metric: 'msPerToken', op: '<=', value: 1.2 }],
    solution: { ...base, sequenceLength: 4096, draftAcceptanceRate: 0.8, batch: 1, weightBits: 8, speculativeTokens: 4 },
    naive: { ...base, sequenceLength: 4096, draftAcceptanceRate: 0.8, batch: 1 },
    lesson: 'One user’s pass is almost all weight reading. Fewer weight bytes shrink that read, and when guesses usually land, checking several in one pass turns one read into several tokens. Neither alone reaches 1.2 ms here.',
    lessonHolds: (settings) => settings.speculativeTokens > 0 && settings.weightBits <= 8,
  },
  {
    id: 'bigger-model',
    title: 'The bigger model',
    brief: 'Serve Qwen3 30B-A3B, a mixture-of-experts model, to 64 users with 4,096-token conversations on one H100. Fit in GPU memory and keep each user’s tokens at most 40 ms apart.',
    fixed: { hardwareId: 'h100-sxm', modelId: 'qwen3-30b-a3b', sequenceLength: 4096, draftAcceptanceRate: OPEN_CHAT, prefixCachePercent: 0 },
    adjustable: THROTTLES,
    constraints: [
      { metric: 'concurrentUsers', op: '>=', value: 64 },
      { metric: 'fitsInGpuMemory', op: '==', value: true },
      { metric: 'msPerToken', op: '<=', value: 40 },
    ],
    solution: { ...base, modelId: 'qwen3-30b-a3b', sequenceLength: 4096, draftAcceptanceRate: OPEN_CHAT, batch: 64, weightBits: 8 },
    naive: { ...base, modelId: 'qwen3-30b-a3b', sequenceLength: 4096, draftAcceptanceRate: OPEN_CHAT, batch: 64 },
    lesson: 'Each token reads only the few experts it is routed to, but every expert must be stored. At 16-bit the weights leave too little room for 64 users’ KV, and 8-bit KV alone does not free enough. Capacity, not bandwidth, is the wall: fewer weight bytes are the fix.',
    lessonHolds: (settings) => settings.weightBits <= 8,
  },
  {
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
    solution: { ...base, sequenceLength: 32768, draftAcceptanceRate: OPEN_CHAT, batch: 16, hardwareId: 'mi300x' },
    naive: { ...base, sequenceLength: 32768, draftAcceptanceRate: OPEN_CHAT, batch: 16, hardwareId: 'h100-sxm' },
    lesson: 'Memory capacity decides whether the conversations fit: the H100 cannot hold them. The first token is a first pass, limited by math: the H200 holds them but has the H100’s math rate, so it misses 20 seconds.',
    lessonHolds: (settings) => settings.hardwareId !== 'h100-sxm' && settings.hardwareId !== 'h200-sxm',
  },
];

export function getChallenge(id: string): Challenge {
  const challenge = CHALLENGES.find((candidate) => candidate.id === id);
  if (!challenge) throw new Error(`Unknown challenge: ${id}`);
  return challenge;
}
