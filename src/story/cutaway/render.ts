import './cutaway.css';
import type { Plate } from './plates';
import { project } from './project';
import type { Scene, SceneBox, SceneLabel, Vec3 } from './scene';

// DOM renderer for cutaway plates. No model math lives here: it draws a Plate
// and manages which part is selected. Clicking a part or its label selects
// the part; everything sharing that part lights up.

const NS = 'http://www.w3.org/2000/svg';
/**
 * Side callouts are used only when the drawing keeps at least this share of
 * the container width; otherwise labels become numbered markers plus a list.
 */
const MIN_DRAWING_SHARE = 0.6;

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  parent?.appendChild(node);
  return node;
}

const points = (list: Vec3[]) => list.map((p) => project(p).map((v) => v.toFixed(1)).join(',')).join(' ');
const topCenter = (box: SceneBox): Vec3 => [box.x + box.w / 2, box.y + box.d / 2, box.z + box.h];
const fillVar = (fill: string) => `var(--cw-${fill.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)})`;

function drawGeometry(svg: SVGSVGElement, scene: Scene): { root: SVGGElement; labelsLayer: SVGGElement; bounds: { minX: number; maxX: number; maxY: number } } {
  const byId = new Map(scene.boxes.map((box) => [box.id, box]));
  const ordered = [...scene.boxes].sort((a, b) => (a.layer - b.layer)
    || ((a.x + a.w / 2 + a.y + a.d / 2) - (b.x + b.w / 2 + b.y + b.d / 2))
    || (a.z - b.z));
  const root = el('g', {}, svg);
  const guides = el('g', {}, root);
  const boxes = el('g', {}, root);
  const links = el('g', {}, root);
  const labelsLayer = el('g', {}, root);
  const bounds = { minX: Infinity, maxX: -Infinity, maxY: -Infinity };
  const grow = ([x, y]: [number, number]) => {
    bounds.minX = Math.min(bounds.minX, x);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.maxY = Math.max(bounds.maxY, y);
  };

  for (const guide of scene.guides) el('polyline', { class: 'cw-guide', points: points(guide) }, guides);

  let wiresDrawn = false;
  for (const box of ordered) {
    if (!wiresDrawn && box.layer > 1) {
      for (const wire of scene.wires) el('polyline', { class: 'cw-wire', points: points(wire) }, boxes);
      wiresDrawn = true;
    }
    const { x, y, z, w, d, h } = box;
    const t = z + h;
    const g = el('g', { class: `cw-box${box.ghost ? ' cw-ghost' : ''}` }, boxes);
    if (box.part) g.dataset.part = box.part;
    const top: Vec3[] = [[x, y, t], [x + w, y, t], [x + w, y + d, t], [x, y + d, t]];
    const left: Vec3[] = [[x, y + d, t], [x + w, y + d, t], [x + w, y + d, z], [x, y + d, z]];
    const right: Vec3[] = [[x + w, y, t], [x + w, y + d, t], [x + w, y + d, z], [x + w, y, z]];
    const fill = fillVar(box.fill);
    el('polygon', { class: 'cw-face cw-face-left', points: points(left), style: `--cw-fill:${fill}` }, g);
    el('polygon', { class: 'cw-face cw-face-right', points: points(right), style: `--cw-fill:${fill}` }, g);
    el('polygon', { class: 'cw-face cw-face-top', points: points(top), style: `--cw-fill:${fill}` }, g);
    for (const p of [...top, ...left, ...right]) grow(project(p));
  }

  for (const link of scene.links) {
    const from = byId.get(link.from);
    const to = byId.get(link.to);
    if (!from || !to) throw new Error(`Link references a missing box: ${link.from} → ${link.to}`);
    const a = topCenter(from);
    const c = topCenter(to);
    const path: Vec3[] = [a, [c[0], a[1], a[2]], c];
    const width = Math.max(1.5, 0.42 * Math.sqrt(link.bytesPerSecond / 1e9));
    el('polyline', { class: 'cw-link-halo', points: points(path), 'stroke-width': width + 3 }, links);
    const line = el('polyline', { class: `cw-link cw-link-${link.basis}${link.dashed ? ' cw-link-dashed' : ''}`, points: points(path), 'stroke-width': width }, links);
    line.dataset.paths = link.paths.join(' ');
  }
  return { root, labelsLayer, bounds };
}

