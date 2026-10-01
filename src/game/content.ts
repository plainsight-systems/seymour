import { formatDuration } from '../model/calculate';
import type { KvPlacement, SimulationSettings } from '../types';
import { DEFAULT_GAME_CONFIGURATION, measureOrder } from './evaluate';
import type { GameConfiguration, GameOrder, GameShift, OrderConstraint, OrderMetric, PlantKind } from './types';

function config(overrides: Partial<GameConfiguration> = {}): GameConfiguration {
  return { ...DEFAULT_GAME_CONFIGURATION, ...overrides };
}

function nice(value: number): number {
  return Number(value.toPrecision(3));
}

function metric(workload: Partial<SimulationSettings>, choice: GameConfiguration, name: OrderMetric, groupSize = 1): number {
  const phase = name === 'firstTokenMs' ? 'first-token' : name === 'restoreBeatsRecompute' ? 'idle-return' : 'next-token';
  return Number(measureOrder({ workload, phase }, choice, groupSize).metrics[name]);
}

function upperTarget(workload: Partial<SimulationSettings>, naive: GameConfiguration, solution: GameConfiguration, name: 'firstTokenMs' | 'msPerToken', groupSize = 1): number {
  const slow = metric(workload, naive, name);
  const fast = metric(workload, solution, name, groupSize);
  if (fast >= slow) throw new Error(`${name} solution does not improve the order.`);
  return nice(fast + (slow - fast) * 0.35);
}

interface OrderSeed {
  id: string;
  plantName: string;
  plantKind: PlantKind;
  orderName: string;
  phase: GameOrder['phase'];
  request: string;
  workload: Partial<SimulationSettings>;
  initial: GameConfiguration;
  solution: GameConfiguration;
  patienceMs: number;
  arrivalMs: number;
  lane: 0 | 1 | 2;
  hint: string;
  batchFamily?: string;
  solutionGroupSize?: number;
  prefixName?: string;
  sourceKvPlacement?: KvPlacement;
}

function order(seed: OrderSeed, constraints: OrderConstraint[]): GameOrder {
  return { ...seed, constraints };
}

const openingPrefillWorkload: Partial<SimulationSettings> = {
  hardwareId: 'h100-sxm', modelId: 'llama-3.1-8b', sequenceLength: 8192, outputLength: 32,
  batch: 1, prefixCachePercent: 0, splitLongPrompts: false,
};
const openingDecodeWorkload: Partial<SimulationSettings> = {
  hardwareId: 'h100-sxm', modelId: 'llama-3.1-8b', sequenceLength: 4096, outputLength: 128,
  batch: 1, prefixCachePercent: 0,
};
const openingNaive = config();
const openingPrefillSolution = config({ weightBits: 8, mathBits: 8 });
const openingDecodeSolution = config({ weightBits: 8 });
const openingFirstTarget = upperTarget(openingPrefillWorkload, openingNaive, openingPrefillSolution, 'firstTokenMs');
const openingNextTarget = upperTarget(openingDecodeWorkload, openingNaive, openingDecodeSolution, 'msPerToken');
const openingDecoyWorkload: Partial<SimulationSettings> = {
  ...openingPrefillWorkload, sequenceLength: 1024, outputLength: 16, batch: 4,
};
const openingDecoyInitial = config({ weightBits: 8, mathBits: 8 });
const openingDecoySolution = config({ weightBits: 16, mathBits: 16 });
const openingDecoyTarget = nice(metric(openingDecoyWorkload, openingDecoySolution, 'firstTokenMs') * 1.08);

