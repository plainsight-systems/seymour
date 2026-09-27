import { DEFAULT_SETTINGS } from '../../data/profiles';
import type { SimulationSettings } from '../../types';
import type { Challenge } from './engine';

const base = { ...DEFAULT_SETTINGS } satisfies SimulationSettings;

export const CHALLENGES: Challenge[] = [
  {
    id: 'chatbot',
    title: 'The chatbot',
    brief: 'Serve a busy chat workload without letting each generated token exceed 25 ms.',
    fixed: { hardwareId: 'h100-sxm', sequenceLength: 4096, kvPlacement: 'hbm' },
    adjustable: ['weightBits', 'batch'],
    constraints: [
      { metric: 'msPerToken', op: '<=', value: 25 },
      { metric: 'totalTokensPerSec', op: '>=', value: 3000 },
    ],
    solution: { ...base, batch: 64, weightBits: 8 },
    naive: { ...base, batch: 1, weightBits: 16 },
    lesson: 'Batching shares each model read across users; fewer weight bytes lower the cost of that shared read.',
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
    lesson: 'KV precision changes the capacity wall; shared-prefix reuse removes prompt work without pretending the cache is free to read.',
  },
  {
    id: 'placement-proposal',
    title: 'The object-storage proposal',
    brief: 'A teammate proposes reading active KV from object storage. Keep generation responsive, then decide where an idle session can wait.',
    fixed: { hardwareId: 'h100-sxm', batch: 64, sequenceLength: 4096 },
    adjustable: ['kvPlacement'],
    constraints: [
      { metric: 'msPerToken', op: '<=', value: 50 },
      { metric: 'activeKvInGpuMemory', op: '==', value: true },
      { metric: 'restoreBeatsRecompute', op: '==', value: true },
    ],
    solution: { ...base, batch: 64, kvPlacement: 'hbm' },
    naive: { ...base, batch: 64, kvPlacement: 'object' },
    parkingTier: 'host',
    lesson: 'Active KV belongs beside the math. Idle KV can wait in system memory when restoring it is cheaper than rebuilding it with prefill.',
  },
];

export function getChallenge(id: string): Challenge {
  return CHALLENGES.find((challenge) => challenge.id === id) ?? CHALLENGES[0]!;
}
