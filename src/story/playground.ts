import { DEFAULT_SETTINGS, MODEL_PROFILES, getHardware } from '../data/profiles';
import { calculateSimulation, formatDuration, formatNumber, responseTiming } from '../model/calculate';
import { modelFor } from '../model/strategy';
import { BATCHES, PREFIX_CACHE_PERCENTAGES, SEQUENCES, batchFromSlider, batchToSlider, nearestIndex, prefixCacheFromSlider, prefixCacheToSlider, sequenceFromSlider, sequenceToSlider } from '../state';
import type { KvPlacement, SimulationSettings } from '../types';
import { placementOptions } from './placement';
import { buildCutawayInputs } from './cutaway/inputs';
import { tileSteps, diePlate, packagePlate, serverPlate, unitPlate, type Plate, type PlateId } from './cutaway/plates';
import { CUTAWAY_LEGEND, mountCutaway, type CutawayView } from './cutaway/render';
import { buildPictureModel } from './picture/model';
import { renderPicture } from './picture/render';

/** The playground's controls. The chip comes from the act header, so it has no control here. */
type ControlKey = 'batch' | 'sequenceLength' | 'outputLength' | 'modelId' | 'speculativeTokens' | 'weightBits' | 'mathBits' | 'kvBits' | 'reusePromptPrefixes' | 'prefixCachePercent' | 'kvPlacement';

/** Answer lengths, up to long reasoning-style answers. */
const ANSWER_LENGTHS = [1, 32, 128, 512, 2048, 8192];

const PLATE_TABS: [PlateId, string][] = [['server', 'Server'], ['package', 'Package'], ['die', 'Die'], ['unit', 'Compute unit']];

export interface PlaygroundView {
  /** Follows the story-wide accelerator choice. */
  setHardware(hardwareId: string): void;
  /** Re-measures the drawing after the playground's scene becomes visible. */
  refresh(): void;
}

