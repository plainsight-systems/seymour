import './story.css';
import { DEFAULT_SETTINGS, HARDWARE_PROFILES, getHardware } from '../data/profiles';
import { getTopology } from '../data/topology';
import { calculateSimulation, formatBytes, formatDuration, formatNumber, restoreVsRecompute } from '../model/calculate';
import { modelFor, precisionLabel } from '../model/strategy';
import { batchFromSlider, batchToSlider, sequenceFromSlider, sequenceToSlider } from '../state';
import type { KvPlacement, SimulationSettings } from '../types';
import { buildCutawayInputs, type CutawayInputs } from './cutaway/inputs';
import { diePlate, formatBandwidth, packagePlate, serverPlate, unitPlate, type Plate } from './cutaway/plates';
import { mountActs, type ActSpec } from './acts';
import { FORWARD_TOOLS, STAGE_ORDER, STAGE_TAB_LABEL, mountForwardScenes } from './forward/scenes';
import { partEntry, type Vendor } from '../data/parts';
import { assemblyPlate, assemblyRound, isComplete, place, zoneNumber, type AssemblyRound, type RoundId } from './challenge/assembly';
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
  return `<span class="panel-chip" role="group" aria-label="Accelerator">${HARDWARE_PROFILES.map((hardware) => `<button type="button" data-chip="${hardware.id}" aria-pressed="${hardware.id === storyHardwareId}" title="${hardware.vendor} ${hardware.name}">${hardware.name.replace(" SXM", "")}</button>`).join('')}</span>`;
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
    const solo = buildPictureModel(
      calculateSimulation({ ...settings, batch: 1 }, getHardware(settings.hardwareId), modelFor(settings)),
      { ...settings, batch: 1 }, getHardware(settings.hardwareId), modelFor(settings),
    );
    if (settings.batch === 1) return `One user gets the whole read to itself: ${formatNumber(picture.perUserTokensPerSecond)} tokens/s. Add users and watch both numbers below.`;
    const kvShare = picture.kvBytes / (picture.kvBytes + picture.modelBytes);
    return `${settings.batch.toLocaleString()} users get ${formatNumber(picture.totalTokensPerSecond)} tokens/s in total, ${formatNumber(picture.totalTokensPerSecond / solo.totalTokensPerSecond)}× what one user gets. But each user now advances at ${formatNumber(picture.perUserTokensPerSecond)} tokens/s instead of ${formatNumber(solo.perUserTokensPerSecond)}: the ${formatBytes(picture.modelBytes)} model read is shared, while every user adds their own KV cache to read, now ${formatBytes(picture.kvBytes)} (${Math.round(kvShare * 100)}% of each step’s bytes).`;
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
    const who = settings.batch === 1 ? 'One user' : `${settings.batch.toLocaleString()} users`;
    return `${who}: each step reads <b>${formatBytes(inputs.memory.weightBytes)}</b> of model (shared) + <b>${formatBytes(inputs.memory.kvBytes)}</b> of KV (one cache per user). Reading takes <b>${formatDuration(inputs.decode.memoryMs)}</b>, the math <b>${formatDuration(inputs.decode.computeMs)}</b>.`;
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

/** The model's own busy shares, to compare against a real trace. */
function traceSignature(panel: StoryPanelSpec, inputs: CutawayInputs): string {
  const job = panel.id === 'two-jobs' ? inputs.prefill : inputs.decode;
  const label = panel.id === 'two-jobs' ? 'prompt step' : 'decode step';
  const pct = (share: number) => { const value = Math.min(1, share) * 100; return value < 1 ? value.toFixed(1) : Math.round(value).toString(); };
  const math = pct(job.computeMs / job.totalMs);
  const memory = pct(job.memoryMs / job.totalMs);
  return `This model’s ${label}: math busy ${math}% of the time, memory traffic busy ${memory}%. It assumes 55% of peak math and 72% of peak bandwidth; a trace far below those points to another limit, such as launch overhead or small kernels.`;
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
  // A real on/off switch: the state reads Off or On, never an instruction.
  if (move.effect) return `<li><button type="button" class="move-toggle" role="switch" data-move="${move.effect}" aria-checked="false">${body}<span class="move-switch"><i aria-hidden="true"></i><span data-move-state>Off</span></span></button></li>`;
  const tag = move.viaKnob ? 'the knob above' : move.modeled ? 'shown below the plate' : 'not modeled';
  return `<li>${body}<small data-modeled="${move.modeled}">${tag}</small></li>`;
}

