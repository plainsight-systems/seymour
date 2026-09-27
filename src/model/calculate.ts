import type { HardwareProfile, ModelProfile, SimulationResult, SimulationSettings } from '../types';
import { getMemoryTier } from '../data/memoryLadder';
import { activeParametersPerToken, expertsTouchedFraction, weightReadBytes } from './moe';
import type { KvPlacement } from '../types';

const GIGA = 1e9;
const TERA = 1e12;

export function calculateSimulation(
  settings: SimulationSettings,
  hardware: HardwareProfile,
  model: ModelProfile,
): SimulationResult {
  const batch = Math.max(1, Math.round(settings.batch));
  const sequence = Math.max(1, Math.round(settings.sequenceLength));
  const cachedTokens = settings.phase === 'prefill' && settings.reusePromptPrefixes
    ? Math.min(sequence, Math.round(sequence * settings.prefixCachePercent / 100))
    : 0;
  const queryTokens = settings.phase === 'prefill' ? sequence - cachedTokens : 1;
  const prefillChunkTokens = settings.phase === 'prefill' && settings.splitLongPrompts
    ? Math.max(1, Math.min(queryTokens || 1, Math.floor(settings.promptTokensPerStep / batch)))
    : Math.max(1, queryTokens || 1);
  const prefillChunks = settings.phase === 'prefill' && queryTokens > 0
    ? Math.ceil(queryTokens / prefillChunkTokens)
    : 0;
  const weightBytes = model.parametersB * GIGA * (model.weightBits / 8);
  const kvBytesPerToken = model.layers * 2 * model.kvHeads * model.headDim * (model.kvBits / 8);
  const kvFootprintBytes = kvBytesPerToken * sequence * batch;

  const denseFlopsPerToken = 2 * activeParametersPerToken(model);
  const attentionWidth = model.attentionHeads * model.headDim;
  const attentionFlops = 4 * model.layers * attentionWidth * sequence;
  // Tokens that share one pass over the weights: each chunk of prompt work, or
  // one generated token per sequence. MoE models read only the experts touched.
  const tokensPerWeightPass = settings.phase === 'prefill' ? batch * prefillChunkTokens : batch;
  const expertsTouched = expertsTouchedFraction(model, tokensPerWeightPass);
  const weightPassBytes = weightReadBytes(model, tokensPerWeightPass);
  const attentionScoreBytes = batch * model.attentionHeads * queryTokens * sequence * (model.kvBits / 8);
  // A separate QK -> softmax -> PV schedule writes scores, reads and writes
  // probabilities, then reads them again. A fused attention kernel keeps that
  // four-crossing intermediate on chip.
  const materializedAttentionBytes = settings.attentionKernel === 'separate'
    ? 4 * attentionScoreBytes * model.layers
    : 0;

  let flops: number;
  let bytes: number;
  let kvBytes: number;

  if (settings.phase === 'decode') {
    flops = batch * (denseFlopsPerToken + attentionFlops);
    kvBytes = kvFootprintBytes;
    bytes = weightPassBytes + kvBytes + batch * kvBytesPerToken + materializedAttentionBytes;
  } else {
    flops = batch * (denseFlopsPerToken * queryTokens + 4 * model.layers * attentionWidth * queryTokens * sequence);
    kvBytes = kvFootprintBytes;
    // A prefix hit leaves only the uncached suffix to process. That suffix still
    // attends over the complete cached-plus-new context.
    bytes = queryTokens === 0 ? 0 : weightPassBytes * prefillChunks + kvBytes + materializedAttentionBytes;
  }

  const effectiveCompute = hardware.fp16DenseTflops * TERA * hardware.computeEfficiency;
  const effectiveBandwidth = hardware.hbmBandwidthTBs * TERA * hardware.memoryEfficiency;
  const hbmCapacityBytes = hardware.hbmCapacityGB * GIGA * settings.servingMemoryFraction;
  const kvInHbm = settings.kvPlacement === 'hbm';
  const spilledWeightBytes = Math.max(0, weightBytes - hbmCapacityBytes);
  const hbmAfterWeights = Math.max(0, hbmCapacityBytes - weightBytes);
  const spilledKvBytes = kvInHbm ? Math.max(0, kvFootprintBytes - hbmAfterWeights) : 0;
  const weightSpillFraction = weightBytes > 0 ? spilledWeightBytes / weightBytes : 0;
  const kvSpillFraction = kvFootprintBytes > 0 ? spilledKvBytes / kvFootprintBytes : 0;
  const weightTrafficBytes = settings.phase === 'prefill' ? weightPassBytes * prefillChunks : weightPassBytes;
  const hostTrafficBytes = bytes === 0
    ? 0
    : weightTrafficBytes * weightSpillFraction + kvBytes * kvSpillFraction;
  const remoteKvTrafficBytes = settings.phase === 'decode' && !kvInHbm ? kvBytes : 0;
  const hbmTrafficBytes = Math.max(0, bytes - hostTrafficBytes - remoteKvTrafficBytes);
  const computeSeconds = flops / effectiveCompute;
  const hbmSeconds = hbmTrafficBytes / effectiveBandwidth;
  const hostSeconds = hostTrafficBytes / (hardware.hostLinkGBs * GIGA);
  const kvTier = getMemoryTier(hardware, settings.kvPlacement);
  const kvTierSeconds = settings.phase === 'decode' && remoteKvTrafficBytes > 0
    ? remoteKvTrafficBytes / kvTier.bandwidthBytesPerSecond! + (kvTier.firstByteLatencyMs ?? 0) / 1000
    : 0;
  const localMemorySeconds = hbmSeconds + hostSeconds;
  const memorySeconds = localMemorySeconds + kvTierSeconds;
  const totalSeconds = kvInHbm
    ? settings.overlap
      ? Math.max(computeSeconds, localMemorySeconds)
      : computeSeconds + localMemorySeconds
    : settings.overlap
      ? Math.max(computeSeconds, localMemorySeconds, kvTierSeconds)
      : computeSeconds + localMemorySeconds + kvTierSeconds;
  const bottleneck = !kvInHbm && kvTierSeconds >= Math.max(computeSeconds, localMemorySeconds)
    ? 'placement'
    : computeSeconds >= localMemorySeconds
      ? 'compute'
      : hostSeconds > hbmSeconds
        ? 'host'
        : 'memory';
  const tokenCount = settings.phase === 'decode' ? batch : batch * queryTokens;
  const modelFootprintBytes = weightBytes + kvFootprintBytes;
  const hbmResidentBytes = weightBytes + (kvInHbm ? kvFootprintBytes : 0);
  const flopsPerSequence = denseFlopsPerToken + attentionFlops;
  const kvTrafficPerSequence = kvBytesPerToken * (sequence + 1);
  const materializedAttentionPerSequence = materializedAttentionBytes / batch;
  // The decode limit at an infinitely large batch: weights are perfectly
  // amortized, but each sequence still streams its own KV history. This makes
  // it clear when batching cannot reach the hardware ridge at this context.
  const batchLimitArithmeticIntensity = settings.phase === 'decode'
    ? flopsPerSequence / (kvTrafficPerSequence + materializedAttentionPerSequence)
    : bytes > 0 ? flops / bytes : 0;

  return {
    flops,
    bytes,
    weightBytes,
    weightReadBytes: weightPassBytes,
    expertsTouchedFraction: expertsTouched,
    kvBytes,
    arithmeticIntensity: bytes > 0 ? flops / bytes : 0,
    ridgePoint: effectiveCompute / effectiveBandwidth,
    computeMs: computeSeconds * 1000,
    memoryMs: memorySeconds * 1000,
    totalMs: totalSeconds * 1000,
    bottleneck,
    utilization:
      bottleneck === 'compute'
        ? Math.min(1, computeSeconds / totalSeconds)
        : Math.min(1, computeSeconds / Math.max(memorySeconds, Number.EPSILON)),
    tokenRate: tokenCount / Math.max(totalSeconds, Number.EPSILON),
    kvBytesPerToken,
    kvFootprintBytes,
    modelFootprintBytes,
    hbmUsedFraction: hbmResidentBytes / hbmCapacityBytes,
    hbmTrafficBytes,
    attentionMaterializationBytes: materializedAttentionBytes,
    hostTrafficBytes,
    hostMs: hostSeconds * 1000,
    kvTierId: settings.kvPlacement,
    kvTierMs: kvInHbm && settings.phase === 'decode'
      ? kvBytes / effectiveBandwidth * 1000
      : kvTierSeconds * 1000,
    kvTierBandwidthNeeded: settings.phase === 'decode' && kvBytes > 0
      ? kvBytes / Math.max(
        settings.overlap
          ? Math.max(computeSeconds, bytes / effectiveBandwidth)
          : computeSeconds + bytes / effectiveBandwidth,
        Number.EPSILON,
      )
      : 0,
    spilledWeightBytes,
    spilledKvBytes,
    crossoverBatch: findCrossoverBatch(settings, hardware, model),
    batchLimitArithmeticIntensity,
    usableHbmCapacityBytes: hbmCapacityBytes,
    prefillChunks,
    prefillChunkTokens,
  };
}

