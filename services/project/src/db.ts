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

import { DEFAULT_POLICY, OBSERVED_ASSET_ORIGINS } from '@insidor/contracts';
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
import { coinOriginsVisibleTo } from '@insidor/contracts/story.ts';
import type { MatchEvidence, StoryOrigin } from '@insidor/contracts/story.ts';
import type { Db } from '@insidor/store';

import { coinCandidates, corpusStats } from './coins.ts';
import type { CorpusStats } from './coins.ts';
import { permalinkFor } from './permalinks.ts';
import type {
  CoinFacts,
  CoinMarket,
  LaunchFacts,
  MarketNumber,
  MemberFacts,
  MemberRelation,
  PairCounts,
  PairFacts,
  ReachReading,
  StoryFacts,
} from './project.ts';
import type {
  PendingReason,
  WireBoardRow,
  WireFeedSource,
  WireLaunch,
  WirePair,
  WirePairHead,
  WireSourceHealth,
  WireStory,
} from './wire.ts';
import { coinWindow } from './window.ts';
import type { CoinWindow, StoryClocks } from './window.ts';

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
  /**
   * ★ WHAT KIND OF CONTACT WITH THE WORLD PRODUCED THIS STORY, and the only reason it is
   * selected: the coin retrieval below derives its provenance allowlist FROM it. See
   * `loadCoinsInWindow`. It is never projected — a story does not tell a user how it was
   * assembled — and `toStoryFacts` deliberately does not carry it onto StoryFacts.
   */
  origin: StoryOrigin;
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
    `select story_id, origin, display_title, thumb_uri, last_member_at,
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
  /**
   * When OUR READER pulled this row. NOT NULL in 0002 and always known, which is exactly
   * what makes it tempting and exactly what makes it dangerous: it is a fact about our
   * infrastructure, not about the world. Selected for ONE purpose — window.ts hangs a
   * retrieval window on the minimum of it when a story has no post time at all — and it
   * is deliberately not carried onto MemberFacts, because nothing downstream of that has
   * a use for it that is not "quietly treat it as when this was posted".
   */
  first_seen_at: Date | string;
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
 *
 * `i.first_seen_at` rides along for the coin window and for nothing else — see the column
 * comment on MemberRow and window.ts. It is here rather than in a query of its own because
 * this statement already returns every member of every story on the frame, so the two
 * clocks the window chooses between arrive together and cannot be read as of different
 * instants.
 */
async function loadMembers(db: Db, storyIds: readonly string[]): Promise<readonly MemberRow[]> {
  if (storyIds.length === 0) return [];
  return db.query<MemberRow>(
    `select m.story_id, m.item_id, i.source, i.source_item_id, i.posted_at, i.first_seen_at,
            i.body, i.media,
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

/**
 * How many characters of somebody else's text may cross from Postgres into this process.
 * Not a display length — TICKER/NAME_MAX_CHARS in project.ts is where what a user sees is
 * decided, and it is a much smaller number applied where a test can call it with a literal.
 *
 * ★ IT IS APPLIED TO ALL THREE READS OF public.asset's TEXT, AND THAT IS NOT TIDINESS.
 * `symbol` and `name` are unbounded `text` columns holding strings an attacker typed, and
 * this projector runs inside a transaction while ingest is writing. But the reason it has
 * to be the SAME cap in every one of them is coins.ts: the frequency ceiling is only safe
 * while the words it counts are the words retrieval can match on. Truncate the corpus at
 * 200 characters while retrieval reads the full string and the two disagree about what a
 * coin's words ARE — a coin carrying the story's word at character 500 would be retrieved
 * and matched while contributing nothing to that word's count, which is exactly the
 * "measure over a narrower corpus than retrieval" failure `loadCorpusStats` is written to
 * avoid, arriving through the string length instead of through the row set.
 */
const TRANSPORT_TEXT_CAP = 200;

/**
 * ★ THE ORIGINS A SURFACE MAY PRESENT AS SOMETHING THAT HAPPENED, as a bound parameter.
 *
 * This is the list for every read that ASSERTS OBSERVATION — the launches rail, the count
 * printed beside it, and the two pairs statements, all of which head a screen with a claim
 * that what follows happened. It is the same list in all of them for the reason
 * TRANSPORT_TEXT_CAP is the same number in all of them: the rail and the count printed
 * beside it have to be one population.
 *
 * ★ IT IS NOT THE LIST THE STORY↔COIN READS USE, AND THAT DISTINCTION IS THE CHANGE THIS
 * COMMENT EXISTS TO RECORD. `loadCoinsInWindow` and `loadCorpusStats` used to carry this
 * constant too, on the reasoning that one predicate over one table should have one
 * spelling. It cost the six seeded stories every one of their seeded coins — four of the
 * six rows went from naming a coin to offering CREATE for a coin that already existed —
 * because a story had no provenance of its own to be matched against. Those two reads now
 * derive their allowlist from the story being matched; see `loadCoinsInWindow`. What
 * stayed here is exactly the set of reads whose subject is the market itself, where there
 * is no story to derive anything from and this list is the whole answer.
 *
 * A PARAMETER, NEVER AN INTERPOLATED LIST. Nothing in this file assembles SQL from a
 * value, and that is a property the service is tested on rather than promised. It also
 * means the closed list arrives from contracts — where it is declared, where 0013's CHECK
 * is held to it by a test — instead of being typed into string literals that could drift
 * from each other and from the schema.
 *
 * `= any(...)` and not `<> all(…'fixture'…)`: an allowlist excludes an origin added next
 * year by default, a denylist admits it. The failure mode here is publishing a fiction as
 * an observation, so exclusion is the only defensible default — and it is the same
 * argument `coinOriginsVisibleTo` makes about its own fall-through.
 */
