// The running score for a quiz: pure, so every challenge counts the same way.

export interface Tally {
  answered: number;
  right: number;
  total: number;
  complete: boolean;
}

/** results maps item id → answered right; ids not in the quiz are ignored. */
export function tally(ids: readonly string[], results: ReadonlyMap<string, boolean>): Tally {
  const answered = ids.filter((id) => results.has(id));
  const right = answered.filter((id) => results.get(id)).length;
  return { answered: answered.length, right, total: ids.length, complete: answered.length === ids.length };
}
