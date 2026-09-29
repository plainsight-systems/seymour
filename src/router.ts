export type RouteId = 'story' | 'lookup';

export interface ResolvedRoute {
  route: RouteId;
  /** An in-page target on the story, e.g. `act-2/attention`. */
  anchor?: string;
}

// Routes are hashes that start with "#/". Any other hash is an in-page
// anchor on the story and must scroll, not navigate.
export function resolveRoute(hash: string): ResolvedRoute {
  if (hash === '#/lookup') return { route: 'lookup' };
  if (hash.length > 1 && !hash.startsWith('#/')) return { route: 'story', anchor: decodeURIComponent(hash.slice(1)) };
  return { route: 'story' };
}

/** Whether moving between two hashes needs a full route change. */
export function isRouteChange(fromHash: string, toHash: string): boolean {
  return resolveRoute(fromHash).route !== resolveRoute(toHash).route;
}
