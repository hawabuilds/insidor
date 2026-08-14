/**
 * EVERY STATEMENT OF SQL IN THIS SERVICE, IN ONE FILE.
 *
 * The house rule is that store/ is the only package where SQL lives, and this file
 * bends it knowingly rather than quietly. Three reads the projector needs have no
 * repository behind them — `display_title` and `thumb_uri` are columns that are
 * deliberately NOT fields on `Story`, the reach series has to be fetched for many items
 * in one round trip rather than the per-item shape ObservationRepo offers, and the
 * projection tables from 0009 have no repository at all yet. The alternative was to
 * grow store/ four methods while another change is in flight against it.
 *
 * So the bend is contained to exactly one file, and the intended destination is named:
 * this becomes store/src/repo/projection.ts, unchanged in shape, and the move is a file
 * move rather than a rewrite. Nothing outside this file builds a query, and project.ts
 * — where every actual decision is made — has no idea a database exists.
 *
 * THE ROLE MATTERS AND IS THE POINT OF THE WHOLE ARCHITECTURE. This runs as the service
 * credential, which CAN read public.observation. The read service runs as the app
 * credential, which cannot — so it could not build these payloads even if someone asked
 * it to. The censoring happens once, here, behind a connection that is allowed to see
 * the ingredients, and what it leaves behind is the finished answer.
 */

import { DEFAULT_POLICY } from '@insidor/contracts';
import type {
  CensorReason,
  Fidelity,
  FingerprintKind,
  MarketAbsenceReason,
  MarketCapBasis,
  Millis,
  MintTimeConfidence,
  Rate,
} from '@insidor/contracts';
import type { MatchEvidence } from '@insidor/contracts/story.ts';
import type { Db } from '@insidor/store';

import { coinCandidates } from './coins.ts';
import { permalinkFor } from './permalinks.ts';
import type {
  CoinFacts,
  CoinMarket,
  LaunchFacts,
  MarketNumber,
  MemberFacts,
  MemberRelation,
  ReachReading,
  StoryFacts,
} from './project.ts';
import type { PendingReason, WireBoardRow, WireLaunch, WireStory } from './wire.ts';

/* ── the frame ────────────────────────────────────────────────────────── */

/**
 * The next frame number for this view.
 *
 * The client drops any frame whose tick is not greater than the one it holds, and
 * refetches authoritatively when one arrives more than a single step ahead. So this is
 * `previous + 1` and nothing else — a timestamp here would make every frame look like a
 * dropped frame and turn the live channel into a permanent refetch loop.
 *
 * `tick` is a bigint, which pg hands back as a string rather than a number so that a
 * value past 2^53 is not silently rounded. Number() is safe at these magnitudes and
 * would not be at that one; the day it is not, this becomes a bigint end to end.
 */
export async function nextTick(db: Db, viewId: string): Promise<number> {
  const rows = await db.query<{ tick: string }>(
    `select tick::text as tick from public.board_view where view_id = $1`,
    [viewId],
  );
  const current = rows[0];
  return current === undefined ? 1 : Number(current.tick) + 1;
}

/** The ids on the previous committed frame. The only input to `isNew`. */
export async function previousBoardStoryIds(db: Db, viewId: string): Promise<ReadonlySet<string>> {
  const rows = await db.query<{ story_id: string }>(
    `select story_id from public.board_row where view_id = $1`,
    [viewId],
  );
  return new Set(rows.map((row) => row.story_id));
}

/* ── domain reads ─────────────────────────────────────────────────────── */

interface StoryRow {
  story_id: string;
  display_title: string | null;
  thumb_uri: string | null;
  last_member_at: Date | string;
  member_count: number;
  distinct_authors: number;
  distinct_sources: number;
}

/**
 * Stories still open, newest activity first.
 *
 * `state in ('candidate','promoted')` and not the tighter `state = 'promoted'` alone,
 * because the promote stage does not run yet and the tighter clause would render an
 * empty board on every database that exists today. That is a TEMPORARY widening and it
 * belongs on the same list as order.ts: when promotion is live this clause narrows to
 * promoted rows only, because promotion is precisely the decision about what downstream
 * — including this board — is allowed to look at.
 *
 * `merged_into is null` is not temporary. A merged story points at the story it was
 * folded into; showing both would put the same moment on the board twice.
 */
async function loadStories(db: Db, sinceMs: Millis, limit: number): Promise<readonly StoryRow[]> {
  return db.query<StoryRow>(
    `select story_id, display_title, thumb_uri, last_member_at,
            member_count, distinct_authors, distinct_sources
       from public.story
      where merged_into is null
        and state in ('candidate', 'promoted')
        and last_member_at >= $1
      order by last_member_at desc
      limit $2`,
    [new Date(sinceMs).toISOString(), limit],
  );
}

interface MemberRow {
  story_id: string;
  item_id: string;
  source: string;
  /** The source's OWN id for the post. Half of what a permalink is derived from. */
  source_item_id: string;
  posted_at: Date | string | null;
  body: string;
  media: unknown;
  handle: string | null;
  display_name: string | null;
  source_author_id: string;
  evidence_kind: MatchEvidence['kind'];
  carrier_kind: string | null;
  lineage_via: string | null;
}

/**
 * Every member of every story on the frame, in one query.
 *
 * The author is joined in rather than fetched per item, and only the display fields come
 * back: `handle` is an observed display handle and is explicitly never a join key, which
 * is exactly why it is safe to SHOW and unsafe to key on.
 *
 * `i.source_item_id` rides along with `i.source` and `a.handle` because together those
 * three are the whole input to a permalink — see permalinks.ts. They are already the
 * columns this query needed for display, so citing a post costs no extra round trip and
 * no extra column: the link is derived from what we hold rather than stored beside it.
 *
 * The evidence columns fetched are the discriminator and the two variant fields the
 * relation sentence branches on. The similarity, the carrier weight and the Hamming
 * distance are deliberately NOT selected: they are the numbers that persuaded us, they
 * live on the group stage's row in the decision log, and a column that is not in the
 * result set cannot end up in a payload by accident.
 */
