/**
 * THE ONE COIN OF THE WHOLE "TWITTER WORLD WAR" (the owner, 2026-10-24: "build the world war coin on
 * the card"), as GET /narratives/:view/fights carries it for the war's card and its sheet.
 *
 * Which coin is the owner's call ("Coin for Twitter World War", services/social owner-narrative.ts),
 * read through public.war_coin (0134), which hands this role exactly that coin's facts and its newest
 * raw market reading. The reading is raw, so the freshness rule the projector applies to every card's
 * coin (services/project project.ts `currentMarket`, Policy.market.readingFreshnessMs) is applied
 * here: a reading older than that is "not read yet" and not tradable, never a cap that was true an
 * hour ago. Each number travels in the wire's `{ v, why }` shape, an absence with its reason.
 *
 *   warCoin: { address, ticker, name, imageUrl, marketCapUsd, priceChange24h, tradable } | null
 *
 * null when no coin is chosen (no row), and also when the view cannot be read (a database before
 * 0134): the card then shows no coin, which is what it showed before, and the war's narratives are
 * still sent.
 *
 * Its own file so the war's coin can be found, and removed, in one place, and tested with no database.
 *
 * What breaks if changed carelessly: dropping the freshness check. The market reader reads this coin
 * every pass (services/market db.ts), but on the day it stops, the card would show the last cap it
 * read as today's, beside a Buy.
 */

import { DEFAULT_POLICY } from '@insidor/contracts';

import type { Db } from './queries.ts';

export const WAR_COIN_SQL = `select address, symbol, name, image_uri, market_cap_usd, market_cap_absent,
       price_change_24h_pct, price_change_24h_absent, tradable,
       (extract(epoch from taken_at) * 1000)::float8 as taken_ms
  from public.war_coin limit 1`;

interface Row {
  readonly address: string;
  readonly symbol: string | null;
  readonly name: string | null;
  readonly image_uri: string | null;
  readonly market_cap_usd: number | string | null;
  readonly market_cap_absent: string | null;
  readonly price_change_24h_pct: number | string | null;
  readonly price_change_24h_absent: string | null;
  readonly tradable: boolean | null;
  readonly taken_ms: number | string | null;
}

type WireNumber = { readonly v: number } | { readonly v: null; readonly why: string };

export interface WarCoin {
  readonly address: string;
  readonly ticker: string | null;
  readonly name: string | null;
  readonly imageUrl: string | null;
  readonly marketCapUsd: WireNumber;
  readonly priceChange24h: WireNumber;
  readonly tradable: boolean;
}

const num = (v: number | string | null): number | null => {
  if (v === null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** One reading's number: the amount, or the venue's reason; an old or missing reading is "not read yet". */
function wireNumber(value: number | string | null, absent: string | null, current: boolean): WireNumber {
  if (!current) return { v: null, why: 'not_read_yet' };
  const n = num(value);
  return n !== null ? { v: n } : { v: null, why: absent ?? 'not_read_yet' };
}

/** The row as the wire carries it, the freshness rule applied at `nowMs`. */
export function warCoinOf(row: Row, nowMs: number, freshnessMs: number = DEFAULT_POLICY.market.readingFreshnessMs): WarCoin {
  const taken = num(row.taken_ms);
  const current = taken !== null && nowMs - taken <= freshnessMs;
  return {
    address: row.address,
    ticker: row.symbol === null || row.symbol === '' ? null : row.symbol,
    name: row.name === null || row.name === '' ? null : row.name,
    imageUrl: row.image_uri !== null && /^https:\/\//.test(row.image_uri) ? row.image_uri : null,
    marketCapUsd: wireNumber(row.market_cap_usd, row.market_cap_absent, current),
    priceChange24h: wireNumber(row.price_change_24h_pct, row.price_change_24h_absent, current),
    tradable: current && row.tradable === true,
  };
}

/** The war's coin now, or null when none is chosen or it cannot be read. */
export async function readWarCoin(db: Db, nowMs: number): Promise<WarCoin | null> {
  try {
    const [row] = (await db.query(WAR_COIN_SQL, [])) as readonly Partial<Row>[];
    return row === undefined || typeof row.address !== 'string' ? null : warCoinOf(row as Row, nowMs);
  } catch {
    return null;
  }
}
