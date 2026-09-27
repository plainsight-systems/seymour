import { describe, expect, it } from 'vitest';
import { resolveRoute } from './router';

describe('resolveRoute', () => {
  it('sends old query-string share links to Under the hood', () => {
    expect(resolveRoute('', '?phase=decode&batch=64')).toEqual({ route: 'under-the-hood', redirectHash: '#/under-the-hood' });
  });

  it('keeps explicit hash routes stable', () => {
    expect(resolveRoute('#/', '')).toEqual({ route: 'story' });
    expect(resolveRoute('#/under-the-hood', '?batch=64')).toEqual({ route: 'under-the-hood' });
    expect(resolveRoute('#/lookup', '')).toEqual({ route: 'lookup' });
  });
});