async function loadMembers(db: Db, storyIds: readonly string[]): Promise<readonly MemberRow[]> {
  if (storyIds.length === 0) return [];
  return db.query<MemberRow>(
    `select m.story_id, m.item_id, i.source, i.source_item_id, i.posted_at, i.body, i.media,
            a.handle, a.display_name, a.source_author_id,
            m.evidence_kind, m.carrier_kind, m.lineage_via
       from public.story_member m
       join public.item i using (item_id)
       join public.author a on a.author_key = i.author_key
      where m.story_id = any($1::text[])
      order by m.story_id, i.posted_at asc nulls last, m.item_id asc`,
    [storyIds],
  );
}

interface ObservationRow {
  item_id: string;
  captured_at: Date | string;
  fidelity_kind: Fidelity['kind'];
  rate_per_min: number | null;
  censored: CensorReason | null;
  rate_over_ms: number | null;
  rate_level: number | null;
  rate_last_level: number | null;
}

/**
 * The reach series for many items at once, oldest first.
 *
 * ★ THIS QUERY IS WHY THE PROJECTOR HOLDS THE SERVICE CREDENTIAL. public.observation has
 * no grant to the app role, on the grounds that a client which can read a censor reason
 * can re-derive the rate we deliberately refused to publish. The censoring is applied
 * here and what leaves is a `value: null`.
 *
 * There is no `coalesce(rate_per_min, 0)` in this statement and there never may be. The
 * database's own `rate_xor_censor` constraint guarantees exactly one of the rate and the
 * reason is set, so the two states arrive distinguishable and the mapping below keeps
 * them that way.
 */
async function loadReach(
  db: Db,
  itemIds: readonly string[],
  sinceMs: Millis,
): Promise<ReadonlyMap<string, readonly ReachReading[]>> {
  const byItem = new Map<string, ReachReading[]>();
  if (itemIds.length === 0) return byItem;

  const rows = await db.query<ObservationRow>(
    `select item_id, captured_at, fidelity_kind,
            rate_per_min, censored, rate_over_ms, rate_level, rate_last_level
       from public.observation
      where item_id = any($1::text[])
        and kind = 'reach'
        and captured_at >= $2
      order by item_id, captured_at asc`,
    [itemIds, new Date(sinceMs).toISOString()],
  );

  for (const row of rows) {
    const series = byItem.get(row.item_id) ?? [];
    series.push({
      atMs: toMillis(row.captured_at),
      fidelity: row.fidelity_kind,
      rate: toRate(row),
    });
    byItem.set(row.item_id, series);
  }
  return byItem;
}

/**
 * The flat columns back into the Rate union.
 *
 * store/src/repo/observations.ts owns this mapping and is the authority on it; this is a
 * second copy only because the projector reads many items in one statement and the
 * repository's shape is one item at a time. It is kept line-for-line equivalent.
 *
 * ★ There is no branch here that produces a zero rate from a censored row, and there
 * never may be. `rate_per_min` null means we learned nothing; a 0 says the item is flat,
 * flat reads downstream as cooling, and cooling demotes exactly the item that is
 * accelerating. A row with neither column set was written around the constraint and
 * throws rather than defaulting to either answer.
 */
function toRate(row: ObservationRow): Rate {
  if (row.rate_per_min !== null) {
    if (row.rate_over_ms === null || row.rate_level === null) {
      throw new TypeError('a measured rate arrived without its interval or its level');
    }
    return {
      kind: 'measured',
      perMin: row.rate_per_min,
      overMs: row.rate_over_ms,
      level: row.rate_level,
    };
  }
  if (row.censored === null) {
    throw new TypeError('an observation arrived with neither a rate nor a censor reason');
  }
  return { kind: 'censored', reason: row.censored, lastLevel: row.rate_last_level };
}

/* ── the story→coin link, which is derived and never stored ───────────── */

interface SpanRow {
  story_id: string;
  key: string;
}

/**
 * The phrases each story is actually named by.
 *
 * `entitySpan` fingerprints, and only those: an imageHash says two clips are the same
 * picture and a formatId says they use the same sound, neither of which a coin can be
 * named after. The rows come from the ITEMS, through story_member, rather than from
 * `story.carriers` — carriers are what the grouper tests an arriving item against, and a
 * carrier can name a phrase that no member's text ever contained. A fingerprint row exists
 * because the span occurs in that item's body, which is the fact we want.
 *
 * Deduplicated in SQL because several members usually carry the same span, and the caller
 * wants the story's vocabulary, not a bag with repeats in it.
 */
async function loadEntitySpans(
  db: Db,
  storyIds: readonly string[],
): Promise<ReadonlyMap<string, readonly string[]>> {
  const byStory = new Map<string, string[]>();
  if (storyIds.length === 0) return byStory;

  const rows = await db.query<SpanRow>(
    `select m.story_id, f.key
       from public.story_member m
       join public.item_fingerprint f using (item_id)
      where m.story_id = any($1::text[])
        and f.kind = 'entitySpan'
      group by m.story_id, f.key
      order by m.story_id, f.key`,
    [storyIds],
  );

  for (const row of rows) {
    const bucket = byStory.get(row.story_id) ?? [];
    bucket.push(row.key);
    byStory.set(row.story_id, bucket);
  }
  return byStory;
}

interface AssetRow {
  story_id: string;
  asset_key: string;
  address: string;
  venue_id: string;
  symbol: string | null;
  name: string | null;
  image_uri: string | null;
  minted_at: Date | string | null;
}

