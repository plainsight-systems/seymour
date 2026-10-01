import { formatDuration, formatNumber } from '../model/calculate';
import type { SimulationSettings } from '../types';
import { DEFAULT_GAME_CONFIGURATION, measureOrder } from './evaluate';
import type { GameConfiguration, GameOrder, GameShift, OrderConstraint, OrderMetric, PlantKind } from './types';

function config(overrides: Partial<GameConfiguration> = {}): GameConfiguration {
  return { ...DEFAULT_GAME_CONFIGURATION, ...overrides };
}

function nice(value: number): number {
  return Number(value.toPrecision(3));
}

function metric(workload: Partial<SimulationSettings>, choice: GameConfiguration, name: OrderMetric, groupSize = 1): number {
  return Number(measureOrder({ workload }, choice, groupSize).metrics[name]);
}

function upperTarget(workload: Partial<SimulationSettings>, naive: GameConfiguration, solution: GameConfiguration, name: 'firstTokenMs' | 'msPerToken', groupSize = 1): number {
  const slow = metric(workload, naive, name);
  const fast = metric(workload, solution, name, groupSize);
  if (fast >= slow) throw new Error(`${name} solution does not improve the order.`);
  return nice(fast + (slow - fast) * 0.35);
}

function lowerTarget(workload: Partial<SimulationSettings>, naive: GameConfiguration, solution: GameConfiguration, name: 'totalTokensPerSec', groupSize: number): number {
  const low = metric(workload, naive, name);
  const high = metric(workload, solution, name, groupSize);
  if (high <= low) throw new Error(`${name} solution does not improve the order.`);
  return nice(low + (high - low) * 0.72);
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

const OPENING_ORDERS: GameOrder[] = [
  order({
    id: 'opening-pip', plantName: 'Pip', plantKind: 'sprout', orderName: 'The first bite', phase: 'first-token',
    request: `Read an 8K prompt and serve the first token within ${formatDuration(openingFirstTarget)}. Keep at least 8-bit weights.`,
    workload: openingPrefillWorkload, initial: openingNaive, solution: openingPrefillSolution,
    patienceMs: 48_000, arrivalMs: 0, lane: 1, hint: 'Long prompts spend most of their first pass doing matrix math. Fewer-bit math helps only when the weights support it.',
  }, [
    { metric: 'firstTokenMs', op: '<=', value: openingFirstTarget, label: 'First token', failure: 'The first bite arrived too late.', fix: 'Use 8-bit weights and 8-bit matrix math for this prompt-heavy order.' },
    { metric: 'weightQuality', op: '>=', value: 8, label: 'Quality floor', failure: 'Four-bit weights are below Pip’s quality floor.', fix: 'Keep the model at 8 bits or more.' },
  ]),
  order({
    id: 'opening-nibble', plantName: 'Nibble', plantKind: 'fern', orderName: 'Keep it streaming', phase: 'next-token',
    request: `Stream each next token within ${formatDuration(openingNextTarget)}. Keep at least 8-bit weights.`,
    workload: openingDecodeWorkload, initial: openingNaive, solution: openingDecodeSolution,
    patienceMs: 45_000, arrivalMs: 7_000, lane: 0, hint: 'One user’s next token mostly waits for the model weights to cross GPU memory.',
  }, [
    { metric: 'msPerToken', op: '<=', value: openingNextTarget, label: 'Next-token pace', failure: 'Nibble is waiting on the model read.', fix: 'Move fewer weight bytes. Eight-bit weights are enough.' },
    { metric: 'weightQuality', op: '>=', value: 8, label: 'Quality floor', failure: 'Four-bit weights are below Nibble’s quality floor.', fix: 'Keep the model at 8 bits or more.' },
  ]),
  order({
    id: 'opening-bud', plantName: 'Bud', plantKind: 'cactus', orderName: 'One more first bite', phase: 'first-token',
    request: `Process the same 8K prompt within ${formatDuration(openingFirstTarget)}. No shortcuts below 8-bit weights.`,
    workload: openingPrefillWorkload, initial: openingNaive, solution: openingPrefillSolution,
    patienceMs: 42_000, arrivalMs: 15_000, lane: 2, hint: 'This is prompt work again: pair the smaller stored weights with the matching math precision.',
  }, [
    { metric: 'firstTokenMs', op: '<=', value: openingFirstTarget, label: 'First token', failure: 'The prompt pass missed Bud’s target.', fix: 'Use 8-bit weights and 8-bit math.' },
    { metric: 'weightQuality', op: '>=', value: 8, label: 'Quality floor', failure: 'Bud refuses four-bit weights.', fix: 'Use 8-bit weights.' },
  ]),
];

const rushWorkload: Partial<SimulationSettings> = {
  hardwareId: 'h100-sxm', modelId: 'llama-3.1-8b', sequenceLength: 2048, outputLength: 64,
  batch: 1, prefixCachePercent: 0,
};
const rushInitial = config({ weightBits: 16, mathBits: 16 });
const rushSolution = config({ weightBits: 8, mathBits: 16 });
const rushGroup = 3;
const rushRate = lowerTarget(rushWorkload, rushInitial, rushSolution, 'totalTokensPerSec', rushGroup);

function rushOrder(id: string, name: string, kind: PlantKind, arrivalMs: number, lane: 0 | 1 | 2): GameOrder {
  return order({
    id, plantName: name, plantKind: kind, orderName: 'House chat', phase: 'next-token',
    request: `Join three matching house-chat orders and deliver at least ${formatNumber(rushRate)} total tokens each second.`,
    workload: rushWorkload, initial: rushInitial, solution: rushSolution,
    patienceMs: 40_000, arrivalMs, lane, hint: 'Put three matching tickets on the batch tray. They can share one model read.',
    batchFamily: 'house-chat', solutionGroupSize: rushGroup,
  }, [
    { metric: 'groupSize', op: '>=', value: rushGroup, label: 'Batch tray', failure: 'One order cannot expose enough parallel work.', fix: 'Put three House chat tickets on the batch tray.' },
    { metric: 'totalTokensPerSec', op: '>=', value: rushRate, label: 'Total throughput', failure: 'The tray is full, but the shared model read is still too heavy.', fix: 'Use 8-bit weights before feeding the batch.' },
    { metric: 'weightQuality', op: '>=', value: 8, label: 'Quality floor', failure: `${name} refuses four-bit weights.`, fix: 'Keep the model at 8 bits or more.' },
  ]);
}

const RUSH_ORDERS = [
  rushOrder('rush-frond', 'Frond', 'fern', 0, 0),
  rushOrder('rush-prickle', 'Prickle', 'cactus', 2_500, 1),
  rushOrder('rush-petal', 'Petal', 'orchid', 5_000, 2),
  rushOrder('rush-vine', 'Vine', 'vine', 12_000, 1),
  rushOrder('rush-briar', 'Briar', 'cactus', 14_500, 2),
  rushOrder('rush-moss', 'Moss', 'fern', 17_000, 0),
];

const longWorkload: Partial<SimulationSettings> = {
  hardwareId: 'h100-sxm', modelId: 'llama-3.1-8b', sequenceLength: 32768, outputLength: 64,
  batch: 16, prefixCachePercent: 0,
};
const longInitial = config({ weightBits: 16, kvBits: 16 });
const longSolution = config({ weightBits: 16, kvBits: 8 });
const longSpeedTarget = upperTarget(longWorkload, longInitial, longSolution, 'msPerToken');

function longOrder(id: string, name: string, kind: PlantKind, arrivalMs: number, lane: 0 | 1 | 2): GameOrder {
  return order({
    id, plantName: name, plantKind: kind, orderName: 'Sixteen long tables', phase: 'next-token',
    request: `Keep sixteen 32K conversations in GPU memory and stream within ${formatDuration(longSpeedTarget)} per token. Weights must stay at 16 bits.`,
    workload: longWorkload, initial: longInitial, solution: longSolution,
    patienceMs: 37_000, arrivalMs, lane, hint: 'The model must stay at 16 bits, so shrink the state that grows with users and context: KV.',
  }, [
    { metric: 'weightQuality', op: '>=', value: 16, label: 'Model quality', failure: `${name} requires 16-bit model weights.`, fix: 'Return model precision to 16 bits.' },
    { metric: 'fitsInGpuMemory', op: '==', value: true, label: 'Fits beside the GPU', failure: 'The model plus KV crossed the accelerator-memory wall.', fix: 'Store KV in 8 bits.', severe: true },
    { metric: 'msPerToken', op: '<=', value: longSpeedTarget, label: 'Next-token pace', failure: 'The KV read is too large for the target.', fix: 'Halve the KV bytes with 8-bit KV.' },
  ]);
}

const LONG_ORDERS = [
  longOrder('long-monstera', 'Monstera', 'maw', 0, 1),
  longOrder('long-spike', 'Spike', 'cactus', 8_000, 0),
  longOrder('long-lacy', 'Lacy', 'fern', 16_000, 2),
];

const regularWorkload: Partial<SimulationSettings> = {
  hardwareId: 'h100-sxm', modelId: 'llama-3.1-8b', sequenceLength: 32768, outputLength: 64,
  batch: 8, prefixCachePercent: 75,
};
const regularInitial = config({ weightBits: 16, kvBits: 8, reusePromptPrefixes: false });
const regularSolution = config({ weightBits: 16, kvBits: 8, reusePromptPrefixes: true });
const regularTarget = upperTarget(regularWorkload, regularInitial, regularSolution, 'firstTokenMs');

function regularOrder(id: string, name: string, kind: PlantKind, arrivalMs: number, lane: 0 | 1 | 2): GameOrder {
  return order({
    id, plantName: name, plantKind: kind, orderName: 'The house manual', phase: 'first-token',
    request: `Three quarters of this 32K prompt is the same House Manual. Return the first token within ${formatDuration(regularTarget)}.`,
    workload: regularWorkload, initial: regularInitial, solution: regularSolution,
    patienceMs: 34_000, arrivalMs, lane, prefixName: 'House Manual', hint: 'The prompt is already on the shelf. Reuse it; KV still has to fit and be read.',
  }, [
    { metric: 'fitsInGpuMemory', op: '==', value: true, label: 'Fits beside the GPU', failure: 'The long conversations do not fit with 16-bit KV.', fix: 'Keep KV at 8 bits.', severe: true },
    { metric: 'firstTokenMs', op: '<=', value: regularTarget, label: 'First token', failure: 'The kitchen repeated prompt work it already had.', fix: 'Turn on shared-prefix reuse.' },
  ]);
}

const REGULAR_ORDERS = [
  regularOrder('regular-ivy', 'Ivy', 'vine', 0, 0),
  regularOrder('regular-bloom', 'Bloom', 'orchid', 7_000, 1),
  regularOrder('regular-chomp', 'Chomp', 'maw', 14_000, 2),
];

const activeWorkload: Partial<SimulationSettings> = {
  hardwareId: 'h100-sxm', modelId: 'llama-3.1-8b', sequenceLength: 4096, outputLength: 128,
  batch: 64, prefixCachePercent: 0,
};
const activeInitial = config({ weightBits: 8, kvBits: 8, kvPlacement: 'object' });
const activeSolution = config({ weightBits: 8, kvBits: 8, kvPlacement: 'hbm' });
const activeTarget = upperTarget(activeWorkload, activeInitial, activeSolution, 'msPerToken');
const idleWorkload: Partial<SimulationSettings> = {
  hardwareId: 'h100-sxm', modelId: 'llama-3.1-8b', sequenceLength: 2048, outputLength: 64,
  batch: 1, prefixCachePercent: 0,
};
const idleInitial = config({ weightBits: 8, kvBits: 8, kvPlacement: 'hbm', idleKvPlacement: 'object' });
const idleSolution = config({ weightBits: 8, kvBits: 8, kvPlacement: 'hbm', idleKvPlacement: 'host' });

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
    id: 'closing-tangle', plantName: 'Tangle', plantKind: 'vine', orderName: 'Active, not archived', phase: 'next-token',
    request: `Another 64 active conversations need tokens within ${formatDuration(activeTarget)}.`,
    workload: activeWorkload, initial: activeInitial, solution: activeSolution,
    patienceMs: 28_000, arrivalMs: 13_000, lane: 2, hint: 'This is live service, not archival. Network storage is not a token-by-token memory tier.',
  }, [
    { metric: 'activeKvNear', op: '==', value: true, label: 'Active-state distance', failure: 'Tangle’s active KV is too far from the math.', fix: 'Move active KV onto this GPU or a GPU peer.', severe: true },
    { metric: 'msPerToken', op: '<=', value: activeTarget, label: 'Next-token pace', failure: 'The active-state read missed the target.', fix: 'Move active KV closer.' },
  ]),
];

