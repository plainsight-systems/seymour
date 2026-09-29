import type { AlgorithmStep, ModelProfile, SimulationSettings } from '../types';
import { meanAttendedKeys } from './attention';
import { cachedPromptTokens, newPromptTokens } from './prompt';

export function buildAlgorithmSteps(
  settings: SimulationSettings,
  model: ModelProfile,
): AlgorithmStep[] {
  const b = settings.batch;
  const cachedTokens = cachedPromptTokens(settings);
  // A first pass still runs the newest token, even on a full prefix hit.
  const uncachedTokens = Math.max(1, newPromptTokens(settings));
  const chunkTokens = settings.splitLongPrompts
    ? Math.max(1, Math.min(uncachedTokens, Math.floor(settings.promptTokensPerStep / settings.batch)))
    : uncachedTokens;
  const tq = settings.phase === 'prefill' ? chunkTokens : 1;
  const tk = settings.sequenceLength;
  // Keys each query is actually scored against (causal; see attention.ts).
  const tkAttended = meanAttendedKeys(settings, tk, cachedTokens);
  const d = model.hiddenSize;
  const h = model.attentionHeads;
  const hkv = model.kvHeads;
  const dh = model.headDim;
  const dkv = hkv * dh;
  const i = model.intermediateSize;
  const v = model.vocabSize;
  const bytes = model.weightBits / 8;
  const activationBytes = model.kvBits / 8;
  const xShape = `[B=${b}, T=${tq.toLocaleString()}, d=${d}]`;
  const qShape = `[${b}, ${h}, ${tq.toLocaleString()}, ${dh}]`;
  const kvShape = `[${b}, ${hkv}, ${tk.toLocaleString()}, ${dh}]`;
  const xBytes = b * tq * d * activationBytes;
  const qBytes = b * h * tq * dh * activationBytes;
  const newKvBytes = b * hkv * tq * dh * activationBytes;
  const oneCachedTensorBytes = b * tk * dkv * activationBytes;
  const scoreBytes = b * h * tq * tkAttended * activationBytes;
  const materializeAttention = settings.attentionKernel === 'separate';

  return [
    {
      id: 'rms-attn', number: '01', group: 'attention', label: 'Norm',
      name: 'RMS-normalize the residual stream',
      equation: 'x̂ = x ⊙ γ / √(mean(x²) + ε)',
      description: 'Normalize each token vector without subtracting its mean. The learned scale γ is applied elementwise.',
      inputShape: xShape, outputShape: xShape,
      flops: 5 * b * tq * d, parameterBytes: d * bytes, activationBytes: xBytes, boundaryBytes: 2 * xBytes, writeBytes: xBytes,
      hardwareStage: 'compute', repetition: `per layer × ${model.layers}`,
    },
    {
      id: 'qkv', number: '02', group: 'attention', label: 'Q · K · V',
      name: 'Project queries, keys, and values',
      equation: 'Q = x̂WQ    K = x̂WK    V = x̂WV',
      description: `Q has ${h} heads. GQA stores only ${hkv} K/V heads, so K and V are ${h / hkv}× narrower than Q.`,
      inputShape: xShape, outputShape: `Q ${qShape} · K,V [${b}, ${hkv}, ${tq.toLocaleString()}, ${dh}]`,
      flops: 2 * b * tq * d * (d + 2 * dkv),
      parameterBytes: d * (d + 2 * dkv) * bytes,
      activationBytes: qBytes + 2 * newKvBytes, boundaryBytes: xBytes + qBytes + 2 * newKvBytes, writeBytes: qBytes + 2 * newKvBytes,
      hardwareStage: 'compute', repetition: `per layer × ${model.layers}`,
    },
    {
      id: 'rope', number: '03', group: 'attention', label: 'RoPE',
      name: 'Rotate Q and K by position',
      equation: 'Q′ = RoPE(Q, pos)    K′ = RoPE(K, pos)',
      description: 'Pairs of channels are rotated by position-dependent angles. Values are not rotated.',
      inputShape: `Q ${qShape} · K [${b}, ${hkv}, ${tq.toLocaleString()}, ${dh}]`,
      outputShape: 'same shapes',
      flops: 6 * b * tq * (d + dkv), parameterBytes: 0,
      activationBytes: qBytes + newKvBytes, boundaryBytes: 2 * (qBytes + newKvBytes), writeBytes: qBytes + newKvBytes,
      hardwareStage: 'registers', repetition: `per layer × ${model.layers}`,
    },
    {
      id: 'kv-cache', number: '04', group: 'attention', label: 'KV cache',
      name: 'Append K and V; read the prior context',
      equation: 'Kcache[pos] ← K′    Vcache[pos] ← V',
      description: settings.phase === 'decode'
        ? `Append one position, then expose all ${tk.toLocaleString()} cached positions to attention.`
        : `Write ${tk.toLocaleString()} positions so later decode steps do not recompute their K and V.`,
      inputShape: `new K,V [${b}, ${hkv}, ${tq.toLocaleString()}, ${dh}]`, outputShape: `K,V cache ${kvShape}`,
      flops: 0, parameterBytes: 0,
      activationBytes: 2 * oneCachedTensorBytes, boundaryBytes: 2 * newKvBytes, writeBytes: 2 * newKvBytes,
      spillableKvBytes: 2 * newKvBytes,
      hardwareStage: 'hbm', repetition: `per layer × ${model.layers}`,
    },
    {
      id: 'qk', number: '05', group: 'attention', label: 'QKᵀ',
      name: 'Score every query against cached keys',
      equation: 'S = Q′Kcacheᵀ / √dh + causal_mask',
      description: settings.phase === 'prefill' && settings.attentionKernel !== 'separate'
        ? 'Each query head dot-products against every legal key position. The causal mask makes future positions unreachable, and the fused kernel skips them, so a prompt costs about half the full grid.'
        : 'Each query head dot-products against every legal key position. The causal mask makes future positions unreachable during prefill.',
      inputShape: `Q ${qShape} · K ${kvShape}`, outputShape: `scores [${b}, ${h}, ${tq.toLocaleString()}, ${tk.toLocaleString()}]`,
      flops: 2 * b * h * tq * tkAttended * dh,
      parameterBytes: 0, activationBytes: scoreBytes,
      boundaryBytes: qBytes + oneCachedTensorBytes + (materializeAttention ? scoreBytes : 0),
      writeBytes: materializeAttention ? scoreBytes : 0, spillableKvBytes: oneCachedTensorBytes,
      hardwareStage: 'compute', repetition: `per layer × ${model.layers}`,
    },
    {
      id: 'softmax', number: '06', group: 'attention', label: 'Softmax',
      name: 'Turn scores into attention probabilities',
      equation: 'Pij = exp(Sij − max(Si)) / Σj exp(Sij − max(Si))',
      description: 'Subtracting the row maximum keeps the exponentials numerically stable. Each query row sums to one.',
      inputShape: `scores [${b}, ${h}, ${tq.toLocaleString()}, ${tk.toLocaleString()}]`, outputShape: 'same shape',
      flops: 5 * b * h * tq * tkAttended,
      parameterBytes: 0, activationBytes: scoreBytes,
      boundaryBytes: materializeAttention ? 2 * scoreBytes : 0,
      writeBytes: materializeAttention ? scoreBytes : 0,
      hardwareStage: 'shared', repetition: `per layer × ${model.layers}`,
    },
    {
      id: 'pv', number: '07', group: 'attention', label: 'P · V',
      name: 'Mix cached values with those probabilities',
      equation: 'A = P Vcache',
      description: 'The weighted sum pulls information from earlier token positions into each query head.',
      inputShape: `P [${b}, ${h}, ${tq.toLocaleString()}, ${tk.toLocaleString()}] · V ${kvShape}`, outputShape: qShape,
      flops: 2 * b * h * tq * tkAttended * dh,
      parameterBytes: 0, activationBytes: xBytes,
      boundaryBytes: oneCachedTensorBytes + xBytes + (materializeAttention ? scoreBytes : 0),
      writeBytes: xBytes, spillableKvBytes: oneCachedTensorBytes,
      hardwareStage: 'compute', repetition: `per layer × ${model.layers}`,
    },
    {
      id: 'o-proj', number: '08', group: 'attention', label: 'Output',
      name: 'Recombine heads and project',
      equation: 'O = concat(A1 … Ah) WO    x ← x + O',
      description: 'Concatenate the query heads, project back to hidden width, and add the result to the residual stream.',
      inputShape: qShape, outputShape: xShape,
      flops: 2 * b * tq * d * d + b * tq * d,
      parameterBytes: d * d * bytes, activationBytes: xBytes, boundaryBytes: 2 * xBytes, writeBytes: xBytes,
      hardwareStage: 'compute', repetition: `per layer × ${model.layers}`,
    },
    {
      id: 'rms-mlp', number: '09', group: 'mlp', label: 'Norm',
      name: 'RMS-normalize before the MLP',
      equation: 'x̂ = RMSNorm(x)',
      description: 'The second pre-normalization prepares the residual stream for the feed-forward block.',
      inputShape: xShape, outputShape: xShape,
      flops: 5 * b * tq * d, parameterBytes: d * bytes, activationBytes: xBytes, boundaryBytes: 2 * xBytes, writeBytes: xBytes,
      hardwareStage: 'compute', repetition: `per layer × ${model.layers}`,
    },
    {
      id: 'swiglu', number: '10', group: 'mlp', label: 'SwiGLU',
      name: 'Gate, expand, contract, and add',
      equation: 'm = (SiLU(x̂Wgate) ⊙ x̂Wup) Wdown    x ← x + m',
      description: `Two projections expand each token from ${d} to ${i} channels; a gated product filters them; the down projection returns to ${d}.`,
      inputShape: xShape, outputShape: xShape,
      flops: 6 * b * tq * d * i + 5 * b * tq * i,
      parameterBytes: 3 * d * i * bytes, activationBytes: b * tq * i * activationBytes, boundaryBytes: 2 * xBytes, writeBytes: xBytes,
      hardwareStage: 'compute', repetition: `per layer × ${model.layers}`,
    },
    {
      id: 'logits', number: '11', group: 'output', label: 'Logits',
      name: 'Project the final hidden state to vocabulary logits',
      equation: 'z = RMSNorm(xL) Wvocabᵀ',
      description: `One score is produced for each of ${v.toLocaleString()} vocabulary entries. Serving usually needs only the newest position.`,
      inputShape: `[${b}, 1, ${d}]`, outputShape: `[${b}, ${v.toLocaleString()}]`,
      flops: 2 * b * d * v, parameterBytes: d * v * bytes, activationBytes: b * v * activationBytes,
      boundaryBytes: b * d * activationBytes + b * v * activationBytes, writeBytes: b * v * activationBytes,
      hardwareStage: 'compute', repetition: 'once after the final layer',
    },
    {
      id: 'sample', number: '12', group: 'output', label: 'Sample',
      name: 'Temperature, top-k, top-p, then sample',
      equation: 'p = softmax(z / τ) → top-k mask → top-p prefix → categorical(p)',
      description: 'Top-k keeps the k highest logits. Top-p keeps the smallest sorted prefix whose probability mass reaches p. One token ID is then sampled.',
      inputShape: `[${b}, ${v.toLocaleString()}] logits`, outputShape: `[${b}] token IDs`,
      flops: 6 * b * v, parameterBytes: 0, activationBytes: b * v * activationBytes,
      boundaryBytes: b * v * activationBytes + b * 4, writeBytes: b * 4,
      hardwareStage: 'registers', repetition: 'once per generated token',
    },
  ];
}
