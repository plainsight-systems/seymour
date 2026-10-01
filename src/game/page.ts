import './game.css';
import { formatBytes, formatDuration, formatNumber } from '../model/calculate';
import type { KvPlacement } from '../types';
import { GameAudio } from './audio';
import { CAMPAIGN_SHIFTS, campaignShift } from './content';
import { advanceGame, beginShift, createGameState, feedSelected, nextShift, pauseGame, restartShift, resumeGame, selectCustomer, setCustomerControl, startEndless, toggleBatchTray } from './engine';
import { evaluateOrder } from './evaluate';
import { loadGameSave, recordScore, recordShift, saveGame, setSoundPreference } from './persistence';
import { requiresStructuralRender } from './render-policy';
import { customerAtPoint, renderScene, sceneDescription } from './scene';
import type { ActiveCustomer, GameConfiguration, GameControlId, GameSave, GameState, OrderConstraint, OrderMetric } from './types';

const routeRoot = document.querySelector<HTMLElement>('#route-root');
if (!routeRoot) throw new Error('Missing #route-root');
const root: HTMLElement = routeRoot;

root.innerHTML = `<div class="game-page">
  <section class="game-desktop-required" aria-labelledby="desktop-title">
    <span>Desktop release</span><h1 id="desktop-title">The lunch rush needs a bigger counter.</h1><p>Seymour — The Game is built for a keyboard, pointer, and a landscape display at least 900 pixels wide.</p><a href="#/">Return to the story</a>
  </section>
  <section class="game-cabinet" aria-label="Seymour — The Game">
    <header class="game-marquee">
      <div class="game-shift-mark"><span data-shift-number>Shift 01</span><strong data-shift-title>Opening Shift</strong><small data-shift-subtitle>Feed the machine</small></div>
      <dl class="game-scoreboard"><div><dt>Score</dt><dd data-score>000000</dd></div><div><dt>Clock</dt><dd data-clock>00:00</dd></div><div><dt>Combo</dt><dd data-combo>×0</dd></div></dl>
      <div class="game-utilities"><div class="game-fuses" aria-label="Three power fuses" data-fuses></div><button type="button" data-action="sound" aria-pressed="false">Sound off</button><button type="button" data-action="pause">Pause</button></div>
    </header>
    <div class="game-stage-shell">
      <canvas class="game-stage" width="720" height="270" role="img" aria-label="Seymour serving counter" data-game-canvas></canvas>
      <div class="game-scanlines" aria-hidden="true"></div>
      <ol class="game-customer-queue" aria-label="Plants waiting at the counter" data-customer-queue></ol>
      <section class="game-screen" data-game-screen></section>
      <div class="game-event" data-event-type="shift"><span data-event-title>Shift ready</span><p data-event-detail>Select a plant and read its ticket.</p></div>
    </div>
    <section class="game-console" aria-label="Serving console">
      <article class="game-ticket" data-ticket></article>
      <form class="game-controls" data-controls></form>
      <aside class="game-readout" data-readout></aside>
    </section>
    <footer class="game-key-strip"><span><kbd>1–9</kbd> select</span><span><kbd>↑↓</kbd> control</span><span><kbd>←→</kbd> adjust</span><span><kbd>B</kbd> batch tray</span><span><kbd>Space</kbd> feed</span><span><kbd>Esc</kbd> pause</span></footer>
  </section>
  <p class="sr-only" aria-live="polite" data-live-status></p>
  <p class="sr-only" aria-live="assertive" data-live-alert></p>
</div>`;

const canvas = root.querySelector<HTMLCanvasElement>('[data-game-canvas]')!;
const audio = new GameAudio();
let save: GameSave = loadGameSave();
const firstIncomplete = CAMPAIGN_SHIFTS.findIndex((shift) => !save.completedShiftIds.includes(shift.id));
const initialShiftIndex = firstIncomplete < 0 ? 0 : firstIncomplete;
let state: GameState = { ...createGameState(campaignShift(initialShiftIndex)), screen: 'title' };
let lastFrame = performance.now();
let lastDomRender = 0;
let eventStartedAt = lastFrame;
let renderedEventId = state.event.id;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function scoreText(score: number): string {
  return Math.max(0, Math.round(score)).toString().padStart(6, '0');
}