/** Applies or removes a modeled move on a panel's settings. */
function applyMove(settings: SimulationSettings, effect: MoveEffect, on: boolean): void {
  if (effect === 'kv8') settings.kvBits = on ? 8 : 16;
  if (effect === 'speculate') settings.speculativeTokens = on ? 4 : 0;
  if (effect === 'fp8') {
    settings.weightBits = on ? 8 : 16;
    settings.mathBits = on ? 8 : 16;
  }
  if (effect === 'prefixReuse') {
    settings.reusePromptPrefixes = on;
    settings.prefixCachePercent = on ? 75 : 0;
  }
}

function moveIsOn(settings: SimulationSettings, effect: MoveEffect): boolean {
  if (effect === 'kv8') return settings.kvBits === 8;
  if (effect === 'speculate') return settings.speculativeTokens > 0;
  if (effect === 'fp8') return settings.mathBits === 8 && settings.weightBits <= 8;
  return settings.reusePromptPrefixes && settings.prefixCachePercent > 0;
}

function panelMarkup(panel: StoryPanelSpec): string {
  const settings = defaultsFor(panel.id);
  panelState.set(panel.id, { settings, views: new Map() });
  const stage = panel.plate === 'die-pair'
    ? `<div class="panel-pair"><figure class="panel-figure"><figcaption data-job-caption="prefill"></figcaption><div data-cutaway="prefill"></div></figure><figure class="panel-figure"><figcaption data-job-caption="decode"></figcaption><div data-cutaway="decode"></div></figure></div>`
    : `<div data-cutaway="main"></div><p class="panel-caption" data-caption></p>`;
  return `<section class="concept-panel" data-panel="${panel.id}" aria-labelledby="title-${panel.id}">
    <div class="panel-narrative">
      <h3 id="title-${panel.id}">${panel.title}</h3>
      <p class="panel-claim">${panel.claim}</p>
      ${knobMarkup(panel, settings)}
      <div class="panel-surprise"><span>The surprise</span><p data-surprise></p></div>
      <details class="panel-trace"><summary>In a profiler trace</summary><p>${panel.trace}</p><p class="panel-trace-model" data-trace-model></p><small>What to look for in a GPU timeline, for example from rocprofv3 or Nsight Systems. Qualitative expectations, not measured traces.</small></details>
    </div>
    <div class="panel-instrument">
      <div class="panel-stage">
        <div class="panel-zoom"><span>Zoom</span><b data-zoom>${zoomLabel(panel.plate, settings.hardwareId)}</b></div>
        ${stage}
        ${panel.numbers.length ? '<div class="panel-numbers" data-numbers></div>' : ''}
        ${LEGEND}
        <p class="panel-hint">Click any part or label to pair them.</p>
      </div>
      <div class="panel-moves"><span>The moves${panel.moves.some((move) => move.effect) ? '<small>Switch one on to apply it to the plate</small>' : ''}</span><ul>${panel.moves.map(moveMarkup).join('')}</ul></div>
    </div>
  </section>`;
}

const GPU_SCENES: { id: 'server' | 'package' | 'die' | 'unit'; label: string; lead: string }[] = [
  { id: 'server', label: 'Server', lead: 'A GPU server: eight GPUs on one board, a host CPU with its own memory, local storage, and a network card.' },
  { id: 'package', label: 'Package', lead: 'One GPU, taken apart: the compute silicon, the memory stacks beside it, and the layers that wire them together.' },
  { id: 'die', label: 'Die', lead: 'Inside the compute silicon: many identical workers sharing one cache, fed by memory at the edges.' },
  { id: 'unit', label: 'Compute unit', lead: 'One worker, enlarged: the math units and the small, fast memories right beside them.' },
];

