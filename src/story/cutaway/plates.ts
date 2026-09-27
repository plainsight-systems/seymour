import { getTopology, type ChipTopology, type TopologySource } from '../../data/topology';
import { formatBytes, formatNumber } from '../../model/calculate';
import type { KvPlacement } from '../../types';
import type { CutawayInputs } from './inputs';
import { SceneBuilder, frontFace, illustrativeDisabledUnits, type Fill, type Scene, type SceneBox } from './scene';

export type PlateId = 'server' | 'package' | 'die' | 'unit';

export interface Plate {
  id: PlateId;
  scene: Scene;
  /** Parts highlighted when the reader has not picked one. */
  defaultSelection: string[];
  /** Placement whose data path is drawn lit (server plate only). */
  litPath: KvPlacement | null;
  note: string;
  sources: TopologySource[];
}

export function formatBandwidth(bytesPerSecond: number): string {
  return bytesPerSecond >= 1e12
    ? `${formatNumber(bytesPerSecond / 1e12)} TB/s`
    : `${formatNumber(bytesPerSecond / 1e9)} GB/s`;
}

/** The part a KV placement lights up on the server plate. */
export const PLACEMENT_PART: Record<KvPlacement, string> = {
  hbm: 'gpu', peer: 'peers', host: 'host', ssd: 'ssd', object: 'net',
};

