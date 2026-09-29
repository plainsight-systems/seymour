import { buildMemoryLadder, type MemoryTier } from '../../data/memoryLadder';
import { calculateSimulation, formatBytes, formatDuration, formatNumber, restoreVsRecompute } from '../../model/calculate';
import type { HardwareProfile, ModelProfile, SimulationResult, SimulationSettings } from '../../types';

export type PictureLayer = 'stepCost' | 'modelBlock' | 'throughput' | 'kvBlock' | 'distanceLadder';

export interface StepCostPicture {
  id: 'prefill' | 'decode';
  label: string;
  readMs: number;
  mathMs: number;
  totalMs: number;
  limit: string;
  unit: string;
}

export interface PictureModel {
  hardwareName: string;
  capacityBytes: number;
  modelBytes: number;
  kvBytes: number;
  freeBytes: number;
  overflowBytes: number;
  modelFraction: number;
  kvFraction: number;
  steps: StepCostPicture[];
  perUserTokensPerSecond: number;
  totalTokensPerSecond: number;
  concurrentUsers: number;
  placement: SimulationSettings['kvPlacement'];
  ladder: MemoryTier[];
  bandwidthNeeded: number;
  restoreMs: number;
  recomputeMs: number;
  bottleneckTag: 'Work' | 'Traffic' | 'Placement' | 'Execution';
  bottleneckSentence: string;
  modelLabel: string;
  kvLabel: string;
}

export function buildPictureModel(
  result: SimulationResult,
  settings: SimulationSettings,
  hardware: HardwareProfile,
  model: ModelProfile,
): PictureModel {
  const decode = settings.phase === 'decode'
    ? result
    : calculateSimulation({ ...settings, phase: 'decode' }, hardware, model);
  const prefill = settings.phase === 'prefill'
    ? result
    : calculateSimulation({ ...settings, phase: 'prefill' }, hardware, model);
  const capacityBytes = decode.usableHbmCapacityBytes;
  const kvBytesInHbm = settings.kvPlacement === 'hbm' ? decode.kvFootprintBytes : 0;
  const residentBytes = decode.weightBytes + kvBytesInHbm;
  const overflowBytes = Math.max(0, residentBytes - capacityBytes);
  const restore = restoreVsRecompute(settings, hardware, model, settings.kvPlacement);
  const bottleneckTag = decode.bottleneck === 'placement'
    ? 'Placement'
    : decode.bottleneck === 'compute'
      ? 'Execution'
      : 'Traffic';
  const bottleneckSentence = decode.bottleneck === 'placement'
    ? `${settings.kvPlacement === 'object' ? 'Network storage' : 'The selected KV tier'} cannot feed each per-token pass fast enough; move active state closer.`
    : decode.bottleneck === 'compute'
      ? 'The batch exposes enough reuse that arithmetic is now the longest stage.'
      : decode.bottleneck === 'host'
        ? 'The working set crosses the host link; reduce bytes or admit less state at once.'
        : 'Reading weights and KV takes longer than doing the math; reduce or share those bytes.';

  return {
    hardwareName: hardware.name,
    capacityBytes,
    modelBytes: decode.weightBytes,
    kvBytes: decode.kvFootprintBytes,
    freeBytes: Math.max(0, capacityBytes - residentBytes),
    overflowBytes,
    modelFraction: Math.min(1, decode.weightBytes / capacityBytes),
    kvFraction: Math.min(1, kvBytesInHbm / capacityBytes),
    steps: [
      {
        id: 'prefill', label: 'First pass: the whole prompt', readMs: prefill.memoryMs, mathMs: prefill.computeMs,
        totalMs: prefill.totalMs, limit: prefill.bottleneck === 'compute' ? 'math' : 'reading', unit: `${settings.sequenceLength.toLocaleString()} prompt tokens`,
      },
      {
        id: 'decode', label: 'Each later pass: one new token', readMs: decode.memoryMs, mathMs: decode.computeMs,
        totalMs: decode.totalMs, limit: decode.bottleneck === 'compute' ? 'math' : decode.bottleneck === 'placement' ? 'distance' : 'reading', unit: 'one generated token per user',
      },
    ],
    perUserTokensPerSecond: 1000 / Math.max(decode.msPerToken, Number.EPSILON),
    totalTokensPerSecond: decode.tokenRate,
    concurrentUsers: settings.batch,
    placement: settings.kvPlacement,
    ladder: buildMemoryLadder(hardware),
    bandwidthNeeded: decode.kvTierBandwidthNeeded,
    restoreMs: restore.restoreMs,
    recomputeMs: restore.recomputeMs,
    bottleneckTag,
    bottleneckSentence,
    modelLabel: `${formatBytes(decode.weightBytes)} model`,
    kvLabel: `${formatBytes(decode.kvFootprintBytes)} KV`,
  };
}

export function pictureSummary(picture: PictureModel): string {
  const decode = picture.steps.find((step) => step.id === 'decode')!;
  return `${picture.concurrentUsers} users · ${formatDuration(decode.totalMs)} per token · ${formatNumber(picture.totalTokensPerSecond)} total tokens/s`;
}
