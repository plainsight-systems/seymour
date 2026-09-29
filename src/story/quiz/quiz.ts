import { tally } from './tally';

// A quiz shell shared by the act challenges: a bar with previous / next,
// one marker per item, the running score, and Reset; a question column and
// an answer column; and a results card with a finale when every item is
// answered. Each challenge supplies its questions, picks, and reveals.

export interface QuizItem {
  id: string;
  title: string;
}

export interface QuizSpec<P> {
  items: QuizItem[];
  /** A fresh, empty pick for an item. */
  emptyPick(): P;
  /** Whether a pick is complete enough to check. */
  ready(pick: P): boolean;
  /** Handles a click inside the question; returns the updated pick, or null if the click was not a pick. */
  pickFrom(target: Element, pick: P): P | null;
  /** Question markup: title, story, and pick buttons. `locked` once checked. */
  question(index: number, pick: P, locked: boolean): string;
  /** Whether a complete pick is right. Pure, and deterministic for the current chip. */
  isRight(index: number, pick: P): boolean;
  /** Reveal markup for a checked item. */
  reveal(index: number, pick: P): string;
  /** Placeholder for the answer column before checking. */
  waiting: string;
  /** Small print beside the Check button. */
  note: string;
  /** Other clicks inside the quiz (e.g. links into scenes). */
  onOtherClick?(target: Element): void;
  finale: {
    noun: string;
    verdict(right: number, total: number): string;
    next: { href: string; label: string };
  };
}

export interface QuizView {
  render(): void;
  /** Clears every answer (e.g. when the chip changes and answers may differ). */
  reset(): void;
}

const CONFETTI_COLORS = ['var(--green)', 'var(--mustard)', 'var(--red)', 'var(--leaf, #6f8f2f)', 'var(--ink)'];

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

