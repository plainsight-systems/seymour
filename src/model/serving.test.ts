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

describe('8-bit matrix math', () => {
  const hardware = getHardware('h100-sxm');
  const w8 = { ...DEFAULT_MODEL, weightBits: 8 };

  it('doubles the math ceiling for prompt work when weights are 8-bit', () => {
    const base = { ...DEFAULT_SETTINGS, phase: 'prefill' as const, sequenceLength: 4096 };
    const fp16 = calculateSimulation({ ...base, mathBits: 16 }, hardware, w8);
    const fp8 = calculateSimulation({ ...base, mathBits: 8 }, hardware, w8);
    expect(fp16.bottleneck).toBe('compute');
    expect(fp16.computeMs / fp8.computeMs).toBeCloseTo(hardware.fp8DenseTflops / hardware.fp16DenseTflops, 6);
  });

  it('barely changes a memory-bound decode step', () => {
    const base = { ...DEFAULT_SETTINGS, batch: 1 };
    const fp16 = calculateSimulation({ ...base, mathBits: 16 }, hardware, w8);
    const fp8 = calculateSimulation({ ...base, mathBits: 8 }, hardware, w8);
    expect(fp8.totalMs).toBe(fp16.totalMs);
  });

  it('stays in FP16 when weights are 16-bit', () => {
    const base = { ...DEFAULT_SETTINGS, phase: 'prefill' as const };
    expect(calculateSimulation({ ...base, mathBits: 8 }, hardware, DEFAULT_MODEL).computeMs)
      .toBe(calculateSimulation({ ...base, mathBits: 16 }, hardware, DEFAULT_MODEL).computeMs);
  });
});

describe('response timing', () => {
  it('prices a long answer at its midpoint context and adds it to the first token', async () => {
    const { responseTiming } = await import('./calculate');
    const hardware = getHardware('h100-sxm');
    const settings = { ...DEFAULT_SETTINGS, batch: 8, sequenceLength: 4096, outputLength: 2048 };
    const timing = responseTiming(settings, hardware, DEFAULT_MODEL);
    const prefill = calculateSimulation({ ...settings, phase: 'prefill' }, hardware, DEFAULT_MODEL);
    const mid = calculateSimulation({ ...settings, sequenceLength: 4096 + 1024 }, hardware, DEFAULT_MODEL);
    expect(timing.firstTokenMs).toBe(prefill.totalMs);
    expect(timing.fullAnswerMs).toBeCloseTo(prefill.totalMs + 2047 * mid.msPerToken, 9);
    expect(timing.gpuSecondsPer1kTokens).toBeCloseTo(1000 / mid.tokenRate, 12);
  });

  it('makes long answers dominate the response time', async () => {
    const { responseTiming } = await import('./calculate');
    const hardware = getHardware('h100-sxm');
    const short = responseTiming({ ...DEFAULT_SETTINGS, outputLength: 32 }, hardware, DEFAULT_MODEL);
    const long = responseTiming({ ...DEFAULT_SETTINGS, outputLength: 8192 }, hardware, DEFAULT_MODEL);
    expect(long.fullAnswerMs - long.firstTokenMs).toBeGreaterThan(10 * long.firstTokenMs);
    expect(short.fullAnswerMs).toBeLessThan(long.fullAnswerMs);
  });
});