const OPENING_ORDERS: GameOrder[] = [
  order({
    id: 'opening-pip', plantName: 'Pip', plantKind: 'sprout', orderName: 'The first bite', phase: 'first-token',
    request: `Read an 8K prompt and serve the first token within ${formatDuration(openingFirstTarget)}. Keep at least 8-bit weights.`,
    workload: openingPrefillWorkload, initial: openingNaive, solution: openingPrefillSolution,
    patienceMs: 48_000, arrivalMs: 7_000, lane: 1, hint: 'Long prompts spend most of their first pass doing matrix math. Fewer-bit math helps only when the weights support it.',
  }, [
    { metric: 'firstTokenMs', op: '<=', value: openingFirstTarget, label: 'First token', failure: 'The first bite arrived too late.', fix: 'Use 8-bit weights and 8-bit matrix math for this prompt-heavy order.' },
    { metric: 'weightQuality', op: '>=', value: 8, label: 'Quality floor', failure: 'Four-bit weights are below Pip’s quality floor.', fix: 'Keep the model at 8 bits or more.' },
  ]),
  order({
    id: 'opening-nibble', plantName: 'Nibble', plantKind: 'fern', orderName: 'Keep it streaming', phase: 'next-token',
    request: `Stream each next token within ${formatDuration(openingNextTarget)}. Keep at least 8-bit weights.`,
    workload: openingDecodeWorkload, initial: openingNaive, solution: openingDecodeSolution,
    patienceMs: 45_000, arrivalMs: 0, lane: 0, hint: 'One user’s next token mostly waits for the model weights to cross GPU memory. Lower-bit matrix math does not help this memory-bound step.',
  }, [
    { metric: 'msPerToken', op: '<=', value: openingNextTarget, label: 'Next-token pace', failure: 'Nibble is waiting on the model read.', fix: 'Move fewer weight bytes. Eight-bit weights are enough.' },
    { metric: 'weightQuality', op: '>=', value: 8, label: 'Quality floor', failure: 'Four-bit weights are below Nibble’s quality floor.', fix: 'Keep the model at 8 bits or more.' },
  ]),
  order({
    id: 'opening-bud', plantName: 'Bud', plantKind: 'cactus', orderName: 'Compliance bite', phase: 'first-token',
    request: `This short 1K compliance prompt requires 16-bit weights. Serve its first token within ${formatDuration(openingDecoyTarget)}.`,
    workload: openingDecoyWorkload, initial: openingDecoyInitial, solution: openingDecoySolution,
    patienceMs: 42_000, arrivalMs: 15_000, lane: 2, hint: 'The latency budget is generous. Read the quality floor before reusing the previous plant’s precision settings.',
  }, [
    { metric: 'firstTokenMs', op: '<=', value: openingDecoyTarget, label: 'First token', failure: 'The compliance prompt missed its generous latency target.', fix: 'The 16-bit configuration still fits this short prompt’s budget.' },
    { metric: 'weightQuality', op: '>=', value: 16, label: 'Quality floor', failure: 'Bud’s compliance job rejects reduced-precision weights.', fix: 'Return model weights to 16 bits.' },
  ]),
];

const rushWorkload: Partial<SimulationSettings> = {
  hardwareId: 'h100-sxm', modelId: 'llama-3.1-8b', sequenceLength: 2048, outputLength: 64,
  batch: 1, prefixCachePercent: 0,
};
const rushInitial = config({ weightBits: 16, mathBits: 16 });
const rushSolution = config({ weightBits: 8, mathBits: 16 });
const rushGroup = 3;
const rushLatency = nice(metric(rushWorkload, rushSolution, 'msPerToken', rushGroup) * 1.08);
const rushPremiumWorkload: Partial<SimulationSettings> = { ...rushWorkload, sequenceLength: 4096, outputLength: 96 };
const rushPremiumInitial = config({ weightBits: 8, mathBits: 16 });
const rushPremiumSolution = config({ weightBits: 16, mathBits: 16 });
const rushPremiumLatency = nice(metric(rushPremiumWorkload, rushPremiumSolution, 'msPerToken', rushGroup) * 1.08);