const OBSERVED_ORIGINS: readonly string[] = [...OBSERVED_ASSET_ORIGINS];

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
 * Generous is not the same as unbounded, which is what this statement used to be.
 *
 * ★ THE WINDOW ARRIVES AS DATA. Each story's two ends are computed by `coinWindow` in
 * window.ts from the two clocks its members carry, and are passed in as parallel arrays
 * rather than derived in SQL. That is a deliberate move OUT of this file. The choice of
 * anchor is the only judgement in retrieval — it decides whether the resulting set can be
 * read as an ordering claim at all — and the previous version made it inside the string
 * literal below, as `o.opens_at is null or …`. Written that way it read like an abstention
 * and behaved like `where true`: a story whose posts never carried a time matched EVERY
 * ROW OF public.asset. Measured on this store before the fix, st_rooftop retrieved all 205
 * assets while the five stories with post times retrieved 3 to 12 each. The abstention was
 * right; spelling it as a predicate that is true for every row was not.
 *
 * THREE WAYS TO BE IN THE WINDOW became two, and the one that was deleted is the point:
 *
 *   1. `minted_at` falls inside the story's [from, to]. Where that window is anchored on a
 *      post time this is resolve's first and cheapest gate — a coin minted before the
 *      earliest post cannot have been minted from it, and no amount of name similarity
 *      overturns it. Where it is anchored on our own first sight it is NOT that gate and
 *      must never be read as it; window.ts carries the tag that says which.
 *
 *   2. `minted_at is null` — the coin's mint time was never learned. It is invisible to a
 *      time-first query by construction, so excluding it here would mean an unknown mint
 *      time silently deleted a coin from a comparison. It costs the coin the Buy
 *      affordance (0005's G1 gate, decided elsewhere), not its place on the row. Those two
 *      consequences are different and must stay so.
 *
 *      ★ THIS ARM IS STILL UNBOUNDED AND THAT IS A KNOWN, NAMED COST. Every coin with no
 *      mint time is retrieved for every story, so at scale it is the `limit` and not the
 *      window that holds it — one such asset exists in this store today. It is left alone
 *      because the alternative is bounding it by `first_seen_at`, and a coin whose mint
 *      time we never learned is exactly the coin whose first-seen time says least about
 *      it. If it ever needs a bound, `countWithoutMintTime` further down this file is the
 *      precedent for how to do it honestly: bound the LOOKING, never the ORDERING.
 *
 *   3. (deleted) "the story has no post time, so match everything". The abstention it was
 *      trying to express survives in window.ts, which hangs a BOUNDED window on the only
 *      other clock and marks the result as unable to support an ordering. An ordering
 *      claim needs both ends; with one end missing, "the coin predates the story" is not
 *      false, it is unanswerable — and answering it anyway is how a story loses the only
 *      coin it has. Refusing to answer it is not the same as refusing to narrow.
 *
 * ★ THE CAP IS ORDERED BY DISTANCE FROM THE ANCHOR, AND FOR A POST-ANCHORED WINDOW THAT
 * IS THE SAME ORDER IT ALWAYS WAS. Every row of a post-anchored window has
 * `minted_at >= anchor`, so `|minted_at − anchor|` ascending is `minted_at` ascending, row
 * for row — the six existing stories retrieve a byte-identical set. It stops being the
 * same order for a window that reaches backwards, and there `minted_at asc` would keep the
 * 500 rows FURTHEST in the past, which is the arbitrary-slice-of-ancient-history failure
 * the old escape had, merely at a smaller size. Nulls sort last under both, so the coins
 * with no mint time are still the first thing a cap gives up.
 */
/*
 * ★ AND `a.origin = any(...)` IS THE PREDICATE THAT KEEPS A FICTION FROM BEING NAMED UNDER
 * A REAL STORY — WITH THE LIST DERIVED FROM THE STORY, NOT FROM A CONSTANT.
 *
 * This is the board's story↔coin retrieval: whatever it returns is what `coinCandidates`
 * scores, and a coin that wins here is a coin the row names, with a cap beside it and —
 * when resolve is confident — a Buy affordance behind it. A seeded row reaching a real
 * story's set is therefore not a cosmetic problem. It is a demonstration coin attached to
 * something that actually happened, offered to a user as the coin that moment produced.
 *
 * ★ THE ALLOWLIST IS DIRECTIONAL, AND THE DIRECTION IS THE WHOLE POINT. The rule is
 * contracts' `coinOriginsVisibleTo`, applied to THIS story's own origin:
 *
 *   a fixture story may see fixture coins AND observed ones — a demonstration that
 *   happens to match a real coin is still a demonstration, and the row is labelled one
 *   everywhere it is shown, so nobody is told anything false about the world;
 *
 *   an observed story may see observed coins and NOTHING ELSE, ever — an invented coin on
 *   that row is a fiction presented as a finding, which is the entire failure this
 *   vocabulary exists to make unsayable.
 *
 * So it is NOT "same origin", which is the spelling that looks obviously right. Same-origin
 * would forbid the harmless half and buy nothing for the dangerous half, and it would do it
 * silently.
 *
 * ★ WHY IT IS NOT THE MODULE CONSTANT ANY MORE, stated as the bug it closes, because the
 * constant looked correct for a year. `OBSERVED_ORIGINS` is right for a surface that heads
 * itself with a claim about the market — the launches rail did serve thirteen invented
 * coins under NEW LAUNCHES, and an allowlist over the asset row is what stopped it. It is
 * wrong HERE because this query has a second subject. A story has provenance too, and the
 * constant could not see it: applied to candidate retrieval it told six seeded stories that
 * their own seeded coins did not exist. Measured on this store, the six rows went
 * none/unsure/one/several/one/several → none/unsure/none/none/none/none, and `none` is the
 * branch that puts CREATE on the row. Telling a user to make a coin for a story that
 * already has three is ranked in coins.ts as materially worse than uselessness, and it was
 * live on four rows out of six. A filter that cannot see its second subject is not a
 * stricter filter, it is a filter answering a different question.
 *
 * ★ ONE STATEMENT PER DISTINCT STORY ORIGIN ON THE FRAME, and never one per story. The
 * allowlist is a pure function of the origin, so stories sharing an origin share a
 * statement and the count is bounded by the VOCABULARY (two values today) rather than by
 * how many rows the board is carrying. The alternative — a per-story list, unnested
 * alongside the windows — needs a ragged array Postgres cannot express, or a lookup table
 * of (story origin, asset origin) pairs bound beside it, which is the rule itself smuggled
 * into a string literal where the test that owns it cannot read it.
 *
 * The predicate is still placed FIRST in the WHERE clause rather than appended to it, which
 * is not stylistic: the existing predicate is a disjunction (`minted_at is null OR in
 * window`), and a filter bolted onto the end of a disjunction without parentheses binds to
 * one arm. That is the exact shape of the escape hatch this function's own header describes,
 * so the clause is written where its scope is unambiguous to a reader.
 */
async function loadCoinsInWindow(
  db: Db,
  windows: ReadonlyMap<string, CoinWindow>,
  origins: ReadonlyMap<string, StoryOrigin>,
): Promise<readonly AssetRow[]> {
  if (windows.size === 0) return [];

  /* Grouped by the story's ORIGIN and not by the list derived from it: the derivation is a
     pure function, so the origin is the smaller key and the one a reader can check against
     the vocabulary. A story with a window and no origin is not a story whose coins can be
     filtered conservatively — there is no conservative answer, only a guess — so it is a
     throw. It is unreachable from `loadStoryFacts`, which builds both maps from the same
     rows in the same pass; it is reachable from a future caller that builds them apart. */
  const byOrigin = new Map<StoryOrigin, Map<string, CoinWindow>>();
  for (const [storyId, window] of windows) {
    const origin = origins.get(storyId);
    if (origin === undefined) {
      throw new TypeError(`story ${storyId} has a coin window but no origin to filter its coins by`);
    }
    const bucket = byOrigin.get(origin) ?? new Map<string, CoinWindow>();
    bucket.set(storyId, window);
    byOrigin.set(origin, bucket);
  }

  /* Concatenated rather than merged, and that is sound rather than lucky: a story belongs
     to exactly one group, so every row of a given story_id comes from one statement in that
     statement's `order by`. What concatenation does not preserve is the order of STORIES
     relative to each other, which nothing reads — `coinsByStory` buckets by id. */
  const rows: AssetRow[] = [];
  for (const [origin, group] of byOrigin) {
    rows.push(...(await loadCoinsForOrigin(db, group, coinOriginsVisibleTo(origin))));
  }
  return rows;
}

/**
 * The statement itself, for one allowlist and the stories that share it.
 *
 * Written once and called per group rather than per story, so the SQL — the window, the
 * cap, the ordering, the placement of the origin clause — has exactly one spelling however
 * many origins turn up on a frame. The allowlist arrives as `readonly string[]` because it
 * is about to be a bound parameter; it is contracts' list, never assembled here.
 */
async function loadCoinsForOrigin(
  db: Db,
  windows: ReadonlyMap<string, CoinWindow>,
  visibleOrigins: readonly string[],
): Promise<readonly AssetRow[]> {
  /* Parallel arrays rather than a values list built by string concatenation: `unnest`
     keeps this one statement over an id array — the shape every other read in this file
     has — and keeps every story-derived value a bound parameter. Nothing here is
     interpolated into SQL, which is a property this service is tested on rather than
     promised. */
  const storyIds: string[] = [];
  const anchors: string[] = [];
  const froms: string[] = [];
  const tos: string[] = [];
  for (const [storyId, window] of windows) {
    storyIds.push(storyId);
    anchors.push(new Date(window.anchorMs).toISOString());
    froms.push(new Date(window.fromMs).toISOString());
    tos.push(new Date(window.toMs).toISOString());
  }

  return db.query<AssetRow>(
    `select w.story_id,
            c.asset_key, c.address, c.venue_id, c.symbol, c.name, c.image_uri, c.minted_at
       from unnest($1::text[], $2::timestamptz[], $3::timestamptz[], $4::timestamptz[])
              as w(story_id, anchor_at, from_at, to_at)
       cross join lateral (
         select a.asset_key, a.address, a.venue_id,
                left(a.symbol, $6::int) as symbol,
                left(a.name, $6::int)   as name,
                a.image_uri, a.minted_at
           from public.asset a
          where a.origin = any($7::text[])
            and (a.minted_at is null
                 or (a.minted_at >= w.from_at and a.minted_at <= w.to_at))
          order by abs(extract(epoch from (a.minted_at - w.anchor_at))) asc nulls last,
                   a.asset_key asc
          limit $5
       ) c
      order by w.story_id, c.minted_at asc nulls last, c.asset_key asc`,
    [
      storyIds,
      anchors,
      froms,
      tos,
      DEFAULT_POLICY.resolve.maxCandidates,
      TRANSPORT_TEXT_CAP,
      visibleOrigins,
    ],
  );
}

interface CorpusRow {
  /** Selected so ONE scan can be split into a corpus per allowlist. See `loadCorpusStats`. */
  origin: string;
  symbol: string | null;
  name: string | null;
  assets: number;
}

/**
 * ★ HOW COMMON EACH WORD ALREADY IS, MEASURED OVER EXACTLY THE TABLE RETRIEVAL READS.
 *
 * coins.ts drops a story's word from the candidate test once too many coins already use it
 * — "the" is carried by 23 of the 205 assets in this store and cannot tell anybody which
 * coin a story produced. This is where that count comes from, and three things about it are
 * load-bearing:
 *
 *   1. IT IS EXACTLY THE POPULATION RETRIEVAL READS — the same table, the same origin
 *      filter, no window. The guarantee coins.ts relies on is an identity: a coin can only
 *      reach a row through a word its own symbol or name contains, and containing that
 *      word is what put it in this count. So df(word) is never smaller than the number of
 *      coins that word could admit, and the filter can never lag the harm. Measure over a
 *      NARROWER corpus than retrieval — a rolling window here while retrieval still
 *      reaches further back — and that identity breaks silently: the count says a word is
 *      rare while the coins using it are already on the row.
 *
 *      ★ WHICH IS WHY THE ORIGIN FILTER IS HERE TOO, AND WHY IT IS NOT A SEPARATE CHOICE.
 *      This used to say "unfiltered", and it was right to, because retrieval was
 *      unfiltered. Retrieval is now filtered, so this must be filtered THE SAME WAY or the
 *      identity above is gone — and it would break in the WIDER direction, which is the
 *      direction that is hard to notice: fixtures inflating a word's df make a real word
 *      look common, drop it from the candidate test, and quietly turn a `one` verdict into
 *      an `unsure` on a story whose coin we actually held. Five of this store's fixtures
 *      share the word "soup".
 *
 *      ★ AND "THE SAME WAY" IS NOW PER STORY, WHICH IS WHY THIS RETURNS A MAP. Retrieval's
 *      allowlist is derived from the story being matched, so there is no single population
 *      to count over any more: a fixture story is scored against a corpus that includes
 *      fixtures because it can retrieve them, and an observed story is scored against one
 *      that does not because it cannot. One corpus for both would break the identity for
 *      one of them by construction — narrower than retrieval for the fixture story (its own
 *      demonstration words would look rare), wider than retrieval for the observed story
 *      (words carried only by fictions would look common and be dropped from a real
 *      story's test). The two populations are one population PER STORY, and they move
 *      together or the count is about something that story's retrieval cannot return.
 *
 *      It is still ONE SCAN. The statement groups by origin as well as by the two text
 *      fields and the split happens here, in TypeScript, so the seventh round trip stays
 *      the seventh however many origins a frame carries — and every corpus is measured as
 *      of the same instant, which two statements could not promise.
 *
 *   2. IT IS READ IN THE SAME TRANSACTION AS THE COINS, not from a table refreshed on a
 *      schedule. A stored statistic is stale exactly when it matters most: a spam campaign
 *      arrives as fifteen mints in ninety seconds, and a count from last night's refresh
 *      calls its vocabulary rare for one whole frame. That is why there is no migration and
 *      no `db:corpus` step here — the statistic has no state of its own to keep.
 *
 *   3. THE TOKENISING IS NOT DONE HERE. This returns raw symbols and names and coins.ts
 *      splits them with the same `normalise` the test uses. A `regexp_split_to_table` in
 *      this string would be a second spelling of "the same words", counting words the test
 *      never sees and vice versa — and it would fail as a wrong number of coins on a row,
 *      with nothing anywhere saying why.
 *
 * The `group by` is not an optimisation for its own sake: fifteen assets in this store are
 * all called "70m views in 3days no brainer", so grouping identical pairs and carrying the
 * count is both smaller on the wire and the exact arithmetic document frequency wants.
 *
 * WHEN THIS SCAN STOPS BEING FREE — it is one sequential pass over two text columns, which
 * at 205 rows is nothing and at ten million is not — the move is an incrementally
 * maintained count written by ingest in the same transaction that inserts the asset, so
 * point 2 survives. It is NOT a nightly materialised view.
 */
async function loadCorpusStats(
  db: Db,
  storyOrigins: ReadonlySet<StoryOrigin>,
): Promise<ReadonlyMap<StoryOrigin, CorpusStats>> {
  const corpora = new Map<StoryOrigin, CorpusStats>();
  if (storyOrigins.size === 0) return corpora;

  /* The UNION of every allowlist on the frame, so one scan can serve them all. It is a
     union and not a whole-table read: an origin no story on this frame can retrieve is
     counted by nobody, and reading it would be the "measure over a wider corpus than
     retrieval" failure the header describes, arriving through a convenience. */
  const scanned = new Set<string>();
  for (const origin of storyOrigins) {
    for (const visible of coinOriginsVisibleTo(origin)) scanned.add(visible);
  }

  const rows = await db.query<CorpusRow>(
    `select a.origin,
            left(a.symbol, $1::int) as symbol,
            left(a.name, $1::int)   as name,
            count(*)::int as assets
       from public.asset a
      where a.origin = any($2::text[])
      group by 1, 2, 3`,
    [TRANSPORT_TEXT_CAP, [...scanned]],
  );

  /* One corpus per story origin, from the one scan. `corpusStats` sums per document, so
     splitting a (symbol, name) pair across two origin groups and counting both is the same
     arithmetic as one group carrying the total — the grouping key changed, the document
     frequency did not.

     `symbol` → `ticker` is the same rename toCoinFacts does one screen down. Doing it here
     too means the corpus and the coins being counted against it are the same two fields
     under the same two names, rather than two shapes a reader has to line up by hand. */
  for (const origin of storyOrigins) {
    const visible = new Set<string>(coinOriginsVisibleTo(origin));
    corpora.set(
      origin,
      corpusStats(
        rows
          .filter((row) => visible.has(row.origin))
          .map((row) => ({ ticker: row.symbol, name: row.name, assets: row.assets })),
      ),
    );
  }
  return corpora;
}

/**
 * The corpus a story of this origin is scored against.
 *
 * A throw and never `NO_CORPUS`, which is the tempting fallback and is a lie in this
 * position: coins.ts documents the empty corpus as a real state — no statistics, so the
 * frequency half of the candidate test stops removing anything — and reaching it by
 * ACCIDENT would silently loosen the rule on one story while every other row on the frame
 * was scored strictly. A missing key here means the map and the story rows were built from
 * different sets, which is a bug in this file and not a state of the world.
 */
function corpusFor(
  corpora: ReadonlyMap<StoryOrigin, CorpusStats>,
  origin: StoryOrigin,
): CorpusStats {
  const corpus = corpora.get(origin);
  if (corpus === undefined) throw new TypeError(`no corpus was measured for a ${origin} story`);
  return corpus;
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
/* ★ EXPORTED FOR THE SOURCE INDICATOR, AND FOR NO OTHER REASON. That surface needs a
   display name per source and the wire's rule is that the SERVER chooses it — the app never
   maps an id to a label, because that mapping is where a newly added platform silently
   renders as its raw id in front of a user. Exporting this keeps the mapping at one, which
   is the whole point of it; a second copy in the indicator's entrypoint would be a second
   answer to "what is this platform called". */
const SOURCE_LABELS: ReadonlyMap<string, string> = new Map([
  ['x', 'X'],
  ['tiktok', 'TikTok'],
  ['reddit', 'Reddit'],
  ['youtube', 'YouTube'],
  ['instagram', 'Instagram'],
]);

export function sourceLabel(source: string): string {
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
  corpus: CorpusStats,
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
    coins: coinCandidates(spans, coins, corpus),
    wasOnPreviousBoard,
  };
}

/**
 * What one board load returns: the facts, and which clock each story's coin window hung
 * on.
 *
 * ★ THE WINDOWS RIDE ALONGSIDE THE FACTS RATHER THAN INSIDE THEM, and that placement is
 * the point. `StoryFacts` is what the projection reads, and everything on it exists to
 * become part of an answer a user sees. Which clock we could anchor retrieval to is the
 * system reasoning about itself — it must reach an operator and must never reach the wire
 * — so it travels in a field the projection is not handed at all. The alternative, a tag
 * on StoryFacts that project.ts is trusted not to read, is one careless `...story` away
 * from the board.
 */
export interface StoryLoad {
  readonly stories: readonly StoryFacts[];
  /**
   * story id → the window its coins were retrieved through. A story with no members is
   * absent. Diagnostics for the run that produced the frame; never a payload field.
   */
  readonly coinWindows: ReadonlyMap<string, CoinWindow>;
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
 * The two clocks each story offers, minimised over its members.
 *
 * Derived from the rows `loadMembers` already returned rather than from a `group by` of
 * its own, so the window and the members on the row are computed from ONE read of
 * `public.item` — two statements could disagree if ingest committed a member between
 * them, and a window computed as of a different instant than the members it was computed
 * for is the kind of drift that shows up months later as one unexplainable row.
 *
 * ★ NEITHER MINIMUM IS READ FROM public.story. `earliest_post_at` there is NOT NULL only
 * because `least()` ignores nulls, so for a story whose posts never carried a time it
 * already holds a first-seen value under a post time's name, with nothing recording which
 * clock it came from — and because both of its writers use `least()`, the value can only
 * ever move backwards, so a member arriving later WITH a genuine post time cannot repair
 * it. Recomputing here from `public.item` is the only way to know which clock is which.
 */
function storyClocks(members: readonly MemberRow[]): ReadonlyMap<string, StoryClocks> {
  const byStory = new Map<string, { post: Millis | null; sight: Millis | null }>();
  for (const row of members) {
    const seen = byStory.get(row.story_id) ?? { post: null, sight: null };
    const postedAt = row.posted_at === null ? null : toMillis(row.posted_at);
    if (postedAt !== null && (seen.post === null || postedAt < seen.post)) seen.post = postedAt;
    const sightAt = toMillis(row.first_seen_at);
    if (seen.sight === null || sightAt < seen.sight) seen.sight = sightAt;
    byStory.set(row.story_id, seen);
  }

  const clocks = new Map<string, StoryClocks>();
  for (const [storyId, seen] of byStory) {
    clocks.set(storyId, { earliestPostMs: seen.post, earliestSightMs: seen.sight });
  }
  return clocks;
}

/**
 * Everything the projection needs, in seven round trips regardless of how many stories
 * come back — plus one more for each ADDITIONAL story origin on the frame, which is
 * bounded by the vocabulary (two values) and not by the size of the board. See
 * `loadCoinsInWindow`: the coin allowlist is derived per story, so stories sharing an
 * origin share a statement and nothing here is ever per-story.
 *
 * Seven and not seven-per-story: every fetch after the first is one statement over an id
 * array. A per-story loop here would be a thousand queries inside a single transaction,
 * which holds a backend open for the whole frame — and the projector runs while ingest is
 * writing. The two coin reads are separate statements rather than one join because the
 * spans and the mint window are independent of each other: they only meet in coins.ts,
 * where the meeting is a pure function that a test can call with two literals.
 *
 * ★ THE COIN WINDOW IS COMPUTED BETWEEN THE MEMBERS AND THE COINS, not inside either
 * query. It needs the members (both of the clocks it chooses between live on
 * `public.item`) and the coin read needs it, so it sits between them and costs no extra
 * round trip. Which clock each story got comes back on the load, because a run that
 * starts anchoring rows on our own reading schedule has to be visible from the outside.
 *
 * ★ THE SEVENTH IS THE CORPUS — one `group by` over public.asset, no window and no story
 * ids, because the question it answers is about the market and not about any row. It is a
 * near-whole-table read where every other statement here is narrowed, and that is the
 * point: coins.ts only stays safe while the words it calls common are counted over exactly
 * the rows retrieval can return. It reads inside the same transaction as the coins, so no
 * coin can be on a row under a count that did not see it — and it comes back as a corpus
 * PER STORY ORIGIN, from one scan, because "exactly the rows retrieval can return" is now
 * a different set for a fixture story than for an observed one.
 *
 * ★ THE SIXTH IS THE MARKET, AND IT IS A SEPARATE STATEMENT RATHER THAN A LATERAL JOIN
 * ONTO THE COIN QUERY, on purpose. Joined in, it would have to be a LEFT join — an inner
 * one would DELETE every coin nobody has read yet, which is most of them and is the
 * population this product exists to serve, and it would delete them silently: the row
 * would simply have fewer coins on it, with nothing anywhere saying why. Separating the
 * two makes "no reading" a null in a Map lookup, which is a state with a name.
 */
export async function loadStoryFacts(db: Db, window: LoadWindow): Promise<StoryLoad> {
  const storyRows = await loadStories(db, window.storiesSinceMs, window.limit);
  if (storyRows.length === 0) return { stories: [], coinWindows: new Map() };

  const storyIds = storyRows.map((row) => row.story_id);
  const memberRows = await loadMembers(db, storyIds);
  const reach = await loadReach(
    db,
    memberRows.map((row) => row.item_id),
    window.reachSinceMs,
  );
  const spans = await loadEntitySpans(db, storyIds);

  /* A story with no members at all gets no window and therefore no coins. It has no
     `entitySpan` fingerprints either — spans are read through the same story_member rows —
     so coins.ts would link it to nothing whatever retrieval returned. Absent from the map
     rather than present with a null window: there is no window, and a shape that can say
     so is better than one that has to be checked for a sentinel. */
  const coinWindows = new Map<string, CoinWindow>();
  for (const [storyId, clocks] of storyClocks(memberRows)) {
    const computed = coinWindow(clocks);
    if (computed !== null) coinWindows.set(storyId, computed);
  }

  /* Both provenance inputs are read off the SAME story rows, in one pass, so the allowlist
     a story's coins were retrieved through and the corpus they were counted against cannot
     be derived from two different ideas of what that story is. */
  const storyOrigins = new Map<string, StoryOrigin>(
    storyRows.map((row) => [row.story_id, row.origin]),
  );
  const coinRows = await loadCoinsInWindow(db, coinWindows, storyOrigins);
  const corpora = await loadCorpusStats(db, new Set(storyOrigins.values()));
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

  return {
    stories: storyRows.map((row) =>
      toStoryFacts(
        row,
        byStory.get(row.story_id) ?? [],
        reach,
        spans.get(row.story_id) ?? [],
        coins.get(row.story_id) ?? [],
        corpusFor(corpora, row.origin),
        window.previousBoard.has(row.story_id),
      ),
    ),
    coinWindows,
  };
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
 * The most recently minted coins, newest first.
 *
 * ★ `a.origin = any(...)` IS THE MOST IMPORTANT LINE IN THIS FUNCTION AND IT IS WHY THIS
 * COMMENT IS LONGER THAN THE QUERY.
 *
 * Without it, this statement returned ELEVEN ROWS OF WHICH ELEVEN WERE INVENTED, and the
 * rail put six of them on screen under a heading saying NEW LAUNCHES. The mechanism was
 * the WHERE clause and not the ORDER BY, which is worth stating precisely because the
 * instinct is to widen the window: 192 genuinely observed mints sat in the same table,
 * all stamped six days earlier, so `minted_at >= now() - 6 hours` excluded every one of
 * them before the ordering ever ran — while the seed anchors its fixtures to load time,
 * which puts them inside ANY window and always at the top of it. Widening the window
 * would not have fixed this. It would have put the fictions above the observations.
 *
 * ★ THE FILTER IS HERE AND NOT IN THE APP, and that is the whole design. The app could be
 * given the origin and asked not to render fixtures — and then a demo row would be
 * sitting in a response body, in a browser's memory, one component away from a screen,
 * kept off it by a client-side decision. Refusing it in the projection means the payload
 * that reaches the browser is structurally incapable of carrying one: there is no field
 * for it, the row is not in the frame, and no amount of rewriting the rail can produce it.
 * Same argument 0009 makes about the censoring — the process serving the browser is not
 * trusted to behave, it is handed data that makes the wrong behaviour impossible.
 *
 * ★ AND IT IS AN ALLOWLIST, NOT `<> 'fixture'`. A denylist admits every origin invented
 * after it was written, including the one that means "we cannot vouch for this row". On a
 * predicate whose failure mode is publishing a fiction as an observation, the default has
 * to be exclusion. The list itself lives in contracts, is a CHECK constraint in 0013, and
 * is held to both by a test — it is not typed into this string.
 *
 * The honest consequence, on the store this was written against: this query now returns
 * ZERO ROWS, because the only coins inside a six-hour window were the invented ones. That
 * is the true answer, the rail already renders it correctly ("No coins minted in the
 * window"), and the freshness fact projected beside it is what turns a correct-but-mute
 * answer into an informative one.
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
        and a.origin = any($4::text[])
        and a.minted_at >= to_timestamp($1::double precision / 1000.0)
      order by a.minted_at desc, a.asset_key desc
      limit $2`,
    [window.sinceMs, window.limit, TRANSPORT_TEXT_CAP, OBSERVED_ORIGINS],
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
 *
 * ★ IT CARRIES THE SAME ORIGIN FILTER AS THE QUERY IT DESCRIBES, and it has to: this is a
 * diagnostic about coins the RAIL refused, printed so that a rail quieter than the world
 * is answerable. A fixture is not a coin the rail refused for want of a mint time — it is
 * a coin the rail refused for not existing — so counting it here would inflate a number an
 * operator reads as "the world produced mints we could not place". Two exclusions, two
 * different sentences, and only one of them belongs in this count.
 */
async function countWithoutMintTime(db: Db, window: LaunchWindow): Promise<number> {
  const rows = await db.query<{ n: string }>(
    `select count(*)::text as n
       from public.asset a
      where a.minted_at_conf = 'unknown'
        and a.origin = any($2::text[])
        and a.first_seen_at >= to_timestamp($1::double precision / 1000.0)`,
    [window.sinceMs, OBSERVED_ORIGINS],
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
  source: WireFeedSource,
): Promise<number> {
  await db.query(
    /* ★ THE FRESHNESS FACT RIDES ON THE VIEW ROW, in this insert, inside the caller's
       transaction. Not a second table and not a second request: a rail that fetched the
       rows and the "last heard" instant separately could render rows from one frame under
       a freshness claim from another, which is the "two spellings of one thing that can
       disagree" both 0011 and the wire refuse. A frame and the state of the feed behind it
       commit together or neither does. */
    `insert into public.launch_view (feed_id, tick, projected_at, source)
     values ($1, $2, now(), $3::jsonb)
     on conflict (feed_id) do update
       set tick = excluded.tick,
           projected_at = excluded.projected_at,
           source = excluded.source`,
    [feedId, tick, JSON.stringify(source)],
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

/* ── pairs: the mints that reached a market ───────────────────────────── */

/**
 * ★ WHETHER public.asset RECORDS WHERE ITS ROWS CAME FROM.
 *
 * This is not a feature flag and it is not a version check. It is the one question that
 * decides whether the pairs screen may list anything at all, and it has to be asked of the
 * DATABASE rather than assumed from the code, because the answer changes underneath a
 * running deployment the moment a migration lands.
 *
 * The reason it is asked: nothing else on that table can tell a row written by a demo tool
 * from a row observed on a live feed. `minted_at_source` records where the mint TIME came
 * from, which is a different fact — the seed writes all four of its values — and the
 * `venue_id` spellings that happen to differ today are two writers disagreeing about a
 * format, one commit away from being wrong in both directions. So there is exactly one
 * honest discriminator, and until it exists this surface withholds its rows rather than
 * listing fictions under a heading that says a venue priced them.
 *
 * ★ IT IS DELIBERATELY NOT A `try { … } catch (undefined_column)`. A caught error would
 * make "the column is missing" and "the query is broken" the same event, and the second
 * one would then be published to users as the first one's honest empty state. This asks a
 * question and gets an answer.
 *
 * information_schema is privilege-filtered — it shows a column only to a role that holds
 * some privilege on it — and that is a property in our favour rather than a caveat. A role
 * that cannot see `origin` here could not have selected it either, so it gets `false` and
 * the screen withholds, which is the right answer for exactly that role.
 */
export async function assetOriginIsRecorded(db: Db): Promise<boolean> {
  const rows = await db.query<{ present: boolean }>(
    `select exists (
       select 1
         from information_schema.columns
        where table_schema = 'public'
          and table_name = 'asset'
          and column_name = 'origin'
     ) as present`,
    [],
  );
  return rows[0]?.present === true;
}

interface PairRow {
  asset_key: string;
  address: string;
  venue_id: string;
  symbol: string | null;
  name: string | null;
  minted_at: Date | string | null;
  minted_at_conf: MintTimeConfidence;
  minted_at_bound_s: number | null;
  taken_at: Date | string;
  price_usd: number | null;
  price_absent: MarketAbsenceReason | null;
  market_cap_usd: number | null;
  market_cap_absent: MarketAbsenceReason | null;
  market_cap_basis: MarketCapBasis | null;
  liquidity_usd: number | null;
  liquidity_absent: MarketAbsenceReason | null;
}

export interface PairWindow {
  /** Coins minted at or after this instant. A presentation bound, not a judgement. */
  readonly sinceMs: Millis;
  readonly limit: number;
}

/**
 * The latest reading per asset, as a CTE both statements below share verbatim.
 *
 * `distinct on (asset_key) … order by asset_key, taken_at desc` walks 0010's
 * `market_reading_latest_idx (asset_key, taken_at desc)` and stops at the first row per
 * key, so the cost is one seek per coin rather than a scan of the series.
 *
 * ★ IT IS ONE STRING BECAUSE THE TWO STATEMENTS MUST NOT DRIFT. The listing and the counts
 * are two queries over one population, and the sentence on screen — "6 of 192 mints have a
 * market" — is only true while both mean the same thing by "has a market". A second copy of
 * this CTE with `taken_at desc` fixed in one place and not the other would make the ratio
 * quietly wrong rather than loudly broken.
 */
const LATEST_READING_CTE = `with latest as (
       select distinct on (r.asset_key)
              r.asset_key, r.taken_at,
              r.price_usd, r.price_absent,
              r.market_cap_usd, r.market_cap_absent, r.market_cap_basis,
              r.liquidity_usd, r.liquidity_absent
         from public.market_reading r
        order by r.asset_key, r.taken_at desc
     )`;

/**
 * The mints that reached a market, newest MINT first.
 *
 * ★ THIS IS THE ONE PLACE IN THE PROJECTOR WHERE AN INNER JOIN IS CORRECT, and the
 * neighbouring queries say the opposite for a reason worth stating side by side.
 * `loadStoryFacts` and `loadLaunchFacts` both read the market in a SEPARATE statement,
 * because joined in it would have to be a LEFT join and an inner one would silently delete
 * every coin nobody has read yet — which is most of a launches feed by construction.
 *
 * Here the reading IS the membership test. A coin with no priced reading is not a pair; it
 * is precisely the thing this screen exists to count and not to list. So the join is not a
 * hidden filter that happens to drop rows, it is the filter, written out loud — and
 * `price_absent is null` is the whole definition of "a venue could price this", which by
 * 0010's `price_xor_reason` is the same statement as "there is a price".
 *
 * ★ THE PROVENANCE CLAUSE IS AN ALLOWLIST AND NOT `origin <> 'fixture'`, which is the
 * spelling that looks obviously right and is wrong. A denylist admits every value added
 * after it was written — including `unrecorded`, whose whole meaning is "we cannot vouch for
 * this row" — so a sixth origin arriving in a year would appear on this screen by default.
 * The list is `OBSERVED_ORIGINS`, this file's one binding of contracts'
 * `OBSERVED_ASSET_ORIGINS`, passed as a parameter rather than typed into this string. It is
 * the constant and not a fresh spread of the contracts list at each call site for the reason
 * that constant's own header gives: the rail, the count beside it and these two statements
 * have to be ONE population, and a second spelling of the same list is the shape that lets
 * them stop being one without anything failing.
 *
 * ★ AND IT IS WHY THE CALLER MUST ASK `assetOriginIsRecorded` FIRST. This statement names a
 * column that does not exist on every database this repository can be pointed at. That is
 * deliberate: the predicate is written once, correctly, and the caller's job is to establish
 * that it can be asked rather than to fall back to a version of this query without it. There
 * is no such version and there must never be one — a pairs listing with the provenance
 * clause quietly dropped is the exact bug this screen was built in response to.
 *
 * `minted_at_conf <> 'unknown'` excludes coins whose mint time we never learned, for
 * `loadLaunches`' reason: they cannot be placed on the axis this list is ordered by, and
 * ordering them by `first_seen_at` instead would be the "backfill the mint time from when
 * we looked" mistake wearing an ORDER BY. The counts below apply the same clause, so the
 * ratio is over the same population as the list.
 *
 * `left(…, $3)` bounds the BYTES pulled into this process, not the display — see
 * `loadLaunches`. The display bound is a much smaller number applied in project.ts.
 */
async function loadPairs(db: Db, window: PairWindow): Promise<readonly PairRow[]> {
  return db.query<PairRow>(
    `${LATEST_READING_CTE}
     select a.asset_key,
            a.address,
            a.venue_id,
            left(a.symbol, $3::int) as symbol,
            left(a.name, $3::int)   as name,
            a.minted_at,
            a.minted_at_conf,
            a.minted_at_bound_s,
            l.taken_at,
            l.price_usd, l.price_absent,
            l.market_cap_usd, l.market_cap_absent, l.market_cap_basis,
            l.liquidity_usd, l.liquidity_absent
       from public.asset a
       join latest l on l.asset_key = a.asset_key
      where a.minted_at is not null
        and a.minted_at_conf <> 'unknown'
        and a.minted_at >= to_timestamp($1::double precision / 1000.0)
        and l.price_absent is null
        and a.origin = any($4::text[])
      order by a.minted_at desc, a.asset_key desc
      limit $2`,
    [window.sinceMs, window.limit, TRANSPORT_TEXT_CAP, OBSERVED_ORIGINS],
  );
}

export async function loadPairFacts(db: Db, window: PairWindow): Promise<readonly PairFacts[]> {
  const rows = await loadPairs(db, window);
  return rows.map((row) => ({
    assetKey: row.asset_key,
    ticker: row.symbol,
    name: row.name,
    address: row.address,
    venueLabel: venueLabel(row.venue_id),
    mintedAt: row.minted_at === null ? null : toMillis(row.minted_at),
    mintPrecision: row.minted_at_conf,
    mintBoundS: row.minted_at_bound_s,
    readAt: toMillis(row.taken_at),
    priceUsd: toMarketNumber(row.price_usd, row.price_absent, 'price_usd'),
    marketCapUsd: toMarketNumber(row.market_cap_usd, row.market_cap_absent, 'market_cap_usd'),
    marketCapBasis: row.market_cap_basis,
    liquidityUsd: toMarketNumber(row.liquidity_usd, row.liquidity_absent, 'liquidity_usd'),
  }));
}

/**
 * The denominator, the numerator and the remainder — from one statement, over one window.
 *
 * ★ A LEFT JOIN HERE, AND THE FILTER HAS TO SAY `l.taken_at is not null` OUT LOUD.
 * This is the trap in the whole file. Under a LEFT join, a coin with NO reading at all
 * arrives with every `l.` column null — including `l.price_absent` — so the obvious
 * `filter (where l.price_absent is null)` counts "we never read this coin" as "a venue
 * priced this coin", which is the opposite of the truth and would put the headline number
 * out by roughly a factor of thirty on the data this store holds today. `l.taken_at` is
 * `not null` on the source table, so its nullness here means exactly one thing: no row
 * joined.
 *
 * ★ AND NO LIMIT. `loadPairs` has one and a count under a limit is not a count, which is
 * why this is a second statement rather than a `count(*) filter` bolted onto the first.
 *
 * The third figure is computed HERE rather than subtracted by the caller so that all three
 * come out of one row of one result set. Two of them plus arithmetic somewhere else is two
 * places for the population to be described, and the day they disagree the sentence on
 * screen is a ratio of two different things.
 */
export async function loadPairCounts(db: Db, window: PairWindow): Promise<PairCounts> {
  const rows = await db.query<{ minted: string; with_market: string; without_market: string }>(
    `${LATEST_READING_CTE}
     select count(*)::text as minted,
            count(*) filter (where l.taken_at is not null and l.price_absent is null)::text
              as with_market,
            (count(*) - count(*) filter (where l.taken_at is not null and l.price_absent is null))::text
              as without_market
       from public.asset a
       left join latest l on l.asset_key = a.asset_key
      where a.minted_at is not null
        and a.minted_at_conf <> 'unknown'
        and a.minted_at >= to_timestamp($1::double precision / 1000.0)
        and a.origin = any($2::text[])`,
    [window.sinceMs, OBSERVED_ORIGINS],
  );
  const row = rows[0];
  /* No row from a bare aggregate is not a quiet zero — an aggregate with no GROUP BY
     always returns exactly one row, so an empty result means the statement did not run the
     way this function believes it did. A fabricated 0 here would render as "0 of 0 mints
     have a market", which is a confident sentence about nothing. */
  if (row === undefined) throw new TypeError('the pair counts returned no row at all');
  return {
    mintsInWindow: Number(row.minted),
    withMarket: Number(row.with_market),
    withoutMarket: Number(row.without_market),
  };
}

/**
 * ★ WHEN A MINT WAS LAST HEARD — AND WHY `and not gap` IS THE WHOLE CORRECTNESS ARGUMENT.
 *
 * internal.mint_coverage records windows, and a window is either one we observed or one we
 * declared dark. `PgAssetRepo.latestCoverage` orders by `window_to desc` across ALL rows
 * including the gap ones, and it is right to: its question is "how far did we get, so where
 * do we resume", and a gap row is still a record of where we got to.
 *
 * That is not this question. A gap row's `window_to` advances while nothing was heard, so a
 * feed that reconnects and immediately records a six-day gap `[T, now]` would push that
 * answer to `now` — and a freshness fact built on it would announce the feed live over
 * exactly the interval we recorded as silent. It would be wrong precisely when it matters.
 * The two questions need two reads, and this is the second one.
 *
 * ★ THE ANSWER IS THE MINIMUM OVER THE CHAINS, NOT THE MAXIMUM. A feed is only as live as
 * its stalest source: if one chain has been silent for six days, the screen is six days
 * stale whatever the others are doing. And a chain with no observed window at all — only
 * gaps, or nothing — makes the whole answer absent rather than being skipped, because
 * `min()` ignores nulls and skipping is how the one chain nobody has ever heard from stops
 * being visible. Today `chain in ('solana')` makes this a single row; the rule is written
 * now so that the second chain does not arrive as a silent behaviour change.
 *
 * The grouping is done in SQL and the choosing in TypeScript, deliberately: a `case when`
 * expression spanning both would be one unreadable line, and this file's neighbours already
 * hold to "if a value needs working out, it happens where a test can call it".
 */
export async function lastMintHeardAt(db: Db): Promise<Millis | null> {
  const rows = await db.query<{ chain: string; last_heard: Date | string | null }>(
    `select c.chain, max(c.window_to) filter (where not c.gap) as last_heard
       from internal.mint_coverage c
      group by c.chain`,
    [],
  );
  /* No coverage rows at all means nothing has ever watched for a mint, which is the same
     answer for the user as "we have never heard one" and is spelled the same way. */
  if (rows.length === 0) return null;

  let earliest: Millis | null = null;
  for (const row of rows) {
    if (row.last_heard === null) return null;
    const heard = toMillis(row.last_heard);
    if (earliest === null || heard < earliest) earliest = heard;
  }
  return earliest;
}

/**
 * The next frame number for the pairs feed.
 *
 * A third function rather than a parameterised first one, for the reason `nextLaunchTick`
 * gives in full: generalising over the three projections means passing a table name and a
 * key column as strings, and a statement assembled from an identifier is a statement where
 * "is every parameter parameterised" stops being answerable by reading.
 */
export async function nextPairTick(db: Db, feedId: string): Promise<number> {
  const rows = await db.query<{ tick: string }>(
    `select tick::text as tick from public.pair_view where feed_id = $1`,
    [feedId],
  );
  const current = rows[0];
  return current === undefined ? 1 : Number(current.tick) + 1;
}

/**
 * Commit one pairs frame.
 *
 * Same order as `writeBoard` and `writeLaunches`, and for the same reasons: the view row
 * first because `pair_row` references it, then the rows that have fallen out of the window,
 * then the survivors with their new positions — all inside the caller's transaction, so a
 * half-written screen is not a state the read service can observe.
 *
 * ★ THE VIEW ROW IS WRITTEN EVEN WHEN THERE ARE NO PAIRS, and that is why it goes first.
 * `GET /pairs/:feedId` answers 404 when there is no view row, which means "this feed has
 * never been projected". That is a real fact and a different one from "we projected, and
 * nothing we captured reached a market" — which is the TRUE answer on this store today, and
 * the one the screen can render honestly. Collapsing them would show a transport error over
 * a quiet market, which is the single failure both this surface and the launches rail were
 * built to avoid.
 *
 * The head rides on that same insert, so the frame and the sentence describing it commit or
 * roll back together. There is no arrangement in which a screen shows rows from one
 * projection beside a count from another.
 */
export async function writePairs(
  db: Db,
  feedId: string,
  tick: number,
  head: WirePairHead,
  pairs: readonly WirePair[],
): Promise<number> {
  await db.query(
    `insert into public.pair_view (feed_id, tick, projected_at, head)
     values ($1, $2, now(), $3::jsonb)
     on conflict (feed_id) do update
       set tick = excluded.tick, projected_at = excluded.projected_at, head = excluded.head`,
    [feedId, tick, JSON.stringify(head)],
  );

  await db.query(`delete from public.pair_row where feed_id = $1 and asset_key <> all($2::text[])`, [
    feedId,
    pairs.map((pair) => pair.pairId),
  ]);

  let written = 0;
  for (const [position, pair] of pairs.entries()) {
    await db.query(
      `insert into public.pair_row (feed_id, asset_key, position, payload)
       values ($1, $2, $3, $4::jsonb)
       on conflict (feed_id, asset_key) do update
         set position = excluded.position, payload = excluded.payload`,
      [feedId, pair.pairId, position, JSON.stringify(pair)],
    );
    written += 1;
  }
  return written;
}

/* ── which sources we ingest from are answering ───────────────────────── */

/**
 * The next frame number for the source indicator.
 *
 * A third nine-line function rather than a parameterised first one, for the reason
 * `nextLaunchTick` gives at length: generalising over the projections means passing a table
 * name and a key column as strings, and a table name arriving as a string is the one habit
 * this file must never start. The moment a statement is assembled from an identifier, "is
 * every parameter parameterised" stops being answerable by reading.
 */
export async function nextSourceTick(db: Db, viewId: string): Promise<number> {
  const rows = await db.query<{ tick: string }>(
    `select tick::text as tick from public.source_view where view_id = $1`,
    [viewId],
  );
  const current = rows[0];
  return current === undefined ? 1 : Number(current.tick) + 1;
}

/**
 * Commit one indicator frame.
 *
 * ★ ONE STATEMENT, BECAUSE THE WHOLE FRAME IS ONE VALUE. Unlike the board, the rail and the
 * pairs screen there is no row table here: three to five sources, in an order the projector
 * already decided, read whole on every poll. A row-per-source table would buy per-row
 * patching and pagination that nothing will ever use, and would cost a second statement
 * whose result set could describe a different moment from the tick beside it. 0014's
 * `pair_view.head` made the same call for the same reason.
 *
 * ★ AND IT IS WRITTEN EVEN WHEN THE ARRAY IS EMPTY, which is the point of writing it
 * unconditionally. `GET /sources/:viewId` answers 404 when there is no row, which means
 * "this indicator has never been projected" — a real fact, and a different one from "we
 * projected, and we ingest from nothing". Skipping the insert on an empty run would collapse
 * the two, and the shell would show a transport failure over a pipeline that is merely
 * switched off.
 */
export async function writeSources(
  db: Db,
  viewId: string,
  tick: number,
  sources: readonly WireSourceHealth[],
): Promise<number> {
  await db.query(
    `insert into public.source_view (view_id, tick, projected_at, sources)
     values ($1, $2, now(), $3::jsonb)
     on conflict (view_id) do update
       set tick = excluded.tick,
           projected_at = excluded.projected_at,
           sources = excluded.sources`,
    [viewId, tick, JSON.stringify(sources)],
  );
  return sources.length;
}
