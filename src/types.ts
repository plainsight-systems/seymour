export type Phase = 'decode' | 'prefill';
export type ViewMode = 'story' | 'hardware';
export type HardwareStage = 'host' | 'hbm' | 'l2' | 'shared' | 'registers' | 'compute';
export type KernelTrack = 'runtime' | 'memory' | 'execution';
export type KernelPhaseKind = 'submit' | 'host-transfer' | 'hbm-load' | 'stage' | 'compute' | 'sync' | 'store';

export interface HardwareProfile {
  id: string;
  vendor: 'NVIDIA' | 'AMD';
  name: string;
  unitName: string;
  unitCount: number;
  architecture: string;
  waveName: 'warp' | 'wavefront';
  waveSize: number;
  matrixGroupSize: number;
  matrixInstruction: string;
  matrixInstructionShape: string;
  sharedMemoryKB: number;
  registerFileKB: number;
  l2CacheMB: number;
  hbmCapacityGB: number;
  hbmBandwidthTBs: number;
  fp16DenseTflops: number;
  lastLevelCacheMB: number;
  computeEfficiency: number;
  memoryEfficiency: number;
  hostLinkGBs: number;
  sourceUrl: string;
  sourceLabel: string;
  note: string;
}

export interface ModelProfile {
  id: string;
  name: string;
  parametersB: number;
  layers: number;
  hiddenSize: number;
  attentionHeads: number;
  kvHeads: number;
  headDim: number;
  weightBits: number;
  kvBits: number;
  intermediateSize: number;
  vocabSize: number;
  sourceUrl: string;
  sourceLabel: string;
}

export interface SimulationSettings {
  phase: Phase;
  hardwareId: string;
  batch: number;
  sequenceLength: number;
  overlap: boolean;
  view: ViewMode;
}

export interface SimulationResult {
  flops: number;
  bytes: number;
  weightBytes: number;
  kvBytes: number;
  arithmeticIntensity: number;
  ridgePoint: number;
  computeMs: number;
  memoryMs: number;
  totalMs: number;
  bottleneck: 'memory' | 'compute' | 'host';
  utilization: number;
  tokenRate: number;
  kvBytesPerToken: number;
  kvFootprintBytes: number;
  modelFootprintBytes: number;
  hbmUsedFraction: number;
  hbmTrafficBytes: number;
  hostTrafficBytes: number;
  hostMs: number;
  spilledWeightBytes: number;
  spilledKvBytes: number;
  crossoverBatch: number | null;
}

export interface AlgorithmStep {
  id: string;
  number: string;
  group: 'attention' | 'mlp' | 'output';
  label: string;
  name: string;
  equation: string;
  description: string;
  inputShape: string;
  outputShape: string;
  flops: number;
  parameterBytes: number;
  activationBytes: number;
  boundaryBytes: number;
  writeBytes: number;
  spillableKvBytes?: number;
  hardwareStage: HardwareStage;
  repetition: string;
}

export interface KernelPhase {
  id: string;
  label: string;
  kind: KernelPhaseKind;
  track: KernelTrack;
  startMs: number;
  durationMs: number;
  bytes: number;
  flops: number;
  location: HardwareStage;
  detail: string;
}

export interface KernelPlan {
  operationId: string;
  kernelId: string;
  kernelName: string;
  qualifier: string;
  fusedOperations: string[];
  grid: [number, number, number];
  workgroupSize: number;
  groups: number;
  wavesPerGroup: number;
  waveSize: number;
  cooperativeLanes: number;
  estimatedFirstWaveOccupancy: number;
  tile: string;
  instruction: string;
  instructionShape: string;
  phases: KernelPhase[];
  totalMs: number;
  hbmBytes: number;
  hostBytes: number;
  flops: number;
  assumptions: string[];
}
