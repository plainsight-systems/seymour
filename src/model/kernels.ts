import type {
  AlgorithmStep,
  HardwareProfile,
  KernelPhase,
  KernelPlan,
  ModelProfile,
  SimulationResult,
  SimulationSettings,
} from '../types';

interface KernelDescriptor {
  id: string;
  name: string;
  fused: string[];
  kind: 'matrix' | 'attention' | 'vector' | 'memory' | 'sampling';
  tile: string;
}

const LAUNCH_ASSUMPTION_MS = 0.005;
const RESIDENT_GROUP_ASSUMPTION = 2;

const descriptors: Record<string, KernelDescriptor> = {
  'rms-attn': { id: 'rmsnorm_attn', name: 'rmsnorm_fwd', fused: ['square', 'row reduction', 'rsqrt', 'scale'], kind: 'vector', tile: '256 elements / workgroup' },
  qkv: { id: 'qkv_gemm', name: 'qkv_projection_gemm', fused: ['Q projection', 'K projection', 'V projection'], kind: 'matrix', tile: '128 × 128 × 64' },
  rope: { id: 'rope_kv', name: 'rope_kv_append', fused: ['RoPE(Q)', 'RoPE(K)', 'KV append'], kind: 'vector', tile: '256 channels / workgroup' },
  'kv-cache': { id: 'paged_kv', name: 'paged_kv_cache_update', fused: ['KV address lookup', 'cache append / context read'], kind: 'memory', tile: 'one KV page / workgroup' },
  qk: { id: 'attention', name: 'fused_attention_fwd', fused: ['QKᵀ', 'scale + causal mask', 'online softmax', 'P·V'], kind: 'attention', tile: '64 queries × 128 keys' },
  softmax: { id: 'attention', name: 'fused_attention_fwd', fused: ['QKᵀ', 'scale + causal mask', 'online softmax', 'P·V'], kind: 'attention', tile: '64 queries × 128 keys' },
  pv: { id: 'attention', name: 'fused_attention_fwd', fused: ['QKᵀ', 'scale + causal mask', 'online softmax', 'P·V'], kind: 'attention', tile: '64 queries × 128 keys' },
  'o-proj': { id: 'o_proj', name: 'attention_output_gemm', fused: ['head concat', 'output projection', 'residual add'], kind: 'matrix', tile: '128 × 128 × 64' },
  'rms-mlp': { id: 'rmsnorm_mlp', name: 'rmsnorm_mlp_fwd', fused: ['square', 'row reduction', 'rsqrt', 'scale'], kind: 'vector', tile: '256 elements / workgroup' },
  swiglu: { id: 'swiglu_mlp', name: 'swiglu_mlp_gemm', fused: ['gate projection', 'up projection', 'SiLU × gate', 'down projection', 'residual add'], kind: 'matrix', tile: '128 × 128 × 64' },
  logits: { id: 'lm_head', name: 'lm_head_gemm', fused: ['final RMSNorm', 'vocabulary projection'], kind: 'matrix', tile: '128 × 128 × 64' },
  sample: { id: 'sample', name: 'topk_topp_sampling', fused: ['temperature', 'top-k select', 'top-p scan', 'categorical draw'], kind: 'sampling', tile: '256 logits / workgroup' },
};

const separateAttentionDescriptors: Record<string, KernelDescriptor> = {
  qk: { id: 'qk_matmul', name: 'qk_score_gemm', fused: ['QKᵀ', 'scale + causal mask', 'score store'], kind: 'attention', tile: '64 queries × 128 keys' },
  softmax: { id: 'softmax', name: 'row_softmax_fwd', fused: ['score load', 'max + exp reduction', 'probability store'], kind: 'vector', tile: 'one score row / workgroup' },
  pv: { id: 'pv_matmul', name: 'probability_value_gemm', fused: ['probability load', 'P·V', 'attention output store'], kind: 'attention', tile: '64 queries × 128 keys' },
};

function ceilDiv(value: number, divisor: number): number {
  return Math.max(1, Math.ceil(value / divisor));
}