// ---------------------------------------------------------------------------
// Plate 1 · Server
// ---------------------------------------------------------------------------
export function serverPlate(inputs: CutawayInputs): Plate {
  const topology = getTopology(inputs.hardwareId);
  const b = new SceneBuilder();
  const switched = topology.peerFabric === 'switched';
  b.box({ id: 'baseboard', x: 0, y: 0, w: 46, d: 30, h: 0.8 });
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 4; col++) {
      const index = row * 4 + col;
      b.box({
        id: `gpu${index}`, part: index === 0 ? 'gpu' : 'peers', layer: 2,
        x: 2 + col * 11, y: row === 0 ? 2 : switched ? 20 : 19, w: 9, d: switched ? 8 : 9, h: 2.4,
        fill: index === 0 ? 'red' : 'green',
      });
    }
  }
  const peer = inputs.tiers.peer;
  if (switched) {
    for (let i = 0; i < 4; i++) {
      b.box({ id: `switch${i}`, part: 'switch', x: 4 + i * 11, y: 13.5, w: 5, d: 3, h: 1.2, fill: 'mustard', layer: 2 });
      b.link({ from: 'gpu0', to: `switch${i}`, bytesPerSecond: peer.bandwidthBytesPerSecond! / 4, basis: peer.basis, paths: ['peer'] });
    }
  } else {
    for (let i = 1; i <= topology.peerCount; i++) {
      b.link({ from: 'gpu0', to: `gpu${i}`, bytesPerSecond: peer.bandwidthBytesPerSecond!, basis: peer.basis, paths: ['peer'] });
    }
  }

  // Host side of the same server.
  const oy = 36;
  const { host, ssd, object } = inputs.tiers;
  b.box({ id: 'hostboard', x: 0, y: oy, w: 46, d: 20, h: 0.8 });
  b.box({ id: 'cpu', part: 'host', x: 4, y: oy + 5, w: 8, d: 8, h: 1.6, fill: 'slate', layer: 2 });
  for (let i = 0; i < 4; i++) b.box({ id: `dram${i}`, part: 'host', x: 15 + i * 2, y: oy + 3, w: 1, d: 12, h: 3, fill: 'paperBright', layer: 2 });
  b.box({ id: 'pcie', part: 'pcie', x: 26, y: oy + 7, w: 4, d: 4, h: 1, fill: 'slate', layer: 2 });
  b.box({ id: 'nic', part: 'net', x: 34, y: oy + 4, w: 6, d: 3, h: 1.4, fill: 'leaf', layer: 2 });
  b.box({ id: 'ssd', part: 'ssd', x: 34, y: oy + 11, w: 6, d: 2.4, h: 0.9, fill: 'paperBright', layer: 2 });
  b.box({ id: 'store', part: 'net', x: 56, y: oy + 2, w: 9, d: 9, h: 7, fill: 'paperBright', layer: 3, ghost: true });
  b.link({ from: 'gpu0', to: 'pcie', bytesPerSecond: host.bandwidthBytesPerSecond!, basis: 'published', paths: ['host', 'ssd', 'object'] });
  b.link({ from: 'pcie', to: 'cpu', bytesPerSecond: host.bandwidthBytesPerSecond!, basis: 'published', paths: ['host'] });
  b.link({ from: 'pcie', to: 'ssd', bytesPerSecond: ssd.bandwidthBytesPerSecond!, basis: ssd.basis, paths: ['ssd'] });
  b.link({ from: 'pcie', to: 'nic', bytesPerSecond: object.bandwidthBytesPerSecond!, basis: object.basis, paths: ['object'] });
  b.link({ from: 'nic', to: 'store', bytesPerSecond: object.bandwidthBytesPerSecond!, basis: object.basis, dashed: true, paths: ['object'] });

  b.label('gpu', 'gpu0', 'left', 'This GPU', `reads its own memory at ${formatBandwidth(inputs.hbmPeakBytesPerSecond)}`, 'published');
  if (switched) {
    b.label('peers', 'gpu6', 'right', `${topology.peerCount} peer GPUs`, 'reached through the switch chips', 'published');
    b.label('switch', 'switch2', 'right', 'NVLink switch chips', `${formatBandwidth(peer.bandwidthBytesPerSecond!)} each way per GPU`, peer.basis);
  } else {
    b.label('peers', 'gpu6', 'right', `${topology.peerCount} peer GPUs, directly linked`, `one link to each, ${formatBandwidth(peer.bandwidthBytesPerSecond!)} each way`, peer.basis);
  }
  b.label('host', 'cpu', 'left', 'CPU and its memory', 'large, but reachable only through PCIe', 'schematic');
  b.label('pcie', 'pcie', 'left', 'PCIe Gen5 x16', `${formatBandwidth(host.bandwidthBytesPerSecond!)} each way, per GPU`, 'published');
  b.label('ssd', 'ssd', 'right', 'Local SSD', `~${formatBandwidth(ssd.bandwidthBytesPerSecond!)} per drive`, ssd.basis);
  b.label('net', 'store', 'right', 'Object storage, over the network', `~${formatBandwidth(object.bandwidthBytesPerSecond!)}, ~${object.firstByteLatencyMs} ms to first byte`, object.basis);

  return {
    id: 'server', scene: b.build(), defaultSelection: [PLACEMENT_PART[inputs.placement]], litPath: inputs.placement,
    note: 'Line thickness is proportional to the square root of bandwidth. Board layout is schematic.',
    sources: topology.sources,
  };
}

// ---------------------------------------------------------------------------
// Plate 2 · Package (exploded)
// ---------------------------------------------------------------------------
function stack(b: SceneBuilder, id: string, x: number, y: number, z: number, w: number, d: number, h: number, active: boolean, inputs: CutawayInputs): void {
  const base = { x, y, w, d, layer: 4 };
  b.box({ ...base, id: `${id}-base`, part: 'hbm', z, h: 0.6, fill: 'slate' });
  if (!active) {
    b.box({ ...base, id, part: 'unused', z: z + 0.6, h, fill: 'paper', ghost: true });
    return;
  }
  const m = inputs.memory;
  const parts: [number, Fill, string, boolean][] = [
    [m.weightsFraction, 'green', 'weights', false],
    [m.kvFraction, 'mustard', 'kv', false],
    [m.freeFraction, 'paperBright', 'free', false],
    [m.reserveFraction, 'paperDeep', 'reserve', true],
  ];
  let level = z + 0.6;
  for (const [fraction, fill, part, ghost] of parts) {
    if (fraction <= 0.0005) continue;
    b.box({ ...base, id: `${id}-${part}`, part, z: level, h: h * fraction, fill, ghost });
    level += h * fraction;
  }
  if (m.overflowBytes > 0) b.box({ ...base, id: `${id}-overflow`, part: 'overflow', z: level + 1.2, h: 1.6, fill: 'red', ghost: true, layer: 6 });
}

