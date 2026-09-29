import { formatDuration } from '../../model/calculate';
import type { StageId } from '../../model/forwardPass';
import { SCENARIOS, WHY, judge, solve, stageTimeMs, tally, type BottleneckAnswer, type Limit } from './bottleneck';
import { STAGE_ORDER, STAGE_TAB_LABEL } from './scenes';

// Act 2 challenge UI: pick the slowest stage and its limit for each scenario,
// in any order, then reveal where the pass's time went. Scoring and answers
// live in bottleneck.ts; this file draws, records picks, and celebrates.

export interface BottleneckChallengeView {
  render(hardwareId: string): void;
}

const LIMIT_LABEL: Record<Limit, string> = { math: 'Math', memory: 'Reading memory', host: 'The host link' };
const CONFETTI_COLORS = ['var(--green)', 'var(--mustard)', 'var(--red)', 'var(--leaf, #6f8f2f)', 'var(--ink)'];

interface Pick { stage: StageId | null; limit: Limit | null }

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** Deterministic spread in [0, 1): the golden-ratio sequence, so the burst looks scattered without randomness. */
function spread(i: number, salt: number): number {
  return ((i + 1) * 0.6180339887 + salt * 0.7548776662) % 1;
}

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function mountBottleneckChallenge(host: HTMLElement, openStage: (stage: StageId) => void): BottleneckChallengeView {
  let hardwareId = '';
  let index = 0;
  const picks = new Map<string, Pick>();
  /** Scenario id → both parts right, once checked. Checked scenarios are locked. */
  const results = new Map<string, boolean>();
  let showCard = false;
  let celebrate = false;
  let finishTimer = 0;

  const pickFor = (id: string): Pick => picks.get(id) ?? { stage: null, limit: null };

  function reveal(answer: BottleneckAnswer, pick: Pick): string {
    const verdict = judge(answer, { stage: pick.stage!, limit: pick.limit! });
    const both = verdict.stageRight && verdict.limitRight;
    const max = Math.max(...answer.stages.map(stageTimeMs));
    const why = WHY[answer.stage]?.[answer.limit];
    const headline = both ? 'Right on both.' : verdict.stageRight ? 'Right stage, wrong limit.' : verdict.limitRight ? 'Right limit, wrong stage.' : 'Not this time.';
    return `<div class="bn-reveal" data-tone="${both ? 'good' : 'bad'}">
      <p class="bn-headline"><span class="build-toast-mark" aria-hidden="true">${both ? '✓' : '✗'}</span><span><b class="bn-result">${headline}</b> The slowest stage is <b>${escapeHtml(STAGE_TAB_LABEL[answer.stage])}</b>, limited by <b>${LIMIT_LABEL[answer.limit].toLowerCase()}</b>.</span></p>
      ${why ? `<p class="bn-why">${escapeHtml(why)}</p>` : ''}
      <p class="bn-chart-title">Where one pass’s time goes · ${formatDuration(answer.totalMs)} in all</p>
      <ol class="bn-chart">${answer.stages.map((stage) => {
        const ms = stageTimeMs(stage);
        const cls = [stage.id === answer.stage ? 'is-answer' : '', stage.id === pick.stage && stage.id !== answer.stage ? 'is-pick' : ''].join(' ');
        return `<li class="${cls}"><button type="button" data-bn-open="${stage.id}" title="Open the ${escapeHtml(STAGE_TAB_LABEL[stage.id])} scene">${escapeHtml(STAGE_TAB_LABEL[stage.id])}</button><span class="bn-bar"><i class="limit-${stage.limit}" style="width:${Math.max((ms / max) * 100, 0.6)}%"></i></span><small>${formatDuration(ms)} · ${stage.limit === 'host' ? 'host link' : stage.limit}</small></li>`;
      }).join('')}</ol>
      <p class="bn-legend"><i class="limit-math"></i> limited by math <i class="limit-memory"></i> limited by reading memory</p>
    </div>`;
  }

  function bar(): string {
    const score = tally(results);
    const pips = SCENARIOS.map((scenario, i) => {
      const result = results.get(scenario.id);
      const state = result === undefined ? 'open' : result ? 'right' : 'wrong';
      const mark = result === undefined ? String(i + 1) : result ? '✓' : '✗';
      const label = `Scenario ${i + 1}: ${scenario.title}${result === undefined ? ', not answered' : result ? ', right' : ', wrong'}`;
      return `<li><button type="button" class="bn-pip" data-bn-go="${i}" data-state="${state}" aria-current="${i === index ? 'step' : 'false'}" aria-label="${escapeHtml(label)}" style="--i:${i}">${mark}</button></li>`;
    }).join('');
    return `<div class="bn-top">
      <nav class="bn-nav" aria-label="Scenarios">
        <button type="button" class="bn-step" data-bn-prev ${index === 0 ? 'disabled' : ''} aria-label="Previous scenario">‹</button>
        <ol class="bn-pips">${pips}</ol>
        <button type="button" class="bn-step" data-bn-next ${index === SCENARIOS.length - 1 ? 'disabled' : ''} aria-label="Next scenario">›</button>
      </nav>
      <p class="bn-tally" aria-live="polite"><b>${score.right}</b> of ${score.answered} right<span>${score.total - score.answered ? ` · ${score.total - score.answered} to go` : ' · all answered'}</span></p>
      <span class="bn-top-actions">
        ${score.complete && !showCard ? '<button type="button" class="bn-small" data-bn-card>See results</button>' : ''}
        <button type="button" class="bn-small" data-bn-restart ${score.answered === 0 && picks.size === 0 ? 'disabled' : ''}>Reset</button>
      </span>
    </div>`;
  }

  function card(play: boolean): string {
    const score = tally(results);
    const verdict = score.right === score.total ? 'Every bottleneck found.' : score.right >= score.total - 1 ? 'Nearly all of them.' : 'The stage scenes show the numbers behind each one.';
    const confetti = play
      ? `<div class="bn-confetti" aria-hidden="true">${Array.from({ length: 64 }, (_, i) => {
          const angle = spread(i, 1) * Math.PI * 2;
          const distance = 120 + spread(i, 2) * 260;
          return `<i style="--x:${Math.round(Math.cos(angle) * distance)}px;--y:${Math.round(Math.sin(angle) * distance * 0.7 - 60)}px;--r:${Math.round(spread(i, 3) * 720 - 360)}deg;--d:${(0.35 + spread(i, 4) * 0.25).toFixed(2)}s;--c:${CONFETTI_COLORS[i % CONFETTI_COLORS.length]};--w:${6 + Math.round(spread(i, 5) * 6)}px"></i>`;
        }).join('')}</div>`
      : '';
    return `<div class="build-done bn-done${play ? ' is-celebrating' : ''}">${confetti}<div class="build-done-card" role="dialog" aria-labelledby="bn-done-title">
      <p class="build-done-kicker">Challenge complete</p>
      <h3 id="bn-done-title"><span data-bn-count="${score.right}">${play ? 0 : score.right}</span> of ${score.total} bottlenecks</h3>
      <p class="build-done-score">${verdict} Act 3 turns each bottleneck into a throttle you can move.</p>
      <div class="build-done-actions"><a class="build-next" href="#act-3/read-model">On to Act 3 · The throttles ↓</a><button type="button" class="build-look" data-bn-review>Review answers</button><button type="button" class="build-reset" data-bn-restart>Play again</button></div>
    </div></div>`;
  }

  function render(): void {
    const scenario = SCENARIOS[index]!;
    const answer = solve(scenario, hardwareId);
    const pick = pickFor(scenario.id);
    const checked = results.has(scenario.id);
    const job = scenario.phase === 'prefill' ? 'First pass: the whole prompt' : 'A later pass: one new token each';
    const nextOpen = SCENARIOS.findIndex((other, i) => i !== index && !results.has(other.id));
    const play = showCard && celebrate && !reducedMotion();
    host.innerHTML = `<div class="bn-scene">
      ${bar()}
      <div class="bn-question">
        <p class="stage-kicker">Scenario ${index + 1} of ${SCENARIOS.length}</p>
        <h3>${escapeHtml(scenario.title)}</h3>
        <p class="stage-lead">${escapeHtml(scenario.story)}</p>
        <p class="bn-workload"><span>${job}</span><span>${scenario.batch} ${scenario.batch === 1 ? 'user' : 'users'}</span><span>${scenario.sequenceLength.toLocaleString()} tokens</span><span>Llama 3.1 8B</span></p>
        <fieldset class="bn-pick" ${checked ? 'disabled' : ''}><legend>1 · Which stage takes the most time?</legend>
          <div>${STAGE_ORDER.map((id) => `<button type="button" data-bn-stage="${id}" aria-pressed="${pick.stage === id}">${escapeHtml(STAGE_TAB_LABEL[id])}</button>`).join('')}</div>
        </fieldset>
        <fieldset class="bn-pick" ${checked ? 'disabled' : ''}><legend>2 · What limits it?</legend>
          <div>${(['math', 'memory'] as const).map((limit) => `<button type="button" data-bn-limit="${limit}" aria-pressed="${pick.limit === limit}">${LIMIT_LABEL[limit]}</button>`).join('')}</div>
        </fieldset>
        <div class="bn-actions">
          ${checked
            ? nextOpen >= 0 ? `<button type="button" class="build-next" data-bn-go="${nextOpen}">Next unanswered →</button>` : ''
            : `<button type="button" class="build-next" data-bn-check ${pick.stage && pick.limit ? '' : 'disabled'}>Check</button>`}
          <span class="bn-score">Uses the chip picked above; this act’s users and context do not apply.</span>
        </div>
      </div>
      <div class="bn-answer" aria-live="polite">${checked ? reveal(answer, pick) : '<p class="bn-waiting">Pick a stage and a limit, then Check. The answer comes from the same model as the stage scenes, for the chip picked above.</p>'}</div>
      ${showCard ? card(play) : ''}
    </div>`;
    // The results card sits below the score bar, which stays usable.
    const top = host.querySelector<HTMLElement>('.bn-top');
    if (top) host.querySelector<HTMLElement>('.bn-scene')!.style.setProperty('--bn-top', `${top.offsetTop + top.offsetHeight}px`);
    if (play) runCelebration();
    celebrate = false;
  }

  /** Markers pop in turn and the score counts up; the confetti is CSS. Plays once per completion. */
  function runCelebration(): void {
    host.querySelector('.bn-pips')?.classList.add('is-popping');
    const target = host.querySelector<HTMLElement>('[data-bn-count]');
    if (!target) return;
    // Timers, not animation frames: frames pause in background tabs, and the
    // count must always land on the real score.
    const final = Number(target.dataset.bnCount);
    for (let n = 1; n <= final; n++) window.setTimeout(() => { target.textContent = String(n); }, 600 + (700 * n) / Math.max(1, final));
  }

  function go(next: number): void {
    // Moving to a question means reviewing it, so the results card steps aside.
    showCard = false;
    index = Math.max(0, Math.min(SCENARIOS.length - 1, next));
    render();
  }

  function clear(): void {
    window.clearTimeout(finishTimer);
    index = 0;
    picks.clear();
    results.clear();
    showCard = false;
    celebrate = false;
  }

  host.addEventListener('click', (event) => {
    const target = event.target as Element;
    const id = SCENARIOS[index]!.id;
    const stage = target.closest<HTMLButtonElement>('[data-bn-stage]');
    const limit = target.closest<HTMLButtonElement>('[data-bn-limit]');
    if (stage && !results.has(id)) { picks.set(id, { ...pickFor(id), stage: stage.dataset.bnStage as StageId }); render(); return; }
    if (limit && !results.has(id)) { picks.set(id, { ...pickFor(id), limit: limit.dataset.bnLimit as Limit }); render(); return; }
    const pick = pickFor(id);
    if (target.closest('[data-bn-check]') && pick.stage && pick.limit) {
      const verdict = judge(solve(SCENARIOS[index]!, hardwareId), { stage: pick.stage, limit: pick.limit });
      results.set(id, verdict.stageRight && verdict.limitRight);
      render();
      if (tally(results).complete) {
        // Let the last reveal land before the finish plays over it.
        finishTimer = window.setTimeout(() => { showCard = true; celebrate = true; render(); }, reducedMotion() ? 0 : 900);
      }
      return;
    }
    const goTo = target.closest<HTMLButtonElement>('[data-bn-go]');
    if (goTo) { go(Number(goTo.dataset.bnGo)); return; }
    if (target.closest('[data-bn-prev]')) { go(index - 1); return; }
    if (target.closest('[data-bn-next]')) { go(index + 1); return; }
    if (target.closest('[data-bn-card]')) { showCard = true; render(); return; }
    if (target.closest('[data-bn-review]')) { showCard = false; render(); return; }
    if (target.closest('[data-bn-restart]')) { clear(); render(); return; }
    const open = target.closest<HTMLButtonElement>('[data-bn-open]');
    if (open) openStage(open.dataset.bnOpen as StageId);
  });

  return {
    render(nextHardwareId: string): void {
      // A different chip can change the answers, so the round starts over.
      if (hardwareId && nextHardwareId !== hardwareId) clear();
      hardwareId = nextHardwareId;
      render();
    },
  };
}
