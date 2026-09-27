import { describe, expect, it } from 'vitest';

const banned = ['vLLM', 'SGLang', 'TensorRT', 'llama.cpp', 'max_num', 'gpu_memory_utilization', 'PagedAttention', 'continuous batching', 'chunked prefill', 'WGMMA', 'MFMA', 'SM90'];

describe('story copy', () => {
  it('keeps framework and kernel product names out of the guided story', () => {
    const modules = import.meta.glob('./**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    const source = Object.entries(modules)
      .filter(([path]) => !path.endsWith('.test.ts'))
      .map(([, contents]) => contents)
      .join('\n');
    for (const term of banned) expect(source).not.toContain(term);
  });
});
