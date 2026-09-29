import { formatDuration } from '../../model/calculate';
import { mountQuiz } from '../quiz/quiz';
import { GOAL_LABEL, MOVES, PICK_SCENARIOS, WHY, rankMoves, type MoveId } from './pick';

// Act 3 challenge: for each stuck workload, pick the one throttle that helps
// most, then see what every throttle would have done. Answers live in
// pick.ts; the bar, navigation, and finale come from the quiz shell.

export interface PickChallengeView {
  render(hardwareId: string): void;
}

/** The Act 3 scene that teaches each move. */
const MOVE_SCENE: Record<MoveId, { scene: string; title: string }> = {
  fp8: { scene: 'act-3/read-model', title: 'Every token re-reads the model' },
  kv8: { scene: 'act-3/memory-wall', title: 'Memory fills up' },
  reuse: { scene: 'act-3/memory-wall', title: 'Memory fills up' },
  speculate: { scene: 'act-3/heavier-tokens', title: 'Change what one read buys' },
  users2: { scene: 'act-3/share-read', title: 'Share the read' },
};

const label = (move: MoveId) => MOVES.find((candidate) => candidate.id === move)!.label;

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function effect(speedup: number): string {
  if (Math.abs(speedup - 1) < 0.005) return 'no change';
  const ratio = speedup > 1 ? speedup : 1 / speedup;
  return `${ratio.toFixed(ratio >= 10 ? 0 : 2)}× ${speedup > 1 ? 'faster' : 'slower'}`;
}

export function mountPickChallenge(host: HTMLElement, openScene: (target: string) => void): PickChallengeView {
  let hardwareId = '';

  const quiz = mountQuiz<MoveId | null>(host, {
    items: PICK_SCENARIOS.map(({ id, title }) => ({ id, title })),
    emptyPick: () => null,
    ready: (pick) => pick !== null,
    pickFrom(target) {
      const button = target.closest<HTMLButtonElement>('[data-pick-move]');
      return button ? (button.dataset.pickMove as MoveId) : null;
    },
    question(index, pick, locked) {
      const scenario = PICK_SCENARIOS[index]!;
      return `<p class="stage-kicker">Workload ${index + 1} of ${PICK_SCENARIOS.length}</p>
        <h3>${escapeHtml(scenario.title)}</h3>
        <p class="stage-lead">${escapeHtml(scenario.story)}</p>
        <p class="quiz-workload"><span>Fix: ${GOAL_LABEL[scenario.goal].toLowerCase()}</span><span>${scenario.batch} ${scenario.batch === 1 ? 'user' : 'users'}</span><span>${scenario.sequenceLength.toLocaleString()} tokens</span><span>${Math.round(scenario.acceptance * 100)}% of guesses land</span><span>${scenario.sharedPrefixPercent ? `${scenario.sharedPrefixPercent}% shared prompt` : 'nothing shared'}</span></p>
        <fieldset class="quiz-pick quiz-pick-list" ${locked ? 'disabled' : ''}><legend>Which one move helps most?</legend>
          <div>${MOVES.map((move) => `<button type="button" data-pick-move="${move.id}" aria-pressed="${pick === move.id}"><b>${escapeHtml(move.label)}</b><small>${escapeHtml(move.detail)}</small></button>`).join('')}</div>
        </fieldset>`;
    },
    isRight: (index, pick) => rankMoves(PICK_SCENARIOS[index]!, hardwareId).best === pick,
    reveal(index, pick) {
      const scenario = PICK_SCENARIOS[index]!;
      const answer = rankMoves(scenario, hardwareId);
      const right = answer.best === pick;
      const best = answer.ranked[0]!;
      const why = WHY[`${answer.best}/${scenario.goal}`];
      const max = Math.max(...answer.ranked.map((result) => result.speedup));
      return `<div class="quiz-reveal" data-tone="${right ? 'good' : 'bad'}">
        <p class="quiz-headline"><span class="build-toast-mark" aria-hidden="true">${right ? '✓' : '✗'}</span><span><b class="quiz-result">${right ? 'Right.' : 'Not the best move.'}</b> <b>${escapeHtml(label(answer.best))}</b> helps most: ${GOAL_LABEL[scenario.goal].toLowerCase()} goes from ${formatDuration(answer.baselineMs)} to ${formatDuration(best.ms)}.</span></p>
        ${why ? `<p class="quiz-why">${escapeHtml(why)}</p>` : ''}
        <p class="quiz-chart-title">What each move does to ${GOAL_LABEL[scenario.goal].toLowerCase()}</p>
        <ol class="quiz-chart quiz-chart-moves">${answer.ranked.map((result) => {
          const cls = [result.move === answer.best ? 'is-answer' : '', result.move === pick && result.move !== answer.best ? 'is-pick' : ''].join(' ');
          const tone = Math.abs(result.speedup - 1) < 0.005 ? 'same' : result.speedup > 1 ? 'better' : 'worse';
          return `<li class="${cls}"><button type="button" data-pick-open="${result.move}" title="Open “${escapeHtml(MOVE_SCENE[result.move].title)}” in Act 3">${escapeHtml(label(result.move))}</button><span class="quiz-bar"><i class="is-${tone}" style="width:${Math.max((result.speedup / max) * 100, 1.5)}%"></i></span><small>${effect(result.speedup)}${result.spills ? ' · overflows GPU memory' : ''}</small></li>`;
        }).join('')}</ol>
        <p class="quiz-legend">Bars are speed relative to the best move. Click a move to open the throttle that teaches it.</p>
      </div>`;
    },
    waiting: 'Pick one move, then Check. Every move is run through the same model as the throttles above, for the chip picked above.',
    note: 'Uses the chip picked above; the workload is fixed by the scenario.',
    onOtherClick(target) {
      const open = target.closest<HTMLButtonElement>('[data-pick-open]');
      if (open) openScene(MOVE_SCENE[open.dataset.pickOpen as MoveId].scene);
    },
    finale: {
      noun: 'throttles picked',
      verdict: (right, total) => `${right === total ? 'The right lever every time.' : right >= total - 1 ? 'Nearly every lever right.' : 'Each throttle above shows why its move helps where it does.'} Act 4 puts them together under real constraints.`,
      next: { href: '#act-4/challenges', label: 'On to Act 4 · Putting it together ↓' },
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
