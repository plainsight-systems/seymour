import { CAMPAIGN_SHIFTS, campaignShift, endlessShift } from './content';
import { configurationsEqual, evaluateOrder } from './evaluate';
import type { ActiveCustomer, GameConfiguration, GameControlId, GameEvent, GameOrder, GameShift, GameState, OrderMetrics } from './types';

const MAX_FUSES = 3;
const WARNING_PENALTY_MS = 4_000;
const FUSE_PENALTY_MS = 6_000;
const MIN_SERVICE_MS = 900;
const SERVICE_LOG_SCALE_MS = 1_800;
const SERVICE_REFERENCE_MS = 180;

function event(state: Pick<GameState, 'eventSequence'>, type: GameEvent['type'], title: string, detail: string): Pick<GameState, 'event' | 'eventSequence'> {
  const id = state.eventSequence + 1;
  return { eventSequence: id, event: { id, type, title, detail } };
}

export function createGameState(shift: GameShift = campaignShift(0), mode: GameState['mode'] = 'campaign', endlessSeed = 73, endlessRound = 0): GameState {
  const rigConfiguration = { ...(shift.orders[0]?.initial ?? {}) } as GameConfiguration;
  return {
    screen: 'briefing', mode, endlessSeed, endlessRound, shift,
    elapsedMs: 0, active: [], spawnedOrderIds: [], seatedOrderIds: [], selectedId: null,
    score: 0, combo: 0, fuses: MAX_FUSES, feedCooldownMs: 0,
    event: { id: 0, type: 'shift', title: shift.title, detail: shift.briefing }, eventSequence: 0,
    rigConfiguration,
    stats: {
      served: 0, failedFeeds: 0, peakBatch: 1, peakTokensPerSec: 0,
      slowestFirstTokenMs: 0, slowestNextTokenMs: 0, slowestRestoreMs: 0,
      peakHbmUsedFraction: 0, lastBottleneck: 'memory',
    },
  };
}

function spawnDue(state: GameState): GameState {
  const due = state.shift.orders.filter((order) => order.arrivalMs <= state.elapsedMs && !state.spawnedOrderIds.includes(order.id));
  if (due.length === 0) return state;
  const additions: ActiveCustomer[] = due.map((order) => ({
    order,
    patienceMs: order.patienceMs,
    config: { ...state.rigConfiguration },
    onBatchTray: false,
    attempts: 0,
    arrivedAtMs: state.elapsedMs,
  }));
  const next = {
    ...state,
    active: [...state.active, ...additions],
    spawnedOrderIds: [...state.spawnedOrderIds, ...due.map((order) => order.id)],
    selectedId: state.selectedId ?? due[0]!.id,
  };
  return { ...next, ...event(next, 'arrival', `${due[0]!.plantName} arrived`, due.length === 1 ? due[0]!.request : `${due.length} plants joined the counter.`) };
}

function completed(state: GameState): boolean {
  return state.spawnedOrderIds.length === state.shift.orders.length && state.active.length === 0 && state.feedCooldownMs <= 0;
}

function applyRigToSelection(active: ActiveCustomer[], orderId: string | null, rigConfiguration: GameConfiguration): ActiveCustomer[] {
  const selected = active.find((customer) => customer.order.id === orderId);
  if (!selected) return active;
  return active.map((customer) => {
    const sharesTray = selected.onBatchTray && customer.onBatchTray && customer.order.batchFamily === selected.order.batchFamily;
    return customer.order.id === orderId || sharesTray
      ? { ...customer, config: { ...rigConfiguration } }
      : customer;
  });
}

export function beginShift(state: GameState): GameState {
  if (state.screen !== 'briefing') return state;
  const playing = { ...state, screen: 'playing' as const };
  return spawnDue({ ...playing, ...event(playing, 'shift', 'Counter open', 'Select a plant, read its ticket, then configure the order.') });
}

export function pauseGame(state: GameState): GameState {
  if (state.screen !== 'playing') return state;
  const paused = { ...state, screen: 'paused' as const };
  return { ...paused, ...event(paused, 'shift', 'Shift paused', 'Patience and the kitchen clock are frozen.') };
}

export function resumeGame(state: GameState): GameState {
  if (state.screen !== 'paused') return state;
  const playing = { ...state, screen: 'playing' as const };
  return { ...playing, ...event(playing, 'shift', 'Counter open', 'The shift clock is running again.') };
}