function rushOrder(
  id: string,
  name: string,
  kind: PlantKind,
  arrivalMs: number,
  lane: 0 | 1 | 2,
  premium = false,
): GameOrder {
  const workload = premium ? rushPremiumWorkload : rushWorkload;
  const initial = premium ? rushPremiumInitial : rushInitial;
  const solution = premium ? rushPremiumSolution : rushSolution;
  const latency = premium ? rushPremiumLatency : rushLatency;
  const family = premium ? 'audit-chat' : 'house-chat';
  return order({
    id, plantName: name, plantKind: kind, orderName: premium ? 'Audit chat' : 'House chat', phase: 'next-token',
    request: `Keep this ${premium ? '4K audit' : '2K house'} chat under ${formatDuration(latency)} per token.${premium ? ' Preserve 16-bit model quality.' : ''} Matching tickets may share one GPU pass.`,
    workload, initial, solution,
    patienceMs: premium ? 43_000 : 40_000, arrivalMs, lane, hint: premium
      ? 'This tray still benefits from batching, but its quality floor makes the familiar 8-bit move wrong.'
      : 'A tray serves three chats during one modeled GPU occupancy window instead of paying for three separate passes.',
    batchFamily: family, solutionGroupSize: rushGroup,
  }, [
    { metric: 'msPerToken', op: '<=', value: latency, label: 'Per-chat latency', failure: `${name} missed the per-token latency budget.`, fix: premium ? 'Keep the three-ticket batch; 16-bit weights satisfy the quality floor within this budget.' : 'Use 8-bit weights on the shared tray.' },
    { metric: 'weightQuality', op: '>=', value: premium ? 16 : 8, label: 'Quality floor', failure: `${name} rejects this model representation.`, fix: `Use at least ${premium ? 16 : 8}-bit weights.` },
  ]);
}

const RUSH_ORDERS = [
  rushOrder('rush-frond', 'Frond', 'fern', 0, 0),
  rushOrder('rush-prickle', 'Prickle', 'cactus', 2_500, 1),
  rushOrder('rush-petal', 'Petal', 'orchid', 5_000, 2),
  rushOrder('rush-vine', 'Vine', 'vine', 12_000, 1, true),
  rushOrder('rush-briar', 'Briar', 'cactus', 14_500, 2, true),
  rushOrder('rush-moss', 'Moss', 'fern', 17_000, 0, true),
];

const longInitial = config({ weightBits: 16, kvBits: 16 });
const longSolution = config({ weightBits: 16, kvBits: 8 });

function longOrder(
  id: string,
  name: string,
  kind: PlantKind,
  arrivalMs: number,
  lane: 0 | 1 | 2,
  users: number,
  context: number,
): GameOrder {
  const workload: Partial<SimulationSettings> = {
    hardwareId: 'h100-sxm', modelId: 'llama-3.1-8b', sequenceLength: context, outputLength: 64,
    batch: users, prefixCachePercent: 0,
  };
  const speedTarget = upperTarget(workload, longInitial, longSolution, 'msPerToken');
  return order({
    id, plantName: name, plantKind: kind, orderName: `${users} × ${Math.round(context / 1024)}K tables`, phase: 'next-token',
    request: `Keep ${users} ${Math.round(context / 1024)}K conversations in GPU memory and stream within ${formatDuration(speedTarget)} per token. Weights must stay at 16 bits.`,
    workload, initial: longInitial, solution: longSolution,
    patienceMs: 37_000, arrivalMs, lane, hint: 'The model must stay at 16 bits, so shrink the state that grows with users and context: KV.',
  }, [
    { metric: 'weightQuality', op: '>=', value: 16, label: 'Model quality', failure: `${name} requires 16-bit model weights.`, fix: 'Return model precision to 16 bits.' },
    { metric: 'fitsInGpuMemory', op: '==', value: true, label: 'Fits beside the GPU', failure: 'The model plus KV crossed the accelerator-memory wall.', fix: 'Store KV in 8 bits.', severe: true },
    { metric: 'msPerToken', op: '<=', value: speedTarget, label: 'Next-token pace', failure: 'The KV read is too large for the target.', fix: 'Halve the KV bytes with 8-bit KV.' },
  ]);
}

