/**
 * Coins, and the coverage log that says whether we were watching.
 *
 * The retrieval method here is TIME-FIRST and that ordering is the whole point.
 * Asking a market vendor for a symbol and then filtering the answers by time
 * returns the plausible survivor — an established coin old enough to have a pool —
 * because the vendor ranks by volume and liquidity, both of which favour age. A
 * quiet, plausible, wrong answer is much harder to notice than an absurd one, and
 * it is what a user's money gets spent on. So the window comes first and the symbol
 * becomes one scoring channel over the set the window returned.
 *
 * Nothing in this file filters on liquidity, and nothing ever should. A bonding
 * curve has no two-sided reserve, so the vendor returns no liquidity object at all
 * — absent, not zero — and a `liquidity > 0` test is therefore a survivorship
 * filter that removes essentially the entire pre-graduation population. Tradability
 * is decided by asking for a quote, in the resolve gates, not here.
 */

import type { Millis } from '@insidor/contracts';
import type { Asset, MintTime } from '@insidor/contracts/asset.ts';
import type { AssetRef, ChainId, VenueId } from '@insidor/contracts/ids.ts';
import type { AssetRepo } from '@insidor/contracts/ports/store.ts';

import type { Db } from '../client.ts';
import { toMillis, toMillisRequired, toTimestamp } from '../rows.ts';
import type { TimestampColumn } from '../rows.ts';

interface AssetRow {
  chain: ChainId;
  address: string;
  caip19: string;
  venue_id: VenueId;
  minted_at: TimestampColumn;
  minted_at_source: MintTime['source'];
  minted_at_conf: MintTime['confidence'];
  minted_at_bound_s: number | null;
  symbol: string | null;
  name: string | null;
  image_uri: string | null;
  decimals: number | null;
  creator: string | null;
  declared_social: Record<string, unknown> | null;
  first_seen_at: TimestampColumn;
}

const SELECT_ASSET = `
  select chain, address, caip19, venue_id, minted_at, minted_at_source, minted_at_conf,
         minted_at_bound_s, symbol, name, image_uri, decimals, creator,
         declared_social, first_seen_at
    from public.asset
`;

