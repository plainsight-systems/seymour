import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL, getHardware } from '../data/profiles';
import { calculateSimulation } from './calculate';

describe('calculateSimulation', () => {
  const hardware = getHardware('h100-sxm');

  it('shows single-batch decode as memory bound', () => {
    const result = calculateSimulation(
      { phase: 'decode', hardwareId: hardware.id, batch: 1, sequenceLength: 4096, overlap: true, view: 'story' },
      hardware,
      DEFAULT_MODEL,
    );

    expect(result.bottleneck).toBe('memory');
    expect(result.weightBytes).toBeCloseTo(16.06e9, -6);
    expect(result.kvBytesPerToken).toBe(131072);
    expect(result.arithmeticIntensity).toBeLessThan(result.ridgePoint);
  });

  it('moves prefill into the compute-bound regime', () => {
    const result = calculateSimulation(
      { phase: 'prefill', hardwareId: hardware.id, batch: 1, sequenceLength: 4096, overlap: true, view: 'story' },
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
      overlap: true,
      view: 'story' as const,
    };
    const h100 = calculateSimulation(settings, hardware, DEFAULT_MODEL);
    const mi300x = calculateSimulation(settings, getHardware('mi300x'), DEFAULT_MODEL);

    expect(mi300x.memoryMs).toBeLessThan(h100.memoryMs);
  });

  it('routes spilled KV traffic over the host link', () => {
    const result = calculateSimulation(
      { phase: 'decode', hardwareId: hardware.id, batch: 256, sequenceLength: 32768, overlap: true, view: 'hardware' },
      hardware,
      DEFAULT_MODEL,
    );

    expect(result.hbmUsedFraction).toBeGreaterThan(1);
    expect(result.spilledKvBytes).toBeGreaterThan(0);
    expect(result.hostTrafficBytes).toBeGreaterThan(0);
    expect(result.hostMs).toBeGreaterThan(0);
    expect(result.bottleneck).toBe('host');
  });
});
