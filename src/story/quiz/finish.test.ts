import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { finishSchedule } from './quiz';

describe('finish schedule', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('runs each timer once and reports when none are pending', () => {
    const schedule = finishSchedule();
    const runs: string[] = [];
    schedule.after(100, () => runs.push('card'));
    schedule.after(200, () => runs.push('count'));
    expect(schedule.pending()).toBe(true);
    vi.advanceTimersByTime(150);
    expect(runs).toEqual(['card']);
    expect(schedule.pending()).toBe(true);
    vi.advanceTimersByTime(100);
    expect(runs).toEqual(['card', 'count']);
    expect(schedule.pending()).toBe(false);
  });

  it('cancels every pending timer at once, so a finale never fires after the reader moves on', () => {
    const schedule = finishSchedule();
    const runs: string[] = [];
    schedule.after(100, () => runs.push('card'));
    schedule.after(700, () => runs.push('count'));
    schedule.cancel();
    vi.advanceTimersByTime(1000);
    expect(runs).toEqual([]);
    expect(schedule.pending()).toBe(false);
  });
});
