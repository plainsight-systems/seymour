import { DEFAULT_MODEL, DEFAULT_SETTINGS, HARDWARE_PROFILES, getHardware } from '../data/profiles';
import { calculateSimulation, formatDuration, formatNumber } from '../model/calculate';
import { applySoftwareStrategy } from '../model/strategy';
import { batchFromSlider, batchToSlider, prefixCacheFromSlider, prefixCacheToSlider, sequenceFromSlider, sequenceToSlider } from '../state';
import type { KvPlacement, SimulationSettings } from '../types';
import { CHALLENGES, getChallenge } from './challenges/data';
import { evaluateChallenge, type Challenge, type ConstraintMetric, type KnobId } from './challenges/engine';
import { buildPictureModel } from './picture/model';
import { renderPicture } from './picture/render';

type ControlKey = KnobId | 'hardwareId';

export function mountPlayground(root: HTMLElement): void {
  let settings: SimulationSettings = { ...getChallenge('chatbot').naive };
  let selectedChallenge: Challenge | null = getChallenge('chatbot');

  root.innerHTML = `<header class="playground-heading"><div><span>Playground</span><h2>Make the bottleneck move.</h2></div><p>Every control changes the analytical model. Choose free play or accept a challenge with fixed workload constraints.</p></header>
    <div class="playground-shell">
      <aside class="playground-controls">
        <label><span>Mode</span><select data-control="challenge"><option value="free">Free play</option>${CHALLENGES.map((challenge) => `<option value="${challenge.id}">${challenge.title}</option>`).join('')}</select></label>
        <fieldset><legend>Workload</legend>
          <label><span>Concurrent users <output data-output="batch"></output></span><input data-control="batch" type="range" min="0" max="10" step="1"></label>
          <label><span>Context length <output data-output="sequenceLength"></output></span><input data-control="sequenceLength" type="range" min="0" max="8" step="1"></label>
        </fieldset>
        <fieldset><legend>Bytes</legend>
          <label><span>Model precision</span><select data-control="weightBits"><option value="16">16-bit</option><option value="8">8-bit</option><option value="4">4-bit</option></select></label>
          <label><span>KV precision</span><select data-control="kvBits"><option value="16">16-bit</option><option value="8">8-bit</option></select></label>
          <label class="playground-check"><input data-control="reusePromptPrefixes" type="checkbox"><span>Reuse a shared prompt prefix</span></label>
          <label><span>Prefix already available <output data-output="prefixCachePercent"></output></span><input data-control="prefixCachePercent" type="range" min="0" max="5" step="1"></label>
        </fieldset>
        <fieldset><legend>Placement + target</legend>
          <label><span>Active KV location</span><select data-control="kvPlacement"><option value="hbm">GPU memory</option><option value="host">System memory</option><option value="peer">Another GPU</option><option value="ssd">Local solid-state storage</option><option value="object">Network object storage</option></select></label>
          <label><span>Accelerator</span><select data-control="hardwareId">${HARDWARE_PROFILES.map((hardware) => `<option value="${hardware.id}">${hardware.name}</option>`).join('')}</select></label>
        </fieldset>
      </aside>
      <div class="playground-workbench"><div data-playground-picture></div><div class="playground-readout"><span data-readout-tag></span><p data-readout-copy></p></div><section class="challenge-board" data-challenge-board></section></div>
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
    renderPicture(root.querySelector<HTMLElement>('[data-playground-picture]')!, picture, new Set(['stepCost', 'modelBlock', 'throughput', 'kvBlock', 'distanceLadder']));
    root.querySelector<HTMLElement>('[data-readout-tag]')!.textContent = picture.bottleneckTag;
    root.querySelector<HTMLElement>('[data-readout-copy]')!.textContent = picture.bottleneckSentence;
    renderChallenge();
  }

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