/**
 * ★ TIME-FIRST RETRIEVAL: every coin that could have been minted from this story.
 *
 * This is the half of the link that a database can do, and only that half. It narrows the
 * mint stream to a window and hands the result to coins.ts, which applies the text tests.
 * Retrieval is deliberately generous — it is allowed to return coins about something else
 * entirely, because the text step is what removes them and doing it in SQL would mean a
 * second spelling of `normalise` living in a string literal where no test can reach it.
 *
 * ★ THE WINDOW OPENS AT THE EARLIEST TIME A MEMBER WAS POSTED, COMPUTED HERE FROM
 * public.item.posted_at — NOT read from public.story.earliest_post_at. That column is NOT
 * NULL, so for a story whose posts never carried a time (st_rooftop in the seed) it holds
 * the earliest FIRST-SEEN instead: a different clock, measuring when we read the item
 * rather than when a person posted it. Opening the window on that would compare a mint
 * time against our own reading schedule and drop coins for being older than the moment we
 * happened to look.
 *
 * THREE WAYS TO BE IN THE WINDOW, and the two exceptions are the interesting ones:
 *
 *   1. `minted_at` falls inside [earliest post + minLag, earliest post + maxLag].
 *      A coin minted BEFORE the earliest post cannot have been minted from it — that is
 *      resolve's first and cheapest gate, and no amount of name similarity overturns it.
 *
 *   2. `minted_at is null` — the coin's mint time was never learned. It is invisible to a
 *      time-first query by construction, so excluding it here would mean an unknown mint
 *      time silently deleted a coin from a comparison. It costs the coin the Buy
 *      affordance (0005's G1 gate, decided elsewhere), not its place on the row. Those two
 *      consequences are different and must stay so.
 *
 *   3. The STORY has no known post time at all, in which case the gate has nothing to
 *      order and abstains rather than deciding. An ordering claim needs both ends; with
 *      one end missing, "the coin predates the story" is not false, it is unanswerable,
 *      and answering it anyway is how a story loses the only coin it has.
 *
 * The window's two ends are Policy.resolve's, not numbers typed here. The board and the
 * resolve stage have to be judged against the same window or "why is that coin on the row"
 * has two answers depending on which code path a reader follows.
 *
 * The cap is a retrieval bound and nothing else. Ordered by mint time ascending so that
 * what survives a cap is the coins closest to the post — the ordering the mint-lag evidence
 * actually has — rather than whatever the planner returned first.
 */
async function loadCoinsInWindow(db: Db, storyIds: readonly string[]): Promise<readonly AssetRow[]> {
  if (storyIds.length === 0) return [];

  return db.query<AssetRow>(
    `select o.story_id,
            c.asset_key, c.address, c.venue_id, c.symbol, c.name, c.image_uri, c.minted_at
       from (
         select m.story_id, min(i.posted_at) as opens_at
           from public.story_member m
           join public.item i using (item_id)
          where m.story_id = any($1::text[])
          group by m.story_id
       ) o
       cross join lateral (
         select a.asset_key, a.address, a.venue_id, a.symbol, a.name, a.image_uri, a.minted_at
           from public.asset a
          where o.opens_at is null
             or a.minted_at is null
             or (a.minted_at >= o.opens_at + ($2::double precision * interval '1 millisecond')
                 and a.minted_at <= o.opens_at + ($3::double precision * interval '1 millisecond'))
          order by a.minted_at asc nulls last, a.asset_key asc
          limit $4
       ) c
      order by o.story_id, c.minted_at asc nulls last, c.asset_key asc`,
    [
      storyIds,
      DEFAULT_POLICY.resolve.minLagMs,
      DEFAULT_POLICY.resolve.maxLagMs,
      DEFAULT_POLICY.resolve.maxCandidates,
    ],
  );
}

/** The retrieved coins, bucketed by story, each carrying whatever reading we hold. */
function coinsByStory(
  rows: readonly AssetRow[],
  markets: ReadonlyMap<string, CoinMarket>,
): ReadonlyMap<string, readonly CoinFacts[]> {
  const byStory = new Map<string, CoinFacts[]>();
  for (const row of rows) {
    const bucket = byStory.get(row.story_id) ?? [];
    /* `?? null` and never a fabricated empty reading. A coin with no row in
       public.market_reading has not been read, which is OUR state; an empty reading
       would say the venue answered and had nothing, which is the world's. Those are
       different sentences and projectCoin gives them different reasons. */
    bucket.push(toCoinFacts(row, markets.get(row.asset_key) ?? null));
    byStory.set(row.story_id, bucket);
  }
  return byStory;
}

/* ── the market, which is a reading and not a property ────────────────── */

interface MarketReadingRow {
  asset_key: string;
  taken_at: Date | string;
  price_usd: number | null;
  price_absent: MarketAbsenceReason | null;
  market_cap_usd: number | null;
  market_cap_absent: MarketAbsenceReason | null;
  market_cap_basis: MarketCapBasis | null;
  liquidity_usd: number | null;
  liquidity_absent: MarketAbsenceReason | null;
  price_change_24h_pct: number | null;
  price_change_24h_absent: MarketAbsenceReason | null;
  tradable: boolean;
}