const exactWorkload: Partial<SimulationSettings> = {
  hardwareId: 'h100-sxm', modelId: 'llama-3.1-8b', sequenceLength: 8192, outputLength: 32,
  batch: 4, prefixCachePercent: 0,
};
const exactInitial = config({ weightBits: 16, kvBits: 8 });
const exactSolution = config({ weightBits: 16, kvBits: 16 });
const exactTarget = nice(metric(exactWorkload, exactSolution, 'msPerToken') * 1.1);

const LONG_ORDERS = [
  longOrder('long-monstera', 'Monstera', 'maw', 0, 1, 16, 32768),
  longOrder('long-spike', 'Spike', 'cactus', 16_000, 0, 8, 65536),
  order({
    id: 'long-lacy', plantName: 'Lacy', plantKind: 'fern', orderName: 'Exact cache', phase: 'next-token',
    request: `This four-user 8K evaluation requires 16-bit weights and 16-bit KV. Stream within ${formatDuration(exactTarget)} per token.`,
    workload: exactWorkload, initial: exactInitial, solution: exactSolution,
    patienceMs: 39_000, arrivalMs: 8_000, lane: 2, hint: 'This is the decoy: the cache easily fits. Precision is a requirement, so do not shrink KV just because the previous order needed it.',
  }, [
    { metric: 'weightQuality', op: '>=', value: 16, label: 'Model quality', failure: 'Lacy requires 16-bit model weights.', fix: 'Keep model weights at 16 bits.' },
    { metric: 'kvQuality', op: '>=', value: 16, label: 'Cache quality', failure: 'Lacy’s exact evaluation rejects reduced-precision KV.', fix: 'Return KV to 16 bits.' },
    { metric: 'msPerToken', op: '<=', value: exactTarget, label: 'Next-token pace', failure: 'The exact-cache job missed its latency budget.', fix: 'The small four-user workload meets this target at 16-bit KV.' },
  ]),
];

const regularInitial = config({ weightBits: 16, kvBits: 8, reusePromptPrefixes: false });
const regularSolution = config({ weightBits: 16, kvBits: 8, reusePromptPrefixes: true });
const privateInitial = config({ weightBits: 16, kvBits: 8, reusePromptPrefixes: true });
const privateSolution = config({ weightBits: 16, kvBits: 8, reusePromptPrefixes: false });
const privateWorkload: Partial<SimulationSettings> = {
  hardwareId: 'h100-sxm', modelId: 'llama-3.1-8b', sequenceLength: 4096, outputLength: 32,
  batch: 4, prefixCachePercent: 0,
};
const privateTarget = nice(metric(privateWorkload, privateSolution, 'firstTokenMs') * 1.08);

function regularOrder(
  id: string,
  name: string,
  kind: PlantKind,
  arrivalMs: number,
  lane: 0 | 1 | 2,
  context: number,
  prefixPercent: number,
): GameOrder {
  const workload: Partial<SimulationSettings> = {
    hardwareId: 'h100-sxm', modelId: 'llama-3.1-8b', sequenceLength: context, outputLength: 64,
    batch: 8, prefixCachePercent: prefixPercent,
  };
  const target = upperTarget(workload, regularInitial, regularSolution, 'firstTokenMs');
  return order({
    id, plantName: name, plantKind: kind, orderName: `${Math.round(prefixPercent)}% familiar`, phase: 'first-token',
    request: `${Math.round(prefixPercent)}% of this ${Math.round(context / 1024)}K prompt is the same House Manual. Return the first token within ${formatDuration(target)}.`,
    workload, initial: regularInitial, solution: regularSolution,
    patienceMs: 34_000, arrivalMs, lane, prefixName: 'House Manual', hint: 'Only the matching prefix is already on the shelf. The unique suffix still runs through the model.',
  }, [
    { metric: 'fitsInGpuMemory', op: '==', value: true, label: 'Fits beside the GPU', failure: 'The long conversations do not fit with 16-bit KV.', fix: 'Keep KV at 8 bits.', severe: true },
    { metric: 'firstTokenMs', op: '<=', value: target, label: 'First token', failure: 'The kitchen repeated prompt work it already had.', fix: 'Turn on shared-prefix reuse.' },
  ]);
}

