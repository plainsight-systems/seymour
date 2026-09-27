import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL, DEFAULT_SETTINGS, getHardware } from '../data/profiles';
import type { SimulationSettings } from '../types';
import { buildAlgorithmSteps } from './algorithm';
import { calculateSimulation } from './calculate';
import { buildKernelPlan } from './kernels';

function scenario(hardwareId: string, overrides: Partial<SimulationSettings> = {}) {
  const settings: SimulationSettings = {
    ...DEFAULT_SETTINGS,
    phase: 'decode', hardwareId, batch: 128, sequenceLength: 4096,
    prefixCachePercent: 0, outputLength: 32,
    weightBits: 16, kvBits: 16, attentionKernel: 'fused',
    overlap: true, view: 'hardware', ...overrides,
  };
  const hardware = getHardware(hardwareId);
  const result = calculateSimulation(settings, hardware, DEFAULT_MODEL);
  return { settings, hardware, result, steps: buildAlgorithmSteps(settings, DEFAULT_MODEL) };
}

describe('buildKernelPlan', () => {
  it('maps every algorithm operation to a bounded reference schedule', () => {
    const { settings, hardware, result, steps } = scenario('mi300x');
    for (const step of steps) {
      const plan = buildKernelPlan(step, settings, hardware, DEFAULT_MODEL, result);
      expect(plan.groups).toBeGreaterThan(0);
      expect(plan.estimatedActiveUnitFraction).toBeGreaterThan(0);
      expect(plan.estimatedActiveUnitFraction).toBeLessThanOrEqual(1);
      expect(plan.totalMs).toBeGreaterThanOrEqual(0.005);
      expect(plan.phases.every((phase) => phase.startMs + phase.durationMs <= plan.totalMs + 1e-12)).toBe(true);
      expect(plan.assumptions.length).toBeGreaterThan(0);
    }
  });

  it('shows wider batches activating more compute units for skinny decode GEMMs', () => {
    const small = scenario('h100-sxm', { batch: 1 });
    const wide = scenario('h100-sxm', { batch: 256 });
    const smallStep = small.steps.find((step) => step.id === 'qkv')!;
    const wideStep = wide.steps.find((step) => step.id === 'qkv')!;
    const smallPlan = buildKernelPlan(smallStep, small.settings, small.hardware, DEFAULT_MODEL, small.result);
    const widePlan = buildKernelPlan(wideStep, wide.settings, wide.hardware, DEFAULT_MODEL, wide.result);

    expect(widePlan.groups).toBeGreaterThan(smallPlan.groups);
    expect(widePlan.estimatedActiveUnitFraction).toBeGreaterThan(smallPlan.estimatedActiveUnitFraction);
  });

  it('uses vendor-specific cooperative lane groups and instructions', () => {
    const amd = scenario('mi300x');
    const amdQkv = amd.steps.find((step) => step.id === 'qkv')!;
    const amdPlan = buildKernelPlan(amdQkv, amd.settings, amd.hardware, DEFAULT_MODEL, amd.result);
    expect(amdPlan.cooperativeLanes).toBe(64);
    expect(amdPlan.instruction).toContain('mfma');

    const nvidia = scenario('h100-sxm');
    const nvidiaQkv = nvidia.steps.find((step) => step.id === 'qkv')!;
    const nvidiaPlan = buildKernelPlan(nvidiaQkv, nvidia.settings, nvidia.hardware, DEFAULT_MODEL, nvidia.result);
    expect(nvidiaPlan.cooperativeLanes).toBe(128);
    expect(nvidiaPlan.instruction).toContain('wgmma');
  });

  it('shows host transfer only when the working set spills', () => {
    const resident = scenario('h100-sxm', { batch: 1 });
    const residentStep = resident.steps.find((step) => step.id === 'kv-cache')!;
    expect(buildKernelPlan(residentStep, resident.settings, resident.hardware, DEFAULT_MODEL, resident.result).hostBytes).toBe(0);

    const spilled = scenario('h100-sxm', { batch: 256, sequenceLength: 32768 });
    const spilledQkv = spilled.steps.find((step) => step.id === 'qkv')!;
    expect(buildKernelPlan(spilledQkv, spilled.settings, spilled.hardware, DEFAULT_MODEL, spilled.result).hostBytes).toBe(0);
    const spilledStep = spilled.steps.find((step) => step.id === 'kv-cache')!;
    const plan = buildKernelPlan(spilledStep, spilled.settings, spilled.hardware, DEFAULT_MODEL, spilled.result);
    expect(plan.hostBytes).toBeGreaterThan(0);
    expect(plan.phases.some((phase) => phase.kind === 'host-transfer')).toBe(true);
  });

  it('does not charge a fused softmax score matrix to HBM', () => {
    const prefill = scenario('mi300x', { phase: 'prefill', batch: 1, sequenceLength: 4096 });
    const softmax = prefill.steps.find((step) => step.id === 'softmax')!;
    const plan = buildKernelPlan(softmax, prefill.settings, prefill.hardware, DEFAULT_MODEL, prefill.result);
    expect(softmax.activationBytes).toBeGreaterThan(0);
    expect(softmax.boundaryBytes).toBe(0);
    expect(plan.hbmBytes).toBe(0);
  });

  it('shows separate attention as distinct kernels with materialized HBM traffic', () => {
    const separate = scenario('h100-sxm', { attentionKernel: 'separate' });
    const softmax = separate.steps.find((step) => step.id === 'softmax')!;
    const plan = buildKernelPlan(softmax, separate.settings, separate.hardware, DEFAULT_MODEL, separate.result);
    expect(plan.kernelId).toBe('softmax');
    expect(plan.qualifier).toContain('separate attention stage');
    expect(plan.hbmBytes).toBeGreaterThan(0);
  });
});