/**
 * The LATEST reading for each of these coins, and only the latest.
 *
 * `distinct on (asset_key) … order by asset_key, taken_at desc` walks
 * `market_reading_latest_idx` backwards and stops at the first row per key, so the cost
 * is one seek per coin rather than a scan of every reading a coin has ever had. The
 * index is declared descending for exactly this; an ascending one would make the
 * planner read the whole series and discard all but the last row of each.
 *
 * ★ NOTE WHAT IS NOT IN THE COLUMN LIST. `source_vendor` and `source_endpoint` are
 * columns on this table and are not selected, deliberately: `source_vendor` names who
 * we pay, and services/project throws WireLeakError on that string appearing at any
 * depth of a payload — which would silently withhold the row from the board rather than
 * fail loudly. A column that is not in the result set cannot reach a payload by
 * accident, which is the cheapest version of this guarantee there is.
 *
 * ★ AND THERE IS NO FRESHNESS CLAUSE IN THIS QUERY, ON PURPOSE. Whether a reading is
 * too old to publish is a judgement, judgements live in project.ts where a test can
 * call them with two literals, and a `where taken_at > now() - interval …` here would
 * be a second copy of that threshold living in a string literal — read from the
 * database's clock rather than from the injected one, so the projection would stop
 * being reproducible. The row is fetched with its instant; project.ts decides.
 */
async function loadMarketReadings(
  db: Db,
  assetKeys: readonly string[],
): Promise<ReadonlyMap<string, CoinMarket>> {
  const byAsset = new Map<string, CoinMarket>();
  if (assetKeys.length === 0) return byAsset;

  const rows = await db.query<MarketReadingRow>(
    `select distinct on (asset_key)
            asset_key, taken_at,
            price_usd, price_absent,
            market_cap_usd, market_cap_absent, market_cap_basis,
            liquidity_usd, liquidity_absent,
            price_change_24h_pct, price_change_24h_absent,
            tradable
       from public.market_reading
      where asset_key = any($1::text[])
      order by asset_key, taken_at desc`,
    [assetKeys],
  );

  for (const row of rows) {
    byAsset.set(row.asset_key, {
      takenAt: toMillis(row.taken_at),
      priceUsd: toMarketNumber(row.price_usd, row.price_absent, 'price_usd'),
      marketCapUsd: toMarketNumber(row.market_cap_usd, row.market_cap_absent, 'market_cap_usd'),
      marketCapBasis: row.market_cap_basis,
      liquidityUsd: toMarketNumber(row.liquidity_usd, row.liquidity_absent, 'liquidity_usd'),
      priceChange24h: toMarketNumber(
        row.price_change_24h_pct,
        row.price_change_24h_absent,
        'price_change_24h_pct',
      ),
      tradable: row.tradable,
    });
  }
  return byAsset;
}

/**
 * The stored reason, as the reason the user is given.
 *
 * ★ AN EXPLICIT SWITCH AND NOT A PASS-THROUGH, even though all three strings are spelled
 * the same on both sides. They are two different closed lists: contracts'
 * MARKET_ABSENCE_REASONS is what a VENUE can say about a reading, and PendingReason is
 * what the USER is told, which also has to cover states no reading exists for at all.
 * Written as a switch, a fourth venue reason is a compile error here — the one place
 * where somebody has to decide what a user should read — rather than a string that
 * travels intact to decode.ts, fails `reasonOf`'s closed list, and silently becomes
 * 'unavailable' in a browser.
 *
 * There is no branch that produces a zero from either side, and the row's own
 * `*_xor_reason` constraints mean a value and a reason cannot both be missing — so a
 * row that reached here with neither was written around the constraint and throws
 * rather than defaulting to an answer nobody chose.
 */
function toMarketNumber(
  value: number | null,
  absent: MarketAbsenceReason | null,
  column: string,
): MarketNumber {
  if (value !== null) return { known: true, amount: value };
  if (absent === null) {
    throw new TypeError(`a market reading arrived with neither a ${column} nor a reason for having none`);
  }
  const why: PendingReason =
    absent === 'no_market' ? 'no_market' : absent === 'not_reported' ? 'not_reported' : 'unreadable';
  return { known: false, why };
}

/**
 * A display label for a venue, chosen here for the same reason a source's label is: the
 * app never maps an internal id to a name. An id we have no label for falls back to a
 * capitalised form, which looks wrong enough to get fixed.
 *
 * ★ A Map, for exactly the reason `SOURCE_LABELS` below is one, and it has to be said
 * twice because the trap is the same and it is invisible. `public.asset.venue_id` is an
 * unconstrained `text` column — 0005 declares no CHECK on it — so its value is whatever
 * the writer put there, and an object literal answers for its prototype as well as for
 * its own keys. Indexed as one, a venue_id of `constructor` or `toString` returns a
 * FUNCTION, so `??` never fires and a function is returned from something typed
 * `string`. Nothing would throw here: the censor's walk skips a non-string non-object,
 * JSON.stringify DROPS a function-valued key entirely, and the row would be stored and
 * served with no `venueLabel` at all — failing in decode.ts, in a user's browser, as far
 * from this line as it is possible to get. A Map has no inherited keys, so the fallback
 * fires and the worst case is an ugly label rather than a missing field.
 */
const VENUE_LABELS: ReadonlyMap<string, string> = new Map([
  ['pumpfun', 'Pump.fun'],
  ['raydium', 'Raydium'],
]);

/**
 * ★ TWO SPELLINGS ARE LOOKED UP, AND THAT IS NOT TIDINESS. `venue_id` has no CHECK on it
 * (0005 declares none), and the writers disagree: the seed writes the bare market
 * (`pumpfun`) while contracts' `venueId(chain, market)` — which every real adapter uses —
 * produces `solana:pumpfun`. Looking up only the full id would label every coin the live
 * mint feed writes as "Solana:pumpfun", which is not a lie but is the kind of ugly that
 * ships. So: the whole id first, then the part after the last colon, then the capitalised
 * fallback. The fallback still looks wrong enough to get fixed, which is its job.
 *
 * The lookup is a Map and not an object literal, and it has to be said again because the
 * trap is invisible: `venue_id` is unconstrained text, and an object literal answers for
 * its prototype as well as its own keys. Indexed as one, a venue_id of `constructor` or
 * `toString` returns a FUNCTION, so `??` never fires and a function is returned from
 * something typed `string`. Nothing would throw: the censor's walk skips a non-string
 * non-object and JSON.stringify DROPS a function-valued key entirely, so the row would be
 * stored and served with no `venueLabel` at all — failing in decode.ts, in a user's
 * browser, as far from this line as it is possible to get.
 */