const REGULAR_ORDERS = [
  regularOrder('regular-ivy', 'Ivy', 'vine', 0, 0, 16384, 50),
  order({
    id: 'regular-bloom', plantName: 'Bloom', plantKind: 'orchid', orderName: 'Private special', phase: 'first-token',
    request: `This 4K prompt is unique and confidential. Do not consult the shared-prefix cache; return its first token within ${formatDuration(privateTarget)}.`,
    workload: privateWorkload,
    initial: privateInitial, solution: privateSolution,
    patienceMs: 36_000, arrivalMs: 7_000, lane: 1, hint: 'Prefix reuse is conditional, not a universal speed switch. This request explicitly forbids consulting shared prompt state.',
  }, [
    { metric: 'prefixReuseEnabled', op: '==', value: false, label: 'Shared-prefix policy', failure: 'Bloom’s private prompt was sent through the shared-prefix path.', fix: 'Turn shared-prefix reuse off for this unique request.' },
    { metric: 'firstTokenMs', op: '<=', value: privateTarget, label: 'First token', failure: 'Bloom missed the first-token budget.', fix: 'The unique 4K prompt meets this budget without prefix reuse.' },
  ]),
  regularOrder('regular-chomp', 'Chomp', 'maw', 14_000, 2, 65536, 90),
];

const activeWorkload: Partial<SimulationSettings> = {
  hardwareId: 'h100-sxm', modelId: 'llama-3.1-8b', sequenceLength: 4096, outputLength: 128,
  batch: 64, prefixCachePercent: 0,
};
const activeInitial = config({ weightBits: 8, kvBits: 8, kvPlacement: 'object', idleKvPlacement: 'object' });
const activeSolution = config({ weightBits: 8, kvBits: 8, kvPlacement: 'hbm', idleKvPlacement: 'object' });
const activeTarget = upperTarget(activeWorkload, activeInitial, activeSolution, 'msPerToken');
const idleWorkload: Partial<SimulationSettings> = {
  hardwareId: 'h100-sxm', modelId: 'llama-3.1-8b', sequenceLength: 2048, outputLength: 64,
  batch: 1, prefixCachePercent: 0,
};
const idleInitial = config({ weightBits: 8, kvBits: 8, kvPlacement: 'hbm', idleKvPlacement: 'object' });
const idleSolution = config({ weightBits: 8, kvBits: 8, kvPlacement: 'hbm', idleKvPlacement: 'host' });
const peerWorkload: Partial<SimulationSettings> = { ...activeWorkload, outputLength: 1 };
const peerInitial = config({ weightBits: 8, kvBits: 8, kvPlacement: 'hbm', idleKvPlacement: 'host' });
const peerSolution = config({ weightBits: 8, kvBits: 8, kvPlacement: 'peer', idleKvPlacement: 'host' });
const peerTarget = nice(measureOrder({ workload: peerWorkload, phase: 'next-token', sourceKvPlacement: 'peer' }, peerSolution).metrics.readyNextTokenMs * 1.08);

