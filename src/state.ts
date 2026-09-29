// Slider scales: each range control moves through a fixed list of values,
// and these map between a slider position and its value.

export const BATCHES = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024];
export const SEQUENCES = [128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768];
export const PREFIX_CACHE_PERCENTAGES = [0, 25, 50, 75, 90, 100];

export function prefixCacheFromSlider(value: number): number {
  return PREFIX_CACHE_PERCENTAGES[Math.max(0, Math.min(PREFIX_CACHE_PERCENTAGES.length - 1, value))]!;
}

export function prefixCacheToSlider(percent: number): number {
  return nearestIndex(PREFIX_CACHE_PERCENTAGES, percent);
}

export function batchFromSlider(value: number): number {
  return BATCHES[Math.max(0, Math.min(BATCHES.length - 1, value))]!;
}

export function batchToSlider(batch: number): number {
  return nearestIndex(BATCHES, batch);
}

export function sequenceFromSlider(value: number): number {
  return SEQUENCES[Math.max(0, Math.min(SEQUENCES.length - 1, value))]!;
}

export function sequenceToSlider(sequence: number): number {
  return nearestIndex(SEQUENCES, sequence);
}

/** The position of the step nearest to a value (the first on a tie). */
export function nearestIndex(choices: readonly number[], value: number): number {
  let best = 0;
  choices.forEach((choice, index) => { if (Math.abs(choice - value) < Math.abs(choices[best]! - value)) best = index; });
  return best;
}