function venueLabel(venueId: string): string {
  const direct = VENUE_LABELS.get(venueId);
  if (direct !== undefined) return direct;
  const market = venueId.slice(venueId.lastIndexOf(':') + 1);
  const byMarket = VENUE_LABELS.get(market);
  if (byMarket !== undefined) return byMarket;
  return market.charAt(0).toUpperCase() + market.slice(1);
}

/**
 * One asset row, plus the latest market reading for it, as coin facts.
 *
 * ★ THE MARKET ARRIVES AS A SEPARATE OBJECT AND IS ALLOWED TO BE MISSING. public.asset
 * still has no price, no market cap and no liquidity column and it must not grow one —
 * those are readings taken FROM a market, not properties OF a coin, so a column there
 * would be either stale or overwritten, and public.asset IS granted to the app role,
 * which would hand the browser's own connection a number that skipped the projection,
 * the censor and the staleness rule. The reading lives in public.market_reading, which
 * the app cannot read at all.
 *
 * ★ `market: null` IS A FACT, NOT A PLACEHOLDER. It says nobody has read this coin's
 * market yet, which is different from the venue saying there is no market — and
 * projectCoin gives the two different reasons on the wire. A zero for either would read
 * as "worthless" on a row whose actual state is "nobody has traded it yet", and those
 * are opposite claims about the same coin.
 *
 * ★ `minted_at` NULL STAYS NULL. It is never filled from `first_seen_at`, which is when WE
 * first read the row and can postdate the mint by hours. Mint time is the axis every
 * ordering claim in the product hangs on: a guessed one can make a post that came after
 * the mint look like it came before, which is the one error that turns the whole thesis
 * upside down. 0005's `unknown_iff_absent` constraint means a null here always travels
 * with a confidence of 'unknown', so the absence is already labelled at the source.
 */
function toCoinFacts(row: AssetRow, market: CoinMarket | null): CoinFacts {
  return {
    /* The asset key — '<chain>:<address>' — is the one storable spelling of an asset and
       is unique by constraint, so a React key made from it is stable across frames. */
    coinId: row.asset_key,
    ticker: row.symbol,
    name: row.name,
    address: row.address,
    venueLabel: venueLabel(row.venue_id),
    imageUrl: row.image_uri,
    mintedAt: row.minted_at === null ? null : toMillis(row.minted_at),
    market,
  };
}

/* ── assembling the facts the projection is handed ────────────────────── */

/**
 * A display label for a source.
 *
 * The wire says the server chooses this string, and it does so here rather than in a
 * component: the app never maps an internal source id to a label, because that mapping
 * is where a newly added platform silently renders as its raw id in front of a user. An
 * id we have no label for falls back to a capitalised form, which is wrong-looking
 * enough to get noticed and fixed.
 *
 * ★ A Map, for the reason permalinks.ts spells out at length: `source` is a database
 * column and an object literal answers for its prototype too. Indexed as one, a source
 * of `toString` returned Object.prototype.toString — a FUNCTION, so `??` never fired
 * and a function was returned from something typed `string`. It would not have thrown
 * here: JSON.stringify drops a function-valued key entirely, the censor's walk skips a
 * non-string non-object, and the payload would have been stored and served missing its
 * `sourceLabel` — failing in decode.ts, in the user's browser, as far from this line as
 * it is possible to get. A Map has no inherited keys, so the fallback fires.
 */
const SOURCE_LABELS: ReadonlyMap<string, string> = new Map([
  ['x', 'X'],
  ['tiktok', 'TikTok'],
  ['reddit', 'Reddit'],
  ['youtube', 'YouTube'],
  ['instagram', 'Instagram'],
]);

function sourceLabel(source: string): string {
  return SOURCE_LABELS.get(source) ?? source.charAt(0).toUpperCase() + source.slice(1);
}

/** Handle first, then a display name, then the source's own id. Never our author key. */
function authorLabel(row: MemberRow): string {
  const handle = (row.handle ?? '').trim();
  if (handle !== '') return handle.startsWith('@') ? handle : `@${handle}`;
  const name = (row.display_name ?? '').trim();
  return name !== '' ? name : row.source_author_id;
}

/**
 * The discriminator, narrowed to the display-only relation.
 *
 * The switch is over `MatchEvidence['kind']`, so a sixth kind added to the vocabulary is
 * a compile error here rather than a post that silently arrives with no explanation.
 * What it produces is MemberRelation, which has no numeric member at all — so this
 * function is not able to invent a `weight: 0` or a `similarity: 0` for a column it
 * never selected, which in a service whose entire argument is "an absence is not a zero"
 * would have been an unfortunate place to write one.
 *
 * An `evidence_kind = 'carrier'` row whose `carrier_kind` is not one of the four known
 * kinds falls back to the generic sentence rather than guessing a carrier: the row's
 * check constraint makes that unreachable today, and guessing would put a specific claim
 * ("uses the same picture") behind a value we did not recognise.
 */
function toRelation(row: MemberRow): MemberRelation {
  const kind: MatchEvidence['kind'] = row.evidence_kind;
  switch (kind) {
    case 'carrier': {
      const carrier = row.carrier_kind;
      return isFingerprintKind(carrier)
        ? { kind: 'carrier', carrier }
        : { kind: 'representation' };
    }
    case 'lineage':
      return {
        kind: 'lineage',
        via: row.lineage_via === 'rebroadcast' ? 'rebroadcast' : 'reproduction',
      };
    case 'representation':
      return { kind: 'representation' };
    case 'adjudicated':
      return { kind: 'adjudicated' };
    case 'seed':
      return { kind: 'seed' };
  }
}

