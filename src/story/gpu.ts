import { DEFAULT_SETTINGS, getHardware } from '../data/profiles';
import { partEntry, type Vendor } from '../data/parts';
import { modelFor } from '../model/strategy';
import { buildCutawayInputs } from './cutaway/inputs';
import { diePlate, packagePlate, serverPlate, unitPlate, type Plate } from './cutaway/plates';
import { CUTAWAY_LEGEND as LEGEND, mountCutaway, type CutawayView } from './cutaway/render';
import { escapeHtml } from './html';

// Act 1: the chip alone, at four zoom levels. Each scene pairs the drawing
// with a part card (plain name, the terms people use, what it is and does,
// why it matters for inference) and an index of every term on the plate.

export type GpuSceneId = 'server' | 'package' | 'die' | 'unit';

export const GPU_SCENES: { id: GpuSceneId; label: string; lead: string }[] = [
  { id: 'server', label: 'Server', lead: 'A GPU server: eight GPUs on one board, a host CPU with its own memory, local storage, and a network card.' },
  { id: 'package', label: 'Package', lead: 'One GPU, taken apart: the compute silicon, the memory stacks beside it, and the layers that wire them together.' },
  { id: 'die', label: 'Die', lead: 'Inside the compute silicon: many identical workers sharing one cache, fed by memory at the edges.' },
  { id: 'unit', label: 'Compute unit', lead: 'One worker, enlarged: the math units and the small, fast memories right beside them.' },
];

export interface GpuScenesView {
  setHardware(hardwareId: string): void;
  /** Re-measures one scene's drawing after it becomes visible. */
  refresh(sceneId: GpuSceneId): void;
  /** Selects a part on a scene's drawing, as a click would. */
  selectPart(sceneId: GpuSceneId, part: string): void;
}

export function mountGpuScenes(hostFor: (sceneId: GpuSceneId) => HTMLElement, initialHardwareId: string): GpuScenesView {
  let hardwareId = initialHardwareId;
  const gpuViews = new Map<string, CutawayView>();
  for (const scene of GPU_SCENES) {
    hostFor(scene.id).innerHTML = `<div class="gpu-scene">
      <p class="gpu-scene-lead">${scene.lead}</p>
      <div class="gpu-scene-body">
        <div class="gpu-scene-plate"><div data-gpu-plate="${scene.id}"></div><div data-iso-legend>${LEGEND}</div></div>
        <aside class="part-card" aria-label="Part details"><div class="part-detail" data-part-detail aria-live="polite"></div><div class="part-index"><span>Terms on this plate</span><ul data-part-index></ul></div></aside>
      </div>
    </div>`;
  }

  const gpuSelected = new Map<string, string | null>();


  /** The part card: plain name, the terms people use, what it is, does, and why it matters. */
  function renderPartCard(sceneId: GpuSceneId, plate: Plate): void {
    const host = hostFor(sceneId);
    const vendor = getHardware(hardwareId).vendor as Vendor;
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
    hostFor(scene.id).querySelector('.part-index')!.addEventListener('click', (event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>('[data-select-part]');
      if (!button) return;
      const part = button.dataset.selectPart!;
      gpuViews.get(scene.id)?.select(gpuSelected.get(scene.id) === part ? null : part);
    });
  }

  /** Mounts the drawing for one Act 1 scene. */
  function mountGpuView(sceneId: GpuSceneId): void {
    const host = hostFor(sceneId);
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
    const settings = { ...DEFAULT_SETTINGS, hardwareId: hardwareId };
    const inputs = buildCutawayInputs(settings, getHardware(hardwareId), modelFor(settings));
    const plates: Record<string, Plate> = {
      server: serverPlate(inputs, 'hardware'),
      package: packagePlate(inputs, 'hardware'),
      die: diePlate(inputs, { job: 'decode', detail: 'full', activity: false }),
      unit: unitPlate(hardwareId, 0),
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

  renderGpu();
  return {
    setHardware(next: string): void {
      hardwareId = next;
      renderGpu();
    },
    refresh: (sceneId) => gpuViews.get(sceneId)?.refresh(),
    selectPart: (sceneId, part) => gpuViews.get(sceneId)?.select(part),
  };
}
