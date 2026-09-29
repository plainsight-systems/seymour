export type Phase = 'decode' | 'prefill';
export type WeightBits = 4 | 8 | 16;
export type KvBits = 8 | 16;
export type AttentionKernel = 'fused' | 'separate';
export type KvPlacement = 'hbm' | 'host' | 'peer' | 'peers' | 'ssd' | 'object';
export type HardwareStage = 'host' | 'hbm' | 'l2' | 'shared' | 'registers' | 'compute';

export interface HardwareProfile {
  id: string;
  vendor: 'NVIDIA' | 'AMD';
  name: string;
  unitName: string;
  unitCount: number;
  architecture: string;
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
  /** switched: every GPU reaches any peer through switch chips; direct: one link per peer. */
  peerFabric: 'switched' | 'direct';
  /** One-direction peer bandwidth: the per-GPU total when switched, per link when direct. */
  peerEachWayGBs: number;
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
  /** Where an idle session's KV waits between turns (priced against rebuilding it with a first pass). */
  idleKvPlacement: KvPlacement;
  attentionKernel: AttentionKernel;
  overlap: boolean;
  modelId: string;
  /** Tokens guessed ahead and verified in one step; 0 turns speculation off. */
  speculativeTokens: 0 | 2 | 4;
  /** Assumed share of guessed tokens the model accepts (representative). */
  draftAcceptanceRate: number;
  /** Precision of the matrix math. 8-bit math applies only when weights are 8-bit or smaller. */
  mathBits: 16 | 8;
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


