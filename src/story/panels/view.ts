import { DEFAULT_SETTINGS, getHardware } from '../../data/profiles';
import { getTopology } from '../../data/topology';
import { calculateSimulation, formatBytes, formatDuration, formatNumber, restoreVsRecompute } from '../../model/calculate';
import type { StageId } from '../../model/forwardPass';
import { modelFor, precisionLabel } from '../../model/strategy';
import { batchFromSlider, batchToSlider, sequenceFromSlider, sequenceToSlider } from '../../state';
import type { KvPlacement, SimulationSettings } from '../../types';
import { buildCutawayInputs, type CutawayInputs } from '../cutaway/inputs';
import { diePlate, formatBandwidth, packagePlate, serverPlate, type Plate } from '../cutaway/plates';
import { CUTAWAY_LEGEND as LEGEND, mountCutaway, type CutawayView } from '../cutaway/render';
import { STAGE_TAB_LABEL } from '../forward/scenes';
import type { HardwareLink } from '../forward/stages';
import { STORY_PANELS, type MoveEffect, type StoryMove, type StoryPanelSpec } from '../panels';
import { buildPictureModel, type PictureModel } from '../picture/model';
import { renderPicture } from '../picture/render';

// The concept panels (Act 2's "first vs. later" and every Act 3 throttle):
// one knob, a cutaway plate, a computed surprise, and the moves that change
// it. Each panel keeps its own settings; Act 2's workload flows in except
// the dimension the panel's own knob controls.

export const EFFICIENCY_NOTE = 'Both accelerators use the same efficiency assumptions—55% of peak math and 72% of peak memory bandwidth—so comparisons reflect published peaks, not measured results on either vendor.';

export interface PanelsView {
  setHardware(hardwareId: string): void;
  /** Adopts Act 2's users and context, except the dimension each panel's own knob controls. */
  adoptWorkload(workload: SimulationSettings): void;
}

export interface PanelNavigation {
  openStage(stage: StageId): void;
  openPart(link: HardwareLink): void;
}

export function mountPanels(hostFor: (panelId: string) => HTMLElement, hardwareId: string, nav: PanelNavigation): PanelsView {
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

  function zoomLabel(plate: StoryPanelSpec['plate'], hardwareId: string): string {
    const chiplets = getTopology(hardwareId).computeDies > 1;
    if (plate === 'die-pair') return chiplets ? 'One of eight compute dies, twice' : 'Inside the GPU die, twice';
    if (plate === 'die') return chiplets ? 'One of eight compute dies' : 'Inside the GPU die';
    if (plate === 'package') return 'The GPU package, exploded';
    return 'The whole server';
  }

  const PLACEMENT_PHRASE: Record<KvPlacement, string> = {
    hbm: 'GPU memory', peer: 'one other GPU', peers: 'all seven other GPUs', host: 'system memory', ssd: 'local SSD', object: 'network object storage',
  };


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
    const settings = { ...defaultsFor(panel.id), hardwareId };
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

  /** The workload dimension each panel's own knob controls, which Act 2 must not override. */
  const KNOB_OWNS: Record<string, ('batch' | 'sequenceLength')[]> = {
    'two-jobs': ['sequenceLength'], 'share-read': ['batch'], 'memory-wall': ['sequenceLength'], 'heavier-tokens': ['batch'],
  };

  /** Moves a panel's slider to match its settings after they change from outside. */
  function syncKnob(panel: StoryPanelSpec): void {
    const control = hostFor(panel.id).querySelector<HTMLInputElement | HTMLSelectElement>('[data-knob]');
    if (!control || control instanceof HTMLSelectElement) return;
    const { settings } = panelState.get(panel.id)!;
    control.value = String(control.dataset.knob === 'batch' ? batchToSlider(settings.batch) : sequenceToSlider(settings.sequenceLength));
  }

  for (const panel of STORY_PANELS) hostFor(panel.id).innerHTML = panelMarkup(panel);

  function renderPanel(panel: StoryPanelSpec): void {
    const section = hostFor(panel.id).querySelector<HTMLElement>(`[data-panel="${panel.id}"]`)!;
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
    const section = hostFor(panel.id).querySelector<HTMLElement>(`[data-panel="${panel.id}"]`)!;
    const control = section.querySelector<HTMLInputElement | HTMLSelectElement>('[data-knob]')!;
    const { settings } = panelState.get(panel.id)!;
    if (control instanceof HTMLSelectElement) control.value = panel.id === 'read-model' ? String(settings.weightBits) : settings.kvPlacement;
    section.querySelector('.panel-links')!.addEventListener('click', (event) => {
      const target = event.target as Element;
      const stage = target.closest<HTMLButtonElement>('[data-open-stage]');
      if (stage) { nav.openStage(stage.dataset.openStage as StageId); return; }
      const limit = target.closest<HTMLButtonElement>('[data-open-limit]');
      if (limit) nav.openPart(panel.limitedBy[Number(limit.dataset.openLimit)]!);
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

  return {
    setHardware(next: string): void {
      for (const panel of STORY_PANELS) {
        panelState.get(panel.id)!.settings.hardwareId = next;
        renderPanel(panel);
      }
    },
    adoptWorkload(workload: SimulationSettings): void {
      for (const panel of STORY_PANELS) {
        const { settings } = panelState.get(panel.id)!;
        if (!KNOB_OWNS[panel.id]?.includes('batch')) settings.batch = workload.batch;
        if (!KNOB_OWNS[panel.id]?.includes('sequenceLength')) settings.sequenceLength = workload.sequenceLength;
        syncKnob(panel);
        renderPanel(panel);
      }
    },
  };
}
