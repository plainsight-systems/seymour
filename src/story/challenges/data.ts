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
];

export function getChallenge(id: string): Challenge {
  const challenge = CHALLENGES.find((candidate) => candidate.id === id);
  if (!challenge) throw new Error(`Unknown challenge: ${id}`);
  return challenge;
}
