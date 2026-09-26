import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL, getHardware } from '../data/profiles';
import type { SimulationSettings } from '../types';
import { buildAlgorithmSteps } from './algorithm';
import { calculateSimulation } from './calculate';
import { buildKernelPlan } from './kernels';
import { buildTeachingGuide } from './teaching';

function guidesFor(settings: SimulationSettings) {
  const hardware = getHardware(settings.hardwareId);
  const result = calculateSimulation(settings, hardware, DEFAULT_MODEL);
  return buildAlgorithmSteps(settings, DEFAULT_MODEL).map((step) => {
    const plan = buildKernelPlan(step, settings, hardware, DEFAULT_MODEL, result);
    return { step, plan, guide: buildTeachingGuide(step, settings, hardware, plan) };
  });
}

describe('buildTeachingGuide', () => {
  const settings: SimulationSettings = {
    phase: 'decode',
    hardwareId: 'h100-sxm',
    batch: 8,
    sequenceLength: 32768,
    weightBits: 16,
    kvBits: 16,
    attentionKernel: 'fused',
    overlap: false,
    view: 'hardware',
  };

  it('provides concrete performance and optimization teaching for every operation', () => {
    for (const { step, guide } of guidesFor(settings)) {
      expect(guide.pathTitle).toContain(step.label);
      expect(guide.pathSummary).toContain('HBM boundary');
      expect(guide.performanceCopy.length).toBeGreaterThan(120);
      expect(guide.optimizations.length).toBeGreaterThanOrEqual(2);
      expect(guide.optimizations.every((note) => note.effect && note.tradeoff)).toBe(true);
      expect(guide.terms.length).toBeGreaterThan(0);
    }
  });

  it('distinguishes weight, KV, activation, and control traffic by operation', () => {
    const guides = guidesFor(settings);
    const qkv = guides.find(({ step }) => step.id === 'qkv')!.guide;
    const cache = guides.find(({ step }) => step.id === 'kv-cache')!.guide;
    const sample = guides.find(({ step }) => step.id === 'sample')!.guide;

    expect(qkv.dataKinds).toEqual(expect.arrayContaining(['control', 'weights', 'activations']));
    expect(cache.dataKinds).toEqual(expect.arrayContaining(['control', 'kv']));
    expect(sample.dataKinds).toContain('control');
  });

  it('names serving techniques where they affect the work', () => {
    const guides = guidesFor(settings);
    const qkv = guides.find(({ step }) => step.id === 'qkv')!.guide;
    const attention = guides.find(({ step }) => step.id === 'qk')!.guide;

    expect(qkv.optimizations.some((note) => note.title === 'Continuous batching')).toBe(true);
    expect(attention.optimizations.some((note) => note.title.includes('FlashAttention'))).toBe(true);
    expect(attention.optimizations.some((note) => note.title === 'Paged attention')).toBe(true);
  });
});
