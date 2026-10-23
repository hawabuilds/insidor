/**
 * GET /running/coins — the running coins strip at the top of For You and the Narratives tab (the
 * owner, 2026-10-23, design A of reports/ticker): up to `Policy.runningCoins.maxCoins` coins, each
 * with its ticker, market cap and 24-hour move, the coins trading hardest in the last hour first.
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
  type Seen = { readonly coin: Omit<RunningCoin, 'volume1hUsd' | 'trades1h'>; readonly hour: { readonly volume1hUsd: number; readonly trades1h: number } | null; readonly at: number };
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
      at,
    });
  }
  const coins = [...best.values()]
    .flatMap((e): RunningCoin[] => (e.hour !== null && e.hour.volume1hUsd >= rule.minVolume1hUsd && e.hour.trades1h >= rule.minTrades1h ? [{ ...e.coin, ...e.hour }] : []))
    .sort((a, b) => b.volume1hUsd - a.volume1hUsd || (a.address < b.address ? -1 : a.address > b.address ? 1 : 0))
    .slice(0, rule.maxCoins);
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
