import './story.css';
import { DEFAULT_SETTINGS, HARDWARE_PROFILES, getHardware } from '../data/profiles';
import { getTopology } from '../data/topology';
import { calculateSimulation, formatBytes, formatDuration, formatNumber, restoreVsRecompute } from '../model/calculate';
import { modelFor, precisionLabel } from '../model/strategy';
import { batchFromSlider, batchToSlider, sequenceFromSlider, sequenceToSlider } from '../state';
import type { KvPlacement, SimulationSettings } from '../types';
import { buildCutawayInputs, type CutawayInputs } from './cutaway/inputs';
import { diePlate, formatBandwidth, packagePlate, serverPlate, type Plate } from './cutaway/plates';
import { mountCutaway, type CutawayView } from './cutaway/render';
import { STORY_PANELS, type MoveEffect, type StoryMove, type StoryPanelSpec } from './panels';
import { buildPictureModel, type PictureModel } from './picture/model';
import { renderPicture } from './picture/render';
import { mountPlayground } from './playground';

const root = document.querySelector<HTMLElement>('#route-root');
if (!root) throw new Error('Missing #route-root');

interface PanelState {
  settings: SimulationSettings;
  views: Map<string, CutawayView>;
}

const panelState = new Map<string, PanelState>();

function defaultsFor(panelId: string): SimulationSettings {
  // Moves start switched off so each one visibly changes the plate when applied.
  const base = { ...DEFAULT_SETTINGS, phase: 'decode' as const, kvPlacement: 'hbm' as const, kvBits: 16 as const, reusePromptPrefixes: false, prefixCachePercent: 0 };
  if (panelId === 'memory-wall' || panelId === 'distance') return { ...base, batch: 64, sequenceLength: 4096 };
  if (panelId === 'heavier-tokens') return { ...base, modelId: 'qwen3-30b-a3b', batch: 1, sequenceLength: 2048 };
  return base;
}

const LEGEND = `<ul class="cw-legend" aria-label="What each label rests on"><li><i class="cw-basis-published"></i>published figure</li><li><i class="cw-basis-representative"></i>representative figure</li><li><i class="cw-basis-schematic"></i>schematic placement</li></ul>`;

function zoomLabel(plate: StoryPanelSpec['plate'], hardwareId: string): string {
  const chiplets = getTopology(hardwareId).computeDies > 1;
  if (plate === 'die-pair') return chiplets ? 'One of eight compute dies, twice' : 'Inside the GPU die, twice';
  if (plate === 'die') return chiplets ? 'One of eight compute dies' : 'Inside the GPU die';
  if (plate === 'package') return 'The GPU package, exploded';
  return 'The whole server';
}

/** The accelerator shown by every story panel; switching it on any panel switches all. */
let storyHardwareId = DEFAULT_SETTINGS.hardwareId as string;

function chipToggle(): string {
  return `<span class="panel-chip" role="group" aria-label="Accelerator">${HARDWARE_PROFILES.map((hardware) => `<button type="button" data-chip="${hardware.id}" aria-pressed="${hardware.id === storyHardwareId}">${hardware.vendor} ${hardware.name}</button>`).join('')}</span>`;
}

const PLACEMENT_PHRASE: Record<KvPlacement, string> = {
  hbm: 'GPU memory', peer: 'one other GPU', peers: 'all seven other GPUs', host: 'system memory', ssd: 'local SSD', object: 'network object storage',
};

const EFFICIENCY_NOTE = 'Both accelerators use the same efficiency assumptions—55% of peak math and 72% of peak memory bandwidth—so comparisons reflect published peaks, not measured results on either vendor.';

