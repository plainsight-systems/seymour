import { formatDuration } from '../../model/calculate';
import type { StageId } from '../../model/forwardPass';
import { mountQuiz } from '../quiz/quiz';
import { SCENARIOS, WHY, judge, solve, stageTimeMs, type Limit } from './bottleneck';
import { STAGE_ORDER, STAGE_TAB_LABEL } from './scenes';
import { LIMIT_LABEL } from './stages';
import { escapeHtml } from '../html';

// Act 2 challenge: for each scenario, pick the slowest stage and its limit,
// then see where the pass's time went. Answers and scoring live in
// bottleneck.ts; the bar, navigation, and finale come from the quiz shell.

export interface BottleneckChallengeView {
  render(hardwareId: string): void;
}


interface Pick { stage: StageId | null; limit: Limit | null }


export function mountBottleneckChallenge(host: HTMLElement, openStage: (stage: StageId) => void): BottleneckChallengeView {
  let hardwareId = '';

  const quiz = mountQuiz<Pick>(host, {
    items: SCENARIOS.map(({ id, title }) => ({ id, title })),
    itemNoun: 'Scenario',
    emptyPick: () => ({ stage: null, limit: null }),
    ready: (pick) => pick.stage !== null && pick.limit !== null,
    pickFrom(target, pick) {
      const stage = target.closest<HTMLButtonElement>('[data-bn-stage]');
      if (stage) return { ...pick, stage: stage.dataset.bnStage as StageId };
      const limit = target.closest<HTMLButtonElement>('[data-bn-limit]');
      if (limit) return { ...pick, limit: limit.dataset.bnLimit as Limit };
      return null;
    },
    question(index, pick, locked) {
      const scenario = SCENARIOS[index]!;
      const job = scenario.phase === 'prefill' ? 'First pass: the whole prompt' : 'A later pass: one new token each';
      return `<p class="stage-kicker">Scenario ${index + 1} of ${SCENARIOS.length}</p>
        <h3>${escapeHtml(scenario.title)}</h3>
        <p class="stage-lead">${escapeHtml(scenario.story)}</p>
        <p class="quiz-workload"><span>${job}</span><span>${scenario.batch} ${scenario.batch === 1 ? 'user' : 'users'}</span><span>${scenario.sequenceLength.toLocaleString()} tokens</span><span>Llama 3.1 8B</span></p>
        <fieldset class="quiz-pick" ${locked ? 'disabled' : ''}><legend>1 · Which stage takes the most time?</legend>
          <div>${STAGE_ORDER.map((id) => `<button type="button" data-bn-stage="${id}" aria-pressed="${pick.stage === id}">${escapeHtml(STAGE_TAB_LABEL[id])}</button>`).join('')}</div>
        </fieldset>
        <fieldset class="quiz-pick" ${locked ? 'disabled' : ''}><legend>2 · What limits it?</legend>
          <div>${(['math', 'memory'] as const).map((limit) => `<button type="button" data-bn-limit="${limit}" aria-pressed="${pick.limit === limit}">${LIMIT_LABEL[limit]}</button>`).join('')}</div>
        </fieldset>`;
    },
    isRight(index, pick) {
      const verdict = judge(solve(SCENARIOS[index]!, hardwareId), { stage: pick.stage!, limit: pick.limit! });
      return verdict.stageRight && verdict.limitRight;
    },
    reveal(index, pick) {
      const answer = solve(SCENARIOS[index]!, hardwareId);
      const verdict = judge(answer, { stage: pick.stage!, limit: pick.limit! });
      const both = verdict.stageRight && verdict.limitRight;
      const max = Math.max(...answer.stages.map(stageTimeMs));
      const why = WHY[answer.stage]?.[answer.limit];
      const headline = both ? 'Right on both.' : verdict.stageRight ? 'Right stage, wrong limit.' : verdict.limitRight ? 'Right limit, wrong stage.' : 'Not this time.';
      return `<div class="quiz-reveal" data-tone="${both ? 'good' : 'bad'}">
        <p class="quiz-headline"><span class="build-toast-mark" aria-hidden="true">${both ? '✓' : '✗'}</span><span><b class="quiz-result">${headline}</b> The slowest stage is <b>${escapeHtml(STAGE_TAB_LABEL[answer.stage])}</b>, limited by <b>${LIMIT_LABEL[answer.limit].toLowerCase()}</b>.</span></p>
        ${why ? `<p class="quiz-why">${escapeHtml(why)}</p>` : ''}
        <p class="quiz-chart-title">Where one pass’s time goes · ${formatDuration(answer.totalMs)} in all</p>
        <ol class="quiz-chart">${answer.stages.map((stage) => {
          const ms = stageTimeMs(stage);
          const cls = [stage.id === answer.stage ? 'is-answer' : '', stage.id === pick.stage && stage.id !== answer.stage ? 'is-pick' : ''].join(' ');
          return `<li class="${cls}"><button type="button" data-bn-open="${stage.id}" title="Open the ${escapeHtml(STAGE_TAB_LABEL[stage.id])} scene">${escapeHtml(STAGE_TAB_LABEL[stage.id])}</button><span class="quiz-bar"><i class="limit-${stage.limit}" style="width:${Math.max((ms / max) * 100, 0.6)}%"></i></span><small>${formatDuration(ms)} · ${LIMIT_LABEL[stage.limit].toLowerCase()}</small></li>`;
        }).join('')}</ol>
        <p class="quiz-legend"><i class="limit-math"></i> limited by math <i class="limit-memory"></i> limited by reading memory</p>
      </div>`;
    },
    waiting: 'Pick a stage and a limit, then Check. The answer comes from the same model as the stage scenes, for the chip picked above.',
    note: 'Uses the chip picked above; this act’s users and context do not apply.',
    onOtherClick(target) {
      const open = target.closest<HTMLButtonElement>('[data-bn-open]');
      if (open) openStage(open.dataset.bnOpen as StageId);
    },
    finale: {
      noun: 'bottlenecks',
      verdict: (right, total) => `${right === total ? 'Every bottleneck found.' : right >= total - 1 ? 'Nearly all of them.' : 'The stage scenes show the numbers behind each one.'} Act 3 turns each bottleneck into a throttle you can move.`,
      next: { href: '#act-3/read-model', label: 'On to Act 3 · The throttles ↓' },
    },
  });

  return {
    render(nextHardwareId: string): void {
      // A different chip can change the answers, so the round starts over.
      const changed = hardwareId !== '' && nextHardwareId !== hardwareId;
      hardwareId = nextHardwareId;
      if (changed) quiz.reset();
      else quiz.render();
    },
  };
}
