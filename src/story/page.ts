import './story.css';
import { DEFAULT_MODEL, DEFAULT_SETTINGS, getHardware } from '../data/profiles';
import { calculateSimulation, formatBytes, formatDuration, formatNumber, restoreVsRecompute } from '../model/calculate';
import { applySoftwareStrategy, precisionLabel } from '../model/strategy';
import { batchFromSlider, batchToSlider, sequenceFromSlider, sequenceToSlider } from '../state';
import type { KvPlacement, SimulationSettings } from '../types';
import { buildCutawayInputs, type CutawayInputs } from './cutaway/inputs';
import { diePlate, formatBandwidth, packagePlate, serverPlate, type Plate } from './cutaway/plates';
import { mountCutaway, type CutawayView } from './cutaway/render';
import { STORY_PANELS, type StoryPanelSpec } from './panels';
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
  const base = { ...DEFAULT_SETTINGS, phase: 'decode' as const, kvPlacement: 'hbm' as const };
  if (panelId === 'memory-wall' || panelId === 'distance') return { ...base, batch: 64, sequenceLength: 4096 };
  return base;
}

const LEGEND = `<ul class="cw-legend" aria-label="What each label rests on"><li><i class="cw-basis-published"></i>published figure</li><li><i class="cw-basis-representative"></i>representative figure</li><li><i class="cw-basis-schematic"></i>schematic placement</li></ul>`;

const ZOOM: Record<StoryPanelSpec['plate'], string> = {
  'die-pair': 'Inside the GPU die, twice',
  package: 'The GPU package, exploded',
  die: 'Inside the GPU die',
  server: 'The whole server',
};

function knobMarkup(panel: StoryPanelSpec, settings: SimulationSettings): string {
  if (panel.id === 'two-jobs' || panel.id === 'memory-wall') {
    return `<label class="story-knob" for="knob-${panel.id}"><span>${panel.knobLabel}</span><output>${settings.sequenceLength.toLocaleString()} tokens</output><input id="knob-${panel.id}" data-knob="sequenceLength" type="range" min="0" max="8" step="1" value="${sequenceToSlider(settings.sequenceLength)}"><small><b>128</b><b>32K</b></small></label>`;
  }
  if (panel.id === 'read-model') {
    return `<label class="story-knob" for="knob-${panel.id}"><span>${panel.knobLabel}</span><select id="knob-${panel.id}" data-knob="weightBits"><option value="16">16-bit</option><option value="8">8-bit</option><option value="4">4-bit</option></select><small>Fewer bits mean fewer bytes per weight.</small></label>`;
  }
  if (panel.id === 'share-read') {
    return `<label class="story-knob" for="knob-${panel.id}"><span>${panel.knobLabel}</span><output>${settings.batch.toLocaleString()}</output><input id="knob-${panel.id}" data-knob="batch" type="range" min="0" max="10" step="1" value="${batchToSlider(settings.batch)}"><small><b>1</b><b>1,024</b></small></label>`;
  }
  return `<label class="story-knob" for="knob-${panel.id}"><span>${panel.knobLabel}</span><select id="knob-${panel.id}" data-knob="kvPlacement"><option value="hbm">GPU memory</option><option value="peer">Another GPU</option><option value="host">System memory</option><option value="ssd">Local solid-state storage</option><option value="object">Network object storage</option></select><small>The model prices this read on every generated token.</small></label>`;
}

