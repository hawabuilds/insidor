/**
 * PVP, AS EACH SCREEN DRAWS IT: a For You post with two or more coins made for it being bought at
 * once ("PvP" is the owner's word for it on screen). The server sends the race's coins with the
 * card (`evidence.racingCoins`, services/project one-coin-cards.ts); this decides, once, what the
 * card, the post's dock and the token page say about them.
 *
 *   the card       the leading coin, a grey "PvP +N" and its Buy (`pvpCoins`)
 *   the dock       "PvP" and "N coins", one row per coin, the leader's Buy purple (`pvpCoins`)
 *   the token page "$KJI for this post is ahead at $51K, this one $12K", only while another coin
 *                  for the same post really is ahead (`pvpAhead`)
 *
 * Its own file, not coin-status.ts: that file is the one line and one button a coin link gets; this
 * is a list, read by three screens, and the rule for "who leads" must be one rule.
 *
 * ★ THE LEADER IS THE HIGHEST MARKET CAP, A MARKET FACT — never the coin we picked, never why it
 * leads. A cap not read is never ranked as $0: it sits below every read cap. With no cap read on any
 * coin there is no leader to name, so there is no PvP list at all and the screen keeps its old look
 * (the honest answer is "we cannot tell", never the first coin dressed as the winner).
 *
 * What breaks if changed carelessly: the live cap override. The card's own coin is priced live
 * (shared/coin-cap.ts) while the others carry the frame's reading; leaving the live figure out would
 * show one coin two caps on one screen, and ranking without it can name a leader the page beside it
 * contradicts.
 */

import type { Measured } from './format/measure.ts';
import type { PostCoinLink, RacingCoin } from './api/index.ts';

export interface PvpCoin extends RacingCoin {
  /** The highest read market cap of the race: top of the list, the purple Buy. Exactly one coin. */
  readonly leader: boolean;
}

const capOf = (m: Measured): number | null => (m.known ? m.amount : null);

/**
 * The race's coins as a screen lists them, leader first, or null when the post has no PvP to show
 * (no race, under two coins read, or no cap read on any of them). `live`: a coin's cap read live on
 * this screen, which replaces the frame's for that coin before ranking.
 */
export function pvpCoins(coins: PostCoinLink, live?: { readonly address: string; readonly cap: Measured }): readonly PvpCoin[] | null {
  if (coins.kind !== 'matched') return null;
  const list = coins.evidence.racingCoins;
  if (list === undefined || list.length < 2) return null;
  const priced = list.map((c) => (live !== undefined && live.cap.known && c.address === live.address ? { ...c, marketCapUsd: live.cap } : c));
  /* Stable: equal caps keep the server's order, so a tie never flips between two draws. */
  const ranked = priced.map((c, i) => ({ c, i })).sort((a, b) => {
    const x = capOf(a.c.marketCapUsd);
    const y = capOf(b.c.marketCapUsd);
    if (x === null && y === null) return a.i - b.i;
    if (x === null) return 1;
    if (y === null) return -1;
    return y - x || a.i - b.i;
  }).map((r) => r.c);
  const top = ranked[0];
  if (top === undefined || capOf(top.marketCapUsd) === null) return null;
  return ranked.map((c, i) => ({ ...c, leader: i === 0 }));
}

/** On a coin's own page: the other coin for the same post that is ahead of it, with both caps. */
export interface PvpAhead {
  readonly postId: string;
  readonly leader: RacingCoin;
  readonly leaderCap: number;
  readonly ownCap: number;
}

/**
 * The coin for the same post that is ahead of this one, or null. Only while it is true: both caps
 * read and the other strictly higher. `ownCap`: this page's own live cap when it has one, so the
 * line agrees with the market cap printed under it; else the frame's reading of this coin.
 */
export function pvpAhead(posts: readonly { readonly postId: string; readonly racingCoins?: readonly RacingCoin[] }[], address: string, ownCap: Measured): PvpAhead | null {
  for (const p of posts) {
    const list = p.racingCoins ?? [];
    const self = list.find((c) => c.address === address);
    if (self === undefined || list.length < 2) continue;
    const own = capOf(ownCap) ?? capOf(self.marketCapUsd);
    if (own === null) continue;
    let best: { coin: RacingCoin; cap: number } | null = null;
    for (const c of list) {
      const cap = capOf(c.marketCapUsd);
      if (c.address === address || cap === null) continue;
      if (best === null || cap > best.cap) best = { coin: c, cap };
    }
    if (best !== null && best.cap > own) return { postId: p.postId, leader: best.coin, leaderCap: best.cap, ownCap: own };
  }
  return null;
}
