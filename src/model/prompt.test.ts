import { describe, expect, it } from 'vitest';
import { cachedPromptTokens, newPromptTokens } from './prompt';

describe('prompt reuse', () => {
  const prompt = { sequenceLength: 4096, reusePromptPrefixes: true, prefixCachePercent: 75 };

  it('splits a prompt into the reused prefix and the new tokens', () => {
    expect(cachedPromptTokens(prompt)).toBe(3072);
    expect(newPromptTokens(prompt)).toBe(1024);
  });

  it('reuses nothing when reuse is off, whatever the shared share', () => {
    expect(cachedPromptTokens({ ...prompt, reusePromptPrefixes: false })).toBe(0);
    expect(newPromptTokens({ ...prompt, reusePromptPrefixes: false })).toBe(4096);
  });

  it('never reuses more than the prompt, and reports a full hit as zero new tokens', () => {
    expect(cachedPromptTokens({ ...prompt, prefixCachePercent: 100 })).toBe(4096);
    expect(newPromptTokens({ ...prompt, prefixCachePercent: 100 })).toBe(0);
  });
});