function knobMarkup(panel: StoryPanelSpec, settings: SimulationSettings): string {
  if (panel.id === 'two-jobs' || panel.id === 'memory-wall') {
    return `<label class="story-knob" for="knob-${panel.id}"><span>${panel.knobLabel}</span><output>${settings.sequenceLength.toLocaleString()} tokens</output><input id="knob-${panel.id}" data-knob="sequenceLength" type="range" min="0" max="8" step="1" value="${sequenceToSlider(settings.sequenceLength)}"><small><b>128</b><b>32K</b></small></label>`;
  }
  if (panel.id === 'read-model') {
    return `<label class="story-knob" for="knob-${panel.id}"><span>${panel.knobLabel}</span><select id="knob-${panel.id}" data-knob="weightBits"><option value="16">16-bit</option><option value="8">8-bit</option><option value="4">4-bit</option></select><small>Fewer bits mean fewer bytes per weight.</small></label>`;
  }
  if (panel.id === 'share-read' || panel.id === 'heavier-tokens') {
    return `<label class="story-knob" for="knob-${panel.id}"><span>${panel.knobLabel}</span><output>${settings.batch.toLocaleString()}</output><input id="knob-${panel.id}" data-knob="batch" type="range" min="0" max="10" step="1" value="${batchToSlider(settings.batch)}"><small><b>1</b><b>1,024</b></small></label>`;
  }
  return `<label class="story-knob" for="knob-${panel.id}"><span>${panel.knobLabel}</span><select id="knob-${panel.id}" data-knob="kvPlacement"><option value="hbm">GPU memory</option><option value="peer">One other GPU</option><option value="peers">Spread across all seven other GPUs</option><option value="host">System memory</option><option value="ssd">Local solid-state storage</option><option value="object">Network object storage</option></select><small>The model prices this read on every generated token.</small></label>`;
}

function surprise(panel: StoryPanelSpec, picture: PictureModel, inputs: CutawayInputs, settings: SimulationSettings): string {
  const prefill = picture.steps[0]!;
  const decode = picture.steps[1]!;
  if (panel.id === 'two-jobs') {
    const reused = settings.reusePromptPrefixes ? Math.round(settings.sequenceLength * settings.prefixCachePercent / 100) : 0;
    const promptPerToken = prefill.totalMs / Math.max(1, settings.sequenceLength - reused);
    return `One generated token costs about ${formatNumber(decode.totalMs / Math.max(promptPerToken, Number.EPSILON))}× as much time as one prompt token here. The same chip is busy in one job and idle in the other.`;
  }
  if (panel.id === 'read-model') {
    return `The compute units spend ${formatNumber((1 - inputs.decode.mathShare) * 100)}% of each token step waiting for bytes. At ${precisionLabel(settings.weightBits)}, the model is ${formatBytes(picture.modelBytes)}; fewer bits per weight means less to wait for.`;
  }
  if (panel.id === 'share-read') {
    const audience = settings.batch === 1 ? 'user receives' : 'users receive';
    return `${settings.batch.toLocaleString()} ${audience} ${formatNumber(picture.totalTokensPerSecond)} tokens each second in total, while each user still advances at ${formatNumber(picture.perUserTokensPerSecond)} tokens/s.`;
  }
  if (panel.id === 'memory-wall') {
    return picture.overflowBytes > 0
      ? `The model plus KV exceed the serving budget by ${formatBytes(picture.overflowBytes)}. That overflow has to live off the package, behind a far slower link.`
      : `The KV cache is ${formatNumber(picture.kvBytes / picture.modelBytes)}× the model’s size at this setting. Push the context longer to find the wall.`;
  }
  if (panel.id === 'heavier-tokens') {
    const read = inputs.memory.weightBytes * inputs.weightsReadFraction;
    const experts = Math.round(inputs.expertsTouchedFraction * 100);
    const who = `${settings.batch.toLocaleString()} ${settings.batch === 1 ? 'user' : 'users'}`;
    const discount = inputs.expertsTouchedFraction > 0.95
      ? 'With this many users nearly every expert is touched, so each step reads almost the whole model: the experts discount is gone, and sharing the read is what pays.'
      : 'Add users and watch the discount shrink as more experts are touched.';
    let spec = '';
    if (settings.speculativeTokens > 0) {
      const off = buildCutawayInputs({ ...settings, speculativeTokens: 0 }, getHardware(settings.hardwareId), modelFor(settings));
      const moreRead = inputs.weightsReadFraction / off.weightsReadFraction;
      spec = moreRead > 1.2
        ? ` Speculation keeps ${formatNumber(inputs.tokensPerStep)} tokens per step, but checking ${settings.speculativeTokens + 1} tokens touches ${Math.round(inputs.expertsTouchedFraction * 100)}% of the experts instead of ${Math.round(off.expertsTouchedFraction * 100)}%, so each step reads ${formatNumber(moreRead)}× more. Per-token time goes from ${formatDuration(off.msPerToken)} to ${formatDuration(inputs.msPerToken)}: on a dense model the same trick pays far more.`
        : ` Speculation keeps ${formatNumber(inputs.tokensPerStep)} tokens per step for nearly the same read, so per-token time goes from ${formatDuration(off.msPerToken)} to ${formatDuration(inputs.msPerToken)}.`;
    }
    return `With ${who}, each step reads ${formatBytes(read)} of the model’s ${formatBytes(inputs.memory.weightBytes)}: ${experts}% of the experts. ${discount}${spec}`;
  }
  const hbm = calculateSimulation({ ...settings, kvPlacement: 'hbm' }, getHardware(settings.hardwareId), modelFor(settings));
  if (settings.kvPlacement === 'hbm') return `Every token re-reads ${formatBytes(picture.kvBytes)} of KV. Keeping each step at ${formatDuration(hbm.totalMs)} needs about ${formatNumber(picture.bandwidthNeeded / 1e12)} TB/s for the KV alone. Now move it.`;
  return `Each token now takes ${formatDuration(decode.totalMs)} instead of ${formatDuration(hbm.totalMs)}: ${formatNumber(decode.totalMs / hbm.totalMs)}× slower, because every step re-reads all ${formatBytes(picture.kvBytes)} from ${PLACEMENT_PHRASE[settings.kvPlacement]}.`;
}

