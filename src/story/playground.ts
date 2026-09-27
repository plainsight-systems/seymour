import { DEFAULT_SETTINGS, HARDWARE_PROFILES, MODEL_PROFILES, getHardware } from '../data/profiles';
import { calculateSimulation, formatDuration, formatNumber, responseTiming } from '../model/calculate';
import { modelFor } from '../model/strategy';
import { batchFromSlider, batchToSlider, prefixCacheFromSlider, prefixCacheToSlider, sequenceFromSlider, sequenceToSlider } from '../state';
import type { KvPlacement, SimulationSettings } from '../types';
import { CHALLENGES, getChallenge } from './challenges/data';
import { evaluateChallenge, type Challenge, type ConstraintMetric, type KnobId } from './challenges/engine';
import { buildCutawayInputs } from './cutaway/inputs';
import { tileSteps, diePlate, packagePlate, serverPlate, unitPlate, type Plate, type PlateId } from './cutaway/plates';
import { mountCutaway, type CutawayView } from './cutaway/render';
import { buildPictureModel } from './picture/model';
import { renderPicture } from './picture/render';

type ControlKey = KnobId | 'hardwareId' | 'modelId' | 'speculativeTokens' | 'mathBits' | 'outputLength';

/** Answer lengths, up to long reasoning-style answers. */
const ANSWER_LENGTHS = [1, 32, 128, 512, 2048, 8192];

const CONTROL_NAMES: Record<ControlKey, string> = {
  batch: 'concurrent users', sequenceLength: 'context length', weightBits: 'model precision', kvBits: 'KV precision',
  reusePromptPrefixes: 'prefix reuse', prefixCachePercent: 'prefix share', kvPlacement: 'KV location', hardwareId: 'accelerator',
  modelId: 'model', speculativeTokens: 'speculative decoding', mathBits: 'math precision', outputLength: 'answer length',
};

const PLATE_TABS: [PlateId, string][] = [['server', 'Server'], ['package', 'Package'], ['die', 'Die'], ['unit', 'Compute unit']];

function nearestIndex(choices: number[], value: number): number {
  let best = 0;
  choices.forEach((choice, index) => { if (Math.abs(choice - value) < Math.abs(choices[best]! - value)) best = index; });
  return best;
}

