/**
 * GET /coin/:assetKey/market?tf=1m|5m|1h|6h — a coin's price history, its latest trades (each with
 * the wallet that made it), and,
 * while it is still on its launchpad curve, how far along the curve it is.
 *
 * ★ THE ONE PLACE THIS SERVICE CALLS OUT, AND WHY IT IS ALLOWED TO. Everything else here is a
 * SELECT against the projection under the app role, and that is still true: this module holds
 * no database credential beyond the one the rest of the service holds, and reads one public
 * table (public.asset) to decide whether to answer at all. What it adds is a read from a public
 * market data source — facts about trading that exist whether or not Insidor does — fetched
 * when someone opens a token page. Projecting candles and trades for every coin every minute
 * would cost a hundred calls to show one.
 *
 * ★ ONLY FOR A COIN WE ALREADY HOLD, OR ONE A SEARCH JUST RETURNED. An address nobody indexed and
 * no search of ours listed is a 404, so this route can never be used to make us fetch an
 * arbitrary address; a search result stays openable for `search.openableMs` (search.ts). And every answer is kept (see the adapter), so
 * a crowd on one coin costs one call.
 *
 * What breaks if changed carelessly: an outage is not an empty market. A source that failed
 * answers `{ kind: 'unavailable' }`, which the page shows as a dash with a reason — never as a
 * coin with no trades.
 */

import type { MarketData, Timeframe } from '@insidor/market-geckoterminal';
import { TIMEFRAMES } from '@insidor/market-geckoterminal';

import type { Db } from './queries.ts';
import type { Logger } from './log.ts';

/* A coin we hold: its full row, or the name index (0037) once the keep rule has deleted that. */
export const ASSET_SQL = `
select chain, address from public.asset where asset_key = $1
union all
select 'solana', address from public.coin_name where split_part($1, ':', 1) = 'solana' and address = split_part($1, ':', 2)
limit 1`;

export interface MarketDeps {
  readonly db: Db;
  readonly log: Logger;
  readonly market: Pick<MarketData, 'coin'>;
  /** A curve's progress from its account, 0..1; null when the address holds no curve. Null reader: no RPC configured. */
  readonly curveProgress: ((address: string) => Promise<number | null>) | null;
  /** True for an address a recent search returned (search.ts): openable without being in the universe. */
  readonly recent?: (address: string) => boolean;
}

export interface MarketReply {
  readonly status: number;
  readonly body: string;
}

const json = (status: number, value: unknown): MarketReply => ({ status, body: JSON.stringify(value) });
const measured = (v: number | null, why: string) => (v === null || !Number.isFinite(v) ? { v: null, why } : { v });

export async function coinMarket(assetKey: string, rawTf: string | null, deps: MarketDeps): Promise<MarketReply | null> {
  const timeframe = (TIMEFRAMES as readonly string[]).includes(rawTf ?? '') ? (rawTf as Timeframe) : rawTf === null ? '1m' : null;
  if (timeframe === null) return json(400, { error: 'bad request' });
  const rows = await deps.db.query(ASSET_SQL, [assetKey]);
  const asset = rows[0];
  const searched = assetKey.startsWith('solana:') && deps.recent?.(assetKey.slice('solana:'.length)) === true ? assetKey.slice('solana:'.length) : null;
  if ((asset === undefined || asset['chain'] !== 'solana' || typeof asset['address'] !== 'string') && searched === null) return null;
  const mint = typeof asset?.['address'] === 'string' && asset['chain'] === 'solana' ? asset['address'] : (searched ?? '');

  try {
    const market = await deps.market.coin(mint, timeframe);
    const onCurve = market.pool?.dex === 'pump-fun';
    let progress: number | null = null;
    let progressWhy = onCurve ? (deps.curveProgress === null ? 'not_reported' : 'unreadable') : 'not_reported';
    if (onCurve && market.pool !== null && deps.curveProgress !== null) {
      try {
        progress = await deps.curveProgress(market.pool.address);
      } catch (e) {
        deps.log.info('curve account unavailable', { asset: assetKey, err: e instanceof Error ? e.message : String(e) });
        progressWhy = 'not_read_yet';
      }
    }
    return json(200, {
      kind: 'read',
      timeframe,
      venue: market.pool === null ? null : onCurve ? 'curve' : 'pool',
      /* Null is "could not be read", an empty list is "no trades yet": two different facts. */
      candles: market.candles,
      trades: market.trades === null ? null : market.trades.map((t) => ({
        tx: t.tx,
        side: t.side,
        tokenAmount: measured(t.tokenAmount, 'not_reported'),
        usd: measured(t.usd, 'not_reported'),
        priceUsd: measured(t.priceUsd, 'not_reported'),
        at: t.at === null ? { at: null, why: 'not_reported' } : { at: t.at },
        /* The wallet that made it, as the chain shows it: the page's "Mine" filter compares it to yours. */
        maker: t.maker,
      })),
      curveProgress: onCurve ? measured(progress, progressWhy) : null,
    });
  } catch (e) {
    deps.log.error('market data unavailable', { asset: assetKey, err: e instanceof Error ? e.message : String(e) });
    return json(200, { kind: 'unavailable', timeframe });
  }
}
