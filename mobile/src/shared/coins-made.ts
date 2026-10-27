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

/**
 * ★ A POST'S "SEE N COINS" IS ITS TOP THREE (the owner, 2026-10-26, Dandy: 43 coins of the name, 17
 * made after the post, most of them $3k copies): the post's own coin when it has one, then the
 * coins made after it, highest market cap first, at most `POST_COINS_SHOWN` in all, whatever their
 * cap. A coin whose cap we have not read sorts after every read one, never as zero. The card's
 * count is the same three (services/project rising.ts `POST_COINS_SHOWN`).
 */
export const POST_COINS_SHOWN = 3;

/**
 * ★ THE POST'S TRADING COINS (the owner, 2026-10-27, "*paws at you*"): when the card names them
 * (`evidence.tradingCoins`, services/project older-trading.ts) the sheet lists exactly those, highest
 * market cap first, whatever their age: an older coin the post's own coins name, trading in a real
 * pool, is the post's as much as one made after it. An unread cap sorts last, never as zero.
 */
export function tradingCoinsListed(coins: readonly SheetCoin[], trading: readonly string[]): readonly SheetCoin[] {
  const cap = (c: SheetCoin): number => (c.marketCapUsd.known ? c.marketCapUsd.amount : -1);
  return coins.filter((c) => trading.includes(c.address)).sort((a, b) => cap(b) - cap(a));
}

export function topCoinsMade(coins: readonly SheetCoin[], postedMs: number | null): readonly SheetCoin[] {
  const made = coinsMadeAfter(coins, postedMs);
  const cap = (c: SheetCoin): number => (c.marketCapUsd.known ? c.marketCapUsd.amount : -1);
  return [...made.filter((c) => c.proven), ...made.filter((c) => !c.proven).sort((a, b) => cap(b) - cap(a))].slice(0, POST_COINS_SHOWN);
}