const CLOSING_ORDERS: GameOrder[] = [
  order({
    id: 'closing-chomp', plantName: 'Chomp', plantKind: 'maw', orderName: 'Active dinner rush', phase: 'next-token',
    request: `Keep 64 active conversations under ${formatDuration(activeTarget)} per token. Their KV is needed every step.`,
    workload: activeWorkload, initial: activeInitial, solution: activeSolution,
    patienceMs: 31_000, arrivalMs: 0, lane: 1, hint: 'Active KV is an ingredient in every next-token step. Keep it beside the math.',
  }, [
    { metric: 'activeKvNear', op: '==', value: true, label: 'Active-state distance', failure: 'Active KV is waiting beyond the fast GPU fabric.', fix: 'Keep active KV in GPU memory or on a GPU peer.', severe: true },
    { metric: 'msPerToken', op: '<=', value: activeTarget, label: 'Next-token pace', failure: 'The active-state read missed the target.', fix: 'Move active KV closer to the GPU.' },
  ]),
  order({
    id: 'closing-dozer', plantName: 'Dozer', plantKind: 'fern', orderName: 'Save my table', phase: 'idle-return',
    request: 'This session is idle. Park its 2K context somewhere that can restore faster than rebuilding the prompt.',
    workload: idleWorkload, initial: idleInitial, solution: idleSolution,
    patienceMs: 30_000, arrivalMs: 7_000, lane: 0, hint: 'Idle state is not read every step. System memory is far away, but restoring from it still beats rerunning the prompt.',
  }, [
    { metric: 'restoreBeatsRecompute', op: '==', value: true, label: 'Restore versus rebuild', failure: 'Bringing this session back is slower than rebuilding its prompt.', fix: 'Park it in system memory instead of object storage.' },
  ]),
  order({
    id: 'closing-tangle', plantName: 'Tangle', plantKind: 'vine', orderName: 'One-token decision', phase: 'next-token',
    request: `These 64 live sessions already own their KV on a peer GPU. Return one yes-or-no routing token—including any state move—within ${formatDuration(peerTarget)}.`,
    workload: peerWorkload, initial: peerInitial, solution: peerSolution,
    sourceKvPlacement: 'peer', patienceMs: 32_000, arrivalMs: 13_000, lane: 2, hint: 'This response ends after one token. Local HBM would win a longer generation, but its one-time move cannot amortize here.',
  }, [
    { metric: 'readyNextTokenMs', op: '<=', value: peerTarget, label: 'One-token response', failure: 'Moving or reading Tangle’s live KV missed the one-token response target.', fix: 'For this one-token job, leave the live state on its owning peer and read across the GPU fabric.' },
  ]),
];

export const CAMPAIGN_SHIFTS: GameShift[] = [
  {
    id: 'opening', number: 1, title: 'Opening Shift', subtitle: 'Feed the machine',
    briefing: 'Two jobs look alike from the counter. A first token works through a prompt; each later token rereads the model. Watch which meter wins.',
    lesson: 'Prompt work is usually limited by math. One-user token generation is usually limited by reading the model. The same precision knob changes both, for different reasons.',
    controls: ['weightBits', 'mathBits'], batchTray: false, targetScore: 1_600, orders: OPENING_ORDERS,
  },
  {
    id: 'rush', number: 2, title: 'Lunch Rush', subtitle: 'Share the read',
    briefing: 'Matching plants can take a token step together. Build a compatible tray, configure its shared serving rig once, then feed the group.',
    lesson: 'Batching shares one model read across several users. Total throughput climbs because the accelerator sees more parallel work, not because the model became smaller.',
    controls: ['weightBits', 'mathBits'], batchTray: true, targetScore: 4_000, orders: RUSH_ORDERS,
  },
  {
    id: 'long-lunch', number: 3, title: 'The Long Lunch', subtitle: 'Memory fills up',
    briefing: 'Long conversations bring their history with them. The model must stay at 16 bits today; find another set of bytes to shrink.',
    lesson: 'KV grows with users and context. KV precision moves both the capacity wall and the number of bytes every token must read.',
    controls: ['weightBits', 'mathBits', 'kvBits'], batchTray: true, targetScore: 1_600, orders: LONG_ORDERS,
  },
  {
    id: 'regulars', number: 4, title: 'The Regulars', subtitle: "Don't repeat yourself",
    briefing: 'Some regulars share the House Manual; one private order must not touch it. Reuse only when the request actually has a reusable prefix.',
    lesson: 'Shared-prefix reuse removes prompt work that was already done. It does not make the retained KV free to store or read.',
    controls: ['weightBits', 'mathBits', 'kvBits', 'reusePromptPrefixes'], batchTray: true, targetScore: 1_600, orders: REGULAR_ORDERS,
  },
  {
    id: 'closing', number: 5, title: 'Closing Time', subtitle: 'Put it somewhere',
    briefing: 'Active sessions need their state every token. Idle sessions can wait farther away—if restoring them still beats rebuilding the prompt.',
    lesson: 'Placement depends on when state is needed. Active KV belongs on the fast GPU path. Idle KV can be parked where restore beats recompute.',
    controls: ['weightBits', 'mathBits', 'kvBits', 'reusePromptPrefixes', 'kvPlacement', 'idleKvPlacement'], batchTray: true, targetScore: 1_600, orders: CLOSING_ORDERS,
  },
];

