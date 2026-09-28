import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL, DEFAULT_SETTINGS, getHardware } from '../data/profiles';
import { buildAlgorithmSteps } from './algorithm';
import { meanAttendedKeys } from './attention';
import { calculateSimulation } from './calculate';
import type { SimulationSettings } from '../types';

const fused: SimulationSettings = { ...DEFAULT_SETTINGS, attentionKernel: 'fused' as const, splitLongPrompts: false, reusePromptPrefixes: false, prefixCachePercent: 0, batch: 2, sequenceLength: 4096 };
const separate: SimulationSettings = { ...fused, attentionKernel: 'separate' };

describe('causal attention', () => {
  it('scores a prompt token only against itself and earlier tokens when the kernel skips masked blocks', () => {
    expect(meanAttendedKeys({ phase: 'prefill', attentionKernel: 'fused' }, 4096, 0)).toBe(2048.5);
    expect(meanAttendedKeys({ phase: 'prefill', attentionKernel: 'fused' }, 4096, 1024)).toBe(1024 + 3073 / 2);
  });

  it('computes the full grid with separate kernels, and the whole context when decoding', () => {
    expect(meanAttendedKeys({ phase: 'prefill', attentionKernel: 'separate' }, 4096, 0)).toBe(4096);
    expect(meanAttendedKeys({ phase: 'decode', attentionKernel: 'fused' }, 4096, 0)).toBe(4096);
  });

  it('prices prompt QKᵀ at about half the full grid, and leaves decode unchanged', () => {
    const qk = (settings: SimulationSettings) => buildAlgorithmSteps(settings, DEFAULT_MODEL).find((step) => step.id === 'qk')!.flops;
    const prompt = { ...fused, phase: 'prefill' as const };
    const token = { ...fused, phase: 'decode' as const };
    expect(qk(prompt) / qk({ ...prompt, attentionKernel: 'separate' })).toBeCloseTo(2048.5 / 4096, 10);
    expect(qk(prompt) / qk(token)).toBeCloseTo(2048.5, 6);
    expect(qk(token)).toBe(qk({ ...token, attentionKernel: 'separate' }));
  });

  it('removes exactly the masked half from the whole-step prompt FLOPs', () => {
    const hardware = getHardware('h100-sxm');
    const prompt = { ...fused, phase: 'prefill' as const };
    const masked = calculateSimulation({ ...separate, phase: 'prefill' }, hardware, DEFAULT_MODEL).flops - calculateSimulation(prompt, hardware, DEFAULT_MODEL).flops;
    const width = DEFAULT_MODEL.attentionHeads * DEFAULT_MODEL.headDim;
    expect(masked).toBeCloseTo(prompt.batch * 4 * DEFAULT_MODEL.layers * width * 4096 * (4096 - 2048.5), -3);
    const token = { ...fused, phase: 'decode' as const };
    expect(calculateSimulation(token, hardware, DEFAULT_MODEL).flops).toBe(calculateSimulation({ ...token, attentionKernel: 'separate' }, hardware, DEFAULT_MODEL).flops);
  });
});
