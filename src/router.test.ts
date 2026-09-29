import { describe, expect, it } from 'vitest';
import { isRouteChange, resolveRoute } from './router';

describe('resolveRoute', () => {
  it('keeps explicit hash routes stable', () => {
    expect(resolveRoute('')).toEqual({ route: 'story' });
    expect(resolveRoute('#/')).toEqual({ route: 'story' });
    expect(resolveRoute('#/lookup')).toEqual({ route: 'lookup' });
  });

  it('opens the story for retired routes, such as the removed Under the hood page', () => {
    expect(resolveRoute('#/under-the-hood')).toEqual({ route: 'story' });
  });

  it('treats non-route hashes as story anchors', () => {
    expect(resolveRoute('#act-4/challenges')).toEqual({ route: 'story', anchor: 'act-4/challenges' });
    expect(resolveRoute('#act-2/attention')).toEqual({ route: 'story', anchor: 'act-2/attention' });
  });

  it('only reloads when the route itself changes', () => {
    expect(isRouteChange('#/', '#act-4/playground')).toBe(false);
    expect(isRouteChange('#act-2/two-jobs', '#act-3/distance')).toBe(false);
    expect(isRouteChange('#act-4/playground', '#/lookup')).toBe(true);
    expect(isRouteChange('#/lookup', '#/')).toBe(true);
  });
});