/** Labels the fill on the front-most left stack, aiming at each segment's visible face. */
function fillLabels(b: SceneBuilder, inputs: CutawayInputs, frontStack: string): void {
  const m = inputs.memory;
  const face = (part: string) => {
    const box = b.find((candidate) => candidate.id === `${frontStack}-${part}`);
    return box ? frontFace(box) : undefined;
  };
  if (m.weightsFraction > 0) b.label('weights', `${frontStack}-weights`, 'left', `Model weights · ${formatBytes(m.weightBytes)}`, 'every generated token reads all of it', 'published', face('weights'));
  if (m.kvFraction > 0) {
    const resident = m.kvFraction * m.physicalBytes;
    const who = `${inputs.users} ${inputs.users === 1 ? 'user' : 'users'} × ${inputs.contextTokens.toLocaleString()} tokens`;
    const detail = resident < m.kvBytesInGpuMemory ? `${who}; only ${formatBytes(resident)} fits here` : who;
    b.label('kv', `${frontStack}-kv`, 'left', `KV cache · ${formatBytes(m.kvBytes)}`, detail, 'published', face('kv'));
  }
  if (m.overflowBytes > 0) b.label('overflow', `${frontStack}-overflow`, 'left', `Doesn’t fit · ${formatBytes(m.overflowBytes)}`, 'this data must live off the package', 'published', face('overflow'));
  b.label('reserve', `${frontStack}-reserve`, 'left', 'Held back for the runtime', `${Math.round(m.reserveFraction * 100)}% of physical memory`, 'schematic', face('reserve'));
}

export function packagePlate(inputs: CutawayInputs): Plate {
  const topology = getTopology(inputs.hardwareId);
  return topology.computeDies === 1 ? monolithicPackage(inputs, topology) : chipletPackage(inputs, topology);
}

function monolithicPackage(inputs: CutawayInputs, topology: ChipTopology): Plate {
  const b = new SceneBuilder();
  b.box({ id: 'substrate', part: 'substrate', x: 0, y: 0, w: 60, d: 44, h: 1.4, fill: 'green' });
  const interposer = b.box({ id: 'interposer', part: 'interposer', x: 8, y: 6, w: 44, d: 32, h: 0.8, z: 5, fill: 'slate', layer: 1 });
  b.risers(interposer, 1.4);
  const top = interposer.z + interposer.h;
  const dz = top + 3.8;
  const die = b.box({ id: 'die', part: 'die', x: 19.5, y: 9, w: 21, d: 26, h: 1.1, z: dz, fill: 'red', layer: 3 });
  b.risers(die, top);
  const perSide = topology.hbmSites / 2;
  let site = 0;
  for (const side of [0, 1]) {
    for (let i = 0; i < perSide; i++) {
      const x = side === 0 ? 10 : 43;
      const y = 9.5 + i * 8.6;
      const active = site < topology.hbmActiveStacks;
      for (let k = 0; k < 3; k++) {
        const wy = y + 1.6 + k * 1.9;
        const [x0, x1] = side === 0 ? [x + 7, die.x] : [die.x + die.w, x];
        b.wire([x0, wy, top], [x1, wy, top]);
      }
      stack(b, `hbm${site}`, x, y, dz, 7, 7, 5.2, active, inputs);
      site++;
    }
  }
  b.label('die', 'die', 'right', 'GPU die', `${topology.enabledUnits} of ${topology.physicalUnits} SMs enabled`, 'published');
  b.label('hbm', 'hbm4-base', 'right', `Memory stack · ${topology.hbmGBPerStack} GB`, `${topology.hbmActiveStacks} × ${topology.hbmGBPerStack} GB, ${formatBandwidth(inputs.hbmPeakBytesPerSecond)} combined`, 'published');
  b.label('unused', `hbm${topology.hbmSites - 1}`, 'right', 'Unused site', `${topology.hbmSites} memory sites; ${topology.hbmActiveStacks} are used`, 'published');
  b.label('interposer', 'interposer', 'right', 'Silicon interposer', '1,024 wires per stack, millimeters long', 'published', [interposer.x + 4, interposer.y + interposer.d - 1.5, top]);
  fillLabels(b, inputs, `hbm${perSide - 1}`);
  b.label('substrate', 'substrate', 'left', 'Package substrate', 'out to the board: PCIe and NVLink', 'published', [3, 44 - 2.5, 1.4]);
  return {
    id: 'package', scene: b.build(), defaultSelection: [], litPath: null,
    note: 'Fill heights are computed from the model; data is striped across every active stack, so they fill evenly.',
    sources: topology.sources,
  };
}

