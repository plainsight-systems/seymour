export type Phase = 'decode' | 'prefill';
export type ViewMode = 'story' | 'hardware';
export type WeightBits = 4 | 8 | 16;
export type KvBits = 8 | 16;
export type AttentionKernel = 'fused' | 'separate';
export type KvPlacement = 'hbm' | 'host' | 'peer' | 'peers' | 'ssd' | 'object';
export type LifecycleStageId = 'request' | 'prefix' | 'prefill' | 'kv-ready' | 'first-token' | 'decode' | 'stream' | 'release';
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
  /** Dense FP8 matrix peak (published figure without structured sparsity). */
  fp8DenseTflops: number;
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
  /** Present for mixture-of-experts models; routed experts replace the dense MLP. */
  moe?: {
    experts: number;
    activeExperts: number;
    expertIntermediateSize: number;
  };
  sourceUrl: string;
  sourceLabel: string;
}

export interface SimulationSettings {
  phase: Phase;
  hardwareId: string;
  batch: number;
  sequenceLength: number;
  prefixCachePercent: number;
  outputLength: number;
  reusePromptPrefixes: boolean;
  splitLongPrompts: boolean;
  promptTokensPerStep: number;
  servingMemoryFraction: number;
  weightBits: WeightBits;
  kvBits: KvBits;
  kvPlacement: KvPlacement;
  attentionKernel: AttentionKernel;
  overlap: boolean;
  view: ViewMode;
  modelId: string;
  /** Tokens guessed ahead and verified in one step; 0 turns speculation off. */
  speculativeTokens: 0 | 2 | 4;
  /** Assumed share of guessed tokens the model accepts (representative). */
  draftAcceptanceRate: number;
  /** Precision of the matrix math. 8-bit math applies only when weights are 8-bit or smaller. */
  mathBits: 16 | 8;
}

export interface LifecycleStage {
  id: LifecycleStageId;
  number: string;
  label: string;
  title: string;
  summary: string;
  equation: string;
  metricLabel: string;
  metricValue: string;
  phase: Phase;
  hardwareStage: HardwareStage;
  hasTransformerWork: boolean;
  skipped?: boolean;
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
  bottleneck: 'memory' | 'compute' | 'host' | 'placement';
  utilization: number;
  tokenRate: number;
  kvBytesPerToken: number;
  kvFootprintBytes: number;
  modelFootprintBytes: number;
  hbmUsedFraction: number;
  hbmTrafficBytes: number;
  attentionMaterializationBytes: number;
  hostTrafficBytes: number;
  hostMs: number;
  kvTierId: KvPlacement;
  kvTierMs: number;
  kvTierBandwidthNeeded: number;
  spilledWeightBytes: number;
  spilledKvBytes: number;
  crossoverBatch: number | null;
  batchLimitArithmeticIntensity: number;
  usableHbmCapacityBytes: number;
  prefillChunks: number;
  prefillChunkTokens: number;
  /** Weight bytes read per step; below weightBytes only for MoE at small batches. */
  weightReadBytes: number;
  /** Share of each layer's experts touched this step (1 for dense models). */
  expertsTouchedFraction: number;
  /** Generated tokens per sequence per decode step (1 without speculation). */
  tokensPerStep: number;
  /** Decode time per generated token for one user: totalMs / tokensPerStep. */
  msPerToken: number;
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
  estimatedActiveUnitFraction: number;
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
