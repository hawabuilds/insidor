/**
 * AN OLDER COIN THE POST'S OWN COINS NAME, STILL TRADING: listed with the post's coins.
 *
 * The 24 Oct rule lists only coins made after the post (the owner: "these are old and not related" —
 * five same-name coins days older than a Joey Tribbiani post, and a $Kangaroo). On 27 Oct, "*paws at
 * you*", the owner asked for the opposite case: about 30 copies were made for the post, seven of them
 * tickered "Himmel" with the post's snow leopard, and two Himmel coins made on 23 Oct ($72k and $21k,
 * in real pools) were the coins actually trading. And for "maxxing": "show the older coin with volume".
 * The difference is not age. It is whether the name is the post's, and whether money is in the coin.
 *
 *   carried name   a name at least `minCarriers` of the post's coins carry, each tied to the post by
 *                  its link or its picture. A name the judge or the post's words give is NOT enough:
 *                  over 23-27 Oct the judge's names alone let in a $SOL, an old ELON on five posts
 *                  and a GTA VI on eight; the tied coins' names let in Himmel, maxxing and Chada
 *   trading        its newest reading at `minCapUsd` or more, in a pool of `minLiquidityUsd` or more.
 *                  A coin with no pool reported is on its launch curve or has none: an older coin
 *                  there is not trading, whatever its cap says
 *
 * Over 986 picked feed posts on 23-27 Oct (599 older coins carrying a tied name, 212 of them listed
 * anywhere) these bars let in 12: both Himmels on paws, the 23 Oct snow leopard post's Himmel, maxxing
 * on four posts, Chada on two, Marvin, PUMPKIN and an ELON on an Elon Musk quote. A 24h-volume bar of
 * $5k on top let in the same 12.
 *
 * Pure and its own file: the projector applies it (services/project older-trading.ts) and the market
 * reader reads the coins it could let in (services/market db.ts, a looser SQL spelling that may read
 * more, never fewer). The race (coin-race.ts) answers a different question and never counts these.
 *
 * What breaks if changed carelessly: the carrier count. One tied coin carrying a name is any copy's
 * ticker; at one, every older coin of every copy's name is a candidate and the Joey Tribbiani junk is
 * back the moment one of them has a pool.
 */

import type { MatchEvidence } from './one-coin.ts';
import { compactName, nameMatch } from './post-coin.ts';

export interface OlderTradingBars {
  readonly minCarriers: number;
  readonly minCapUsd: number;
  readonly minLiquidityUsd: number;
  /** How long before the post a coin may launch and still be made from it: those are not older. */
  readonly launchLeadMs: number;
  readonly minVariantLength: number;
}

/** One coin tied to the post (the pick's standings), with the ticker it carries. */
export interface TiedCoin {
  readonly address: string;
  readonly ticker: string | null;
  readonly ties: readonly (MatchEvidence | string)[];
}

/** An older coin and its newest reading; null is "not read", never zero. */
export interface OlderCoin {
  readonly address: string;
  readonly name: string | null;
  readonly ticker: string | null;
  readonly launchedAtMs: number | null;
  readonly capUsd: number | null;
  readonly liquidityUsd: number | null;
}

const TIED_BY: readonly string[] = ['link', 'picture'];

/** The names at least `minCarriers` coins tied by link or picture carry, compacted. */
export function carriedNames(tied: readonly TiedCoin[], bars: Pick<OlderTradingBars, 'minCarriers'>): readonly string[] {
  const carriers = new Map<string, Set<string>>();
  for (const c of tied) {
    if (c.ticker === null || !c.ties.some((t) => TIED_BY.includes(t))) continue;
    const n = compactName(c.ticker);
    if (n === '') continue;
    carriers.set(n, (carriers.get(n) ?? new Set<string>()).add(c.address));
  }
  return [...carriers].filter(([, a]) => a.size >= bars.minCarriers).map(([n]) => n).sort();
}

/** The older coins carrying a carried name and trading now, highest cap first. */
export function olderTradingCoins<C extends OlderCoin>(postedAtMs: number, carried: readonly string[], coins: readonly C[], bars: OlderTradingBars): readonly C[] {
  if (carried.length === 0) return [];
  return coins
    .filter((c) => c.launchedAtMs !== null && c.launchedAtMs < postedAtMs - bars.launchLeadMs)
    .filter((c) => c.capUsd !== null && c.capUsd >= bars.minCapUsd && c.liquidityUsd !== null && c.liquidityUsd >= bars.minLiquidityUsd)
    .filter((c) => nameMatch(carried, c, bars) === 'exact')
    .sort((a, b) => (b.capUsd ?? 0) - (a.capUsd ?? 0) || a.address.localeCompare(b.address));
}
