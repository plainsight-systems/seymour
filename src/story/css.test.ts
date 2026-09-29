import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// A stylesheet with an unclosed block silently nests every later rule inside
// it (e.g. a phone-width media query), so the page looks broken only on
// other screens. Braces must balance and never close more than they open.
describe('stylesheets', () => {
  for (const file of ['src/story/story.css', 'src/story/cutaway/cutaway.css', 'src/style.css']) {
    it(`${file} has balanced braces`, () => {
      const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
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
