import { describe, expect, it } from 'vitest';
import { gradeFor } from './scoring';

describe('game grades', () => {
  it('lets a correct but unhurried shift earn A while misses cap the grade at B', () => {
    expect(gradeFor(950, 1_000)).toBe('A');
    expect(gradeFor(949, 1_000)).toBe('B');
    expect(gradeFor(1_000, 1_000, 1)).toBe('B');
    expect(gradeFor(1_200, 1_000, 2)).toBe('C');
  });

  it('makes S reachable at 1.08× while reserving it for a clean, fuse-safe shift', () => {
    expect(gradeFor(1_080, 1_000)).toBe('S');
    expect(gradeFor(1_079, 1_000)).toBe('A');
    expect(gradeFor(1_080, 1_000, 0, 2)).toBe('A');
  });
});
