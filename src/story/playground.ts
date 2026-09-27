import { DEFAULT_MODEL, DEFAULT_SETTINGS, HARDWARE_PROFILES, getHardware } from '../data/profiles';
import { calculateSimulation, formatDuration, formatNumber } from '../model/calculate';
import { applySoftwareStrategy } from '../model/strategy';
import { batchFromSlider, batchToSlider, prefixCacheFromSlider, prefixCacheToSlider, sequenceFromSlider, sequenceToSlider } from '../state';
import type { KvPlacement, SimulationSettings } from '../types';
import { CHALLENGES, getChallenge } from './challenges/data';
import { evaluateChallenge, type Challenge, type ConstraintMetric, type KnobId } from './challenges/engine';
import { buildCutawayInputs } from './cutaway/inputs';
import { TILE_STEPS, diePlate, packagePlate, serverPlate, unitPlate, type Plate, type PlateId } from './cutaway/plates';
import { mountCutaway, type CutawayView } from './cutaway/render';
import { buildPictureModel } from './picture/model';
import { renderPicture } from './picture/render';

type ControlKey = KnobId | 'hardwareId';

const PLATE_TABS: [PlateId, string][] = [['server', 'Server'], ['package', 'Package'], ['die', 'Die'], ['unit', 'Compute unit']];