export function mountQuiz<P>(host: HTMLElement, spec: QuizSpec<P>): QuizView {
  const ids = spec.items.map((item) => item.id);
  let index = 0;
  const picks = new Map<string, P>();
  /** Item id → answered right, once checked. Checked items are locked. */
  const results = new Map<string, boolean>();
  let showCard = false;
  let celebrate = false;
  let finishTimer = 0;

  const pickFor = (id: string): P => picks.get(id) ?? spec.emptyPick();

  function bar(): string {
    const score = tally(ids, results);
    const pips = spec.items.map((item, i) => {
      const result = results.get(item.id);
      const state = result === undefined ? 'open' : result ? 'right' : 'wrong';
      const mark = result === undefined ? String(i + 1) : result ? '✓' : '✗';
      const label = `Question ${i + 1}: ${item.title}${result === undefined ? ', not answered' : result ? ', right' : ', wrong'}`;
      return `<li><button type="button" class="quiz-pip" data-quiz-go="${i}" data-state="${state}" aria-current="${i === index ? 'step' : 'false'}" aria-label="${escapeHtml(label)}" style="--i:${i}">${mark}</button></li>`;
    }).join('');
    return `<div class="quiz-top">
      <nav class="quiz-nav" aria-label="Questions">
        <button type="button" class="quiz-step" data-quiz-prev ${index === 0 ? 'disabled' : ''} aria-label="Previous question">‹</button>
        <ol class="quiz-pips">${pips}</ol>
        <button type="button" class="quiz-step" data-quiz-next ${index === spec.items.length - 1 ? 'disabled' : ''} aria-label="Next question">›</button>
      </nav>
      <p class="quiz-tally" aria-live="polite"><b>${score.right}</b> of ${score.answered} right<span>${score.total - score.answered ? ` · ${score.total - score.answered} to go` : ' · all answered'}</span></p>
      <span class="quiz-top-actions">
        ${score.complete && !showCard ? '<button type="button" class="quiz-small" data-quiz-card>See results</button>' : ''}
        <button type="button" class="quiz-small" data-quiz-restart ${score.answered === 0 && picks.size === 0 ? 'disabled' : ''}>Reset</button>
      </span>
    </div>`;
  }

  function card(play: boolean): string {
    const score = tally(ids, results);
    const confetti = play
      ? `<div class="quiz-confetti" aria-hidden="true">${Array.from({ length: 64 }, (_, i) => {
          const angle = spread(i, 1) * Math.PI * 2;
          const distance = 120 + spread(i, 2) * 260;
          return `<i style="--x:${Math.round(Math.cos(angle) * distance)}px;--y:${Math.round(Math.sin(angle) * distance * 0.7 - 60)}px;--r:${Math.round(spread(i, 3) * 720 - 360)}deg;--d:${(0.35 + spread(i, 4) * 0.25).toFixed(2)}s;--c:${CONFETTI_COLORS[i % CONFETTI_COLORS.length]};--w:${6 + Math.round(spread(i, 5) * 6)}px"></i>`;
        }).join('')}</div>`
      : '';
    return `<div class="build-done quiz-done${play ? ' is-celebrating' : ''}">${confetti}<div class="build-done-card" role="dialog" aria-labelledby="${host.id || 'quiz'}-done-title">
      <p class="build-done-kicker">Challenge complete</p>
      <h3 id="${host.id || 'quiz'}-done-title"><span data-quiz-count="${score.right}">${play ? 0 : score.right}</span> of ${score.total} ${escapeHtml(spec.finale.noun)}</h3>
      <p class="build-done-score">${escapeHtml(spec.finale.verdict(score.right, score.total))}</p>
      <div class="build-done-actions"><a class="build-next" href="${spec.finale.next.href}">${escapeHtml(spec.finale.next.label)}</a><button type="button" class="build-look" data-quiz-review>Review answers</button><button type="button" class="build-reset" data-quiz-restart>Play again</button></div>
    </div></div>`;
  }

  function render(): void {
    const item = spec.items[index]!;
    const pick = pickFor(item.id);
    const checked = results.has(item.id);
    const nextOpen = spec.items.findIndex((other, i) => i !== index && !results.has(other.id));
    const play = showCard && celebrate && !reducedMotion();
    host.innerHTML = `<div class="quiz-scene">
      ${bar()}
      <div class="quiz-question">
        ${spec.question(index, pick, checked)}
        <div class="quiz-actions">
          ${checked
            ? nextOpen >= 0 ? `<button type="button" class="build-next" data-quiz-go="${nextOpen}">Next unanswered →</button>` : ''
            : `<button type="button" class="build-next" data-quiz-check ${spec.ready(pick) ? '' : 'disabled'}>Check</button>`}
          <span class="quiz-note">${escapeHtml(spec.note)}</span>
        </div>
      </div>
      <div class="quiz-answer" aria-live="polite">${checked ? spec.reveal(index, pick) : `<p class="quiz-waiting">${escapeHtml(spec.waiting)}</p>`}</div>
      ${showCard ? card(play) : ''}
    </div>`;
    // The results card sits below the bar, which stays usable.
    const top = host.querySelector<HTMLElement>('.quiz-top');
    if (top) host.querySelector<HTMLElement>('.quiz-scene')!.style.setProperty('--quiz-top', `${top.offsetTop + top.offsetHeight}px`);
    if (play) runCelebration();
    celebrate = false;
  }

  /** Markers pop in turn and the score counts up; the confetti is CSS. Plays once per completion. */
  function runCelebration(): void {
    host.querySelector('.quiz-pips')?.classList.add('is-popping');
    const target = host.querySelector<HTMLElement>('[data-quiz-count]');
    if (!target) return;
    // Timers, not animation frames: frames pause in background tabs, and the
    // count must always land on the real score.
    const final = Number(target.dataset.quizCount);
    for (let n = 1; n <= final; n++) window.setTimeout(() => { target.textContent = String(n); }, 600 + (700 * n) / Math.max(1, final));
  }

  function go(next: number): void {
    // Moving to a question means reviewing it, so the results card steps aside.
    showCard = false;
    index = Math.max(0, Math.min(spec.items.length - 1, next));
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
    const id = spec.items[index]!.id;
    if (!results.has(id)) {
      const next = spec.pickFrom(target, pickFor(id));
      if (next) { picks.set(id, next); render(); return; }
    }
    const pick = pickFor(id);
    if (target.closest('[data-quiz-check]') && spec.ready(pick)) {
      results.set(id, spec.isRight(index, pick));
      render();
      if (tally(ids, results).complete) {
        // Let the last reveal land before the finish plays over it.
        finishTimer = window.setTimeout(() => { showCard = true; celebrate = true; render(); }, reducedMotion() ? 0 : 900);
      }
      return;
    }
    const goTo = target.closest<HTMLButtonElement>('[data-quiz-go]');
    if (goTo) { go(Number(goTo.dataset.quizGo)); return; }
    if (target.closest('[data-quiz-prev]')) { go(index - 1); return; }
    if (target.closest('[data-quiz-next]')) { go(index + 1); return; }
    if (target.closest('[data-quiz-card]')) { showCard = true; render(); return; }
    if (target.closest('[data-quiz-review]')) { showCard = false; render(); return; }
    if (target.closest('[data-quiz-restart]')) { clear(); render(); return; }
    spec.onOtherClick?.(target);
  });

  return {
    render,
    reset(): void {
      clear();
      render();
    },
  };
}
