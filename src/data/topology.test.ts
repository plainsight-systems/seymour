import { describe, expect, it } from 'vitest';
import { HARDWARE_PROFILES } from './profiles';
import { TOPOLOGIES, getTopology } from './topology';

describe('chip topology', () => {
  it('exists for every hardware profile', () => {
    for (const hardware of HARDWARE_PROFILES) expect(() => getTopology(hardware.id)).not.toThrow();
  });

  it('agrees with the published profile figures', () => {
    for (const topology of TOPOLOGIES) {
      const hardware = HARDWARE_PROFILES.find((profile) => profile.id === topology.hardwareId)!;
      expect(topology.enabledUnits).toBe(hardware.unitCount);
      const drawn = topology.hbmActiveStacks * topology.hbmGBPerStack;
      if (topology.stackCountBasis === 'published') expect(drawn).toBe(hardware.hbmCapacityGB);
      else {
        // Derived counts must still add up to the published capacity (H200 exposes 141 of 144 GB).
        expect(drawn).toBeGreaterThanOrEqual(hardware.hbmCapacityGB);
        expect(drawn / hardware.hbmCapacityGB).toBeLessThan(1.03);
        expect(topology.stackCountNote).toBeTruthy();
      }
      expect(topology.l2MBPerComputeDie * topology.computeDies).toBe(hardware.l2CacheMB);
    }
  });

  it('is internally consistent', () => {
    for (const topology of TOPOLOGIES) {
      expect(topology.enabledUnits).toBeLessThanOrEqual(topology.physicalUnits);
      expect(topology.hbmActiveStacks).toBeLessThanOrEqual(topology.hbmSites);
      expect(topology.memoryControllersActive ?? 0).toBeLessThanOrEqual(topology.memoryControllers ?? 0);
      expect(topology.physicalUnits % topology.unitsPerCluster).toBe(0);
      expect(topology.sources.length).toBeGreaterThan(0);
    }
  });

  it('fails loudly for an unknown accelerator', () => {
    expect(() => getTopology('nope')).toThrow(/No cutaway topology/);
  });
});
