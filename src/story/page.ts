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
import { FORWARD_TOOLS, PASS_LOOP, STAGE_ORDER, STAGE_TAB_LABEL, mountForwardScenes } from './forward/scenes';
import { mountBottleneckChallenge } from './forward/challenge';
import { mountPickChallenge } from './throttles/challenge';
import { mountChallengeBoard, type ChallengeBoardView } from './challenges/board';
import { partEntry, type Vendor } from '../data/parts';
import { assemblyPlate, assemblyRound, isComplete, isOpenZone, place, zoneNumber, type AssemblyRound, type PlacementResult, type RoundId } from './challenge/assembly';
import { mountCutaway, type CutawayView } from './cutaway/render';
import { STORY_PANELS, type MoveEffect, type StoryMove, type StoryPanelSpec } from './panels';
import { buildPictureModel, type PictureModel } from './picture/model';
import { renderPicture } from './picture/render';
import { mountPlayground, type PlaygroundView } from './playground';

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
    return `Pass 1 spends ${formatDuration(promptPerToken)} per prompt token; each later pass spends ${formatNumber(decode.totalMs / Math.max(promptPerToken, Number.EPSILON))}× that on its one new token. The matrix units are busy in pass 1 and mostly idle after.`;
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
    return `KV in <b>${where}</b> (${formatBandwidth(tier.bandwidthBytesPerSecond!)}): each per-token pass takes <b>${formatDuration(inputs.decode.totalMs)}</b>. Parking one idle conversation there: restore <b>${formatDuration(restore.restoreMs)}</b> vs. rebuild from the prompt <b>${formatDuration(restore.recomputeMs)}</b>.`;
  }
  return '';
}

/** The model's own busy shares, to compare against a real trace. */
function traceSignature(panel: StoryPanelSpec, inputs: CutawayInputs): string {
  const job = panel.id === 'two-jobs' ? inputs.prefill : inputs.decode;
  const label = panel.id === 'two-jobs' ? 'first pass (the whole prompt)' : 'per-token pass';
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
      ? `First pass · ${(settings.sequenceLength - reused).toLocaleString()} new tokens (${reused.toLocaleString()} reused)`
      : `First pass · ${settings.sequenceLength.toLocaleString()} prompt tokens`
    : 'Every pass after · 1 new token';
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

/** Switchable moves up front; the rest (knob-driven or not modeled) fold away. */
function movesMarkup(panel: StoryPanelSpec): string {
  const switches = panel.moves.filter((move) => move.effect);
  const others = panel.moves.filter((move) => !move.effect);
  return `<div class="panel-moves">
    ${switches.length ? `<span>Try a move<small>Switch one on to apply it to the plate</small></span><ul>${switches.map(moveMarkup).join('')}</ul>` : ''}
    ${others.length ? `<details class="panel-other-moves"><summary>Other moves (${others.length})</summary><ul>${others.map(moveMarkup).join('')}</ul></details>` : ''}
  </div>`;
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
      <div class="panel-links">
        <div><span>Changes in Act 2</span>${panel.changes.map((stage) => `<button type="button" data-open-stage="${stage}">${STAGE_TAB_LABEL[stage]} ↑</button>`).join('')}</div>
        <div><span>Limited by, from Act 1</span>${panel.limitedBy.map((link, index) => `<button type="button" data-open-limit="${index}">${link.label} ↑</button>`).join('')}</div>
      </div>
      <p class="panel-workload" data-workload></p>
      ${knobMarkup(panel, settings)}
      <div class="panel-surprise"><span>The surprise</span><p data-surprise></p></div>
      <details class="panel-trace"><summary>In a profiler trace</summary><p>${panel.trace}</p><p class="panel-trace-model" data-trace-model></p><small>What to look for in a GPU timeline, for example from rocprofv3 or Nsight Systems. Qualitative expectations, not measured traces.</small></details>
    </div>
    <div class="panel-instrument">
      <div class="panel-stage">
        <div class="panel-zoom"><span>Zoom</span><b data-zoom>${zoomLabel(panel.plate, settings.hardwareId)}</b></div>
        ${stage}
        ${panel.numbers.length ? '<div class="panel-numbers" data-numbers></div>' : ''}
        ${movesMarkup(panel)}
        ${LEGEND}
      </div>
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
  },
  {
    id: 'act-2', number: 2, title: 'Inference',
    intro: 'What the model computes, stage by stage: from text on the CPU, through every layer on the GPU, and back to text. A request runs these stages once for the whole prompt, then once more for every token of the answer. Llama 3.1 8B throughout.',
    scenes: [...STAGE_ORDER.map((id) => ({ id, label: STAGE_TAB_LABEL[id] })), { id: 'two-jobs', label: 'First vs. later' }, { id: 'bottleneck', label: 'Challenge' }],
    tools: FORWARD_TOOLS,
    banner: PASS_LOOP,
  },
  {
    id: 'act-3', number: 3, title: 'The throttles',
    intro: 'How each stage from Act 2 changes with the choices you make, and which part from Act 1 it runs into.',
    footnote: EFFICIENCY_NOTE,
    scenes: [...STORY_PANELS.filter((panel) => panel.id !== 'two-jobs').map((panel) => ({ id: panel.id, label: panel.title })), { id: 'pick', label: 'Challenge' }],
  },
  {
    id: 'act-4', number: 4, title: 'Putting it together',
    intro: 'Real serving problems with fixed targets, then every knob at once on any chip.',
    footnote: EFFICIENCY_NOTE,
    scenes: [{ id: 'challenges', label: 'Challenges' }, { id: 'playground', label: 'Playground' }],
  },
];

