import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL, DEFAULT_SETTINGS, getHardware } from '../data/profiles';
import { calculateSimulation, decodeIterationCounts, restoreVsRecompute } from './calculate';

describe('calculateSimulation', () => {
  const hardware = getHardware('h100-sxm');
  const defaults = { ...DEFAULT_SETTINGS, hardwareId: hardware.id };

  it('shows single-batch decode as memory bound', () => {
    const result = calculateSimulation(
      { ...defaults, phase: 'decode', batch: 1, sequenceLength: 4096 },
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
      { ...defaults, phase: 'prefill', batch: 1, sequenceLength: 4096 },
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

  it('prices host reads with the one-direction PCIe Gen5 x16 ceiling', () => {
    const result = calculateSimulation(
      { ...defaults, phase: 'decode', batch: 256, sequenceLength: 32768 },
      hardware,
      DEFAULT_MODEL,
    );

    expect(hardware.hostLinkGBs).toBe(64);
    expect(result.hostMs).toBeCloseTo(result.hostTrafficBytes / 64e9 * 1000, 8);
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
    const disabled = calculateSimulation({ ...base, reusePromptPrefixes: false }, hardware, DEFAULT_MODEL);

    expect(enabled.totalMs).toBe(0);
    expect(disabled.flops).toBeGreaterThan(0);
    expect(disabled.totalMs).toBeGreaterThan(0);
  });

  it('prices repeated weight streams when chunked prefill needs multiple scheduler iterations', () => {
    const base = { ...defaults, phase: 'prefill' as const, batch: 1, sequenceLength: 4096, prefixCachePercent: 0 };
    const unchunked = calculateSimulation({ ...base, splitLongPrompts: false }, hardware, DEFAULT_MODEL);
    const chunked = calculateSimulation({ ...base, splitLongPrompts: true, promptTokensPerStep: 512 }, hardware, DEFAULT_MODEL);

    expect(chunked.prefillChunks).toBe(8);
    expect(chunked.prefillChunkTokens).toBe(512);
    expect(chunked.bytes).toBeGreaterThan(unchunked.bytes);
    expect(chunked.totalMs).toBeGreaterThanOrEqual(unchunked.totalMs);
  });

  it('uses the runtime HBM budget rather than claiming all physical HBM', () => {
    const base = { ...defaults, phase: 'decode' as const, batch: 80, sequenceLength: 4096 };
    const conservative = calculateSimulation({ ...base, servingMemoryFraction: 0.7 }, hardware, DEFAULT_MODEL);
    const generous = calculateSimulation({ ...base, servingMemoryFraction: 0.95 }, hardware, DEFAULT_MODEL);

    expect(conservative.hostTrafficBytes).toBeGreaterThan(0);
    expect(generous.hostTrafficBytes).toBe(0);
    expect(conservative.usableHbmCapacityBytes).toBeLessThan(generous.usableHbmCapacityBytes);
  });

  it('pins HBM placement to the pre-placement model outputs', () => {
    const scenarios = [
      { name: 'default', settings: { ...defaults } },
      { name: 'batch 64', settings: { ...defaults, batch: 64 } },
      { name: '32K context', settings: { ...defaults, sequenceLength: 32768 } },
    ].map(({ name, settings }) => {
      const result = calculateSimulation(settings, hardware, DEFAULT_MODEL);
      return {
        name,
        totalMs: result.totalMs,
        computeMs: result.computeMs,
        memoryMs: result.memoryMs,
        hbmTrafficBytes: result.hbmTrafficBytes,
        hostTrafficBytes: result.hostTrafficBytes,
        hbmUsedFraction: result.hbmUsedFraction,
      };
    });

    expect(scenarios).toMatchInlineSnapshot(`
      [
        {
          "computeMs": 0.03345580164086545,
          "hbmTrafficBytes": 16597001983.999998,
          "hbmUsedFraction": 0.23051209599999997,
          "hostTrafficBytes": 0,
          "memoryMs": 6.881012431177445,
          "name": "default",
          "totalMs": 6.881012431177445,
        },
        {
          "computeMs": 2.141171305015389,
          "hbmTrafficBytes": 50428126976,
          "hbmUsedFraction": 0.700274144,
          "hostTrafficBytes": 0,
          "memoryMs": 20.90718365505804,
          "name": "batch 64",
          "totalMs": 20.90718365505804,
        },
        {
          "computeMs": 0.0610774388975148,
          "hbmTrafficBytes": 20355098368,
          "hbmUsedFraction": 0.2827078791111111,
          "hostTrafficBytes": 0,
          "memoryMs": 8.439095509121062,
          "name": "32K context",
          "totalMs": 8.439095509121062,
        },
      ]
    `);
  });

  it('makes farther KV tiers slower and frees HBM capacity', () => {
    const base = { ...defaults, phase: 'decode' as const, batch: 64, sequenceLength: 4096 };
    const tiers = (['hbm', 'peer', 'host', 'ssd', 'object'] as const)
      .map((kvPlacement) => calculateSimulation({ ...base, kvPlacement }, hardware, DEFAULT_MODEL));

    expect(tiers.map((result) => result.totalMs)).toEqual([...tiers.map((result) => result.totalMs)].sort((a, b) => a - b));
    expect(tiers[1]!.hbmUsedFraction).toBeLessThan(tiers[0]!.hbmUsedFraction);
    expect(tiers.slice(1).every((result) => result.bottleneck === 'placement')).toBe(true);
  });

  it('computes restore versus recompute deterministically from the selected tier', () => {
    const settings = { ...defaults, sequenceLength: 32768 };
    const first = restoreVsRecompute(settings, hardware, DEFAULT_MODEL, 'host');
    const second = restoreVsRecompute(settings, hardware, DEFAULT_MODEL, 'host');
    const object = restoreVsRecompute(settings, hardware, DEFAULT_MODEL, 'object');

    expect(first).toEqual(second);
    expect(first.cheaper).toBe('restore');
    expect(object).toMatchInlineSnapshot(`
      {
        "cheaper": "restore",
        "recomputeMs": 1484.1979818002626,
        "restoreMs": 493.59738368,
      }
    `);
  });
});

describe('decodeIterationCounts', () => {
  it('counts the first token once and repeats only the remaining decode iterations', () => {
    expect(decodeIterationCounts(32)).toEqual({ firstToken: 1, repeated: 31, total: 32 });
    expect(decodeIterationCounts(1)).toEqual({ firstToken: 1, repeated: 0, total: 1 });
  });
});