function chipletPackage(inputs: CutawayInputs, topology: ChipTopology): Plate {
  const b = new SceneBuilder();
  b.box({ id: 'substrate', part: 'substrate', x: 0, y: 0, w: 62, d: 46, h: 1.4, fill: 'green' });
  const interposer = b.box({ id: 'interposer', part: 'interposer', x: 5, y: 5, w: 52, d: 36, h: 0.8, z: 5, fill: 'slate', layer: 1 });
  b.risers(interposer, 1.4);
  const iz = interposer.z + interposer.h + 3.4;
  const positions: [number, number][] = [[17, 8], [31.5, 8], [17, 23], [31.5, 23]];
  const diesPerIo = topology.computeDies / topology.ioDies;
  positions.slice(0, topology.ioDies).forEach(([x, y], i) => {
    const io = b.box({ id: `io${i}`, part: 'io', x, y, w: 13.5, d: 14, h: 1.0, z: iz, fill: 'mustard', layer: 3 });
    if (i === topology.ioDies - 1) b.risers(io, interposer.z + interposer.h);
    for (let k = 0; k < diesPerIo; k++) {
      const compute = b.box({ id: `xcd${i}-${k}`, part: 'compute-die', x: x + 0.8, y: y + 0.6 + k * 6.8, w: 11.9, d: 6.2, h: 0.9, z: iz + 4.2, fill: 'red', layer: 5 });
      if (i === topology.ioDies - 1 && k === diesPerIo - 1) b.risers(compute, iz + 1.0);
    }
  });
  const perSide = topology.hbmSites / 2;
  let site = 0;
  for (const side of [0, 1]) {
    for (let i = 0; i < perSide; i++) {
      stack(b, `hbm${site}`, side === 0 ? 7.5 : 47.5, 7.5 + i * 7.6, iz, 7, 6.6, 5.2, site < topology.hbmActiveStacks, inputs);
      site++;
    }
  }
  const perCompute = topology.enabledUnits / topology.computeDies;
  b.label('compute-die', 'xcd3-0', 'right', `Compute dies · ${topology.computeDies}`, `${perCompute} CUs enabled on each; ${topology.enabledUnits} total`, 'published');
  b.label('io', 'io1', 'right', `I/O dies · ${topology.ioDies}`, 'hold the 256 MB Infinity Cache', 'published');
  b.label('hbm', 'hbm7-base', 'right', `Memory stack · ${topology.hbmGBPerStack} GB`, `${topology.hbmActiveStacks} × ${topology.hbmGBPerStack} GB, ${formatBandwidth(inputs.hbmPeakBytesPerSecond)} combined`, 'published');
  fillLabels(b, inputs, `hbm${perSide - 1}`);
  b.label('interposer', 'interposer', 'left', 'Silicon interposer', 'joins the I/O dies to each other and to their memory', 'published', [interposer.x + 3, interposer.y + interposer.d - 1.5, interposer.z + interposer.h]);
  b.label('substrate', 'substrate', 'left', 'Package substrate', 'out to the board: PCIe and Infinity Fabric', 'published', [3, 46 - 2.5, 1.4]);
  return {
    id: 'package', scene: b.build(), defaultSelection: [], litPath: null,
    note: 'Compute dies are stacked on the I/O dies. Fill heights are computed from the model.',
    sources: topology.sources,
  };
}