const ACTS: ActSpec[] = [
  {
    id: 'act-1', number: 1, title: 'The GPU',
    intro: 'What the hardware is, from the whole server down to one compute unit, and what each part is for.',
    scenes: [...GPU_SCENES.map(({ id, label }) => ({ id, label })), { id: 'build', label: 'Challenge: build it' }],
    tools: '<span class="view-toggle" role="group" aria-label="View"><button type="button" data-gpu-view="isometric" aria-pressed="true">Isometric</button><button type="button" data-gpu-view="realistic" aria-pressed="false">Realistic</button></span>',
  },
  {
    id: 'act-2', number: 2, title: 'Inference',
    intro: 'What the model computes for every token, in order: from text on the CPU, through every layer on the GPU, and back to text. Each stage shows its size, where its time goes, and what grows until something runs out. Llama 3.1 8B throughout.',
    scenes: [...STAGE_ORDER.map((id) => ({ id, label: STAGE_TAB_LABEL[id] })), { id: 'two-jobs', label: 'Two jobs, one chip' }],
    tools: FORWARD_TOOLS,
  },
  {
    id: 'act-3', number: 3, title: 'The throttles',
    intro: `How each step is changed by the choices you make and limited by the hardware from Act 1. ${EFFICIENCY_NOTE}`,
    scenes: STORY_PANELS.filter((panel) => panel.id !== 'two-jobs').map((panel) => ({ id: panel.id, label: panel.title })),
  },
  {
    id: 'act-4', number: 4, title: 'Putting it together',
    intro: `Every knob at once, on any chip. Play freely, or pick a challenge with fixed constraints to beat. ${EFFICIENCY_NOTE}`,
    scenes: [{ id: 'playground', label: 'Playground and challenges' }],
  },
];

const acts = mountActs(root, ACTS, { headerTools: chipToggle(), onShow: (sceneId) => (sceneId === 'build' ? buildView : gpuViews.get(sceneId))?.refresh() });

// Act 1: the chip alone, at four zoom levels.
const gpuViews = new Map<string, CutawayView>();
for (const scene of GPU_SCENES) {
  acts.sceneHost(scene.id).innerHTML = `<div class="gpu-scene">
    <p class="gpu-scene-lead">${scene.lead}</p>
    <div class="gpu-scene-body">
      <div class="gpu-scene-plate"><div data-gpu-plate="${scene.id}"></div><div data-iso-legend>${LEGEND}</div><p class="rl-note" data-rl-note hidden>Realistic rendering of the same layout as the isometric plate: materials are illustrative, positions stylized, and counts published. Drag to orbit, scroll to zoom, click a part.</p></div>
      <aside class="part-card" aria-label="Part details"><div class="part-detail" data-part-detail aria-live="polite"></div><div class="part-index"><span>Terms on this plate</span><ul data-part-index></ul></div></aside>
    </div>
  </div>`;
}

const gpuSelected = new Map<string, string | null>();

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** The part card: plain name, the terms people use, what it is, does, and why it matters. */
function renderPartCard(sceneId: string, plate: Plate): void {
  const host = acts.sceneHost(sceneId);
  const vendor = getHardware(storyHardwareId).vendor as Vendor;
  const part = gpuSelected.get(sceneId) ?? null;
  const detail = host.querySelector<HTMLElement>('[data-part-detail]')!;
  const entry = part ? partEntry(part, vendor) : undefined;
  detail.innerHTML = entry
    ? `<p class="part-kicker">Selected part</p><h4>${escapeHtml(entry.name)}</h4>
      <dl class="part-terms">${entry.terms.map((term) => `<div><dt>${escapeHtml(term.term)}</dt><dd>${escapeHtml(term.meaning)}</dd></div>`).join('')}</dl>
      <h5>What it is</h5><p>${escapeHtml(entry.what)}</p>
      <h5>What it does</h5><p>${escapeHtml(entry.does)}</p>
      <h5>Why it matters for inference</h5><p>${escapeHtml(entry.inference)}</p>
      ${entry.note ? `<p class="part-note">${escapeHtml(entry.note)}</p>` : ''}`
    : '<p class="part-kicker">Parts and purpose</p><p class="part-empty">Click any part of the drawing, or a term below, to see what it is called, what it does, and why it matters for inference.</p>';
  // Every term on this plate, each selecting the part it names.
  const seen = new Set<string>();
  const chips: string[] = [];
  for (const label of plate.scene.labels) {
    const labelEntry = partEntry(label.part, vendor);
    if (!labelEntry) continue;
    for (const term of labelEntry.terms) {
      if (seen.has(term.term)) continue;
      seen.add(term.term);
      chips.push(`<li><button type="button" data-select-part="${label.part}" aria-pressed="${label.part === part}" title="${escapeHtml(labelEntry.name)}">${escapeHtml(term.term)}</button></li>`);
    }
  }
  host.querySelector<HTMLElement>('[data-part-index]')!.innerHTML = chips.join('');
}

