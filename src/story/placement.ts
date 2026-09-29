import type { KvPlacement } from '../types';

// Where the KV cache can live, nearest first, in the words every control
// and sentence uses. Every server modeled here holds eight GPUs, so a GPU
// has seven peers (pinned by the topology tests).

export const PLACEMENT_ORDER: KvPlacement[] = ['hbm', 'peer', 'peers', 'host', 'ssd', 'object'];

/** For option labels. */
export const PLACEMENT_LABEL: Record<KvPlacement, string> = {
  hbm: 'GPU memory', peer: 'One other GPU', peers: 'Spread across all seven other GPUs', host: 'System memory', ssd: 'Local solid-state storage', object: 'Network object storage',
};

/** For use inside a sentence. */
export const PLACEMENT_PHRASE: Record<KvPlacement, string> = {
  hbm: 'GPU memory', peer: 'one other GPU', peers: 'all seven other GPUs', host: 'system memory', ssd: 'local SSD', object: 'network object storage',
};

/** The options of a placement select, nearest first. */
export function placementOptions(tiers: readonly KvPlacement[] = PLACEMENT_ORDER, selected?: KvPlacement): string {
  return PLACEMENT_ORDER.filter((tier) => tiers.includes(tier)).map((tier) => `<option value="${tier}"${tier === selected ? ' selected' : ''}>${PLACEMENT_LABEL[tier]}</option>`).join('');
}
