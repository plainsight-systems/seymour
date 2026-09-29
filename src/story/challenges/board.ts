import { getHardware } from '../../data/profiles';
import { calculateSimulation, formatDuration, formatNumber } from '../../model/calculate';
import { modelFor } from '../../model/strategy';
import type { KvPlacement, SimulationSettings } from '../../types';
import { finishSchedule, placeCard, playFinale, prefersReducedMotion, quizBar, quizCard, quizFrame } from '../quiz/quiz';
import { challengesFor } from './data';
import { KNOB_VALUES, evaluateChallenge, type Challenge, type ConstraintMetric, type ConstraintResult, type KnobId } from './engine';
import { escapeHtml, keepFocus } from '../html';
import { placementOptions } from '../placement';

// Act 4 challenges: each fixes a workload and some targets; the reader moves
// only the knobs the challenge allows until every target is met. Progress,
// navigation, and the finale share the quiz bar and card from Acts 2 and 3.

export interface ChallengeBoardView {
  /** Rebuilds every challenge for the chip picked above; progress starts over, since targets change. */
  setHardware(hardwareId: string): void;
  /** The chip the challenge on screen runs on. */
  currentChip(): string;
  /** Whether that chip is chosen inside the challenge (a knob) rather than fixed by it. */
  chipIsAKnob(): boolean;
}

const METRIC_LABEL: Record<ConstraintMetric, string> = {
  msPerToken: 'Time per token for each user',
  timeToFirstTokenMs: 'Time to the first token',
  totalTokensPerSec: 'Tokens per second, all users',
  fitsInGpuMemory: 'Weights and KV fit in GPU memory',
  restoreBeatsRecompute: 'Bringing an idle session back beats rebuilding it',
  concurrentUsers: 'Users served at once',
  weightBits: 'Weight precision (quality rule)',
  kvBits: 'KV cache precision (quality rule)',
};

/** Where the story teaches the fix for each target. Quality rules are requirements, not puzzles, so they have none. */
const METRIC_HINT: Record<ConstraintMetric, { scene: string; label: string } | null> = {
  concurrentUsers: { scene: 'act-3/share-read', label: 'Share the read' },
  weightBits: null,
  kvBits: null,
  msPerToken: { scene: 'act-3/read-model', label: 'Every token re-reads the model' },
  timeToFirstTokenMs: { scene: 'act-2/first-vs-later', label: 'First pass vs. every pass after' },
  totalTokensPerSec: { scene: 'act-3/share-read', label: 'Share the read' },
  fitsInGpuMemory: { scene: 'act-3/memory-wall', label: 'Memory fills up' },
  restoreBeatsRecompute: { scene: 'act-3/distance', label: 'Distance is speed' },
};

const KNOB_LABEL: Record<KnobId, string> = {
  batch: 'Users per pass', weightBits: 'Weight precision', mathBits: 'Math precision', kvBits: 'KV cache precision',
  reusePromptPrefixes: 'Reuse a shared prompt', speculativeTokens: 'Guess tokens ahead', kvPlacement: 'Active KV lives in',
  idleKvPlacement: 'Idle sessions wait in', hardwareId: 'Accelerator',
};

const bits = (value: number) => `${value}-bit`;


function valueText(metric: ConstraintMetric, value: number | boolean): string {
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (metric === 'concurrentUsers') return value.toLocaleString();
  if (metric === 'weightBits' || metric === 'kvBits') return `${value}-bit`;
  if (metric === 'totalTokensPerSec') return `${formatNumber(value)} tok/s`;
  return formatDuration(value);
}

function targetText(result: ConstraintResult): string {
  const { metric, op, value } = result.constraint;
  if (typeof value === 'boolean') return value ? 'must be yes' : 'must be no';
  if (op === '==') return `must be ${valueText(metric, value)}`;
  return `${op === '<=' ? 'at most' : 'at least'} ${valueText(metric, value)}`;
}

/** How far toward the target, 0–1: the meter's fill. */
function progress(result: ConstraintResult): number {
  const { op, value } = result.constraint;
  if (typeof value === 'boolean' || op === '==') return result.met ? 1 : 0;
  const actual = Number(result.actual);
  const fill = op === '<=' ? Number(value) / Math.max(actual, Number.EPSILON) : actual / Number(value);
  return Math.max(0.02, Math.min(1, fill));
}