export function restoreVsRecompute(
  settings: SimulationSettings,
  hardware: HardwareProfile,
  model: ModelProfile,
  tierId: KvPlacement,
): { restoreMs: number; recomputeMs: number; cheaper: 'restore' | 'recompute' } {
  const tier = getMemoryTier(hardware, tierId);
  const oneSequenceKvBytes = model.layers * 2 * model.kvHeads * model.headDim * (model.kvBits / 8) * settings.sequenceLength;
  const restoreMs = oneSequenceKvBytes / tier.bandwidthBytesPerSecond! * 1000 + (tier.firstByteLatencyMs ?? 0);
  const recompute = calculateSimulation(
    {
      ...settings,
      phase: 'prefill',
      batch: 1,
      prefixCachePercent: 0,
      reusePromptPrefixes: false,
      kvPlacement: 'hbm',
    },
    hardware,
    model,
  );
  const recomputeMs = recompute.totalMs;
  return { restoreMs, recomputeMs, cheaper: restoreMs <= recomputeMs ? 'restore' : 'recompute' };
}

function findCrossoverBatch(
  settings: SimulationSettings,
  hardware: HardwareProfile,
  model: ModelProfile,
): number | null {
  if (settings.phase !== 'decode') return 1;

  const ridge =
    (hardware.fp16DenseTflops * hardware.computeEfficiency) /
    (hardware.hbmBandwidthTBs * hardware.memoryEfficiency);
  const kvBytesPerToken = model.layers * 2 * model.kvHeads * model.headDim * (model.kvBits / 8);
  const flopsPerSequence =
    2 * activeParametersPerToken(model) + 4 * model.layers * model.attentionHeads * model.headDim * settings.sequenceLength;

  for (let batch = 1; batch <= 1024; batch *= 2) {
    const scoreBytes = settings.attentionKernel === 'separate'
      ? 4 * batch * model.attentionHeads * settings.sequenceLength * (model.kvBits / 8) * model.layers
      : 0;
    const bytes = weightReadBytes(model, batch) + batch * kvBytesPerToken * (settings.sequenceLength + 1) + scoreBytes;
    if ((flopsPerSequence * batch) / bytes >= ridge) return batch;
  }
  return null;
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = Math.max(0, bytes);
  let index = 0;
  while (value >= 1000 && index < units.length - 1) {
    value /= 1000;
    index += 1;
  }
  return `${formatNumber(value)} ${units[index]}`;
}

export function formatFlops(flops: number): string {
  const units = [
    { value: 1e15, label: 'PFLOP' },
    { value: 1e12, label: 'TFLOP' },
    { value: 1e9, label: 'GFLOP' },
    { value: 1e6, label: 'MFLOP' },
    { value: 1e3, label: 'KFLOP' },
  ];
  const unit = units.find((candidate) => flops >= candidate.value) ?? units[4]!;
  return `${formatNumber(flops / unit.value)} ${unit.label}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1) return `${formatNumber(ms * 1000)} µs`;
  if (ms < 1000) return `${formatNumber(ms)} ms`;
  return `${formatNumber(ms / 1000)} s`;
}

export function formatNumber(value: number): string {
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

export function decodeIterationCounts(outputLength: number): { firstToken: number; repeated: number; total: number } {
  const total = Math.max(1, Math.round(outputLength));
  return { firstToken: 1, repeated: total - 1, total };
}
