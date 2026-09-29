import { describe, expect, it } from 'vitest';
import siteCss from '../style.css?raw';
import cutawayCss from './cutaway/cutaway.css?raw';
import storyCss from './story.css?raw';

// A stylesheet with an unclosed block silently nests every later rule inside
// it (e.g. a phone-width media query), so the page looks broken only on
// other screens. Braces must balance and never close more than they open.
describe('stylesheets', () => {
  for (const [name, source] of [['story.css', storyCss], ['cutaway.css', cutawayCss], ['style.css', siteCss]] as const) {
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
  }
});