// ---------------------------------------------------------------------------
// Plate 3 · Die
// ---------------------------------------------------------------------------
export interface DieOptions {
  job: 'prefill' | 'decode';
  /** Minimal drawings carry only the busy/waiting labels (used side by side). */
  detail: 'full' | 'minimal';
}

export function diePlate(inputs: CutawayInputs, options: DieOptions): Plate {
  const topology = getTopology(inputs.hardwareId);
  return topology.computeDies === 1 ? monolithicDie(inputs, topology, options) : computeDie(inputs, topology, options);
}

function unitFill(dead: boolean, busy: boolean): Fill {
  return dead ? 'paperBright' : busy ? 'red' : 'green';
}

function monolithicDie(inputs: CutawayInputs, topology: ChipTopology, options: DieOptions): Plate {
  const job = inputs[options.job];
  const b = new SceneBuilder();
  b.box({ id: 'die', x: 0, y: 0, w: 40, d: 31, h: 0.8 });
  const disabled = illustrativeDisabledUnits(topology.physicalUnits, topology.physicalUnits - topology.enabledUnits, 7);
  const clusters = topology.physicalUnits / topology.unitsPerCluster;
  let unit = 0;
  let enabledSeen = 0;
  for (let c = 0; c < clusters; c++) {
    const row = c < clusters / 2 ? 0 : 1;
    const col = c % (clusters / 2);
    const gx = 4 + col * 8.1;
    const gy = row === 0 ? 1.6 : 18.6;
    b.box({ id: `cluster${c}`, part: 'cluster', x: gx, y: gy, w: 7.7, d: 10.8, h: 0.3, z: 0.8, fill: 'paper', layer: 1 });
    for (let i = 0; i < topology.unitsPerCluster; i++) {
      const dead = disabled.has(unit);
      const busy = !dead && enabledSeen++ < job.busyUnits;
      b.box({
        id: `unit${unit}`, part: dead ? 'unit-off' : busy ? 'unit-busy' : 'unit-wait', layer: 2,
        x: gx + 0.35 + (i % 6) * 1.2, y: gy + 0.4 + Math.floor(i / 6) * 3.45, z: 1.1, w: 1.0, d: 3.1, h: 0.9,
        fill: unitFill(dead, busy), ghost: dead,
      });
      unit++;
    }
  }
  b.box({ id: 'l2-a', part: 'l2', x: 4, y: 13.4, w: 15.9, d: 4.2, h: 1.1, z: 0.8, fill: 'mustard', layer: 2 });
  b.box({ id: 'l2-b', part: 'l2', x: 20.3, y: 13.4, w: 15.9, d: 4.2, h: 1.1, z: 0.8, fill: 'mustard', layer: 2 });
  const controllers = topology.memoryControllers ?? 0;
  const perSide = controllers / 2;
  for (let side = 0; side < 2; side++) {
    for (let i = 0; i < perSide; i++) {
      const index = side * perSide + i;
      const active = index < (topology.memoryControllersActive ?? 0);
      b.box({ id: `mc${index}`, part: 'mc', x: side === 0 ? 0.6 : 37, y: 1.6 + i * 4.8, w: 2.4, d: 4.2, h: 0.9, z: 0.8, layer: 2, fill: active ? 'slate' : 'paperBright', ghost: !active });
    }
  }
  busyLabels(b, job, topology.enabledUnits, 'SMs');
  if (options.detail === 'full') {
    // Anchor on the last disabled unit so its marker stays clear of the busy ones.
    const lastDead = [...disabled].sort((a, z) => a - z).at(-1);
    b.label('unit-off', `unit${lastDead}`, 'left', 'Disabled SM', `${topology.physicalUnits - topology.enabledUnits} of ${topology.physicalUnits} are off; positions vary per chip`, 'published');
    b.label('cluster', 'cluster3', 'right', `Cluster of ${topology.unitsPerCluster} SMs`, `${clusters} clusters on the die`, 'published');
    b.label('l2', 'l2-b', 'right', `L2 cache · ${topology.l2MBPerComputeDie} MB`, 'shared by every SM, in two halves', 'published');
    b.label('mc', 'mc2', 'left', 'Memory controllers', `${topology.memoryControllersActive} of ${controllers} active: two per memory stack`, 'published');
  }
  return {
    id: 'die', scene: b.build(), defaultSelection: [], litPath: null,
    note: 'Layout follows NVIDIA’s published block diagram. Disabled-unit positions are illustrative; shading is a share of time.',
    sources: topology.sources,
  };
}

