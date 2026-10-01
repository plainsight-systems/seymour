import { CAMPAIGN_SHIFTS, campaignShift, endlessShift } from './content';
import { configurationsEqual, evaluateOrder } from './evaluate';
import type { ActiveCustomer, GameConfiguration, GameControlId, GameEvent, GameShift, GameState } from './types';

const MAX_FUSES = 3;
const SUCCESS_COOLDOWN_MS = 720;
const WARNING_PENALTY_MS = 4_000;
const FUSE_PENALTY_MS = 6_000;

function event(state: Pick<GameState, 'eventSequence'>, type: GameEvent['type'], title: string, detail: string): Pick<GameState, 'event' | 'eventSequence'> {
  const id = state.eventSequence + 1;
  return { eventSequence: id, event: { id, type, title, detail } };
}

export function createGameState(shift: GameShift = campaignShift(0), mode: GameState['mode'] = 'campaign', endlessSeed = 73, endlessRound = 0): GameState {
  return {
    screen: 'briefing', mode, endlessSeed, endlessRound, shift,
    elapsedMs: 0, active: [], spawnedOrderIds: [], seatedOrderIds: [], selectedId: null,
    score: 0, combo: 0, fuses: MAX_FUSES, feedCooldownMs: 0,
    event: { id: 0, type: 'shift', title: shift.title, detail: shift.briefing }, eventSequence: 0,
  };
}

function spawnDue(state: GameState): GameState {
  const due = state.shift.orders.filter((order) => order.arrivalMs <= state.elapsedMs && !state.spawnedOrderIds.includes(order.id));
  if (due.length === 0) return state;
  const additions: ActiveCustomer[] = due.map((order) => ({
    order,
    patienceMs: order.patienceMs,
    config: { ...order.initial },
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
  const active = state.active
    .filter((customer) => !expiredIds.has(customer.order.id))
    .map((customer) => ({ ...customer, patienceMs: customer.patienceMs - deltaMs }));
  const fuses = Math.max(0, state.fuses - expired.length);
  let next: GameState = {
    ...state,
    elapsedMs: elapsed,
    feedCooldownMs,
    active,
    fuses,
    combo: expired.length ? 0 : state.combo,
    selectedId: active.some((customer) => customer.order.id === state.selectedId) ? state.selectedId : active[0]?.order.id ?? null,
  };
  if (expired.length) {
    const names = expired.map((customer) => customer.order.plantName).join(', ');
    next = { ...next, ...event(next, 'fuse', 'A fuse blew', `${names} ran out of patience. ${fuses} ${fuses === 1 ? 'fuse' : 'fuses'} remain.`) };
  }
  if (fuses === 0) return { ...next, screen: 'game-over' };
  next = spawnDue(next);
  if (completed(next)) return { ...next, screen: 'shift-complete', ...event(next, 'shift', 'Shift cleared', next.shift.lesson) };
  return next;
}

export function selectCustomer(state: GameState, orderId: string): GameState {
  if (!state.active.some((customer) => customer.order.id === orderId)) return state;
  return { ...state, selectedId: orderId };
}

export function setCustomerControl<K extends GameControlId>(state: GameState, orderId: string, control: K, value: GameConfiguration[K]): GameState {
  if (!state.shift.controls.includes(control)) return state;
  const active = state.active.map((customer) => customer.order.id === orderId
    ? { ...customer, config: { ...customer.config, [control]: value } }
    : customer);
  return { ...state, active };
}

export function toggleBatchTray(state: GameState, orderId: string): GameState {
  if (!state.shift.batchTray) return { ...state, ...event(state, 'warning', 'Batch tray locked', 'The tray opens in Shift 2.') };
  const customer = state.active.find((candidate) => candidate.order.id === orderId);
  if (!customer) return state;
  if (!customer.order.batchFamily) return { ...state, ...event(state, 'warning', 'This order stands alone', 'Only matching live token orders can share the batch tray.') };
  if (!customer.onBatchTray) {
    const tray = state.active.filter((candidate) => candidate.onBatchTray);
    const mismatch = tray.find((candidate) => candidate.order.batchFamily !== customer.order.batchFamily || !configurationsEqual(candidate.config, customer.config));
    if (mismatch) return { ...state, ...event(state, 'warning', 'Tray does not match', 'Batch tickets need the same workload and configuration. Match the controls, then try again.') };
  }
  const active = state.active.map((candidate) => candidate.order.id === orderId ? { ...candidate, onBatchTray: !candidate.onBatchTray } : candidate);
  const added = !customer.onBatchTray;
  const next = { ...state, active };
  return { ...next, ...event(next, 'batch', added ? 'Ticket on the tray' : 'Ticket off the tray', added ? 'Matching tickets can share one model read.' : 'This order will be fed by itself.') };
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
    const next: GameState = { ...state, active, fuses, combo: 0 };
    const detail = `${failed.constraint.failure} ${failed.constraint.fix}`;
    if (fuses <= 0) return { ...next, fuses: 0, screen: 'game-over', ...event(next, 'fuse', 'The kitchen tripped its last fuse', detail) };
    return { ...next, ...event(next, severe ? 'fuse' : 'warning', severe ? 'Hardware fault — fuse blown' : `${customer.order.plantName} is still waiting`, detail) };
  }

  const servedIds = new Set(grouped.group.map((customer) => customer.order.id));
  const patienceBonus = grouped.group.reduce((total, customer) => total + customer.patienceMs / customer.order.patienceMs, 0);
  const combo = state.combo + groupSize;
  const points = Math.round(groupSize * 500 + patienceBonus * 500 + Math.max(0, groupSize - 1) * 300 + state.combo * 90);
  const active = state.active.filter((customer) => !servedIds.has(customer.order.id));
  let next: GameState = {
    ...state,
    active,
    seatedOrderIds: [...state.seatedOrderIds, ...servedIds],
    selectedId: active[0]?.order.id ?? null,
    score: state.score + points,
    combo,
    feedCooldownMs: SUCCESS_COOLDOWN_MS,
  };
  next = { ...next, ...event(next, 'success', groupSize > 1 ? `Batch served ×${groupSize}` : `${selected.order.plantName} fed`, `+${points.toLocaleString()} points. The modeled order cleared every requirement.`) };
  if (completed({ ...next, feedCooldownMs: 0 })) return { ...next, screen: 'shift-complete', ...event(next, 'shift', 'Shift cleared', next.shift.lesson) };
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
