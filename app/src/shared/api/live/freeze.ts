/**
 * When the board is allowed to reorder.
 *
 * Order is held while the pointer, keyboard focus, or scroll position is inside the board.
 * A scroll counts as a hold: a scroll is a read, and rows sliding past under the eye is the
 * same failure as a row moving under the cursor.
 *
 * The hard release matters as much as the hold. A parked cursor must not freeze the board
 * forever — the numbers keep moving while the order is stale, and past about half a minute
 * that reads as a bug rather than as courtesy.
 *
 * This is a genuine product tradeoff and it should be seen before it ships: a user who parks
 * the pointer sees an order up to thirty seconds old. The alternative failure — a row moving
 * as you click it — is worse but much less visible.
 */

import { useEffect } from 'react';
import type { RefObject } from 'react';

import type { BoardStore } from './boardStore.ts';

/** Longest the board may hold a committed order, no matter what the pointer is doing. */
const HARD_RELEASE_MS = 30_000;
/** Grace after the pointer leaves, so crossing a gap between rows does not thrash. */
const SOFT_RELEASE_MS = 900;

/* Generic in the element type: a ref is mutable, so `RefObject<HTMLDivElement | null>` is
   not assignable to `RefObject<HTMLElement | null>`, and every caller would otherwise have
   to widen its own ref to satisfy this signature. */
export function useFreezeWhileInteracting<T extends HTMLElement>(
  ref: RefObject<T | null>,
  store: BoardStore,
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let soft: ReturnType<typeof setTimeout> | undefined;
    let hard: ReturnType<typeof setTimeout> | undefined;

    const hold = (): void => {
      clearTimeout(soft);
      clearTimeout(hard);
      store.setFrozen(true);
      hard = setTimeout(() => store.setFrozen(false), HARD_RELEASE_MS);
    };

    const leave = (): void => {
      clearTimeout(soft);
      soft = setTimeout(() => {
        clearTimeout(hard);
        store.setFrozen(false);
      }, SOFT_RELEASE_MS);
    };

    el.addEventListener('pointerenter', hold);
    el.addEventListener('pointerleave', leave);
    el.addEventListener('focusin', hold);
    el.addEventListener('focusout', leave);
    el.addEventListener('scroll', hold, { passive: true });

    return () => {
      el.removeEventListener('pointerenter', hold);
      el.removeEventListener('pointerleave', leave);
      el.removeEventListener('focusin', hold);
      el.removeEventListener('focusout', leave);
      el.removeEventListener('scroll', hold);
      clearTimeout(soft);
      clearTimeout(hard);
      /* Unmounting must not leave the store frozen forever. */
      store.setFrozen(false);
    };
  }, [ref, store]);
}