function computeDie(inputs: CutawayInputs, topology: ChipTopology, options: DieOptions): Plate {
  const job = inputs[options.job];
  const b = new SceneBuilder();
  const below = b.box({ id: 'io-below', part: 'io', x: -2, y: -2, w: 38, d: 26, h: 1.2, z: -5, fill: 'mustard', layer: -1 });
  b.guide([[0, 22, below.z + below.h], [0, 22, 0]]);
  b.guide([[34, 0, below.z + below.h], [34, 0, 0]]);
  b.box({ id: 'compute-die', x: 0, y: 0, w: 34, d: 22, h: 0.8 });
  const perDie = topology.unitsPerCluster;
  const disabledCount = perDie - topology.enabledUnits / topology.computeDies;
  const disabled = illustrativeDisabledUnits(perDie, disabledCount, 11);
  let enabledSeen = 0;
  for (let unit = 0; unit < perDie; unit++) {
    const half = unit < perDie / 2 ? 0 : 1;
    const local = unit % (perDie / 2);
    const dead = disabled.has(unit);
    const busy = !dead && enabledSeen++ < job.busyUnitsPerCluster;
    b.box({
      id: `unit${unit}`, part: dead ? 'unit-off' : busy ? 'unit-busy' : 'unit-wait', layer: 2,
      x: 1.2 + (local % 10) * 3.18, y: (half === 0 ? 1 : 13.6) + Math.floor(local / 10) * 3.8, z: 0.8, w: 2.8, d: 3.4, h: 1.0,
      fill: unitFill(dead, busy), ghost: dead,
    });
  }
  b.box({ id: 'l2', part: 'l2', x: 1.2, y: 9.1, w: 31.6, d: 3.8, h: 1.2, z: 0.8, fill: 'mustard', layer: 2 });
  const enabledPerDie = perDie - disabledCount;
  busyLabels(b, { ...job, busyUnits: job.busyUnitsPerCluster }, enabledPerDie, 'CUs');
  if (options.detail === 'full') {
    const firstDead = [...disabled].sort((a, z) => a - z)[0];
    b.label('unit-off', `unit${firstDead}`, 'left', 'Disabled CU', `${disabledCount} of ${perDie} per die; positions vary`, 'published');
    b.label('l2', 'l2', 'right', `L2 cache · ${topology.l2MBPerComputeDie} MB`, 'shared by this die’s CUs only', 'published');
    b.label('io', 'io-below', 'left', 'I/O die underneath', 'the path to Infinity Cache and memory', 'published');
  }
  return {
    id: 'die', scene: b.build(), defaultSelection: [], litPath: null,
    note: `One of ${topology.computeDies} compute dies; all share the same work. CU arrangement is schematic; shading is a share of time.`,
    sources: topology.sources,
  };
}

function busyLabels(b: SceneBuilder, job: { busyUnits: number }, enabled: number, unitName: string): void {
  const busy = b.find((box) => box.part === 'unit-busy');
  const waiting = [...b.build().boxes].reverse().find((box) => box.part === 'unit-wait');
  if (busy) b.label('unit-busy', busy.id, 'left', `Doing math · ${job.busyUnits} of ${enabled} ${unitName}`, 'the share of the step spent computing', 'published');
  if (waiting) b.label('unit-wait', waiting.id, 'right', `Waiting on memory · ${enabled - job.busyUnits}`, 'shading is a share of time, not specific units', 'published');
}