function caption(panel: StoryPanelSpec, inputs: CutawayInputs, settings: SimulationSettings): string {
  const m = inputs.memory;
  if (panel.id === 'read-model') {
    return `Each generated token reads <b>${formatBytes(m.weightBytes + m.kvBytes)}</b> from these stacks: reading takes <b>${formatDuration(inputs.decode.memoryMs)}</b>, the math takes <b>${formatDuration(inputs.decode.computeMs)}</b>.`;
  }
  if (panel.id === 'share-read') {
    return `${settings.batch.toLocaleString()} ${settings.batch === 1 ? 'user gets one read to itself' : 'users share one read'}: reading takes <b>${formatDuration(inputs.decode.memoryMs)}</b>, the math takes <b>${formatDuration(inputs.decode.computeMs)}</b>.`;
  }
  if (panel.id === 'memory-wall') {
    const total = m.weightBytes + m.kvBytes;
    const fill = m.overflowBytes > 0
      ? `${formatBytes(m.weightBytes)} of weights + ${formatBytes(m.kvBytes)} of ${settings.kvBits}-bit KV = <b>${formatBytes(total)}</b>. <strong class="cw-warn">Only ${formatBytes(m.usableBytes)} is usable: ${formatBytes(m.overflowBytes)} doesn’t fit and is read over PCIe every step.</strong>`
      : `${formatBytes(m.weightBytes)} of weights + ${formatBytes(m.kvBytes)} of ${settings.kvBits}-bit KV = <b>${formatBytes(total)}</b> of ${formatBytes(m.usableBytes)} usable.`;
    return `${fill} Each token: <b>${formatDuration(inputs.decode.totalMs)}</b>. Reading all ${settings.batch} prompts: <b>${formatDuration(inputs.prefill.totalMs)}</b>.`;
  }
  if (panel.id === 'heavier-tokens') {
    const read = m.weightBytes * inputs.weightsReadFraction;
    const spec = settings.speculativeTokens > 0 ? ` <b>${formatNumber(inputs.tokensPerStep)}</b> tokens per step per user.` : '';
    const overflow = m.overflowBytes > 0 ? ` <strong class="cw-warn">${formatBytes(m.overflowBytes)} doesn’t fit and is read over PCIe every step.</strong>` : '';
    return `Stored: <b>${formatBytes(m.weightBytes)}</b>. Read per step: <b>${formatBytes(read)}</b> (${Math.round(inputs.expertsTouchedFraction * 100)}% of experts, assuming uniform routing).${spec} Each token: <b>${formatDuration(inputs.msPerToken)}</b>.${overflow}`;
  }
  if (panel.id === 'distance') {
    const tier = inputs.tiers[settings.kvPlacement];
    const restore = restoreVsRecompute(settings, getHardware(settings.hardwareId), modelFor(settings), settings.kvPlacement);
    const where = PLACEMENT_PHRASE[settings.kvPlacement];
    return `KV in <b>${where}</b> (${formatBandwidth(tier.bandwidthBytesPerSecond!)}): one decode step takes <b>${formatDuration(inputs.decode.totalMs)}</b>. Parking one idle conversation there: restore <b>${formatDuration(restore.restoreMs)}</b> vs. rebuild from the prompt <b>${formatDuration(restore.recomputeMs)}</b>.`;
  }
  return '';
}