/** The fixed facts of the challenge's workload, so every throttle's effect can be reasoned about. */
function workloadFacts(challenge: Challenge, settings: SimulationSettings): string {
  const facts = [
    escapeHtml(modelFor(settings).shortName),
    `${settings.sequenceLength.toLocaleString()}-token context`,
    settings.prefixCachePercent ? `${settings.prefixCachePercent}% of each prompt shared` : 'nothing shared between prompts',
    `${Math.round(settings.draftAcceptanceRate * 100)}% of guesses land`,
  ];
  if (!challenge.adjustable.includes('hardwareId')) facts.unshift(escapeHtml(getHardware(settings.hardwareId).name));
  return facts.map((fact) => `<span>${fact}</span>`).join('');
}

function segmented(knob: KnobId, options: [string, string][], current: string, disabled = false): string {
  return `<span class="view-toggle ch-seg" role="group" aria-label="${escapeHtml(KNOB_LABEL[knob])}">${options.map(([value, label]) => `<button type="button" data-ch-knob="${knob}" data-value="${value}" aria-pressed="${value === current}" ${disabled ? 'disabled' : ''}>${escapeHtml(label)}</button>`).join('')}</span>`;
}

function knobControl(knob: KnobId, settings: SimulationSettings, challenge: Challenge): string {
  const label = `<span class="ch-knob-label">${escapeHtml(KNOB_LABEL[knob])}</span>`;
  // Segmented choices are built from KNOB_VALUES, the same values the tests search.
  const choices = <K extends KnobId>(key: K, text: (value: SimulationSettings[K]) => string, disabled = false) =>
    `<div class="ch-knob">${label}${segmented(key, KNOB_VALUES[key].map((value) => [String(value), text(value)]), String(settings[key]), disabled)}</div>`;
  switch (knob) {
    case 'batch': {
      const position = KNOB_VALUES.batch.indexOf(settings.batch);
      if (position < 0) throw new Error(`Users per pass ${settings.batch} is not a step of the slider`);
      return `<label class="ch-knob">${label}<output>${settings.batch.toLocaleString()}</output><input type="range" data-ch-knob="batch" min="0" max="${KNOB_VALUES.batch.length - 1}" step="1" value="${position}" aria-label="${escapeHtml(KNOB_LABEL.batch)}"></label>`;
    }
    case 'weightBits': return choices('weightBits', bits);
    case 'kvBits': return choices('kvBits', bits);
    case 'mathBits': return choices('mathBits', (value) => (value === 8 ? '8-bit (needs 8- or 4-bit weights)' : bits(value)), settings.weightBits === 16);
    case 'speculativeTokens': return choices('speculativeTokens', (value) => (value === 0 ? 'Off' : `${value} ahead`));
    case 'reusePromptPrefixes': return choices('reusePromptPrefixes', (value) => (!value ? 'Off' : settings.prefixCachePercent ? `On (${settings.prefixCachePercent}% shared)` : 'On (nothing shared)'));
    case 'kvPlacement': return `<label class="ch-knob">${label}<select data-ch-knob="kvPlacement" aria-label="${escapeHtml(KNOB_LABEL.kvPlacement)}">${placementOptions(KNOB_VALUES.kvPlacement, settings.kvPlacement)}</select></label>`;
    case 'idleKvPlacement': {
      // Only a challenge that asks about bringing sessions back has idle sessions; elsewhere the control would do nothing.
      const matters = challenge.constraints.some((constraint) => constraint.metric === 'restoreBeatsRecompute');
      return `<label class="ch-knob">${label}${matters ? '' : '<output>no idle sessions here</output>'}<select data-ch-knob="idleKvPlacement" aria-label="${escapeHtml(KNOB_LABEL.idleKvPlacement)}" ${matters ? '' : 'disabled'}>${placementOptions(KNOB_VALUES.idleKvPlacement, settings.idleKvPlacement)}</select></label>`;
    }
    case 'hardwareId': return choices('hardwareId', (id) => getHardware(id).name.replace(' SXM', ''));
  }
}