export function campaignShift(index: number): GameShift {
  const shift = CAMPAIGN_SHIFTS[index];
  if (!shift) throw new Error(`Unknown campaign shift ${index + 1}.`);
  return shift;
}

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

/** A reproducible endless shift assembled from the campaign's proven orders. */
export function endlessShift(seed: number, round = 0): GameShift {
  const random = seeded(seed + round * 7919);
  const pool = CAMPAIGN_SHIFTS.flatMap((shift) => shift.orders);
  const count = Math.min(8 + round, 16);
  const patienceScale = Math.max(0.48, 0.82 - round * 0.035);
  const standalone = pool.filter((order) => !order.batchFamily);
  const familyNames = [...new Set(pool.flatMap((order) => order.batchFamily ? [order.batchFamily] : []))];
  const batchGroups = familyNames.map((family) => pool.filter((order) => order.batchFamily === family));
  const selected: Array<{ source: GameOrder; generatedFamily?: string }> = [];
  let generatedBatch = 0;

  while (selected.length < count) {
    const canFitBatch = selected.length + 3 <= count;
    const chooseBatch = canFitBatch && batchGroups.length > 0 && random() < 0.24;
    if (chooseBatch) {
      const group = batchGroups[Math.floor(random() * batchGroups.length)]!;
      const family = `endless-batch-${generatedBatch++}`;
      for (const source of group.slice(0, 3)) selected.push({ source, generatedFamily: family });
      continue;
    }
    selected.push({ source: standalone[Math.floor(random() * standalone.length)]! });
  }

  const arrivalGap = Math.max(1_900, 4_200 - round * 220);
  const orders = selected.map(({ source, generatedFamily }, index) => {
    return {
      ...source,
      id: `endless-${seed}-${round}-${index}`,
      plantName: `${source.plantName} ${index + 1}`,
      arrivalMs: index * arrivalGap,
      patienceMs: Math.round(source.patienceMs * patienceScale),
      lane: (index % 3) as 0 | 1 | 2,
      ...(generatedFamily ? { batchFamily: generatedFamily } : {}),
    };
  });
  return {
    id: `endless-${seed}-${round}`,
    number: round + 1,
    title: 'Endless Lunch Rush',
    subtitle: `Rush ${round + 1}`,
    briefing: 'Every lesson is live. Read the ticket, configure the order, and keep the counter moving.',
    lesson: 'The bottleneck moves because the workload moves. Read the requirement before reaching for a familiar optimization.',
    controls: ['weightBits', 'mathBits', 'kvBits', 'reusePromptPrefixes', 'kvPlacement', 'idleKvPlacement'],
    batchTray: true,
    targetScore: count * 500,
    orders,
  };
}
