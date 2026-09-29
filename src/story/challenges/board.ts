import { HARDWARE_PROFILES, MODEL_PROFILES, getHardware } from '../../data/profiles';
import { calculateSimulation, formatDuration, formatNumber, responseTiming } from '../../model/calculate';
import { modelFor } from '../../model/strategy';
import type { KvPlacement, SimulationSettings } from '../../types';
import { placeCard, playFinale, prefersReducedMotion, quizBar, quizCard } from '../quiz/quiz';
import { CHALLENGES } from './data';
import { KNOB_VALUES, evaluateChallenge, type Challenge, type ConstraintMetric, type ConstraintResult, type KnobId } from './engine';

// Act 4 challenges: each fixes a workload and some targets; the reader moves
// only the knobs the challenge allows until every target is met. Progress,
// navigation, and the finale share the quiz bar and card from Acts 2 and 3.

export interface ChallengeBoardView {
  /** The chip the challenge on screen runs on. */
  currentChip(): string;
  /** Whether that chip is chosen inside the challenge (a knob) rather than fixed by it. */
  chipIsAKnob(): boolean;
}

const PLACEMENT_LABEL: Record<KvPlacement, string> = {
  hbm: 'GPU memory', host: 'System memory', peer: 'One other GPU', peers: 'Spread across all seven other GPUs', ssd: 'Local solid-state storage', object: 'Network object storage',
};

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
  timeToFirstTokenMs: { scene: 'act-2/two-jobs', label: 'First pass vs. every pass after' },
  totalTokensPerSec: { scene: 'act-3/share-read', label: 'Share the read' },
  fitsInGpuMemory: { scene: 'act-3/memory-wall', label: 'Memory fills up' },
  restoreBeatsRecompute: { scene: 'act-3/distance', label: 'Distance is speed' },
};

