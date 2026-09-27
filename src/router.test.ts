import { describe, expect, it } from 'vitest';
import { isRouteChange, resolveRoute } from './router';

describe('resolveRoute', () => {
  it('sends old query-string share links to Under the hood', () => {
    expect(resolveRoute('', '?phase=decode&batch=64')).toEqual({ route: 'under-the-hood', redirectHash: '#/under-the-hood' });
  });

  it('keeps explicit hash routes stable', () => {
    expect(resolveRoute('#/', '')).toEqual({ route: 'story' });
    expect(resolveRoute('#/under-the-hood', '?batch=64')).toEqual({ route: 'under-the-hood' });
    expect(resolveRoute('#/lookup', '')).toEqual({ route: 'lookup' });
  });

  it('treats non-route hashes as story anchors', () => {
    expect(resolveRoute('#playground', '')).toEqual({ route: 'story', anchor: 'playground' });
    expect(resolveRoute('#memory-wall', '')).toEqual({ route: 'story', anchor: 'memory-wall' });
  });

  it('only reloads when the route itself changes', () => {
    expect(isRouteChange('#/', '#playground', '')).toBe(false);
    expect(isRouteChange('#two-jobs', '#distance', '')).toBe(false);
    expect(isRouteChange('#playground', '#/lookup', '')).toBe(true);
    expect(isRouteChange('#/lookup', '#/', '')).toBe(true);
  });
});
