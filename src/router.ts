export type RouteId = 'story' | 'lookup';

export interface ResolvedRoute {
  route: RouteId;
  /** An in-page target on the story, e.g. `act-2/attention`. */
  anchor?: string;
}

// Routes are hashes that start with "#/". Any other hash is an in-page
// anchor on the story and must scroll, not navigate.

/** Scene ids that were renamed; old shared links still open the scene. */
const RENAMED_SCENES: Record<string, string> = { 'two-jobs': 'first-vs-later' };
export function resolveRoute(hash: string): ResolvedRoute {
  if (hash === '#/lookup') return { route: 'lookup' };
  if (hash.length > 1 && !hash.startsWith('#/')) {
    const anchor = decodeAnchor(hash.slice(1));
    return anchor === null ? { route: 'story' } : { route: 'story', anchor: currentAnchor(anchor) };
  }
  return { route: 'story' };
}

/** Replaces a renamed scene id in an anchor such as `act-2/two-jobs`. */
function currentAnchor(anchor: string): string {
  return anchor.split('/').map((part) => RENAMED_SCENES[part] ?? part).join('/');
}

/** A hash that is not valid percent-encoding (e.g. `#100%`) names no anchor; the story opens at the top. */
function decodeAnchor(encoded: string): string | null {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

/** Whether moving between two hashes needs a full route change. */
export function isRouteChange(fromHash: string, toHash: string): boolean {
  return resolveRoute(fromHash).route !== resolveRoute(toHash).route;
}
