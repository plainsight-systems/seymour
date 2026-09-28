import type { SceneBox } from '../cutaway/scene';

// Which physical surface each drawn part is rendered with in the realistic
// view. Pure: no Three.js here, so the mapping is testable.

export type SurfaceKind =
  | 'pcb' | 'fr4' | 'silicon' | 'siliconMatte' | 'sram' | 'logic' | 'phy'
  | 'hbm' | 'aluminum' | 'lid' | 'dram' | 'ghost';

export interface SurfaceSpec {
  color: string;
  metalness: number;
  roughness: number;
  clearcoat: number;
  opacity: number;
}

export const SURFACES: Record<SurfaceKind, SurfaceSpec> = {
  pcb: { color: '#1f5a3a', metalness: 0.05, roughness: 0.72, clearcoat: 0.15, opacity: 1 },
  fr4: { color: '#2a4527', metalness: 0.1, roughness: 0.5, clearcoat: 0.35, opacity: 1 },
  silicon: { color: '#343b4a', metalness: 0.75, roughness: 0.22, clearcoat: 0.6, opacity: 1 },
  siliconMatte: { color: '#8e959e', metalness: 0.6, roughness: 0.34, clearcoat: 0.2, opacity: 1 },
  sram: { color: '#8a7a4c', metalness: 0.55, roughness: 0.3, clearcoat: 0.4, opacity: 1 },
  logic: { color: '#4b5b7a', metalness: 0.55, roughness: 0.3, clearcoat: 0.4, opacity: 1 },
  phy: { color: '#5b4b6c', metalness: 0.5, roughness: 0.35, clearcoat: 0.3, opacity: 1 },
  hbm: { color: '#1d1e24', metalness: 0.35, roughness: 0.32, clearcoat: 0.55, opacity: 1 },
  aluminum: { color: '#b8bdc3', metalness: 0.9, roughness: 0.38, clearcoat: 0, opacity: 1 },
  lid: { color: '#c9cdd1', metalness: 0.88, roughness: 0.24, clearcoat: 0.2, opacity: 1 },
  dram: { color: '#1e3a2a', metalness: 0.1, roughness: 0.6, clearcoat: 0.1, opacity: 1 },
  ghost: { color: '#ffffff', metalness: 0, roughness: 0.4, clearcoat: 0, opacity: 0.16 },
};

const LOGIC_PARTS = new Set(['unit', 'unit-off', 'unit-busy', 'unit-wait', 'matrix', 'lanes', 'scheduler', 'tma']);
const SRAM_PARTS = new Set(['l2', 'smem', 'registers', 'l1']);

export function surfaceFor(box: SceneBox): SurfaceKind {
  if (box.ghost) return 'ghost';
  const part = box.part ?? '';
  if (box.id === 'baseboard' || box.id === 'hostboard' || (part === 'net' && box.id === 'nic')) return 'pcb';
  if (part === 'gpu' || part === 'peers') return 'aluminum';
  if (part === 'switch' || part === 'pcie' || (part === 'host' && box.id === 'cpu')) return 'lid';
  if (part === 'host') return 'dram';
  if (part === 'ssd') return 'hbm';
  if (part === 'substrate') return 'fr4';
  if (part === 'interposer') return 'siliconMatte';
  if (part === 'hbm') return 'hbm';
  if (part === 'mc') return 'phy';
  if (SRAM_PARTS.has(part)) return 'sram';
  if (LOGIC_PARTS.has(part)) return 'logic';
  return 'silicon';
}

/**
 * A small, deterministic tint so rows of identical units read like a die
 * photograph rather than flat blocks. Returns a hue shift in degrees.
 */
export function tintFor(box: SceneBox): number {
  let hash = 0;
  for (const char of box.id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return ((hash % 41) - 20) * 0.6;
}