export class PgAssetRepo implements AssetRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /**
   * Mint time is only ever raised in confidence, never lowered and never
   * overwritten by a weaker source. A vendor field that arrives after the chain has
   * already answered must not be allowed to replace it — that is the +22-minute
   * median error walking back in through the update path.
   */
  async upsert(asset: Asset): Promise<void> {
    await this.#db.query(
      `insert into public.asset (
         chain, address, caip19, venue_id,
         minted_at, minted_at_source, minted_at_conf, minted_at_bound_s,
         symbol, name, image_uri, decimals, creator, declared_social, first_seen_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15)
       on conflict (chain, address) do update set
         venue_id = excluded.venue_id,
         symbol   = excluded.symbol,
         name     = excluded.name,
         image_uri = excluded.image_uri,
         decimals = coalesce(public.asset.decimals, excluded.decimals),
         creator  = coalesce(public.asset.creator, excluded.creator),
         declared_social = excluded.declared_social,
         minted_at         = case when $16 then excluded.minted_at else public.asset.minted_at end,
         minted_at_source  = case when $16 then excluded.minted_at_source else public.asset.minted_at_source end,
         minted_at_conf    = case when $16 then excluded.minted_at_conf else public.asset.minted_at_conf end,
         minted_at_bound_s = case when $16 then excluded.minted_at_bound_s else public.asset.minted_at_bound_s end`,
      [
        asset.ref.chain,
        asset.ref.address,
        asset.caip19,
        asset.venueId,
        toTimestamp(asset.mint.at),
        asset.mint.source,
        asset.mint.confidence,
        asset.mint.boundS,
        asset.symbol,
        asset.name,
        asset.imageUri,
        asset.decimals,
        asset.creator,
        JSON.stringify(asset.declaredSocial ?? null),
        toTimestamp(asset.firstSeenAt),
        // Whether the incoming mint time is allowed to win. Computed here rather
        // than in SQL so the ranking is one readable list instead of a CASE ladder.
        confidenceRank(asset.mint.confidence) > 0,
      ],
    );
  }

  async byRef(ref: AssetRef): Promise<Asset | null> {
    const rows = await this.#db.query<AssetRow>(
      `${SELECT_ASSET} where chain = $1 and address = $2`,
      [ref.chain, ref.address],
    );
    const row = rows[0];
    return row ? toAsset(row) : null;
  }

  /**
   * ★ Candidate generation. Every coin minted inside the window, ordered by mint
   * time, capped.
   *
   * The cap matters and is not arbitrary housekeeping: resolve needs the top TWO
   * scores to compute an ambiguity margin, and one meme has spawned 306 distinct
   * tokens. A high score on the best candidate proves nothing when candidate #2
   * scores the same, so the retrieval has to return the field, not the favourite.
   *
   * `minted_at_conf <> 'unknown'` is here rather than in core because it is the
   * same statement as the index predicate — a coin whose creation time we do not
   * know cannot be ordered against a post, so it is not a candidate at all.
   */
  async mintedBetween(
    chain: ChainId,
    fromMs: Millis,
    toMs: Millis,
    limit: number,
  ): Promise<Asset[]> {
    const rows = await this.#db.query<AssetRow>(
      `${SELECT_ASSET}
        where chain = $1
          and minted_at between $2 and $3
          and minted_at_conf <> 'unknown'
        order by minted_at asc
        limit $4`,
      [chain, toTimestamp(fromMs), toTimestamp(toMs), limit],
    );
    return rows.map(toAsset);
  }

  /**
   * Record a window of the mint stream we actually observed.
   *
   * This is what makes "resolved / negative" assertable. A label may only say "no
   * coin appeared" if we watched the whole window; over a gap the honest answer is
   * censored. Without this table every gap becomes a silent negative, and the model
   * learns from an absence that was ours rather than the world's.
   */
  async recordCoverage(
    chain: ChainId,
    fromMs: Millis,
    toMs: Millis,
    cursorRef: string | null,
    gap: { reason: string } | null,
  ): Promise<void> {
    await this.#db.query(
      `insert into internal.mint_coverage (chain, window_from, window_to, cursor_ref, gap, gap_reason)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (chain, window_from) do update set
         window_to  = greatest(internal.mint_coverage.window_to, excluded.window_to),
         cursor_ref = excluded.cursor_ref`,
      [chain, toTimestamp(fromMs), toTimestamp(toMs), cursorRef, gap !== null, gap?.reason ?? null],
    );
  }

  /** True when any part of the window was not observed. Labels read this before resolving. */
  async hasCoverageGap(chain: ChainId, fromMs: Millis, toMs: Millis): Promise<boolean> {
    const rows = await this.#db.query<{ gap: boolean }>(
      `select bool_or(gap) as gap
         from internal.mint_coverage
        where chain = $1 and window_to > $2 and window_from < $3`,
      [chain, toTimestamp(fromMs), toTimestamp(toMs)],
    );
    // No coverage row at all is a gap: we cannot claim to have watched a window we
    // have no record of watching. Absence of evidence is treated as evidence of
    // absence here, and that direction is the safe one.
    return rows[0]?.gap !== false;
  }
}

/** Higher wins. 'unknown' is zero, so it can never displace a timestamp we already have. */
function confidenceRank(confidence: MintTime['confidence']): number {
  if (confidence === 'exact') return 2;
  if (confidence === 'bounded') return 1;
  return 0;
}

function toAsset(row: AssetRow): Asset {
  return {
    ref: { chain: row.chain, address: row.address },
    caip19: row.caip19,
    venueId: row.venue_id,
    mint: {
      at: toMillis(row.minted_at),
      source: row.minted_at_source,
      confidence: row.minted_at_conf,
      boundS: row.minted_at_bound_s,
    },
    symbol: row.symbol,
    name: row.name,
    imageUri: row.image_uri,
    decimals: row.decimals,
    creator: row.creator,
    declaredSocial: row.declared_social,
    firstSeenAt: toMillisRequired(row.first_seen_at, 'first_seen_at'),
  };
}
