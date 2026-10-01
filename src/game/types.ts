import type { KvPlacement, SimulationSettings } from '../types';

export type GameControlId = 'weightBits' | 'mathBits' | 'kvBits' | 'reusePromptPrefixes' | 'kvPlacement' | 'idleKvPlacement';
export type PlantKind = 'sprout' | 'cactus' | 'fern' | 'orchid' | 'maw' | 'vine';
export type OrderPhase = 'first-token' | 'next-token' | 'idle-return';
export type OrderMetric = 'firstTokenMs' | 'msPerToken' | 'migrationMs' | 'readyNextTokenMs' | 'restoreMs' | 'recomputeMs' | 'totalTokensPerSec' | 'fitsInGpuMemory' | 'activeKvNear' | 'restoreBeatsRecompute' | 'prefixReuseEnabled' | 'weightQuality' | 'kvQuality' | 'groupSize';

export interface GameConfiguration {
  weightBits: SimulationSettings['weightBits'];
  mathBits: SimulationSettings['mathBits'];
  kvBits: SimulationSettings['kvBits'];
  reusePromptPrefixes: boolean;
  kvPlacement: KvPlacement;
  idleKvPlacement: KvPlacement;
}

export interface OrderConstraint {
  metric: OrderMetric;
  op: '<=' | '>=' | '==';
  value: number | boolean;
  label: string;
  failure: string;
  fix: string;
  severe?: boolean;
}

export interface GameOrder {
  id: string;
  plantName: string;
  plantKind: PlantKind;
  orderName: string;
  phase: OrderPhase;
  request: string;
  workload: Partial<SimulationSettings>;
  initial: GameConfiguration;
  solution: GameConfiguration;
  constraints: OrderConstraint[];
  patienceMs: number;
  arrivalMs: number;
  lane: 0 | 1 | 2;
  batchFamily?: string;
  solutionGroupSize?: number;
  prefixName?: string;
  /** Where this order's live KV already resides before the selected serving path runs. */
  sourceKvPlacement?: KvPlacement;
  hint: string;
}

export interface GameShift {
  id: string;
  number: number;
  title: string;
  subtitle: string;
  briefing: string;
  lesson: string;
  controls: GameControlId[];
  batchTray: boolean;
  targetScore: number;
  orders: GameOrder[];
}

export interface OrderMetrics {
  firstTokenMs: number;
  msPerToken: number;
  /** One-time cost to move existing live KV onto the selected active path. */
  migrationMs: number;
  /** Time until the first usable next token, including any live-state move. */
  readyNextTokenMs: number;
  restoreMs: number;
  recomputeMs: number;
  totalTokensPerSec: number;
  fitsInGpuMemory: boolean;
  activeKvNear: boolean;
  restoreBeatsRecompute: boolean;
  prefixReuseEnabled: boolean;
  weightQuality: number;
  kvQuality: number;
  groupSize: number;
  bottleneck: 'memory' | 'compute' | 'host' | 'placement';
  hbmUsedFraction: number;
  spilledBytes: number;
}

export interface GameShiftStats {
  served: number;
  failedFeeds: number;
  peakBatch: number;
  peakTokensPerSec: number;
  slowestFirstTokenMs: number;
  slowestNextTokenMs: number;
  slowestRestoreMs: number;
  peakHbmUsedFraction: number;
  lastBottleneck: OrderMetrics['bottleneck'];
}

export interface ConstraintCheck {
  constraint: OrderConstraint;
  actual: number | boolean;
  met: boolean;
}

export interface OrderEvaluation {
  passed: boolean;
  settings: SimulationSettings;
  metrics: OrderMetrics;
  checks: ConstraintCheck[];
}

export type GameScreen = 'title' | 'briefing' | 'playing' | 'paused' | 'shift-complete' | 'game-over' | 'campaign-complete';

export interface ActiveCustomer {
  order: GameOrder;
  patienceMs: number;
  config: GameConfiguration;
  onBatchTray: boolean;
  attempts: number;
  arrivedAtMs: number;
}

export interface GameEvent {
  id: number;
  type: 'arrival' | 'success' | 'warning' | 'fuse' | 'batch' | 'shift';
  title: string;
  detail: string;
}

export interface GameState {
  screen: GameScreen;
  mode: 'campaign' | 'endless';
  endlessSeed: number;
  endlessRound: number;
  shift: GameShift;
  elapsedMs: number;
  active: ActiveCustomer[];
  spawnedOrderIds: string[];
  seatedOrderIds: string[];
  selectedId: string | null;
  score: number;
  combo: number;
  fuses: number;
  feedCooldownMs: number;
  event: GameEvent;
  eventSequence: number;
  rigConfiguration: GameConfiguration;
  stats: GameShiftStats;
}

export interface GameSave {
  scoringVersion: number;
  completedShiftIds: string[];
  highScores: Record<string, number>;
  endlessUnlocked: boolean;
  soundEnabled: boolean;
}