function clockText(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60).toString().padStart(2, '0')}:${(total % 60).toString().padStart(2, '0')}`;
}

function selectedCustomer(): ActiveCustomer | null {
  return state.active.find((customer) => customer.order.id === state.selectedId) ?? null;
}

function traySize(customer: ActiveCustomer): number {
  return customer.onBatchTray ? state.active.filter((candidate) => candidate.onBatchTray).length : 1;
}

function setState(next: GameState, preserveControls = false): void {
  const previousScreen = state.screen;
  state = next;
  if (state.event.id !== renderedEventId) {
    renderedEventId = state.event.id;
    eventStartedAt = performance.now();
    audio.play(state.event.type);
  }
  if (previousScreen !== 'shift-complete' && state.screen === 'shift-complete') {
    const campaignComplete = state.mode === 'campaign' && state.shift.id === CAMPAIGN_SHIFTS.at(-1)!.id;
    save = state.mode === 'campaign'
      ? recordShift(save, state.shift.id, state.score, campaignComplete)
      : recordScore(save, 'endless', state.score);
    saveGame(save);
  }
  if (previousScreen !== 'game-over' && state.screen === 'game-over') {
    save = recordScore(save, state.mode === 'endless' ? 'endless' : state.shift.id, state.score);
    saveGame(save);
  }
  if (preserveControls) {
    const selected = selectedCustomer();
    if (selected) root.querySelector<HTMLElement>('[data-readout]')!.innerHTML = readoutMarkup(selected);
    renderLiveDom();
  } else renderDom();
}

function formatMetric(metric: OrderMetric, value: number | boolean): string {
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (metric === 'firstTokenMs' || metric === 'msPerToken') return formatDuration(value);
  if (metric === 'totalTokensPerSec') return `${formatNumber(value)} tok/s`;
  if (metric === 'weightQuality') return `${value}-bit`;
  if (metric === 'groupSize') return `${value} orders`;
  return formatNumber(value);
}

function targetText(constraint: OrderConstraint): string {
  return `${constraint.op} ${formatMetric(constraint.metric, constraint.value)}`;
}

function ticketMarkup(customer: ActiveCustomer): string {
  const order = customer.order;
  const phase = ({ 'first-token': 'First token', 'next-token': 'Next tokens', 'idle-return': 'Idle return' })[order.phase];
  const workload = order.workload;
  return `<header><span>Order ${state.active.findIndex((candidate) => candidate.order.id === order.id) + 1}</span><b>${phase}</b></header>
    <div class="ticket-name"><i aria-hidden="true" data-plant-kind="${order.plantKind}"></i><div><strong>${order.plantName}</strong><h2>${order.orderName}</h2></div></div>
    <p>${order.request}</p>
    <dl><div><dt>Users</dt><dd>${(workload.batch ?? 1).toLocaleString()}</dd></div><div><dt>Context</dt><dd>${(workload.sequenceLength ?? 4096).toLocaleString()}</dd></div><div><dt>Output</dt><dd>${(workload.outputLength ?? 32).toLocaleString()}</dd></div>${order.prefixName ? `<div><dt>Shared prefix</dt><dd>${order.prefixName}</dd></div>` : ''}</dl>
    <div class="ticket-patience"><span>Patience</span><progress max="${order.patienceMs}" value="${customer.patienceMs}">${Math.round(customer.patienceMs / order.patienceMs * 100)}%</progress><b>${Math.ceil(customer.patienceMs / 1000)}s</b></div>
    <details><summary>Kitchen hint</summary><p>${order.hint}</p></details>`;
}

const controlMeta: Record<GameControlId, { label: string; note: string }> = {
  weightBits: { label: 'Model bits', note: 'Bytes stored per weight' },
  mathBits: { label: 'Matrix math', note: 'Arithmetic precision' },
  kvBits: { label: 'KV bits', note: 'Bytes stored per cached value' },
  reusePromptPrefixes: { label: 'Shared prefix', note: 'Reuse matching prompt work' },
  kvPlacement: { label: 'Active KV', note: 'Read on every generated token' },
  idleKvPlacement: { label: 'Idle KV', note: 'Restored when the session returns' },
};

const activePlacements: Array<[KvPlacement, string]> = [['hbm', 'GPU memory'], ['peer', 'GPU peer'], ['host', 'System memory'], ['ssd', 'Local SSD'], ['object', 'Object storage']];
const idlePlacements: Array<[KvPlacement, string]> = [['host', 'System memory'], ['ssd', 'Local SSD'], ['object', 'Object storage']];

function selectControl(control: GameControlId, value: string | number, options: Array<[string | number, string]>): string {
  const meta = controlMeta[control];
  return `<label><span>${meta.label}<small>${meta.note}</small></span><select class="game-control" aria-label="${meta.label}" data-control="${control}">${options.map(([option, label]) => `<option value="${option}"${String(option) === String(value) ? ' selected' : ''}>${label}</option>`).join('')}</select></label>`;
}

function controlsMarkup(customer: ActiveCustomer): string {
  const controls = state.shift.controls.map((control) => {
    if (control === 'weightBits') return selectControl(control, customer.config.weightBits, [[16, '16-bit'], [8, '8-bit'], [4, '4-bit']]);
    if (control === 'mathBits') return selectControl(control, customer.config.mathBits, [[16, '16-bit math'], [8, '8-bit math']]);
    if (control === 'kvBits') return selectControl(control, customer.config.kvBits, [[16, '16-bit'], [8, '8-bit']]);
    if (control === 'kvPlacement') return selectControl(control, customer.config.kvPlacement, activePlacements);
    if (control === 'idleKvPlacement') return selectControl(control, customer.config.idleKvPlacement, idlePlacements);
    const meta = controlMeta[control];
    return `<label class="game-switch"><span>${meta.label}<small>${meta.note}</small></span><input class="game-control" type="checkbox" data-control="${control}"${customer.config.reusePromptPrefixes ? ' checked' : ''}><i aria-hidden="true"></i></label>`;
  }).join('');
  const batch = state.shift.batchTray ? `<button class="game-batch-button" type="button" data-action="batch" aria-pressed="${customer.onBatchTray}">${customer.onBatchTray ? 'Remove from batch tray' : 'Put on batch tray'}<small>${customer.order.batchFamily ? 'B · matching tickets only' : 'This order cannot batch'}</small></button>` : '';
  return `<fieldset><legend>Serving configuration</legend>${controls}</fieldset><div class="game-console-actions">${batch}<button class="game-feed-button" type="button" data-action="feed"${state.feedCooldownMs > 0 ? ' disabled' : ''}><span>Feed order</span><small>Space · run the model</small></button></div>`;
}

function readoutMarkup(customer: ActiveCustomer): string {
  const groupSize = traySize(customer);
  const evaluation = evaluateOrder(customer.order, customer.config, groupSize);
  const metrics = evaluation.metrics;
  return `<header><span>Model preview</span><strong data-pass="${evaluation.passed}">${evaluation.passed ? 'Ready to feed' : 'Requirements unmet'}</strong></header>
    <dl class="game-live-metrics"><div><dt>First token</dt><dd>${formatDuration(metrics.firstTokenMs)}</dd></div><div><dt>Next token</dt><dd>${formatDuration(metrics.msPerToken)}</dd></div><div><dt>GPU memory</dt><dd>${Math.round(metrics.hbmUsedFraction * 100)}%</dd></div><div><dt>Limit</dt><dd>${metrics.bottleneck}</dd></div></dl>
    <ul class="game-constraints">${evaluation.checks.map((check) => `<li data-met="${check.met}"><span aria-hidden="true">${check.met ? '✓' : '×'}</span><p><b>${check.constraint.label}</b><small>${formatMetric(check.constraint.metric, check.actual)} · target ${targetText(check.constraint)}</small></p></li>`).join('')}</ul>
    ${metrics.spilledBytes > 0 ? `<p class="game-spill"><strong>${formatBytes(metrics.spilledBytes)} beyond GPU memory.</strong> This order crosses the slower system link.</p>` : ''}`;
}

function emptyConsole(): void {
  root.querySelector<HTMLElement>('[data-ticket]')!.innerHTML = '<div class="game-empty-ticket"><span>No ticket selected</span><h2>Choose a hungry plant.</h2><p>Click a plant in the scene or press its number key.</p></div>';
  root.querySelector<HTMLElement>('[data-controls]')!.innerHTML = '<fieldset disabled><legend>Serving configuration</legend><p>The controls wake up when a ticket reaches the counter.</p></fieldset>';
  root.querySelector<HTMLElement>('[data-readout]')!.innerHTML = '<header><span>Model preview</span><strong>Waiting for an order</strong></header>';
}

function screenMarkup(): string {
  if (state.screen === 'playing') return '';
  if (state.screen === 'title') {
    const complete = CAMPAIGN_SHIFTS.filter((shift) => save.completedShiftIds.includes(shift.id)).length;
    const campaignLabel = complete === CAMPAIGN_SHIFTS.length ? 'Replay campaign' : complete ? `Continue · Shift ${complete + 1}` : 'Start campaign';
    return `<div class="game-title-card"><p>Seymour presents</p><h1>Feed<br>the machine</h1><span class="game-title-sub">The inference lunch rush</span><div class="game-title-plant" aria-hidden="true"><i></i><i></i><i></i></div><p class="game-title-copy">Read the workload. Turn the right knobs. Keep three power fuses alive.</p><div class="game-title-actions"><button type="button" data-action="start-campaign">${campaignLabel}</button><button type="button" data-action="start-endless"${save.endlessUnlocked ? '' : ' disabled'}>${save.endlessUnlocked ? 'Endless lunch rush' : 'Endless · clear Shift 5'}</button></div><small>Keyboard + pointer · pause any time · no account</small></div>`;
  }
  if (state.screen === 'briefing') return `<div class="game-overlay-card"><span>Shift ${state.shift.number.toString().padStart(2, '0')}</span><h2>${state.shift.title}</h2><strong>${state.shift.subtitle}</strong><p>${state.shift.briefing}</p><div class="game-unlocks"><b>Counter today</b>${state.shift.controls.map((control) => `<i>${controlMeta[control].label}</i>`).join('')}${state.shift.batchTray ? '<i>Batch tray</i>' : ''}</div><button type="button" data-action="begin">Open the counter</button></div>`;
  if (state.screen === 'paused') return `<div class="game-overlay-card"><span>Clock stopped</span><h2>Shift paused</h2><p>Every plant’s patience and the kitchen clock are frozen.</p><button type="button" data-action="resume">Resume shift</button><button class="game-secondary-action" type="button" data-action="restart">Restart shift</button></div>`;
  if (state.screen === 'shift-complete') return `<div class="game-overlay-card"><span>Counter cleared</span><h2>${state.shift.title} complete</h2><strong>${scoreText(state.score)} points · ${state.fuses} fuses left</strong><p>${state.shift.lesson}</p><button type="button" data-action="next">${state.mode === 'endless' ? 'Start next rush' : state.shift.number === 5 ? 'Finish campaign' : 'Brief next shift'}</button><button class="game-secondary-action" type="button" data-action="restart">Replay this shift</button></div>`;
  if (state.screen === 'game-over') return `<div class="game-overlay-card" data-danger="true"><span>All three fuses are gone</span><h2>Kitchen offline</h2><p>${state.event.detail}</p><strong>${scoreText(state.score)} points</strong><button type="button" data-action="restart">Retry this shift</button><button class="game-secondary-action" type="button" data-action="title">Return to title</button></div>`;
  return `<div class="game-overlay-card"><span>Five shifts cleared</span><h2>You fed the machine.</h2><p>The workload changed, so the bottleneck moved. You kept reading the requirement instead of reaching for one favorite optimization.</p><strong>Endless Lunch Rush unlocked</strong><button type="button" data-action="start-endless">Start endless mode</button><button class="game-secondary-action" type="button" data-action="title">Return to title</button></div>`;
}

function renderDom(): void {
  root.querySelector<HTMLElement>('[data-shift-number]')!.textContent = `${state.mode === 'endless' ? 'Rush' : 'Shift'} ${state.shift.number.toString().padStart(2, '0')}`;
  root.querySelector<HTMLElement>('[data-shift-title]')!.textContent = state.shift.title;
  root.querySelector<HTMLElement>('[data-shift-subtitle]')!.textContent = state.shift.subtitle;
  root.querySelector<HTMLElement>('[data-score]')!.textContent = scoreText(state.score);
  root.querySelector<HTMLElement>('[data-clock]')!.textContent = clockText(state.elapsedMs);
  root.querySelector<HTMLElement>('[data-combo]')!.textContent = `×${state.combo}`;
  root.querySelector<HTMLElement>('[data-fuses]')!.innerHTML = Array.from({ length: 3 }, (_, index) => `<i data-live="${index < state.fuses}" title="${index < state.fuses ? 'Fuse intact' : 'Fuse blown'}"><span class="sr-only">${index < state.fuses ? 'Fuse intact' : 'Fuse blown'}</span></i>`).join('');
  const sound = root.querySelector<HTMLButtonElement>('[data-action="sound"]')!;
  sound.textContent = save.soundEnabled ? 'Sound on' : 'Sound off'; sound.setAttribute('aria-pressed', String(save.soundEnabled));
  const pause = root.querySelector<HTMLButtonElement>('[data-action="pause"]')!;
  pause.disabled = state.screen !== 'playing';
  const queue = root.querySelector<HTMLOListElement>('[data-customer-queue]')!;
  queue.innerHTML = state.active.map((customer, index) => `<li><button type="button" data-customer="${customer.order.id}" aria-pressed="${customer.order.id === state.selectedId}"><b>${index + 1}</b><span>${customer.order.plantName}<small>${customer.order.orderName}</small></span><i style="--patience:${Math.round(customer.patienceMs / customer.order.patienceMs * 100)}%"></i>${customer.onBatchTray ? '<em>tray</em>' : ''}</button></li>`).join('');
  root.querySelector<HTMLElement>('[data-game-screen]')!.innerHTML = screenMarkup();
  const selected = selectedCustomer();
  if (selected) {
    root.querySelector<HTMLElement>('[data-ticket]')!.innerHTML = ticketMarkup(selected);
    root.querySelector<HTMLFormElement>('[data-controls]')!.innerHTML = controlsMarkup(selected);
    root.querySelector<HTMLElement>('[data-readout]')!.innerHTML = readoutMarkup(selected);
  } else emptyConsole();
  const eventBox = root.querySelector<HTMLElement>('.game-event')!;
  eventBox.dataset.eventType = state.event.type;
  root.querySelector<HTMLElement>('[data-event-title]')!.textContent = state.event.title;
  root.querySelector<HTMLElement>('[data-event-detail]')!.textContent = state.event.detail;
  canvas.setAttribute('aria-label', sceneDescription(state));
  const status = root.querySelector<HTMLElement>('[data-live-status]')!;
  const alert = root.querySelector<HTMLElement>('[data-live-alert]')!;
  if (state.event.type === 'fuse') { alert.textContent = `${state.event.title}. ${state.event.detail}`; status.textContent = ''; }
  else { status.textContent = `${state.event.title}. ${state.event.detail}`; alert.textContent = ''; }
}

function renderLiveDom(): void {
  root.querySelector<HTMLElement>('[data-score]')!.textContent = scoreText(state.score);
  root.querySelector<HTMLElement>('[data-clock]')!.textContent = clockText(state.elapsedMs);
  root.querySelector<HTMLElement>('[data-combo]')!.textContent = `×${state.combo}`;

  const selected = selectedCustomer();
  if (selected) {
    const ticket = root.querySelector<HTMLElement>('[data-ticket]')!;
    const progress = ticket.querySelector<HTMLProgressElement>('progress');
    const seconds = ticket.querySelector<HTMLElement>('.ticket-patience b');
    if (progress) progress.value = selected.patienceMs;
    if (seconds) seconds.textContent = `${Math.ceil(selected.patienceMs / 1000)}s`;
  }

  const queueButtons = root.querySelectorAll<HTMLButtonElement>('[data-customer]');
  for (const button of queueButtons) {
    const customer = state.active.find((candidate) => candidate.order.id === button.dataset.customer);
    const meter = button.querySelector<HTMLElement>(':scope > i');
    if (customer && meter) meter.style.setProperty('--patience', `${Math.round(customer.patienceMs / customer.order.patienceMs * 100)}%`);
  }
}

function startCampaign(): void {
  const incomplete = CAMPAIGN_SHIFTS.findIndex((shift) => !save.completedShiftIds.includes(shift.id));
  const index = incomplete < 0 ? 0 : incomplete;
  setState(createGameState(campaignShift(index)));
}

function toTitle(): void {
  const fresh = createGameState(campaignShift(0));
  setState({ ...fresh, screen: 'title' });
}

root.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const customerButton = target.closest<HTMLButtonElement>('[data-customer]');
  if (customerButton) { setState(selectCustomer(state, customerButton.dataset.customer!)); return; }
  const actionButton = target.closest<HTMLButtonElement>('[data-action]');
  if (!actionButton) return;
  const action = actionButton.dataset.action;
  if (action === 'start-campaign') startCampaign();
  if (action === 'start-endless' && save.endlessUnlocked) setState(startEndless(new Date().getUTCDate()));
  if (action === 'begin') setState(beginShift(state));
  if (action === 'pause') setState(pauseGame(state));
  if (action === 'resume') setState(resumeGame(state));
  if (action === 'restart') setState(restartShift(state));
  if (action === 'next') setState(nextShift(state));
  if (action === 'feed') setState(feedSelected(state));
  if (action === 'batch' && state.selectedId) setState(toggleBatchTray(state, state.selectedId));
  if (action === 'title') toTitle();
  if (action === 'sound') {
    save = setSoundPreference(save, !save.soundEnabled); saveGame(save); audio.setEnabled(save.soundEnabled); audio.play('batch'); renderDom();
  }
});

root.addEventListener('change', (event) => {
  const control = (event.target as HTMLElement).closest<HTMLInputElement | HTMLSelectElement>('[data-control]');
  if (!control || !state.selectedId) return;
  const key = control.dataset.control as GameControlId;
  let value: GameConfiguration[GameControlId];
  if (control instanceof HTMLInputElement) value = control.checked;
  else if (key === 'weightBits' || key === 'mathBits' || key === 'kvBits') value = Number(control.value) as GameConfiguration[typeof key];
  else value = control.value as KvPlacement;
  setState(setCustomerControl(state, state.selectedId, key, value as never), true);
});

canvas.addEventListener('pointerdown', (event) => {
  const bounds = canvas.getBoundingClientRect();
  const id = customerAtPoint(state, (event.clientX - bounds.left) / bounds.width * canvas.width, (event.clientY - bounds.top) / bounds.height * canvas.height);
  if (id) setState(selectCustomer(state, id));
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (state.screen === 'playing') setState(pauseGame(state));
    else if (state.screen === 'paused') setState(resumeGame(state));
    return;
  }
  if (state.screen !== 'playing') return;
  const target = event.target as HTMLElement;
  const editing = target.matches('select, input, button, summary');
  if (/^[1-9]$/.test(event.key)) {
    const customer = state.active[Number(event.key) - 1];
    if (customer) setState(selectCustomer(state, customer.order.id));
    return;
  }
  if (!editing && event.code === 'Space') { event.preventDefault(); setState(feedSelected(state)); return; }
  if (!editing && event.key.toLowerCase() === 'b' && state.selectedId) { setState(toggleBatchTray(state, state.selectedId)); return; }
  const controls = Array.from(root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('.game-control'));
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key) || controls.length === 0) return;
  event.preventDefault();
  const currentIndex = Math.max(0, controls.indexOf(document.activeElement as HTMLInputElement | HTMLSelectElement));
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    controls[(currentIndex + direction + controls.length) % controls.length]!.focus();
    return;
  }
  const control = controls[currentIndex]!;
  if (control instanceof HTMLSelectElement) {
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    control.selectedIndex = (control.selectedIndex + direction + control.options.length) % control.options.length;
  } else control.checked = event.key === 'ArrowRight' ? true : event.key === 'ArrowLeft' ? false : !control.checked;
  control.dispatchEvent(new Event('change', { bubbles: true }));
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.screen === 'playing') setState(pauseGame(state));
});

function frame(now: number): void {
  const delta = Math.min(100, now - lastFrame);
  lastFrame = now;
  if (state.screen === 'playing') {
    const next = advanceGame(state, delta);
    if (next !== state) {
      const eventChanged = next.event.id !== state.event.id;
      const screenChanged = next.screen !== state.screen;
      const structuralRender = requiresStructuralRender(state, next);
      state = next;
      if (eventChanged) { renderedEventId = state.event.id; eventStartedAt = now; audio.play(state.event.type); }
      if (screenChanged && state.screen === 'shift-complete') {
        const campaignComplete = state.mode === 'campaign' && state.shift.id === CAMPAIGN_SHIFTS.at(-1)!.id;
        save = state.mode === 'campaign'
          ? recordShift(save, state.shift.id, state.score, campaignComplete)
          : recordScore(save, 'endless', state.score);
        saveGame(save);
      }
      if (screenChanged && state.screen === 'game-over') {
        save = recordScore(save, state.mode === 'endless' ? 'endless' : state.shift.id, state.score);
        saveGame(save);
      }
      if (structuralRender) renderDom();
    }
  }
  renderScene(canvas, { state, now, eventAgeMs: now - eventStartedAt, reducedMotion: reducedMotion.matches });
  if (now - lastDomRender > 100) { renderLiveDom(); lastDomRender = now; }
  requestAnimationFrame(frame);
}

audio.setEnabled(save.soundEnabled);
renderDom();
requestAnimationFrame(frame);
