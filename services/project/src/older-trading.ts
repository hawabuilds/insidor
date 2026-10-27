/**
 * THE POST'S TRADING COINS WHEN AN OLDER COIN ITS OWN COINS NAME IS ONE OF THEM — the card's coin
 * and its "See N coins" (the owner, 2026-10-27, "*paws at you*": "list them with see n coins button
 * with highest mc one with buy button", and "you should list them automatically").
 *
 * The 24 Oct rule lists only coins made after the post (mobile shared/coins-made.ts), so on paws the
 * two 23 Oct Himmel coins in real pools ($72k, $21k) were hidden while about 30 copies at $3k were
 * listed. Where core `olderTradingCoins` (core match/older-trading.ts) lets in an older coin, the
 * card's coins are instead the coins really trading for the post, highest market cap first, at most
 * `POST_COINS_SHOWN`:
 *
 *   the older coins it lets in       their name carried by the post's tied coins, in a real pool
 *   the post's tied coins            made with the post or after, at `minCapUsd` or more, and not in
 *                                    a pool under `minLiquidityUsd` (a coin on its curve has no pool
 *                                    yet and stays: the pick's own coins start there)
 *   the pick                         whatever its cap: the one-coin rule chose it
 *
 * The card shows the first with Buy; `evidence.tradingCoins` names them all, so the card offers
 * "See N coins" and the sheet lists exactly these (services/read post-sheet.ts, mobile
 * shared/coins-made.ts `tradingCoinsListed`). Each coin's facts are only what holds: a coin the pick
 * chose says so, a tied coin its link or picture, an older coin only when it launched.
 *
 * A post where no older coin is let in is not touched: its card is the pick's or the list's, as
 * before. The owner's own coin call, "No coin is from this" and a story's coin come first, as they do
 * for the pick (rising.ts `withPick`).
 *
 * Its own file, apart from one-coin-cards.ts, because it reads more than the pick: the pick's
 * standings (internal.post_coin_pick), each post's older coins (internal.older_coin and its own list),
 * and their readings, for the few posts that have one. Reading costs nothing new — the market service
 * reads these coins already (services/market db.ts `olderNamedCoins`) and the coins on a card stay
 * read while they are on it.
 *
 * What breaks if changed carelessly: the cap ranking. A cap we have not read is never zero and never
 * first: a coin with no fresh reading is left out, so the card never offers Buy on a stale number.
 */

