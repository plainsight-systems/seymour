import { DEFAULT_SETTINGS } from '../../data/profiles';
import type { SimulationSettings } from '../../types';
import type { Challenge } from './engine';

const base = { ...DEFAULT_SETTINGS } satisfies SimulationSettings;

export const CHALLENGES: Challenge[] = [
  {
    id: 'chatbot',
    title: 'The chatbot',
    brief: 'Serve at least 3,000 tokens per second in total, while each user’s tokens arrive at most 12 ms apart.',
    fixed: { hardwareId: 'h100-sxm', sequenceLength: 4096, kvPlacement: 'hbm' },
    adjustable: ['batch', 'weightBits'],
    constraints: [
      { metric: 'msPerToken', op: '<=', value: 12 },
      { metric: 'totalTokensPerSec', op: '>=', value: 3000 },
    ],
    solution: { ...base, batch: 32, weightBits: 8 },
    naive: { ...base, batch: 1, weightBits: 16 },
    lesson: 'Batching shares each weight read across users, but at 16-bit enough users to reach 3,000 tokens per second push each token past 12 ms. Fewer weight bytes make every shared read cheaper, so you need both.',
    lessonHolds: (settings) => settings.weightBits <= 8 && settings.batch >= 16,
  },
  {
    id: 'long-document',
    title: 'The long document',
    brief: 'Handle sixteen 32K-token conversations, fit them in GPU memory, and return the first token within ten seconds.',
    fixed: { hardwareId: 'h100-sxm', batch: 16, sequenceLength: 32768, kvPlacement: 'hbm' },
    adjustable: ['kvBits', 'reusePromptPrefixes', 'prefixCachePercent'],
    constraints: [
      { metric: 'fitsInGpuMemory', op: '==', value: true },
      { metric: 'timeToFirstTokenMs', op: '<=', value: 10000 },
    ],
    solution: { ...base, batch: 16, sequenceLength: 32768, kvBits: 8, prefixCachePercent: 75, reusePromptPrefixes: true },
    naive: { ...base, batch: 16, sequenceLength: 32768, kvBits: 16, prefixCachePercent: 0 },
    lesson: 'KV precision moves the capacity wall; reusing a shared prompt removes first-pass work without pretending the cache is free to read.',
    lessonHolds: (settings) => settings.kvBits === 8 && settings.reusePromptPrefixes && settings.prefixCachePercent >= 75,
  },
  {
    id: 'placement-proposal',
    title: 'The object-storage proposal',
    brief: 'A teammate proposes keeping KV in network object storage. Keep 64 users’ tokens at most 50 ms apart, then choose where an idle session’s KV waits so that bringing it back beats rebuilding it.',
    fixed: { hardwareId: 'h100-sxm', batch: 64, sequenceLength: 4096 },
    adjustable: ['kvPlacement', 'idleKvPlacement'],
    constraints: [
      { metric: 'msPerToken', op: '<=', value: 50 },
      { metric: 'restoreBeatsRecompute', op: '==', value: true },
    ],
    solution: { ...base, batch: 64, kvPlacement: 'hbm', idleKvPlacement: 'host' },
    naive: { ...base, batch: 64, kvPlacement: 'object', idleKvPlacement: 'object' },
    lesson: 'Active KV belongs beside the math: every token re-reads it. An idle session can wait farther away, even on local SSD, as long as reading it back beats rebuilding it with a first pass. Network object storage is too slow even for that at this size.',
    lessonHolds: (settings) => settings.kvPlacement === 'hbm' && settings.idleKvPlacement !== 'object',
  },
  {
    id: 'code-assistant',
    title: 'The code assistant',
    brief: 'One developer asks for edits to a 4,096-token file. The answer copies most of the file back, so 80% of guessed tokens land. Stream each token within 1.2 ms.',
    fixed: { hardwareId: 'h100-sxm', batch: 1, sequenceLength: 4096, draftAcceptanceRate: 0.8 },
    adjustable: ['weightBits', 'speculativeTokens'],
    constraints: [{ metric: 'msPerToken', op: '<=', value: 1.2 }],
    solution: { ...base, batch: 1, sequenceLength: 4096, draftAcceptanceRate: 0.8, weightBits: 8, speculativeTokens: 4 },
    naive: { ...base, batch: 1, sequenceLength: 4096, draftAcceptanceRate: 0.8, weightBits: 16, speculativeTokens: 0 },
    lesson: 'One user’s pass is almost all weight reading. Fewer weight bytes shrink that read, and when guesses usually land, checking several in one pass turns one read into several tokens. Neither alone reaches 1.2 ms here.',
    lessonHolds: (settings) => settings.speculativeTokens > 0 && settings.weightBits <= 8,
  },
  {
    id: 'bigger-model',
    title: 'The bigger model',
    brief: 'Serve Qwen3 30B-A3B, a mixture-of-experts model, to 48 users with 8,192-token conversations on one H100. Fit in GPU memory and keep each user’s tokens at most 40 ms apart.',
    fixed: { hardwareId: 'h100-sxm', modelId: 'qwen3-30b-a3b', batch: 48, sequenceLength: 8192 },
    adjustable: ['weightBits', 'kvBits'],
    constraints: [
      { metric: 'fitsInGpuMemory', op: '==', value: true },
      { metric: 'msPerToken', op: '<=', value: 40 },
    ],
    solution: { ...base, modelId: 'qwen3-30b-a3b', batch: 48, sequenceLength: 8192, weightBits: 8, kvBits: 8 },
    naive: { ...base, modelId: 'qwen3-30b-a3b', batch: 48, sequenceLength: 8192, weightBits: 16, kvBits: 16 },
    lesson: 'Each token reads only the few experts it is routed to, but every expert must be stored. At 16-bit the weights leave too little room for 48 users’ KV, and 8-bit KV alone does not free enough. Capacity, not bandwidth, is the wall: fewer weight bytes are the fix.',
    lessonHolds: (settings) => settings.weightBits <= 8,
  },
  {
    id: 'pick-the-chip',
    title: 'Pick the chip',
    brief: 'Sixteen 32K-token conversations, with the KV cache kept at 16 bits for quality. Choose a chip that holds them all in GPU memory and returns the first token within 20 seconds.',
    fixed: { batch: 16, sequenceLength: 32768, kvBits: 16, kvPlacement: 'hbm' },
    adjustable: ['hardwareId'],
    constraints: [
      { metric: 'fitsInGpuMemory', op: '==', value: true },
      { metric: 'timeToFirstTokenMs', op: '<=', value: 20000 },
    ],
    solution: { ...base, batch: 16, sequenceLength: 32768, hardwareId: 'mi300x' },
    naive: { ...base, batch: 16, sequenceLength: 32768, hardwareId: 'h100-sxm' },
    lesson: 'Memory capacity decides whether the conversations fit: the H100 cannot hold them. The first token is a first pass, limited by math: the H200 holds them but has the H100’s math rate, so it misses 20 seconds.',
    lessonHolds: (settings) => settings.hardwareId !== 'h100-sxm' && settings.hardwareId !== 'h200-sxm',
  },
];

export function getChallenge(id: string): Challenge {
  const challenge = CHALLENGES.find((candidate) => candidate.id === id);
  if (!challenge) throw new Error(`Unknown challenge: ${id}`);
  return challenge;
}
