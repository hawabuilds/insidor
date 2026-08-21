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

import { OBSERVED_ASSET_ORIGINS } from '@insidor/contracts/asset.ts';
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
 *
 * ★ AND `origin = any(...)` IS HERE BECAUSE THIS IS THE ONE PLACE A FICTION LEAVES THE
 * DATABASE AND TOUCHES THE OUTSIDE WORLD. Every other allowlist in this repository stops
 * an invented row reaching a screen. This one stops it reaching a VENDOR: whatever this
 * statement returns is chunked into `read.states` and sent to dexscreener as a list of
 * addresses to price. A row the database records as written by a seed is not a coin, and
 * asking a real venue what it is worth is a category error before it is anything else.
 *
 * ★ IT IS THE SAME MECHANISM AS THE LAUNCHES RAIL, AND THAT IS WHY THE ORDER MATTERS.
 * The seed stamps `first_seen_at` at load time, so its fixtures are always the NEWEST rows
 * in the table — and this statement's ordering is `first_seen_at desc`. Measured on this
 * store: the thirteen fixtures occupy ranks 1 through 56 of 248, so they are not merely
 * inside the cap, they are the FIRST thing it buys. `MAX_ADDRESSES_PER_CALL` chunks in
 * order, which makes them the first call of the pass. The endpoint behind this is
 * rate-limited at about eleven sequential calls, so on any store where the asset count
 * exceeds `maxAssetsPerPass` the fictions are spent first and real coins are the ones
 * dropped at the bound. The bug is latent at 248 rows and structural at 301.
 *
 * ★ AND ONE OF THEM CAME BACK PRICED, WHICH IS THE PART THAT IS NOT MERELY WASTE.
 * `solana:Df6yfrKC8kZE3KNkrHERKzAetSxbrWeniQfyJY4Jpump` is in the seed's fixture list AND
 * is a real mainnet address, so the vendor answered it: this store holds a
 * `public.market_reading` row carrying a genuine $12.1M market cap and $1.27M of
 * liquidity, taken live, filed against an asset whose `origin` says it was invented. That
 * row is real data wearing a fiction's provenance, and it is exactly the pairing every
 * origin filter in this repository exists to make unsayable — arriving from the direction
 * nobody was watching, because the fiction went OUT rather than a fiction coming in.
 *
 * ★ THERE IS NO STORY HERE, SO THE CONSTANT IS THE WHOLE ANSWER — and that is the line
 * between this filter and the one `mintedBetween` had to give up. This statement's subject
 * is a coin alone: "is this row a claim about the world" has one answer and it is
 * `OBSERVED_ASSET_ORIGINS`. A read whose subject is a STORY has two subjects and must
 * derive its list from the story instead; carrying a constant into one of those is the
 * bug 0016 was written to close. If the read has a story, the story decides; if it has
 * none, this list does.
 *
 * A fixture keeps whatever absence it already had, which is the correct and honest
 * outcome: nothing has read this coin, because it is not a coin. The allowlist rather than
 * `<> 'fixture'` for the reason it is an allowlist everywhere else — a denylist admits
 * every origin invented after it was written, `unrecorded` included, and "we cannot vouch
 * for this row" is not a licence to spend money asking a vendor about it.
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
        and origin = any($3::text[])
      order by first_seen_at desc, asset_key asc
      limit $2`,
    /* A bound parameter and never an interpolated list, the rule this whole file holds
       to. The list arrives from contracts, where 0013's CHECK is held to it by a test,
       rather than being typed into the string above as a fifth copy of one closed list. */
    [chain, limit, [...OBSERVED_ASSET_ORIGINS]],
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
