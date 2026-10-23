/**
 * GET /running/coins — the running coins strip at the top of For You and the Narratives tab (the
 * owner, 2026-10-23, design A of reports/ticker): up to `Policy.runningCoins.maxCoins` coins, each
 * with its ticker, market cap and 24-hour move, biggest dollar gain first.
 *
 * ★ ONLY COINS OF POSTS WE FOUND. A coin is on the strip only as the ONE coin a card names: a For
 * You card's matched coin (public.rising_row, `fyp`, the same `coins.kind` catches.ts reads) or a
 * board narrative's one coin (public.board_row → story_view). No search, no same-name list, no
 * coin the market source lists on its own: "one post, one coin; never a list of random coins".
 *
 * ★ LAUNCHPAD COINS ONLY, BY THE STORED ROW. public.asset.venue_id must be the launchpad's and its
 * origin a seen launch, exactly notify's coin gate (services/notify coin-gate.ts): the address
 * suffix is only a habit, and a coin with no asset row is a coin we cannot place, so it is left out.
 *
 * ★ A PRICE NOBODY WROTE RECENTLY IS NOT SHOWN, AND NEVER AS $0. The prices are the ones the
 * projector put on the card (it already drops a market reading older than
 * `market.readingFreshnessMs`), so no market source is asked here and nothing new is paid for. A
 * card whose frame was written longer ago than `runningCoins.freshMs` is a stalled writer and its
 * coin is left out; so is a coin with no market cap, no 24-hour move, or one the card says is not
 * tradable. When nothing is left the list is empty and the phone hides the strip.
 *
 * ★ ORDERED BY THE DOLLARS ITS MARKET CAP GAINED IN 24 HOURS (cap − cap ÷ (1 + move)). Volume is
 * not on the cards and would mean a new market read; a percentage alone puts a $3K coin that
 * doubled above a $2M coin up a third. Dollars gained is "what is running" in the money people
 * actually put in. Coins that fell sort after, the least fallen first. A tie goes to the address,
 * so two replies of one moment agree.
 *
 * What breaks if changed carelessly: reading any coin list but the card's one coin (the strip turns
 * into the random coins the owner forbade), or dropping the freshness check (a stalled projector's
 * last prices run on the strip as if live).
 */

import { OBSERVED_ASSET_ORIGINS } from '@insidor/contracts/asset.ts';
import { DEFAULT_POLICY, type Policy } from '@insidor/contracts';
import { VENUE_ID } from '@insidor/venue-solana-pumpfun';

import type { Db, Row } from './queries.ts';

/**
 * Each card's one coin, with when its frame was written and the coin's asset row. For You's live
 * frame and the board's narratives; `one` and `matched` are the card's settled coin (catches.ts).
 */
export const RUNNING_COINS_SQL = `
with found as (
  select r.payload -> 'coins' -> 'coin' as coin, v.projected_at as at
    from public.rising_row r
    join public.rising_view v on v.feed_id = r.feed_id
   where r.feed_id = 'fyp' and r.payload #>> '{coins,kind}' in ('one', 'matched')
  union all
  select s.payload -> 'coins' -> 'coin', s.projected_at
    from public.board_row b
    join public.story_view s on s.story_id = b.story_id
   where b.view_id = 'default' and s.payload #>> '{coins,kind}' in ('one', 'matched')
)
select f.coin, (extract(epoch from f.at) * 1000)::bigint as at_ms, a.venue_id, a.origin
  from found f
  join public.asset a on a.chain = 'solana' and a.address = f.coin ->> 'address'`;

/** One coin on the strip. Every number is known: a coin without one is not on it. */
export interface RunningCoin {
  readonly coinId: string;
  readonly address: string;
  readonly ticker: string;
  readonly imageUrl: string | null;
  readonly marketCapUsd: number;
  /** The 24-hour move in percent, as the card carries it. */
  readonly change24hPct: number;
}

export interface RunningCoins {
  readonly coins: readonly RunningCoin[];
}

const known = (m: unknown): number | null => {
  if (typeof m !== 'object' || m === null) return null;
  const v = (m as Record<string, unknown>)['v'];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

/** The dollars a cap of `cap` gained over a move of `pct` percent; null for a move no cap can make. */
export function dollarsGained(cap: number, pct: number): number | null {
  const ratio = 1 + pct / 100;
  return ratio > 0 ? cap - cap / ratio : null;
}

/** The strip from the rows of RUNNING_COINS_SQL, at `nowMs`. Pure. */
export function runningCoins(rows: readonly Row[], nowMs: number, policy: Policy = DEFAULT_POLICY): RunningCoins {
  const rule = policy.runningCoins;
  const best = new Map<string, { readonly coin: RunningCoin; readonly at: number; readonly gained: number }>();
  for (const r of rows) {
    const at = Number(r['at_ms']);
    if (!Number.isFinite(at) || nowMs - at > rule.freshMs) continue;
    if (r['venue_id'] !== VENUE_ID || typeof r['origin'] !== 'string' || !(OBSERVED_ASSET_ORIGINS as readonly string[]).includes(r['origin'])) continue;
    const c = r['coin'];
    if (typeof c !== 'object' || c === null) continue;
    const coin = c as Record<string, unknown>;
    const address = coin['address'];
    const coinId = coin['coinId'];
    const ticker = coin['ticker'];
    if (typeof address !== 'string' || typeof coinId !== 'string' || typeof ticker !== 'string' || ticker.trim() === '') continue;
    if (coin['tradable'] !== true) continue;
    const cap = known(coin['marketCapUsd']);
    const pct = known(coin['priceChange24h']);
    if (cap === null || cap <= 0 || pct === null) continue;
    const gained = dollarsGained(cap, pct);
    if (gained === null) continue;
    /* The same coin on a post and its narrative: the fresher frame's numbers. */
    const had = best.get(address);
    if (had !== undefined && had.at >= at) continue;
    const imageUrl = typeof coin['imageUrl'] === 'string' ? coin['imageUrl'] : null;
    best.set(address, { coin: { coinId, address, ticker: ticker.trim(), imageUrl, marketCapUsd: cap, change24hPct: pct }, at, gained });
  }
  const coins = [...best.values()]
    .sort((a, b) => b.gained - a.gained || (a.coin.address < b.coin.address ? -1 : a.coin.address > b.coin.address ? 1 : 0))
    .slice(0, rule.maxCoins)
    .map((e) => e.coin);
  return { coins };
}

/** The route's reader: one list kept `keepMs` for everyone who asks. */
export function createRunningCoins(now: () => number = Date.now, policy: Policy = DEFAULT_POLICY) {
  let kept: { readonly at: number; readonly list: RunningCoins } | null = null;
  return async function read(db: Db): Promise<RunningCoins> {
    const nowMs = now();
    if (kept !== null && nowMs - kept.at < policy.runningCoins.keepMs) return kept.list;
    const list = runningCoins(await db.query(RUNNING_COINS_SQL, []), nowMs, policy);
    kept = { at: nowMs, list };
    return list;
  };
}