export function mountPlayground(root: HTMLElement): void {
  // Open in free play: every knob is live until the reader accepts a challenge.
  let settings: SimulationSettings = { ...DEFAULT_SETTINGS };
  let selectedChallenge: Challenge | null = null;
  let plateId: PlateId = 'package';
  let tileStep = 0;
  let cutaway: CutawayView | null = null;

  root.innerHTML = `<header class="playground-heading"><div><span>Playground</span><h2>Make the bottleneck move.</h2></div><p>Every control changes the analytical model. Choose free play or accept a challenge with fixed workload constraints. Both accelerators use the same efficiency assumptions (55% of peak math, 72% of peak memory bandwidth), so comparisons reflect published peaks, not measurements.</p></header>
    <div class="playground-shell">
      <aside class="playground-controls">
        <label><span>Mode</span><select aria-label="Mode" data-control="challenge"><option value="free">Free play</option>${CHALLENGES.map((challenge) => `<option value="${challenge.id}">Challenge: ${challenge.title}</option>`).join('')}</select><small class="playground-lock" data-lock-note hidden></small></label>
        <fieldset><legend>Workload</legend>
          <label><span>Concurrent users <output data-output="batch"></output></span><input aria-label="Concurrent users" data-control="batch" type="range" min="0" max="10" step="1"></label>
          <label><span>Context length <output data-output="sequenceLength"></output></span><input aria-label="Context length" data-control="sequenceLength" type="range" min="0" max="8" step="1"></label>
          <label><span>Answer length <output data-output="outputLength"></output></span><input aria-label="Answer length" data-control="outputLength" type="range" min="0" max="${ANSWER_LENGTHS.length - 1}" step="1"></label>
        </fieldset>
        <fieldset><legend>Model + decoding</legend>
          <label><span>Model</span><select aria-label="Model" data-control="modelId">${MODEL_PROFILES.map((model) => `<option value="${model.id}">${model.name.split(' · ')[0]}</option>`).join('')}</select></label>
          <label><span>Speculative decoding</span><select aria-label="Speculative decoding" data-control="speculativeTokens"><option value="0">Off</option><option value="2">Guess 2 tokens ahead</option><option value="4">Guess 4 tokens ahead</option></select></label>
        </fieldset>
        <fieldset><legend>Bytes</legend>
          <label><span>Model precision</span><select aria-label="Model precision" data-control="weightBits"><option value="16">16-bit</option><option value="8">8-bit</option><option value="4">4-bit</option></select></label>
          <label><span>Math precision</span><select aria-label="Math precision" data-control="mathBits"><option value="16">FP16</option><option value="8">FP8 (needs 8- or 4-bit weights)</option></select></label>
          <label><span>KV precision</span><select aria-label="KV precision" data-control="kvBits"><option value="16">16-bit</option><option value="8">8-bit</option></select></label>
          <label class="playground-check"><input data-control="reusePromptPrefixes" type="checkbox"><span>Reuse a shared prompt prefix</span></label>
          <label><span>Prefix already available <output data-output="prefixCachePercent"></output></span><input aria-label="Prefix already available" data-control="prefixCachePercent" type="range" min="0" max="5" step="1"></label>
        </fieldset>
        <fieldset><legend>Placement + target</legend>
          <label><span>Active KV location</span><select aria-label="Active KV location" data-control="kvPlacement"><option value="hbm">GPU memory</option><option value="host">System memory</option><option value="peer">One other GPU</option><option value="peers">Spread across all seven other GPUs</option><option value="ssd">Local solid-state storage</option><option value="object">Network object storage</option></select></label>
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
        <section class="playground-response" data-response aria-label="Response timing"></section>
        <div data-playground-picture></div>
        <section class="challenge-board" data-challenge-board></section>
      </div>
    </div>`;

  const challengeSelect = root.querySelector<HTMLSelectElement>('[data-control="challenge"]')!;
  challengeSelect.value = 'free';
  const controls = new Map<ControlKey, HTMLInputElement | HTMLSelectElement>();
  for (const key of ['batch', 'sequenceLength', 'outputLength', 'modelId', 'speculativeTokens', 'weightBits', 'mathBits', 'kvBits', 'reusePromptPrefixes', 'prefixCachePercent', 'kvPlacement', 'hardwareId'] as ControlKey[]) {
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
    (controls.get('modelId') as HTMLSelectElement).value = settings.modelId;
    (controls.get('speculativeTokens') as HTMLSelectElement).value = String(settings.speculativeTokens);
    (controls.get('mathBits') as HTMLSelectElement).value = String(settings.mathBits);
    root.querySelector<HTMLOutputElement>('[data-output="batch"]')!.value = settings.batch.toLocaleString();
    root.querySelector<HTMLOutputElement>('[data-output="sequenceLength"]')!.value = `${settings.sequenceLength.toLocaleString()} tokens`;
    (controls.get('outputLength') as HTMLInputElement).value = String(nearestIndex(ANSWER_LENGTHS, settings.outputLength));
    root.querySelector<HTMLOutputElement>('[data-output="outputLength"]')!.value = `${settings.outputLength.toLocaleString()} tokens`;
    root.querySelector<HTMLOutputElement>('[data-output="prefixCachePercent"]')!.value = settings.reusePromptPrefixes ? `${settings.prefixCachePercent}%` : 'off';

    const locked: string[] = [];
    for (const [key, control] of controls) {
      control.disabled = selectedChallenge !== null && !selectedChallenge.adjustable.includes(key as KnobId);
      if (control.disabled) locked.push(CONTROL_NAMES[key]);
    }
    if (!settings.reusePromptPrefixes) controls.get('prefixCachePercent')!.disabled = true;
    if (settings.weightBits === 16) controls.get('mathBits')!.disabled = true;
    const note = root.querySelector<HTMLElement>('[data-lock-note]')!;
    note.hidden = locked.length === 0;
    note.textContent = `This challenge fixes ${locked.join(', ')}. Choose Free play to change them.`;
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
    const model = modelFor(settings);
    const result = calculateSimulation(settings, hardware, model);
    const picture = buildPictureModel(result, settings, hardware, model);
    renderPicture(root.querySelector<HTMLElement>('[data-playground-picture]')!, picture, new Set(['stepCost', 'throughput', 'distanceLadder']));
    renderResponse(hardware, model);
    renderCutaway();
    renderChallenge();
  }

  function renderResponse(hardware: ReturnType<typeof getHardware>, model: ReturnType<typeof modelFor>): void {
    const timing = responseTiming(settings, hardware, model);
    const node = root.querySelector<HTMLElement>('[data-response]')!;
    const metric = (label: string, value: string, note: string) => `<p><span>${label}</span><strong>${value}</strong><small>${note}</small></p>`;
    node.innerHTML = `<h3>One answer of ${settings.outputLength.toLocaleString()} tokens</h3><div>${[
      metric('First token', formatDuration(timing.firstTokenMs), 'prompt processing'),
      metric('Each token after', formatDuration(timing.msPerToken), 'priced at the answer’s midpoint context'),
      metric('Full answer', formatDuration(timing.fullAnswerMs), `first token + ${Math.max(0, settings.outputLength - 1).toLocaleString()} more`),
      metric('GPU time per 1K tokens', `${formatNumber(timing.gpuSecondsPer1kTokens)} s`, settings.batch === 1 ? 'for one user' : `across all ${settings.batch.toLocaleString()} users`),
    ].join('')}</div>`;
  }

  function currentPlate(): Plate {
    const inputs = buildCutawayInputs(settings, getHardware(settings.hardwareId), modelFor(settings));
    if (plateId === 'server') return serverPlate(inputs);
    if (plateId === 'die') return diePlate(inputs, { job: 'decode', detail: 'full' });
    if (plateId === 'unit') return unitPlate(settings.hardwareId, tileStep);
    return packagePlate(inputs);
  }

  function renderCutaway(): void {
    const steps = tileSteps(settings.hardwareId);
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
      if (key === 'outputLength') settings.outputLength = ANSWER_LENGTHS[Number(control.value)]!;
      if (key === 'weightBits') settings.weightBits = Number(control.value) as SimulationSettings['weightBits'];
      if (key === 'kvBits') settings.kvBits = Number(control.value) as SimulationSettings['kvBits'];
      if (key === 'reusePromptPrefixes') settings.reusePromptPrefixes = (control as HTMLInputElement).checked;
      if (key === 'prefixCachePercent') settings.prefixCachePercent = prefixCacheFromSlider(Number(control.value));
      if (key === 'kvPlacement') settings.kvPlacement = control.value as KvPlacement;
      if (key === 'hardwareId') settings.hardwareId = control.value;
      if (key === 'modelId') settings.modelId = control.value;
      if (key === 'mathBits') settings.mathBits = Number(control.value) as SimulationSettings['mathBits'];
      if (key === 'weightBits' && settings.weightBits === 16) settings.mathBits = 16;
      if (key === 'speculativeTokens') settings.speculativeTokens = Number(control.value) as SimulationSettings['speculativeTokens'];
      syncControls();
      render();
    });
  }

  syncControls();
  render();
}