function wideCallouts(layer: SVGGElement, scene: Scene, bounds: { minX: number; maxX: number; maxY: number }, k: number): void {
  const byId = new Map(scene.boxes.map((box) => [box.id, box]));
  const gap = 46 * k;
  const offset = 30 * k;
  for (const side of ['left', 'right'] as const) {
    const items = scene.labels
      .filter((label) => label.side === side && byId.has(label.anchor))
      .map((label) => ({ label, anchor: project(label.at ?? topCenter(byId.get(label.anchor)!)), y: 0 }))
      .sort((a, b) => a.anchor[1] - b.anchor[1]);
    let last = -Infinity;
    for (const item of items) { item.y = Math.max(item.anchor[1], last + gap); last = item.y; }
    const overshoot = last - bounds.maxY;
    if (overshoot > 0) for (const item of items) item.y -= overshoot;
    const column = side === 'left' ? bounds.minX - offset : bounds.maxX + offset;
    for (const { label, anchor, y } of items) {
      const g = callout(layer, label);
      const bend = side === 'left' ? column + 18 * k : column - 18 * k;
      el('polyline', { class: 'cw-leader', points: `${anchor[0]},${anchor[1]} ${bend},${y} ${column},${y}` }, g);
      el('circle', { class: 'cw-dot', cx: anchor[0], cy: anchor[1], r: 3.2 * k }, g);
      const mark = 9 * k;
      const markX = side === 'left' ? column - 6 * k - mark : column + 6 * k;
      el('rect', { class: `cw-basis cw-basis-${label.basis}`, x: markX, y: y - mark, width: mark, height: mark }, g);
      const textX = side === 'left' ? markX - 6 * k : markX + mark + 6 * k;
      const anchorAttr = side === 'left' ? 'end' : 'start';
      el('text', { class: 'cw-label-title', x: textX, y, 'text-anchor': anchorAttr }, g).textContent = label.title;
      el('text', { class: 'cw-label-detail', x: textX, y: y + 18 * k, 'text-anchor': anchorAttr }, g).textContent = label.detail;
      const box = g.getBBox();
      g.insertBefore(el('rect', { class: 'cw-hit', x: box.x - 4, y: box.y - 4, width: box.width + 8, height: box.height + 8 }), g.firstChild);
    }
  }
}

function narrowMarkers(layer: SVGGElement, scene: Scene, k: number): void {
  const byId = new Map(scene.boxes.map((box) => [box.id, box]));
  const r = 11 * k;
  const placed: [number, number][] = [];
  const collides = (x: number, y: number) => placed.some(([px, py]) => Math.hypot(px - x, py - y) < 2.2 * r);
  scene.labels.forEach((label, index) => {
    const box = byId.get(label.anchor);
    if (!box) return;
    const [ax, ay] = project(label.at ?? topCenter(box));
    // Step markers that would overlap sideways, keeping a leader to the anchor.
    let x = ax;
    for (let step = 1; collides(x, ay) && step < 12; step++) x = ax - step * 2.4 * r;
    placed.push([x, ay]);
    const g = callout(layer, label);
    if (x !== ax) {
      el('polyline', { class: 'cw-leader', points: `${ax},${ay} ${x},${ay}` }, g);
      el('circle', { class: 'cw-dot', cx: ax, cy: ay, r: 3 * k }, g);
    }
    el('circle', { class: 'cw-marker', cx: x, cy: ay, r }, g);
    el('text', { class: 'cw-marker-text', x, y: ay + 4.5 * k, 'text-anchor': 'middle' }, g).textContent = String(index + 1);
  });
}

function callout(layer: SVGGElement, label: SceneLabel): SVGGElement {
  const g = el('g', { class: 'cw-callout', tabindex: 0, role: 'button', 'aria-label': `${label.title}: ${label.detail}` }, layer);
  g.dataset.part = label.part;
  return g;
}

export interface CutawayView {
  update(plate: Plate): void;
  /** Selects a part (or clears with null), exactly as a click would. */
  select(part: string | null): void;
  destroy(): void;
}

export interface CutawayOptions {
  /**
   * `auto`: leader-line callouts beside the drawing, or numbered markers plus
   * a list on narrow containers. `chips`: labels as a row of buttons under
   * the drawing, so side-by-side plates keep identical geometry and scale.
   */
  labels?: 'auto' | 'chips';
  /** Called whenever the reader's picked part changes. */
  onSelect?: (part: string | null) => void;
}