const gpuPlates = new Map<string, Plate>();
for (const scene of GPU_SCENES) {
  acts.sceneHost(scene.id).querySelector('.part-index')!.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-select-part]');
    if (!button) return;
    const part = button.dataset.selectPart!;
    gpuViews.get(scene.id)?.select(gpuSelected.get(scene.id) === part ? null : part);
  });
}

// ---- Act 1 challenge: put the GPU back together ----------------------------
acts.sceneHost('build').innerHTML = `<div class="gpu-scene build-scene">
  <p class="gpu-scene-lead">Put the GPU back together. Drag each part from the tray onto its outline, or pick a part and then click an outline or its zone marker.</p>
  <div class="build-rounds" role="group" aria-label="Round"><button type="button" data-round="package" aria-pressed="true">Round 1 · The package</button><button type="button" data-round="die" aria-pressed="false">Round 2 · The die</button></div>
  <div class="gpu-scene-body">
    <div class="gpu-scene-plate"><div data-build-plate></div><p class="rl-note">The challenge uses the isometric drawing in either view.</p></div>
    <aside class="part-card build-tray" aria-label="Parts tray">
      <div><p class="part-kicker">Parts tray</p><p class="build-progress" data-build-progress></p></div>
      <ul data-build-tray></ul>
      <div class="build-feedback" data-build-feedback aria-live="polite"></div>
      <button type="button" class="build-reset" data-build-reset>Start this round again</button>
    </aside>
  </div>
</div>`;

const buildHost = acts.sceneHost('build');
let buildRoundId: RoundId = 'package';
const buildPlaced: Record<RoundId, Set<string>> = { package: new Set(), die: new Set() };
let buildCard: string | null = null;
let buildView: CutawayView | null = null;
let buildRound: AssemblyRound = { id: 'package', parts: [] };

function buildSourcePlate(): Plate {
  const settings = { ...DEFAULT_SETTINGS, hardwareId: storyHardwareId };
  const inputs = buildCutawayInputs(settings, getHardware(storyHardwareId), modelFor(settings));
  return buildRoundId === 'package' ? packagePlate(inputs, 'hardware') : diePlate(inputs, { job: 'decode', detail: 'full', activity: false });
}

function buildFeedback(html: string, tone: 'neutral' | 'good' | 'bad' = 'neutral'): void {
  const node = buildHost.querySelector<HTMLElement>('[data-build-feedback]')!;
  node.dataset.tone = tone;
  node.innerHTML = html;
}