const KNOB_LABEL: Record<KnobId, string> = {
  batch: 'Users per pass', sequenceLength: 'Context length', weightBits: 'Weight precision', kvBits: 'KV cache precision',
  reusePromptPrefixes: 'Reuse a shared prompt', prefixCachePercent: 'Share of the prompt already processed', kvPlacement: 'Active KV lives in',
  idleKvPlacement: 'Idle sessions wait in', speculativeTokens: 'Guess tokens ahead', mathBits: 'Math precision', modelId: 'Model', hardwareId: 'Accelerator',
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

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
    escapeHtml(MODEL_PROFILES.find((model) => model.id === settings.modelId)!.name.split(' · ')[0]!),
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

function knobControl(knob: KnobId, settings: SimulationSettings): string {
  const label = `<span class="ch-knob-label">${escapeHtml(KNOB_LABEL[knob])}</span>`;
  switch (knob) {
    case 'batch':
    case 'sequenceLength': {
      const values = KNOB_VALUES[knob] as number[];
      const current = settings[knob];
      return `<label class="ch-knob">${label}<output>${current.toLocaleString()}${knob === 'sequenceLength' ? ' tokens' : ''}</output><input type="range" data-ch-knob="${knob}" min="0" max="${values.length - 1}" step="1" value="${Math.max(0, values.indexOf(current))}" aria-label="${escapeHtml(KNOB_LABEL[knob])}"></label>`;
    }
    case 'weightBits': return `<div class="ch-knob">${label}${segmented(knob, [['16', '16-bit'], ['8', '8-bit'], ['4', '4-bit']], String(settings.weightBits))}</div>`;
    case 'kvBits': return `<div class="ch-knob">${label}${segmented(knob, [['16', '16-bit'], ['8', '8-bit']], String(settings.kvBits))}</div>`;
    case 'mathBits': return `<div class="ch-knob">${label}${segmented(knob, [['16', '16-bit'], ['8', '8-bit (needs 8-bit weights)']], String(settings.mathBits), settings.weightBits === 16)}</div>`;
    case 'speculativeTokens': return `<div class="ch-knob">${label}${segmented(knob, [['0', 'Off'], ['2', '2 ahead'], ['4', '4 ahead']], String(settings.speculativeTokens))}</div>`;
    case 'reusePromptPrefixes': return `<div class="ch-knob">${label}${segmented(knob, [['false', 'Off'], ['true', settings.prefixCachePercent ? `On (${settings.prefixCachePercent}% shared)` : 'On (nothing shared)']], String(settings.reusePromptPrefixes))}</div>`;
    case 'prefixCachePercent': {
      const values = KNOB_VALUES.prefixCachePercent;
      return `<label class="ch-knob">${label}<output>${settings.reusePromptPrefixes ? `${settings.prefixCachePercent}%` : 'reuse is off'}</output><input type="range" data-ch-knob="prefixCachePercent" min="0" max="${values.length - 1}" step="1" value="${Math.max(0, values.indexOf(settings.prefixCachePercent))}" ${settings.reusePromptPrefixes ? '' : 'disabled'} aria-label="${escapeHtml(KNOB_LABEL[knob])}"></label>`;
    }
    case 'kvPlacement':
    case 'idleKvPlacement': return `<label class="ch-knob">${label}<select data-ch-knob="${knob}" aria-label="${escapeHtml(KNOB_LABEL[knob])}">${(KNOB_VALUES[knob] as KvPlacement[]).map((tier) => `<option value="${tier}" ${tier === settings[knob] ? 'selected' : ''}>${PLACEMENT_LABEL[tier]}</option>`).join('')}</select></label>`;
    case 'modelId': return `<label class="ch-knob">${label}<select data-ch-knob="modelId" aria-label="Model">${MODEL_PROFILES.map((model) => `<option value="${model.id}" ${model.id === settings.modelId ? 'selected' : ''}>${escapeHtml(model.name.split(' · ')[0]!)}</option>`).join('')}</select></label>`;
    case 'hardwareId': return `<div class="ch-knob">${label}${segmented(knob, HARDWARE_PROFILES.map((hardware) => [hardware.id, hardware.name.replace(' SXM', '')]), settings.hardwareId)}</div>`;
  }
}

/** Applies one control's new value to the settings, as the controls allow it. */
function applyKnob(settings: SimulationSettings, knob: KnobId, raw: string): SimulationSettings {
  const next = { ...settings };
  switch (knob) {
    case 'batch': next.batch = KNOB_VALUES.batch[Number(raw)]!; break;
    case 'sequenceLength': next.sequenceLength = KNOB_VALUES.sequenceLength[Number(raw)]!; break;
    case 'prefixCachePercent': next.prefixCachePercent = KNOB_VALUES.prefixCachePercent[Number(raw)]!; break;
    case 'weightBits': next.weightBits = Number(raw) as SimulationSettings['weightBits']; if (next.weightBits === 16) next.mathBits = 16; break;
    case 'kvBits': next.kvBits = Number(raw) as SimulationSettings['kvBits']; break;
    case 'mathBits': next.mathBits = Number(raw) as SimulationSettings['mathBits']; break;
    case 'speculativeTokens': next.speculativeTokens = Number(raw) as SimulationSettings['speculativeTokens']; break;
    case 'reusePromptPrefixes': next.reusePromptPrefixes = raw === 'true'; break;
    case 'kvPlacement': next.kvPlacement = raw as KvPlacement; break;
    case 'idleKvPlacement': next.idleKvPlacement = raw as KvPlacement; break;
    case 'modelId': next.modelId = raw; break;
    case 'hardwareId': next.hardwareId = raw; break;
  }
  return next;
}

export function mountChallengeBoard(host: HTMLElement, openScene: (target: string) => void, onChipChange: () => void): ChallengeBoardView {
  let index = 0;
  const attempts = new Map<string, SimulationSettings>(CHALLENGES.map((challenge) => [challenge.id, { ...challenge.naive }]));
  /** Challenges cleared at least once. A cleared challenge stays cleared. */
  const cleared = new Set<string>();
  /** The challenge whose "cleared" moment should animate on the next render. */
  let justCleared: string | null = null;
  let showCard = false;
  let celebrate = false;
  let finishTimer = 0;

  const current = (): Challenge => CHALLENGES[index]!;

  /** The key numbers the targets do not already show, so nothing is said twice. */
  function numbers(challenge: Challenge, settings: SimulationSettings): string {
    const hardware = getHardware(settings.hardwareId);
    const model = modelFor(settings);
    const timing = responseTiming(settings, hardware, model);
    const decode = calculateSimulation({ ...settings, phase: 'decode' }, hardware, model);
    const targeted = new Set(challenge.constraints.map((constraint) => constraint.metric));
    const cells: [ConstraintMetric, string, string][] = [
      ['timeToFirstTokenMs', 'First token', formatDuration(timing.firstTokenMs)],
      ['msPerToken', 'Each token after', formatDuration(decode.msPerToken)],
      ['totalTokensPerSec', 'Tokens/s, all users', formatNumber(decode.tokenRate)],
    ];
    const shown = cells.filter(([metric]) => !targeted.has(metric));
    if (shown.length === 0) return '';
    return `<p class="quiz-chart-title">Also</p><div class="ch-numbers" aria-label="Other key numbers">${shown.map(([, label, value]) => `<p><span>${label}</span><strong>${value}</strong></p>`).join('')}</div>`;
  }

  function barHtml(): string {
    const done = cleared.size === CHALLENGES.length;
    return quizBar({
      items: CHALLENGES, index, itemNoun: 'Challenge', doneWord: 'cleared', rightWord: 'cleared',
      states: CHALLENGES.map((item) => (cleared.has(item.id) ? 'right' : 'open')),
      right: cleared.size, answered: cleared.size, total: CHALLENGES.length,
      offerResults: done && !showCard,
      canReset: cleared.size > 0 || CHALLENGES.some((item) => JSON.stringify(attempts.get(item.id)) !== JSON.stringify(item.naive)),
    });
  }

  function answerHtml(): string {
    const challenge = current();
    const settings = attempts.get(challenge.id)!;
    const evaluation = evaluateChallenge(challenge, settings);
    const done = cleared.size === CHALLENGES.length;
    const nextOpen = CHALLENGES.findIndex((other, i) => i !== index && !cleared.has(other.id));
    const meters = evaluation.results.map((result) => {
      const hint = METRIC_HINT[result.constraint.metric];
      const pct = Math.round(progress(result) * 100);
      // A quality rule is met or not: it gets no progress bar.
      const rule = result.constraint.metric === 'weightBits' || result.constraint.metric === 'kvBits';
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
    return `<p class="ch-knobs-title">Throttles</p><div class="ch-knob-grid">${current().adjustable.map((knob) => knobControl(knob, settings)).join('')}</div>`;
  }

  function render(): void {
    const challenge = current();
    const hardware = getHardware(attempts.get(challenge.id)!.hardwareId);
    const play = showCard && celebrate && !prefersReducedMotion();
    host.innerHTML = `<div class="quiz-scene ch-scene">
      <div data-ch-bar>${barHtml()}</div>
      <div class="quiz-question">
        <p class="stage-kicker">Challenge ${index + 1} of ${CHALLENGES.length} · ${challenge.adjustable.includes('hardwareId') ? 'runs on the chip you pick below' : `runs on ${escapeHtml(hardware.name)}, fixed by this challenge`}</p>
        <h3>${escapeHtml(challenge.title)}</h3>
        <p class="stage-lead">${escapeHtml(challenge.brief)}</p>
        <p class="quiz-workload">${workloadFacts(challenge, attempts.get(challenge.id)!)}</p>
        <div class="ch-knobs" data-ch-knobs>${knobsHtml()}</div>
        <button type="button" class="quiz-small ch-start-over" data-ch-start-over>Start this challenge over</button>
      </div>
      <div class="quiz-answer ch-answer" aria-live="polite" data-ch-answer>${answerHtml()}</div>
      ${showCard ? quizCard({ play, right: cleared.size, total: CHALLENGES.length, noun: 'challenges cleared', verdict: 'Every constraint met with the model’s own numbers. The playground has every knob at once, on any chip.', next: { href: '#act-4/playground', label: 'Open the playground →' }, titleId: 'ch-done-title' }) : ''}
    </div>`;
    placeCard(host);
    if (play) playFinale(host);
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
      if (cleared.size === CHALLENGES.length) {
        finishTimer = window.setTimeout(() => { showCard = true; celebrate = true; render(); }, prefersReducedMotion() ? 0 : 1200);
      }
    }
    if (whole) { render(); return; }
    refreshLive();
  }

  function go(next: number): void {
    showCard = false;
    index = Math.max(0, Math.min(CHALLENGES.length - 1, next));
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
      if (output) output.textContent = knob === 'prefixCachePercent' ? `${settings.prefixCachePercent}%` : `${settings[knob as 'batch' | 'sequenceLength'].toLocaleString()}${knob === 'sequenceLength' ? ' tokens' : ''}`;
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
    if (target.closest('[data-quiz-card]')) { showCard = true; render(); return; }
    if (target.closest('[data-quiz-review]')) { showCard = false; render(); return; }
    if (target.closest('[data-ch-start-over]')) { attempts.set(current().id, { ...current().naive }); render(); return; }
    if (target.closest('[data-quiz-restart]')) {
      window.clearTimeout(finishTimer);
      for (const challenge of CHALLENGES) attempts.set(challenge.id, { ...challenge.naive });
      cleared.clear();
      showCard = false;
      go(0);
      return;
    }
    const open = target.closest<HTMLButtonElement>('[data-ch-open]');
    if (open) openScene(open.dataset.chOpen!);
  });

  render();
  return {
    currentChip: () => attempts.get(current().id)!.hardwareId,
    chipIsAKnob: () => current().adjustable.includes('hardwareId'),
  };
}
