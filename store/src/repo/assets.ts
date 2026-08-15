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
import { parseAssetKey } from '@insidor/contracts/ids.ts';
import type { AssetKey, AssetRef, ChainId, VenueId } from '@insidor/contracts/ids.ts';
import type { AssetRepo } from '@insidor/contracts/ports/store.ts';

import type { Db } from '../client.ts';
import { reBrand, toMillis, toMillisRequired, toTimestamp } from '../rows.ts';
import type { TimestampColumn } from '../rows.ts';

interface AssetRow {
  chain: string;
  address: string;
  asset_key: string;
  venue_id: string;
  minted_at: TimestampColumn;
  minted_at_source: MintTime['source'];
  minted_at_conf: MintTime['confidence'];
  minted_at_bound_s: number | null;
  symbol: string | null;
  name: string | null;
  image_uri: string | null;
  decimals: number | null;
  creator: string | null;
  /**
   * jsonb, and `unknown` rather than a shape. Everything in this column was typed
   * by whoever minted the coin; asserting a type over it here would be trusting the
   * attacker to have written the object we hoped for. It is narrowed on the way out.
   */
  declared_social: unknown;
  first_seen_at: TimestampColumn;
}

/**
 * The trust rank of the mint time ALREADY STORED, as a SQL expression.
 *
 * Every write compares the incoming rank against this one and loses ties, so mint
 * time only ever goes up. A vendor field arriving after the chain has answered is
 * the +22-minute median error trying to walk back in through the update path, and
 * `case when incoming > stored` is the one line that refuses it.
 */
const EXISTING_RANK =
  "(case public.asset.minted_at_conf when 'exact' then 2 when 'bounded' then 1 else 0 end)";

