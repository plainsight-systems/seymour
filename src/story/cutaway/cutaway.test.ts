import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, HARDWARE_PROFILES, getHardware } from '../../data/profiles';
import { getTopology } from '../../data/topology';
import { calculateSimulation } from '../../model/calculate';
import { modelFor } from '../../model/strategy';
import type { KvPlacement, SimulationSettings } from '../../types';
import { buildCutawayInputs } from './inputs';
import { PLACEMENT_PART, tileSteps, diePlate, packagePlate, serverPlate, unitPlate, unresolvedLabels } from './plates';
import { project } from './project';

const base: SimulationSettings = { ...DEFAULT_SETTINGS, phase: 'decode', kvPlacement: 'hbm' };

function inputsFor(overrides: Partial<SimulationSettings> = {}) {
  const settings = { ...base, ...overrides };
  const hardware = getHardware(settings.hardwareId);
  const model = modelFor(settings);
  return { inputs: buildCutawayInputs(settings, hardware, model), settings, hardware, model };
}

describe('projection', () => {
  it('is deterministic and maps z straight up', () => {
    expect(project([0, 0, 0])).toEqual([0, 0]);
    const [x0, y0] = project([3, 2, 0]);
    const [x1, y1] = project([3, 2, 1]);
    expect(x1).toBe(x0);
    expect(y1).toBeLessThan(y0);
  });
});

describe('cutaway inputs', () => {
  it('fills memory with fractions that sum to physical capacity', () => {
    for (const batch of [1, 64, 256]) {
      const { memory } = inputsFor({ batch }).inputs;
      expect(memory.weightsFraction + memory.kvFraction + memory.freeFraction + memory.reserveFraction).toBeCloseTo(1, 9);
    }
  });

  it('reports overflow exactly when the model spills', () => {
    for (const batch of [1, 64, 128, 512]) {
      const { inputs, settings, hardware, model } = inputsFor({ batch });
      const result = calculateSimulation(settings, hardware, model);
      expect(inputs.memory.overflowBytes > 0).toBe(result.spilledKvBytes + result.spilledWeightBytes > 0);
    }
  });

  it('frees GPU memory when the KV cache lives elsewhere', () => {
    const inGpu = inputsFor({ batch: 64 }).inputs.memory;
    const onHost = inputsFor({ batch: 64, kvPlacement: 'host' }).inputs.memory;
    expect(onHost.kvFraction).toBe(0);
    expect(onHost.freeFraction).toBeGreaterThan(inGpu.freeFraction);
  });

  it('derives busy units from the model’s math share', () => {
    const { inputs } = inputsFor({ batch: 1 });
    expect(inputs.decode.mathShare).toBeCloseTo(inputs.decode.computeMs / inputs.decode.totalMs, 12);
    expect(inputs.decode.busyUnits).toBe(Math.max(1, Math.round(132 * inputs.decode.mathShare)));
    // Prompt processing at 4K tokens is limited by math on this GPU.
    expect(inputs.prefill.busyUnits).toBe(132);
    // Sharing the read across users raises the share of time spent on math.
    expect(inputsFor({ batch: 64 }).inputs.decode.mathShare).toBeGreaterThan(inputs.decode.mathShare);
  });
});

