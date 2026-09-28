import { formatDuration } from '../../model/calculate';
import type { StageId } from '../../model/forwardPass';
import { SCENARIOS, WHY, judge, solve, stageTimeMs, type BottleneckAnswer, type Limit } from './bottleneck';
import { STAGE_ORDER, STAGE_TAB_LABEL } from './scenes';

// Act 2 challenge UI: one scenario at a time, pick the slowest stage and its
// limit, then reveal where the pass's time went. Scoring and answers live in
// bottleneck.ts; this file only draws and records the reader's picks.

export interface BottleneckChallengeView {
  render(hardwareId: string): void;
}

const LIMIT_LABEL: Record<Limit, string> = { math: 'Math', memory: 'Reading memory', host: 'The host link' };

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

export function mountBottleneckChallenge(host: HTMLElement, openStage: (stage: StageId) => void): BottleneckChallengeView {
  let hardwareId = '';
  let index = 0;
  let pickStage: StageId | null = null;
  let pickLimit: Limit | null = null;
  let revealed = false;
  let finished = false;
  /** Scenario id → whether both parts were right, for scenarios answered this round. */
  const results = new Map<string, boolean>();

  function reveal(answer: BottleneckAnswer): string {
    const verdict = judge(answer, { stage: pickStage!, limit: pickLimit! });
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
        const cls = [stage.id === answer.stage ? 'is-answer' : '', stage.id === pickStage && stage.id !== answer.stage ? 'is-pick' : ''].join(' ');
        return `<li class="${cls}"><button type="button" data-bn-open="${stage.id}" title="Open the ${escapeHtml(STAGE_TAB_LABEL[stage.id])} scene">${escapeHtml(STAGE_TAB_LABEL[stage.id])}</button><span class="bn-bar"><i class="limit-${stage.limit}" style="width:${Math.max((ms / max) * 100, 0.6)}%"></i></span><small>${formatDuration(ms)} · ${stage.limit === 'host' ? 'host link' : stage.limit}</small></li>`;
      }).join('')}</ol>
      <p class="bn-legend"><i class="limit-math"></i> limited by math <i class="limit-memory"></i> limited by reading memory</p>
    </div>`;
  }

  function summary(): string {
    const right = [...results.values()].filter(Boolean).length;
    const verdict = right === SCENARIOS.length ? 'Every bottleneck found.' : right >= SCENARIOS.length - 1 ? 'Nearly all of them.' : 'The stage scenes show the numbers behind each one.';
    return `<div class="build-done bn-done"><div class="build-done-card" role="dialog" aria-labelledby="bn-done-title">
      <p class="build-done-kicker">Challenge complete</p>
      <h3 id="bn-done-title">${right} of ${SCENARIOS.length} bottlenecks</h3>
      <p class="build-done-score">${verdict} Act 3 turns each bottleneck into a throttle you can move.</p>
      <div class="build-done-actions"><a class="build-next" href="#act-3/read-model">On to Act 3 · The throttles ↓</a><button type="button" class="build-reset" data-bn-restart>Play again</button></div>
    </div></div>`;
  }

  function render(): void {
    const scenario = SCENARIOS[index]!;
    const answer = solve(scenario, hardwareId);
    const job = scenario.phase === 'prefill' ? 'First pass: the whole prompt' : 'A later pass: one new token each';
    host.innerHTML = `<div class="bn-scene">
      <div class="bn-question">
        <p class="stage-kicker">Scenario ${index + 1} of ${SCENARIOS.length}</p>
        <h3>${escapeHtml(scenario.title)}</h3>
        <p class="stage-lead">${escapeHtml(scenario.story)}</p>
        <p class="bn-workload"><span>${job}</span><span>${scenario.batch} ${scenario.batch === 1 ? 'user' : 'users'}</span><span>${scenario.sequenceLength.toLocaleString()} tokens</span><span>Llama 3.1 8B</span></p>
        <fieldset class="bn-pick" ${revealed ? 'disabled' : ''}><legend>1 · Which stage takes the most time?</legend>
          <div>${STAGE_ORDER.map((id) => `<button type="button" data-bn-stage="${id}" aria-pressed="${pickStage === id}">${escapeHtml(STAGE_TAB_LABEL[id])}</button>`).join('')}</div>
        </fieldset>
        <fieldset class="bn-pick" ${revealed ? 'disabled' : ''}><legend>2 · What limits it?</legend>
          <div>${(['math', 'memory'] as const).map((limit) => `<button type="button" data-bn-limit="${limit}" aria-pressed="${pickLimit === limit}">${LIMIT_LABEL[limit]}</button>`).join('')}</div>
        </fieldset>
        <div class="bn-actions">
          ${revealed
            ? index < SCENARIOS.length - 1 ? '<button type="button" class="build-next" data-bn-next>Next scenario →</button>' : '<button type="button" class="build-next" data-bn-finish>See your score</button>'
            : `<button type="button" class="build-next" data-bn-check ${pickStage && pickLimit ? '' : 'disabled'}>Check</button>`}
          <span class="bn-score">${results.size ? `${[...results.values()].filter(Boolean).length} of ${results.size} right so far` : 'Uses the chip picked above; this act’s users and context do not apply.'}</span>
        </div>
      </div>
      <div class="bn-answer" aria-live="polite">${revealed ? reveal(answer) : '<p class="bn-waiting">Pick a stage and a limit, then Check. The answer comes from the same model as the stage scenes, for the chip picked above.</p>'}</div>
      ${finished ? summary() : ''}
    </div>`;
  }

  host.addEventListener('click', (event) => {
    const target = event.target as Element;
    const stage = target.closest<HTMLButtonElement>('[data-bn-stage]');
    const limit = target.closest<HTMLButtonElement>('[data-bn-limit]');
    if (stage && !revealed) { pickStage = stage.dataset.bnStage as StageId; render(); return; }
    if (limit && !revealed) { pickLimit = limit.dataset.bnLimit as Limit; render(); return; }
    if (target.closest('[data-bn-check]') && pickStage && pickLimit) {
      const verdict = judge(solve(SCENARIOS[index]!, hardwareId), { stage: pickStage, limit: pickLimit });
      results.set(SCENARIOS[index]!.id, verdict.stageRight && verdict.limitRight);
      revealed = true;
      render();
      return;
    }
    if (target.closest('[data-bn-next]')) {
      index += 1;
      pickStage = null;
      pickLimit = null;
      revealed = false;
      render();
      return;
    }
    if (target.closest('[data-bn-finish]')) { finished = true; render(); return; }
    if (target.closest('[data-bn-restart]')) {
      index = 0;
      pickStage = null;
      pickLimit = null;
      revealed = false;
      finished = false;
      results.clear();
      render();
      return;
    }
    const open = target.closest<HTMLButtonElement>('[data-bn-open]');
    if (open) openStage(open.dataset.bnOpen as StageId);
  });

  return {
    render(nextHardwareId: string): void {
      // A different chip can change the answers, so the round starts over.
      if (hardwareId && nextHardwareId !== hardwareId) {
        index = 0;
        pickStage = null;
        pickLimit = null;
        revealed = false;
        finished = false;
        results.clear();
      }
      hardwareId = nextHardwareId;
      render();
    },
  };
}
