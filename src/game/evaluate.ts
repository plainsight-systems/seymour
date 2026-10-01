import { DEFAULT_SETTINGS, getHardware } from '../data/profiles';
import { getMemoryTier, tierBandwidth } from '../data/memoryLadder';
import { calculateSimulation, responseTiming, restoreVsRecompute } from '../model/calculate';
import { modelFor } from '../model/strategy';
import type { SimulationSettings } from '../types';
import type { GameConfiguration, GameOrder, OrderEvaluation, OrderMetric, OrderMetrics } from './types';

export const DEFAULT_GAME_CONFIGURATION: GameConfiguration = {
  weightBits: 16,
  mathBits: 16,
  kvBits: 16,
  reusePromptPrefixes: false,
  kvPlacement: 'hbm',
  idleKvPlacement: 'host',
};

export function settingsForOrder(order: Pick<GameOrder, 'workload'>, config: GameConfiguration, groupSize = 1): SimulationSettings {
  const baseBatch = order.workload.batch ?? 1;
  return {
    ...DEFAULT_SETTINGS,
    ...order.workload,
    ...config,
    mathBits: config.weightBits === 16 ? 16 : config.mathBits,
    batch: Math.max(1, baseBatch * groupSize),
  };
}

export function measureOrder(order: Pick<GameOrder, 'workload' | 'phase' | 'sourceKvPlacement'>, config: GameConfiguration, groupSize = 1): { settings: SimulationSettings; metrics: OrderMetrics } {
  const settings = settingsForOrder(order, config, groupSize);
  const hardware = getHardware(settings.hardwareId);
  const model = modelFor(settings);
  const prefill = calculateSimulation({ ...settings, phase: 'prefill' }, hardware, model);
  const decode = calculateSimulation({ ...settings, phase: 'decode' }, hardware, model);
  const timing = responseTiming(settings, hardware, model);
  const restore = restoreVsRecompute(settings, hardware, model, settings.idleKvPlacement);
  const sourceTier = order.sourceKvPlacement ? getMemoryTier(hardware, order.sourceKvPlacement) : null;
  const destinationTier = order.sourceKvPlacement ? getMemoryTier(hardware, settings.kvPlacement) : null;
  const migrationMs = sourceTier && destinationTier && sourceTier.id !== destinationTier.id
    ? decode.kvFootprintBytes / Math.min(tierBandwidth(sourceTier), tierBandwidth(destinationTier)) * 1_000
      + (sourceTier.firstByteLatencyMs ?? 0)
      + (destinationTier.firstByteLatencyMs ?? 0)
    : 0;
  return {
    settings,
    metrics: {
      firstTokenMs: timing.firstTokenMs,
      msPerToken: timing.msPerToken,
      migrationMs,
      readyNextTokenMs: migrationMs + timing.msPerToken,
      restoreMs: restore.restoreMs,
      recomputeMs: restore.recomputeMs,
      totalTokensPerSec: decode.tokenRate,
      fitsInGpuMemory: settings.kvPlacement === 'hbm' && decode.hbmUsedFraction <= 1 && decode.hostTrafficBytes === 0,
      activeKvNear: ['hbm', 'peer', 'peers'].includes(settings.kvPlacement),
      restoreBeatsRecompute: restore.cheaper === 'restore',
      prefixReuseEnabled: settings.reusePromptPrefixes,
      weightQuality: settings.weightBits,
      kvQuality: settings.kvBits,
      groupSize,
      bottleneck: order.phase === 'first-token' ? prefill.bottleneck : order.phase === 'idle-return' || migrationMs > 0 ? 'placement' : decode.bottleneck,
      hbmUsedFraction: decode.hbmUsedFraction,
      spilledBytes: decode.spilledKvBytes + decode.spilledWeightBytes,
    },
  };
}

function metricValue(metrics: OrderMetrics, metric: OrderMetric): number | boolean {
  return metrics[metric];
}

export function evaluateOrder(order: GameOrder, config: GameConfiguration, groupSize = 1): OrderEvaluation {
  const measured = measureOrder(order, config, groupSize);
  const checks = order.constraints.map((constraint) => {
    const actual = metricValue(measured.metrics, constraint.metric);
    const met = constraint.op === '=='
      ? actual === constraint.value
      : constraint.op === '<='
        ? Number(actual) <= Number(constraint.value)
        : Number(actual) >= Number(constraint.value);
    return { constraint, actual, met };
  });
  return { ...measured, checks, passed: checks.every((check) => check.met) };
}

export function configurationsEqual(a: GameConfiguration, b: GameConfiguration): boolean {
  return a.weightBits === b.weightBits
    && a.mathBits === b.mathBits
    && a.kvBits === b.kvBits
    && a.reusePromptPrefixes === b.reusePromptPrefixes
    && a.kvPlacement === b.kvPlacement
    && a.idleKvPlacement === b.idleKvPlacement;
}
