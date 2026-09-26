import type { HardwareProfile, ModelProfile, SimulationResult, SimulationSettings } from '../types';

const GIGA = 1e9;
const TERA = 1e12;

export function calculateSimulation(
  settings: SimulationSettings,
  hardware: HardwareProfile,
  model: ModelProfile,
): SimulationResult {
  const batch = Math.max(1, Math.round(settings.batch));
  const sequence = Math.max(1, Math.round(settings.sequenceLength));
  const weightBytes = model.parametersB * GIGA * (model.weightBits / 8);
  const kvBytesPerToken = model.layers * 2 * model.kvHeads * model.headDim * (model.kvBits / 8);
  const kvFootprintBytes = kvBytesPerToken * sequence * batch;

  const denseFlopsPerToken = 2 * model.parametersB * GIGA;
  const attentionFlops = 4 * model.layers * model.hiddenSize * sequence;
  const queryTokens = settings.phase === 'prefill' ? sequence : 1;
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
    bytes = weightBytes + kvBytes + batch * kvBytesPerToken + materializedAttentionBytes;
  } else {
    flops = batch * (denseFlopsPerToken * sequence + 4 * model.layers * model.hiddenSize * sequence ** 2);
    kvBytes = kvFootprintBytes;
    // The fused first-order model reads weights once and writes the completed KV cache.
    bytes = weightBytes + kvBytes + materializedAttentionBytes;
  }

  const effectiveCompute = hardware.fp16DenseTflops * TERA * hardware.computeEfficiency;
  const effectiveBandwidth = hardware.hbmBandwidthTBs * TERA * hardware.memoryEfficiency;
  const hbmCapacityBytes = hardware.hbmCapacityGB * GIGA;
  const spilledWeightBytes = Math.max(0, weightBytes - hbmCapacityBytes);
  const hbmAfterWeights = Math.max(0, hbmCapacityBytes - weightBytes);
  const spilledKvBytes = Math.max(0, kvFootprintBytes - hbmAfterWeights);
  const weightSpillFraction = weightBytes > 0 ? spilledWeightBytes / weightBytes : 0;
  const kvSpillFraction = kvFootprintBytes > 0 ? spilledKvBytes / kvFootprintBytes : 0;
  const hostTrafficBytes =
    weightBytes * weightSpillFraction + kvBytes * kvSpillFraction;
  const hbmTrafficBytes = Math.max(0, bytes - hostTrafficBytes);
  const computeSeconds = flops / effectiveCompute;
  const hbmSeconds = hbmTrafficBytes / effectiveBandwidth;
  const hostSeconds = hostTrafficBytes / (hardware.hostLinkGBs * GIGA);
  const memorySeconds = hbmSeconds + hostSeconds;
  const totalSeconds = settings.overlap
    ? Math.max(computeSeconds, memorySeconds)
    : computeSeconds + memorySeconds;
  const bottleneck = computeSeconds >= memorySeconds
    ? 'compute'
    : hostSeconds > hbmSeconds
      ? 'host'
      : 'memory';
  const tokenCount = settings.phase === 'decode' ? batch : batch * sequence;
  const modelFootprintBytes = weightBytes + kvFootprintBytes;
  const flopsPerSequence = denseFlopsPerToken + attentionFlops;
  const kvTrafficPerSequence = kvBytesPerToken * (sequence + 1);
  const materializedAttentionPerSequence = materializedAttentionBytes / batch;
  // The decode limit at an infinitely large batch: weights are perfectly
  // amortized, but each sequence still streams its own KV history. This makes
  // it clear when batching cannot reach the hardware ridge at this context.
  const batchLimitArithmeticIntensity = settings.phase === 'decode'
    ? flopsPerSequence / (kvTrafficPerSequence + materializedAttentionPerSequence)
    : flops / bytes;

  return {
    flops,
    bytes,
    weightBytes,
    kvBytes,
    arithmeticIntensity: flops / bytes,
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
    hbmUsedFraction: modelFootprintBytes / (hardware.hbmCapacityGB * GIGA),
    hbmTrafficBytes,
    attentionMaterializationBytes: materializedAttentionBytes,
    hostTrafficBytes,
    hostMs: hostSeconds * 1000,
    spilledWeightBytes,
    spilledKvBytes,
    crossoverBatch: findCrossoverBatch(settings, hardware, model),
    batchLimitArithmeticIntensity,
  };
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
  const weightBytes = model.parametersB * GIGA * (model.weightBits / 8);
  const kvBytesPerToken = model.layers * 2 * model.kvHeads * model.headDim * (model.kvBits / 8);
  const flopsPerSequence =
    2 * model.parametersB * GIGA + 4 * model.layers * model.hiddenSize * settings.sequenceLength;

  for (let batch = 1; batch <= 1024; batch *= 2) {
    const scoreBytes = settings.attentionKernel === 'separate'
      ? 4 * batch * model.attentionHeads * settings.sequenceLength * (model.kvBits / 8) * model.layers
      : 0;
    const bytes = weightBytes + batch * kvBytesPerToken * (settings.sequenceLength + 1) + scoreBytes;
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
