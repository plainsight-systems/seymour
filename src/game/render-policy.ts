import type { GameState } from './types';

/**
 * Live clock and patience ticks must never replace interactive DOM. Rebuild only
 * when the set or meaning of controls has actually changed.
 */
export function requiresStructuralRender(previous: GameState, next: GameState): boolean {
  const customersChanged = next.active.length !== previous.active.length
    || next.active.some((customer, index) => customer.order.id !== previous.active[index]?.order.id);
  const cooldownEnded = previous.feedCooldownMs > 0 && next.feedCooldownMs === 0;
  return next.event.id !== previous.event.id
    || next.screen !== previous.screen
    || customersChanged
    || next.selectedId !== previous.selectedId
    || cooldownEnded;
}