function isFingerprintKind(value: string | null): value is FingerprintKind {
  return (
    value === 'imageHash' ||
    value === 'textShingle' ||
    value === 'formatId' ||
    value === 'entitySpan'
  );
}

/**
 * The first image attached to a post, if it has one.
 *
 * `media` is jsonb written from MediaRef[], and it is read defensively rather than
 * asserted: everything in it came from a source, and a shape assertion over a source's
 * payload is trusting the source to have sent what we hoped for.
 */
function firstImageUri(media: unknown): string | null {
  if (!Array.isArray(media)) return null;
  for (const entry of media) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    if (record['kind'] !== 'image') continue;
    const uri = record['uri'];
    if (typeof uri === 'string' && uri.trim() !== '') return uri;
  }
  return null;
}

/**
 * Everything the projection is handed, assembled from the rows above.
 *
 * `coins` is DERIVED — see coins.ts for the two tests and why they are different
 * strengths. There is no story-to-asset table anywhere in migrations 0001–0009 and there
 * must not be one: which coin a moment produced is a judgement, judgements belong in
 * internal.decisions with their evidence, and a public join table is that judgement
 * stored with nobody's name on it. What is derivable from public rows instead is
 * narrower and weaker than the resolve stage will be, on purpose — it can fail to name a
 * coin and it cannot name the wrong one, which is the only direction it is safe to be
 * approximate in when the failure costs a user money.
 *
 * `permalink` is DERIVED too, and for a related reason: public.item has no link column
 * and must not grow one, so the link is built from (source, handle, source_item_id) by
 * the adapter that owns the platform. permalinkFor returns null for a source we have no
 * adapter for and for a member with no handle, and projectEvidence drops those members
 * rather than printing an unopenable claim. Both halves are load-bearing — the deriving
 * is what makes evidence exist at all, and the null is what keeps it trustworthy.
 */
function toStoryFacts(
  story: StoryRow,
  members: readonly MemberRow[],
  reach: ReadonlyMap<string, readonly ReachReading[]>,
  spans: readonly string[],
  coins: readonly CoinFacts[],
  wasOnPreviousBoard: boolean,
): StoryFacts {
  const memberFacts: MemberFacts[] = members.map((row) => ({
    itemId: row.item_id,
    sourceLabel: sourceLabel(row.source),
    authorLabel: authorLabel(row),
    postedAt: row.posted_at === null ? null : toMillis(row.posted_at),
    excerpt: row.body,
    thumbUrl: firstImageUri(row.media),
    permalink: permalinkFor(row.source, row.handle, row.source_item_id),
    relation: toRelation(row),
    reach: reach.get(row.item_id) ?? [],
  }));

  return {
    storyId: story.story_id,
    displayTitle: story.display_title,
    thumbUrl: story.thumb_uri ?? memberFacts.find((m) => m.thumbUrl !== null)?.thumbUrl ?? null,
    lastMemberAt: toMillis(story.last_member_at),
    memberCount: story.member_count,
    distinctAuthors: story.distinct_authors,
    distinctSources: story.distinct_sources,
    members: memberFacts,
    coins: coinCandidates(spans, coins),
    wasOnPreviousBoard,
  };
}

export interface LoadWindow {
  /** Stories with member activity at or after this instant. */
  readonly storiesSinceMs: Millis;
  /** Reach readings at or after this instant. Wider than the spark, so the day's change has both ends. */
  readonly reachSinceMs: Millis;
  readonly limit: number;
  /** The ids on the previous committed frame — the only input to `isNew`. */
  readonly previousBoard: ReadonlySet<string>;
}

/**
 * Everything the projection needs, in six round trips regardless of how many stories
 * come back.
 *
 * Six and not six-per-story: every fetch after the first is one statement over an id
 * array. A per-story loop here would be a thousand queries inside a single transaction,
 * which holds a backend open for the whole frame — and the projector runs while ingest is
 * writing. The two coin reads are separate statements rather than one join because the
 * spans and the mint window are independent of each other: they only meet in coins.ts,
 * where the meeting is a pure function that a test can call with two literals.
 *
 * ★ THE SIXTH IS THE MARKET, AND IT IS A SEPARATE STATEMENT RATHER THAN A LATERAL JOIN
 * ONTO THE COIN QUERY, on purpose. Joined in, it would have to be a LEFT join — an inner
 * one would DELETE every coin nobody has read yet, which is most of them and is the
 * population this product exists to serve, and it would delete them silently: the row
 * would simply have fewer coins on it, with nothing anywhere saying why. Separating the
 * two makes "no reading" a null in a Map lookup, which is a state with a name.
 */
export async function loadStoryFacts(db: Db, window: LoadWindow): Promise<readonly StoryFacts[]> {
  const storyRows = await loadStories(db, window.storiesSinceMs, window.limit);
  if (storyRows.length === 0) return [];

  const storyIds = storyRows.map((row) => row.story_id);
  const memberRows = await loadMembers(db, storyIds);
  const reach = await loadReach(
    db,
    memberRows.map((row) => row.item_id),
    window.reachSinceMs,
  );
  const spans = await loadEntitySpans(db, storyIds);
  const coinRows = await loadCoinsInWindow(db, storyIds);
  /* Deduplicated: one coin can be in several stories' windows, and asking for its
     reading once per story would multiply the largest statement here by the number of
     rows on the board for no new information. */
  const markets = await loadMarketReadings(db, [...new Set(coinRows.map((row) => row.asset_key))]);
  const coins = coinsByStory(coinRows, markets);

  const byStory = new Map<string, MemberRow[]>();
  for (const row of memberRows) {
    const bucket = byStory.get(row.story_id) ?? [];
    bucket.push(row);
    byStory.set(row.story_id, bucket);
  }

  return storyRows.map((row) =>
    toStoryFacts(
      row,
      byStory.get(row.story_id) ?? [],
      reach,
      spans.get(row.story_id) ?? [],
      coins.get(row.story_id) ?? [],
      window.previousBoard.has(row.story_id),
    ),
  );
}