/** Applies one control's new value to the settings, as the controls allow it. */
function applyKnob(settings: SimulationSettings, knob: KnobId, raw: string): SimulationSettings {
  const next = { ...settings };
  switch (knob) {
    case 'batch': next.batch = KNOB_VALUES.batch[Number(raw)]!; break;
    case 'weightBits': next.weightBits = Number(raw) as SimulationSettings['weightBits']; if (next.weightBits === 16) next.mathBits = 16; break;
    case 'kvBits': next.kvBits = Number(raw) as SimulationSettings['kvBits']; break;
    case 'mathBits': next.mathBits = Number(raw) as SimulationSettings['mathBits']; break;
    case 'speculativeTokens': next.speculativeTokens = Number(raw) as SimulationSettings['speculativeTokens']; break;
    case 'reusePromptPrefixes': next.reusePromptPrefixes = raw === 'true'; break;
    case 'kvPlacement': next.kvPlacement = raw as KvPlacement; break;
    case 'idleKvPlacement': next.idleKvPlacement = raw as KvPlacement; break;
    case 'hardwareId': next.hardwareId = raw; break;
  }
  return next;
}

export function mountChallengeBoard(host: HTMLElement, hardwareId: string, openScene: (target: string) => void, onChipChange: () => void): ChallengeBoardView {
  let index = 0;
  /** Built for the chip picked above: workloads and targets come from its numbers. */
  let challenges = challengesFor(hardwareId);
  const attempts = new Map<string, SimulationSettings>(challenges.map((challenge) => [challenge.id, { ...challenge.naive }]));
  /** Challenges cleared at least once. A cleared challenge stays cleared. */
  const cleared = new Set<string>();
  /** The challenge whose "cleared" moment should animate on the next render. */
  let justCleared: string | null = null;
  let showCard = false;
  let celebrate = false;
  const finish = finishSchedule();
  /** Set when the last item is done; the finale plays once, the next time the results card opens. */
  let finaleOwed = false;

  const current = (): Challenge => challenges[index]!;

  /** The key numbers the targets do not already show, so nothing is said twice. */
  function numbers(challenge: Challenge, settings: SimulationSettings): string {
    const hardware = getHardware(settings.hardwareId);
    const model = modelFor(settings);
    // The same calculations, and the same names, as the targets.
    const decode = calculateSimulation({ ...settings, phase: 'decode' }, hardware, model);
    const prefill = calculateSimulation({ ...settings, phase: 'prefill' }, hardware, model);
    const targeted = new Set(challenge.constraints.map((constraint) => constraint.metric));
    const cells: [ConstraintMetric, string][] = [
      ['timeToFirstTokenMs', formatDuration(prefill.totalMs)],
      ['msPerToken', formatDuration(decode.msPerToken)],
      ['totalTokensPerSec', `${formatNumber(decode.tokenRate)} tok/s`],
    ];
    const shown = cells.filter(([metric]) => !targeted.has(metric));
    if (shown.length === 0) return '';
    return `<p class="quiz-chart-title">Also</p><div class="ch-numbers" aria-label="Other key numbers">${shown.map(([metric, value]) => `<p><span>${METRIC_LABEL[metric]}</span><strong>${value}</strong></p>`).join('')}</div>`;
  }

  function barHtml(): string {
    const done = cleared.size === challenges.length;
    return quizBar({
      items: challenges, index, itemNoun: 'Challenge', doneWord: 'cleared', rightWord: 'cleared',
      states: challenges.map((item) => (cleared.has(item.id) ? 'right' : 'open')),
      right: cleared.size, answered: cleared.size, total: challenges.length,
      offerResults: done && !showCard,
      canReset: cleared.size > 0 || challenges.some((item) => JSON.stringify(attempts.get(item.id)) !== JSON.stringify(item.naive)),
    });
  }

  function answerHtml(): string {
    const challenge = current();
    const settings = attempts.get(challenge.id)!;
    const evaluation = evaluateChallenge(challenge, settings);
    const done = cleared.size === challenges.length;
    const nextOpen = challenges.findIndex((other, i) => i !== index && !cleared.has(other.id));
    const meters = evaluation.results.map((result) => {
      const hint = METRIC_HINT[result.constraint.metric];
      const pct = Math.round(progress(result) * 100);
      // A yes/no target or a quality rule is met or not: it gets no progress bar.
      const rule = typeof result.constraint.value === 'boolean' || result.constraint.op === '==';
      return `<li class="ch-meter" data-met="${result.met}">
        <p class="ch-meter-head"><span class="ch-meter-mark" aria-hidden="true">${result.met ? '✓' : '✗'}</span><b>${METRIC_LABEL[result.constraint.metric]}</b><strong>${valueText(result.constraint.metric, result.actual)}</strong></p>
        ${rule ? '' : `<span class="ch-meter-bar" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="${escapeHtml(METRIC_LABEL[result.constraint.metric])}: ${pct}% of the way to the target"><i style="width:${pct}%"></i></span>`}
        <small>Target: ${targetText(result)}${result.met || !hint ? '' : ` · <button type="button" class="ch-hint" data-ch-open="${hint.scene}">Stuck? ${escapeHtml(hint.label)} ↑</button>`}</small>
      </li>`;
    }).join('');
    const success = evaluation.passed
      ? `<div class="ch-success${justCleared === challenge.id && !prefersReducedMotion() ? ' is-new' : ''}"><p class="ch-success-stamp">Cleared</p><p>${escapeHtml(challenge.lesson)}</p>${nextOpen >= 0 && !done ? `<button type="button" class="build-next" data-quiz-go="${nextOpen}">Next challenge →</button>` : ''}</div>`
      : '';
    return `<p class="quiz-chart-title">Targets</p><ol class="ch-meters">${meters}</ol>${numbers(challenge, settings)}${success}`;
  }

  function knobsHtml(): string {
    const settings = attempts.get(current().id)!;
    return `<p class="ch-knobs-title">Throttles</p><div class="ch-knob-grid">${current().adjustable.map((knob) => knobControl(knob, settings, current())).join('')}</div>`;
  }

  const frame = quizFrame(host);
  let cardWasOpen = false;
  let announceTimer: ReturnType<typeof setTimeout> | undefined;

  /** Tells screen readers how the targets stand; slider drags settle before speaking. */
  function announceProgress(settled: boolean): void {
    clearTimeout(announceTimer);
    const speak = () => {
      const challenge = current();
      const results = evaluateChallenge(challenge, attempts.get(challenge.id)!).results;
      const met = results.filter((result) => result.met).length;
      frame.announce(met === results.length ? `Cleared: ${challenge.title}.` : `${met} of ${results.length} targets met.`);
    };
    if (settled) speak();
    else announceTimer = setTimeout(speak, 600);
  }

  function render(): void {
    keepFocus(frame.body, draw);
    // A results card that just opened takes focus, so keyboard and screen-reader users land on it.
    if (showCard && !cardWasOpen) host.querySelector<HTMLElement>('[data-quiz-card-title]')?.focus({ preventScroll: true });
    cardWasOpen = showCard;
  }

  function draw(): void {
    const challenge = current();
    const hardware = getHardware(attempts.get(challenge.id)!.hardwareId);
    const play = showCard && celebrate && !prefersReducedMotion();
    frame.body.innerHTML = `<div class="quiz-scene ch-scene">
      <div data-ch-bar>${barHtml()}</div>
      <div class="quiz-question">
        <p class="stage-kicker">Challenge ${index + 1} of ${challenges.length} · ${challenge.adjustable.includes('hardwareId') ? 'runs on the chip you pick below' : `runs on ${escapeHtml(hardware.name)}, the chip picked above`}</p>
        <h3>${escapeHtml(challenge.title)}</h3>
        <p class="stage-lead">${escapeHtml(challenge.brief)}</p>
        <p class="quiz-workload">${workloadFacts(challenge, attempts.get(challenge.id)!)}</p>
        <div class="ch-knobs" data-ch-knobs>${knobsHtml()}</div>
        <button type="button" class="quiz-small ch-start-over" data-ch-start-over>Start this challenge over</button>
      </div>
      <div class="quiz-answer ch-answer" data-ch-answer>${answerHtml()}</div>
      ${showCard ? quizCard({ play, right: cleared.size, total: challenges.length, noun: 'challenges cleared', verdict: 'Every constraint met with the model’s own numbers. The playground has every knob at once, on any chip.', next: { href: '#act-4/playground', label: 'Open the playground →' }, reviewLabel: 'Review challenges', titleId: 'ch-done-title' }) : ''}
    </div>`;
    placeCard(host);
    if (play) playFinale(host, finish);
    celebrate = false;
    justCleared = null;
  }

  /** Redraws everything except the knobs, so a slider being dragged is never replaced. */
  function refreshLive(): void {
    host.querySelector('[data-ch-bar]')!.innerHTML = barHtml();
    host.querySelector('[data-ch-answer]')!.innerHTML = answerHtml();
    justCleared = null;
  }

  function update(settings: SimulationSettings, whole: boolean): void {
    const challenge = current();
    const chipChanged = attempts.get(challenge.id)!.hardwareId !== settings.hardwareId;
    attempts.set(challenge.id, settings);
    if (chipChanged) onChipChange();
    if (!cleared.has(challenge.id) && evaluateChallenge(challenge, settings).passed) {
      cleared.add(challenge.id);
      justCleared = challenge.id;
      if (cleared.size === challenges.length) {
        finaleOwed = true;
        finish.after(prefersReducedMotion() ? 0 : 1200, () => { showCard = true; celebrate = finaleOwed; finaleOwed = false; render(); });
      }
    }
    announceProgress(whole);
    if (whole) { render(); return; }
    refreshLive();
  }

  function go(next: number): void {
    finish.cancel();
    showCard = false;
    index = Math.max(0, Math.min(challenges.length - 1, next));
    render();
    // Each challenge has its own chip (fixed, or picked in it), so the header re-syncs on every move.
    onChipChange();
  }

  host.addEventListener('input', (event) => {
    const control = (event.target as Element).closest<HTMLInputElement | HTMLSelectElement>('[data-ch-knob]');
    if (!control) return;
    const knob = control.dataset.chKnob as KnobId;
    const settings = applyKnob(attempts.get(current().id)!, knob, control.value);
    if (control instanceof HTMLInputElement && control.type === 'range') {
      // Keep the slider under the pointer; update only its readout and the results.
      const output = control.closest('.ch-knob')?.querySelector('output');
      if (output) output.textContent = settings.batch.toLocaleString();
      update(settings, false);
      return;
    }
    update(settings, true);
  });
  host.addEventListener('click', (event) => {
    const target = event.target as Element;
    const seg = target.closest<HTMLButtonElement>('button[data-ch-knob]');
    if (seg) { update(applyKnob(attempts.get(current().id)!, seg.dataset.chKnob as KnobId, seg.dataset.value!), true); return; }
    const goTo = target.closest<HTMLButtonElement>('[data-quiz-go]');
    if (goTo) { go(Number(goTo.dataset.quizGo)); return; }
    if (target.closest('[data-quiz-prev]')) { go(index - 1); return; }
    if (target.closest('[data-quiz-next]')) { go(index + 1); return; }
    if (target.closest('[data-quiz-card]')) {
      // Opened before the finale played (early, or after moving away): play it now, once.
      celebrate = finaleOwed;
      finaleOwed = false;
      finish.cancel();
      showCard = true;
      render();
      return;
    }
    if (target.closest('[data-quiz-review]')) { finish.cancel(); showCard = false; render(); return; }
    if (target.closest('[data-ch-start-over]')) { attempts.set(current().id, { ...current().naive }); render(); return; }
    if (target.closest('[data-quiz-restart]')) {
      finish.cancel();
      for (const challenge of challenges) attempts.set(challenge.id, { ...challenge.naive });
      cleared.clear();
      finaleOwed = false;
      showCard = false;
      go(0);
      return;
    }
    const open = target.closest<HTMLButtonElement>('[data-ch-open]');
    if (open) openScene(open.dataset.chOpen!);
  });

  render();
  return {
    setHardware(next: string): void {
      if (next === hardwareId) return;
      hardwareId = next;
      finish.cancel();
      challenges = challengesFor(hardwareId);
      attempts.clear();
      for (const challenge of challenges) attempts.set(challenge.id, { ...challenge.naive });
      cleared.clear();
      finaleOwed = false;
      showCard = false;
      render();
    },
    currentChip: () => attempts.get(current().id)!.hardwareId,
    chipIsAKnob: () => current().adjustable.includes('hardwareId'),
  };
}
