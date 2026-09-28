import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, HARDWARE_PROFILES } from '../../data/profiles';
import { modelFor } from '../../model/strategy';
import { buildCutawayInputs } from '../cutaway/inputs';
import { diePlate, packagePlate, serverPlate, unitPlate } from '../cutaway/plates';
import { SURFACES, surfaceFor, tintFor } from './surfaces';

function act1Boxes() {
  return HARDWARE_PROFILES.flatMap((hardware) => {
    const settings = { ...DEFAULT_SETTINGS, hardwareId: hardware.id };
    const inputs = buildCutawayInputs(settings, hardware, modelFor(settings));
    return [serverPlate(inputs, 'hardware'), packagePlate(inputs, 'hardware'), diePlate(inputs, { job: 'decode', detail: 'full', activity: false }), unitPlate(hardware.id, 0)]
      .flatMap((plate) => plate.scene.boxes);
  });
}

describe('realistic surfaces', () => {
  it('gives every Act 1 box a defined surface', () => {
    for (const box of act1Boxes()) expect(SURFACES[surfaceFor(box)]).toBeDefined();
  });

  it('renders the parts that matter with the right physical material', () => {
    const boxes = act1Boxes();
    const kinds = (part: string) => new Set(boxes.filter((box) => box.part === part && !box.ghost).map(surfaceFor));
    expect(kinds('hbm')).toEqual(new Set(['hbm']));
    expect(kinds('die')).toEqual(new Set(['silicon']));
    expect(kinds('interposer')).toEqual(new Set(['siliconMatte']));
    expect(kinds('substrate')).toEqual(new Set(['fr4']));
    expect(kinds('l2')).toEqual(new Set(['sram']));
    expect(boxes.filter((box) => box.ghost).every((box) => surfaceFor(box) === 'ghost')).toBe(true);
  });

  it('tints units deterministically within a small range', () => {
    const box = act1Boxes().find((candidate) => candidate.part === 'unit')!;
    expect(tintFor(box)).toBe(tintFor({ ...box }));
    for (const candidate of act1Boxes()) expect(Math.abs(tintFor(candidate))).toBeLessThanOrEqual(12);
  });
});