// Views mounted while hidden measure nothing, so each redraws when its scene opens.
// The playground mounts after the acts, so it may not exist yet on the first show.
let playground: PlaygroundView | null = null;
let challengeBoard: ChallengeBoardView | null = null;
/** Act 4's visible scene: its chip buttons show the challenge's fixed chip while the challenges are open. */
let act4Scene: 'challenges' | 'playground' = 'challenges';
const acts = mountActs(root, ACTS, {
  headerTools: chipToggle(),
  onShow: (sceneId) => {
    if (sceneId === 'challenges' || sceneId === 'playground') { act4Scene = sceneId; syncAct4Chips(); }
    if (sceneId === 'playground') { playground?.refresh(); return; }
    (sceneId === 'build' ? buildView : gpuViews.get(sceneId))?.refresh();
  },
});

/** The workload dimension each panel's own knob controls, which Act 2 must not override. */
const KNOB_OWNS: Record<string, ('batch' | 'sequenceLength')[]> = {
  'two-jobs': ['sequenceLength'], 'share-read': ['batch'], 'memory-wall': ['sequenceLength'], 'heavier-tokens': ['batch'],
};

/** Moves a panel's slider to match its settings after they change from outside. */
function syncKnob(panel: StoryPanelSpec): void {
  const control = root!.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-panel="${panel.id}"] [data-knob]`);
  if (!control || control instanceof HTMLSelectElement) return;
  const { settings } = panelState.get(panel.id)!;
  control.value = String(control.dataset.knob === 'batch' ? batchToSlider(settings.batch) : sequenceToSlider(settings.sequenceLength));
}

/** Opens an Act 1 scene and selects the named part on it. */
function openHardwarePart(link: { scene: string; part: string }): void {
  acts.open(`act-1/${link.scene}`, true);
  history.replaceState(null, '', `#act-1/${link.scene}`);
  gpuViews.get(link.scene)?.select(link.part);
}

