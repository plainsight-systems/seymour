import type { HardwareProfile, ModelProfile } from '../types';

export const HARDWARE_PROFILES: HardwareProfile[] = [
  {
    id: 'h100-sxm',
    vendor: 'NVIDIA',
    name: 'H100 SXM',
    unitName: 'SM',
    unitCount: 132,
    architecture: 'Hopper SM90',
    waveName: 'warp',
    waveSize: 32,
    matrixGroupSize: 128,
    matrixInstruction: 'wgmma.mma_async.sync.aligned',
    matrixInstructionShape: 'm64n128k16 · FP16/BF16',
    sharedMemoryKB: 228,
    registerFileKB: 256,
    l2CacheMB: 50,
    hbmCapacityGB: 80,
    hbmBandwidthTBs: 3.35,
    fp16DenseTflops: 989.5,
    fp8DenseTflops: 1979,
    lastLevelCacheMB: 50,
    computeEfficiency: 0.55,
    memoryEfficiency: 0.72,
    hostLinkGBs: 64,
    peerFabric: 'switched',
    peerEachWayGBs: 450,
    kernelModel: true,
    sourceUrl: 'https://www.nvidia.com/en-us/data-center/h100/',
    sourceLabel: 'NVIDIA H100 product specifications',
    note: 'FP16 dense peak is half the published structured-sparsity figure. Host traffic uses the one-direction PCIe Gen5 x16 ceiling.',
  },
  {
    id: 'mi300x',
    vendor: 'AMD',
    name: 'MI300X',
    unitName: 'CU',
    unitCount: 304,
    architecture: 'CDNA 3 · gfx942',
    waveName: 'wavefront',
    waveSize: 64,
    matrixGroupSize: 64,
    matrixInstruction: 'v_mfma_f32_16x16x16_f16',
    matrixInstructionShape: 'm16n16k16 · FP16 → FP32',
    sharedMemoryKB: 64,
    registerFileKB: 512,
    l2CacheMB: 32,
    hbmCapacityGB: 192,
    hbmBandwidthTBs: 5.3,
    fp16DenseTflops: 1307.4,
    fp8DenseTflops: 2614.9,
    lastLevelCacheMB: 256,
    computeEfficiency: 0.55,
    memoryEfficiency: 0.72,
    hostLinkGBs: 64,
    peerFabric: 'direct',
    peerEachWayGBs: 64,
    kernelModel: true,
    sourceUrl: 'https://www.amd.com/en/products/accelerators/instinct/mi300/mi300x.html',
    sourceLabel: 'AMD Instinct MI300X specifications',
    note: 'Peak theoretical FP16 and HBM figures; 256 MB is Infinity Cache. Host traffic uses the one-direction PCIe Gen5 x16 ceiling.',
  },
];

export const MODEL_PROFILES: ModelProfile[] = [
  {
    id: 'llama-3.1-8b',
    name: 'Llama 3.1 8B · FP16',
    parametersB: 8.03,
    layers: 32,
    hiddenSize: 4096,
    attentionHeads: 32,
    kvHeads: 8,
    headDim: 128,
    weightBits: 16,
    kvBits: 16,
    intermediateSize: 14336,
    vocabSize: 128256,
    sourceUrl: 'https://huggingface.co/meta-llama/Llama-3.1-8B/blob/main/config.json',
    sourceLabel: 'Meta Llama 3.1 8B model configuration',
  },
  {
    // 128 routed experts, 8 per token. Parameter total is summed from the
    // published configuration (tested): experts, attention, router, embeddings.
    id: 'qwen3-30b-a3b',
    name: 'Qwen3 30B-A3B MoE · FP16',
    parametersB: 30.53,
    layers: 48,
    hiddenSize: 2048,
    attentionHeads: 32,
    kvHeads: 4,
    headDim: 128,
    weightBits: 16,
    kvBits: 16,
    intermediateSize: 6144,
    vocabSize: 151936,
    moe: { experts: 128, activeExperts: 8, expertIntermediateSize: 768 },
    sourceUrl: 'https://huggingface.co/Qwen/Qwen3-30B-A3B/blob/main/config.json',
    sourceLabel: 'Qwen3 30B-A3B model configuration',
  },
];

export function getModel(id: string): ModelProfile {
  const model = MODEL_PROFILES.find((profile) => profile.id === id);
  if (!model) throw new Error(`Unknown model "${id}"`);
  return model;
}

export const DEFAULT_SETTINGS = {
  phase: 'decode',
  hardwareId: 'h100-sxm',
  batch: 1,
  sequenceLength: 4096,
  prefixCachePercent: 0,
  outputLength: 32,
  reusePromptPrefixes: true,
  splitLongPrompts: true,
  promptTokensPerStep: 8192,
  servingMemoryFraction: 0.9,
  weightBits: 16,
  kvBits: 16,
  kvPlacement: 'hbm',
  modelId: 'llama-3.1-8b',
  speculativeTokens: 0,
  mathBits: 16,
  draftAcceptanceRate: 0.7,
  attentionKernel: 'fused',
  overlap: true,
  view: 'hardware',
} as const;

export function getHardware(id: string): HardwareProfile {
  return HARDWARE_PROFILES.find((profile) => profile.id === id) ?? HARDWARE_PROFILES[0]!;
}

export const DEFAULT_MODEL = MODEL_PROFILES[0]!;
