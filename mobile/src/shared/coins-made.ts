/**
 * WHICH COINS A POST OR A NARRATIVE OFFERS (the owner, 2026-10-24: "these are old and not related" —
 * a Joey Tribbiani post listed five same-name coins 3 to 7 days older than it, and a $Kangaroo).
 * Only a coin launched after the post went up (or the narrative's first post), with a few minutes'
 * lead for a coin launched as it went up, can have been made from it; an older coin with the name was
 * there before anyone saw the post. A coin the server marks as the post's own (`proven`) always stays,
 * and a coin whose launch we do not know is left out: it cannot be shown to have come after.
 *
 * Its own file so the post sheet and the narrative page cannot disagree about what "the coins" are.
 */

import type { SheetCoin } from './api/index.ts';

/** How long before the post a coin may launch and still be listed as made from it. */
export const COIN_LEAD_MS = 10 * 60_000;

export function coinsMadeAfter(coins: readonly SheetCoin[], postedMs: number | null): readonly SheetCoin[] {
  if (postedMs === null) return coins.filter((c) => c.proven);
  return coins.filter((c) => c.proven || (c.launchedAt.known && c.launchedAt.at >= postedMs - COIN_LEAD_MS));
}
