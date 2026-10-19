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
import type { LastAnswer, MarketReading } from './reading.ts';

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
  hour: PictureHour | null = null,
  weighing: OlderCandidates | null = null,
): Promise<readonly AssetRow[]> {
  const pictured = hour === null ? [] : await picturedAtTheHour(db, chain, hour);
  const older = weighing === null ? [] : await olderCandidates(db, chain, weighing);
  const rest = await onScreenThenNewest(db, chain, limit);
  /* The older coins a pick is weighing, then the hour's coins, go first among the newest, never
     ahead of the coins on screen: those are what a card shows. Each list has its own limit, and the
     pass its bound. */
  const seen = new Set<string>();
  const out: AssetRow[] = [];
  for (const row of [...rest.filter((r) => r.tier === 0), ...older, ...pictured, ...rest.filter((r) => r.tier !== 0)]) {
    if (seen.has(row.address) || out.length >= limit) continue;
    seen.add(row.address);
    out.push({ chain: row.chain, address: row.address });
  }
  return out;
}

/** The older coins the one-coin pick is weighing (Policy.oneCoin.existing): found since `nowMs - withinMs`, at most `limit`. */
export interface OlderCandidates {
  readonly nowMs: number;
  readonly withinMs: number;
  readonly limit: number;
}

/**
 * ★ AN OLDER COIN A PICK IS WEIGHING IS READ WHILE IT IS WEIGHED. The one-coin pick (services/runner
 * work/one-coin.ts) adds, for each new post, the older coins its names tie, and judges them on market
 * readings when the trade feed cannot measure them (a coin off its curve). But the newest-first bound
 * reads a coin only in its first minutes, and an older coin is not on a card until it is picked: on
 * 19 Oct "Rip Kim Jong-Un" had no reading for 22 hours, so the rule could never see it trade. This
 * reads the second path's candidates found in the last `withinMs` (the pick's watch), newest found
 * first, at most `limit` a pass. A failed read here is an empty list: the pass reads its usual coins.
 */
async function olderCandidates(db: Db, chain: string, w: OlderCandidates): Promise<readonly (AssetRow & { tier: number })[]> {
  try {
    return await db.query<AssetRow & { tier: number }>(
      `select a.chain, a.address, 3 as tier
         from (select address, max(found_at) as found from internal.one_coin_candidate
                where path = 'existing' and found_at >= $2::timestamptz - make_interval(secs => $3::double precision / 1000)
                group by address) c
         join public.asset a on a.chain = $1 and a.address = c.address
        where a.origin = any($5::text[])
        order by c.found desc, a.asset_key asc
        limit $4`,
      [chain, new Date(w.nowMs).toISOString(), w.withinMs, w.limit, [...OBSERVED_ASSET_ORIGINS]],
    );
  } catch {
    return [];
  }
}

/** Which pictured coins to read once after their first hour (Policy.coinVectors.untraded). */
export interface PictureHour {
  readonly nowMs: number;
  readonly afterLaunchMs: number;
  readonly withinMs: number;
  readonly limit: number;
}

/**
 * ★ A PICTURED COIN IS READ ONCE AFTER ITS FIRST HOUR. The owner's rule for coin picture vectors
 * (tools/archive-coin-vectors.ts) needs to know whether each coin traded in its first hour, and the
 * newest-first bound above reads a coin only in its first few minutes: on 16 Oct, 7,307 of 11,430
 * pictured coins had no reading after their hour, so their vectors could not be decided and stayed.
 * This adds the coins with a picture vector that passed their hour in the last `withinMs` and have
 * no reading since, oldest hour first, at most `limit` a pass (about 40 at the busiest). A failed
 * read here is an empty list: the pass reads its usual coins.
 */
