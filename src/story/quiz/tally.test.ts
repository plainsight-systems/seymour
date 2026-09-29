import { describe, expect, it } from 'vitest';
import { tally } from './tally';

describe('quiz tally', () => {
  const ids = ['a', 'b', 'c', 'd'];

  it('starts empty', () => {
    expect(tally(ids, new Map())).toEqual({ answered: 0, right: 0, total: 4, complete: false });
  });

  it('counts answered and right, ignoring unknown ids', () => {
    expect(tally(ids, new Map([['a', true], ['c', false], ['zzz', true]]))).toEqual({ answered: 2, right: 1, total: 4, complete: false });
  });

  it('is complete once every item is answered', () => {
    expect(tally(ids, new Map(ids.map((id, i) => [id, i % 2 === 0])))).toEqual({ answered: 4, right: 2, total: 4, complete: true });
  });
});