/* ── launches: the mint stream, on its own axis ───────────────────────── */

interface LaunchRow {
  asset_key: string;
  address: string;
  venue_id: string;
  symbol: string | null;
  name: string | null;
  minted_at: Date | string | null;
  minted_at_conf: MintTimeConfidence;
  minted_at_bound_s: number | null;
}

export interface LaunchWindow {
  /** Coins minted at or after this instant. A presentation bound, not a judgement. */
  readonly sinceMs: Millis;
  readonly limit: number;
}

/**
 * How many characters of somebody else's text may cross from Postgres into this process.
 * Not a display length — see the `left(…)` note below and TICKER/NAME_MAX_CHARS in
 * project.ts, which is where what a user sees is decided.
 */
const TRANSPORT_TEXT_CAP = 200;

/**
 * The most recently minted coins, newest first.
 *
 * ★ `minted_at_conf <> 'unknown'` IS AN EXCLUSION AND IT IS DELIBERATE, so it is worth
 * saying what it costs. A coin whose mint time we never learned is a coin that cannot be
 * placed on the axis this list is ordered by. Putting it at the bottom would say it is the
 * oldest, putting it at the top would say it is the newest, and both are claims we cannot
 * make; ordering it by `first_seen_at` instead would be the "backfill the mint time from
 * when we looked" mistake wearing an ORDER BY. So it is left out, and the projector counts
 * what it left out and prints the count, because a rail quieter than the world has to be
 * diagnosable rather than merely quiet. 0005's own header makes the same call from the
 * other side: an 'unknown' mint time fails gate G1.
 *
 * `minted_at is not null` is redundant against `unknown_iff_absent` and is written anyway:
 * it is the predicate on 0005's partial `asset_time_idx`, and without it the planner has
 * no partial index to walk backwards.
 *
 * ★ `left(…, $3)` BOUNDS THE BYTES, NOT THE DISPLAY. `symbol` and `name` are unbounded
 * `text` columns holding strings an attacker typed, and this projector runs inside a
 * transaction while ingest is writing — a single ten-megabyte token name would be pulled
 * into this process in full before any code of ours saw it. The display bound is a
 * different and much smaller number, applied in project.ts where a test can call it with a
 * literal. Two numbers on purpose: if this one ever became the display rule, the rule would
 * be living in a string literal in a SQL file.
 */
async function loadLaunches(db: Db, window: LaunchWindow): Promise<readonly LaunchRow[]> {
  return db.query<LaunchRow>(
    `select a.asset_key,
            a.address,
            a.venue_id,
            left(a.symbol, $3::int) as symbol,
            left(a.name, $3::int)   as name,
            a.minted_at,
            a.minted_at_conf,
            a.minted_at_bound_s
       from public.asset a
      where a.minted_at is not null
        and a.minted_at_conf <> 'unknown'
        and a.minted_at >= to_timestamp($1::double precision / 1000.0)
      order by a.minted_at desc, a.asset_key desc
      limit $2`,
    [window.sinceMs, window.limit, TRANSPORT_TEXT_CAP],
  );
}

export interface LaunchLoad {
  readonly launches: readonly LaunchFacts[];
  /**
   * How many coins in the window were left out for having no usable mint time. Printed by
   * the projector: a rail that is quieter than the world must say so somewhere.
   */
  readonly withoutMintTime: number;
}

/**
 * Every launch the rail could show, with whatever reading we hold for each.
 *
 * Two statements, never one join. The market read is separate for the reason
 * `loadStoryFacts` gives: joined in it would have to be a LEFT join, and an inner one
 * would silently DELETE every coin nobody has read yet — which is most of a launches feed,
 * by construction, because a coin four minutes old has no pool to have been read.
 */
export async function loadLaunchFacts(db: Db, window: LaunchWindow): Promise<LaunchLoad> {
  const rows = await loadLaunches(db, window);
  if (rows.length === 0) return { launches: [], withoutMintTime: await countWithoutMintTime(db, window) };

  const markets = await loadMarketReadings(db, [...new Set(rows.map((row) => row.asset_key))]);
  const launches = rows.map((row) => ({
    assetKey: row.asset_key,
    ticker: row.symbol,
    name: row.name,
    address: row.address,
    venueLabel: venueLabel(row.venue_id),
    mintedAt: row.minted_at === null ? null : toMillis(row.minted_at),
    mintPrecision: row.minted_at_conf,
    mintBoundS: row.minted_at_bound_s,
    /* `?? null` and never a fabricated empty reading. A coin with no row in
       public.market_reading has not been READ, which is our state; an empty reading would
       say the venue answered and had nothing, which is the world's. projectLaunch gives
       the two different reasons. */
    market: markets.get(row.asset_key) ?? null,
  }));
  return { launches, withoutMintTime: await countWithoutMintTime(db, window) };
}

/**
 * The coins the query above refused, counted rather than guessed at.
 *
 * A separate statement rather than a `count(*) filter` bolted onto the first, because the
 * first has a `limit` on it and a count under a limit is not a count. This one has no
 * limit and returns one number.
 */
async function countWithoutMintTime(db: Db, window: LaunchWindow): Promise<number> {
  const rows = await db.query<{ n: string }>(
    `select count(*)::text as n
       from public.asset a
      where a.minted_at_conf = 'unknown'
        and a.first_seen_at >= to_timestamp($1::double precision / 1000.0)`,
    [window.sinceMs],
  );
  /* Bounded by `first_seen_at` and not by `minted_at`, because these rows have no
     `minted_at` at all — that is what makes them the rows in question. It is the wrong
     clock for an ordering and the right one for "how many of these turned up lately",
     which is the only question being asked of it. */
  return Number(rows[0]?.n ?? '0');
}

