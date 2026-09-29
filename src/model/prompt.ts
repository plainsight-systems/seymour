import type { SimulationSettings } from '../types';

// How much of a prompt the first pass must still process. One definition,
// so the whole-step model, the per-operation breakdown, the forward pass,
// and the panels' words all agree.

/** Prompt tokens already processed for an earlier request (0 when reuse is off). */
export function cachedPromptTokens(settings: Pick<SimulationSettings, 'sequenceLength' | 'reusePromptPrefixes' | 'prefixCachePercent'>): number {
  if (!settings.reusePromptPrefixes) return 0;
  return Math.min(settings.sequenceLength, Math.round(settings.sequenceLength * settings.prefixCachePercent / 100));
}

/**
 * Prompt tokens this request still runs through the first pass: 0 on a full
 * hit. Callers that model a pass that must run anyway keep at least one.
 */
export function newPromptTokens(settings: Pick<SimulationSettings, 'sequenceLength' | 'reusePromptPrefixes' | 'prefixCachePercent'>): number {
  return settings.sequenceLength - cachedPromptTokens(settings);
}
