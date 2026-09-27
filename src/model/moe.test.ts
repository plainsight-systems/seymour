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

describe('speculative decoding', () => {
  const hardware = getHardware('h100-sxm');
  const base = { ...DEFAULT_SETTINGS, batch: 1, sequenceLength: 2048 };

  it('expects 1 token without speculation and more with it', async () => {
    const { expectedAcceptedTokens } = await import('./calculate');
    expect(expectedAcceptedTokens(0, 0.7)).toBe(1);
    expect(expectedAcceptedTokens(4, 0.7)).toBeCloseTo((1 - 0.7 ** 5) / 0.3, 12);
    expect(expectedAcceptedTokens(4, 1)).toBe(5);
  });

  it('turns one weight read into several tokens for a single user', () => {
    const off = calculateSimulation(base, hardware, DEFAULT_MODEL);
    const on = calculateSimulation({ ...base, speculativeTokens: 4 }, hardware, DEFAULT_MODEL);
    expect(on.weightReadBytes).toBe(off.weightReadBytes);
    expect(on.tokensPerStep).toBeGreaterThan(2.7);
    expect(on.msPerToken).toBeLessThan(off.msPerToken / 2);
    expect(on.flops).toBeCloseTo(off.flops * 5, 0);
  });

  it('touches more experts when verifying guesses on an MoE model', () => {
    const off = calculateSimulation(base, hardware, qwen);
    const on = calculateSimulation({ ...base, speculativeTokens: 4 }, hardware, qwen);
    expect(on.expertsTouchedFraction).toBeGreaterThan(off.expertsTouchedFraction);
    expect(on.weightReadBytes).toBeGreaterThan(off.weightReadBytes);
  });

  it('stops paying off once the step is limited by math', () => {
    const busy = { ...DEFAULT_SETTINGS, batch: 512, sequenceLength: 512 };
    const off = calculateSimulation(busy, hardware, DEFAULT_MODEL);
    const on = calculateSimulation({ ...busy, speculativeTokens: 4 }, hardware, DEFAULT_MODEL);
    expect(on.bottleneck).toBe('compute');
    expect(on.msPerToken).toBeGreaterThan(off.msPerToken);
  });

  it('pays far less on an MoE model at one user, because guesses touch more experts', () => {
    const gain = (model: typeof qwen) => {
      const off = calculateSimulation(base, hardware, model);
      const on = calculateSimulation({ ...base, speculativeTokens: 4 }, hardware, model);
      return off.msPerToken / on.msPerToken;
    };
    expect(gain(DEFAULT_MODEL)).toBeGreaterThan(2);
    expect(gain(qwen)).toBeLessThan(1.2);
  });
});