export function mountCutaway(host: HTMLElement, initial: Plate, ariaLabel: string, options: CutawayOptions = {}): CutawayView {
  const chips = options.labels === 'chips';
  let plate = initial;
  let picked: string | null = null;
  let scale = 1;
  host.classList.add('cw-root');
  host.innerHTML = '';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'cw-svg');
  svg.setAttribute('role', 'group');
  svg.setAttribute('aria-label', ariaLabel);
  host.appendChild(svg);
  const list = document.createElement('ol');
  list.className = chips ? 'cw-chips' : 'cw-list';
  host.appendChild(list);

  let markers = false;

  /** Draws the plate; returns the share of the view box the geometry occupies. */
  function draw(k: number, useMarkers: boolean): number {
    svg.textContent = '';
    svg.style.setProperty('--cw-k', String(k));
    const { root, labelsLayer, bounds } = drawGeometry(svg, plate.scene);
    if (chips) { /* labels live in the chip row */ }
    else if (useMarkers) narrowMarkers(labelsLayer, plate.scene, k);
    else wideCallouts(labelsLayer, plate.scene, bounds, k);
    const pad = 20 * k;
    const box = root.getBBox();
    svg.setAttribute('viewBox', `${(box.x - pad).toFixed(0)} ${(box.y - pad).toFixed(0)} ${(box.width + 2 * pad).toFixed(0)} ${(box.height + 2 * pad).toFixed(0)}`);
    return (bounds.maxX - bounds.minX) / (box.width + 2 * pad);
  }

  /** Re-render until label text lands at its CSS pixel size on screen (1 SVG unit = 1 px). */
  function fit(useMarkers: boolean): number {
    let k = scale;
    let share = 1;
    for (let i = 0; i < 4; i++) {
      share = draw(k, useMarkers);
      const next = svg.viewBox.baseVal.width / Math.max(1, svg.clientWidth);
      if (Math.abs(next - k) / k < 0.03) break;
      k = Math.min(6, Math.max(0.5, next));
    }
    scale = k;
    return share;
  }

  function render(): void {
    if (host.clientWidth === 0) return;
    markers = false;
    const share = fit(false);
    if (!chips && share < MIN_DRAWING_SHARE) {
      markers = true;
      fit(true);
    }
    renderList();
    applySelection();
  }

  function renderList(): void {
    list.hidden = !chips && !markers;
    if (list.hidden) { list.innerHTML = ''; return; }
    list.innerHTML = plate.scene.labels.map((label, index) => `<li><button type="button" data-part="${label.part}" aria-pressed="false">${chips ? '' : `<span class="cw-list-no">${index + 1}</span>`}<span class="cw-basis-swatch cw-basis-${label.basis}" aria-hidden="true"></span><span><b>${label.title}</b><small>${label.detail}</small></span></button></li>`).join('');
  }

  function applySelection(): void {
    const parts = new Set(picked ? [picked] : plate.defaultSelection);
    svg.classList.toggle('cw-has-selection', parts.size > 0);
    for (const node of host.querySelectorAll<HTMLElement | SVGElement>('[data-part]')) {
      const on = parts.has(node.dataset.part!);
      node.classList.toggle('cw-selected', on);
      if (node.classList.contains('cw-callout') || node.tagName === 'BUTTON') node.setAttribute('aria-pressed', String(on));
    }
    const lit = picked ? null : plate.litPath;
    for (const link of svg.querySelectorAll<SVGElement>('.cw-link')) {
      link.classList.toggle('cw-lit', lit !== null && link.dataset.paths!.split(' ').includes(lit));
    }
  }

  function pick(part: string | undefined): void {
    const labeled = part !== undefined && plate.scene.labels.some((label) => label.part === part);
    picked = labeled && picked !== part ? part! : null;
    applySelection();
    options.onSelect?.(picked);
  }

  const onClick = (event: Event) => {
    const target = (event.target as Element).closest<HTMLElement | SVGElement>('[data-part]');
    pick(target?.dataset.part);
  };
  const onKey = (event: KeyboardEvent) => {
    const target = event.target as Element;
    if ((event.key === 'Enter' || event.key === ' ') && target.classList.contains('cw-callout')) {
      event.preventDefault();
      pick((target as SVGElement).dataset.part);
    }
    if (event.key === 'Escape') { picked = null; applySelection(); }
  };
  host.addEventListener('click', onClick);
  host.addEventListener('keydown', onKey);
  let lastWidth = host.clientWidth;
  const observer = new ResizeObserver(() => {
    if (host.clientWidth === lastWidth) return;
    lastWidth = host.clientWidth;
    render();
  });
  observer.observe(host);
  render();

  return {
    update(next: Plate): void {
      plate = next;
      if (picked && !plate.scene.labels.some((label) => label.part === picked)) {
        picked = null;
        options.onSelect?.(null);
      }
      render();
    },
    select(part: string | null): void {
      picked = part && plate.scene.labels.some((label) => label.part === part) ? part : null;
      applySelection();
      options.onSelect?.(picked);
    },
    destroy(): void {
      observer.disconnect();
      host.removeEventListener('click', onClick);
      host.removeEventListener('keydown', onKey);
      host.innerHTML = '';
    },
  };
}