function renderBuild(): void {
  const vendor = getHardware(storyHardwareId).vendor as Vendor;
  const source = buildSourcePlate();
  buildRound = assemblyRound(buildRoundId, source);
  const placed = buildPlaced[buildRoundId];
  const plate = assemblyPlate(source, buildRound, placed);
  if (buildView) buildView.update(plate);
  else buildView = mountCutaway(buildHost.querySelector<HTMLElement>('[data-build-plate]')!, plate, 'Build the GPU', { onSelect: (part) => { if (part) chooseZone(part); } });
  // The tray is sorted by name, so its order never reveals the zone numbers.
  const cards = buildRound.parts
    .map((part) => ({ part, entry: partEntry(part, vendor)! }))
    .sort((a, b) => a.entry.name.localeCompare(b.entry.name));
  buildHost.querySelector<HTMLElement>('[data-build-tray]')!.innerHTML = cards.map(({ part, entry }) => {
    const done = placed.has(part);
    const terms = entry.terms.slice(0, 2).map((term) => term.term).join(' · ');
    return `<li><button type="button" class="build-card" data-card="${part}" aria-pressed="${buildCard === part}" ${done ? 'disabled' : ''}><b>${escapeHtml(entry.name)}</b><small>${escapeHtml(terms)}</small>${done ? `<i aria-hidden="true">✓ Zone ${zoneNumber(buildRound, part)}</i>` : ''}</button></li>`;
  }).join('');
  buildHost.querySelector<HTMLElement>('[data-build-progress]')!.textContent = `${placed.size} of ${buildRound.parts.length} placed`;
  for (const button of buildHost.querySelectorAll<HTMLButtonElement>('[data-round]')) button.setAttribute('aria-pressed', String(button.dataset.round === buildRoundId));
}

function tryPlace(card: string, zone: string): void {
  const vendor = getHardware(storyHardwareId).vendor as Vendor;
  const placed = buildPlaced[buildRoundId];
  const result = place(buildRound, placed, card, zone);
  const cardEntry = partEntry(card, vendor)!;
  if (result === 'already-placed') {
    buildFeedback(`Zone ${zoneNumber(buildRound, zone)} is already filled.`);
    return;
  }
  if (result === 'wrong') {
    buildFeedback(`<b>Not there.</b> ${escapeHtml(cardEntry.name)}: ${escapeHtml(cardEntry.does)} Look for where that would sit.`, 'bad');
    buildHost.querySelector(`[data-card="${card}"]`)?.classList.add('build-shake');
    window.setTimeout(() => buildHost.querySelector(`[data-card="${card}"]`)?.classList.remove('build-shake'), 450);
    return;
  }
  placed.add(zone);
  buildCard = null;
  renderBuild();
  const terms = cardEntry.terms.slice(0, 2).map((term) => term.term).join(', ');
  if (isComplete(buildRound, placed)) {
    const next = buildRoundId === 'package' ? ' <button type="button" class="build-next" data-round="die">Go to round 2 · The die →</button>' : ' You have rebuilt the package and the die.';
    buildFeedback(`<b>Round complete.</b> Every part is back where it belongs.${next}`, 'good');
  } else {
    buildFeedback(`<b>Correct: ${escapeHtml(cardEntry.name)}</b> (${escapeHtml(terms)}). ${escapeHtml(cardEntry.does)}`, 'good');
  }
}

function chooseZone(zone: string): void {
  buildView?.select(null);
  if (!buildRound.parts.includes(zone)) return;
  if (!buildCard) {
    buildFeedback(buildPlaced[buildRoundId].has(zone) ? `Zone ${zoneNumber(buildRound, zone)} is already filled.` : `Pick a part from the tray first, then choose Zone ${zoneNumber(buildRound, zone)}.`);
    return;
  }
  tryPlace(buildCard, zone);
}

buildHost.addEventListener('click', (event) => {
  const target = event.target as Element;
  const round = target.closest<HTMLButtonElement>('[data-round]');
  if (round) {
    buildRoundId = round.dataset.round as RoundId;
    buildCard = null;
    buildFeedback('');
    renderBuild();
    return;
  }
  if (target.closest('[data-build-reset]')) {
    buildPlaced[buildRoundId].clear();
    buildCard = null;
    buildFeedback('');
    renderBuild();
  }
});