function jobCaption(inputs: CutawayInputs, job: 'prefill' | 'decode', settings: SimulationSettings): string {
  const a = inputs[job];
  const reused = settings.reusePromptPrefixes ? Math.round(settings.sequenceLength * settings.prefixCachePercent / 100) : 0;
  const title = job === 'prefill'
    ? reused > 0
      ? `Reading the prompt · ${(settings.sequenceLength - reused).toLocaleString()} new tokens (${reused.toLocaleString()} reused)`
      : `Reading the prompt · ${settings.sequenceLength.toLocaleString()} tokens at once`
    : 'Writing one token';
  const limit = a.computeMs >= a.memoryMs ? 'limited by math' : 'limited by reading memory';
  return `<b>${title}</b><span>${formatDuration(a.totalMs)} · math ${formatDuration(a.computeMs)} · reading ${formatDuration(a.memoryMs)} · ${limit}</span>`;
}

function platesFor(panel: StoryPanelSpec, inputs: CutawayInputs): Map<string, Plate> {
  if (panel.plate === 'die-pair') {
    return new Map([
      ['prefill', diePlate(inputs, { job: 'prefill', detail: 'minimal' })],
      ['decode', diePlate(inputs, { job: 'decode', detail: 'minimal' })],
    ]);
  }
  if (panel.plate === 'package') return new Map([['main', packagePlate(inputs)]]);
  if (panel.plate === 'die') return new Map([['main', diePlate(inputs, { job: 'decode', detail: 'full' })]]);
  return new Map([['main', serverPlate(inputs)]]);
}

function moveMarkup(move: StoryMove): string {
  const body = `<b>${move.title}</b><p>${move.explanation}</p>`;
  if (move.effect) return `<li><button type="button" class="move-toggle" data-move="${move.effect}" aria-pressed="false">${body}<small data-modeled="true"><span data-move-state>Try it: off</span></small></button></li>`;
  const tag = move.viaKnob ? 'the knob above' : move.modeled ? 'shown below the plate' : 'not modeled';
  return `<li>${body}<small data-modeled="${move.modeled}">${tag}</small></li>`;
}

/** Applies or removes a modeled move on a panel's settings. */
function applyMove(settings: SimulationSettings, effect: MoveEffect, on: boolean): void {
  if (effect === 'kv8') settings.kvBits = on ? 8 : 16;
  if (effect === 'speculate') settings.speculativeTokens = on ? 4 : 0;
  if (effect === 'prefixReuse') {
    settings.reusePromptPrefixes = on;
    settings.prefixCachePercent = on ? 75 : 0;
  }
}

