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
 * ★ ONLY FOR A COIN WE ALREADY HOLD, ONE A SEARCH JUST RETURNED, OR ONE A MARKET SOURCE LISTS. An
 * address nobody indexed is looked up once by its address (search.ts `open`, for a coin someone
 * holds that our launch feed missed) under its own small limit; one no source lists is a 404, so
 * this route can never be used to make us fetch candles for an arbitrary address. A search result
 * or a looked-up coin stays openable for `search.openableMs` (search.ts). And every answer is kept
 * (see the adapter), so a crowd on one coin costs one call.
 *
 * ★ THE CHART IS THE POOL THE COIN TRADES IN, WHATEVER IT IS PAIRED WITH. The adapter picks the
 * coin's deepest pool and asks for its candles in dollars for this coin's side, so a coin paired
 * with another coin (Laura with MSTRx) draws like one paired with SOL.
 *
 * ★ AND IT SAYS WHAT THAT POOL IS (the owner, 2026-10-21: "for stock-paired tokens it should show
 * the stock it's paired with ... and show the liquidity"). `pair` is the chart's own pool: the token
 * on its other side as the market lists it (symbol, name, picture, address, and whether it is a
 * tokenised stock), the dex by its own name, and the pool's dollar reserve. Read from the same pool
 * request, so it costs no call, and it is the market's naming, never our name index's.
 *
 * ★ `coin` IS THE COIN'S OWN SYMBOL AND NAME AS THAT POOL LISTS THEM. Our name index
 * (public.coin_name, 0037) keeps a coin's first sighting forever, and the launch feed has recorded
 * the quote token of coins launched against a stock token as if it were the launched coin (MSTRx
 * is in it as "Junior USD*", NVDAx and TSLAx under other memes' names). The page shows the
 * market's name over the index's whenever the market has one.
 *
 * What breaks if changed carelessly: an outage is not an empty market. A source that failed
 * answers `{ kind: 'unavailable' }`, which the page shows as a dash with a reason — never as a
 * coin with no trades.
 */

import type { MarketData, Pool, Timeframe } from '@insidor/market-geckoterminal';
import { ownSide, pairedWith, TIMEFRAMES } from '@insidor/market-geckoterminal';

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

/** The launchpad's own dexes, its curve and its pool: a coin on either opens on the launchpad's page. */
const LAUNCHPAD_DEXES = new Set(['pump-fun', 'pumpswap']);

/**
 * Whether a token is a tokenised stock, from how the market names it: an xStock ("MicroStrategy
 * xStock", MSTRx) or an Ondo tokenised share ("Tesla (Ondo Tokenized)", TSLAon). Each family spells
 * it in the name and the symbol together, so a meme merely called "xStock" is not one.
 */
export function tokenisedStock(symbol: string | null, name: string | null): boolean {
  const s = symbol?.trim() ?? '';
  const n = name?.trim() ?? '';
  if (/\bxStock$/.test(n) && /^[A-Z][A-Z0-9.]*x$/.test(s)) return true;
  return /\(Ondo Tokeni[sz]ed\)$/i.test(n) && /^[A-Z][A-Z0-9.]*on$/.test(s);
}

/**
 * What the chart's pool is, for the page's top half: the token on its other side, where the pool
 * is, and its liquidity. A curve's reported reserve is not a pool's liquidity (read.ts
 * `primaryPool`), so on the curve liquidity is not reported here and the page keeps the coin's own.
 */
export function pairOf(pool: Pool, mint: string) {
  const other = pairedWith(pool, mint);
  const launchpad = LAUNCHPAD_DEXES.has(pool.dex);
  return {
    token: other === null ? null : {
      address: other.address,
      ticker: other.symbol,
      name: other.name,
      imageUrl: other.imageUrl,
      stock: tokenisedStock(other.symbol, other.name),
    },
    venue: {
      name: pool.dexName ?? null,
      launchpad,
      /* The launchpad's coin page on its own dexes; the pool on the explorer anywhere else. */
      url: launchpad ? `https://pump.fun/coin/${mint}` : `https://solscan.io/account/${pool.address}`,
    },
    liquidityUsd: pool.dex === 'pump-fun' ? measured(null, 'not_reported') : measured(pool.reserveUsd, 'not_reported'),
  };
}

/** The coin's own symbol and name as its pool lists them; null when the pool did not include them. */
export function coinOf(pool: Pool | null, mint: string): { ticker: string | null; name: string | null } | null {
  const own = pool === null ? null : ownSide(pool, mint);
  return own === null || (own.symbol === null && own.name === null) ? null : { ticker: own.symbol, name: own.name };
}

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
      pair: market.pool === null ? null : pairOf(market.pool, mint),
      coin: coinOf(market.pool, mint),
    });
  } catch (e) {
    deps.log.error('market data unavailable', { asset: assetKey, err: e instanceof Error ? e.message : String(e) });
    return json(200, { kind: 'unavailable', timeframe });
  }
}
