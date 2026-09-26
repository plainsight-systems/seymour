import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL, getHardware } from '../data/profiles';
import { calculateSimulation } from './calculate';

describe('calculateSimulation', () => {
  const hardware = getHardware('h100-sxm');

  it('shows single-batch decode as memory bound', () => {
    const result = calculateSimulation(
      { phase: 'decode', hardwareId: hardware.id, batch: 1, sequenceLength: 4096, weightBits: 16, kvBits: 16, attentionKernel: 'fused', overlap: true, view: 'story' },
      hardware,
      DEFAULT_MODEL,
    );

    expect(result.bottleneck).toBe('memory');
    expect(result.weightBytes).toBeCloseTo(16.06e9, -6);
    expect(result.kvBytesPerToken).toBe(131072);
    expect(result.arithmeticIntensity).toBeLessThan(result.ridgePoint);
    expect(result.batchLimitArithmeticIntensity).toBeLessThan(result.ridgePoint);
    expect(result.crossoverBatch).toBeNull();
  });

  it('crosses into compute bound when a short-context decode amortizes weights', () => {
    const result = calculateSimulation(
      { phase: 'decode', hardwareId: hardware.id, batch: 512, sequenceLength: 128, weightBits: 16, kvBits: 16, attentionKernel: 'fused', overlap: true, view: 'hardware' },
      hardware,
      DEFAULT_MODEL,
    );

    expect(result.crossoverBatch).toBe(512);
    expect(result.bottleneck).toBe('compute');
    expect(result.arithmeticIntensity).toBeGreaterThan(result.ridgePoint);
  });

  it('moves prefill into the compute-bound regime', () => {
    const result = calculateSimulation(
      { phase: 'prefill', hardwareId: hardware.id, batch: 1, sequenceLength: 4096, weightBits: 16, kvBits: 16, attentionKernel: 'fused', overlap: true, view: 'story' },
      hardware,
      DEFAULT_MODEL,
    );

    expect(result.bottleneck).toBe('compute');
    expect(result.arithmeticIntensity).toBeGreaterThan(result.ridgePoint);
  });

  it('reduces memory time with faster HBM', () => {
    const settings = {
      phase: 'decode' as const,
      hardwareId: hardware.id,
      batch: 1,
      sequenceLength: 4096,
      weightBits: 16 as const,
      kvBits: 16 as const,
      attentionKernel: 'fused' as const,
      overlap: true,
      view: 'story' as const,
    };
    const h100 = calculateSimulation(settings, hardware, DEFAULT_MODEL);
    const mi300x = calculateSimulation(settings, getHardware('mi300x'), DEFAULT_MODEL);

    expect(mi300x.memoryMs).toBeLessThan(h100.memoryMs);
  });

  it('routes spilled KV traffic over the host link', () => {
    const result = calculateSimulation(
      { phase: 'decode', hardwareId: hardware.id, batch: 256, sequenceLength: 32768, weightBits: 16, kvBits: 16, attentionKernel: 'fused', overlap: true, view: 'hardware' },
      hardware,
      DEFAULT_MODEL,
    );

    expect(result.hbmUsedFraction).toBeGreaterThan(1);
    expect(result.spilledKvBytes).toBeGreaterThan(0);
    expect(result.hostTrafficBytes).toBeGreaterThan(0);
    expect(result.hostMs).toBeGreaterThan(0);
    expect(result.bottleneck).toBe('host');
  });

  it('shows byte-level software strategies changing memory pressure without changing FLOPs', () => {
    const base = { phase: 'decode' as const, hardwareId: hardware.id, batch: 8, sequenceLength: 4096, weightBits: 16 as const, kvBits: 16 as const, attentionKernel: 'fused' as const, overlap: true, view: 'hardware' as const };
    const fp16 = calculateSimulation(base, hardware, DEFAULT_MODEL);
    const quantizedModel = { ...DEFAULT_MODEL, weightBits: 4, kvBits: 8 };
    const compact = calculateSimulation({ ...base, weightBits: 4, kvBits: 8 }, hardware, quantizedModel);
    const separate = calculateSimulation({ ...base, attentionKernel: 'separate' }, hardware, DEFAULT_MODEL);

    expect(compact.flops).toBe(fp16.flops);
    expect(compact.bytes).toBeLessThan(fp16.bytes);
    expect(separate.bytes).toBeGreaterThan(fp16.bytes);
  });
});