// ---------------------------------------------------------------------------
// Plate 4 · One compute unit, with a "follow one tile" path
// ---------------------------------------------------------------------------
export interface TileStep {
  title: string;
  text: string;
  parts: string[];
}

export const TILE_STEPS: Record<string, TileStep[]> = {
  'h100-sxm': [
    { title: 'GPU memory', text: 'Weights and KV cache start in the memory stacks beside the die (package plate).', parts: [] },
    { title: 'L2 cache', text: 'The tile passes through the 50 MB L2 shared by every SM (die plate).', parts: [] },
    { title: 'Shared memory', text: 'The Tensor Memory Accelerator copies the tile into this SM’s scratchpad: up to 228 KB.', parts: ['smem', 'tma'] },
    { title: 'Registers', text: 'Each quadrant loads its piece into a 64 KB register file, the only place the math can read from.', parts: ['registers'] },
    { title: 'Tensor cores', text: 'The multiply-accumulate happens here. Results go back to registers, then out.', parts: ['matrix'] },
  ],
  mi300x: [
    { title: 'GPU memory', text: 'Weights and KV cache start in the memory stacks beside the I/O dies (package plate).', parts: [] },
    { title: 'Infinity Cache', text: '256 MB on the I/O dies, shared by all eight compute dies.', parts: [] },
    { title: 'L2 cache', text: '4 MB on this compute die, shared by its CUs (die plate).', parts: [] },
    { title: 'Local Data Share', text: 'The tile is staged in this CU’s 64 KB scratchpad.', parts: ['smem'] },
    { title: 'Registers', text: 'Each SIMD loads its piece into registers: 512 KB across the CU.', parts: ['registers'] },
    { title: 'Matrix cores', text: 'The multiply-accumulate happens here. Results go back to registers, then out.', parts: ['matrix'] },
  ],
};