/* ── the writes ───────────────────────────────────────────────────────── */

/**
 * Commit one frame.
 *
 * The order is the whole correctness story and it is not arbitrary: the view row goes
 * first because board_row references it, then rows that are no longer on the frame are
 * deleted, then the surviving rows are upserted with their new positions. Doing the
 * delete last would leave a window in which two rows claim the same position; doing it
 * before the view row would orphan nothing but would also mean a failed run leaves an
 * emptier board than it found. Every statement here runs inside one transaction, so a
 * half-projected board is not a state the read service can ever observe.
 */
export async function writeBoard(
  db: Db,
  viewId: string,
  tick: number,
  rows: readonly WireBoardRow[],
): Promise<number> {
  await db.query(
    `insert into public.board_view (view_id, tick, projected_at)
     values ($1, $2, now())
     on conflict (view_id) do update
       set tick = excluded.tick, projected_at = excluded.projected_at`,
    [viewId, tick],
  );

  await db.query(`delete from public.board_row where view_id = $1 and story_id <> all($2::text[])`, [
    viewId,
    rows.map((row) => row.id),
  ]);

  let written = 0;
  for (const [position, row] of rows.entries()) {
    await db.query(
      `insert into public.board_row (view_id, story_id, position, payload)
       values ($1, $2, $3, $4::jsonb)
       on conflict (view_id, story_id) do update
         set position = excluded.position, payload = excluded.payload`,
      [viewId, row.id, position, JSON.stringify(row)],
    );
    written += 1;
  }
  return written;
}

/**
 * Upsert the story pages.
 *
 * Rows are NEVER deleted here, unlike board rows. A story page outlives its place on the
 * board — a link shared while a story was ranked has to keep working after it drops off
 * — and re-deriving that page on demand is the join the whole projection exists to
 * remove.
 */
export async function writeStories(db: Db, pages: readonly WireStory[]): Promise<number> {
  let written = 0;
  for (const page of pages) {
    await db.query(
      `insert into public.story_view (story_id, payload, projected_at)
       values ($1, $2::jsonb, now())
       on conflict (story_id) do update
         set payload = excluded.payload, projected_at = excluded.projected_at`,
      [page.id, JSON.stringify(page)],
    );
    written += 1;
  }
  return written;
}

/**
 * The next frame number for the launches feed.
 *
 * ★ A SECOND FUNCTION AND NOT A PARAMETERISED FIRST ONE, knowingly. Generalising `nextTick`
 * over both projections means passing it a table name and a key column name, and a table
 * name arriving as a string is the one habit this file must never start: the moment a
 * statement is assembled from an identifier, "is every parameter parameterised" stops being
 * answerable by reading. Two nine-line functions that each say their own table out loud is
 * the cheaper price.
 *
 * `previous + 1` and nothing else, for the reason `nextTick` gives. This tick has no live
 * channel behind it today, and it is still an increment rather than a timestamp so that the
 * one that eventually arrives does not have to change what a frame number means.
 */
export async function nextLaunchTick(db: Db, feedId: string): Promise<number> {
  const rows = await db.query<{ tick: string }>(
    `select tick::text as tick from public.launch_view where feed_id = $1`,
    [feedId],
  );
  const current = rows[0];
  return current === undefined ? 1 : Number(current.tick) + 1;
}

/**
 * Commit one launches frame.
 *
 * Same order as `writeBoard` and for the same reasons: the view row first because
 * `launch_row` references it, then the rows that have fallen out of the window, then the
 * survivors with their new positions. All of it inside the caller's transaction, so a
 * half-written rail is not a state the read service can observe.
 *
 * ★ THE VIEW ROW IS WRITTEN EVEN WHEN THERE ARE NO LAUNCHES, and that is the point of
 * doing it first. `GET /launches/:feedId` answers 404 when there is no view row, which
 * means "this feed has never been projected" — a real fact, and a different one from "we
 * projected and nothing has been minted". Skipping the insert on an empty run would
 * collapse the two, and the rail would show a transport error over a quiet market.
 */
export async function writeLaunches(
  db: Db,
  feedId: string,
  tick: number,
  launches: readonly WireLaunch[],
): Promise<number> {
  await db.query(
    `insert into public.launch_view (feed_id, tick, projected_at)
     values ($1, $2, now())
     on conflict (feed_id) do update
       set tick = excluded.tick, projected_at = excluded.projected_at`,
    [feedId, tick],
  );

  await db.query(
    `delete from public.launch_row where feed_id = $1 and asset_key <> all($2::text[])`,
    [feedId, launches.map((launch) => launch.launchId)],
  );

  let written = 0;
  for (const [position, launch] of launches.entries()) {
    await db.query(
      `insert into public.launch_row (feed_id, asset_key, position, payload)
       values ($1, $2, $3, $4::jsonb)
       on conflict (feed_id, asset_key) do update
         set position = excluded.position, payload = excluded.payload`,
      [feedId, launch.launchId, position, JSON.stringify(launch)],
    );
    written += 1;
  }
  return written;
}

/* ── row helpers ──────────────────────────────────────────────────────── */

/**
 * pg hands a timestamptz back as a Date, or as a string when the type parser has been
 * changed underneath us. Both are handled; an unparseable one throws rather than
 * becoming an epoch-zero timestamp that would render as 1970 and read as very old.
 */
function toMillis(value: Date | string): Millis {
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(ms)) throw new TypeError(`a timestamp arrived unreadable: ${String(value)}`);
  return ms;
}
