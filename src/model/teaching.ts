import type { AlgorithmStep, HardwareProfile, KernelPlan, SimulationSettings } from '../types';
import { formatBytes, formatDuration, formatNumber } from './calculate';

export type OptimizationLayer = 'model' | 'runtime' | 'kernel' | 'system';
export type DataKind = 'control' | 'weights' | 'activations' | 'kv';

export interface OptimizationNote {
  layer: OptimizationLayer;
  title: string;
  effect: string;
  tradeoff: string;
}

export interface TermNote {
  term: string;
  definition: string;
}

export interface TeachingGuide {
  pathTitle: string;
  pathSummary: string;
  dataKinds: DataKind[];
  performanceTitle: string;
  performanceCopy: string;
  optimizationTitle: string;
  optimizations: OptimizationNote[];
  terms: TermNote[];
}

interface StaticGuide {
  performanceTitle: string;
  performanceCopy: string;
  optimizationTitle: string;
  optimizations: OptimizationNote[];
  terms: TermNote[];
}

const guides: Record<string, StaticGuide> = {
  'rms-attn': {
    performanceTitle: 'A reduction wrapped in memory traffic.',
    performanceCopy: 'RMSNorm reads a token vector, reduces its squared values, then scales and writes it. The arithmetic is cheap relative to moving the vector, so a separate launch is usually less attractive than fusing the norm into a neighboring projection.',
    optimizationTitle: 'Remove the extra trip before accelerating the arithmetic.',
    optimizations: [
      { layer: 'kernel', title: 'Fuse norm with QKV input', effect: 'Keeps the normalized vector in registers or local storage instead of writing and rereading it.', tradeoff: 'More complex epilogues and tighter coupling to the GEMM implementation.' },
      { layer: 'kernel', title: 'Warp/wave reduction', effect: 'Combines partial sums with lane shuffles before using a wider barrier.', tradeoff: 'Shape-specific code and sensitivity to hidden width.' },
    ],
    terms: [{ term: 'reduction', definition: 'Many lane-local values combined into one row statistic.' }],
  },
  qkv: {
    performanceTitle: 'Three projections share one activation—but decode makes a skinny GEMM.',
    performanceCopy: 'The weight matrices are large and the decode M dimension is only batch × 1 token. A small batch exposes little parallel work per weight load; batching makes the same weight tiles serve more rows and improves arithmetic intensity.',
    optimizationTitle: 'Reuse weights and keep matrix units occupied.',
    optimizations: [
      { layer: 'runtime', title: 'Continuous batching', effect: 'Combines ready decode sequences so each weight tile serves more token rows.', tradeoff: 'Queueing policy can increase individual-request latency.' },
      { layer: 'kernel', title: 'Fused QKV projection', effect: 'Reads the normalized activation once and produces Q, K, and V in one launch.', tradeoff: 'Less modularity and more complicated output layouts.' },
      { layer: 'model', title: 'Weight quantization', effect: 'Cuts weight bytes crossing HBM and can move decode toward the compute roof.', tradeoff: 'Dequantization work and possible accuracy loss.' },
    ],
    terms: [
      { term: 'tile', definition: 'A rectangular matrix block assigned to one workgroup.' },
      { term: 'occupancy', definition: 'How many workgroups or waves can reside on an SM/CU at once; not the same as useful utilization.' },
    ],
  },
  rope: {
    performanceTitle: 'Position encoding is inexpensive; another launch is not.',
    performanceCopy: 'RoPE rotates pairs of Q and K channels. It is vector math with regular access, so the optimization target is usually eliminating an intermediate write rather than making the rotations themselves faster.',
    optimizationTitle: 'Fuse the rotation where Q and K already live.',
    optimizations: [
      { layer: 'kernel', title: 'Fuse RoPE with QKV or KV append', effect: 'Applies rotations before fragments leave registers.', tradeoff: 'Kernel variants multiply when layouts or scaling schemes change.' },
      { layer: 'runtime', title: 'Cache position parameters', effect: 'Avoids regenerating frequencies and keeps position metadata compact.', tradeoff: 'Consumes memory and complicates long-context scaling variants.' },
    ],
    terms: [{ term: 'elementwise', definition: 'Each channel pair can be transformed independently before the next boundary.' }],
  },
  'kv-cache': {
    performanceTitle: 'The cache is a capacity problem first—and a bandwidth problem every decode step.',
    performanceCopy: 'New K and V vectors are appended once, but later attention kernels revisit the accumulated context. Capacity grows with batch × sequence × layers × KV heads; a spill replaces an HBM trip with the much slower host link.',
    optimizationTitle: 'Control layout, precision, and residency.',
    optimizations: [
      { layer: 'runtime', title: 'Paged KV allocation', effect: 'Stores cache blocks non-contiguously so sequences can grow without large copies or fragmentation.', tradeoff: 'Page tables add address work and require kernels that understand the layout.' },
      { layer: 'model', title: 'GQA / MQA', effect: 'Shares K/V heads across query heads, shrinking cache capacity and read traffic.', tradeoff: 'A model architecture choice that can affect quality.' },
      { layer: 'model', title: 'KV quantization', effect: 'Reduces bytes per cached token and extends the context that fits in HBM.', tradeoff: 'Conversion work and attention-quality sensitivity.' },
      { layer: 'system', title: 'Keep hot KV in HBM', effect: 'Avoids PCIe fallback for active sequences.', tradeoff: 'Admission and eviction policy become serving-system concerns.' },
    ],
    terms: [
      { term: 'paged KV', definition: 'A virtualized block layout for variable-length sequence caches.' },
      { term: 'GQA', definition: 'Grouped-query attention: several query heads share each K/V head.' },
    ],
  },
  qk: {
    performanceTitle: 'Attention score work grows with context length.',
    performanceCopy: 'Each query head touches cached keys across the legal context. The score matrix is mathematically real, but a fused attention kernel should tile it through local memory and registers instead of materializing it in HBM.',
    optimizationTitle: 'Tile the context and never write the score matrix.',
    optimizations: [
      { layer: 'kernel', title: 'FlashAttention-style tiling', effect: 'Streams Q/K/V tiles through local memory and combines score, mask, softmax, and P·V in one kernel.', tradeoff: 'Complex numerics and shape-specific kernels.' },
      { layer: 'runtime', title: 'Paged attention', effect: 'Reads non-contiguous KV pages directly without first compacting each sequence.', tradeoff: 'Irregular address translation can reduce locality.' },
      { layer: 'model', title: 'Reduce KV heads', effect: 'Shrinks the key stream that must be revisited for every query head.', tradeoff: 'Requires GQA/MQA-trained weights.' },
    ],
    terms: [
      { term: 'online softmax', definition: 'Maintains running maxima and sums so score tiles need not be stored.' },
      { term: 'arithmetic intensity', definition: 'Useful FLOPs performed per byte crossing the priced memory boundary.' },
    ],
  },
  softmax: {
    performanceTitle: 'The large score tensor should exist only as an on-chip stream.',
    performanceCopy: 'A naïve implementation writes scores to HBM, launches softmax, then reads them again. Online softmax carries a running maximum and normalization sum through tiles, preserving numerical stability without that round trip.',
    optimizationTitle: 'Keep reduction state beside the score tile.',
    optimizations: [
      { layer: 'kernel', title: 'Online softmax', effect: 'Combines partial maxima and sums while score tiles remain in registers or shared/LDS.', tradeoff: 'Requires careful rescaling when a later tile changes the running maximum.' },
      { layer: 'kernel', title: 'Fuse mask + softmax + P·V', effect: 'Eliminates launch boundaries and intermediate score traffic.', tradeoff: 'Increases register pressure and kernel complexity.' },
    ],
    terms: [
      { term: 'numerical stability', definition: 'Subtracting the row maximum prevents exponential overflow.' },
      { term: 'register pressure', definition: 'Demand for per-wave registers; too much reduces concurrent resident work.' },
    ],
  },
  pv: {
    performanceTitle: 'Probabilities turn into another context-length KV read.',
    performanceCopy: 'The kernel multiplies attention probabilities by cached values and accumulates one output vector. Keeping probability tiles local avoids an HBM score read, but V still has to arrive from the cache hierarchy.',
    optimizationTitle: 'Reuse the softmax tile while V streams past it.',
    optimizations: [
      { layer: 'kernel', title: 'Fuse with score + softmax', effect: 'Consumes each probability tile immediately instead of storing it.', tradeoff: 'Larger fused kernels may use more registers.' },
      { layer: 'model', title: 'Quantize the KV cache', effect: 'Reduces V bytes per context position.', tradeoff: 'Adds conversion and can degrade output quality.' },
      { layer: 'kernel', title: 'Coalesced V layout', effect: 'Makes neighboring lanes request neighboring bytes from the cache line.', tradeoff: 'The best layout can differ between prefill and decode.' },
    ],
    terms: [{ term: 'coalescing', definition: 'Combining adjacent lane requests into fewer memory transactions.' }],
  },
  'o-proj': {
    performanceTitle: 'The attention result returns to hidden width.',
    performanceCopy: 'Head outputs are recombined, multiplied by the output projection, and added to the residual stream. The GEMM is regular; avoiding separate concat, bias, and residual kernels is the important boundary decision.',
    optimizationTitle: 'Move epilogue work into the projection.',
    optimizations: [
      { layer: 'kernel', title: 'Fused residual epilogue', effect: 'Performs scaling and residual addition while output fragments are still in registers.', tradeoff: 'Epilogue variants complicate compilation and testing.' },
      { layer: 'system', title: 'Tensor-parallel reduction', effect: 'Splits the projection across GPUs when one device cannot meet capacity or latency targets.', tradeoff: 'Introduces an all-reduce on the critical path.' },
    ],
    terms: [{ term: 'epilogue', definition: 'Work applied to accumulator fragments before the kernel stores its output.' }],
  },
  'rms-mlp': {
    performanceTitle: 'Another normalization sits directly before the largest weight block.',
    performanceCopy: 'Its standalone arithmetic is small. The valuable move is to feed normalized values directly into the gate and up projections instead of committing an intermediate tensor to HBM.',
    optimizationTitle: 'Treat norm as the MLP prologue.',
    optimizations: [
      { layer: 'kernel', title: 'Fuse norm into MLP input', effect: 'Removes one write, one read, and often one launch.', tradeoff: 'Makes the MLP kernel responsible for reduction and synchronization.' },
      { layer: 'runtime', title: 'Compile stable shapes', effect: 'Specializes launch geometry and fusion for common batch shapes.', tradeoff: 'Dynamic workloads need a family of variants.' },
    ],
    terms: [{ term: 'prologue', definition: 'Kernel work that prepares operands before the main matrix loop.' }],
  },
  swiglu: {
    performanceTitle: 'The MLP is three large projections plus a gate.',
    performanceCopy: 'Gate and up projections expand to the intermediate width; the down projection contracts again. This block owns a large fraction of model weights and dense FLOPs, so precision, tiling, and parallel partitioning all matter.',
    optimizationTitle: 'Attack weight bytes, matrix utilization, and intermediate traffic.',
    optimizations: [
      { layer: 'model', title: 'Weight quantization', effect: 'Cuts the dominant projection-weight stream.', tradeoff: 'Accuracy and dequantization throughput must be validated.' },
      { layer: 'kernel', title: 'Fuse SiLU × gate', effect: 'Keeps expanded intermediates near the matrix pipeline.', tradeoff: 'The full three-GEMM block cannot always remain in one kernel.' },
      { layer: 'system', title: 'Tensor-parallel MLP', effect: 'Partitions the wide intermediate dimension across accelerators.', tradeoff: 'Adds collective communication between projections.' },
    ],
    terms: [{ term: 'tensor parallelism', definition: 'Splitting one layer’s matrix work across multiple accelerators.' }],
  },
  logits: {
    performanceTitle: 'A wide vocabulary projection runs for one newest token.',
    performanceCopy: 'The hidden row is multiplied by the vocabulary matrix. Decode again presents a skinny GEMM, and the vocabulary weights can be hundreds of megabytes even though the output is only one score vector per sequence.',
    optimizationTitle: 'Avoid paying the full vocabulary cost more often than necessary.',
    optimizations: [
      { layer: 'model', title: 'Quantize the output matrix', effect: 'Reduces the final weight stream over HBM.', tradeoff: 'Logit accuracy can be sensitive near the sampling cutoff.' },
      { layer: 'runtime', title: 'Speculative decoding', effect: 'Verifies several proposed tokens in one target-model pass, amortizing weight reads.', tradeoff: 'Benefit depends on draft acceptance rate.' },
      { layer: 'system', title: 'Vocabulary parallelism', effect: 'Partitions vocabulary rows across GPUs.', tradeoff: 'Top-k selection must merge candidates across devices.' },
    ],
    terms: [{ term: 'speculative decoding', definition: 'A smaller draft proposes tokens that the target model verifies in batches.' }],
  },
  sample: {
    performanceTitle: 'Sampling is a reduction and selection pipeline—not attention K/V.',
    performanceCopy: 'Temperature scaling, top-k selection, probability normalization, top-p prefix selection, and a random draw act over vocabulary logits. Returning all logits to the CPU would add a synchronization and transfer boundary.',
    optimizationTitle: 'Keep selection on the device and return one token ID.',
    optimizations: [
      { layer: 'kernel', title: 'Fused top-k / top-p sampling', effect: 'Combines selection, normalization, scan, and draw without materializing multiple vocabulary-sized buffers.', tradeoff: 'Sampling options create many kernel variants.' },
      { layer: 'runtime', title: 'Device-side sampling', effect: 'Returns a token ID instead of transferring the full logit vector to the host.', tradeoff: 'Random-state management moves into the serving runtime.' },
    ],
    terms: [
      { term: 'top-k', definition: 'Keep only the k highest-scoring vocabulary entries.' },
      { term: 'top-p', definition: 'Keep the smallest sorted prefix whose probability mass reaches p.' },
    ],
  },
};