import type { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import { carriedNames, olderTradingCoins, type TiedCoin } from '@insidor/core';
import type { Db } from '@insidor/store';

import { loadCoinFactsByAddress } from './db.ts';
import { pickedEvidence, type CardPick } from './one-coin-cards.ts';
import { projectCoin, type ProjectOptions } from './project.ts';
import type { WireCoin, WireCoinEvidence, WirePostCoinLink } from './wire.ts';

/** One coin trading for a post, with the ties the pick recorded for it (none for an older coin). */
export interface TradingCoin {
  readonly coin: WireCoin;
  readonly ties: readonly string[];
}

/** A post's coins when an older coin was let in: the older ones and the post's own tied ones. */
export interface OlderTrading {
  readonly postedAtMs: number;
  readonly older: readonly TradingCoin[];
  readonly made: readonly TradingCoin[];
}

const capOf = (c: WireCoin): number | null => c.marketCapUsd.v;
const liquidityOf = (c: WireCoin): number | null => c.liquidityUsd.v;

/**
 * Each post's trading coins, for the posts where core lets an older coin in; others are absent.
 * `posts`: each post's id and when it went up.
 */
export async function loadOlderTrading(
  db: Db,
  posts: readonly { readonly itemId: string; readonly postedAtMs: number | null }[],
  policy: typeof DEFAULT_POLICY,
  options: ProjectOptions,
): Promise<ReadonlyMap<string, OlderTrading>> {
  const O = policy.oneCoin.olderTrading;
  const timed = posts.flatMap((p) => (p.postedAtMs === null ? [] : [{ itemId: p.itemId, postedAtMs: p.postedAtMs }]));
  if (!O.on || timed.length === 0) return new Map();
  const standings = await db.query<{ item_id: string; address: string; ties: unknown; ticker: string | null }>(
    `select p.item_id, s ->> 'address' as address, s -> 'ties' as ties, a.symbol as ticker
       from internal.post_coin_pick p
       cross join lateral jsonb_array_elements(case when jsonb_typeof(p.evidence -> 'standings') = 'array' then p.evidence -> 'standings' else '[]'::jsonb end) s
       left join public.asset a on a.chain = 'solana' and a.address = s ->> 'address'
      where p.item_id = any($1::text[]) and s ->> 'address' is not null`,
    [timed.map((p) => p.itemId)],
  );
  const tiedOf = new Map<string, TiedCoin[]>();
  for (const r of standings) {
    const ties = Array.isArray(r.ties) ? r.ties.filter((t): t is string => typeof t === 'string') : [];
    tiedOf.set(r.item_id, [...(tiedOf.get(r.item_id) ?? []), { address: r.address, ticker: r.ticker, ties }]);
  }
  const carried = new Map(timed.flatMap((p) => {
    const names = carriedNames(tiedOf.get(p.itemId) ?? [], O);
    return names.length === 0 ? [] : [[p.itemId, names] as const];
  }));
  if (carried.size === 0) return new Map();
  /* The post's older coins: those its search noted (internal.older_coin, 0060) and those on its own list. */
  const candidates = await db.query<{ item_id: string; address: string }>(
    `select item_id, address from internal.older_coin where item_id = any($1::text[])
     union
     select subject_id, address from public.same_name_coin where subject_kind = 'post' and subject_id = any($1::text[])`,
    [[...carried.keys()]],
  );
  const olderOf = new Map<string, string[]>();
  for (const r of candidates) olderOf.set(r.item_id, [...(olderOf.get(r.item_id) ?? []), r.address]);
  const facts = await loadCoinFactsByAddress(db, [...new Set(candidates.map((r) => r.address))]);
  const bars = { ...O, launchLeadMs: policy.oneCoin.launchLeadMs, minVariantLength: policy.postCoin.minVariantLength };
  const out = new Map<string, OlderTrading>();
  for (const p of timed) {
    const names = carried.get(p.itemId);
    if (names === undefined) continue;
    const projected = (olderOf.get(p.itemId) ?? []).flatMap((a) => {
      const f = facts.get(a);
      if (f === undefined) return [];
      const coin = projectCoin(f, options);
      return [{ coin, address: a, name: coin.name, ticker: coin.ticker, launchedAtMs: coin.mintedAt.at, capUsd: capOf(coin), liquidityUsd: liquidityOf(coin) }];
    });
    const older = olderTradingCoins(p.postedAtMs, names, projected, bars);
    if (older.length === 0) continue;
    out.set(p.itemId, { postedAtMs: p.postedAtMs, older: older.map((o) => ({ coin: o.coin, ties: [] })), made: [] });
  }
  if (out.size === 0) return out;
  /* The post's own tied coins, read only for the posts that have an older coin let in. */
  const tiedFacts = await loadCoinFactsByAddress(db, [...new Set([...out.keys()].flatMap((id) => (tiedOf.get(id) ?? []).map((t) => t.address)))]);
  for (const [id, t] of out) {
    const made = (tiedOf.get(id) ?? []).flatMap((c) => {
      const f = tiedFacts.get(c.address);
      if (f === undefined) return [];
      const coin = projectCoin(f, options);
      const cap = capOf(coin);
      const liquidity = liquidityOf(coin);
      const launched = coin.mintedAt.at;
      if (cap === null || cap < O.minCapUsd || (liquidity !== null && liquidity < O.minLiquidityUsd)) return [];
      if (launched !== null && launched < t.postedAtMs - policy.oneCoin.launchLeadMs) return [];
      return [{ coin, ties: c.ties }];
    });
    out.set(id, { ...t, made });
  }
  return out;
}

/**
 * Pure: the card's coin line from a post's trading coins, the pick and its projected coin, at most
 * `shown` listed; null when nothing is left to show (every coin called wrong), and the card is as before.
 */
export function olderTradingLine(
  trading: OlderTrading,
  pick: CardPick | undefined,
  pickCoin: WireCoin | null,
  wrong: ReadonlySet<string>,
  shown: number,
): WirePostCoinLink | null {
  const picked = pick?.outcome === 'picked' && pick.address !== null && pickCoin !== null ? { coin: pickCoin, ties: pick.ties } : null;
  const seen = new Set<string>();
  const pool = [...(picked === null ? [] : [picked]), ...trading.older, ...trading.made].filter((c) => {
    if (seen.has(c.coin.address) || wrong.has(c.coin.address)) return false;
    seen.add(c.coin.address);
    return true;
  });
  const rank = (c: TradingCoin): number => capOf(c.coin) ?? Number.NEGATIVE_INFINITY;
  const listed = [...pool].sort((a, b) => rank(b) - rank(a) || a.coin.address.localeCompare(b.coin.address)).slice(0, shown);
  const [first, second, ...rest] = listed;
  if (first === undefined) return null;
  const launchedAfterMs = first.coin.mintedAt.at === null ? null : first.coin.mintedAt.at - trading.postedAtMs;
  const facts: WireCoinEvidence = picked !== null && first.coin.address === picked.coin.address && pick !== undefined
    ? pickedEvidence(pick, launchedAfterMs)
    : { linksPost: first.ties.includes('link') ? true : null, samePicture: first.ties.includes('picture') ? true : null, launchedAfterMs };
  const evidence: WireCoinEvidence = second === undefined ? facts : { ...facts, tradingCoins: [first.coin.address, second.coin.address, ...rest.map((c) => c.coin.address)] };
  return { kind: 'matched', coin: first.coin, evidence };
}
