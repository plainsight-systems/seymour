import { buildMemoryLadder, type MemoryTier } from '../../data/memoryLadder';
import { getTopology } from '../../data/topology';
import { calculateSimulation } from '../../model/calculate';
import type { HardwareProfile, KvPlacement, ModelProfile, SimulationResult, SimulationSettings } from '../../types';

const GIGA = 1e9;

export interface JobActivity {
  computeMs: number;
  memoryMs: number;
  totalMs: number;
  /** Share of the step spent doing math (0–1). */
  mathShare: number;
  /** Enabled units shaded as "doing math": a share of time, not specific units. */
  busyUnits: number;
  /** The same share applied to one compute cluster (one GPC or one XCD). */
  busyUnitsPerCluster: number;
}

export interface MemoryFill {
  physicalBytes: number;
  usableBytes: number;
  weightBytes: number;
  kvBytes: number;
  kvBytesInGpuMemory: number;
  overflowBytes: number;
  /** Fractions of physical capacity. They sum to 1. */
  weightsFraction: number;
  kvFraction: number;
  freeFraction: number;
  reserveFraction: number;
}

export interface CutawayInputs {
  hardwareId: string;
  hardwareName: string;
  hbmPeakBytesPerSecond: number;
  users: number;
  contextTokens: number;
  memory: MemoryFill;
  prefill: JobActivity;
  decode: JobActivity;
  placement: KvPlacement;
  tiers: Record<KvPlacement, MemoryTier>;
}

function activity(result: SimulationResult, enabledUnits: number, enabledPerCluster: number): JobActivity {
  const mathShare = Math.min(1, result.computeMs / Math.max(result.totalMs, Number.EPSILON));
  const shade = (units: number) => (mathShare > 0 ? Math.max(1, Math.round(units * mathShare)) : 0);
  return {
    computeMs: result.computeMs,
    memoryMs: result.memoryMs,
    totalMs: result.totalMs,
    mathShare,
    busyUnits: shade(enabledUnits),
    busyUnitsPerCluster: shade(enabledPerCluster),
  };
}

/** Everything a plate needs, derived from the analytical model. No DOM. */
export function buildCutawayInputs(settings: SimulationSettings, hardware: HardwareProfile, model: ModelProfile): CutawayInputs {
  const topology = getTopology(hardware.id);
  const decode = calculateSimulation({ ...settings, phase: 'decode' }, hardware, model);
  const prefill = calculateSimulation({ ...settings, phase: 'prefill' }, hardware, model);
  const physicalBytes = hardware.hbmCapacityGB * GIGA;
  const usableBytes = decode.usableHbmCapacityBytes;
  const kvInGpu = settings.kvPlacement === 'hbm' ? decode.kvFootprintBytes : 0;
  const weightsResident = Math.min(decode.weightBytes, usableBytes);
  const kvResident = Math.min(kvInGpu, Math.max(0, usableBytes - weightsResident));
  const reserveFraction = (physicalBytes - usableBytes) / physicalBytes;
  const weightsFraction = weightsResident / physicalBytes;
  const kvFraction = kvResident / physicalBytes;
  const enabledPerCluster = Math.round(topology.enabledUnits / (topology.physicalUnits / topology.unitsPerCluster));
  const ladder = buildMemoryLadder(hardware);
  const tier = (id: KvPlacement) => ladder.find((candidate) => candidate.id === id)!;

  return {
    hardwareId: hardware.id,
    hardwareName: hardware.name,
    hbmPeakBytesPerSecond: hardware.hbmBandwidthTBs * 1e12,
    users: settings.batch,
    contextTokens: settings.sequenceLength,
    memory: {
      physicalBytes,
      usableBytes,
      weightBytes: decode.weightBytes,
      kvBytes: decode.kvFootprintBytes,
      kvBytesInGpuMemory: kvInGpu,
      overflowBytes: decode.spilledWeightBytes + decode.spilledKvBytes,
      weightsFraction,
      kvFraction,
      freeFraction: Math.max(0, 1 - reserveFraction - weightsFraction - kvFraction),
      reserveFraction,
    },
    prefill: activity(prefill, topology.enabledUnits, enabledPerCluster),
    decode: activity(decode, topology.enabledUnits, enabledPerCluster),
    placement: settings.kvPlacement,
    tiers: { hbm: tier('hbm'), host: tier('host'), peer: tier('peer'), peers: tier('peers'), ssd: tier('ssd'), object: tier('object') },
  };
}