// Cards: a click selects; a drag drops onto whatever outline is under the pointer.
let drag: { card: string; startX: number; startY: number; ghost: HTMLElement | null; pointerId: number } | null = null;
buildHost.addEventListener('pointerdown', (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>('[data-card]');
  if (!button || button.disabled || event.button !== 0) return;
  drag = { card: button.dataset.card!, startX: event.clientX, startY: event.clientY, ghost: null, pointerId: event.pointerId };
  button.setPointerCapture(event.pointerId);
});
buildHost.addEventListener('pointermove', (event) => {
  if (!drag || event.pointerId !== drag.pointerId) return;
  if (!drag.ghost && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 6) {
    drag.ghost = document.createElement('div');
    drag.ghost.className = 'build-drag';
    drag.ghost.textContent = partEntry(drag.card, getHardware(storyHardwareId).vendor as Vendor)!.name;
    document.body.appendChild(drag.ghost);
  }
  if (drag.ghost) {
    drag.ghost.style.left = `${event.clientX + 12}px`;
    drag.ghost.style.top = `${event.clientY + 12}px`;
  }
});
buildHost.addEventListener('pointerup', (event) => {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const { card, ghost } = drag;
  drag = null;
  if (!ghost) {
    buildCard = buildCard === card ? null : card;
    renderBuild();
    buildFeedback(buildCard ? 'Now choose the outline or zone where it belongs.' : '');
    return;
  }
  ghost.remove();
  const zone = document.elementFromPoint(event.clientX, event.clientY)?.closest<SVGElement>('[data-build-plate] [data-part]')?.dataset.part;
  if (zone && buildRound.parts.includes(zone)) tryPlace(card, zone);
});
buildHost.addEventListener('keydown', (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>('[data-card]');
  if (!button || (event.key !== 'Enter' && event.key !== ' ')) return;
  event.preventDefault();
  buildCard = buildCard === button.dataset.card ? null : button.dataset.card!;
  renderBuild();
  buildFeedback(buildCard ? 'Now Tab to a zone marker on the drawing and press Enter.' : '');
  buildHost.querySelector<HTMLButtonElement>(`[data-card="${button.dataset.card}"]`)?.focus();
});

type GpuViewMode = 'isometric' | 'realistic';
let gpuViewMode: GpuViewMode = 'isometric';
type MountRealistic = typeof import('./realistic/render3d')['mountRealistic'];
let mountRealistic: MountRealistic | null = null;

/** Mounts the current view (isometric SVG or realistic 3D) for one Act 1 scene. */
async function mountGpuView(sceneId: string): Promise<void> {
  const host = acts.sceneHost(sceneId);
  const target = host.querySelector<HTMLElement>('[data-gpu-plate]')!;
  const label = `The GPU: ${GPU_SCENES.find((scene) => scene.id === sceneId)!.label}`;
  const options = {
    onSelect: (part: string | null) => {
      gpuSelected.set(sceneId, part);
      renderPartCard(sceneId, gpuPlates.get(sceneId)!);
    },
  };
  gpuViews.get(sceneId)?.destroy();
  gpuViews.delete(sceneId);
  const realistic = gpuViewMode === 'realistic';
  host.querySelector<HTMLElement>('[data-iso-legend]')!.hidden = realistic;
  host.querySelector<HTMLElement>('[data-rl-note]')!.hidden = !realistic;
  if (realistic) {
    // Three.js loads only when the realistic view is first requested.
    mountRealistic ??= (await import('./realistic/render3d')).mountRealistic;
    if (gpuViewMode !== 'realistic') return;
  }
  const view = realistic ? mountRealistic!(target, gpuPlates.get(sceneId)!, label, options) : mountCutaway(target, gpuPlates.get(sceneId)!, label, options);
  gpuViews.set(sceneId, view);
  const keep = gpuSelected.get(sceneId);
  if (keep) view.select(keep);
}

acts.sceneHost('server').closest('.act')!.querySelector('.view-toggle')!.addEventListener('click', (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>('[data-gpu-view]');
  if (!button || button.dataset.gpuView === gpuViewMode) return;
  gpuViewMode = button.dataset.gpuView as GpuViewMode;
  for (const toggle of button.parentElement!.querySelectorAll<HTMLButtonElement>('[data-gpu-view]')) toggle.setAttribute('aria-pressed', String(toggle === button));
  for (const scene of GPU_SCENES) void mountGpuView(scene.id);
});

