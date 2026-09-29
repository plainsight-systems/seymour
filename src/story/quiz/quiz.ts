import { tally } from './tally';
import { escapeHtml } from '../html';

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
  /** What one item is called in the bar's labels, matching the question's own heading (e.g. "Scenario"). */
  itemNoun: string;
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


/** Deterministic spread in [0, 1): the golden-ratio sequence, so the burst looks scattered without randomness. */
function spread(i: number, salt: number): number {
  return ((i + 1) * 0.6180339887 + salt * 0.7548776662) % 1;
}

export type MarkerState = 'open' | 'right' | 'wrong';

export interface BarOptions {
  items: QuizItem[];
  index: number;
  states: MarkerState[];
  /** What one item is called in labels, e.g. "Question" or "Challenge". */
  itemNoun: string;
  /** Past tense for a finished item, e.g. "answered" or "cleared". */
  doneWord: string;
  /** Word for a good result in the score, e.g. "right" or "cleared". */
  rightWord: string;
  right: number;
  answered: number;
  total: number;
  /** Show the "See results" button (every item done, card closed). */
  offerResults: boolean;
  canReset: boolean;
}

/** The bar: previous / next, one marker per item, the running score, and Reset. Uses data-quiz-* actions. */
export function quizBar(options: BarOptions): string {
  const pips = options.items.map((item, i) => {
    const state = options.states[i]!;
    const mark = state === 'open' ? String(i + 1) : state === 'right' ? '✓' : '✗';
    const label = `${options.itemNoun} ${i + 1}: ${item.title}${state === 'open' ? `, not ${options.doneWord}` : state === 'right' ? `, ${options.rightWord}` : ', wrong'}`;
    return `<li><button type="button" class="quiz-pip" data-quiz-go="${i}" data-state="${state}" aria-current="${i === options.index ? 'step' : 'false'}" aria-label="${escapeHtml(label)}" style="--i:${i}">${mark}</button></li>`;
  }).join('');
  const left = options.total - options.answered;
  return `<div class="quiz-top">
      <nav class="quiz-nav" aria-label="${escapeHtml(options.itemNoun)}s">
        <button type="button" class="quiz-step" data-quiz-prev ${options.index === 0 ? 'disabled' : ''} aria-label="Previous">‹</button>
        <ol class="quiz-pips">${pips}</ol>
        <button type="button" class="quiz-step" data-quiz-next ${options.index === options.items.length - 1 ? 'disabled' : ''} aria-label="Next">›</button>
      </nav>
      <p class="quiz-tally" aria-live="polite"><b>${options.right}</b> of ${options.answered} ${options.rightWord}<span>${left ? ` · ${left} to go` : ` · all ${options.doneWord}`}</span></p>
      <span class="quiz-top-actions">
        ${options.offerResults ? '<button type="button" class="quiz-small" data-quiz-card>See results</button>' : ''}
        <button type="button" class="quiz-small" data-quiz-restart ${options.canReset ? '' : 'disabled'}>Reset</button>
      </span>
    </div>`;
}

export interface CardOptions {
  play: boolean;
  right: number;
  total: number;
  noun: string;
  verdict: string;
  next: { href: string; label: string };
  /** The button that closes the card to look back through the items. */
  reviewLabel: string;
  titleId: string;
}

/** The results card (with the confetti burst when `play`). Uses data-quiz-review and data-quiz-restart. */
export function quizCard(options: CardOptions): string {
  const confetti = options.play
    ? `<div class="quiz-confetti" aria-hidden="true">${Array.from({ length: 64 }, (_, i) => {
        const angle = spread(i, 1) * Math.PI * 2;
        const distance = 120 + spread(i, 2) * 260;
        return `<i style="--x:${Math.round(Math.cos(angle) * distance)}px;--y:${Math.round(Math.sin(angle) * distance * 0.7 - 60)}px;--r:${Math.round(spread(i, 3) * 720 - 360)}deg;--d:${(0.35 + spread(i, 4) * 0.25).toFixed(2)}s;--c:${CONFETTI_COLORS[i % CONFETTI_COLORS.length]};--w:${6 + Math.round(spread(i, 5) * 6)}px"></i>`;
      }).join('')}</div>`
    : '';
  return `<div class="build-done quiz-done${options.play ? ' is-celebrating' : ''}">${confetti}<div class="build-done-card" role="dialog" aria-labelledby="${options.titleId}">
      <p class="build-done-kicker">Challenge complete</p>
      <h3 id="${options.titleId}"><span data-quiz-count="${options.right}">${options.play ? 0 : options.right}</span> of ${options.total} ${escapeHtml(options.noun)}</h3>
      <p class="build-done-score">${escapeHtml(options.verdict)}</p>
      <div class="build-done-actions"><a class="build-next" href="${options.next.href}">${escapeHtml(options.next.label)}</a><button type="button" class="build-look" data-quiz-review>${escapeHtml(options.reviewLabel)}</button><button type="button" class="build-reset" data-quiz-restart>Play again</button></div>
    </div></div>`;
}