function surprise(panel: StoryPanelSpec, picture: PictureModel, inputs: CutawayInputs, settings: SimulationSettings): string {
  const prefill = picture.steps[0]!;
  const decode = picture.steps[1]!;
  if (panel.id === 'two-jobs') {
    const promptPerToken = prefill.totalMs / settings.sequenceLength;
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
  const hbm = calculateSimulation({ ...settings, kvPlacement: 'hbm' }, getHardware(settings.hardwareId), applySoftwareStrategy(DEFAULT_MODEL, settings));
  if (settings.kvPlacement === 'hbm') return `Every token re-reads ${formatBytes(picture.kvBytes)} of KV. Keeping each step at ${formatDuration(hbm.totalMs)} needs about ${formatNumber(picture.bandwidthNeeded / 1e12)} TB/s for the KV alone. Now move it.`;
  return `Each token now takes ${formatDuration(decode.totalMs)} instead of ${formatDuration(hbm.totalMs)}: ${formatNumber(decode.totalMs / hbm.totalMs)}× slower, because every step re-reads all ${formatBytes(picture.kvBytes)} from ${inputs.tiers[settings.kvPlacement].label.toLowerCase()}.`;
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
    return m.overflowBytes > 0
      ? `${formatBytes(m.weightBytes)} of weights + ${formatBytes(m.kvBytes)} of KV = <b>${formatBytes(total)}</b>. <strong class="cw-warn">Only ${formatBytes(m.usableBytes)} is usable: ${formatBytes(m.overflowBytes)} doesn’t fit.</strong>`
      : `${formatBytes(m.weightBytes)} of weights + ${formatBytes(m.kvBytes)} of KV = <b>${formatBytes(total)}</b> of ${formatBytes(m.usableBytes)} usable.`;
  }
  if (panel.id === 'distance') {
    const tier = inputs.tiers[settings.kvPlacement];
    const restore = restoreVsRecompute(settings, getHardware(settings.hardwareId), applySoftwareStrategy(DEFAULT_MODEL, settings), settings.kvPlacement);
    const where = settings.kvPlacement === 'hbm' ? 'GPU memory' : tier.label.toLowerCase();
    return `KV in <b>${where}</b> (${formatBandwidth(tier.bandwidthBytesPerSecond!)}): one decode step takes <b>${formatDuration(inputs.decode.totalMs)}</b>. Parking one idle conversation there: restore <b>${formatDuration(restore.restoreMs)}</b> vs. rebuild from the prompt <b>${formatDuration(restore.recomputeMs)}</b>.`;
  }
  return '';
}

