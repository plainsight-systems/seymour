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

describe('part glossary', () => {
  it('names and explains every part drawn in Act 1, for every accelerator', async () => {
    const { partEntry } = await import('./parts');
    const { modelFor } = await import('../model/strategy');
    const { DEFAULT_SETTINGS } = await import('./profiles');
    const { buildCutawayInputs } = await import('../story/cutaway/inputs');
    const { serverPlate, packagePlate, diePlate, unitPlate } = await import('../story/cutaway/plates');
    for (const hardware of HARDWARE_PROFILES) {
      const settings = { ...DEFAULT_SETTINGS, hardwareId: hardware.id };
      const inputs = buildCutawayInputs(settings, hardware, modelFor(settings));
      const plates = [serverPlate(inputs, 'hardware'), packagePlate(inputs, 'hardware'), diePlate(inputs, { job: 'decode', detail: 'full', activity: false }), unitPlate(hardware.id, 0)];
      for (const plate of plates) {
        for (const label of plate.scene.labels) {
          const entry = partEntry(label.part, hardware.vendor);
          expect(entry, `${hardware.id}: ${label.part}`).toBeDefined();
          expect(entry!.terms.length).toBeGreaterThan(0);
          expect([entry!.what, entry!.does, entry!.inference].every((text) => text.length > 20)).toBe(true);
        }
      }
    }
  });

  it('uses each vendor’s own names where they differ', async () => {
    const { partEntry } = await import('./parts');
    const terms = (part: string, vendor: 'NVIDIA' | 'AMD') => partEntry(part, vendor)!.terms.map((term) => term.term);
    expect(terms('unit', 'NVIDIA')).toContain('SM');
    expect(terms('unit', 'AMD')).toContain('CU');
    expect(terms('smem', 'AMD')).toContain('LDS');
    expect(terms('matrix', 'NVIDIA')).toContain('Tensor Core');
    expect(terms('hbm', 'AMD')).toContain('HBM');
  });
});

describe('facts the prose relies on', () => {
  // Some sentences state these as plain words ("eight GPUs on one board",
  // "all seven other GPUs", "eight compute chiplets"). If a chip breaks one,
  // this fails, and the wording must change with the data.
  it('every server holds eight GPUs, so each GPU has seven peers', () => {
    for (const { id } of HARDWARE_PROFILES) expect(getTopology(id).peerCount, id).toBe(7);
  });

  it('every chiplet design has eight compute dies', () => {
    for (const { id } of HARDWARE_PROFILES) {
      const dies = getTopology(id).computeDies;
      expect(dies === 1 || dies === 8, `${id}: ${dies} compute dies`).toBe(true);
    }
  });
});
