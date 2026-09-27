import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL, DEFAULT_SETTINGS, getHardware, getModel } from '../data/profiles';
import { calculateSimulation } from './calculate';
import { activeParametersPerToken, expertParameters, expertsTouchedFraction, weightReadBytes } from './moe';

const qwen = getModel('qwen3-30b-a3b');

describe('mixture-of-experts arithmetic', () => {
  it('reproduces the published parameter total from the configuration', () => {
    const attention = qwen.layers * qwen.hiddenSize * (qwen.attentionHeads * qwen.headDim * 2 + qwen.kvHeads * qwen.headDim * 2);
    const router = qwen.layers * qwen.hiddenSize * qwen.moe!.experts;
    const embeddings = 2 * qwen.vocabSize * qwen.hiddenSize;
    const total = expertParameters(qwen) + attention + router + embeddings;
    expect(total / 1e9).toBeCloseTo(qwen.parametersB, 1);
  });

  it('activates roughly 3B parameters per token', () => {
    expect(activeParametersPerToken(qwen) / 1e9).toBeGreaterThan(2.9);
    expect(activeParametersPerToken(qwen) / 1e9).toBeLessThan(3.4);
  });

  it('touches more experts as more tokens share a step, approaching all of them', () => {
    expect(expertsTouchedFraction(qwen, 1)).toBeCloseTo(8 / 128, 12);
    expect(expertsTouchedFraction(qwen, 16)).toBeGreaterThan(0.6);
    expect(expertsTouchedFraction(qwen, 256)).toBeGreaterThan(0.99);
    expect(weightReadBytes(qwen, 1)).toBeLessThan(weightReadBytes(qwen, 64));
  });

  it('leaves dense models unchanged', () => {
    expect(expertsTouchedFraction(DEFAULT_MODEL, 1)).toBe(1);
    expect(weightReadBytes(DEFAULT_MODEL, 1)).toBe(DEFAULT_MODEL.parametersB * 1e9 * 2);
    expect(activeParametersPerToken(DEFAULT_MODEL)).toBe(DEFAULT_MODEL.parametersB * 1e9);
  });

  it('reads only touched experts in a decode step but stores all of them', () => {
    const hardware = getHardware('h100-sxm');
    const one = calculateSimulation({ ...DEFAULT_SETTINGS, batch: 1, sequenceLength: 2048 }, hardware, qwen);
    const many = calculateSimulation({ ...DEFAULT_SETTINGS, batch: 64, sequenceLength: 2048 }, hardware, qwen);
    expect(one.weightBytes).toBeCloseTo(qwen.parametersB * 2e9, -3);
    expect(one.weightReadBytes).toBeLessThan(one.weightBytes * 0.2);
    expect(many.weightReadBytes).toBeGreaterThan(one.weightBytes * 0.95);
    expect(one.expertsTouchedFraction).toBeCloseTo(8 / 128, 12);
  });

  it('fails loudly for an unknown model', () => {
    expect(() => getModel('nope')).toThrow(/Unknown model/);
  });
});