export function advanceGame(state: GameState, deltaMs: number): GameState {
  if (state.screen !== 'playing' || deltaMs <= 0) return state;
  const elapsed = state.elapsedMs + deltaMs;
  const feedCooldownMs = Math.max(0, state.feedCooldownMs - deltaMs);
  const expired = state.active.filter((customer) => customer.patienceMs - deltaMs <= 0);
  const expiredIds = new Set(expired.map((customer) => customer.order.id));
  let active = state.active
    .filter((customer) => !expiredIds.has(customer.order.id))
    .map((customer) => ({ ...customer, patienceMs: customer.patienceMs - deltaMs }));
  const fuses = Math.max(0, state.fuses - expired.length);
  const selectedId = active.some((customer) => customer.order.id === state.selectedId) ? state.selectedId : active[0]?.order.id ?? null;
  if (selectedId !== state.selectedId) active = applyRigToSelection(active, selectedId, state.rigConfiguration);
  let next: GameState = {
    ...state,
    elapsedMs: elapsed,
    feedCooldownMs,
    active,
    fuses,
    combo: expired.length ? 0 : state.combo,
    selectedId,
  };
  if (expired.length) {
    const names = expired.map((customer) => customer.order.plantName).join(', ');
    next = { ...next, ...event(next, 'fuse', 'A fuse blew', `${names} ran out of patience. ${fuses} ${fuses === 1 ? 'fuse remains' : 'fuses remain'}.`) };
  }
  if (fuses === 0) return { ...next, screen: 'game-over' };
  next = spawnDue(next);
  if (completed(next)) {
    const cleared = next.stats.served === next.shift.orders.length;
    const servedLabel = `${next.stats.served} ${next.stats.served === 1 ? 'order' : 'orders'} served`;
    return {
      ...next,
      screen: 'shift-complete',
      ...event(next, 'shift', cleared ? 'Shift cleared' : 'Shift survived', `${servedLabel} · ${next.score.toLocaleString()} of ${next.shift.targetScore.toLocaleString()} target points.`),
    };
  }
  return next;
}

export function selectCustomer(state: GameState, orderId: string): GameState {
  if (!state.active.some((customer) => customer.order.id === orderId)) return state;
  return { ...state, active: applyRigToSelection(state.active, orderId, state.rigConfiguration), selectedId: orderId };
}

function configured(config: GameConfiguration, control: GameControlId, value: GameConfiguration[GameControlId]): GameConfiguration {
  const next = { ...config, [control]: value } as GameConfiguration;
  if (next.weightBits === 16) next.mathBits = 16;
  return next;
}

export function setCustomerControl<K extends GameControlId>(state: GameState, orderId: string, control: K, value: GameConfiguration[K]): GameState {
  if (!state.shift.controls.includes(control)) return state;
  const selected = state.active.find((customer) => customer.order.id === orderId);
  if (!selected) return state;
  const active = state.active.map((customer) => {
    const sharesTray = selected.onBatchTray && customer.onBatchTray && customer.order.batchFamily === selected.order.batchFamily;
    return customer.order.id === orderId || sharesTray
      ? { ...customer, config: configured(customer.config, control, value) }
      : customer;
  });
  return { ...state, active, rigConfiguration: configured(state.rigConfiguration, control, value) };
}

export function serviceCooldownMs(order: GameOrder, metrics: OrderMetrics): number {
  const modeledMs = order.phase === 'first-token'
    ? metrics.firstTokenMs
    : order.phase === 'idle-return'
      ? metrics.restoreMs
      : metrics.migrationMs + metrics.msPerToken * (order.workload.outputLength ?? 32);
  // A logarithmic clock keeps literal GPU milliseconds playable while retaining
  // ordering and visible cost differences; unlike a hard cap, long jobs do not
  // collapse to the same kitchen time.
  return Math.round(Math.max(MIN_SERVICE_MS, MIN_SERVICE_MS + SERVICE_LOG_SCALE_MS * Math.log1p(modeledMs / SERVICE_REFERENCE_MS)));
}

export function servicePoints(groupSize: number, patienceBonus: number, combo: number): number {
  // Correct service and the batching concept dominate the score. Remaining
  // patience is a smaller mastery bonus, not the main grade.
  return Math.round(groupSize * 450 + patienceBonus * 100 + Math.max(0, groupSize - 1) * 300 + combo * 40);
}