export function mountPlayground(root: HTMLElement): void {
  let settings: SimulationSettings = { ...getChallenge('chatbot').naive };
  let selectedChallenge: Challenge | null = getChallenge('chatbot');
  let plateId: PlateId = 'package';
  let tileStep = 0;
  let cutaway: CutawayView | null = null;

  root.innerHTML = `<header class="playground-heading"><div><span>Playground</span><h2>Make the bottleneck move.</h2></div><p>Every control changes the analytical model. Choose free play or accept a challenge with fixed workload constraints.</p></header>
    <div class="playground-shell">
      <aside class="playground-controls">
        <label><span>Mode</span><select aria-label="Mode" data-control="challenge"><option value="free">Free play</option>${CHALLENGES.map((challenge) => `<option value="${challenge.id}">${challenge.title}</option>`).join('')}</select></label>
        <fieldset><legend>Workload</legend>
          <label><span>Concurrent users <output data-output="batch"></output></span><input aria-label="Concurrent users" data-control="batch" type="range" min="0" max="10" step="1"></label>
          <label><span>Context length <output data-output="sequenceLength"></output></span><input aria-label="Context length" data-control="sequenceLength" type="range" min="0" max="8" step="1"></label>
        </fieldset>
        <fieldset><legend>Bytes</legend>
          <label><span>Model precision</span><select aria-label="Model precision" data-control="weightBits"><option value="16">16-bit</option><option value="8">8-bit</option><option value="4">4-bit</option></select></label>
          <label><span>KV precision</span><select aria-label="KV precision" data-control="kvBits"><option value="16">16-bit</option><option value="8">8-bit</option></select></label>
          <label class="playground-check"><input data-control="reusePromptPrefixes" type="checkbox"><span>Reuse a shared prompt prefix</span></label>
          <label><span>Prefix already available <output data-output="prefixCachePercent"></output></span><input aria-label="Prefix already available" data-control="prefixCachePercent" type="range" min="0" max="5" step="1"></label>
        </fieldset>
        <fieldset><legend>Placement + target</legend>
          <label><span>Active KV location</span><select aria-label="Active KV location" data-control="kvPlacement"><option value="hbm">GPU memory</option><option value="host">System memory</option><option value="peer">Another GPU</option><option value="ssd">Local solid-state storage</option><option value="object">Network object storage</option></select></label>
          <label><span>Accelerator</span><select aria-label="Accelerator" data-control="hardwareId">${HARDWARE_PROFILES.map((hardware) => `<option value="${hardware.id}">${hardware.name}</option>`).join('')}</select></label>
        </fieldset>
      </aside>
      <div class="playground-workbench">
        <section class="playground-cutaway" aria-label="Cutaway view">
          <div class="playground-plate-tabs" role="group" aria-label="Zoom level">${PLATE_TABS.map(([id, label]) => `<button type="button" data-plate="${id}" aria-pressed="${id === 'package'}">${label}</button>`).join('')}</div>
          <div class="playground-tile" data-tile-steps hidden></div>
          <div data-playground-cutaway></div>
          <p class="panel-caption" data-tile-text hidden></p>
          <ul class="cw-legend" aria-label="What each label rests on"><li><i class="cw-basis-published"></i>published figure</li><li><i class="cw-basis-representative"></i>representative figure</li><li><i class="cw-basis-schematic"></i>schematic placement</li></ul>
        </section>
        <div data-playground-picture></div>
        <section class="challenge-board" data-challenge-board></section>
      </div>
    </div>`;

  const challengeSelect = root.querySelector<HTMLSelectElement>('[data-control="challenge"]')!;
  challengeSelect.value = selectedChallenge.id;
  const controls = new Map<ControlKey, HTMLInputElement | HTMLSelectElement>();
  for (const key of ['batch', 'sequenceLength', 'weightBits', 'kvBits', 'reusePromptPrefixes', 'prefixCachePercent', 'kvPlacement', 'hardwareId'] as ControlKey[]) {
    controls.set(key, root.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-control="${key}"]`)!);
  }

  function syncControls(): void {
    (controls.get('batch') as HTMLInputElement).value = String(batchToSlider(settings.batch));
    (controls.get('sequenceLength') as HTMLInputElement).value = String(sequenceToSlider(settings.sequenceLength));
    (controls.get('weightBits') as HTMLSelectElement).value = String(settings.weightBits);
    (controls.get('kvBits') as HTMLSelectElement).value = String(settings.kvBits);
    (controls.get('reusePromptPrefixes') as HTMLInputElement).checked = settings.reusePromptPrefixes;
    (controls.get('prefixCachePercent') as HTMLInputElement).value = String(prefixCacheToSlider(settings.prefixCachePercent));
    (controls.get('kvPlacement') as HTMLSelectElement).value = settings.kvPlacement;
    (controls.get('hardwareId') as HTMLSelectElement).value = settings.hardwareId;
    root.querySelector<HTMLOutputElement>('[data-output="batch"]')!.value = settings.batch.toLocaleString();
    root.querySelector<HTMLOutputElement>('[data-output="sequenceLength"]')!.value = `${settings.sequenceLength.toLocaleString()} tokens`;
    root.querySelector<HTMLOutputElement>('[data-output="prefixCachePercent"]')!.value = settings.reusePromptPrefixes ? `${settings.prefixCachePercent}%` : 'off';

    for (const [key, control] of controls) {
      control.disabled = selectedChallenge !== null && !selectedChallenge.adjustable.includes(key as KnobId);
    }
    if (!settings.reusePromptPrefixes) controls.get('prefixCachePercent')!.disabled = true;
  }

  function metricLabel(metric: ConstraintMetric): string {
    return ({ msPerToken: 'Time per token', timeToFirstTokenMs: 'First token', totalTokensPerSec: 'Total throughput', concurrentUsers: 'Concurrent users', fitsInGpuMemory: 'Fits in GPU memory', activeKvInGpuMemory: 'Active KV beside the GPU', restoreBeatsRecompute: 'Idle restore beats rebuild' })[metric];
  }

  function metricValue(metric: ConstraintMetric, value: number | boolean): string {
    if (typeof value === 'boolean') return value ? 'yes' : 'no';
    if (metric === 'msPerToken' || metric === 'timeToFirstTokenMs') return formatDuration(value);
    if (metric === 'totalTokensPerSec') return `${formatNumber(value)} tok/s`;
    return formatNumber(value);
  }

  function renderChallenge(): void {
    const board = root.querySelector<HTMLElement>('[data-challenge-board]')!;
    if (!selectedChallenge) {
      board.innerHTML = '<span>Free play</span><p>Nothing is fixed. Watch the picture and ask which of Work, Traffic, Placement, or Execution changes.</p>';
      board.dataset.passed = 'false';
      return;
    }
    const evaluation = evaluateChallenge(selectedChallenge, settings);
    board.dataset.passed = String(evaluation.passed);
    board.innerHTML = `<header><div><span>Challenge</span><h3>${selectedChallenge.title}</h3></div><button type="button" data-reset-challenge>Reset obvious attempt</button></header><p>${selectedChallenge.brief}</p><ul>${evaluation.results.map((result) => `<li data-met="${result.met}"><span>${result.met ? '✓' : '×'}</span><p><b>${metricLabel(result.constraint.metric)}</b><small>actual ${metricValue(result.constraint.metric, result.actual)} · target ${result.constraint.op} ${metricValue(result.constraint.metric, result.constraint.value)}</small></p></li>`).join('')}</ul>${evaluation.passed ? `<div class="challenge-success"><strong>Constraint cleared.</strong><p>${selectedChallenge.lesson}</p></div>` : ''}`;
    board.querySelector<HTMLButtonElement>('[data-reset-challenge]')!.addEventListener('click', () => {
      settings = { ...selectedChallenge!.naive };
      syncControls();
      render();
    });
  }

  function render(): void {
    const hardware = getHardware(settings.hardwareId);
    const model = applySoftwareStrategy(DEFAULT_MODEL, settings);
    const result = calculateSimulation(settings, hardware, model);
    const picture = buildPictureModel(result, settings, hardware, model);
    renderPicture(root.querySelector<HTMLElement>('[data-playground-picture]')!, picture, new Set(['stepCost', 'throughput', 'distanceLadder']));
    renderCutaway();
    renderChallenge();
  }

  function currentPlate(): Plate {
    const inputs = buildCutawayInputs(settings, getHardware(settings.hardwareId), applySoftwareStrategy(DEFAULT_MODEL, settings));
    if (plateId === 'server') return serverPlate(inputs);
    if (plateId === 'die') return diePlate(inputs, { job: 'decode', detail: 'full' });
    if (plateId === 'unit') return unitPlate(settings.hardwareId, tileStep);
    return packagePlate(inputs);
  }

  function renderCutaway(): void {
    const steps = TILE_STEPS[settings.hardwareId]!;
    tileStep = Math.min(tileStep, steps.length - 1);
    const stepsNode = root.querySelector<HTMLElement>('[data-tile-steps]')!;
    const textNode = root.querySelector<HTMLElement>('[data-tile-text]')!;
    stepsNode.hidden = plateId !== 'unit';
    textNode.hidden = plateId !== 'unit';
    if (plateId === 'unit') {
      stepsNode.innerHTML = `<span>Follow one tile</span>${steps.map((step, index) => `<button type="button" data-tile="${index}" aria-pressed="${index === tileStep}">${index + 1} · ${step.title}</button>`).join('')}`;
      textNode.innerHTML = `<b>Step ${tileStep + 1} · ${steps[tileStep]!.title}.</b> ${steps[tileStep]!.text}`;
    }
    const plate = currentPlate();
    const host = root.querySelector<HTMLElement>('[data-playground-cutaway]')!;
    if (cutaway) cutaway.update(plate);
    else cutaway = mountCutaway(host, plate, 'Playground cutaway');
  }

  root.querySelector<HTMLElement>('.playground-cutaway')!.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-plate], button[data-tile]');
    if (!button) return;
    if (button.dataset.plate) {
      plateId = button.dataset.plate as PlateId;
      for (const tab of root.querySelectorAll<HTMLButtonElement>('button[data-plate]')) tab.setAttribute('aria-pressed', String(tab === button));
    }
    if (button.dataset.tile) tileStep = Number(button.dataset.tile);
    renderCutaway();
  });

  challengeSelect.addEventListener('change', () => {
    selectedChallenge = challengeSelect.value === 'free' ? null : getChallenge(challengeSelect.value);
    settings = selectedChallenge ? { ...selectedChallenge.naive } : { ...DEFAULT_SETTINGS };
    syncControls();
    render();
  });

  for (const [key, control] of controls) {
    control.addEventListener('input', () => {
      if (key === 'batch') settings.batch = batchFromSlider(Number(control.value));
      if (key === 'sequenceLength') settings.sequenceLength = sequenceFromSlider(Number(control.value));
      if (key === 'weightBits') settings.weightBits = Number(control.value) as SimulationSettings['weightBits'];
      if (key === 'kvBits') settings.kvBits = Number(control.value) as SimulationSettings['kvBits'];
      if (key === 'reusePromptPrefixes') settings.reusePromptPrefixes = (control as HTMLInputElement).checked;
      if (key === 'prefixCachePercent') settings.prefixCachePercent = prefixCacheFromSlider(Number(control.value));
      if (key === 'kvPlacement') settings.kvPlacement = control.value as KvPlacement;
      if (key === 'hardwareId') settings.hardwareId = control.value;
      syncControls();
      render();
    });
  }

  syncControls();
  render();
}
