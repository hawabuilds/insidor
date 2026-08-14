/**
 * EVERY STATEMENT OF SQL IN THIS SERVICE, IN ONE FILE.
 *
 * The house rule is that store/ is the only package where SQL lives, and this bends it
 * the same way services/project/src/db.ts bends it, knowingly and in one file: 0010's
 * table has no repository behind it yet, and growing store/ two methods while another
 * change is in flight against it costs more than it buys. The intended destination is
 * named: this becomes store/src/repo/market.ts, unchanged in shape, and the move is a
 * file move rather than a rewrite. Nothing outside this file builds a query, and
 * reading.ts — where every decision is made — has no idea a database exists.
 *
 * IT RUNS AS THE SERVICE ROLE. That is the whole architecture in one line: this process
 * writes readings and cannot append to the decision log, because the connection it
 * holds has no INSERT on the schema that holds one.
 */

import type { Db } from '@insidor/store';

import { numberOf, reasonOf } from './reading.ts';
import type { MarketReading } from './reading.ts';

export interface AssetRow {
  chain: string;
  address: string;
}

/**
 * The coins to read this pass, most recently seen first.
 *
 * ★ IT IS BOUNDED, AND THE BOUND IS NOT AN OPTIMISATION. The endpoint behind this is
 * free and rate-limited, which is a budget of a different kind and exactly as spendable
 * as money: the vendor throttles after about eleven sequential calls and a pass that
 * walked the whole asset table would find that number before it found a price. So the
 * caller passes Policy.market.maxAssetsPerPass and the query obeys it.
 *
 * ORDERED BY `first_seen_at desc`, WHICH IS A CHOICE AND NOT A DEFAULT. What a bounded
 * pass leaves out is decided here, so it may as well be decided honestly: a coin nobody
 * has seen for a day is not the coin anybody is about to buy, and the product's whole
 * claim is about the first hour. `minted_at` would be the tempting key and is worse —
 * it is nullable, and 0005 exists because a coin whose mint time was never learned is
 * ordinary rather than broken. Sorting on it would push every such coin to one end of
 * the list and silently make "we never learned when this was minted" mean "we will
 * never read its price either". The tiebreak is the key, so two runs with nothing
 * changed read the same coins rather than reshuffling under the cap.
 */
export async function assetsToRead(
  db: Db,
  chain: string,
  limit: number,
): Promise<readonly AssetRow[]> {
  return db.query<AssetRow>(
    `select chain, address
       from public.asset
      where chain = $1
      order by first_seen_at desc, asset_key asc
      limit $2`,
    [chain, limit],
  );
}

/**
 * Append the readings.
 *
 * `on conflict do nothing` and NOT `do update`, and the reason is structural rather
 * than stylistic: public.market_reading carries 0001's append-only trigger, so an
 * UPDATE raises rather than writes. A row already at this (asset, instant) is the same
 * reading arriving twice — a re-run of the same pass — and the honest response to that
 * is to keep the first one. A correction is a new row at a new instant, which is the
 * one sentence this whole table is arranged around.
 *
 * ★ THERE IS NO `coalesce(..., 0)` IN THIS STATEMENT AND THERE NEVER MAY BE. Every
 * number is passed as `number | null` with its reason beside it, and the four
 * `*_xor_reason` constraints reject the row if exactly one of the pair is not set. A
 * zero written here would be indistinguishable, forever, from a coin that is genuinely
 * worth nothing.
 */
export async function writeReadings(db: Db, readings: readonly MarketReading[]): Promise<number> {
  let written = 0;
  for (const r of readings) {
    const result = await db.query<{ written: number }>(
      `insert into public.market_reading (
         chain, address, asset_key, venue_id, taken_at,
         price_usd, price_absent,
         market_cap_usd, market_cap_absent, market_cap_basis,
         liquidity_usd, liquidity_absent,
         price_change_24h_pct, price_change_24h_absent,
         tradable, quoted_by,
         source_vendor, source_endpoint
       ) values (
         $1, $2, $3, $4, $5,
         $6, $7,
         $8, $9, $10,
         $11, $12,
         $13, $14,
         $15, $16,
         $17, $18
       )
       on conflict (chain, address, taken_at) do nothing
       returning 1 as written`,
      [
        r.chain,
        r.address,
        r.assetKey,
        r.venueId,
        new Date(r.takenAt).toISOString(),
        numberOf(r.priceUsd),
        reasonOf(r.priceUsd),
        numberOf(r.marketCapUsd),
        reasonOf(r.marketCapUsd),
        r.marketCapBasis,
        numberOf(r.liquidityUsd),
        reasonOf(r.liquidityUsd),
        numberOf(r.priceChange24hPct),
        reasonOf(r.priceChange24hPct),
        r.tradable,
        r.quotedBy,
        r.sourceVendor,
        r.sourceEndpoint,
      ],
    );
    written += result.length;
  }
  return written;
}