/** After a render: keep the results card below the bar, which stays usable. */
export function placeCard(host: HTMLElement): void {
  const top = host.querySelector<HTMLElement>('.quiz-top');
  const scene = host.querySelector<HTMLElement>('.quiz-scene');
  if (top && scene) scene.style.setProperty('--quiz-top', `${top.offsetTop + top.offsetHeight}px`);
}

/**
 * The finale's timers (the delay before the results card, and the count-up).
 * One per quiz or board, so every way out can cancel all of them at once.
 */
export interface FinishSchedule {
  after(ms: number, run: () => void): void;
  /** Whether a timer is still waiting to run. */
  pending(): boolean;
  cancel(): void;
}

export function finishSchedule(): FinishSchedule {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  return {
    after(ms, run) {
      const id = setTimeout(() => { timers.delete(id); run(); }, ms);
      timers.add(id);
    },
    pending: () => timers.size > 0,
    cancel() {
      for (const id of timers) clearTimeout(id);
      timers.clear();
    },
  };
}

/** Markers pop in turn and the score counts up; the confetti is CSS. */
export function playFinale(host: HTMLElement, schedule: FinishSchedule): void {
  host.querySelector('.quiz-pips')?.classList.add('is-popping');
  const target = host.querySelector<HTMLElement>('[data-quiz-count]');
  if (!target) return;
  // Timers, not animation frames: frames pause in background tabs, and the
  // count must always land on the real score.
  const final = Number(target.dataset.quizCount);
  for (let n = 1; n <= final; n++) schedule.after(600 + (700 * n) / Math.max(1, final), () => { target.textContent = String(n); });
}

export function prefersReducedMotion(): boolean {
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
  const finish = finishSchedule();
  /** Set when the last item is done; the finale plays once, the next time the results card opens. */
  let finaleOwed = false;

  const pickFor = (id: string): P => picks.get(id) ?? spec.emptyPick();

  function bar(): string {
    const score = tally(ids, results);
    return quizBar({
      items: spec.items, index, itemNoun: spec.itemNoun, doneWord: 'answered', rightWord: 'right',
      states: spec.items.map((item) => { const result = results.get(item.id); return result === undefined ? 'open' : result ? 'right' : 'wrong'; }),
      right: score.right, answered: score.answered, total: score.total,
      offerResults: score.complete && !showCard, canReset: score.answered > 0 || picks.size > 0,
    });
  }

  function card(play: boolean): string {
    const score = tally(ids, results);
    return quizCard({ play, right: score.right, total: score.total, noun: spec.finale.noun, verdict: spec.finale.verdict(score.right, score.total), next: spec.finale.next, reviewLabel: 'Review answers', titleId: `${host.id || 'quiz'}-done-title` });
  }

  function render(): void {
    const item = spec.items[index]!;
    const pick = pickFor(item.id);
    const checked = results.has(item.id);
    const nextOpen = spec.items.findIndex((other, i) => i !== index && !results.has(other.id));
    const play = showCard && celebrate && !prefersReducedMotion();
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
    placeCard(host);
    if (play) playFinale(host, finish);
    celebrate = false;
  }

  function go(next: number): void {
    finish.cancel();
    // Moving to a question means reviewing it, so the results card steps aside.
    showCard = false;
    index = Math.max(0, Math.min(spec.items.length - 1, next));
    render();
  }

  function clear(): void {
    finish.cancel();
    index = 0;
    picks.clear();
    results.clear();
    finaleOwed = false;
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
        finaleOwed = true;
        finish.after(prefersReducedMotion() ? 0 : 900, () => { showCard = true; celebrate = finaleOwed; finaleOwed = false; render(); });
      }
      return;
    }
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
