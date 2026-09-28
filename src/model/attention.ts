import type { SimulationSettings } from '../types';

// How many key positions each query is scored against, on average, in one
// step. This is the causal-attention convention both the whole-step model and
// the per-operation breakdown use.
//
// - Decode: the new token sees the whole context.
// - Prompt, fused kernel: a token sees only itself and earlier tokens, and
//   fused kernels skip the masked (future) blocks. Over the uncached part of
//   a prompt, token p sees cached + p + 1 keys, so the mean is
//   cached + (uncached + 1) / 2: about half the full grid with no cached prefix.
//   A chunked prompt is priced at this mean for every chunk, so the chunks
//   sum to the whole prompt's causal total.
// - Prompt, separate kernels: the QKᵀ matrix multiply computes the full grid
//   and the mask is applied afterwards, so every query meets every key.

export function meanAttendedKeys(
  settings: Pick<SimulationSettings, 'phase' | 'attentionKernel'>,
  sequenceLength: number,
  cachedTokens: number,
): number {
  if (settings.phase === 'decode' || settings.attentionKernel === 'separate') return sequenceLength;
  const uncached = Math.max(1, sequenceLength - cachedTokens);
  return cachedTokens + (uncached + 1) / 2;
}
