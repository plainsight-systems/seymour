import { describe, expect, it } from 'vitest';
import cutawayCss from './cutaway/cutaway.css?raw';
import storyCss from './story.css?raw';

// A stylesheet with an unclosed block silently nests every later rule inside
// it (e.g. a phone-width media query), so the page looks broken only on
// other screens. Braces must balance and never close more than they open.
describe('stylesheets', () => {
  for (const [name, source] of [['story.css', storyCss], ['cutaway.css', cutawayCss]] as const) {
    it(`${name} has balanced braces`, () => {
      const css = source.replace(/\/\*[\s\S]*?\*\//g, '');
      expect(css.length).toBeGreaterThan(1000);
      let depth = 0;
      let lowest = 0;
      for (const char of css) {
        if (char === '{') depth++;
        if (char === '}') { depth--; lowest = Math.min(lowest, depth); }
      }
      expect(lowest).toBe(0);
      expect(depth).toBe(0);
    });

    it(`${name} has no selector left dangling after a combinator`, () => {
      // A line ending in ">", "+", or "~" fuses with the next rule into a selector that never matches.
      const dangling = source.split('\n').filter((line) => /[>+~]\s*$/.test(line));
      expect(dangling).toEqual([]);
    });
  }
});
