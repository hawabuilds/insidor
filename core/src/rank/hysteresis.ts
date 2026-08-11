/**
 * What stops the board flickering.
 *
 * A client-side sort over a live-updating value flickers, and no amount of smoothing
 * fixes it — the fix is that the server commits an order and the client renders the
 * order it was given, patching values in place. This file is the committing half.
 *
 * Five rules, and every one of them is in Policy: a challenger must beat the
 * incumbent by an edge to swap at all; two consecutive ticks to enter; three to
 * leave; a minimum dwell in seconds; and a cap on how many positions anything moves
 * in one tick. Plus one escape hatch, because without it a genuinely explosive new
 * entrant is held out of the board by the dwell rule for exactly the minutes it
 * mattered — and being early is the product.
 */

import type { Policy } from '@insidor/contracts/policy.ts';
import type { Millis } from '@insidor/contracts/vocabulary.ts';

import { notImplemented } from '../not-implemented.ts';

export interface BoardSlot {
  readonly subjectId: string;
  readonly score: number;
  readonly enteredAt: Millis;
  readonly ticksAbove: number;
  readonly ticksBelow: number;
}

/**
 * TO BUILD: given the committed board and this tick's scores, return the next
 * committed board. Pure, so a past board can be reproduced from stored scores — which
 * is the only way to answer "why was this in slot three an hour ago".
 */
export function commitBoard(
  _current: readonly BoardSlot[],
  _scores: Readonly<Record<string, number>>,
  _now: Millis,
  _p: Policy,
): readonly BoardSlot[] {
  return notImplemented('rank/hysteresis.ts: the committed board transition');
}
