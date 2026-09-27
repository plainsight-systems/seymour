export type RouteId = 'story' | 'under-the-hood' | 'lookup';

export interface ResolvedRoute {
  route: RouteId;
  redirectHash?: string;
  /** An in-page target on the story, e.g. `#playground`. */
  anchor?: string;
}

// Routes are hashes that start with "#/". Any other hash is an in-page
// anchor on the story and must scroll, not navigate.
export function resolveRoute(hash: string, search: string): ResolvedRoute {
  if (search && (!hash || hash === '#/')) return { route: 'under-the-hood', redirectHash: '#/under-the-hood' };
  if (hash === '#/under-the-hood') return { route: 'under-the-hood' };
  if (hash === '#/lookup') return { route: 'lookup' };
  if (hash.length > 1 && !hash.startsWith('#/')) return { route: 'story', anchor: decodeURIComponent(hash.slice(1)) };
  return { route: 'story' };
}

/** Whether moving between two hashes needs a full route change. */
export function isRouteChange(fromHash: string, toHash: string, search: string): boolean {
  return resolveRoute(fromHash, search).route !== resolveRoute(toHash, search).route;
}
