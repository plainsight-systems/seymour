import type { Vec3 } from './scene';

// True isometric projection: x runs down-right, y runs down-left, z runs up.
// Every point on a plate passes through this one function.
export const ISO_UNIT_PX = 11;
const COS_30 = Math.cos(Math.PI / 6);
const SIN_30 = 0.5;

export function project([x, y, z]: Vec3): [number, number] {
  return [(x - y) * COS_30 * ISO_UNIT_PX, (x + y) * SIN_30 * ISO_UNIT_PX - z * ISO_UNIT_PX];
}