async function picturedAtTheHour(db: Db, chain: string, hour: PictureHour): Promise<readonly (AssetRow & { tier: number })[]> {
  try {
    return await db.query<AssetRow & { tier: number }>(
      `select a.chain, a.address, 2 as tier
         from public.asset a
        where a.chain = $1
          and a.origin = any($6::text[])
          and a.minted_at <= $2::timestamptz - make_interval(secs => $3::double precision / 1000)
          and a.minted_at >= $2::timestamptz - make_interval(secs => ($3::double precision + $4::double precision) / 1000)
          and exists (select 1 from internal.image_embedding e where e.subject_kind = 'asset' and e.subject_id = a.asset_key)
          and not exists (select 1 from public.market_reading m
                           where m.chain = a.chain and m.address = a.address
                             and m.taken_at >= a.minted_at + make_interval(secs => $3::double precision / 1000))
        order by a.minted_at asc, a.asset_key asc
        limit $5`,
      [chain, new Date(hour.nowMs).toISOString(), hour.afterLaunchMs, hour.withinMs, hour.limit, [...OBSERVED_ASSET_ORIGINS]],
    );
  } catch {
    return [];
  }
}

async function onScreenThenNewest(db: Db, chain: string, limit: number): Promise<readonly (AssetRow & { tier: number })[]> {
  /* ★ THE COINS ON SCREEN COME FIRST. The newest-first bound reads about five minutes of
     mints, and a coin on a For You or Popular card is usually older than that — measured on
     2026-10-13, the six coins on the cards ranked 7,864th to 10,603rd newest, so they were
     read once when they were new and then never again, and every card showed a stale
     absence and no Buy. So every coin a projected feed or board names (`coinId`, at any
     depth of its payload) is read first, then the newest fill the rest of the bound. The
     origin allowlist holds on both halves.

     ★ AND EVERY LIVE NARRATIVE'S PAGE (October 2026). The Narratives card's coin line shows its
     coin's market cap, and a narrative's coin (`coins`, `topCoin`) is on its page, not on the
     board's row, so it was read only while new: on 18 Oct every top coin on the tab said
     "not read yet" and each phone read every card's market from the token chart instead, every
     four seconds. A live narrative is one not marked dead, observed; about 25 coins. They join the
     coins on screen in the same bounded pass and cost no call of their own. */
  return db.query<AssetRow & { tier: number }>(
    `with on_screen as (
       select distinct c #>> '{}' as asset_key
         from (select payload from public.rising_row
               union all
               select payload from public.board_row
               union all
               select payload from public.story_view
                where dead is not true and payload #>> '{provenance,kind}' = 'observed') p,
              jsonb_path_query(p.payload, 'strict $.**.coinId') c
     ),
     screen as (
       select a.chain, a.address, a.asset_key, a.first_seen_at, 0 as tier
         from public.asset a
         join on_screen s on s.asset_key = a.asset_key
        where a.chain = $1
          and a.origin = any($3::text[])
     ),
     newest as (
       select chain, address, asset_key, first_seen_at, 1 as tier
         from public.asset
        where chain = $1
          and origin = any($3::text[])
        order by first_seen_at desc, asset_key asc
        limit $2
     )
     select chain, address, tier
       from (select * from screen
             union all
             select * from newest where asset_key not in (select asset_key from screen)) picked
      order by tier, first_seen_at desc, asset_key asc
      limit $2`,
    /* A bound parameter and never an interpolated list, the rule this whole file holds
       to. The list arrives from contracts, where 0013's CHECK is held to it by a test,
       rather than being typed into the string above as a fifth copy of one closed list. */
    [chain, limit, [...OBSERVED_ASSET_ORIGINS]],
  );
}

/**
 * Each coin's latest stored trade answer, so the pass can reuse the aggregator's answer
 * instead of asking again (reading.ts `reusableRoute`). The same latest-per-asset seek the
 * projector makes, on `market_reading_latest_idx`.
 */
export async function lastAnswers(db: Db, assetKeys: readonly string[]): Promise<ReadonlyMap<string, LastAnswer>> {
  const out = new Map<string, LastAnswer>();
  if (assetKeys.length === 0) return out;
  const rows = await db.query<{ asset_key: string; taken_at: Date | string; tradable: boolean; quoted_by: string | null }>(
    `select distinct on (asset_key) asset_key, taken_at, tradable, quoted_by
       from public.market_reading
      where asset_key = any($1::text[])
      order by asset_key, taken_at desc`,
    [assetKeys],
  );
  for (const r of rows) {
    out.set(r.asset_key, { takenAt: new Date(r.taken_at).getTime(), tradable: r.tradable, quotedBy: r.quoted_by });
  }
  return out;
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