export function unitPlate(hardwareId: string, tileStep: number): Plate {
  const topology = getTopology(hardwareId);
  const steps = TILE_STEPS[hardwareId];
  if (!steps) throw new Error(`No tile path for hardware "${hardwareId}"`);
  const step = steps[Math.max(0, Math.min(steps.length - 1, tileStep))]!;
  const b = new SceneBuilder();
  if (topology.computeDies === 1) {
    b.box({ id: 'sm', x: 0, y: 0, w: 26, d: 24, h: 0.8 });
    for (let q = 0; q < topology.unitPartitions; q++) {
      const qx = 1 + (q % 2) * 12.5;
      const qy = 1 + Math.floor(q / 2) * 8.4;
      b.box({ id: `quadrant${q}`, x: qx, y: qy, w: 11.5, d: 7.8, h: 0.3, z: 0.8, fill: 'paper', layer: 1 });
      b.box({ id: `registers${q}`, part: 'registers', x: qx + 0.5, y: qy + 0.6, w: 2.6, d: 6.6, h: 3.2, z: 1.1, fill: 'mustard', layer: 2 });
      b.box({ id: `matrix${q}`, part: 'matrix', x: qx + 7.2, y: qy + 0.6, w: 3.8, d: 4.2, h: 2.4, z: 1.1, fill: 'red', layer: 2 });
      b.box({ id: `scheduler${q}`, part: 'scheduler', x: qx + 7.2, y: qy + 5.4, w: 3.8, d: 1.8, h: 0.8, z: 1.1, fill: 'slate', layer: 2 });
      for (let lane = 0; lane < (topology.vectorLanesPerPartition ?? 32); lane++) {
        b.box({ id: `lane${q}-${lane}`, part: 'lanes', x: qx + 3.6 + Math.floor(lane / 8) * 0.85, y: qy + 0.6 + (lane % 8) * 0.83, w: 0.6, d: 0.6, h: 0.9, z: 1.1, fill: 'green', layer: 2 });
      }
    }
    b.box({ id: 'smem', part: 'smem', x: 1, y: 18.2, w: 18.5, d: 4.8, h: 1.4, z: 0.8, fill: 'leaf', layer: 2 });
    b.box({ id: 'tma', part: 'tma', x: 20.5, y: 18.2, w: 4.5, d: 4.8, h: 1.0, z: 0.8, fill: 'slate', layer: 2 });
    b.label('matrix', 'matrix1', 'right', 'Tensor core', `${topology.unitPartitions} per SM: the matrix math`, 'published');
    b.label('registers', 'registers1', 'right', 'Register file · 64 KB', 'per quadrant; 256 KB per SM', 'published');
    b.label('lanes', 'lane0-4', 'left', `${topology.vectorLanesPerPartition} vector lanes`, 'per quadrant, for non-matrix math', 'published');
    b.label('scheduler', 'scheduler2', 'left', 'Warp scheduler', 'picks which 32 threads run next', 'published');
    b.label('smem', 'smem', 'left', 'Shared memory · up to 228 KB', 'the scratchpad for tiles', 'published');
    b.label('tma', 'tma', 'right', 'Tensor Memory Accelerator', 'copies tiles into shared memory', 'published');
  } else {
    b.box({ id: 'cu', x: 0, y: 0, w: 26, d: 22, h: 0.8 });
    for (let s = 0; s < topology.unitPartitions; s++) {
      const sx = 1 + s * 6.2;
      b.box({ id: `simd${s}`, x: sx, y: 1, w: 5.6, d: 13, h: 0.3, z: 0.8, fill: 'paper', layer: 1 });
      b.box({ id: `registers${s}`, part: 'registers', x: sx + 0.5, y: 1.6, w: 4.6, d: 4.4, h: 3.4, z: 1.1, fill: 'mustard', layer: 2 });
      b.box({ id: `matrix${s}`, part: 'matrix', x: sx + 0.5, y: 6.6, w: 4.6, d: 4.2, h: 2.4, z: 1.1, fill: 'red', layer: 2 });
      for (let lane = 0; lane < 8; lane++) {
        b.box({ id: `lane${s}-${lane}`, part: 'lanes', x: sx + 0.6 + (lane % 4) * 1.12, y: 11.4 + Math.floor(lane / 4) * 1.2, w: 0.8, d: 0.8, h: 0.9, z: 1.1, fill: 'green', layer: 2 });
      }
    }
    b.box({ id: 'smem', part: 'smem', x: 1, y: 15.2, w: 14, d: 5.6, h: 1.4, z: 0.8, fill: 'leaf', layer: 2 });
    b.box({ id: 'l1', part: 'l1', x: 16, y: 15.2, w: 9, d: 5.6, h: 1.0, z: 0.8, fill: 'slate', layer: 2 });
    b.label('matrix', 'matrix1', 'right', 'Matrix core', `${topology.unitPartitions} per CU: the matrix math`, 'published');
    b.label('registers', 'registers3', 'right', 'Vector registers', '512 KB per CU', 'published');
    b.label('lanes', 'lane0-1', 'left', `SIMD units · ${topology.unitPartitions}`, 'vector lanes; 64 threads per wavefront (lanes drawn schematically)', 'schematic');
    b.label('smem', 'smem', 'left', 'Local Data Share · 64 KB', 'the scratchpad for tiles', 'published');
    b.label('l1', 'l1', 'right', 'L1 cache · 32 KB', 'per CU', 'published');
  }
  return {
    id: 'unit', scene: b.build(), defaultSelection: step.parts, litPath: null,
    note: topology.computeDies === 1
      ? 'Quadrant layout after NVIDIA’s SM diagram; relative sizes are stylized.'
      : 'Four SIMDs per CU inferred from 1,216 matrix cores across 304 CUs. Layout is schematic.',
    sources: topology.sources,
  };
}

/** Every labeled part must exist on the plate; used by tests and the renderer. */
export function unresolvedLabels(scene: Scene): string[] {
  const ids = new Set(scene.boxes.map((box: SceneBox) => box.id));
  const parts = new Set(scene.boxes.map((box) => box.part).filter(Boolean));
  return scene.labels.filter((label) => !ids.has(label.anchor) || !parts.has(label.part)).map((label) => label.part);
}