function moveIsOn(settings: SimulationSettings, effect: MoveEffect): boolean {
  if (effect === 'kv8') return settings.kvBits === 8;
  if (effect === 'speculate') return settings.speculativeTokens > 0;
  return settings.reusePromptPrefixes && settings.prefixCachePercent > 0;
}

function panelMarkup(panel: StoryPanelSpec): string {
  const settings = defaultsFor(panel.id);
  panelState.set(panel.id, { settings, views: new Map() });
  const stage = panel.plate === 'die-pair'
    ? `<div class="panel-pair"><figure class="panel-figure"><figcaption data-job-caption="prefill"></figcaption><div data-cutaway="prefill"></div></figure><figure class="panel-figure"><figcaption data-job-caption="decode"></figcaption><div data-cutaway="decode"></div></figure></div>`
    : `<div data-cutaway="main"></div><p class="panel-caption" data-caption></p>`;
  return `<section class="concept-panel" id="${panel.id}" data-panel="${panel.id}" aria-labelledby="title-${panel.id}">
    <div class="panel-narrative">
      <span class="panel-number">${panel.number}</span>
      <p class="panel-kicker">Concept ${Number(panel.number) + 1} of ${STORY_PANELS.length}</p>
      <h2 id="title-${panel.id}">${panel.title}</h2>
      <p class="panel-claim">${panel.claim}</p>
      ${knobMarkup(panel, settings)}
      <div class="panel-surprise"><span>The surprise</span><p data-surprise></p></div>
    </div>
    <div class="panel-instrument">
      <div class="panel-stage">
        <div class="panel-zoom"><span>Zoom</span><b data-zoom>${zoomLabel(panel.plate, settings.hardwareId)}</b>${chipToggle()}</div>
        ${stage}
        ${panel.numbers.length ? '<div class="panel-numbers" data-numbers></div>' : ''}
        ${LEGEND}
        <p class="panel-hint">Click any part or label to pair them.</p>
      </div>
      <div class="panel-moves"><span>The moves</span><ul>${panel.moves.map(moveMarkup).join('')}</ul></div>
    </div>
  </section>`;
}

root.innerHTML = `<div class="story-page">
  <header class="story-hero">
    <div><p>Inference performance, from first principles</p><h1>Before the jargon,<br><em>follow the cost.</em></h1></div>
    <div class="story-hero-copy"><p>A GPU does not run “an AI model” as one mysterious act. It moves bytes, schedules work, and repeats a small number of expensive operations. Six knobs, and a look inside the chip, are enough to see why the bottleneck moves—on NVIDIA H100 or AMD MI300X; switch on any panel.</p><nav aria-label="Story concepts">${STORY_PANELS.map((panel) => `<a href="#${panel.id}"><span>${panel.number}</span>${panel.title}</a>`).join('')}</nav></div>
  </header>
  ${STORY_PANELS.map(panelMarkup).join('')}
  <section class="story-next"><span>Now use the whole instrument</span><h2>Prove the mental model under pressure.</h2><p>The playground combines every knob, lets you zoom from the server down to one compute unit on either chip, and gives you three constraints to beat.</p><p class="story-assumption">${EFFICIENCY_NOTE}</p><div><a href="#playground">Open the playground ↓</a><a href="#/under-the-hood">Go under the hood →</a><a href="#/lookup">Find the names →</a></div></section>
  <section id="playground" class="playground"></section>
</div>`;

