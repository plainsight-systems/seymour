import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL, DEFAULT_SETTINGS, getHardware } from '../data/profiles';
import { calculateSimulation } from './calculate';

describe('calculateSimulation', () => {
  const hardware = getHardware('h100-sxm');
  const defaults = { ...DEFAULT_SETTINGS, hardwareId: hardware.id };

  it('shows single-batch decode as memory bound', () => {
    const result = calculateSimulation(
      { ...defaults, phase: 'decode', batch: 1, sequenceLength: 4096, view: 'story' },
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
      { ...defaults, phase: 'decode', batch: 512, sequenceLength: 128 },
      hardware,
      DEFAULT_MODEL,
    );

    expect(result.crossoverBatch).toBe(512);
    expect(result.bottleneck).toBe('compute');
    expect(result.arithmeticIntensity).toBeGreaterThan(result.ridgePoint);
  });

  it('moves prefill into the compute-bound regime', () => {
    const result = calculateSimulation(
      { ...defaults, phase: 'prefill', batch: 1, sequenceLength: 4096, view: 'story' },
      hardware,
      DEFAULT_MODEL,
    );

    expect(result.bottleneck).toBe('compute');
    expect(result.arithmeticIntensity).toBeGreaterThan(result.ridgePoint);
  });

  it('reduces memory time with faster HBM', () => {
    const settings = {
      ...defaults,
      phase: 'decode' as const,
      hardwareId: hardware.id,
      batch: 1,
      sequenceLength: 4096,
      prefixCachePercent: 0,
      outputLength: 32,
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
      { ...defaults, phase: 'decode', batch: 256, sequenceLength: 32768 },
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
    const base = { ...defaults, phase: 'decode' as const, batch: 8, sequenceLength: 4096 };
    const fp16 = calculateSimulation(base, hardware, DEFAULT_MODEL);
    const quantizedModel = { ...DEFAULT_MODEL, weightBits: 4, kvBits: 8 };
    const compact = calculateSimulation({ ...base, weightBits: 4, kvBits: 8 }, hardware, quantizedModel);
    const separate = calculateSimulation({ ...base, attentionKernel: 'separate' }, hardware, DEFAULT_MODEL);

    expect(compact.flops).toBe(fp16.flops);
    expect(compact.bytes).toBeLessThan(fp16.bytes);
    expect(separate.bytes).toBeGreaterThan(fp16.bytes);
  });

  it('reduces prefill work to the uncached prompt suffix', () => {
    const base = { ...defaults, phase: 'prefill' as const, batch: 1, sequenceLength: 4096, prefixCachePercent: 0 };
    const miss = calculateSimulation(base, hardware, DEFAULT_MODEL);
    const partialHit = calculateSimulation({ ...base, prefixCachePercent: 75 }, hardware, DEFAULT_MODEL);
    const fullHit = calculateSimulation({ ...base, prefixCachePercent: 100 }, hardware, DEFAULT_MODEL);

    expect(partialHit.flops).toBeLessThan(miss.flops);
    expect(partialHit.totalMs).toBeLessThan(miss.totalMs);
    expect(fullHit.flops).toBe(0);
    expect(fullHit.totalMs).toBe(0);
  });

  it('ignores reusable-prefix percentage when automatic prefix caching is disabled', () => {
    const base = { ...defaults, phase: 'prefill' as const, sequenceLength: 4096, prefixCachePercent: 100 };
    const enabled = calculateSimulation(base, hardware, DEFAULT_MODEL);
    const disabled = calculateSimulation({ ...base, prefixCaching: false }, hardware, DEFAULT_MODEL);

    expect(enabled.totalMs).toBe(0);
    expect(disabled.flops).toBeGreaterThan(0);
    expect(disabled.totalMs).toBeGreaterThan(0);
  });

  it('prices repeated weight streams when chunked prefill needs multiple scheduler iterations', () => {
    const base = { ...defaults, phase: 'prefill' as const, batch: 1, sequenceLength: 4096, prefixCachePercent: 0 };
    const unchunked = calculateSimulation({ ...base, chunkedPrefill: false }, hardware, DEFAULT_MODEL);
    const chunked = calculateSimulation({ ...base, chunkedPrefill: true, maxNumBatchedTokens: 512 }, hardware, DEFAULT_MODEL);

    expect(chunked.prefillChunks).toBe(8);
    expect(chunked.prefillChunkTokens).toBe(512);
    expect(chunked.bytes).toBeGreaterThan(unchunked.bytes);
    expect(chunked.totalMs).toBeGreaterThanOrEqual(unchunked.totalMs);
  });

  it('uses the runtime HBM budget rather than claiming all physical HBM', () => {
    const base = { ...defaults, phase: 'decode' as const, batch: 80, sequenceLength: 4096 };
    const conservative = calculateSimulation({ ...base, gpuMemoryUtilization: 0.7 }, hardware, DEFAULT_MODEL);
    const generous = calculateSimulation({ ...base, gpuMemoryUtilization: 0.95 }, hardware, DEFAULT_MODEL);

    expect(conservative.hostTrafficBytes).toBeGreaterThan(0);
    expect(generous.hostTrafficBytes).toBe(0);
    expect(conservative.usableHbmCapacityBytes).toBeLessThan(generous.usableHbmCapacityBytes);
  });
});
