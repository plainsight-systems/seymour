import { describe, expect, it } from 'vitest';
import { HARDWARE_PROFILES } from './profiles';
import { buildMemoryLadder } from './memoryLadder';

describe('buildMemoryLadder', () => {
  for (const hardware of HARDWARE_PROFILES) {
    it(`keeps ${hardware.name} on-chip bandwidth qualitative and every tier sourced`, () => {
      const tiers = buildMemoryLadder(hardware);
      const onChip = tiers.filter((tier) => ['registers', 'shared', 'l2'].includes(tier.id));

      expect(tiers).toHaveLength(8);
      expect(onChip.every((tier) => tier.bandwidthBytesPerSecond === undefined)).toBe(true);
      expect(tiers.every((tier) => tier.sourceUrl.startsWith('https://'))).toBe(true);
      expect(tiers.every((tier) => tier.sourceLabel.length > 0)).toBe(true);
    });
  }

  it('marks assumed server, storage, and network tiers as representative', () => {
    const tiers = buildMemoryLadder(HARDWARE_PROFILES[0]!);
    for (const id of ['host', 'ssd', 'object']) {
      expect(tiers.find((tier) => tier.id === id)?.basis).toBe('representative');
    }
  });
});