export function toggleBatchTray(state: GameState, orderId: string): GameState {
  if (!state.shift.batchTray) return { ...state, ...event(state, 'warning', 'Batch tray locked', 'The tray opens in Shift 2.') };
  const customer = state.active.find((candidate) => candidate.order.id === orderId);
  if (!customer) return state;
  if (!customer.order.batchFamily) return { ...state, ...event(state, 'warning', 'This order stands alone', 'Only matching live token orders can share the batch tray.') };
  if (!customer.onBatchTray) {
    const tray = state.active.filter((candidate) => candidate.onBatchTray);
    const mismatch = tray.find((candidate) => candidate.order.batchFamily !== customer.order.batchFamily);
    if (mismatch) return { ...state, ...event(state, 'warning', 'Tray does not match', 'Only tickets from the same workload family can share one model pass.') };
    const trayConfiguration = tray[0]?.config;
    const active = state.active.map((candidate) => candidate.order.id === orderId
      ? { ...candidate, onBatchTray: true, config: trayConfiguration ? { ...trayConfiguration } : candidate.config }
      : candidate);
    const next = { ...state, active };
    return { ...next, ...event(next, 'batch', 'Ticket on the tray', trayConfiguration ? 'This ticket adopted the tray configuration.' : 'The next matching ticket will share this configuration.') };
  }
  const active = state.active.map((candidate) => candidate.order.id === orderId ? { ...candidate, onBatchTray: false } : candidate);
  const next = { ...state, active };
  return { ...next, ...event(next, 'batch', 'Ticket off the tray', 'This order will be fed by itself.') };
}

function selectedGroup(state: GameState, selected: ActiveCustomer): { group: ActiveCustomer[]; error?: string } {
  if (!selected.onBatchTray) return { group: [selected] };
  const tray = state.active.filter((customer) => customer.onBatchTray);
  const mismatch = tray.find((customer) => customer.order.batchFamily !== selected.order.batchFamily || !configurationsEqual(customer.config, selected.config));
  if (mismatch) return { group: [selected], error: 'The tray contains unlike workloads or configurations. Match every ticket before feeding.' };
  return { group: tray };
}

