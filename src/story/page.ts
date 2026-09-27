import './story.css';
import { DEFAULT_MODEL, DEFAULT_SETTINGS, getHardware } from '../data/profiles';
import { calculateSimulation, formatBytes, formatDuration, formatNumber } from '../model/calculate';
import { applySoftwareStrategy, precisionLabel } from '../model/strategy';
import { batchFromSlider, batchToSlider, sequenceFromSlider, sequenceToSlider } from '../state';
import type { KvPlacement, SimulationSettings } from '../types';
import { STORY_PANELS, type StoryPanelSpec } from './panels';
import { buildPictureModel, type PictureModel } from './picture/model';
import { renderPicture } from './picture/render';
import { mountPlayground } from './playground';

const root = document.querySelector<HTMLElement>('#route-root');
if (!root) throw new Error('Missing #route-root');

const panelSettings = new Map<string, SimulationSettings>();

function defaultsFor(panelId: string): SimulationSettings {
  const base = { ...DEFAULT_SETTINGS, phase: 'decode' as const, kvPlacement: 'hbm' as const };
  if (panelId === 'memory-wall' || panelId === 'distance') return { ...base, batch: 64, sequenceLength: 4096 };
  return base;
}

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
  return `<label class="story-knob" for="knob-${panel.id}"><span>${panel.knobLabel}</span><select id="knob-${panel.id}" data-knob="kvPlacement"><option value="hbm">GPU memory</option><option value="host">System memory</option><option value="peer">Another GPU</option><option value="ssd">Local solid-state storage</option><option value="object">Network object storage</option></select><small>The model prices this read on every generated token.</small></label>`;
}

function surprise(panel: StoryPanelSpec, picture: PictureModel, settings: SimulationSettings): string {
  const prefill = picture.steps[0]!;
  const decode = picture.steps[1]!;
  if (panel.id === 'two-jobs') {
    const promptPerToken = prefill.totalMs / settings.sequenceLength;
    return `One generated token costs about ${formatNumber(decode.totalMs / Math.max(promptPerToken, Number.EPSILON))}× as much time as one prompt token here. The jobs look similar in code but behave differently on the machine.`;
  }
  if (panel.id === 'read-model') return `${precisionLabel(settings.weightBits)} stores this model in ${formatBytes(picture.modelBytes)}. Reading it takes ${formatDuration(decode.readMs)}; the math takes ${formatDuration(decode.mathMs)}.`;
  if (panel.id === 'share-read') {
    const audience = settings.batch === 1 ? 'user receives' : 'users receive';
    return `${settings.batch.toLocaleString()} ${audience} ${formatNumber(picture.totalTokensPerSecond)} tokens each second in total while each user advances at ${formatNumber(picture.perUserTokensPerSecond)} tokens/s.`;
  }
  if (panel.id === 'memory-wall') return picture.overflowBytes > 0
    ? `The model plus KV exceed the serving budget by ${formatBytes(picture.overflowBytes)}. The red overflow must cross the slower system-memory link.`
    : `KV is ${formatNumber(picture.kvBytes / picture.modelBytes)}× the model’s size at this setting. Increase context to find the capacity wall.`;
  return `${formatBytes(picture.kvBytes)} of KV needs about ${formatNumber(picture.bandwidthNeeded / 1e12)} TB/s to avoid slowing the original step. At this tier, the modeled step takes ${formatDuration(decode.totalMs)}.`;
}

function panelMarkup(panel: StoryPanelSpec): string {
  const settings = defaultsFor(panel.id);
  panelSettings.set(panel.id, settings);
  return `<section class="concept-panel" id="${panel.id}" data-panel="${panel.id}" aria-labelledby="title-${panel.id}">
    <div class="panel-narrative">
      <span class="panel-number">${panel.number}</span>
      <p class="panel-kicker">Concept ${Number(panel.number) + 1} of 5</p>
      <h2 id="title-${panel.id}">${panel.title}</h2>
      <p class="panel-claim">${panel.claim}</p>
      ${knobMarkup(panel, settings)}
      <div class="panel-surprise"><span>The surprise</span><p data-surprise></p></div>
    </div>
    <div class="panel-instrument"><div data-picture></div><div class="panel-moves"><span>The moves</span><ul>${panel.moves.map((move) => `<li><b>${move.title}</b><p>${move.explanation}</p><small data-modeled="${move.modeled}">${move.modeled ? 'modeled here' : 'not modeled'}</small></li>`).join('')}</ul></div></div>
  </section>`;
}

root.innerHTML = `<div class="story-page">
  <header class="story-hero">
    <div><p>Inference performance, from first principles</p><h1>Before the jargon,<br><em>follow the cost.</em></h1></div>
    <div class="story-hero-copy"><p>A GPU does not run “an AI model” as one mysterious act. It moves bytes, schedules work, and repeats a small number of expensive operations. Five knobs are enough to see why the bottleneck moves.</p><nav aria-label="Story concepts">${STORY_PANELS.map((panel) => `<a href="#${panel.id}"><span>${panel.number}</span>${panel.title}</a>`).join('')}</nav></div>
  </header>
  ${STORY_PANELS.map(panelMarkup).join('')}
  <section class="story-next"><span>Now use the whole instrument</span><h2>Prove the mental model under pressure.</h2><p>The playground combines every knob and gives you three constraints to beat. Or inspect the hardware path inside one step.</p><div><a href="#playground">Open the playground ↓</a><a href="#/under-the-hood">Go under the hood →</a><a href="#/lookup">Find the names →</a></div></section>
  <section id="playground" class="playground"></section>
</div>`;

function renderPanel(panel: StoryPanelSpec): void {
  const section = root!.querySelector<HTMLElement>(`[data-panel="${panel.id}"]`)!;
  const settings = panelSettings.get(panel.id)!;
  const hardware = getHardware(settings.hardwareId);
  const model = applySoftwareStrategy(DEFAULT_MODEL, settings);
  const result = calculateSimulation(settings, hardware, model);
  const picture = buildPictureModel(result, settings, hardware, model);
  renderPicture(section.querySelector<HTMLElement>('[data-picture]')!, picture, new Set(panel.layers));
  section.querySelector<HTMLElement>('[data-surprise]')!.textContent = surprise(panel, picture, settings);
  const output = section.querySelector<HTMLOutputElement>('.story-knob output');
  if (output) output.value = panel.id === 'share-read' ? settings.batch.toLocaleString() : `${settings.sequenceLength.toLocaleString()} tokens`;
}

for (const panel of STORY_PANELS) {
  const section = root.querySelector<HTMLElement>(`[data-panel="${panel.id}"]`)!;
  const control = section.querySelector<HTMLInputElement | HTMLSelectElement>('[data-knob]')!;
  const settings = panelSettings.get(panel.id)!;
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
