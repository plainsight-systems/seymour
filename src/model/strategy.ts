import type { ModelProfile, SimulationSettings } from '../types';

export function applySoftwareStrategy(
  base: ModelProfile,
  settings: Pick<SimulationSettings, 'weightBits' | 'kvBits'>,
): ModelProfile {
  const baseName = base.name.split(' · ')[0] ?? base.name;
  return {
    ...base,
    name: `${baseName} · W${settings.weightBits}/KV${settings.kvBits}`,
    weightBits: settings.weightBits,
    kvBits: settings.kvBits,
  };
}

export function precisionLabel(bits: number): string {
  if (bits === 16) return 'FP16';
  if (bits === 8) return '8-bit';
  return '4-bit';
}