function renderGpu(): void {
  const settings = { ...DEFAULT_SETTINGS, hardwareId: storyHardwareId };
  const inputs = buildCutawayInputs(settings, getHardware(storyHardwareId), modelFor(settings));
  const plates: Record<string, Plate> = {
    server: serverPlate(inputs, 'hardware'),
    package: packagePlate(inputs, 'hardware'),
    die: diePlate(inputs, { job: 'decode', detail: 'full', activity: false }),
    unit: unitPlate(storyHardwareId, 0),
  };
  for (const scene of GPU_SCENES) {
    const plate = plates[scene.id]!;
    gpuPlates.set(scene.id, plate);
    const existing = gpuViews.get(scene.id);
    if (existing) existing.update(plate);
    else void mountGpuView(scene.id);
    renderPartCard(scene.id, plate);
  }
}

// Acts 2 and 3: the concept panels, one per scene.
for (const panel of STORY_PANELS) acts.sceneHost(panel.id).innerHTML = panelMarkup(panel);

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
  for (const job of ['prefill', 'decode'] as const) {
    const node = section.querySelector<HTMLElement>(`[data-job-caption="${job}"]`);
    if (node) node.innerHTML = jobCaption(inputs, job, settings);
  }
  const captionNode = section.querySelector<HTMLElement>('[data-caption]');
  if (captionNode) captionNode.innerHTML = caption(panel, inputs, settings);
  const numbers = section.querySelector<HTMLElement>('[data-numbers]');
  if (numbers) renderPicture(numbers, picture, new Set(panel.numbers), { footer: false });
  section.querySelector<HTMLElement>('[data-surprise]')!.textContent = surprise(panel, picture, inputs, settings);
  section.querySelector<HTMLElement>('[data-trace-model]')!.textContent = traceSignature(panel, inputs);
  for (const button of section.querySelectorAll<HTMLButtonElement>('[data-move]')) {
    const on = moveIsOn(settings, button.dataset.move as MoveEffect);
    button.setAttribute('aria-checked', String(on));
    button.querySelector('[data-move-state]')!.textContent = on ? 'On' : 'Off';
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
  control.addEventListener('input', () => {
    if (control.dataset.knob === 'sequenceLength') settings.sequenceLength = sequenceFromSlider(Number(control.value));
    if (control.dataset.knob === 'batch') settings.batch = batchFromSlider(Number(control.value));
    if (control.dataset.knob === 'weightBits') settings.weightBits = Number(control.value) as SimulationSettings['weightBits'];
    if (control.dataset.knob === 'kvPlacement') settings.kvPlacement = control.value as KvPlacement;
    renderPanel(panel);
  });
  renderPanel(panel);
}

renderGpu();
renderBuild();

// Act 2: one forward pass, stage by stage.
const forward = mountForwardScenes(
  (stage) => acts.sceneHost(stage),
  acts.sceneHost('tokenize').closest<HTMLElement>('.act')!.querySelector<HTMLElement>('.act-tools')!,
  (link) => {
    acts.open(`act-1/${link.scene}`, true);
    history.replaceState(null, '', `#act-1/${link.scene}`);
    gpuViews.get(link.scene)?.select(link.part);
  },
);
forward.render(storyHardwareId);

// Act 4: the playground.
const playground = mountPlayground(acts.sceneHost('playground'));

// One accelerator for the whole story: any act's selector switches every act.
root.addEventListener('click', (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>('.act-tools [data-chip]');
  if (!button || button.dataset.chip === storyHardwareId) return;
  storyHardwareId = button.dataset.chip!;
  for (const chip of root.querySelectorAll<HTMLButtonElement>('.act-tools [data-chip]')) chip.setAttribute('aria-pressed', String(chip.dataset.chip === storyHardwareId));
  renderGpu();
  buildPlaced.package.clear();
  buildPlaced.die.clear();
  buildCard = null;
  buildFeedback('');
  renderBuild();
  forward.render(storyHardwareId);
  for (const panel of STORY_PANELS) {
    panelState.get(panel.id)!.settings.hardwareId = storyHardwareId;
    renderPanel(panel);
  }
  playground.setHardware(storyHardwareId);
});
