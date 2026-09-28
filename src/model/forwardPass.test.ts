import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL, DEFAULT_SETTINGS, getHardware, getModel } from '../data/profiles';
import { calculateSimulation } from './calculate';
import { buildForwardPass, embeddingTableBytes } from './forwardPass';

const hardware = getHardware('h100-sxm');
const decode = { ...DEFAULT_SETTINGS, phase: 'decode' as const, batch: 8, sequenceLength: 4096 };
const prefill = { ...decode, phase: 'prefill' as const };

describe('forward pass stages', () => {
  it('walks CPU, five GPU stages, and back to CPU, with attention and MLP per layer', () => {
    const stages = buildForwardPass(decode, DEFAULT_MODEL, hardware);
    expect(stages.map((stage) => stage.id)).toEqual(['tokenize', 'embed', 'attention', 'mlp', 'unembed', 'sample', 'detokenize']);
    expect(stages.map((stage) => stage.runsOn)).toEqual(['cpu', 'gpu', 'gpu', 'gpu', 'gpu', 'gpu', 'cpu']);
    expect(stages.find((stage) => stage.id === 'attention')!.repeats).toBe(DEFAULT_MODEL.layers);
    expect(stages.find((stage) => stage.id === 'mlp')!.repeats).toBe(DEFAULT_MODEL.layers);
  });

  it('reads every weight once per decode step except the embedding table, which is only indexed', () => {
    const stages = buildForwardPass(decode, DEFAULT_MODEL, hardware);
    const read = ['attention', 'mlp', 'unembed'].reduce((total, id) => total + stages.find((stage) => stage.id === id)!.weightBytes, 0);
    const expected = DEFAULT_MODEL.parametersB * 1e9 * 2 - embeddingTableBytes(DEFAULT_MODEL);
    expect(read / expected).toBeGreaterThan(0.99);
    expect(read / expected).toBeLessThan(1.01);
  });

  it('puts the KV cache traffic in attention and matches the whole-step model', () => {
    const stages = buildForwardPass(decode, DEFAULT_MODEL, hardware);
    const attention = stages.find((stage) => stage.id === 'attention')!;
    const whole = calculateSimulation(decode, hardware, DEFAULT_MODEL);
    expect(attention.kvBytes / whole.kvFootprintBytes).toBeGreaterThan(0.99);
    expect(stages.filter((stage) => stage.id !== 'attention').every((stage) => stage.kvBytes === 0)).toBe(true);
  });

  it('puts most weight bytes in the MLP and makes decode memory-bound, prompt work math-bound', () => {
    const d = buildForwardPass(decode, DEFAULT_MODEL, hardware);
    const p = buildForwardPass(prefill, DEFAULT_MODEL, hardware);
    const mlp = d.find((stage) => stage.id === 'mlp')!;
    const attention = d.find((stage) => stage.id === 'attention')!;
    expect(mlp.weightBytes / (mlp.weightBytes + attention.weightBytes)).toBeGreaterThan(0.75);
    expect(mlp.limit).toBe('memory');
    expect(p.find((stage) => stage.id === 'mlp')!.limit).toBe('math');
  });

  it('differs from the whole-step FLOP count only where that model is deliberately coarse', () => {
    // The whole-step model charges 2 FLOPs per parameter for every weight and
    // every token, including the embedding table (a lookup, no math) and the
    // vocabulary projection for every prompt token (serving needs only the
    // last one). The stage walk counts neither; nothing else may differ.
    const table = embeddingTableBytes(DEFAULT_MODEL) / 2;
    for (const settings of [decode, prefill]) {
      const stages = buildForwardPass(settings, DEFAULT_MODEL, hardware);
      const flops = stages.reduce((total, stage) => total + stage.flops, 0);
      const whole = calculateSimulation({ ...settings, splitLongPrompts: false }, hardware, DEFAULT_MODEL);
      const tokens = settings.batch * (settings.phase === 'prefill' ? settings.sequenceLength : 1);
      const skippedHeads = settings.phase === 'prefill' ? settings.batch * (settings.sequenceLength - 1) : 0;
      const explained = whole.flops - 2 * table * tokens - 2 * table * skippedHeads;
      expect(flops / explained).toBeGreaterThan(0.99);
      expect(flops / explained).toBeLessThan(1.01);
    }
  });

  it('refuses MoE models instead of mislabeling them', () => {
    expect(() => buildForwardPass(decode, getModel('qwen3-30b-a3b'), hardware)).toThrow(/dense/);
  });
});
