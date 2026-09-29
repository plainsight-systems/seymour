// Published physical topology for each accelerator, used to draw the cutaway
// plates. Counts come from vendor documents; positions on the plates are
// stylized. Keep this file consistent with HARDWARE_PROFILES (tested).

export interface TopologySource {
  label: string;
  url: string;
}

export interface ChipTopology {
  hardwareId: string;
  /** Compute units physically on the silicon, and how many are enabled. */
  physicalUnits: number;
  enabledUnits: number;
  /** How units are grouped on a die (GPC on NVIDIA, one XCD on AMD). */
  unitsPerCluster: number;
  clusterName: string;
  computeDies: number;
  ioDies: number;
  hbmSites: number;
  hbmActiveStacks: number;
  hbmGBPerStack: number;
  /** 'derived' when the vendor states capacity but not the stack count. */
  stackCountBasis: 'published' | 'derived';
  stackCountNote?: string;
  /** Drawn only where the vendor publishes the count. */
  memoryControllers?: number;
  memoryControllersActive?: number;
  l2MBPerComputeDie: number;
  peerCount: number;
  /** Inside one compute unit. */
  unitPartitions: number;
  /** Published only where a vendor document states it. */
  vectorLanesPerPartition?: number;
  sources: TopologySource[];
}

const HOPPER_WHITEPAPER: TopologySource = {
  label: 'NVIDIA H100 Tensor Core GPU Architecture whitepaper',
  url: 'https://resources.nvidia.com/en-us-hopper-architecture/nvidia-h100-tensor-c',
};
const ROCM_MI300: TopologySource = {
  label: 'AMD ROCm: MI300 series microarchitecture',
  url: 'https://rocm.docs.amd.com/en/latest/reference/gpu-arch/mi300.html',
};
const ROCM_SPECS: TopologySource = {
  label: 'AMD ROCm: GPU architecture specifications',
  url: 'https://rocm.docs.amd.com/en/latest/reference/gpu-arch-specs.html',
};
const H200_SPECS: TopologySource = {
  label: 'NVIDIA H200 product specifications',
  url: 'https://www.nvidia.com/en-us/data-center/h200/',
};
const MI325X_DATASHEET: TopologySource = {
  label: 'AMD Instinct MI325X data sheet',
  url: 'https://www.amd.com/content/dam/amd/en/documents/instinct-tech-docs/product-briefs/instinct-mi325x-datasheet.pdf',
};
const MI355X_BROCHURE: TopologySource = {
  label: 'AMD Instinct MI355X GPU brochure',
  url: 'https://www.amd.com/content/dam/amd/en/documents/instinct-tech-docs/product-briefs/amd-instinct-mi355x-gpu-brochure.pdf',
};
const CDNA3_ANALYSIS: TopologySource = {
  label: 'Chips and Cheese: AMD’s CDNA 3 compute architecture',
  url: 'https://chipsandcheese.com/p/amds-cdna-3-compute-architecture',
};

export const TOPOLOGIES: ChipTopology[] = [
  {
    hardwareId: 'h100-sxm',
    // "8 GPCs, 72 TPCs (9 TPCs/GPC), 2 SMs/TPC, 144 SMs per full GPU";
    // H100 SXM5: "132 SMs", "5 HBM3 stacks, 10 512-bit Memory Controllers".
    physicalUnits: 144,
    enabledUnits: 132,
    unitsPerCluster: 18,
    clusterName: 'GPC',
    computeDies: 1,
    ioDies: 0,
    hbmSites: 6,
    hbmActiveStacks: 5,
    hbmGBPerStack: 16,
    stackCountBasis: 'published',
    memoryControllers: 12,
    memoryControllersActive: 10,
    l2MBPerComputeDie: 50,
    peerCount: 7,
    unitPartitions: 4,
    vectorLanesPerPartition: 32,
    sources: [HOPPER_WHITEPAPER],
  },
  {
    hardwareId: 'mi300x',
    // 8 XCDs on 4 IODs; "40 CUs: 38 active"; "4 MB L2" per XCD; 8 HBM3 stacks;
    // 7 Infinity Fabric links in a fully connected 8-GPU platform.
    physicalUnits: 320,
    enabledUnits: 304,
    unitsPerCluster: 40,
    clusterName: 'XCD',
    computeDies: 8,
    ioDies: 4,
    hbmSites: 8,
    hbmActiveStacks: 8,
    hbmGBPerStack: 24,
    stackCountBasis: 'published',
    l2MBPerComputeDie: 4,
    peerCount: 7,
    // 1,216 matrix cores across 304 CUs: four SIMD units, each with a matrix core.
    unitPartitions: 4,
    sources: [ROCM_MI300, ROCM_SPECS, CDNA3_ANALYSIS],
  },
  {
    hardwareId: 'h200-sxm',
    // The same GH100 die as H100 SXM (132 of 144 SMs); all six memory sites used.
    physicalUnits: 144,
    enabledUnits: 132,
    unitsPerCluster: 18,
    clusterName: 'GPC',
    computeDies: 1,
    ioDies: 0,
    hbmSites: 6,
    hbmActiveStacks: 6,
    hbmGBPerStack: 24,
    stackCountBasis: 'derived',
    stackCountNote: '141 GB usable, drawn as six 24 GB stacks filling the die’s six sites',
    l2MBPerComputeDie: 50,
    peerCount: 7,
    unitPartitions: 4,
    vectorLanesPerPartition: 32,
    sources: [H200_SPECS, HOPPER_WHITEPAPER],
  },
  {
    hardwareId: 'mi325x',
    // Eight XCDs with 38 CUs each, on the MI300 package design.
    physicalUnits: 320,
    enabledUnits: 304,
    unitsPerCluster: 40,
    clusterName: 'XCD',
    computeDies: 8,
    ioDies: 4,
    hbmSites: 8,
    hbmActiveStacks: 8,
    hbmGBPerStack: 32,
    stackCountBasis: 'derived',
    stackCountNote: '256 GB total, drawn as eight 32 GB stacks as on MI300X (count not stated)',
    l2MBPerComputeDie: 4,
    peerCount: 7,
    unitPartitions: 4,
    sources: [MI325X_DATASHEET, ROCM_SPECS],
  },
  {
    hardwareId: 'mi355x',
    // "Eight accelerated compute dies (XCDs) with 32 compute units" on
    // "2 mirrored" I/O dies. Physical CUs per XCD are not published, so only
    // enabled units are drawn.
    physicalUnits: 256,
    enabledUnits: 256,
    unitsPerCluster: 32,
    clusterName: 'XCD',
    computeDies: 8,
    ioDies: 2,
    hbmSites: 8,
    hbmActiveStacks: 8,
    hbmGBPerStack: 36,
    stackCountBasis: 'derived',
    stackCountNote: '288 GB total, drawn as eight 36 GB stacks (count not stated by AMD)',
    l2MBPerComputeDie: 4,
    peerCount: 7,
    unitPartitions: 4,
    sources: [MI355X_BROCHURE, ROCM_SPECS],
  },
];

export function getTopology(hardwareId: string): ChipTopology {
  const topology = TOPOLOGIES.find((candidate) => candidate.hardwareId === hardwareId);
  if (!topology) throw new Error(`No cutaway topology for hardware "${hardwareId}"`);
  return topology;
}
