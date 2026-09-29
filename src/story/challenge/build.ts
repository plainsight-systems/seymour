import { DEFAULT_SETTINGS, getHardware } from '../../data/profiles';
import { requirePartEntry } from '../../data/parts';
import { modelFor } from '../../model/strategy';
import { buildCutawayInputs } from '../cutaway/inputs';
import { diePlate, packagePlate, type Plate } from '../cutaway/plates';
import { mountCutaway, type CutawayView } from '../cutaway/render';
import { escapeHtml, keepFocus } from '../html';
import { assemblyPlate, assemblyRound, isComplete, isOpenZone, place, zoneNumber, type AssemblyRound, type PlacementResult, type RoundId } from './assembly';

// The Act 1 challenge UI: put the GPU back together by dragging parts onto
// their outlines (or picking a part and a zone). Placement rules live in
// assembly.ts; this module draws the plate, tray, feedback, and finish.

export interface BuildChallengeView {
  /** Rebuilds both rounds for another chip; progress starts over. */
  setHardware(hardwareId: string): void;
  /** Re-measures the drawing after the scene becomes visible. */
  refresh(): void;
}

export function mountBuildChallenge(buildHost: HTMLElement, initialHardwareId: string): BuildChallengeView {
  let hardwareId = initialHardwareId;
  buildHost.innerHTML = `<div class="gpu-scene build-scene">
    <p class="gpu-scene-lead">Put the GPU back together. Drag each part from the tray onto its outline, or pick a part and then click an outline or its zone marker.</p>
    <div class="build-bar">
      <div class="build-rounds" role="group" aria-label="Round"><button type="button" data-round="package" aria-pressed="true">Round 1 · The package</button><button type="button" data-round="die" aria-pressed="false">Round 2 · The die</button></div>
      <div class="build-toast is-empty" data-build-feedback role="status" aria-live="polite"></div>
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
  /** The pending "round complete" card; cancelled whenever the card is hidden (round switch, reset, chip change). */
  let doneTimer = 0;
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function buildSourcePlate(roundId: RoundId = buildRoundId): Plate {
    const settings = { ...DEFAULT_SETTINGS, hardwareId };
    const inputs = buildCutawayInputs(settings, getHardware(hardwareId), modelFor(settings));
    return roundId === 'package' ? packagePlate(inputs, 'hardware') : diePlate(inputs, { job: 'decode', detail: 'full', activity: false });
  }

  /** Both rounds' parts on the current chip, to tell whether a chip change keeps progress valid. */
  function roundParts(): string {
    return (['package', 'die'] as const).map((id) => assemblyRound(id, buildSourcePlate(id)).parts.join(',')).join('|');
  }

  /** A message just above the drawing, where the reader is looking. Misses stay until the next move. */
  function buildFeedback(html: string, tone: 'neutral' | 'good' | 'bad' = 'neutral'): void {
    const node = buildHost.querySelector<HTMLElement>('[data-build-feedback]')!;
    window.clearTimeout(toastTimer);
    // The status line stays in the page (a live region that is unhidden with its message is often
    // not announced); an empty one is simply invisible.
    node.classList.toggle('is-empty', html === '');
    node.dataset.tone = tone;
    node.innerHTML = html;
    node.classList.remove('is-new');
    void node.offsetWidth;
    node.classList.add('is-new');
    if (html && tone !== 'bad') toastTimer = window.setTimeout(() => { node.innerHTML = ''; node.classList.add('is-empty'); }, 6000);
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
    window.clearTimeout(doneTimer);
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
    node.innerHTML = `<div class="build-done-card" role="region" aria-labelledby="build-done-title">
      <p class="build-done-kicker">Round ${title.number} of 2 complete${both ? ' · GPU rebuilt' : ''}</p>
      <h3 id="build-done-title">${both && buildRoundId === 'die' ? 'You rebuilt the GPU' : title.done}</h3>
      <p class="build-done-score"><b>${buildRound.parts.length} of ${buildRound.parts.length}</b> parts placed · ${verdict}</p>
      <div class="build-done-actions">${next}<button type="button" class="build-look" data-build-look>Look at it</button><button type="button" class="build-reset" data-build-reset>Play again</button></div>
    </div>`;
    node.hidden = false;
    node.querySelector<HTMLElement>('.build-next')?.focus({ preventScroll: true });
  }

  /** Redraws the plate and tray, keeping keyboard focus on the same card or zone marker. */
  function renderBuild(): void {
    keepFocus(buildHost, drawBuild);
  }

  function drawBuild(): void {
    const vendor = getHardware(hardwareId).vendor;
    const source = buildSourcePlate();
    buildRound = assemblyRound(buildRoundId, source);
    const placed = buildPlaced[buildRoundId];
    const plate = assemblyPlate(source, buildRound, placed);
    dropTarget = null;
    if (buildView) buildView.update(plate);
    else buildView = mountCutaway(buildHost.querySelector<HTMLElement>('[data-build-plate]')!, plate, 'Build the GPU', { labels: 'markers', onSelect: (part) => { if (part) chooseZone(part); } });
    // The tray is sorted by name, so its order never reveals the zone numbers.
    const cards = buildRound.parts
      .map((part) => ({ part, entry: requirePartEntry(part, vendor) }))
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
    const vendor = getHardware(hardwareId).vendor;
    const placed = buildPlaced[buildRoundId];
    const result = place(buildRound, placed, card, zone);
    const cardEntry = requirePartEntry(card, vendor);
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
      doneTimer = window.setTimeout(showDone, buildRound.parts.length * step + (step ? 350 : 0));
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

  /** Set after a real drag, so the click that follows the drop does not also pick the card. */
  let suppressCardClick = false;

  buildHost.addEventListener('click', (event) => {
    const target = event.target as Element;
    // Picking a card is a plain click (Enter and Space on a button are clicks too), which is also
    // what screen readers send; pointer events only handle dragging.
    const card = target.closest<HTMLButtonElement>('[data-card]');
    if (card) {
      // Keyboard clicks (detail 0) are never the tail of a drag.
      if (suppressCardClick && event.detail !== 0) { suppressCardClick = false; return; }
      buildCard = buildCard === card.dataset.card ? null : card.dataset.card!;
      renderBuild();
      buildFeedback(buildCard ? 'Now drop it on its outline, or choose its zone marker (click it, or Tab to it and press Enter).' : '');
      return;
    }
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
    // A new press starts fresh, in case the browser sent no click after the last drag.
    suppressCardClick = false;
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
    // No drag happened: the click that follows picks the card.
    if (!ghost) return;
    suppressCardClick = true;
    const zone = drop ? document.elementFromPoint(event.clientX, event.clientY)?.closest<SVGElement>('[data-build-plate] [data-part]')?.dataset.part : undefined;
    const result = zone && buildRound.parts.includes(zone) ? tryPlace(card, zone) : null;
    if (result === 'correct') ghost.remove();
    else sendHome(ghost, buildHost.querySelector<HTMLButtonElement>(`[data-card="${card}"]`));
  }
  buildHost.addEventListener('pointerup', (event) => endDrag(event, true));
  buildHost.addEventListener('pointercancel', (event) => endDrag(event, false));

  renderBuild();
  return {
    setHardware(next: string): void {
      const before = roundParts();
      hardwareId = next;
      if (roundParts() === before) { renderBuild(); return; }
      resetBuild(['package', 'die']);
      buildFeedback('This chip is built from different parts, so both rounds start over.');
    },
    refresh(): void {
      buildView?.refresh();
    },
  };
}