// Act 1: the chip alone, at four zoom levels.
const gpuViews = new Map<string, CutawayView>();
for (const scene of GPU_SCENES) {
  acts.sceneHost(scene.id).innerHTML = `<div class="gpu-scene">
    <p class="gpu-scene-lead">${scene.lead}</p>
    <div class="gpu-scene-body">
      <div class="gpu-scene-plate"><div data-gpu-plate="${scene.id}"></div><div data-iso-legend>${LEGEND}</div></div>
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
  <div class="build-bar">
    <div class="build-rounds" role="group" aria-label="Round"><button type="button" data-round="package" aria-pressed="true">Round 1 · The package</button><button type="button" data-round="die" aria-pressed="false">Round 2 · The die</button></div>
    <div class="build-toast" data-build-feedback role="status" aria-live="polite" hidden></div>
  </div>
  <div class="gpu-scene-body">
    <div class="gpu-scene-plate build-stage">
      <div data-build-plate></div>
      <div class="build-done" data-build-done hidden></div>
    </div>
    <aside class="part-card build-tray" aria-label="Parts tray">
      <div><p class="part-kicker">Parts tray</p><p class="build-progress" data-build-progress></p><ol class="build-pips" data-build-pips aria-hidden="true"></ol></div>
      <ul data-build-tray></ul>
      <button type="button" class="build-reset" data-build-reset>Start this round again</button>
    </aside>
  </div>
</div>`;

const buildHost = acts.sceneHost('build');
const ROUND_TITLE: Record<RoundId, { number: number; done: string }> = {
  package: { number: 1, done: 'Package rebuilt' },
  die: { number: 2, done: 'Die rebuilt' },
};
let buildRoundId: RoundId = 'package';
const buildPlaced: Record<RoundId, Set<string>> = { package: new Set(), die: new Set() };
const buildMisses: Record<RoundId, number> = { package: 0, die: 0 };
const buildFinished = new Set<RoundId>();
let buildCard: string | null = null;
let buildView: CutawayView | null = null;
let buildRound: AssemblyRound = { id: 'package', parts: [] };
let toastTimer = 0;
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function buildSourcePlate(): Plate {
  const settings = { ...DEFAULT_SETTINGS, hardwareId: storyHardwareId };
  const inputs = buildCutawayInputs(settings, getHardware(storyHardwareId), modelFor(settings));
  return buildRoundId === 'package' ? packagePlate(inputs, 'hardware') : diePlate(inputs, { job: 'decode', detail: 'full', activity: false });
}

/** A message just above the drawing, where the reader is looking. Misses stay until the next move. */
function buildFeedback(html: string, tone: 'neutral' | 'good' | 'bad' = 'neutral'): void {
  const node = buildHost.querySelector<HTMLElement>('[data-build-feedback]')!;
  window.clearTimeout(toastTimer);
  node.hidden = html === '';
  node.dataset.tone = tone;
  node.innerHTML = html;
  node.classList.remove('is-new');
  void node.offsetWidth;
  node.classList.add('is-new');
  if (html && tone !== 'bad') toastTimer = window.setTimeout(() => { node.hidden = true; }, 6000);
}

/** The drawing's nodes (box and zone marker) for one part. */
function zoneNodes(part: string): NodeListOf<SVGElement> {
  return buildHost.querySelectorAll<SVGElement>(`[data-build-plate] [data-part="${part}"]`);
}

function flashZone(part: string, className: 'cw-landed' | 'cw-drop-wrong', delay = 0): void {
  window.setTimeout(() => {
    for (const node of zoneNodes(part)) {
      node.classList.remove(className);
      void node.getBoundingClientRect();
      node.classList.add(className);
    }
    window.setTimeout(() => { for (const node of zoneNodes(part)) node.classList.remove(className); }, 900);
  }, delay);
}

let dropTarget: string | null = null;
function setDropTarget(part: string | null): void {
  if (part === dropTarget) return;
  if (dropTarget) for (const node of zoneNodes(dropTarget)) node.classList.remove('cw-drop-target');
  dropTarget = part;
  if (part) for (const node of zoneNodes(part)) node.classList.add('cw-drop-target');
}

/** The open zone under a screen point, if any. */
function zoneAt(x: number, y: number): string | null {
  const part = document.elementFromPoint(x, y)?.closest<SVGElement>('[data-build-plate] [data-part]')?.dataset.part;
  return part && isOpenZone(buildRound, buildPlaced[buildRoundId], part) ? part : null;
}

function hideDone(): void {
  buildHost.querySelector<HTMLElement>('[data-build-done]')!.hidden = true;
}

function showDone(): void {
  const title = ROUND_TITLE[buildRoundId];
  const misses = buildMisses[buildRoundId];
  const both = buildFinished.has('package') && buildFinished.has('die');
  const verdict = misses === 0 ? 'Clean build: no misses.' : `${misses} ${misses === 1 ? 'miss' : 'misses'} on the way.`;
  const next = buildRoundId === 'package'
    ? '<button type="button" class="build-next" data-round="die">Round 2 · The die →</button>'
    : both
      ? '<a class="build-next" href="#act-2/tokenize">On to Act 2 · Inference ↓</a>'
      : '<button type="button" class="build-next" data-round="package">Back to round 1 · The package</button>';
  const node = buildHost.querySelector<HTMLElement>('[data-build-done]')!;
  node.innerHTML = `<div class="build-done-card" role="dialog" aria-labelledby="build-done-title">
    <p class="build-done-kicker">Round ${title.number} of 2 complete${both ? ' · GPU rebuilt' : ''}</p>
    <h3 id="build-done-title">${both && buildRoundId === 'die' ? 'You rebuilt the GPU' : title.done}</h3>
    <p class="build-done-score"><b>${buildRound.parts.length} of ${buildRound.parts.length}</b> parts placed · ${verdict}</p>
    <div class="build-done-actions">${next}<button type="button" class="build-look" data-build-look>Look at it</button><button type="button" class="build-reset" data-build-reset>Play again</button></div>
  </div>`;
  node.hidden = false;
  node.querySelector<HTMLElement>('.build-next')?.focus({ preventScroll: true });
}

function renderBuild(): void {
  const vendor = getHardware(storyHardwareId).vendor as Vendor;
  const source = buildSourcePlate();
  buildRound = assemblyRound(buildRoundId, source);
  const placed = buildPlaced[buildRoundId];
  const plate = assemblyPlate(source, buildRound, placed);
  dropTarget = null;
  if (buildView) buildView.update(plate);
  else buildView = mountCutaway(buildHost.querySelector<HTMLElement>('[data-build-plate]')!, plate, 'Build the GPU', { labels: 'markers', onSelect: (part) => { if (part) chooseZone(part); } });
  // The tray is sorted by name, so its order never reveals the zone numbers.
  const cards = buildRound.parts
    .map((part) => ({ part, entry: partEntry(part, vendor)! }))
    .sort((a, b) => a.entry.name.localeCompare(b.entry.name));
  buildHost.querySelector<HTMLElement>('[data-build-tray]')!.innerHTML = cards.map(({ part, entry }) => {
    const done = placed.has(part);
    const terms = entry.terms.slice(0, 2).map((term) => term.term).join(' · ');
    return `<li><button type="button" class="build-card" data-card="${part}" aria-pressed="${buildCard === part}" ${done ? 'disabled' : ''}><b>${escapeHtml(entry.name)}</b><small>${escapeHtml(terms)}</small>${done ? `<i aria-hidden="true">✓ Zone ${zoneNumber(buildRound, part)}</i>` : ''}</button></li>`;
  }).join('');
  const misses = buildMisses[buildRoundId];
  buildHost.querySelector<HTMLElement>('[data-build-progress]')!.textContent = `${placed.size} of ${buildRound.parts.length} placed${misses ? ` · ${misses} ${misses === 1 ? 'miss' : 'misses'}` : ''}`;
  buildHost.querySelector<HTMLElement>('[data-build-pips]')!.innerHTML = buildRound.parts.map((part) => `<li class="${placed.has(part) ? 'is-placed' : ''}"></li>`).join('');
  if (!isComplete(buildRound, placed)) { buildFinished.delete(buildRoundId); hideDone(); }
  for (const button of buildHost.querySelectorAll<HTMLButtonElement>('[data-round]')) {
    if (!button.closest('.build-rounds')) continue;
    const id = button.dataset.round as RoundId;
    button.setAttribute('aria-pressed', String(id === buildRoundId));
    button.textContent = `${buildFinished.has(id) ? '✓ ' : ''}Round ${ROUND_TITLE[id].number} · The ${id}`;
  }
}

function tryPlace(card: string, zone: string): PlacementResult {
  const vendor = getHardware(storyHardwareId).vendor as Vendor;
  const placed = buildPlaced[buildRoundId];
  const result = place(buildRound, placed, card, zone);
  const cardEntry = partEntry(card, vendor)!;
  if (result === 'already-placed') {
    buildFeedback(`Zone ${zoneNumber(buildRound, zone)} is already filled.`);
    return result;
  }
  if (result === 'wrong') {
    buildMisses[buildRoundId] += 1;
    flashZone(zone, 'cw-drop-wrong');
    buildHost.querySelector(`[data-card="${card}"]`)?.classList.add('build-shake');
    window.setTimeout(() => buildHost.querySelector(`[data-card="${card}"]`)?.classList.remove('build-shake'), 450);
    buildFeedback(`<span class="build-toast-mark" aria-hidden="true">✗</span><span><b>Not Zone ${zoneNumber(buildRound, zone)}.</b> ${escapeHtml(cardEntry.name)}: ${escapeHtml(cardEntry.does)}</span>`, 'bad');
    const progress = buildHost.querySelector<HTMLElement>('[data-build-progress]')!;
    const misses = buildMisses[buildRoundId];
    progress.textContent = `${placed.size} of ${buildRound.parts.length} placed · ${misses} ${misses === 1 ? 'miss' : 'misses'}`;
    return result;
  }
  placed.add(zone);
  buildCard = null;
  if (isComplete(buildRound, placed)) buildFinished.add(buildRoundId);
  renderBuild();
  const terms = cardEntry.terms.slice(0, 2).map((term) => term.term).join(', ');
  if (isComplete(buildRound, placed)) {
    buildFeedback('');
    // Light every part in turn, then show the result.
    const step = reducedMotion() ? 0 : 140;
    buildRound.parts.forEach((part, index) => flashZone(part, 'cw-landed', index * step));
    window.setTimeout(showDone, buildRound.parts.length * step + (step ? 350 : 0));
  } else {
    flashZone(zone, 'cw-landed');
    buildFeedback(`<span class="build-toast-mark" aria-hidden="true">✓</span><span><b>${escapeHtml(cardEntry.name)}</b> (${escapeHtml(terms)}). ${escapeHtml(cardEntry.does)}</span>`, 'good');
  }
  return result;
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

function resetBuild(rounds: RoundId[]): void {
  for (const id of rounds) {
    buildPlaced[id].clear();
    buildMisses[id] = 0;
    buildFinished.delete(id);
  }
  buildCard = null;
  buildFeedback('');
  hideDone();
  renderBuild();
}

buildHost.addEventListener('click', (event) => {
  const target = event.target as Element;
  const round = target.closest<HTMLButtonElement>('[data-round]');
  if (round) {
    buildRoundId = round.dataset.round as RoundId;
    buildCard = null;
    buildFeedback('');
    hideDone();
    renderBuild();
    return;
  }
  if (target.closest('[data-build-look]')) { hideDone(); return; }
  if (target.closest('[data-build-reset]')) resetBuild([buildRoundId]);
});

// Cards: a click selects; a drag lifts the card, lights the open zone under
// the pointer, and drops onto it. A miss or an empty drop sends the card home.
let drag: { card: string; button: HTMLButtonElement; startX: number; startY: number; offsetX: number; offsetY: number; ghost: HTMLElement | null; pointerId: number } | null = null;

function sendHome(ghost: HTMLElement, button: HTMLButtonElement | null): void {
  const home = button?.isConnected ? button.getBoundingClientRect() : null;
  if (!home || reducedMotion()) { ghost.remove(); return; }
  ghost.classList.add('is-returning');
  ghost.style.left = `${home.left}px`;
  ghost.style.top = `${home.top}px`;
  window.setTimeout(() => ghost.remove(), 320);
}

buildHost.addEventListener('pointerdown', (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>('[data-card]');
  if (!button || button.disabled || event.button !== 0) return;
  const rect = button.getBoundingClientRect();
  drag = { card: button.dataset.card!, button, startX: event.clientX, startY: event.clientY, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top, ghost: null, pointerId: event.pointerId };
  button.setPointerCapture(event.pointerId);
});
buildHost.addEventListener('pointermove', (event) => {
  if (!drag) {
    // A picked card: outlines react on hover, too.
    if (buildCard) setDropTarget(zoneAt(event.clientX, event.clientY));
    return;
  }
  if (event.pointerId !== drag.pointerId) return;
  if (!drag.ghost && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 6) {
    const ghost = document.createElement('div');
    ghost.className = 'build-card build-drag';
    ghost.innerHTML = drag.button.innerHTML;
    ghost.style.width = `${drag.button.offsetWidth}px`;
    document.body.appendChild(ghost);
    drag.ghost = ghost;
    drag.button.classList.add('is-lifted');
    buildHost.classList.add('is-dragging');
  }
  if (drag.ghost) {
    drag.ghost.style.left = `${event.clientX - drag.offsetX}px`;
    drag.ghost.style.top = `${event.clientY - drag.offsetY}px`;
    const zone = zoneAt(event.clientX, event.clientY);
    setDropTarget(zone);
    drag.ghost.classList.toggle('is-over', zone !== null);
  }
});
function endDrag(event: PointerEvent, drop: boolean): void {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const { card, button, ghost } = drag;
  drag = null;
  buildHost.classList.remove('is-dragging');
  button.classList.remove('is-lifted');
  setDropTarget(null);
  if (!ghost) {
    if (!drop) return;
    buildCard = buildCard === card ? null : card;
    renderBuild();
    buildFeedback(buildCard ? 'Now drop it on the outline or zone where it belongs.' : '');
    return;
  }
  const zone = drop ? document.elementFromPoint(event.clientX, event.clientY)?.closest<SVGElement>('[data-build-plate] [data-part]')?.dataset.part : undefined;
  const result = zone && buildRound.parts.includes(zone) ? tryPlace(card, zone) : null;
  if (result === 'correct') ghost.remove();
  else sendHome(ghost, buildHost.querySelector<HTMLButtonElement>(`[data-card="${card}"]`));
}
buildHost.addEventListener('pointerup', (event) => endDrag(event, true));
buildHost.addEventListener('pointercancel', (event) => endDrag(event, false));
buildHost.addEventListener('keydown', (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>('[data-card]');
  if (!button || (event.key !== 'Enter' && event.key !== ' ')) return;
  event.preventDefault();
  buildCard = buildCard === button.dataset.card ? null : button.dataset.card!;
  renderBuild();
  buildFeedback(buildCard ? 'Now Tab to a zone marker on the drawing and press Enter.' : '');
  buildHost.querySelector<HTMLButtonElement>(`[data-card="${button.dataset.card}"]`)?.focus();
});

/** Mounts the drawing for one Act 1 scene. */
function mountGpuView(sceneId: string): void {
  const host = acts.sceneHost(sceneId);
  const target = host.querySelector<HTMLElement>('[data-gpu-plate]')!;
  const label = `The GPU: ${GPU_SCENES.find((scene) => scene.id === sceneId)!.label}`;
  // The part card and term index list the parts, so the drawing needs only markers.
  const view = mountCutaway(target, gpuPlates.get(sceneId)!, label, {
    labels: 'markers',
    onSelect: (part: string | null) => {
      gpuSelected.set(sceneId, part);
      renderPartCard(sceneId, gpuPlates.get(sceneId)!);
    },
  });
  gpuViews.set(sceneId, view);
}

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
    else mountGpuView(scene.id);
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
  section.querySelector<HTMLElement>('[data-workload]')!.textContent = `Workload: ${settings.batch.toLocaleString()} ${settings.batch === 1 ? 'user' : 'users'} × ${settings.sequenceLength.toLocaleString()} tokens of context · ${modelFor(settings).name.split(' · ')[0]}`;
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
  section.querySelector('.panel-links')!.addEventListener('click', (event) => {
    const target = event.target as Element;
    const stage = target.closest<HTMLButtonElement>('[data-open-stage]');
    if (stage) {
      acts.open(`act-2/${stage.dataset.openStage}`, true);
      history.replaceState(null, '', `#act-2/${stage.dataset.openStage}`);
      return;
    }
    const limit = target.closest<HTMLButtonElement>('[data-open-limit]');
    if (limit) openHardwarePart(panel.limitedBy[Number(limit.dataset.openLimit)]!);
  });
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
  openHardwarePart,
  (workload) => {
    // Act 2's users and context carry into Act 3, except the setting each
    // panel's own knob controls.
    for (const panel of STORY_PANELS) {
      const { settings } = panelState.get(panel.id)!;
      if (!KNOB_OWNS[panel.id]?.includes('batch')) settings.batch = workload.batch;
      if (!KNOB_OWNS[panel.id]?.includes('sequenceLength')) settings.sequenceLength = workload.sequenceLength;
      syncKnob(panel);
      renderPanel(panel);
    }
  },
);
forward.render(storyHardwareId);
const bottleneck = mountBottleneckChallenge(acts.sceneHost('bottleneck'), (stage) => {
  acts.open(`act-2/${stage}`, true);
  history.replaceState(null, '', `#act-2/${stage}`);
});
bottleneck.render(storyHardwareId);
const pickChallenge = mountPickChallenge(acts.sceneHost('pick'), (target) => {
  acts.open(target, true);
  history.replaceState(null, '', `#${target}`);
});
pickChallenge.render(storyHardwareId);

// Act 4: the challenges, then the playground.
challengeBoard = mountChallengeBoard(acts.sceneHost('challenges'), (target) => {
  acts.open(target, true);
  history.replaceState(null, '', `#${target}`);
}, () => syncAct4Chips());
playground = mountPlayground(acts.sceneHost('playground'));

// One accelerator for the whole story: any act's selector switches every act.
root.addEventListener('click', (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>('.act-tools [data-chip]');
  if (!button || button.dataset.chip === storyHardwareId) return;
  storyHardwareId = button.dataset.chip!;
  for (const chip of root.querySelectorAll<HTMLButtonElement>('.act-tools [data-chip]')) chip.setAttribute('aria-pressed', String(chip.dataset.chip === storyHardwareId));
  renderGpu();
  resetBuild(['package', 'die']);
  forward.render(storyHardwareId);
  bottleneck.render(storyHardwareId);
  pickChallenge.render(storyHardwareId);
  for (const panel of STORY_PANELS) {
    panelState.get(panel.id)!.settings.hardwareId = storyHardwareId;
    renderPanel(panel);
  }
  playground?.setHardware(storyHardwareId);
  syncAct4Chips();
});

/**
 * Act 4's chip buttons never claim a chip the numbers are not using: while the
 * challenges are open they show the challenge's fixed chip, disabled, with a
 * note; on the playground they show the story-wide chip.
 */
function syncAct4Chips(): void {
  // Before the board mounts (while the acts are still being built) there is nothing to lock.
  if (!challengeBoard) return;
  const tools = acts.sceneHost('challenges').closest('.act')!.querySelector<HTMLElement>('.act-tools')!;
  const locked = act4Scene === 'challenges' ? challengeBoard.currentChip() : null;
  for (const chip of tools.querySelectorAll<HTMLButtonElement>('[data-chip]')) {
    chip.setAttribute('aria-pressed', String(chip.dataset.chip === (locked ?? storyHardwareId)));
    chip.disabled = locked !== null;
  }
  let note = tools.querySelector<HTMLElement>('[data-chip-lock]');
  if (!note) {
    note = document.createElement('small');
    note.className = 'chip-lock';
    note.dataset.chipLock = '';
    tools.appendChild(note);
  }
  note.hidden = locked === null;
  note.textContent = locked ? `Fixed at ${getHardware(locked).name} by this challenge. The playground uses the chip you pick.` : '';
}
syncAct4Chips();
