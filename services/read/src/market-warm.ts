/**
 * THE TOKEN PAGES PEOPLE ARE ABOUT TO OPEN, READ BEFORE THEY ARE OPENED (the owner, 2026-10-27:
 * "price history could not be read right now and took a long time for the intervals to load … I need
 * this instant for users"). A token page's chart and trades come from the market source, which can
 * take seconds to answer a coin it was not asked about lately, and sometimes times out. Every
 * `EVERY_MS`, the coins on For You's cards and on the tape are read here in the view each one opens
 * on, so the first tap finds them kept (the adapter serves a kept answer at once and refreshes it
 * behind; adapters/market/geckoterminal index.ts `cached`).
 *
 * ★ UNDER THE SOURCE'S LIMIT, BY CONSTRUCTION. At most `MAX_COINS` coins a round, one after another,
 * and the adapter's own per-minute gate holds back anything past it — a held-back read here costs a
 * phone nothing, it only means that coin waits for the next round.
 *
 * What breaks if changed carelessly: the timeframe. It must be the one the phone opens on (mobile
 * features/token/chart-view.ts `defaultView` and `allTimeframe`), or the kept answer is for a view
 * nobody opens first.
 */

import type { MarketData, Timeframe } from '@insidor/market-geckoterminal';

import type { Db } from './queries.ts';
import type { Logger } from './log.ts';

const EVERY_MS = 90_000;
const MAX_COINS = 40;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** For You's coins, then the tape's, each with its launch; the cards' order first. */
export const WARM_SQL = `
with fyp as (
  select r.payload #>> '{coins,coin,address}' as address, min(r.position) as at
    from public.rising_row r
   where r.feed_id = 'fyp' and r.payload #>> '{coins,kind}' = 'matched'
   group by 1
),
tape as (
  select t.coin ->> 'address' as address, 1000 + row_number() over () as at from public.tape_coin t
),
coins as (
  select address, min(at) as at from (select * from fyp union all select * from tape) u where address is not null group by address
)
select c.address, (extract(epoch from a.minted_at) * 1000)::float8 as minted_ms
  from coins c
  left join public.asset a on a.chain = 'solana' and a.address = c.address
 order by c.at
 limit ${MAX_COINS}`;

/** The view a token page opens on, as the source's timeframe (mobile chart-view.ts, the same rule). */
export function openingTimeframe(mintedMs: number | null, now: number): Timeframe {
  const age = mintedMs === null ? null : now - mintedMs;
  if (age === null || age < 0 || age >= DAY) return '1h';
  if (age <= 2 * HOUR) return '1m';
  if (age <= 10 * HOUR) return '5m';
  return '15m';
}

export function createMarketWarm(deps: { readonly db: Db; readonly log: Logger; readonly market: Pick<MarketData, 'coin'>; readonly now?: () => number }) {
  const now = deps.now ?? Date.now;
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  const round = async (): Promise<void> => {
    if (running) return;
    running = true;
    let read = 0;
    try {
      const rows = await deps.db.query(WARM_SQL, []);
      for (const r of rows) {
        const address = typeof r['address'] === 'string' ? r['address'] : null;
        if (address === null) continue;
        const minted = typeof r['minted_ms'] === 'number' && Number.isFinite(r['minted_ms']) ? r['minted_ms'] : null;
        await deps.market.coin(address, openingTimeframe(minted, now())).then(() => (read += 1), () => undefined);
      }
    } catch (e) {
      deps.log.info('market warm: coins could not be listed; tried next round', { err: e instanceof Error ? e.message : String(e) });
    } finally {
      running = false;
    }
    if (read > 0) deps.log.info('market warm: token pages read ahead', { coins: read });
  };
  return {
    start(): void {
      if (timer !== null) return;
      void round();
      timer = setInterval(() => void round(), EVERY_MS);
      timer.unref();
    },
    stop(): void {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
  };
}
