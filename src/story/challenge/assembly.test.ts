import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, HARDWARE_PROFILES } from '../../data/profiles';
import { partEntry } from '../../data/parts';
import { modelFor } from '../../model/strategy';
import { buildCutawayInputs } from '../cutaway/inputs';
import { diePlate, packagePlate, unresolvedLabels } from '../cutaway/plates';
import { assemblyPlate, assemblyRound, isComplete, place, zoneNumber } from './assembly';

function platesFor(hardwareId: string) {
  const hardware = HARDWARE_PROFILES.find((profile) => profile.id === hardwareId)!;
  const settings = { ...DEFAULT_SETTINGS, hardwareId };
  const inputs = buildCutawayInputs(settings, hardware, modelFor(settings));
  return { hardware, package: packagePlate(inputs, 'hardware'), die: diePlate(inputs, { job: 'decode', detail: 'full', activity: false }) };
}

describe('assembly challenge', () => {
  it('builds two rounds of explained parts for every accelerator', () => {
    for (const hardware of HARDWARE_PROFILES) {
      const plates = platesFor(hardware.id);
      for (const id of ['package', 'die'] as const) {
        const round = assemblyRound(id, plates[id]);
        expect(round.parts.length).toBeGreaterThanOrEqual(3);
        for (const part of round.parts) expect(partEntry(part, hardware.vendor)).toBeDefined();
      }
    }
  });

  it('hides every answer until it is placed', () => {
    const { package: plate } = platesFor('h100-sxm');
    const round = assemblyRound('package', plate);
    const shown = assemblyPlate(plate, round, new Set());
    expect(unresolvedLabels(shown.scene)).toEqual([]);
    expect(shown.scene.labels.map((label) => label.title)).toEqual(round.parts.map((part) => `Zone ${zoneNumber(round, part)}`));
    for (const box of shown.scene.boxes) if (box.part && round.parts.includes(box.part)) expect(box.ghost).toBe(true);
  });

  it('restores a part and its real label once placed', () => {
    const { package: plate } = platesFor('h100-sxm');
    const round = assemblyRound('package', plate);
    const shown = assemblyPlate(plate, round, new Set(['hbm']));
    const hbm = shown.scene.labels.find((label) => label.part === 'hbm')!;
    expect(hbm.title).toBe(plate.scene.labels.find((label) => label.part === 'hbm')!.title);
    expect(shown.scene.boxes.filter((box) => box.part === 'hbm').some((box) => box.ghost)).toBe(false);
  });

  it('judges placements and completion', () => {
    const { die } = platesFor('mi300x');
    const round = assemblyRound('die', die);
    expect(round.parts).toEqual(['unit', 'l2', 'io']);
    expect(place(round, new Set(), 'l2', 'l2')).toBe('correct');
    expect(place(round, new Set(), 'l2', 'unit')).toBe('wrong');
    expect(place(round, new Set(['unit']), 'l2', 'unit')).toBe('already-placed');
    expect(isComplete(round, new Set(['unit', 'l2']))).toBe(false);
    expect(isComplete(round, new Set(round.parts))).toBe(true);
  });
});
