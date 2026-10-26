/**
 * GET /running/coins — the running coins strip at the top of For You and the Narratives tab (the
 * owner, 2026-10-23, design A of reports/ticker): up to `Policy.runningCoins.maxCoins` coins, each
 * with its ticker, market cap and 24-hour move, the coins trading hardest in the last hour first.
 *
 * ★ ONLY COINS OF VIRAL POSTS WE FOUND, WHATEVER THE POST'S AGE (the owner, 2026-10-26): a coin is
 * on the strip only as a coin a post's or a narrative's pick held, or one the owner called right for
 * a post — never a search hit, a same-name list or a coin the market lists on its own. Ordered by the
 * dollars it traded over the last day (`RUNNING_COINS_SQL`, each hour once), at least
 * `runningCoins.minVolume24hUsd`; the hour rule below is the fallback for a row without its day.

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
 * ★ ONLY COINS TRADING IN THE LAST HOUR, MOST DOLLARS TRADED FIRST (the owner, 2026-10-23: "coins
 * that have volume right now — I don't want to see few-day-old dead coins"). The 24-hour move kept
 * a coin that ran yesterday and stopped on the strip all day. The card's coin now carries its last
 * hour from the same market reading as its price (0127; the market source already sent it, so no
 * call was added): dollars traded and trades. A coin needs `runningCoins.minVolume1hUsd` dollars
 * AND `minTrades1h` trades, so a few large fills cannot put a coin on by volume alone. An hour the
 * reading did not carry is not an hour of zero: such a coin is left out because we cannot say it is
 * trading, never shown as quiet. No age rule: an old coin trading again is running; a dead one
 * drops out within one reading of its hour going quiet. A tie goes to the address, so two replies
 * of one moment agree.
 *
 * ★ AND A MARKET CAP OF `runningCoins.minCapUsd` (the owner, 2026-10-26: "tape is now showing low mc
 * coins"): a busy hour on a $3k copy is not a coin running.
 *
 * What breaks if changed carelessly: reading any coin list but the card's one coin (the strip turns
 * into the random coins the owner forbade), dropping the freshness check (a stalled projector's
 * last prices and last hour run on the strip as if live), or ordering by the 24-hour move again
 * (yesterday's runners, dead today, come back).
 */

import { OBSERVED_ASSET_ORIGINS } from '@insidor/contracts/asset.ts';
import { DEFAULT_POLICY, type Policy } from '@insidor/contracts';
import { VENUE_ID } from '@insidor/venue-solana-pumpfun';

import type { Db, Row } from './queries.ts';

/**
 * ★ THE COINS OF VIRAL POSTS, TRENDING OVER THE DAY (the owner, 2026-10-26: "the coins that are
 * trending last 24 hrs that have viral post origin, regardless how old the post is"). Every coin a
 * post's or a narrative's pick ever held, and every coin the owner called right for a post, whatever
 * the post's age — never a coin the market lists on its own — with its newest reading (as the card's
 * coin, so `runningCoins` reads it the same way) and the dollars it traded over the last day: each
 * hour counted once, at the busiest reading of that hour, so an hour read twenty times is not counted
 * twenty times.
 */
export const RUNNING_COINS_SQL = `
with origin as (
  select address from internal.post_coin_pick where outcome = 'picked' and address is not null
  union
  select address from internal.narrative_coin_pick where outcome = 'picked' and address is not null
  union
  select coin_address from internal.owner_feedback where subject_kind = 'coin_match' and verdict in ('right', 'wrong') and coin_address is not null
),
coin as (
  select a.address, a.symbol, a.image_uri, a.venue_id, a.origin, a.asset_key
    from public.asset a join origin o on o.address = a.address
   where a.chain = 'solana'
),
hours as (
  select m.asset_key, date_trunc('hour', m.taken_at) as h, max(m.volume_1h_usd) as v
    from public.market_reading m join coin c on c.asset_key = m.asset_key
   where m.taken_at >= now() - interval '24 hours' and m.volume_1h_usd is not null
   group by 1, 2
),
day as (select asset_key, sum(v) as volume_24h from hours group by 1),
latest as (
  select distinct on (m.asset_key) m.asset_key, m.taken_at, m.market_cap_usd, m.price_change_24h_pct, m.volume_1h_usd,
         coalesce(m.buys_1h, 0) + coalesce(m.sells_1h, 0) as trades, m.tradable
    from public.market_reading m join coin c on c.asset_key = m.asset_key
   where m.taken_at >= now() - interval '2 hours'
   order by m.asset_key, m.taken_at desc
)
select jsonb_build_object(
         'coinId', 'solana:' || c.address, 'address', c.address, 'ticker', c.symbol, 'imageUrl', c.image_uri,
         'tradable', coalesce(l.tradable, false),
         'marketCapUsd', jsonb_build_object('v', l.market_cap_usd),
         'priceChange24h', jsonb_build_object('v', l.price_change_24h_pct),
         'volume1hUsd', jsonb_build_object('v', l.volume_1h_usd),
         'trades1h', jsonb_build_object('v', l.trades),
         'volume24hUsd', jsonb_build_object('v', d.volume_24h)
       ) as coin,
       (extract(epoch from l.taken_at) * 1000)::bigint as at_ms, c.venue_id, c.origin
  from coin c join latest l on l.asset_key = c.asset_key join day d on d.asset_key = c.asset_key`;

