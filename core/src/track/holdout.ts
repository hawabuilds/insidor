/**
 * Lane assignment. Which arrivals are held back, and which rejects are drawn anyway.
 *
 * WHY this is deterministic on the subject seed rather than random: a lane assigned
 * by a random number generator moves when the process restarts, which turns the
 * holdout from a fixed sample of ARRIVALS into a sample of UPTIME — correlated with
 * exactly the incidents that make the data interesting. Deterministic assignment
 * also means a replay six months later puts the same items in the same lanes, which
 * is the property the whole off-policy evaluation plan rests on.
 *
 * WHY the holdout exists at all: without it, how long an item is tracked is decided
 * by how it performed early, which is the outcome. Every history in the system is
 * then conditioned on the thing being predicted. The holdout is the only unbiased
 * history there is, it costs about two percent of read budget and zero feed quality,
 * and its absence is a permanent hole in the record rather than a recoverable one.
 * If budget pressure ever forces a cut, cut exploration first.
 */

import { fnv1aUnit } from '../hash.ts';

/**
 * Pre-gate, uniform over arrivals, never rendered.
 *
 * @param seed Decision context's per-subject seed. Stable across restarts.
 * @param rate Policy.explore.holdoutRate.
 * @param salt Policy.explore.holdoutSalt. Changing it re-rolls every lane, which
 *             breaks comparability with every earlier holdout measurement — so it is
 *             a versioned string in Policy rather than a constant in this file.
 */
export function isHoldout(seed: string, rate: number, salt: string): boolean {
  if (!(rate > 0)) return false;
  return fnv1aUnit(`${salt}|${seed}`) < rate;
}

/**
 * The exploration draw, over items that cleared every hard gate and then scored
 * below the bar. Deliberately derived from a different salt than the holdout, so an
 * item cannot be in both lanes for a reason that looks like a coincidence and is not.
 */
export function isExploreDraw(seed: string, epsilon: number, salt: string): boolean {
  if (!(epsilon > 0)) return false;
  return fnv1aUnit(`${salt}|epsilon|${seed}`) < epsilon;
}
