export type RouteId = 'story' | 'under-the-hood' | 'lookup';

export function resolveRoute(hash: string, search: string): { route: RouteId; redirectHash?: string } {
  if (search && (!hash || hash === '#/')) return { route: 'under-the-hood', redirectHash: '#/under-the-hood' };
  if (hash === '#/under-the-hood') return { route: 'under-the-hood' };
  if (hash === '#/lookup') return { route: 'lookup' };
  return { route: 'story' };
}