function renderPanel(panel: StoryPanelSpec): void {
  const section = root!.querySelector<HTMLElement>(`[data-panel="${panel.id}"]`)!;
  const state = panelState.get(panel.id)!;
  const { settings } = state;
  const hardware = getHardware(settings.hardwareId);
  const model = modelFor(settings);
  const result = calculateSimulation(settings, hardware, model);
  const picture = buildPictureModel(result, settings, hardware, model);
  const inputs = buildCutawayInputs(settings, hardware, model);

  for (const [key, plate] of platesFor(panel, inputs)) {
    const existing = state.views.get(key);
    if (existing) existing.update(plate);
    else state.views.set(key, mountCutaway(section.querySelector<HTMLElement>(`[data-cutaway="${key}"]`)!, plate, `${panel.title}: ${zoomLabel(panel.plate, settings.hardwareId)}`, { labels: panel.plate === 'die-pair' ? 'chips' : 'auto' }));
  }
  section.querySelector<HTMLElement>('[data-zoom]')!.textContent = zoomLabel(panel.plate, settings.hardwareId);
  for (const button of section.querySelectorAll<HTMLButtonElement>('[data-chip]')) button.setAttribute('aria-pressed', String(button.dataset.chip === settings.hardwareId));
  for (const job of ['prefill', 'decode'] as const) {
    const node = section.querySelector<HTMLElement>(`[data-job-caption="${job}"]`);
    if (node) node.innerHTML = jobCaption(inputs, job, settings);
  }
  const captionNode = section.querySelector<HTMLElement>('[data-caption]');
  if (captionNode) captionNode.innerHTML = caption(panel, inputs, settings);
  const numbers = section.querySelector<HTMLElement>('[data-numbers]');
  if (numbers) renderPicture(numbers, picture, new Set(panel.numbers), { footer: false });
  section.querySelector<HTMLElement>('[data-surprise]')!.textContent = surprise(panel, picture, inputs, settings);
  for (const button of section.querySelectorAll<HTMLButtonElement>('[data-move]')) {
    const on = moveIsOn(settings, button.dataset.move as MoveEffect);
    button.setAttribute('aria-pressed', String(on));
    button.querySelector('[data-move-state]')!.textContent = on ? 'Applied · click to undo' : 'Try it: off';
  }
  const output = section.querySelector<HTMLOutputElement>('.story-knob output');
  if (output) output.value = panel.id === 'share-read' || panel.id === 'heavier-tokens' ? settings.batch.toLocaleString() : `${settings.sequenceLength.toLocaleString()} tokens`;
}

for (const panel of STORY_PANELS) {
  const section = root.querySelector<HTMLElement>(`[data-panel="${panel.id}"]`)!;
  const control = section.querySelector<HTMLInputElement | HTMLSelectElement>('[data-knob]')!;
  const { settings } = panelState.get(panel.id)!;
  if (control instanceof HTMLSelectElement) control.value = panel.id === 'read-model' ? String(settings.weightBits) : settings.kvPlacement;
  section.querySelector('.panel-moves')!.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-move]');
    if (!button) return;
    const effect = button.dataset.move as MoveEffect;
    applyMove(settings, effect, !moveIsOn(settings, effect));
    renderPanel(panel);
  });
  section.querySelector('.panel-chip')!.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-chip]');
    if (!button || button.dataset.chip === storyHardwareId) return;
    storyHardwareId = button.dataset.chip!;
    for (const other of STORY_PANELS) {
      panelState.get(other.id)!.settings.hardwareId = storyHardwareId;
      renderPanel(other);
    }
  });
  control.addEventListener('input', () => {
    if (control.dataset.knob === 'sequenceLength') settings.sequenceLength = sequenceFromSlider(Number(control.value));
    if (control.dataset.knob === 'batch') settings.batch = batchFromSlider(Number(control.value));
    if (control.dataset.knob === 'weightBits') settings.weightBits = Number(control.value) as SimulationSettings['weightBits'];
    if (control.dataset.knob === 'kvPlacement') settings.kvPlacement = control.value as KvPlacement;
    renderPanel(panel);
  });
  renderPanel(panel);
}

mountPlayground(root.querySelector<HTMLElement>('#playground')!);