export function mountPlayground(root: HTMLElement): PlaygroundView {
  // Free play: every knob is live. The challenges have their own scene.
  let settings: SimulationSettings = { ...DEFAULT_SETTINGS };
  let plateId: PlateId = 'package';
  let tileStep = 0;
  let cutaway: CutawayView | null = null;

  root.innerHTML = `
    <div class="playground-shell">
      <aside class="playground-controls">
        <details class="playground-group" open><summary>Workload</summary>
          <label><span>Users per pass <output data-output="batch"></output></span><input aria-label="Users per pass" data-control="batch" type="range" min="0" max="${BATCHES.length - 1}" step="1"></label>
          <label><span>Context length <output data-output="sequenceLength"></output></span><input aria-label="Context length" data-control="sequenceLength" type="range" min="0" max="${SEQUENCES.length - 1}" step="1"></label>
          <label><span>Answer length <output data-output="outputLength"></output></span><input aria-label="Answer length" data-control="outputLength" type="range" min="0" max="${ANSWER_LENGTHS.length - 1}" step="1"></label>
        </details>
        <details class="playground-group"><summary>Model and guessing ahead</summary>
          <label><span>Model</span><select aria-label="Model" data-control="modelId">${MODEL_PROFILES.map((model) => `<option value="${model.id}">${model.name.split(' · ')[0]}</option>`).join('')}</select></label>
          <label><span>Guess tokens ahead</span><select aria-label="Guess tokens ahead" data-control="speculativeTokens"><option value="0">Off</option><option value="2">2 tokens ahead</option><option value="4">4 tokens ahead</option></select></label>
        </details>
        <details class="playground-group"><summary>Precision and reuse</summary>
          <label><span>Weight precision</span><select aria-label="Weight precision" data-control="weightBits"><option value="16">16-bit</option><option value="8">8-bit</option><option value="4">4-bit</option></select></label>
          <label><span>Math precision</span><select aria-label="Math precision" data-control="mathBits"><option value="16">16-bit</option><option value="8">8-bit (needs 8- or 4-bit weights)</option></select></label>
          <label><span>KV cache precision</span><select aria-label="KV cache precision" data-control="kvBits"><option value="16">16-bit</option><option value="8">8-bit</option></select></label>
          <label class="playground-check"><input data-control="reusePromptPrefixes" type="checkbox"><span>Reuse a shared prompt</span></label>
          <label><span>Share already processed <output data-output="prefixCachePercent"></output></span><input aria-label="Share of the prompt already processed" data-control="prefixCachePercent" type="range" min="0" max="${PREFIX_CACHE_PERCENTAGES.length - 1}" step="1"></label>
        </details>
        <details class="playground-group"><summary>Where the KV cache lives</summary>
          <label><span>Active KV lives in</span><select aria-label="Active KV lives in" data-control="kvPlacement">${placementOptions()}</select></label>
        </details>
      </aside>
      <div class="playground-workbench" data-bench-view="cutaway">
        <div class="playground-top">
          <section class="playground-response" data-response aria-label="Response timing"></section>
          <div class="view-toggle playground-bench-toggle" role="group" aria-label="Workbench view"><button type="button" data-bench="cutaway" aria-pressed="true">Cutaway</button><button type="button" data-bench="numbers" aria-pressed="false">Numbers</button></div>
        </div>
        <section class="playground-cutaway" aria-label="Cutaway view">
          <div class="playground-plate-tabs" role="group" aria-label="Zoom level">${PLATE_TABS.map(([id, label]) => `<button type="button" data-plate="${id}" aria-pressed="${id === 'package'}">${label}</button>`).join('')}</div>
          <div class="playground-tile" data-tile-steps hidden></div>
          <div data-playground-cutaway></div>
          <p class="panel-caption" data-tile-text hidden></p>
          ${CUTAWAY_LEGEND}
        </section>
        <div data-playground-picture></div>
      </div>
    </div>`;

  const controls = new Map<ControlKey, HTMLInputElement | HTMLSelectElement>();
  for (const key of ['batch', 'sequenceLength', 'outputLength', 'modelId', 'speculativeTokens', 'weightBits', 'mathBits', 'kvBits', 'reusePromptPrefixes', 'prefixCachePercent', 'kvPlacement'] as ControlKey[]) {
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
    (controls.get('modelId') as HTMLSelectElement).value = settings.modelId;
    (controls.get('speculativeTokens') as HTMLSelectElement).value = String(settings.speculativeTokens);
    (controls.get('mathBits') as HTMLSelectElement).value = String(settings.mathBits);
    root.querySelector<HTMLOutputElement>('[data-output="batch"]')!.value = settings.batch.toLocaleString();
    root.querySelector<HTMLOutputElement>('[data-output="sequenceLength"]')!.value = `${settings.sequenceLength.toLocaleString()} tokens`;
    (controls.get('outputLength') as HTMLInputElement).value = String(nearestIndex(ANSWER_LENGTHS, settings.outputLength));
    root.querySelector<HTMLOutputElement>('[data-output="outputLength"]')!.value = `${settings.outputLength.toLocaleString()} tokens`;
    root.querySelector<HTMLOutputElement>('[data-output="prefixCachePercent"]')!.value = settings.reusePromptPrefixes ? `${settings.prefixCachePercent}%` : 'off';

    controls.get('prefixCachePercent')!.disabled = !settings.reusePromptPrefixes;
    controls.get('mathBits')!.disabled = settings.weightBits === 16;
  }

  function render(): void {
    const hardware = getHardware(settings.hardwareId);
    const model = modelFor(settings);
    const result = calculateSimulation(settings, hardware, model);
    const picture = buildPictureModel(result, settings, hardware, model);
    renderPicture(root.querySelector<HTMLElement>('[data-playground-picture]')!, picture, new Set(['stepCost', 'throughput', 'distanceLadder']));
    renderResponse(hardware, model);
    renderCutaway();
  }

  function renderResponse(hardware: ReturnType<typeof getHardware>, model: ReturnType<typeof modelFor>): void {
    const timing = responseTiming(settings, hardware, model);
    const node = root.querySelector<HTMLElement>('[data-response]')!;
    const metric = (label: string, value: string, note: string) => `<p><span>${label}</span><strong>${value}</strong><small>${note}</small></p>`;
    node.innerHTML = `<h3>One answer of ${settings.outputLength.toLocaleString()} tokens</h3><div>${[
      metric('First token', formatDuration(timing.firstTokenMs), 'the first pass, over the whole prompt'),
      metric('Each token after', formatDuration(timing.msPerToken), 'one later pass, at the answer’s middle'),
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

  root.querySelector<HTMLElement>('.playground-bench-toggle')!.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-bench]');
    if (!button) return;
    root.querySelector<HTMLElement>('.playground-workbench')!.dataset.benchView = button.dataset.bench;
    for (const toggle of button.parentElement!.querySelectorAll<HTMLButtonElement>('[data-bench]')) toggle.setAttribute('aria-pressed', String(toggle === button));
    if (button.dataset.bench === 'cutaway') cutaway?.refresh();
  });

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

  return {
    refresh(): void {
      cutaway?.refresh();
    },
    setHardware(hardwareId: string): void {
      settings.hardwareId = hardwareId;
      syncControls();
      render();
    },
  };
}