function jobCaption(inputs: CutawayInputs, job: 'prefill' | 'decode', settings: SimulationSettings): string {
  const a = inputs[job];
  const title = job === 'prefill' ? `Reading the prompt · ${settings.sequenceLength.toLocaleString()} tokens at once` : 'Writing one token';
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

function panelMarkup(panel: StoryPanelSpec): string {
  const settings = defaultsFor(panel.id);
  panelState.set(panel.id, { settings, views: new Map() });
  const stage = panel.plate === 'die-pair'
    ? `<div class="panel-pair"><figure class="panel-figure"><figcaption data-job-caption="prefill"></figcaption><div data-cutaway="prefill"></div></figure><figure class="panel-figure"><figcaption data-job-caption="decode"></figcaption><div data-cutaway="decode"></div></figure></div>`
    : `<div data-cutaway="main"></div><p class="panel-caption" data-caption></p>`;
  return `<section class="concept-panel" id="${panel.id}" data-panel="${panel.id}" aria-labelledby="title-${panel.id}">
    <div class="panel-narrative">
      <span class="panel-number">${panel.number}</span>
      <p class="panel-kicker">Concept ${Number(panel.number) + 1} of 5</p>
      <h2 id="title-${panel.id}">${panel.title}</h2>
      <p class="panel-claim">${panel.claim}</p>
      ${knobMarkup(panel, settings)}
      <div class="panel-surprise"><span>The surprise</span><p data-surprise></p></div>
    </div>
    <div class="panel-instrument">
      <div class="panel-stage">
        <p class="panel-zoom"><span>Zoom</span>${ZOOM[panel.plate]} · ${getHardware(settings.hardwareId).name}</p>
        ${stage}
        ${panel.numbers.length ? '<div class="panel-numbers" data-numbers></div>' : ''}
        ${LEGEND}
        <p class="panel-hint">Click any part or label to pair them.</p>
      </div>
      <div class="panel-moves"><span>The moves</span><ul>${panel.moves.map((move) => `<li><b>${move.title}</b><p>${move.explanation}</p><small data-modeled="${move.modeled}">${move.modeled ? 'modeled here' : 'not modeled'}</small></li>`).join('')}</ul></div>
    </div>
  </section>`;
}

root.innerHTML = `<div class="story-page">
  <header class="story-hero">
    <div><p>Inference performance, from first principles</p><h1>Before the jargon,<br><em>follow the cost.</em></h1></div>
    <div class="story-hero-copy"><p>A GPU does not run “an AI model” as one mysterious act. It moves bytes, schedules work, and repeats a small number of expensive operations. Five knobs, and a look inside the chip, are enough to see why the bottleneck moves.</p><nav aria-label="Story concepts">${STORY_PANELS.map((panel) => `<a href="#${panel.id}"><span>${panel.number}</span>${panel.title}</a>`).join('')}</nav></div>
  </header>
  ${STORY_PANELS.map(panelMarkup).join('')}
  <section class="story-next"><span>Now use the whole instrument</span><h2>Prove the mental model under pressure.</h2><p>The playground combines every knob, lets you zoom from the server down to one compute unit on either chip, and gives you three constraints to beat.</p><div><a href="#playground">Open the playground ↓</a><a href="#/under-the-hood">Go under the hood →</a><a href="#/lookup">Find the names →</a></div></section>
  <section id="playground" class="playground"></section>
</div>`;

function renderPanel(panel: StoryPanelSpec): void {
  const section = root!.querySelector<HTMLElement>(`[data-panel="${panel.id}"]`)!;
  const state = panelState.get(panel.id)!;
  const { settings } = state;
  const hardware = getHardware(settings.hardwareId);
  const model = applySoftwareStrategy(DEFAULT_MODEL, settings);
  const result = calculateSimulation(settings, hardware, model);
  const picture = buildPictureModel(result, settings, hardware, model);
  const inputs = buildCutawayInputs(settings, hardware, model);

  for (const [key, plate] of platesFor(panel, inputs)) {
    const existing = state.views.get(key);
    if (existing) existing.update(plate);
    else state.views.set(key, mountCutaway(section.querySelector<HTMLElement>(`[data-cutaway="${key}"]`)!, plate, `${panel.title}: ${ZOOM[panel.plate]}`, { labels: panel.plate === 'die-pair' ? 'chips' : 'auto' }));
  }
  for (const job of ['prefill', 'decode'] as const) {
    const node = section.querySelector<HTMLElement>(`[data-job-caption="${job}"]`);
    if (node) node.innerHTML = jobCaption(inputs, job, settings);
  }
  const captionNode = section.querySelector<HTMLElement>('[data-caption]');
  if (captionNode) captionNode.innerHTML = caption(panel, inputs, settings);
  const numbers = section.querySelector<HTMLElement>('[data-numbers]');
  if (numbers) renderPicture(numbers, picture, new Set(panel.numbers), { footer: false });
  section.querySelector<HTMLElement>('[data-surprise]')!.textContent = surprise(panel, picture, inputs, settings);
  const output = section.querySelector<HTMLOutputElement>('.story-knob output');
  if (output) output.value = panel.id === 'share-read' ? settings.batch.toLocaleString() : `${settings.sequenceLength.toLocaleString()} tokens`;
}

for (const panel of STORY_PANELS) {
  const section = root.querySelector<HTMLElement>(`[data-panel="${panel.id}"]`)!;
  const control = section.querySelector<HTMLInputElement | HTMLSelectElement>('[data-knob]')!;
  const { settings } = panelState.get(panel.id)!;
  if (control instanceof HTMLSelectElement) control.value = panel.id === 'read-model' ? String(settings.weightBits) : settings.kvPlacement;
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
