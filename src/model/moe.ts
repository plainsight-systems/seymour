import type { ModelProfile } from '../types';

const GIGA = 1e9;

// Mixture-of-experts arithmetic. Every function reduces to the dense case
// when a model has no `moe` block, so dense results are unchanged.

/** Parameters stored in all routed experts, across every layer. */
export function expertParameters(model: ModelProfile): number {
  if (!model.moe) return 0;
  const perExpert = 3 * model.hiddenSize * model.moe.expertIntermediateSize;
  return model.layers * model.moe.experts * perExpert;
}

/** Parameters one token multiplies through: shared weights plus its active experts. */
export function activeParametersPerToken(model: ModelProfile): number {
  const total = model.parametersB * GIGA;
  if (!model.moe) return total;
  const inactiveShare = 1 - model.moe.activeExperts / model.moe.experts;
  return total - expertParameters(model) * inactiveShare;
}

/**
 * Expected share of each layer's experts touched by `tokens` tokens in one
 * step, assuming every token picks its experts uniformly and independently.
 * Real routers are skewed, which touches fewer experts at mid-size batches;
 * the uniform assumption is stated wherever this number is shown.
 */
export function expertsTouchedFraction(model: ModelProfile, tokens: number): number {
  if (!model.moe) return 1;
  const miss = 1 - model.moe.activeExperts / model.moe.experts;
  return 1 - Math.pow(miss, Math.max(0, tokens));
}

/** Weight bytes that must be read from memory for one step over `tokens` tokens. */
export function weightReadBytes(model: ModelProfile, tokens: number): number {
  const bytesPerParameter = model.weightBits / 8;
  const untouched = expertParameters(model) * (1 - expertsTouchedFraction(model, tokens));
  return (model.parametersB * GIGA - untouched) * bytesPerParameter;
}