export function buildTeachingGuide(
  step: AlgorithmStep,
  settings: SimulationSettings,
  hardware: HardwareProfile,
  plan: KernelPlan,
): TeachingGuide {
  const guide = guides[step.id] ?? guides.qkv!;
  const memoryMs = plan.phases.filter((phase) => phase.track === 'memory').reduce((sum, phase) => sum + phase.durationMs, 0);
  const computeMs = plan.phases.filter((phase) => phase.kind === 'compute').reduce((sum, phase) => sum + phase.durationMs, 0);
  const limiting = plan.hostBytes > 0 ? 'host transfer' : computeMs > memoryMs ? 'matrix/vector issue' : plan.hbmBytes > 0 ? 'HBM traffic' : 'launch and on-chip execution';
  const dataKinds: DataKind[] = ['control'];
  if (step.parameterBytes > 0) dataKinds.push('weights');
  if (step.spillableKvBytes || step.id === 'rope') dataKinds.push('kv');
  if (step.boundaryBytes > 0 || step.activationBytes > 0) dataKinds.push('activations');

  return {
    ...guide,
    pathTitle: `${step.label} · ${plan.kernelName}`,
    pathSummary: `${formatBytes(plan.hbmBytes)} at the modeled HBM boundary · ${formatDuration(plan.totalMs)} reference launch · within this operation, ${limiting} is the longest priced stage.`,
    dataKinds,
    performanceCopy: `${guide.performanceCopy} Here, ${plan.groups.toLocaleString()} workgroups can initially reach ${formatNumber(plan.estimatedActiveUnitFraction * 100)}% of the ${hardware.unitCount} ${hardware.unitName}s on ${hardware.name}.${plan.estimatedActiveUnitFraction < 1 ? ' The remaining units are idle in that first scheduling wave.' : ' Every unit can receive work in that first scheduling wave.'} Batch is ${settings.batch}.`,
  };
}
