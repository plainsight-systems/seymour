import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL, DEFAULT_SETTINGS } from '../data/profiles';
import { buildAlgorithmSteps } from './algorithm';

describe('buildAlgorithmSteps', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    phase: 'decode' as const,
    hardwareId: 'h100-sxm',
    batch: 4,
    sequenceLength: 4096,
    prefixCachePercent: 0,
    outputLength: 32,
    weightBits: 16 as const,
    kvBits: 16 as const,
    attentionKernel: 'fused' as const,
    overlap: true,
  };

  it('exposes explicit attention and sampling operations', () => {
    const steps = buildAlgorithmSteps(settings, DEFAULT_MODEL);
    expect(steps.map((step) => step.id)).toEqual([
      'rms-attn', 'qkv', 'rope', 'kv-cache', 'qk', 'softmax',
      'pv', 'o-proj', 'rms-mlp', 'swiglu', 'logits', 'sample',
    ]);
    expect(steps.find((step) => step.id === 'qkv')?.equation).toContain('WQ');
    expect(steps.find((step) => step.id === 'sample')?.equation).toContain('top-k');
  });

  it('uses one decode query against the full cached context', () => {
    const steps = buildAlgorithmSteps(settings, DEFAULT_MODEL);
    expect(steps.find((step) => step.id === 'qk')?.outputShape).toContain('1, 4,096');
    expect(steps.find((step) => step.id === 'kv-cache')?.activationBytes).toBe(
      2 * settings.batch * settings.sequenceLength * DEFAULT_MODEL.kvHeads * DEFAULT_MODEL.headDim * 2,
    );
  });

  it('materializes attention scores only for the separate schedule', () => {
    const fused = buildAlgorithmSteps(settings, DEFAULT_MODEL);
    const separate = buildAlgorithmSteps({ ...settings, attentionKernel: 'separate' }, DEFAULT_MODEL);
    expect(fused.find((step) => step.id === 'softmax')?.boundaryBytes).toBe(0);
    expect(separate.find((step) => step.id === 'softmax')?.boundaryBytes).toBeGreaterThan(0);
    expect(separate.find((step) => step.id === 'qk')!.boundaryBytes).toBeGreaterThan(
      fused.find((step) => step.id === 'qk')!.boundaryBytes,
    );
  });
});