describe('plates', () => {
  const allPlates = () => HARDWARE_PROFILES.flatMap((hardware) => {
    const { inputs } = inputsFor({ hardwareId: hardware.id, batch: 64 });
    return [
      serverPlate(inputs),
      packagePlate(inputs),
      diePlate(inputs, { job: 'decode', detail: 'full' }),
      diePlate(inputs, { job: 'prefill', detail: 'minimal' }),
      ...tileSteps(hardware.id).map((_, step) => unitPlate(hardware.id, step)),
    ];
  });

  it('never labels a part that is not drawn', () => {
    for (const plate of allPlates()) expect(unresolvedLabels(plate.scene)).toEqual([]);
  });

  it('draws unique box ids', () => {
    for (const plate of allPlates()) {
      const ids = plate.scene.boxes.map((box) => box.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('draws the published unit and memory-stack counts', () => {
    const h100 = getTopology('h100-sxm');
    const { inputs } = inputsFor({ batch: 64 });
    const die = diePlate(inputs, { job: 'decode', detail: 'full' }).scene.boxes;
    expect(die.filter((box) => box.part === 'unit-busy' || box.part === 'unit-wait')).toHaveLength(h100.enabledUnits);
    expect(die.filter((box) => box.part === 'unit-off')).toHaveLength(h100.physicalUnits - h100.enabledUnits);
    const pkg = packagePlate(inputs).scene.boxes;
    expect(pkg.filter((box) => box.id.endsWith('-base'))).toHaveLength(h100.hbmSites);
    expect(pkg.filter((box) => box.part === 'unused')).toHaveLength(h100.hbmSites - h100.hbmActiveStacks);

    const mi = getTopology('mi300x');
    const miInputs = inputsFor({ hardwareId: 'mi300x', batch: 64 }).inputs;
    const miDie = diePlate(miInputs, { job: 'decode', detail: 'full' }).scene.boxes;
    expect(miDie.filter((box) => box.part?.startsWith('unit-') && box.part !== 'unit-off')).toHaveLength(mi.enabledUnits / mi.computeDies);
    expect(packagePlate(miInputs).scene.boxes.filter((box) => box.part === 'compute-die')).toHaveLength(mi.computeDies);
  });

  it('shades exactly the model’s busy share of units', () => {
    const { inputs } = inputsFor({ batch: 64 });
    const busy = diePlate(inputs, { job: 'decode', detail: 'minimal' }).scene.boxes.filter((box) => box.part === 'unit-busy');
    expect(busy).toHaveLength(inputs.decode.busyUnits);
  });

  it('shows overflow on the package only when the model spills', () => {
    const fits = packagePlate(inputsFor({ batch: 64 }).inputs).scene.boxes;
    const spills = packagePlate(inputsFor({ batch: 256 }).inputs).scene.boxes;
    expect(fits.some((box) => box.part === 'overflow')).toBe(false);
    expect(spills.some((box) => box.part === 'overflow')).toBe(true);
  });

  it('lights the data path for every KV placement', () => {
    for (const placement of ['hbm', 'host', 'peer', 'peers', 'ssd', 'object'] as KvPlacement[]) {
      const plate = serverPlate(inputsFor({ kvPlacement: placement }).inputs);
      expect(plate.litPath).toBe(placement);
      expect(plate.defaultSelection).toEqual([PLACEMENT_PART[placement]]);
      if (placement !== 'hbm') expect(plate.scene.links.some((link) => link.paths.includes(placement))).toBe(true);
    }
  });

  it('uses the memory ladder’s bandwidths, not its own', () => {
    const { inputs } = inputsFor();
    const plate = serverPlate(inputs);
    const storage = plate.scene.links.find((link) => link.to === 'store')!;
    expect(storage.bytesPerSecond).toBe(inputs.tiers.object.bandwidthBytesPerSecond);
    expect(storage.basis).toBe('representative');
  });

  it('highlights each step of the tile path', () => {
    const steps = tileSteps('h100-sxm');
    expect(unitPlate('h100-sxm', 4).defaultSelection).toEqual(steps[4]!.parts);
    expect(() => unitPlate('unknown', 0)).toThrow();
  });

  it('labels the whole KV cache, not just the part that fits', () => {
    const { inputs } = inputsFor({ batch: 64, sequenceLength: 16384 });
    const kv = packagePlate(inputs).scene.labels.find((label) => label.part === 'kv')!;
    expect(inputs.memory.overflowBytes).toBeGreaterThan(0);
    expect(kv.title).toContain('137 GB');
    expect(kv.detail).toMatch(/only .* fits here/);
  });

  it('splits MoE weights into read and not-read segments from the model', () => {
    for (const batch of [1, 8, 256]) {
      const { inputs } = inputsFor({ modelId: 'qwen3-30b-a3b', sequenceLength: 2048, batch });
      const plate = packagePlate(inputs);
      expect(unresolvedLabels(plate.scene)).toEqual([]);
      const idle = plate.scene.boxes.some((box) => box.part === 'weights-idle');
      expect(idle).toBe(inputs.weightsReadFraction < 0.999);
    }
    expect(inputsFor({ modelId: 'qwen3-30b-a3b', batch: 1 }).inputs.weightsReadFraction).toBeLessThan(0.2);
    expect(inputsFor({ batch: 1 }).inputs.weightsReadFraction).toBe(1);
  });
});
