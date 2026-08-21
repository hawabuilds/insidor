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
import { OBSERVED_ASSET_ORIGINS } from '@insidor/contracts/asset.ts';
import type { Asset, AssetOrigin, MintTime } from '@insidor/contracts/asset.ts';
import { parseAssetKey } from '@insidor/contracts/ids.ts';
import type { AssetKey, AssetRef, ChainId, VenueId } from '@insidor/contracts/ids.ts';
import type { AssetRepo } from '@insidor/contracts/ports/store.ts';
import { coinOriginsVisibleTo } from '@insidor/contracts/story.ts';
import type { StoryOrigin } from '@insidor/contracts/story.ts';

import type { Db } from '../client.ts';
import { reBrand, toMillis, toMillisRequired, toTimestamp } from '../rows.ts';
import type { TimestampColumn } from '../rows.ts';

interface AssetRow {
  chain: string;
  address: string;
  asset_key: string;
  venue_id: string;
  origin: AssetOrigin;
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
  select chain, address, asset_key, venue_id, origin, minted_at, minted_at_source,
         minted_at_conf, minted_at_bound_s, symbol, name, image_uri, decimals, creator,
         declared_social, first_seen_at
    from public.asset
`;

/**
 * ★ THE ORIGINS THAT ARE A CLAIM ABOUT THE WORLD, as a bound parameter.
 *
 * A PARAMETER AND NOT AN INTERPOLATED LIST, and the distinction is the one this whole
 * package is tested on: nothing here assembles SQL from a value. It is also why the list
 * arrives from contracts rather than being typed into a string literal — a closed list
 * spelled twice is a closed list that drifts, and this one is already spelled in
 * contracts/src/asset.ts and in 0013's CHECK, with a test holding those two together.
 *
 * `= any(...)` rather than `<> all(...)`: an allowlist excludes a value added next year
 * by default, a denylist admits it. On a predicate whose failure mode is publishing a
 * fiction as an observation, default-exclude is the only defensible direction.
 *
 * ★ IT IS NOT THE LIST `mintedBetween` USES, AND THAT IS THE DISTINCTION THIS NOTE EXISTS
 * TO KEEP. Two reads in this file remain on the constant and they have one thing in
 * common: NEITHER HAS A STORY. `upsert` uses it to decide whether a stored origin already
 * outranks an incoming one, which is a question about the row alone; `chains()` uses it to
 * answer "which chains have we observed anything on", whose consumer is a live freshness
 * banner. Both have exactly one subject, so a constant is the whole answer.
 *
 * `mintedBetween` has two. Its subject is a STORY being matched against coins, and it
 * derives its allowlist from that story's own origin — see the method. Carrying this
 * constant there cost six seeded stories every seeded coin they exist to demonstrate. The
 * rule that tells the two cases apart is short: if the read has a story, the story decides;
 * if it has none, this list does.
 */
const OBSERVED_ORIGINS: readonly string[] = [...OBSERVED_ASSET_ORIGINS];

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
           chain, address, asset_key, venue_id, origin,
           minted_at, minted_at_source, minted_at_conf, minted_at_bound_s,
           symbol, name, image_uri, decimals, creator, declared_social, first_seen_at
         ) values ($1,$2,$3,$4,$17,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15)
         on conflict (chain, address) do update set
           venue_id = excluded.venue_id,
           /*
            * ★ ORIGIN ONLY EVER MOVES TOWARDS A CLAIM ABOUT THE WORLD, NEVER AWAY FROM
            * ONE. The third rule in this file that may only travel in one direction, and
            * it is the same shape as the other two: mint time only ever rises in
            * confidence, and a coverage window only ever moves towards admitting we did
            * not see something.
            *
            * The transition that must be impossible is a seed re-running over an asset
            * the socket has already observed and relabelling it a fixture — which would
            * take a real coin off the launches rail, silently, and leave no evidence
            * that it had ever been there. So a stored origin that is already a claim
            * about the world is never overwritten.
            *
            * The transition that IS allowed is the other one: a row we could not
            * previously vouch for becomes an observation the moment a transport actually
            * delivers it. Refusing that would keep a genuinely observed coin invisible
            * forever because a demo once used its address.
            *
            * Two observed origins do not displace each other: which kind of contact we
            * FIRST had is the fact, exactly as venue_id is "the market it was FIRST
            * seen on" and first_seen_at is when we first looked.
            *
            * ★ SPELLED WITH THE ALLOWLIST AND NOTHING ELSE. The rule is "the incoming
            * origin is a claim about the world and the stored one is not", which needs
            * only the one list — so no value outside it is named here, in SQL, in a
            * second place that could drift from contracts.
            */
           origin = case
             when excluded.origin = any($18::text[])
              and public.asset.origin <> all($18::text[])
             then excluded.origin
             else public.asset.origin
           end,
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
          /* $17, out of order because it was added after the other sixteen and
             renumbering fifteen placeholders to keep them tidy is how an off-by-one
             lands in a column somebody else's row depends on. The column list above
             says where it goes. */
          asset.origin,
          OBSERVED_ORIGINS,
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
   *
   * ★ AND `origin = any(...)` IS THE MOST CONSEQUENTIAL LINE IN THIS FILE. This is
   * the retrieval that resolve scores and that a label is eventually written
   * against, so a fixture admitted here does not merely appear on a screen — it
   * becomes a training label about a coin that never existed, inside an
   * append-only table, attached to a real story. Everything downstream would then
   * be learning from our own demonstration data with nothing anywhere recording
   * that it had. That is the furthest a fiction can travel in this system, and the
   * predicate is what makes the journey impossible rather than unlikely.
   *
   * ★ THE LIST IS DERIVED FROM THE STORY AND IS NOT `OBSERVED_ORIGINS`, AND THAT
   * CORRECTION IS WHY THIS PARAGRAPH EXISTS. The sentence above is right about the
   * danger and was wrong about the predicate, in exactly the way the launches rail's
   * fix was wrong when it was copied here: it names ONE subject. "Is this coin
   * observed" has a constant for an answer. "May this coin be compared against THIS
   * story" does not, because a story has a provenance of its own — and answering the
   * first question in place of the second told the six seeded stories that their own
   * seeded coins did not exist.
   *
   * Measured on this store, through this method, before the correction: every fixture
   * story retrieved 43 candidates where its window held 51–54, and st_pigeon retrieved
   * 0 where its window held 2 — which the runner wrote into an append-only decision log
   * as `V3_no_candidates`, a permanent record asserting there was nothing to compare
   * against for a story there was something to compare against. `none` is the branch
   * that puts CREATE on a row one surface over, and here it is the branch that freezes a
   * false negative into the training set. Both are the dangerous direction.
   *
   * So the allowlist is `coinOriginsVisibleTo(storyOrigin)` and it is DIRECTIONAL. An
   * observed story still gets exactly the list this method used to hardcode — the
   * paragraph above is untouched for that case, and a fixture reaching a real story's
   * candidate set is still impossible. What changed is that a fixture story now gets the
   * fixtures too, which is not a hole: a demonstration that names a demonstration coin is
   * a demonstration, and the label it would eventually produce is a label about a story
   * the same column marks as invented. The asymmetry is the rule; see contracts.
   *
   * The parameter is required rather than defaulted, for the reason 0016 gives the column
   * itself: a caller that has not decided must fail rather than be handed the answer that
   * quietly deletes a story's coins.
   */
  async mintedBetween(
    chain: ChainId,
    fromMs: Millis,
    toMs: Millis,
    limit: number,
    storyOrigin: StoryOrigin,
  ): Promise<readonly Asset[]> {
    const rows = await this.#db.query<AssetRow>(
      `${SELECT_ASSET}
        where chain = $1
          and minted_at between $2 and $3
          and minted_at_conf <> 'unknown'
          and origin = any($5::text[])
        order by minted_at asc
        limit $4`,
      /* Spread into a mutable array because it is about to be a bound parameter and
         nothing here interpolates a value into SQL — the same rule the constant above
         is written to obey, applied to a list that is now computed per call. */
      [chain, toTimestamp(fromMs), toTimestamp(toMs), limit, [...coinOriginsVisibleTo(storyOrigin)]],
    );
    return rows.map(toAsset);
  }

  /**
   * Every chain we hold an OBSERVED asset on.
   *
   * ★ IT EXISTS SO NO SERVICE HAS TO NAME ONE. `mintedBetween` is keyed by chain, and
   * a caller that has to supply a chain id has to get it from somewhere — which in
   * practice means a chain's name typed into a service, which is the first step of the
   * leak `tools/check-vocabulary.mjs` exists to stop one layer up. Asking the store
   * which chains it actually holds keeps the name in the only place that has ever seen
   * it: the rows themselves.
   *
   * ★ AND `origin = any(...)` IS HERE BECAUSE THE ANSWER REACHES A LIVE SURFACE. This
   * looks like the one read of this table where provenance could not matter — it returns
   * chain names, not coins. It matters because of what the launches projector does with
   * them: it asks `lastHeardAt` for EVERY chain this returns and takes the MINIMUM, so a
   * chain we have never heard a mint on collapses the rail's freshness fact to "nothing
   * has ever been heard on this feed". A seed that wrote one fixture on a second chain
   * would therefore put a permanent "no coin mint has ever been heard" banner over a rail
   * whose real feed was streaming — a fiction changing what a live surface says about the
   * world, which is the whole class of bug 0013 exists to close, arriving through a column
   * that is not even selected here.
   *
   * It fails in the safe direction (a banner too many, never a lit pip over a dead feed),
   * and that is not a reason to leave it: an unfilterd read of this table is a hole whether
   * or not today's data walks through it. The allowlist, for the reason it is an allowlist
   * everywhere else — a denylist admits every origin added after it was written.
   *
   * The consequence for `mintedBetween`'s callers is only that they stop asking about a
   * chain on which every candidate would have been filtered out anyway.
   *
   * Ordered so a caller iterating them does the same work in the same order twice,
   * which matters when the caller is a loop whose output is a decision row.
   */
  async chains(): Promise<readonly ChainId[]> {
    const rows = await this.#db.query<{ chain: string }>(
      `select distinct chain
         from public.asset
        where origin = any($1::text[])
        order by chain`,
      [OBSERVED_ORIGINS],
    );
    return rows.map((row) => reBrand<ChainId>(row.chain));
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

  /**
   * When we last actually HEARD something on this chain's mint stream.
   *
   * ★ `and not gap` IS THE WHOLE CORRECTNESS ARGUMENT AND IT IS EASY TO MISS. The
   * obvious move is to reuse `latestCoverage` above — it already returns the
   * `window_to` of the most recent row, and on today's data the two answers are the
   * same instant. Do not. `latestCoverage` orders across ALL rows INCLUDING gap rows,
   * and it is right to: its question is "how far did we get, so where do we resume",
   * and a gap row is still a record of where we got to.
   *
   * But a gap row's `window_to` ADVANCES WHILE NOTHING WAS HEARD. So a watcher that
   * reconnects and immediately records a six-day gap [T, now] pushes `latestCoverage`
   * to `now`, and a freshness signal built on it would announce the feed live over
   * exactly the interval we had just declared dark. It would lie precisely when it
   * matters, and it would do so on the one surface built to stop that.
   *
   * Two different questions — "where do I resume" and "when did we last hear
   * anything" — so two reads. The divergence is not hypothetical: this store already
   * holds nine gap rows beside its 133 observed ones.
   *
   * Null means nothing has EVER been observed on this chain, which is a different
   * fact from "we heard nothing lately" and the caller has to keep them apart.
   */
  async lastHeardAt(chain: ChainId): Promise<Millis | null> {
    const rows = await this.#db.query<{ last_heard_at: TimestampColumn }>(
      `select max(window_to) as last_heard_at
         from internal.mint_coverage
        where chain = $1
          and not gap`,
      [chain],
    );
    /* `max()` over no rows is ONE row holding null, not zero rows — so "nothing was
       ever observed" arrives as a null column, while "the table was not reached at
       all" would arrive as a missing row. Both are the same answer to this question
       and both have to collapse to it, which is what the `?? null` is for. */
    return toMillis(rows[0]?.last_heard_at ?? null);
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
    origin: row.origin,
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