function matrixOutputWidth(step: AlgorithmStep, model: ModelProfile): number {
  if (step.id === 'qkv') return model.hiddenSize + 2 * model.kvHeads * model.headDim;
  if (step.id === 'swiglu') return 2 * model.intermediateSize;
  if (step.id === 'logits') return model.vocabSize;
  return model.hiddenSize;
}

function groupCount(
  descriptor: KernelDescriptor,
  step: AlgorithmStep,
  settings: SimulationSettings,
  model: ModelProfile,
): [number, number, number] {
  const queryTokens = settings.phase === 'prefill' ? settings.sequenceLength : 1;
  const rows = settings.batch * queryTokens;
  if (descriptor.kind === 'matrix') {
    return [ceilDiv(matrixOutputWidth(step, model), 128), ceilDiv(rows, 128), 1];
  }
  if (descriptor.kind === 'attention') {
    return [ceilDiv(settings.sequenceLength, 128), settings.batch * model.attentionHeads, ceilDiv(queryTokens, 64)];
  }
  const elements = step.id === 'sample'
    ? settings.batch * model.vocabSize
    : Math.max(1, step.activationBytes / (model.kvBits / 8));
  return [ceilDiv(elements, 256), 1, 1];
}

function phase(
  id: string,
  label: string,
  kind: KernelPhase['kind'],
  track: KernelPhase['track'],
  startMs: number,
  durationMs: number,
  location: KernelPhase['location'],
  detail: string,
  bytes = 0,
  flops = 0,
): KernelPhase {
  return { id, label, kind, track, startMs, durationMs, location, detail, bytes, flops };
}

