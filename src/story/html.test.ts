import { describe, expect, it } from 'vitest';
import { escapeHtml } from './html';

describe('escapeHtml', () => {
  it('escapes every character that can end text or an attribute', () => {
    expect(escapeHtml(`<b title="x">Tom's & Jerry's</b>`)).toBe('&lt;b title=&quot;x&quot;&gt;Tom&#39;s &amp; Jerry&#39;s&lt;/b&gt;');
  });

  it('leaves ordinary text, including typographic quotes, unchanged', () => {
    expect(escapeHtml('Llama 3.1 8B · the model’s “first pass”')).toBe('Llama 3.1 8B · the model’s “first pass”');
  });
});
