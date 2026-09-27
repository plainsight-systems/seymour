import type { HardwareProfile } from '../types';

export type MemoryTierId = 'registers' | 'shared' | 'l2' | 'hbm' | 'host' | 'peer' | 'ssd' | 'object';
export type KvPlacement = Extract<MemoryTierId, 'hbm' | 'host' | 'peer' | 'ssd' | 'object'>;

export interface MemoryTier {
  id: MemoryTierId;
  label: string;
  term?: string;
  capacityBytes: number | null;
  bandwidthBytesPerSecond?: number;
  firstByteLatencyMs?: number;
  basis: 'published' | 'representative';
  sourceUrl: string;
  sourceLabel: string;
  note: string;
}

const GIGA = 1e9;
const TERA = 1e12;

export function buildMemoryLadder(hardware: HardwareProfile): MemoryTier[] {
  const nvidia = hardware.vendor === 'NVIDIA';
  return [
    {
      id: 'registers',
      label: 'Worker-local operands',
      term: 'Registers',
      capacityBytes: hardware.registerFileKB * 1000,
      basis: 'published',
      sourceUrl: hardware.sourceUrl,
      sourceLabel: hardware.sourceLabel,
      note: `Capacity per ${hardware.unitName}; speed is intentionally qualitative.`,
    },
    {
      id: 'shared',
      label: 'Worker-local scratchpad',
      term: hardware.vendor === 'AMD' ? 'LDS' : 'Shared memory',
      capacityBytes: hardware.sharedMemoryKB * 1000,
      basis: 'published',
      sourceUrl: hardware.sourceUrl,
      sourceLabel: hardware.sourceLabel,
      note: `Capacity per ${hardware.unitName}; software-managed and on chip.`,
    },
    {
      id: 'l2',
      label: 'Shared on-chip cache',
      term: hardware.vendor === 'AMD' ? 'Infinity Cache' : 'L2',
      capacityBytes: hardware.lastLevelCacheMB * 1e6,
      basis: 'published',
      sourceUrl: hardware.sourceUrl,
      sourceLabel: hardware.sourceLabel,
      note: 'Shared across the accelerator; bandwidth is not invented here.',
    },
    {
      id: 'hbm',
      label: 'GPU memory',
      term: 'HBM',
      capacityBytes: hardware.hbmCapacityGB * GIGA,
      bandwidthBytesPerSecond: hardware.hbmBandwidthTBs * TERA * hardware.memoryEfficiency,
      basis: 'published',
      sourceUrl: hardware.sourceUrl,
      sourceLabel: hardware.sourceLabel,
      note: `Published peak × Seymour's visible ${Math.round(hardware.memoryEfficiency * 100)}% efficiency assumption.`,
    },
    {
      id: 'host',
      label: 'System memory',
      term: 'Host DRAM over PCIe',
      capacityBytes: 1.5 * TERA,
      bandwidthBytesPerSecond: hardware.hostLinkGBs * GIGA,
      basis: 'representative',
      sourceUrl: 'https://docs.nvidia.com/enterprise-reference-architectures/hgx-ai-factory-h100-h200-b200/latest/components.html',
      sourceLabel: 'NVIDIA HGX reference architecture and PCIe Gen5 x16 topology',
      note: 'Representative 1.5 TB server; link is the one-direction profile ceiling.',
    },
    {
      id: 'peer',
      label: 'Another GPU’s memory',
      term: nvidia ? 'NVLink peer' : 'Infinity Fabric peer',
      capacityBytes: hardware.hbmCapacityGB * GIGA,
      bandwidthBytesPerSecond: (nvidia ? 450 : 64) * GIGA,
      basis: 'published',
      sourceUrl: nvidia
        ? 'https://docs.nvidia.com/cuda/archive/12.3.0/pdf/Hopper_Tuning_Guide.pdf'
        : 'https://www.amd.com/content/dam/amd/en/documents/instinct-tech-docs/data-sheets/amd-instinct-mi300x-platform-data-sheet.pdf',
      sourceLabel: nvidia ? 'NVIDIA Hopper tuning guide' : 'AMD MI300X platform data sheet',
      note: 'One-direction ceiling derived from the published bidirectional figure.',
    },
    {
      id: 'ssd',
      label: 'Local solid-state storage',
      term: 'NVMe SSD',
      capacityBytes: 30.72 * TERA,
      bandwidthBytesPerSecond: 12 * GIGA,
      basis: 'representative',
      sourceUrl: 'https://semiconductor.samsung.com/ssd/datacenter-ssd/',
      sourceLabel: 'Samsung PM9D3a data-center SSD specifications',
      note: 'Representative high-end Gen5 drive; sequential peak, not a latency guarantee.',
    },
    {
      id: 'object',
      label: 'Network object storage',
      term: 'Object storage',
      capacityBytes: null,
      bandwidthBytesPerSecond: 12.5 * GIGA,
      firstByteLatencyMs: 150,
      basis: 'representative',
      sourceUrl: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/optimizing-performance.html',
      sourceLabel: 'Amazon S3 performance design patterns',
      note: 'Optimistic 100 Gb/s client path with the midpoint of AWS’s 100–200 ms first-byte guidance.',
    },
  ];
}

export function getMemoryTier(hardware: HardwareProfile, id: MemoryTierId): MemoryTier {
  return buildMemoryLadder(hardware).find((tier) => tier.id === id)!;
}