const SELECT_ASSET = `
  select chain, address, asset_key, venue_id, minted_at, minted_at_source, minted_at_conf,
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
  async upsert(assets: readonly Asset[]): Promise<number> {
    for (const asset of assets) {
      await this.#db.query(
        `insert into public.asset (
           chain, address, asset_key, venue_id,
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
           minted_at         = case when $16::int > ${EXISTING_RANK} then excluded.minted_at else public.asset.minted_at end,
           minted_at_source  = case when $16::int > ${EXISTING_RANK} then excluded.minted_at_source else public.asset.minted_at_source end,
           minted_at_conf    = case when $16::int > ${EXISTING_RANK} then excluded.minted_at_conf else public.asset.minted_at_conf end,
           minted_at_bound_s = case when $16::int > ${EXISTING_RANK} then excluded.minted_at_bound_s else public.asset.minted_at_bound_s end`,
        [
          asset.ref.chain,
          asset.ref.address,
          asset.key,
          asset.venue,
          toTimestamp(asset.mintedAt.at),
          asset.mintedAt.source,
          asset.mintedAt.confidence,
          asset.mintedAt.boundS,
          asset.symbol,
          asset.name,
          asset.imageUri,
          asset.decimals,
          asset.creator,
          JSON.stringify(asset.declaredSocial),
          toTimestamp(asset.firstSeenAt),
          // Whether the incoming mint time is allowed to win, as a rank compared
          // against the rank already stored. Computed here rather than as a CASE
          // ladder in SQL so the ordering is one readable list.
          confidenceRank(asset.mintedAt.confidence),
        ],
      );
    }
    return assets.length;
  }

  /** The retrieval the port declares: one storable key, one asset. */
  async byKey(key: AssetKey): Promise<Asset | null> {
    const ref = parseAssetKey(key);
    if (ref === null) throw new TypeError(`'${key}' is not a '<chain>:<address>' asset key`);
    return this.byRef(ref);
  }

  /**
   * Raise the confidence of a stored mint time. It only ever goes up: a vendor
   * field arriving after the chain has already answered must not replace it, which
   * is the +22-minute median error walking back in through the update path.
   */
  async setMintTime(key: AssetKey, mintedAt: MintTime): Promise<void> {
    const ref = parseAssetKey(key);
    if (ref === null) throw new TypeError(`'${key}' is not a '<chain>:<address>' asset key`);
    await this.#db.query(
      `update public.asset
          set minted_at = $3, minted_at_source = $4,
              minted_at_conf = $5, minted_at_bound_s = $6
        where chain = $1 and address = $2
          and $7::int > ${EXISTING_RANK}`,
      [
        ref.chain,
        ref.address,
        toTimestamp(mintedAt.at),
        mintedAt.source,
        mintedAt.confidence,
        mintedAt.boundS,
        confidenceRank(mintedAt.confidence),
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
  ): Promise<readonly Asset[]> {
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
    /*
     * ★ THE CONFLICT CLAUSE IS A CLAIM, NOT A MERGE, AND IT MAY ONLY EVER MOVE
     * ONE WAY: TOWARDS ADMITTING WE DID NOT SEE SOMETHING.
     *
     * Two writes landing on one `window_from` is not hypothetical — a live run
     * against the real relay produced it on the first cycle after a restart,
     * where the "stream was not connected" gap and the "no successful read for
     * Nms" gap both start at the resume watermark and so share a key exactly.
     *
     * `gap` and `gap_reason` used to be absent from this SET list, and absent is
     * not neutral. It meant an existing row won the claim while the incoming row
     * still won `window_to`, so a gap recorded over a window that already had an
     * observed row kept `gap = false` AND stretched that false row across the
     * dark interval: the one arrangement that is strictly worse than dropping
     * the write, because the record now asserts we watched precisely the seconds
     * we missed, and nothing afterwards can tell that it is wrong. Verified
     * against the live schema before this line existed: an observed [T, T+3s]
     * followed by a gap [T, T+30s] left `gap = f`, `gap_reason = null`,
     * `window_to = T+30s`.
     *
     * So the claim is OR-ed, never assigned. A window that has ever been
     * declared dark stays dark, whichever order the two writes arrive in, and a
     * later observation cannot quietly promote it back to watched. The reason
     * travels with it — a gap row whose reason had been overwritten with null
     * still censors the label, but nobody can find out why — and `cursor_ref`
     * stops being clobbered to null by a gap write that never had a position to
     * offer, which is how a resume position went missing from a row that had one.
     *
     * The direction this errs in is over-declaring darkness. That costs recall on
     * labels; the other direction costs the truth of every outcome measured over
     * the window, and buys back nothing.
     */
    await this.#db.query(
      `insert into internal.mint_coverage (chain, window_from, window_to, cursor_ref, gap, gap_reason)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (chain, window_from) do update set
         window_to  = greatest(internal.mint_coverage.window_to, excluded.window_to),
         gap        = internal.mint_coverage.gap or excluded.gap,
         gap_reason = coalesce(excluded.gap_reason, internal.mint_coverage.gap_reason),
         cursor_ref = coalesce(excluded.cursor_ref, internal.mint_coverage.cursor_ref)`,
      [chain, toTimestamp(fromMs), toTimestamp(toMs), cursorRef, gap !== null, gap?.reason ?? null],
    );
  }

  /**
   * The most recent coverage window on a chain, with the cursor position recorded
   * against it.
   *
   * This is how the mint watcher resumes, and it is why there is no cursor table:
   * `cursor_ref` is a column on the coverage row, so a resume position always
   * arrives attached to the window it closed. Null means this chain has never been
   * watched — which is a different fact from a watcher that restarted and lost its
   * place, and the caller has to be able to tell them apart: the first has no
   * earlier window to have missed, the second does, and that silence is a gap.
   *
   * ★ ORDERED BY `window_to`, NOT `window_from`. The question this answers is "how
   * far did we get", and that is the latest END, not the latest START. The two are
   * the same only while windows are contiguous and non-overlapping — which is the
   * arrangement the gap work has just stopped being true: a long gap row now
   * routinely spans several short observed rows, so the row that starts last and
   * the row that ends last are different rows.
   *
   * Ordering by `window_from` was not dangerous, and that is worth stating plainly
   * rather than overselling the fix: it can only ever return some existing row's
   * `window_to`, which is never beyond the true frontier, so it resumes EARLY and
   * re-reads. Re-reading is free; the opposite mistake — resuming past a window
   * nothing recorded — is the unrecoverable one, because afterwards nothing can
   * tell you which mints were never seen. It was imprecise, in the safe direction.
   *
   * The tiebreak matters because `cursor_ref` rides on the row: two rows can share
   * a `window_to` after the OR-ing upsert above, and without it which position we
   * resume from would depend on the planner.
   */
  async latestCoverage(
    chain: ChainId,
  ): Promise<{ toMs: Millis; cursorRef: string | null } | null> {
    const rows = await this.#db.query<{ window_to: TimestampColumn; cursor_ref: string | null }>(
      `select window_to, cursor_ref
         from internal.mint_coverage
        where chain = $1
        order by window_to desc, window_from desc
        limit 1`,
      [chain],
    );
    const row = rows[0];
    if (row === undefined) return null;
    return { toMs: toMillisRequired(row.window_to, 'window_to'), cursorRef: row.cursor_ref };
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
  const ref: AssetRef = { chain: reBrand<ChainId>(row.chain), address: row.address };
  return {
    ref,
    key: reBrand<AssetKey>(row.asset_key),
    chain: ref.chain,
    venue: reBrand<VenueId>(row.venue_id),
    mintedAt: {
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
    declaredSocial: toDeclaredSocial(row.declared_social),
    firstSeenAt: toMillisRequired(row.first_seen_at, 'first_seen_at'),
  };
}

/**
 * Narrow the attacker-controlled blob to the map of strings the vocabulary
 * declares. Absent is an empty map, never null — a coin that declared no links and
 * a coin whose column we failed to read are different facts, and the second one
 * throws upstream rather than arriving here. A non-string value is dropped rather
 * than coerced: `{"x": {"url": …}}` stringified into a link is how a rendered
 * anchor ends up pointing somewhere nobody chose.
 */
function toDeclaredSocial(value: unknown): Readonly<Record<string, string>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  const links: Record<string, string> = {};
  for (const [name, link] of Object.entries(value)) {
    if (typeof link === 'string') links[name] = link;
  }
  return links;
}
