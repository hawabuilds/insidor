/**
 * When to read an item again.
 *
 * The grid is geometric and dense at the start — the first few minutes are where a
 * difference is informative, and an item read once an hour has no kinetics at all.
 * The tier an item sits on is a function of its last score; the minutes per tier are
 * in Policy.track.tierMinutes.
 *
 * THE FAILURE THIS MUST NOT REPEAT: the previous scheduler stopped tracking three
 * hours after first sight and pruned cold items after ten minutes, which made an
 * item's history length a function of its early performance — that is, of the
 * outcome. Every history in the corpus was therefore conditioned on the thing being
 * predicted, which is why the holdout lane exists and why it bypasses this file's
 * budget logic entirely.
 */

import type { Policy } from '@insidor/contracts/policy.ts';
import type { Millis } from '@insidor/contracts/vocabulary.ts';

import { notImplemented } from '../not-implemented.ts';

export interface Schedule {
  readonly tier: number;
  readonly dueAt: Millis;
}

/**
 * TO BUILD: map a score onto a tier via Policy.track.tierCutoffs, then add that
 * tier's interval to the last read.
 *
 * Two things it must do that are easy to leave out:
 *   - Never move an item more than one tier per read. A single noisy reading should
 *     not promote an item to the top of the grid, because the top of the grid is
 *     where the money goes.
 *   - Ignore the tier entirely for holdout items: they are on the full grid for
 *     their whole life, whatever they score, or they are not a holdout.
 */
export function nextRead(
  _lastReadAt: Millis,
  _score: number | null,
  _isHeldBack: boolean,
  _p: Policy,
): Schedule {
  return notImplemented('track/schedule.ts: the geometric re-read grid');
}
