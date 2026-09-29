// What each hardware part is called, what it is, what it does, and why it
// matters for inference. Keys match the `part` ids drawn on the cutaway
// plates. Terms are the names engineers will meet in docs, profilers, and
// vendor material; where vendors differ, both names are given.

export type Vendor = 'NVIDIA' | 'AMD';

export interface PartTerm {
  term: string;
  meaning: string;
}

export interface PartEntry {
  name: string;
  terms: PartTerm[];
  what: string;
  does: string;
  inference: string;
  /** A common confusion worth heading off. */
  note?: string;
}

type EntrySource = PartEntry | ((vendor: Vendor) => PartEntry);

const PARTS: Record<string, EntrySource> = {
  // ---- Server ---------------------------------------------------------------
  gpu: (vendor) => ({
    name: 'The GPU',
    terms: [
      { term: 'GPU', meaning: 'graphics processing unit; here, a data-center accelerator with no display output' },
      { term: 'accelerator', meaning: 'the general name for a chip that offloads math from the CPU' },
      vendor === 'NVIDIA'
        ? { term: 'SXM', meaning: 'NVIDIA’s socketed module form factor for data-center GPUs' }
        : { term: 'OAM', meaning: 'OCP Accelerator Module, the open form factor AMD Instinct GPUs use' },
    ],
    what: 'One accelerator module: compute silicon and its memory on a single package, mounted on the server’s GPU board.',
    does: 'Runs the model’s math. The CPU only tells it what to run.',
    inference: 'Model weights and each conversation’s KV cache live in this module’s own memory, so everything it needs per token is close by.',
  }),
  peers: (vendor) => ({
    name: 'The other GPUs in the server',
    terms: vendor === 'NVIDIA'
      ? [
        { term: 'NVLink', meaning: 'NVIDIA’s GPU-to-GPU link' },
        { term: 'scale-up', meaning: 'connecting GPUs inside one server or rack with fast links' },
      ]
      : [
        { term: 'Infinity Fabric', meaning: 'AMD’s interconnect, used here as direct GPU-to-GPU links' },
        { term: 'xGMI', meaning: 'the name AMD software and tools use for these GPU-to-GPU links' },
        { term: 'scale-up', meaning: 'connecting GPUs inside one server or rack with fast links' },
      ],
    what: 'Seven more GPUs on the same board, reachable over dedicated GPU-to-GPU links.',
    does: 'Lets GPUs share work and memory without going through the CPU.',
    inference: 'Models too big for one GPU are split across several (tensor or pipeline parallelism), and their traffic crosses these links every step.',
  }),
  switch: {
    name: 'Switch chips',
    terms: [{ term: 'NVSwitch', meaning: 'NVIDIA’s switch chip that connects every GPU’s NVLink ports' }],
    what: 'Chips on the GPU board that route NVLink traffic between any pair of GPUs.',
    does: 'Gives every GPU full NVLink bandwidth to any other GPU, rather than one link per pair.',
    inference: 'Explains why, on NVIDIA systems, reading from one peer is as fast as reading from all of them.',
  },
  host: {
    name: 'The CPU and its memory',
    terms: [
      { term: 'host', meaning: 'the CPU side of the server, as opposed to the GPU (the “device”)' },
      { term: 'DRAM', meaning: 'ordinary system memory attached to the CPU' },
      { term: 'system memory', meaning: 'the same thing, from the GPU’s point of view' },
    ],
    what: 'The server’s CPU and its large, ordinary memory.',
    does: 'Runs the serving software, receives requests, and launches work on the GPU.',
    inference: 'Its memory is big but far from the GPU: data parked here must come back over PCIe before the GPU can use it.',
  },
  pcie: {
    name: 'The host link',
    terms: [
      { term: 'PCIe', meaning: 'PCI Express, the standard bus between the CPU and add-in devices' },
      { term: 'Gen5 x16', meaning: 'fifth-generation PCIe with 16 lanes, about 64 GB/s each way' },
    ],
    what: 'The bus connecting each GPU to the CPU, storage, and network.',
    does: 'Carries commands from the CPU and any data that has to enter or leave the GPU.',
    inference: 'Anything read from system memory, local disk, or the network crosses this link, which is tens of times slower than the GPU’s own memory.',
  },
  ssd: {
    name: 'Local storage',
    terms: [{ term: 'NVMe SSD', meaning: 'a flash drive on the PCIe bus' }],
    what: 'Flash drives inside the server.',
    does: 'Holds model files and anything too large or too idle to keep in memory.',
    inference: 'Useful for parking idle conversations; far too slow to feed each later pass directly.',
  },
  net: {
    name: 'Network and object storage',
    terms: [
      { term: 'NIC', meaning: 'network interface card' },
      { term: 'object storage', meaning: 'network file storage such as Amazon S3, reached over HTTP' },
      { term: 'scale-out', meaning: 'connecting many servers over the network' },
    ],
    what: 'The server’s network card and, beyond it, storage services across the data center.',
    does: 'Brings requests in, sends responses out, and reaches remote storage.',
    inference: 'Object storage has effectively unlimited capacity but tens to hundreds of milliseconds to the first byte: fine for archives, impossible for active KV cache.',
  },

  // ---- Package --------------------------------------------------------------
  die: {
    name: 'The GPU die',
    terms: [
      { term: 'die', meaning: 'one piece of silicon cut from a wafer' },
      { term: 'GH100', meaning: 'the NVIDIA Hopper die used in H100 and H200' },
    ],
    what: 'The single large piece of silicon holding every compute unit, the shared cache, and the memory controllers.',
    does: 'Does all of the GPU’s computing.',
    inference: 'Every token’s math happens here, but only after its data has come in from the memory stacks beside it.',
  },
  'compute-die': {
    name: 'The compute dies',
    terms: [
      { term: 'XCD', meaning: 'Accelerator Complex Die, AMD’s compute chiplet' },
      { term: 'chiplet', meaning: 'one of several smaller dies packaged to act as one chip' },
    ],
    what: 'Eight compute chiplets, each with its own compute units and L2 cache, stacked on top of the I/O dies.',
    does: 'Does all of the GPU’s computing; software still sees one GPU.',
    inference: 'Data shared between chiplets meets in the Infinity Cache below them, one level farther away than an L2 on a single die.',
  },
  io: {
    name: 'The I/O dies',
    terms: [
      { term: 'IOD', meaning: 'I/O die' },
      { term: 'Infinity Cache', meaning: 'AMD’s large shared cache, placed on the I/O dies' },
      { term: 'MALL', meaning: 'memory-attached last-level cache, AMD’s term for how Infinity Cache works' },
    ],
    what: 'The base dies the compute chiplets sit on. They hold the memory controllers, the Infinity Cache, and the links between chiplets.',
    does: 'Connects the compute chiplets to each other, to memory, and to the outside world.',
    inference: 'The Infinity Cache catches repeated reads before they reach memory, which helps shared data but cannot hold a whole model.',
  },
  hbm: {
    name: 'Memory stacks',
    terms: [
      { term: 'HBM', meaning: 'high-bandwidth memory: DRAM dies stacked vertically on a base die' },
      { term: 'HBM3 / HBM3E', meaning: 'current generations of HBM' },
      { term: 'device memory', meaning: 'the GPU’s own memory, as opposed to the host’s' },
      { term: 'VRAM', meaning: 'an older, informal name for GPU memory' },
      { term: 'global memory', meaning: 'the programming-model name for this memory' },
    ],
    what: 'Stacks of memory dies sitting millimeters from the compute silicon, each joined to it by a very wide bus.',
    does: 'Holds everything the GPU works on: model weights, the KV cache, and activations.',
    inference: 'Its capacity decides what fits, and its bandwidth sets how fast each token can be written, because every token re-reads the weights and KV cache from here.',
    note: 'The speed comes from width and distance: thousands of short wires through the interposer, not a faster clock.',
  },
  unused: {
    name: 'An unused memory site',
    terms: [{ term: 'HBM site', meaning: 'a position on the package wired for a memory stack' }],
    what: 'A place on the package where a memory stack could sit, left unused on this product.',
    does: 'Nothing on this product; the same die is sold in versions that use all sites.',
    inference: 'Explains why two GPUs built on the same die can have different memory capacity and bandwidth.',
  },
  interposer: {
    name: 'Silicon interposer',
    terms: [
      { term: 'interposer', meaning: 'a thin slab of silicon that wires dies together side by side' },
      { term: '2.5D packaging', meaning: 'dies placed side by side on an interposer, as opposed to stacked (3D)' },
      { term: 'CoWoS', meaning: 'TSMC’s chip-on-wafer-on-substrate packaging, used for these GPUs' },
    ],
    what: 'A layer of silicon under the compute silicon and the memory stacks, patterned with extremely fine wiring.',
    does: 'Connects each memory stack to the compute silicon with a bus about a thousand wires wide.',
    inference: 'This wiring is what makes the GPU’s own memory so much faster than anything off the package.',
  },
  substrate: (vendor) => ({
    name: 'Package substrate',
    terms: [
      { term: 'substrate', meaning: 'the package’s base layer that fans connections out to the board' },
      vendor === 'NVIDIA'
        ? { term: 'SXM', meaning: 'the module it mounts into' }
        : { term: 'OAM', meaning: 'the module it mounts into' },
    ],
    what: 'The package’s base, carrying power and signals between the silicon and the board.',
    does: 'Connects the GPU to PCIe, to the GPU-to-GPU links, and to power.',
    inference: 'Every byte that leaves the package goes through here onto much slower links.',
  }),

  // ---- Die ------------------------------------------------------------------
  unit: (vendor) => ({
    name: vendor === 'NVIDIA' ? 'Streaming multiprocessor' : 'Compute unit',
    terms: vendor === 'NVIDIA'
      ? [
        { term: 'SM', meaning: 'streaming multiprocessor, NVIDIA’s basic compute block' },
        { term: 'CUDA cores', meaning: 'marketing name for the vector lanes inside each SM' },
      ]
      : [
        { term: 'CU', meaning: 'compute unit, AMD’s basic compute block' },
        { term: 'stream processors', meaning: 'marketing name for the vector lanes inside each CU' },
      ],
    what: 'The repeated worker on the die: its own math units, registers, scratchpad, and scheduler.',
    does: 'Runs blocks of a kernel. A kernel launches thousands of blocks, and the hardware deals them out across every unit.',
    inference: 'All units work on every step. When a step is waiting on memory, adding units does not help; supplying data faster does.',
    note: vendor === 'NVIDIA'
      ? '“CUDA cores” are lanes inside an SM, not separate processors. Count SMs to compare GPUs.'
      : '“Stream processors” are lanes inside a CU, not separate processors. Count CUs to compare GPUs.',
  }),
  'unit-off': {
    name: 'Disabled units',
    terms: [
      { term: 'binning', meaning: 'sorting chips by how many units work, and selling them accordingly' },
      { term: 'yield', meaning: 'the share of manufactured chips that work' },
    ],
    what: 'Units that exist on the silicon but are switched off on this product.',
    does: 'Nothing; a few units per chip are expected to have defects, so every chip ships with some off.',
    inference: 'Performance figures use the enabled count, not the physical one.',
  },
  cluster: {
    name: 'A cluster of SMs',
    terms: [{ term: 'GPC', meaning: 'graphics processing cluster, NVIDIA’s group of SMs' }],
    what: 'A group of SMs that share some scheduling hardware.',
    does: 'Organizes the die into regions; a kernel’s blocks are spread across all of them.',
    inference: 'Rarely something you tune for directly, but it shows up in NVIDIA’s block diagrams and profiler output.',
  },
  l2: (vendor) => ({
    name: 'L2 cache',
    terms: vendor === 'NVIDIA'
      ? [
        { term: 'L2', meaning: 'level-2 cache, shared by every SM' },
        { term: 'LLC', meaning: 'last-level cache: on NVIDIA, the L2 is the last stop before memory' },
      ]
      : [
        { term: 'L2', meaning: 'level-2 cache, shared by the CUs on one compute die' },
      ],
    what: 'On-chip memory shared by the compute units, much faster than the memory stacks but far smaller.',
    does: 'Keeps recently used data close, so repeated reads do not go back to memory.',
    inference: 'Holds tiles and small shared data, but a model’s weights are thousands of times larger, so each token still streams them from memory.',
  }),
  mc: {
    name: 'Memory controllers',
    terms: [
      { term: 'memory controller', meaning: 'the logic that issues reads and writes to memory' },
      { term: 'PHY', meaning: 'the physical interface circuitry at the die edge' },
    ],
    what: 'Circuits along the die’s edge, two per memory stack.',
    does: 'Turn the die’s requests into signals on each memory stack’s wide bus.',
    inference: 'Every byte of weights and KV cache enters the die through them.',
  },

  // ---- Compute unit ---------------------------------------------------------
  matrix: (vendor) => ({
    name: 'Matrix units',
    terms: vendor === 'NVIDIA'
      ? [
        { term: 'Tensor Core', meaning: 'NVIDIA’s matrix multiply-accumulate unit' },
        { term: 'MMA', meaning: 'matrix multiply-accumulate, the operation they perform' },
      ]
      : [
        { term: 'Matrix Core', meaning: 'AMD’s matrix multiply-accumulate unit' },
        { term: 'MFMA', meaning: 'matrix fused multiply-add, AMD’s instruction family for them' },
      ],
    what: 'Hardware that multiplies small blocks of matrices in one instruction.',
    does: 'Does nearly all of a transformer’s arithmetic.',
    inference: 'They are fast enough to sit idle through most of each later pass, waiting for data.',
  }),
  registers: (vendor) => ({
    name: 'Register file',
    terms: vendor === 'NVIDIA'
      ? [{ term: 'registers', meaning: 'the fastest storage, private to each thread' }]
      : [
        { term: 'registers', meaning: 'the fastest storage, private to each thread' },
        { term: 'VGPR', meaning: 'vector general-purpose register, AMD’s name' },
      ],
    what: 'The small, fastest memory right next to the math units.',
    does: 'Holds the values the math units are working on right now; math can only read from here.',
    inference: 'Every weight used in a token’s math passes through registers, after being copied up from memory.',
  }),
  lanes: (vendor) => ({
    name: 'Vector lanes',
    terms: vendor === 'NVIDIA'
      ? [
        { term: 'CUDA cores', meaning: 'NVIDIA’s name for these lanes' },
        { term: 'SIMT', meaning: 'single instruction, multiple threads: lanes run the same instruction together' },
      ]
      : [
        { term: 'SIMD', meaning: 'single instruction, multiple data: AMD’s vector units' },
        { term: 'stream processors', meaning: 'AMD’s marketing name for these lanes' },
      ],
    what: 'Many simple arithmetic lanes that run the same instruction together.',
    does: 'Handle the math that is not matrix multiplication: normalization, activation functions, softmax.',
    inference: 'Small in time compared with matrix math, but they add up in memory-bound steps.',
  }),
  scheduler: {
    name: 'Scheduler',
    terms: [
      { term: 'warp scheduler', meaning: 'picks which group of threads runs next' },
      { term: 'warp', meaning: 'a group of 32 threads that run in lockstep (NVIDIA)' },
      { term: 'wavefront', meaning: 'the AMD equivalent, 64 threads' },
    ],
    what: 'Logic that chooses which group of threads issues an instruction each cycle.',
    does: 'Switches to another group whenever one is waiting for data, hiding some of that wait.',
    inference: 'Hides short waits, but cannot hide a step that is limited by memory bandwidth overall.',
  },
  smem: (vendor) => ({
    name: 'Scratchpad memory',
    terms: vendor === 'NVIDIA'
      ? [
        { term: 'shared memory', meaning: 'NVIDIA’s name: fast memory shared by one block’s threads' },
        { term: 'SRAM', meaning: 'the kind of memory it is built from' },
      ]
      : [
        { term: 'LDS', meaning: 'local data share, AMD’s name for it' },
        { term: 'SRAM', meaning: 'the kind of memory it is built from' },
      ],
    what: 'Fast on-chip memory that software manages directly, shared by the threads of one block.',
    does: 'Holds tiles of data so they can be reused many times without going back to memory.',
    inference: 'Fused attention kernels keep their intermediate scores here instead of writing them to memory.',
  }),
  tma: {
    name: 'Tensor Memory Accelerator',
    terms: [{ term: 'TMA', meaning: 'NVIDIA Hopper’s hardware for copying tiles into shared memory' }],
    what: 'A copy engine inside each SM.',
    does: 'Moves whole tiles from memory into shared memory without tying up threads.',
    inference: 'Lets the math units keep working while the next tile of weights is on its way.',
  },
  l1: {
    name: 'L1 cache',
    terms: [{ term: 'L1', meaning: 'level-1 cache, private to one compute unit' }],
    what: 'A small cache inside each compute unit.',
    does: 'Keeps the most recently read data closest to the math.',
    inference: 'Helps small, reused data; streamed weights pass through too quickly to benefit.',
  },
};

export function partEntry(part: string, vendor: Vendor): PartEntry | undefined {
  const source = PARTS[part];
  if (!source) return undefined;
  return typeof source === 'function' ? source(vendor) : source;
}
