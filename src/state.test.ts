import { describe, expect, it } from 'vitest';
import { batchFromSlider, batchToSlider, prefixCacheFromSlider, prefixCacheToSlider, sequenceFromSlider, sequenceToSlider } from './state';

describe('slider scales', () => {
  it('round-trips every position', () => {
    for (let position = 0; position <= 10; position++) expect(batchToSlider(batchFromSlider(position))).toBe(position);
    for (let position = 0; position <= 8; position++) expect(sequenceToSlider(sequenceFromSlider(position))).toBe(position);
    for (let position = 0; position <= 5; position++) expect(prefixCacheToSlider(prefixCacheFromSlider(position))).toBe(position);
  });

  it('clamps positions past either end and snaps values to the nearest step', () => {
    expect(batchFromSlider(-3)).toBe(1);
    expect(batchFromSlider(99)).toBe(1024);
    expect(batchToSlider(48)).toBe(batchToSlider(32));
    expect(sequenceToSlider(5000)).toBe(sequenceToSlider(4096));
  });
});