/** One coin on the strip. Every number is known: a coin without one is not on it. */
export interface RunningCoin {
  readonly coinId: string;
  readonly address: string;
  readonly ticker: string;
  readonly imageUrl: string | null;
  readonly marketCapUsd: number;
  /** The 24-hour move in percent, as the card carries it. */
  readonly change24hPct: number;
  /** Dollars traded in the last hour, as the card carries it. */
  readonly volume1hUsd: number;
  /** Buys plus sells in that hour. */
  readonly trades1h: number;
}

export interface RunningCoins {
  readonly coins: readonly RunningCoin[];
}

const known = (m: unknown): number | null => {
  if (typeof m !== 'object' || m === null) return null;
  const v = (m as Record<string, unknown>)['v'];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

/** The strip from the rows of RUNNING_COINS_SQL, at `nowMs`. Pure. */
export function runningCoins(rows: readonly Row[], nowMs: number, policy: Policy = DEFAULT_POLICY): RunningCoins {
  const rule = policy.runningCoins;
  /* The coin before its hour is known to be busy: `hour` null is an hour the card did not carry. */
  type Seen = { readonly coin: Omit<RunningCoin, 'volume1hUsd' | 'trades1h'>; readonly hour: { readonly volume1hUsd: number; readonly trades1h: number } | null; readonly day: number | null; readonly at: number };
  const best = new Map<string, Seen>();
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
    /* The same coin on a post and its narrative: the fresher frame's numbers, gated after, so an
       older frame's busier hour never stands in for the newer frame's quiet one. */
    const had = best.get(address);
    if (had !== undefined && had.at >= at) continue;
    const imageUrl = typeof coin['imageUrl'] === 'string' ? coin['imageUrl'] : null;
    const volume1hUsd = known(coin['volume1hUsd']);
    const trades1h = known(coin['trades1h']);
    best.set(address, {
      coin: { coinId, address, ticker: ticker.trim(), imageUrl, marketCapUsd: cap, change24hPct: pct },
      hour: volume1hUsd === null || trades1h === null ? null : { volume1hUsd, trades1h },
      day: known(coin['volume24hUsd']),
      at,
    });
  }
  /* ★ Trending over the day: a row that carries its day is gated and ordered by the day's dollars;
     one that does not (an older reader) keeps the hour's rule. */
  const passes = (e: Seen): boolean =>
    e.hour !== null && e.coin.marketCapUsd >= rule.minCapUsd && (e.day !== null ? e.day >= rule.minVolume24hUsd : e.hour.volume1hUsd >= rule.minVolume1hUsd && e.hour.trades1h >= rule.minTrades1h);
  const coins = [...best.values()]
    .filter(passes)
    .sort((a, b) => (b.day ?? b.hour?.volume1hUsd ?? 0) - (a.day ?? a.hour?.volume1hUsd ?? 0) || (a.coin.address < b.coin.address ? -1 : a.coin.address > b.coin.address ? 1 : 0))
    .slice(0, rule.maxCoins)
    .map((e): RunningCoin => ({ ...e.coin, volume1hUsd: e.hour?.volume1hUsd ?? 0, trades1h: e.hour?.trades1h ?? 0 }));
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