export function feedSelected(state: GameState): GameState {
  if (state.screen !== 'playing' || state.feedCooldownMs > 0 || !state.selectedId) return state;
  const selected = state.active.find((customer) => customer.order.id === state.selectedId);
  if (!selected) return state;
  const grouped = selectedGroup(state, selected);
  if (grouped.error) return { ...state, ...event(state, 'warning', 'Batch rejected', grouped.error) };
  const groupSize = grouped.group.length;
  const evaluations = grouped.group.map((customer) => evaluateOrder(customer.order, customer.config, groupSize));
  const failedIndex = evaluations.findIndex((evaluation) => !evaluation.passed);
  if (failedIndex >= 0) {
    const customer = grouped.group[failedIndex]!;
    const evaluation = evaluations[failedIndex]!;
    const failed = evaluation.checks.find((check) => !check.met)!;
    const severe = Boolean(failed.constraint.severe);
    const penalty = severe ? FUSE_PENALTY_MS : WARNING_PENALTY_MS;
    const active = state.active.map((candidate) => grouped.group.some((member) => member.order.id === candidate.order.id)
      ? { ...candidate, attempts: candidate.attempts + 1, patienceMs: Math.max(5_000, candidate.patienceMs - penalty) }
      : candidate);
    const fuses = severe ? state.fuses - 1 : state.fuses;
    const scorePenalty = severe ? 300 : 120;
    const next: GameState = { ...state, active, fuses, combo: 0, score: Math.max(0, state.score - scorePenalty), stats: { ...state.stats, failedFeeds: state.stats.failedFeeds + 1 } };
    const phaseLabel = customer.order.phase === 'first-token' ? 'prompt pass' : customer.order.phase === 'next-token' ? 'token step' : 'restore path';
    const diagnosis = failed.constraint.metric === 'weightQuality'
      ? failed.constraint.failure
      : `${failed.constraint.failure} The modeled ${phaseLabel} is ${evaluation.metrics.bottleneck}-bound.`;
    const guidance = customer.attempts > 0 ? `${diagnosis} ${failed.constraint.fix}` : diagnosis;
    const detail = `${guidance} −${scorePenalty} points.`;
    if (fuses <= 0) return { ...next, fuses: 0, screen: 'game-over', ...event(next, 'fuse', 'The kitchen tripped its last fuse', detail) };
    return { ...next, ...event(next, severe ? 'fuse' : 'warning', severe ? 'Hardware fault — fuse blown' : `${customer.order.plantName} is still waiting`, detail) };
  }

  const servedIds = new Set(grouped.group.map((customer) => customer.order.id));
  const patienceBonus = grouped.group.reduce((total, customer) => total + customer.patienceMs / customer.order.patienceMs, 0);
  const combo = state.combo + groupSize;
  const points = servicePoints(groupSize, patienceBonus, state.combo);
  const remaining = state.active.filter((customer) => !servedIds.has(customer.order.id));
  const selectedId = remaining[0]?.order.id ?? null;
  const active = applyRigToSelection(remaining, selectedId, state.rigConfiguration);
  const representative = evaluations[0]!.metrics;
  let next: GameState = {
    ...state,
    active,
    seatedOrderIds: [...state.seatedOrderIds, ...servedIds],
    selectedId,
    score: state.score + points,
    combo,
    feedCooldownMs: Math.max(...evaluations.map((evaluation, index) => serviceCooldownMs(grouped.group[index]!.order, evaluation.metrics))),
    stats: {
      served: state.stats.served + groupSize,
      failedFeeds: state.stats.failedFeeds,
      peakBatch: Math.max(state.stats.peakBatch, groupSize),
      peakTokensPerSec: Math.max(state.stats.peakTokensPerSec, ...evaluations.map((evaluation, index) => grouped.group[index]!.order.phase === 'next-token' ? evaluation.metrics.totalTokensPerSec : 0)),
      slowestFirstTokenMs: Math.max(state.stats.slowestFirstTokenMs, ...evaluations.map((evaluation, index) => grouped.group[index]!.order.phase === 'first-token' ? evaluation.metrics.firstTokenMs : 0)),
      slowestNextTokenMs: Math.max(state.stats.slowestNextTokenMs, ...evaluations.map((evaluation, index) => grouped.group[index]!.order.phase === 'next-token' ? evaluation.metrics.msPerToken : 0)),
      slowestRestoreMs: Math.max(state.stats.slowestRestoreMs, ...evaluations.map((evaluation, index) => grouped.group[index]!.order.phase === 'idle-return' ? evaluation.metrics.restoreMs : 0)),
      peakHbmUsedFraction: Math.max(state.stats.peakHbmUsedFraction, ...evaluations.map((evaluation) => evaluation.metrics.hbmUsedFraction)),
      lastBottleneck: representative.bottleneck,
    },
  };
  const occupancy = `${(next.feedCooldownMs / 1000).toFixed(1)}s`;
  const serviceDetail = groupSize > 1
    ? `${groupSize} orders shared one GPU service window; counter busy ${occupancy}.`
    : `This order used one GPU service window; counter busy ${occupancy}.`;
  next = { ...next, ...event(next, 'success', groupSize > 1 ? `Batch served ×${groupSize}` : `${selected.order.plantName} fed`, `${serviceDetail} +${points.toLocaleString()} points.`) };
  return next;
}

export function nextShift(state: GameState): GameState {
  if (state.screen !== 'shift-complete') return state;
  if (state.mode === 'endless') {
    const round = state.endlessRound + 1;
    return {
      ...createGameState(endlessShift(state.endlessSeed, round), 'endless', state.endlessSeed, round),
      score: state.score,
      fuses: state.fuses,
    };
  }
  const index = CAMPAIGN_SHIFTS.findIndex((shift) => shift.id === state.shift.id);
  if (index < 0 || index === CAMPAIGN_SHIFTS.length - 1) return { ...state, screen: 'campaign-complete' };
  return createGameState(campaignShift(index + 1), 'campaign', state.endlessSeed, 0);
}

export function restartShift(state: GameState): GameState {
  return createGameState(state.shift, state.mode, state.endlessSeed, state.endlessRound);
}

export function startEndless(seed = 73): GameState {
  return createGameState(endlessShift(seed, 0), 'endless', seed, 0);
}
