import type { AlgorithmStep, HardwareProfile, ModelProfile, SimulationSettings } from '../types';
import { buildAlgorithmSteps } from './algorithm';
import { matrixPeakTflops } from './calculate';
import { newPromptTokens } from './prompt';

// One forward pass, grouped the way it maps onto the machine: two CPU hops
// around five GPU stages. Attention and MLP repeat once per layer; norms and
// residual adds are folded into them. Dense models only (the per-operation
// breakdown in algorithm.ts assumes a dense MLP).

export type StageId = 'tokenize' | 'embed' | 'attention' | 'mlp' | 'unembed' | 'sample' | 'detokenize';

export interface ForwardStage {
  id: StageId;
  runsOn: 'cpu' | 'gpu';
  /** Times this stage runs per forward pass (the layer count for attention and MLP). */
  repeats: number;
  /** Totals across all repeats, for every sequence in the batch. */
  flops: number;
  weightBytes: number;
  kvBytes: number;
  activationBytes: number;
  /** Bytes crossing PCIe between host and GPU (CPU stages only). */
  hostLinkBytes: number;
  /** Floors on this stage's time, from the same peaks and efficiencies as the whole-step model. */
  computeMs: number;
  memoryMs: number;
  limit: 'math' | 'memory' | 'host';
  /** The operations folded into this stage (empty for CPU stages and embed). */
  operations: AlgorithmStep[];
  inputShape: string;
  outputShape: string;
}

/** A stage's time floor: the slower of its math and its memory traffic. */
export function stageTimeMs(stage: ForwardStage): number {
  return Math.max(stage.computeMs, stage.memoryMs);
}

const TOKEN_ID_BYTES = 4;

function sum(steps: AlgorithmStep[], pick: (step: AlgorithmStep) => number): number {
  return steps.reduce((total, step) => total + pick(step), 0);
}

export function buildForwardPass(settings: SimulationSettings, model: ModelProfile, hardware: HardwareProfile): ForwardStage[] {
  if (model.moe) throw new Error('The forward-pass walk models dense models only.');
  // One pass means the whole prompt at once (no chunking), or one new token per sequence.
  settings = { ...settings, splitLongPrompts: false };
  const steps = buildAlgorithmSteps(settings, model);
  const byId = (id: string) => steps.find((step) => step.id === id)!;
  const layers = model.layers;
  // A first pass still runs the newest token, even on a full prefix hit.
  const tokensThisPass = settings.batch * (settings.phase === 'prefill' ? Math.max(1, newPromptTokens(settings)) : 1);
  const weightBytesPerParam = model.weightBits / 8;
  const activationBytesPerValue = model.kvBits / 8;
  const effectiveFlops = matrixPeakTflops(hardware, settings, model) * 1e12 * hardware.computeEfficiency;
  const effectiveBandwidth = hardware.hbmBandwidthTBs * 1e12 * hardware.memoryEfficiency;
  const hostBandwidth = hardware.hostLinkGBs * 1e9;

  function gpuStage(id: StageId, operations: AlgorithmStep[], repeats: number, inputShape: string, outputShape: string): ForwardStage {
    const flops = sum(operations, (step) => step.flops) * repeats;
    const weightBytes = sum(operations, (step) => step.parameterBytes) * repeats;
    const kvBytes = sum(operations, (step) => step.spillableKvBytes ?? 0) * repeats;
    const boundary = sum(operations, (step) => step.boundaryBytes) * repeats;
    const activationBytes = Math.max(0, boundary - kvBytes);
    const computeMs = flops / effectiveFlops * 1000;
    const memoryMs = (weightBytes + kvBytes + activationBytes) / effectiveBandwidth * 1000;
    return { id, runsOn: 'gpu', repeats, flops, weightBytes, kvBytes, activationBytes, hostLinkBytes: 0, computeMs, memoryMs, limit: computeMs >= memoryMs ? 'math' : 'memory', operations, inputShape, outputShape };
  }

  function cpuStage(id: StageId, hostLinkBytes: number, inputShape: string, outputShape: string): ForwardStage {
    return { id, runsOn: 'cpu', repeats: 1, flops: 0, weightBytes: 0, kvBytes: 0, activationBytes: 0, hostLinkBytes, computeMs: 0, memoryMs: hostLinkBytes / hostBandwidth * 1000, limit: 'host', operations: [], inputShape, outputShape };
  }

  const attentionOps = ['rms-attn', 'qkv', 'rope', 'kv-cache', 'qk', 'softmax', 'pv', 'o-proj'].map(byId);
  const mlpOps = ['rms-mlp', 'swiglu'].map(byId);
  const hidden = `[${settings.batch}, ${(tokensThisPass / settings.batch).toLocaleString()}, ${model.hiddenSize}]`;

  // Embedding: a gather that reads one table row per token, not the whole table.
  const embedBytes = tokensThisPass * model.hiddenSize * weightBytesPerParam + tokensThisPass * model.hiddenSize * activationBytesPerValue;
  const embed: ForwardStage = {
    id: 'embed', runsOn: 'gpu', repeats: 1, flops: 0,
    weightBytes: tokensThisPass * model.hiddenSize * weightBytesPerParam, kvBytes: 0,
    activationBytes: tokensThisPass * model.hiddenSize * activationBytesPerValue, hostLinkBytes: 0,
    computeMs: 0, memoryMs: embedBytes / effectiveBandwidth * 1000, limit: 'memory', operations: [],
    inputShape: `[${settings.batch}, ${(tokensThisPass / settings.batch).toLocaleString()}] token IDs`, outputShape: hidden,
  };

  return [
    cpuStage('tokenize', tokensThisPass * TOKEN_ID_BYTES, 'text', `[${settings.batch}, ${(tokensThisPass / settings.batch).toLocaleString()}] token IDs`),
    embed,
    gpuStage('attention', attentionOps, layers, hidden, hidden),
    gpuStage('mlp', mlpOps, layers, hidden, hidden),
    gpuStage('unembed', [byId('logits')], 1, `[${settings.batch}, 1, ${model.hiddenSize}]`, `[${settings.batch}, ${model.vocabSize.toLocaleString()}] logits`),
    gpuStage('sample', [byId('sample')], 1, `[${settings.batch}, ${model.vocabSize.toLocaleString()}] logits`, `[${settings.batch}] token IDs`),
    cpuStage('detokenize', settings.batch * TOKEN_ID_BYTES, `[${settings.batch}] token IDs`, 'text, streamed'),
  ];
}

/** The embedding table's size in memory (resident, even though each token reads one row). */
export function embeddingTableBytes(model: ModelProfile): number {
  return model.vocabSize * model.hiddenSize * (model.weightBits / 8);
}
