import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL, DEFAULT_SETTINGS, getHardware } from '../../data/profiles';
import { calculateSimulation } from '../../model/calculate';
import { applySoftwareStrategy } from '../../model/strategy';
import { buildPictureModel } from './model';

describe('buildPictureModel', () => {
  it('derives every layer from simulation output', () => {
    const settings = { ...DEFAULT_SETTINGS, batch: 64 };
    const hardware = getHardware(settings.hardwareId);
    const model = applySoftwareStrategy(DEFAULT_MODEL, settings);
    const result = calculateSimulation(settings, hardware, model);
    const picture = buildPictureModel(result, settings, hardware, model);

    expect(picture.steps.map((step) => step.id)).toEqual(['prefill', 'decode']);
    expect(picture.modelBytes).toBe(result.weightBytes);
    expect(picture.kvBytes).toBe(result.kvFootprintBytes);
    expect(picture.totalTokensPerSecond).toBe(result.tokenRate);
    expect(picture.ladder).toHaveLength(8);
    expect(picture.bottleneckSentence.length).toBeGreaterThan(40);
  });
});