export function buildKernelPlan(
  step: AlgorithmStep,
  settings: SimulationSettings,
  hardware: HardwareProfile,
  model: ModelProfile,
  result: SimulationResult,
): KernelPlan {
  const descriptor = settings.attentionKernel === 'separate' && separateAttentionDescriptors[step.id]
    ? separateAttentionDescriptors[step.id]!
    : descriptors[step.id] ?? descriptors.qkv!;
  const grid = groupCount(descriptor, step, settings, model);
  const groups = grid[0] * grid[1] * grid[2];
  const matrix = descriptor.kind === 'matrix' || descriptor.kind === 'attention';
  const workgroupSize = matrix ? 256 : 256;
  const wavesPerGroup = workgroupSize / hardware.waveSize;
  const cooperativeLanes = matrix ? hardware.matrixGroupSize : hardware.waveSize;
  const estimatedActiveUnitFraction = Math.min(1, groups / hardware.unitCount);
  const estimatedFirstWaveOccupancy = Math.min(1, groups / (hardware.unitCount * RESIDENT_GROUP_ASSUMPTION));

  // This is a declared reference schedule, not an extracted profiler trace. The
  // algorithm ledger separates logical tensors from bytes that cross the
  // modeled HBM boundary. Parameter bytes are reads; writeBytes is declared per
  // operation so a fused score matrix can remain entirely on chip.
  const stepBytes = step.parameterBytes + step.boundaryBytes;
  const weightSpillFraction = result.weightBytes > 0 ? result.spilledWeightBytes / result.weightBytes : 0;
  const kvSpillFraction = result.kvFootprintBytes > 0 ? result.spilledKvBytes / result.kvFootprintBytes : 0;
  const hostBytes = Math.min(
    stepBytes,
    step.parameterBytes * weightSpillFraction + (step.spillableKvBytes ?? 0) * kvSpillFraction,
  );
  const hbmBytes = Math.max(0, stepBytes - hostBytes);
  const hbmShare = stepBytes > 0 ? hbmBytes / stepBytes : 0;
  const writeBytes = step.writeBytes * hbmShare;
  const readBytes = Math.max(0, hbmBytes - writeBytes);
  const effectiveHbmBytesPerMs = hardware.hbmBandwidthTBs * hardware.memoryEfficiency * 1e9;
  const effectiveHostBytesPerMs = hardware.hostLinkGBs * 1e6;
  const effectiveFlopsPerMs = hardware.fp16DenseTflops * hardware.computeEfficiency * 1e9;
  const hostMs = hostBytes / effectiveHostBytesPerMs;
  const loadMs = readBytes / effectiveHbmBytesPerMs;
  const computeMs = step.flops / effectiveFlopsPerMs;
  const storeMs = writeBytes / effectiveHbmBytesPerMs;
  const submitEnd = LAUNCH_ASSUMPTION_MS;
  const transferEnd = submitEnd + hostMs;
  const loadStart = transferEnd;
  const loadEnd = loadStart + loadMs;
  const stageStart = loadStart + loadMs * 0.2;
  const computeStart = loadStart + loadMs * 0.35;
  const computeEnd = computeStart + computeMs;
  const storeStart = Math.max(loadEnd, computeEnd);
  const totalMs = storeStart + storeMs;

  const phases: KernelPhase[] = [
    phase('submit', 'CPU submit', 'submit', 'runtime', 0, LAUNCH_ASSUMPTION_MS, 'host', 'Runtime writes one launch descriptor; weights stay resident in HBM.'),
  ];
  if (hostBytes > 0) {
    phases.push(phase('host-transfer', 'PCIe fallback', 'host-transfer', 'memory', submitEnd, hostMs, 'host', 'Only the modeled spill crosses from system memory.', hostBytes));
  }
  phases.push(
    phase('hbm-load', 'HBM → controller → L2', 'hbm-load', 'memory', loadStart, loadMs, 'hbm', 'Read tiles enter through the die-edge memory controllers and shared L2.', readBytes),
    phase('stage', `${hardware.vendor === 'AMD' ? 'LDS' : 'shared'} tile stage`, 'stage', 'execution', stageStart, Math.max(loadMs * 0.8, 0), 'shared', 'Software-visible L2-to-local tile staging; modeled as overlapped because a public on-chip bandwidth is not assumed.'),
    phase('compute', matrix ? 'Cooperative matrix issue' : 'Vector lane issue', 'compute', 'execution', computeStart, computeMs, 'compute', matrix ? `${cooperativeLanes} lanes cooperate on each ${hardware.matrixInstructionShape} instruction.` : `${hardware.waveSize} lanes execute the vector/reduction instruction stream.`, 0, step.flops),
    phase('sync', 'Barrier / wait', 'sync', 'execution', Math.max(computeEnd, loadEnd), 0, 'registers', 'Ordering point is shown but not separately timed in this first-order model.'),
    phase('store', 'HBM store', 'store', 'memory', storeStart, storeMs, 'hbm', 'Registers → L2 → memory controller → HBM.', writeBytes),
  );

  return {
    operationId: step.id,
    kernelId: descriptor.id,
    kernelName: descriptor.name,
    qualifier: settings.attentionKernel === 'separate' && separateAttentionDescriptors[step.id]
      ? `${settings.phase} · separate attention stage`
      : settings.phase === 'decode' && descriptor.kind === 'attention'
        ? 'paged decode · fused attention reference'
        : `${settings.phase} reference`,
    fusedOperations: descriptor.fused,
    grid,
    workgroupSize,
    groups,
    wavesPerGroup,
    waveSize: hardware.waveSize,
    cooperativeLanes,
    estimatedActiveUnitFraction,
    estimatedFirstWaveOccupancy,
    tile: descriptor.tile,
    instruction: matrix ? hardware.matrixInstruction : `${hardware.waveName}-level vector / reduction ops`,
    instructionShape: matrix ? hardware.matrixInstructionShape : `${hardware.waveSize} lanes`,
    phases,
    totalMs,
    hbmBytes,
    hostBytes,
    flops: step.flops,
    assumptions: [
      '5 µs launch latency (visible Seymour assumption)',
      '2 resident workgroups per SM/CU for the first scheduling wave',
      'read/write bytes come from the selected operation’s declared boundary tensors',
      'HBM and compute use the same visible efficiency factors as the roofline',
      'on-chip stage and barrier latency are shown but not separately priced',
    ],
  };
}