export const CAMPAIGN_SHIFTS: GameShift[] = [
  {
    id: 'opening', number: 1, title: 'Opening Shift', subtitle: 'Feed the machine',
    briefing: 'Two jobs look alike from the counter. A first token works through a prompt; each later token rereads the model. Watch which meter wins.',
    lesson: 'Prompt work is usually limited by math. One-user token generation is usually limited by reading the model. The same precision knob changes both, for different reasons.',
    controls: ['weightBits', 'mathBits'], batchTray: false, targetScore: 2_000, orders: OPENING_ORDERS,
  },
  {
    id: 'rush', number: 2, title: 'Lunch Rush', subtitle: 'Share the read',
    briefing: 'Matching plants can take a token step together. Configure each ticket, put compatible orders on the tray, then feed the group.',
    lesson: 'Batching shares one model read across several users. Total throughput climbs because the accelerator sees more parallel work, not because the model became smaller.',
    controls: ['weightBits', 'mathBits'], batchTray: true, targetScore: 3_000, orders: RUSH_ORDERS,
  },
  {
    id: 'long-lunch', number: 3, title: 'The Long Lunch', subtitle: 'Memory fills up',
    briefing: 'Long conversations bring their history with them. The model must stay at 16 bits today; find another set of bytes to shrink.',
    lesson: 'KV grows with users and context. KV precision moves both the capacity wall and the number of bytes every token must read.',
    controls: ['weightBits', 'mathBits', 'kvBits'], batchTray: true, targetScore: 2_500, orders: LONG_ORDERS,
  },
  {
    id: 'regulars', number: 4, title: 'The Regulars', subtitle: "Don't repeat yourself",
    briefing: 'The regulars all bring the same House Manual. It is already on the shelf; the unique suffix still needs work.',
    lesson: 'Shared-prefix reuse removes prompt work that was already done. It does not make the retained KV free to store or read.',
    controls: ['weightBits', 'mathBits', 'kvBits', 'reusePromptPrefixes'], batchTray: true, targetScore: 2_500, orders: REGULAR_ORDERS,
  },
  {
    id: 'closing', number: 5, title: 'Closing Time', subtitle: 'Put it somewhere',
    briefing: 'Active sessions need their state every token. Idle sessions can wait farther away—if restoring them still beats rebuilding the prompt.',
    lesson: 'Placement depends on when state is needed. Active KV belongs on the fast GPU path. Idle KV can be parked where restore beats recompute.',
    controls: ['weightBits', 'mathBits', 'kvBits', 'reusePromptPrefixes', 'kvPlacement', 'idleKvPlacement'], batchTray: true, targetScore: 2_500, orders: CLOSING_ORDERS,
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
  const orders = Array.from({ length: count }, (_, index) => {
    const source = pool[Math.floor(random() * pool.length)]!;
    return {
      ...source,
      id: `endless-${seed}-${round}-${index}`,
      plantName: `${source.plantName} ${index + 1}`,
      arrivalMs: index * Math.max(1_900, 4_200 - round * 220),
      patienceMs: Math.round(source.patienceMs * patienceScale),
      lane: (index % 3) as 0 | 1 | 2,
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
    targetScore: count * 750,
    orders,
  };
}
