// Every page is built from template strings, so any text that is not markup
// passes through here before it reaches innerHTML or an attribute.

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ENTITIES[char]!);
}

/** Data attributes that change with state rather than identify the control. */
const STATE_ATTRIBUTES = new Set(['data-state']);

/**
 * Redraws part of the page without losing keyboard focus: if a control inside
 * `host` had focus, the control with the same identifying data attributes is
 * focused again afterwards. Without this, replacing innerHTML drops focus to
 * the page body after every click.
 */
export function keepFocus(host: Element, redraw: () => void): void {
  const active = document.activeElement;
  const selector = active && active !== host && host.contains(active) ? focusSelector(active) : null;
  redraw();
  if (selector) host.querySelector<HTMLElement | SVGElement>(selector)?.focus({ preventScroll: true });
}

function focusSelector(element: Element): string | null {
  const identity = [...element.attributes].filter((attribute) => attribute.name.startsWith('data-') && !STATE_ATTRIBUTES.has(attribute.name));
  if (identity.length === 0) return null;
  return element.tagName.toLowerCase() + identity.map((attribute) => `[${attribute.name}="${CSS.escape(attribute.value)}"]`).join('');
}
