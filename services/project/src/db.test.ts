/**
 * WHAT THE COIN QUERY ACTUALLY ASKS THE DATABASE FOR.
 *
 * window.test.ts proves the arithmetic. This file proves the arithmetic is what reaches
 * Postgres — which is a separate claim, and it is the one that was false. The bound was
 * never missing from anybody's intent; it was missing from the string literal, where the
 * abstention "this story has no post time, so we cannot order its coins" was spelled
 * `o.opens_at is null or …` and therefore matched every row in public.asset.
 *
 * ★ WHY ASSERTING THE PARAMETERS IS ASSERTING THE WINDOW, and not a weaker stand-in for
 * it. After this change the coin statement has exactly one story-dependent predicate —
 * `a.minted_at between w.from_at and w.to_at` — and both of its ends arrive as bound
 * parameters. There is no other clause that narrows by story, so the parameters ARE the
 * window: a test that pins them pins what comes back. That is only true while the SQL has
 * no second escape hatch in it, which is why the shape of the statement is asserted here
 * too rather than taken on trust.
 *
 * These tests do not touch a database. `Db` is one method, so the fake below is a real
 * implementation of the port that records what it was asked and answers with canned rows.
 * A live measurement of the row COUNTS is a different exercise and belongs in a run, not
 * in a test suite that has to pass on a laptop with no Postgres.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_POLICY, OBSERVED_ASSET_ORIGINS } from '@insidor/contracts';
import { coinOriginsVisibleTo } from '@insidor/contracts/story.ts';
import type { StoryOrigin } from '@insidor/contracts/story.ts';
import type { Db } from '@insidor/store';

import { loadLaunchFacts, loadPairCounts, loadPairFacts, loadStoryFacts } from './db.ts';

/* ── a Db that answers, and remembers ─────────────────────────────────── */

interface Ask {
  readonly sql: string;
  readonly params: readonly unknown[];
}

/**
 * One member row as loadMembers returns it. Only the four columns the window and the
 * assembly touch carry real values; the rest are the shape the row has to have.
 */
function member(
  storyId: string,
  itemId: string,
  postedAt: string | null,
  firstSeenAt: string,
): Record<string, unknown> {
  return {
    story_id: storyId,
    item_id: itemId,
    source: 'x',
    source_item_id: itemId,
    posted_at: postedAt === null ? null : new Date(postedAt),
    first_seen_at: new Date(firstSeenAt),
    body: 'a body',
    media: null,
    handle: 'someone',
    display_name: 'Someone',
    source_author_id: 'a1',
    evidence_kind: 'carrier',
    carrier_kind: 'entitySpan',
    lineage_via: null,
  };
}

/**
 * ★ 'observed' AND NOT 'fixture' IS THE RIGHT DEFAULT FOR A TEST THAT DID NOT THINK ABOUT
 * PROVENANCE. It is the narrow allowlist: a test written without this in mind gets the
 * strict answer, and a test that wants the permissive one has to say so out loud.
 */
const DEFAULT_STORY_ORIGIN: StoryOrigin = 'observed';

function story(storyId: string, origin: StoryOrigin): Record<string, unknown> {
  return {
    story_id: storyId,
    origin,
    display_title: 'A story',
    thumb_uri: null,
    last_member_at: new Date('2026-08-17T01:42:00Z'),
    member_count: 1,
    distinct_authors: 1,
    distinct_sources: 1,
  };
}

/**
 * Dispatches on a distinctive fragment of each statement, and records every ask.
 *
 * `origins` names the story rows that are NOT the default — the frame is otherwise all
 * observed. It is a map and not a flag because the interesting frames are the mixed ones:
 * the rule under test is per story, so a test that could only make every row the same kind
 * could not tell a per-story allowlist from a module constant.
 */
function fakeDb(
  members: readonly Record<string, unknown>[],
  origins: ReadonlyMap<string, StoryOrigin> = new Map(),
): { db: Db; asks: Ask[] } {
  const asks: Ask[] = [];
  const storyIds = [...new Set(members.map((row) => row['story_id'] as string))].sort();

  const db: Db = {
    query: (sql: string, params: readonly unknown[] = []) => {
      asks.push({ sql, params });
      if (sql.includes('from public.story\n')) {
        return Promise.resolve(
          storyIds.map((id) => story(id, origins.get(id) ?? DEFAULT_STORY_ORIGIN)) as never,
        );
      }
      if (sql.includes('join public.author')) return Promise.resolve(members as never);
      /* The pairs counts are a bare aggregate, so the real driver always returns exactly one
         row and `loadPairCounts` throws on zero — deliberately, because a fabricated 0 there
         would render as "0 of 0 mints have a market". The fake has to answer like the driver
         does or the statement never gets far enough to be recorded. */
      if (sql.includes('as minted')) {
        return Promise.resolve([{ minted: '0', with_market: '0', without_market: '0' }] as never);
      }
      return Promise.resolve([] as never);
    },
  };
  return { db, asks };
}

/** Every coin-retrieval statement issued — one per distinct story origin on the frame. */
const coinAsks = (asks: readonly Ask[]): readonly Ask[] =>
  asks.filter((a) => a.sql.includes('from public.asset a') && a.sql.includes('unnest'));

/**
 * The coin statement, where a frame has only one.
 *
 * It asserts there is exactly ONE rather than taking the first, and that is not
 * pedantry: every window test below reads its window out of the parameters of "the"
 * statement, and on a mixed-origin frame a story's window lives in whichever of the two
 * statements its origin routed it to. Taking the first would quietly read the wrong one.
 */
const coinAsk = (asks: readonly Ask[]): Ask => {
  const found = coinAsks(asks);
  assert.equal(found.length, 1, `expected one coin retrieval statement, saw ${found.length}`);
  return found[0] as Ask;
};

/** The corpus scan: one `group by` over public.asset, no window and no story ids. */
const corpusAsk = (asks: readonly Ask[]): Ask => {
  const ask = asks.find((a) => a.sql.includes('group by 1, 2, 3'));
  assert.notEqual(ask, undefined, 'no corpus statement was issued');
  return ask as Ask;
};

/** The origin allowlist bound to a statement, whichever parameter position it landed in. */
const boundOrigins = (ask: Ask): readonly string[] => {
  const bound = ask.params.find((p) => Array.isArray(p) && p.includes('live_stream'));
  assert.notEqual(bound, undefined, 'no origin list was bound to the statement');
  return bound as readonly string[];
};

/** The [anchor, from, to] the statement was given for one story, as milliseconds. */
function windowFor(ask: Ask, storyId: string): { anchor: number; from: number; to: number } {
  const ids = ask.params[0] as string[];
  const at = ids.indexOf(storyId);
  assert.notEqual(at, -1, `story ${storyId} was not in the coin statement`);
  const column = (index: number): number => Date.parse((ask.params[index] as string[])[at] as string);
  return { anchor: column(1), from: column(2), to: column(3) };
}

const load = (members: readonly Record<string, unknown>[]) =>
  loadStoryFacts(fakeDb(members).db, {
    storiesSinceMs: 0,
    reachSinceMs: 0,
    limit: 100,
    previousBoard: new Set<string>(),
  });

async function askFor(members: readonly Record<string, unknown>[]): Promise<Ask> {
  const { db, asks } = fakeDb(members);
  await loadStoryFacts(db, {
    storiesSinceMs: 0,
    reachSinceMs: 0,
    limit: 100,
    previousBoard: new Set<string>(),
  });
  return coinAsk(asks);
}

/* ── the statement's own shape ────────────────────────────────────────── */

test('★ the statement has no story-level escape hatch left in it', async () => {
  const ask = await askFor([member('st_a', 'i1', '2026-08-16T23:23:00Z', '2026-08-16T23:25:00Z')]);

  /* The exact text of the bug. `opens_at` no longer exists, and once the ONE legitimate
     null test — the coin's own unknown mint time — is removed from the text, no `is null …
     or` remains at all. That is the shape check: the old escape was a disjunct satisfied by
     a property of the STORY rather than of the coin, and that is what made it match all 205
     rows in the store. */
  assert.equal(ask.sql.includes('opens_at'), false);
  assert.equal(/is null\s*\n?\s*or/.test(ask.sql.replace(/a\.minted_at is null/g, '')), false);

  /* Exactly one narrowing predicate, and both of its ends are bound parameters. */
  assert.ok(ask.sql.includes('a.minted_at >= w.from_at and a.minted_at <= w.to_at'));

  /* The cap is ordered by distance from the anchor. For a post-anchored window every row is
     at or after the anchor, so this is `minted_at asc` row for row — and for a window that
     reaches backwards it is the difference between keeping the coins near the story and
     keeping the 500 oldest rows in the table. */
  assert.ok(ask.sql.includes('abs(extract(epoch from (a.minted_at - w.anchor_at)))'));
  assert.ok(ask.sql.includes('nulls last'));

  /* Nothing is interpolated. Every story-derived value is a parameter — the property
     routes.ts says is tested rather than promised, holding here too. */
  assert.equal(ask.sql.includes('st_a'), false);
  assert.equal(ask.params[4], DEFAULT_POLICY.resolve.maxCandidates);
});

/* ── a story with post times: unchanged, to the millisecond ───────────── */

test('★ a story with post times gets the window it got before this change', async () => {
  /* The five stories in the store that carry post times all look like this: members two
     minutes after the post, the earliest post winning over both other members. */
  const ask = await askFor([
    member('st_soup', 'i1', '2026-08-17T01:50:00Z', '2026-08-17T01:52:00Z'),
    member('st_soup', 'i2', '2026-08-17T02:04:00Z', '2026-08-17T02:06:00Z'),
    member('st_soup', 'i3', null, '2026-08-17T02:20:00Z'),
  ]);

  const window = windowFor(ask, 'st_soup');
  const post = Date.parse('2026-08-17T01:50:00Z');

  assert.equal(window.anchor, post, 'the anchor is min(posted_at), not min(first_seen_at)');
  assert.equal(window.from, post + DEFAULT_POLICY.resolve.minLagMs);
  assert.equal(window.to, post + DEFAULT_POLICY.resolve.maxLagMs);

  /* ★ AND A MEMBER WITH NO POST TIME DOES NOT WEAKEN A STORY THAT HAS ONE. i3 carries only
     a first-seen time; the anchor is still the post. Stories are mixed in practice — the
     tiktok rows in this store are — and a rule that fell back per-member instead of per-
     story would silently move most of the board onto our own reading schedule. */
  assert.ok(window.from >= window.anchor, 'a post-anchored window never opens before its post');
});

test('the same statement carries every story on the frame, each with its own window', async () => {
  const ask = await askFor([
    member('st_a', 'i1', '2026-08-17T01:50:00Z', '2026-08-17T01:52:00Z'),
    member('st_b', 'i2', '2026-08-16T21:29:00Z', '2026-08-16T21:31:00Z'),
    member('st_c', 'i3', null, '2026-08-17T00:27:00Z'),
  ]);

  /* One round trip for the whole board, which is the property every read in db.ts has and
     the reason the windows travel as parallel arrays rather than as a loop. */
  assert.deepEqual([...(ask.params[0] as string[])].sort(), ['st_a', 'st_b', 'st_c']);
  assert.notEqual(windowFor(ask, 'st_a').anchor, windowFor(ask, 'st_b').anchor);
});

/* ── the story that used to retrieve the whole store ──────────────────── */

test('★ a story with no post time on any member is BOUNDED, and reaches backwards', async () => {
  /* st_rooftop, verbatim: three members, first seen at 00:27, 00:57 and 01:42, and not one
     post time between them. Before this change these three rows produced `opens_at is
     null`, which matched all 205 assets in the store. */
  const ask = await askFor([
    member('st_rooftop', 'i1', null, '2026-08-17T00:27:00Z'),
    member('st_rooftop', 'i2', null, '2026-08-17T00:57:00Z'),
    member('st_rooftop', 'i3', null, '2026-08-17T01:42:00Z'),
  ]);

  const window = windowFor(ask, 'st_rooftop');
  const sight = Date.parse('2026-08-17T00:27:00Z');

  /* The anchor is the EARLIEST sighting, not the latest and not the story's created_at. */
  assert.equal(window.anchor, sight);

  /* Bounded at both ends, and by the policy's numbers. */
  assert.equal(window.from, sight + DEFAULT_POLICY.resolve.minLagMs - DEFAULT_POLICY.resolve.firstSightLookbackMs);
  assert.equal(window.to, sight + DEFAULT_POLICY.resolve.maxLagMs);

  /* ★ AND IT REACHES BEFORE ITS ANCHOR, which is the whole difference between this window
     and the one above. The coin this story produced was minted 3h50m before we first saw
     the story; a forward-only fallback would drop it and the row would offer CREATE. */
  assert.ok(window.from < window.anchor);
  assert.ok(window.from <= Date.parse('2026-08-16T20:37:00Z'), 'SLIDE is outside the window');
});

test('a story with no members asks for no coins rather than for all of them', async () => {
  /* Reachable when story_member is empty. It has no entitySpan fingerprints either, so it
     links to nothing regardless — but "nothing to anchor on" must mean an absent window,
     never an unbounded one, which is exactly the confusion that produced the bug. */
  const { db, asks } = fakeDb([]);
  const result = await loadStoryFacts(db, {
    storiesSinceMs: 0,
    reachSinceMs: 0,
    limit: 100,
    previousBoard: new Set<string>(),
  });

  assert.equal(result.stories.length, 0);
  assert.equal(result.coinWindows.size, 0);
  assert.equal(
    asks.some((a) => a.sql.includes('from public.asset a') && a.sql.includes('unnest')),
    false,
  );
});

/* ── what the load reports back about itself ──────────────────────────── */

test('★ the load says which clock each story was anchored to, and the facts do not', async () => {
  const result = await load([
    member('st_soup', 'i1', '2026-08-17T01:50:00Z', '2026-08-17T01:52:00Z'),
    member('st_rooftop', 'i2', null, '2026-08-17T00:27:00Z'),
  ]);

  assert.equal(result.coinWindows.get('st_soup')?.anchor, 'earliest_post');
  assert.equal(result.coinWindows.get('st_rooftop')?.anchor, 'first_sight');

  /* ★ AND IT IS NOT ON StoryFacts. The projection is handed the facts and never the
     windows, so no amount of carelessness downstream can spread this onto a payload — the
     product rule is that the system's own reasoning never reaches the app, and the cheapest
     way to keep a field off the wire is for the code that builds the wire not to have it.
     A first-seen instant on a story is also one careless rename away from being read as a
     post time, which is the failure this whole change is about. */
  for (const facts of result.stories) {
    const keys = Object.keys(facts);
    for (const forbidden of ['anchor', 'coinWindow', 'firstSeenAt', 'earliestPostAt']) {
      assert.equal(keys.includes(forbidden), false, `StoryFacts must not carry ${forbidden}`);
    }
    for (const one of facts.members) {
      assert.equal(Object.keys(one).includes('firstSeenAt'), false);
    }
  }
});

/* ── ★ provenance: a fixture cannot reach a payload ───────────────────── */

/**
 * ★ WHY THESE ASSERT THE STATEMENT AND ITS PARAMETERS RATHER THAN THE ROWS THAT COME BACK.
 *
 * Same argument this file's header makes about the coin window: the filter is a predicate
 * in a string literal, and the only way a test without a database can prove it is there is
 * to look at the string and at what was bound to it. A test that fed the fake three rows
 * and asserted two came out would be testing the fake's own idea of SQL, which is not the
 * thing that runs.
 *
 * The predicate is deliberately spelled as a BOUND PARAMETER carrying the closed list, so
 * the assertion has something exact to hold: the list itself, which must be the vocabulary's
 * and must not contain 'fixture'. A literal `<> 'fixture'` in the SQL would only be
 * assertable by grep, and would drift from contracts the first time a fifth origin arrived.
 */

/**
 * Every statement this file issues against public.asset, with what was bound to it.
 *
 * ★ EVERY LOADER IN db.ts IS DRIVEN HERE, AND THAT LIST IS THE POINT OF THE FUNCTION.
 * The rule below is only as wide as the statements this reaches: an unexercised read is an
 * unguarded read, and it fails silently — the assertion loop simply has one fewer thing to
 * iterate over and still passes. That is exactly how the two pairs statements, which are the
 * NEWEST reads of this table and were written by the same change as the rule, sat outside
 * the rule that exists to cover them. Getting the predicate right on four queries and
 * leaving it unchecked on the fifth and sixth is the same failure as forgetting it, one
 * level up. A loader added to db.ts is added here.
 */
async function assetAsks(
  origins: ReadonlyMap<string, StoryOrigin> = new Map(),
): Promise<readonly Ask[]> {
  const { db, asks } = fakeDb(
    [member('st_a', 'i1', '2026-08-16T23:23:00Z', '2026-08-16T23:25:00Z')],
    origins,
  );
  await loadStoryFacts(db, {
    storiesSinceMs: 0,
    reachSinceMs: 0,
    limit: 100,
    previousBoard: new Set<string>(),
  });
  await loadLaunchFacts(db, { sinceMs: 0, limit: 60 });
  /* The pairs screen: the listing and the ratio printed above it. Both read public.asset and
     both are surfaces that assert a venue priced what they show, so both carry the rule. */
  await loadPairFacts(db, { sinceMs: 0, limit: 100 });
  await loadPairCounts(db, { sinceMs: 0, limit: 100 });
  return asks.filter((a) => a.sql.includes('public.asset'));
}

/**
 * The four statements whose SUBJECT IS THE MARKET: the launches rail, the count printed
 * beside it, and the two halves of the pairs screen. Each of them heads itself with a claim
 * that what follows happened, and none of them has a story to derive anything from — so the
 * observed list is the whole answer for all four, forever.
 *
 * Told apart by a fragment of their own text rather than by position, because the point is
 * to catch a statement that stops being one of these by acquiring a story.
 */
const MARKET_FACING = [
  'order by a.minted_at desc', // launches
  "minted_at_conf = 'unknown'", // the count of coins the rail refused
  'join latest l on l.asset_key = a.asset_key', // the pairs listing
  'as minted', // the pairs counts
] as const;

const isMarketFacing = (ask: Ask): boolean =>
  MARKET_FACING.some((fragment) => ask.sql.includes(fragment));

test('★ every read of public.asset filters on origin, and no market surface admits a fixture', async () => {
  /* Six statements, one rule, and it is now the rule in TWO parts — which is the whole
     content of this change and the reason this test was rewritten rather than deleted.

     Every read still carries `origin = any($n)`: a read of this table with no provenance
     clause is a hole whether or not today's data walks through it.

     What differs is which list. The four market-facing statements bind the vocabulary's
     observed list exactly, because a fixture there is the bug 0013 closed — an invented coin
     under NEW LAUNCHES, or inside the sentence "48 of 235 mints we captured reached a
     market", where it is a claim about a population and not merely a row. The two
     story-scoped statements bind whatever THIS story may see, which for an observed story is
     the same list and for a fixture story is not; the tests below drive that half. */
  const asks = await assetAsks();
  assert.ok(asks.length >= 6, `expected every asset read to be exercised, saw ${asks.length}`);

  for (const ask of asks) {
    assert.match(
      ask.sql.replace(/\s+/g, ' '),
      /origin = any\(\$\d+::text\[\]\)/,
      `a read of public.asset has no origin filter: ${ask.sql.slice(0, 120)}`,
    );
    if (!isMarketFacing(ask)) continue;

    assert.deepEqual(
      [...boundOrigins(ask)].sort(),
      [...OBSERVED_ASSET_ORIGINS].sort(),
      'a market-facing list has drifted from the vocabulary',
    );
    assert.equal(
      boundOrigins(ask).includes('fixture'),
      false,
      '★ a seeded row would reach this payload',
    );
  }
});

test('★ the four market-facing statements are unmoved by a frame full of fixture stories', async () => {
  /* ★ THE GUARD ON THE FIX ITSELF. The repair makes the coin reads provenance-aware, and the
     tempting over-reach is to make the whole file provenance-aware — at which point a board
     of seeded stories would put seeded coins back on the launches rail, which is exactly the
     bug that was just closed, reintroduced by the mechanism meant to close a different one.

     So: same four statements, same frame, but every story on it is a fixture. Nothing about
     the market-facing half may move by a single value. */
  const asks = await assetAsks(new Map([['st_a', 'fixture']]));
  const facing = asks.filter(isMarketFacing);
  assert.equal(facing.length, 4, `expected four market-facing statements, saw ${facing.length}`);

  for (const ask of facing) {
    assert.deepEqual(
      [...boundOrigins(ask)].sort(),
      [...OBSERVED_ASSET_ORIGINS].sort(),
      'a fixture story on the frame changed what a market surface calls observed',
    );
  }
});

test('★ the launches statement asks for observed rows, in mint order, and nothing else', async () => {
  const asks = await assetAsks();
  const launches = asks.find((a) => a.sql.includes('order by a.minted_at desc'));
  assert.notEqual(launches, undefined, 'no launches statement was issued');

  const sql = (launches as Ask).sql.replace(/\s+/g, ' ');
  /* The ordering is unchanged and is asserted here so the filter cannot be "fixed" by
     reaching for the ORDER BY instead — which is the tempting wrong repair, because the
     fixtures were newest as well as invented. */
  assert.match(sql, /order by a\.minted_at desc, a\.asset_key desc/);
  assert.match(sql, /origin = any/);
  /* And no denylist crept back in beside it. A `<> 'fixture'` here would silently admit
     every origin added after it was written. */
  assert.equal(/<>\s*'fixture'/.test(sql), false, 'the filter must stay an allowlist');
});

test('★ the count of coins without a mint time is a count of REAL coins', async () => {
  /* It is printed by the run as `no_mint_time=`, and an operator reads it as "the world
     produced mints we could not place on the axis". A fixture with an unknown mint time
     inflating it would make an invented row into evidence about the world, in a diagnostic
     whose whole job is to explain why the rail is quieter than the market. */
  const asks = await assetAsks();
  const counted = asks.find((a) => a.sql.includes("minted_at_conf = 'unknown'"));
  assert.notEqual(counted, undefined, 'no without-mint-time count was issued');
  assert.match((counted as Ask).sql.replace(/\s+/g, ' '), /origin = any\(\$\d+::text\[\]\)/);
});

test('★ the pairs listing and the pairs counts are over ONE population', async () => {
  /* The sentence on that screen is "48 of 235 mints we captured reached a market", and the
     table under it is meant to BE those 48. That is only true while the two statements agree
     about what a mint is — so every predicate that decides membership has to appear in both,
     and the one that decides visibility most is the origin filter. A ratio whose denominator
     counted fictions while its list excluded them would be wrong in the direction this whole
     surface exists to refuse, and it would look perfectly reasonable on screen.

     Asserted as the two statements rather than as rows for `assetAsks`'s reason: the
     predicate lives in a string literal, so the string is the only thing a test without a
     database can hold. */
  const asks = await assetAsks();
  const listing = asks.find((a) => a.sql.includes('join latest l on l.asset_key = a.asset_key'));
  const counts = asks.find((a) => a.sql.includes('as minted'));
  assert.notEqual(listing, undefined, 'no pairs listing statement was issued');
  assert.notEqual(counts, undefined, 'no pairs counts statement was issued');

  for (const [name, ask] of [['listing', listing], ['counts', counts]] as const) {
    const sql = (ask as Ask).sql.replace(/\s+/g, ' ');
    assert.match(sql, /a\.origin = any\(\$\d+::text\[\]\)/, `the pairs ${name} has no origin filter`);
    /* No denylist beside it. `<> 'fixture'` admits every origin invented after it was
       written, including the one that means "we cannot vouch for this row". */
    assert.equal(/<>\s*'fixture'/.test(sql), false, `the pairs ${name} filter must stay an allowlist`);
    /* The other membership predicate, in both for the same reason: a coin with no usable
       mint time cannot be placed on the axis the list is ordered by, so it is not in the
       list — and it must therefore not be in the denominator either. */
    assert.match(sql, /minted_at_conf <> 'unknown'/, `the pairs ${name} counts a different population`);
  }

  const bound = (ask: Ask): readonly string[] =>
    ask.params.find((p) => Array.isArray(p) && p.includes('live_stream')) as string[];
  assert.deepEqual(
    [...bound(listing as Ask)].sort(),
    [...bound(counts as Ask)].sort(),
    'the list and the ratio were given different ideas of what counts as observed',
  );
});

/* ── ★ provenance, the other half: which coins THIS story may see ─────── */

/**
 * Every statement one frame issues, with the origin each story on it carries.
 *
 * The frames below are deliberately tiny and deliberately IDENTICAL apart from provenance:
 * same post times, so same window, so the only thing that can move between them is the
 * allowlist. A test whose two frames differed in two ways could not say which one did it.
 */
async function frameAsks(
  members: readonly Record<string, unknown>[],
  origins: ReadonlyMap<string, StoryOrigin>,
): Promise<readonly Ask[]> {
  const { db, asks } = fakeDb(members, origins);
  await loadStoryFacts(db, {
    storiesSinceMs: 0,
    reachSinceMs: 0,
    limit: 100,
    previousBoard: new Set<string>(),
  });
  return asks;
}

const POSTED = '2026-08-17T01:50:00Z';
const SEEN = '2026-08-17T01:52:00Z';

test('★ a fixture story may be compared against fixture coins — and against observed ones', async () => {
  /* THE HALF OF THE ASYMMETRY THAT IS ALLOWED. A demonstration story is labelled a
     demonstration everywhere it is shown, so a seeded coin on it is a demo matching its own
     demo, and a REAL coin on it is a demo that happens to match something real — neither
     tells anybody anything false about the world.

     This is also the regression itself, stated as a test. With the module constant here, the
     six seeded stories could not see the six seeded coins written by the same script, and
     four of the six rows fell to `none` — the branch that offers CREATE for a coin that
     already exists, which coins.ts ranks as materially worse than uselessness. */
  const asks = await frameAsks(
    [member('st_demo', 'i1', POSTED, SEEN)],
    new Map([['st_demo', 'fixture']]),
  );

  const bound = boundOrigins(coinAsk(asks));
  assert.equal(bound.includes('fixture'), true, '★ a seeded story cannot see its own coins');
  for (const observed of OBSERVED_ASSET_ORIGINS) {
    assert.equal(bound.includes(observed), true, `a fixture story lost sight of ${observed} coins`);
  }
  /* Derived, never typed here: the list is contracts', and this test would be worthless if
     it were a second copy of the same literal. */
  assert.deepEqual([...bound].sort(), [...coinOriginsVisibleTo('fixture')].sort());
});

test('★ an observed story can never be compared against a fixture coin', async () => {
  /* THE HALF THAT IS THE BUG. This row says a real moment produced this coin, with a cap
     beside it and a Buy affordance behind it once resolve is confident. An invented coin
     arriving here is a fiction presented as a finding.

     Same members, same window, same everything as the test above except the one column. */
  const asks = await frameAsks(
    [member('st_real', 'i1', POSTED, SEEN)],
    new Map([['st_real', 'observed']]),
  );

  const bound = boundOrigins(coinAsk(asks));
  assert.equal(bound.includes('fixture'), false, '★ an invented coin could reach a real story');
  assert.deepEqual([...bound].sort(), [...OBSERVED_ASSET_ORIGINS].sort());
  /* And the corpus that scores it is the same population, so no word carried only by a
     fiction can be counted common enough to disqualify a real story's own word. */
  assert.equal(boundOrigins(corpusAsk(asks)).includes('fixture'), false);
});

test('★ one frame, two kinds of story, and neither borrows the other one\'s allowlist', async () => {
  /* ★ THE PROOF THAT THIS IS PER STORY AND NOT A MODE THE FILE IS IN. Both stories carry the
     same post time, so both get the same window; the ONLY difference between them is the
     column 0016 added. A fixture coin is reachable exactly through the statement whose list
     names it, and that statement's story-id array must not contain the observed story —
     which is what "an observed story cannot match a fixture coin" means at the level of what
     Postgres is actually asked. */
  const asks = await frameAsks(
    [member('st_demo', 'i1', POSTED, SEEN), member('st_real', 'i2', POSTED, SEEN)],
    new Map([
      ['st_demo', 'fixture'],
      ['st_real', 'observed'],
    ]),
  );

  const statements = coinAsks(asks);
  assert.equal(statements.length, 2, 'two origins on the frame, two allowlists, two statements');

  for (const ask of statements) {
    const ids = ask.params[0] as readonly string[];
    if (boundOrigins(ask).includes('fixture')) {
      assert.deepEqual([...ids].sort(), ['st_demo'], '★ a real story was routed into the fixture set');
    } else {
      assert.deepEqual([...ids].sort(), ['st_real']);
    }
  }

  /* One statement per DISTINCT ORIGIN, never one per story: the count is bounded by the
     vocabulary and not by the size of the board. Two stories of one kind still cost one. */
  const together = await frameAsks(
    [member('st_demo', 'i1', POSTED, SEEN), member('st_demo2', 'i2', POSTED, SEEN)],
    new Map([
      ['st_demo', 'fixture'],
      ['st_demo2', 'fixture'],
    ]),
  );
  assert.equal(coinAsks(together).length, 1);
});

test('★ the corpus is counted over exactly the rows that story could retrieve', async () => {
  /* coins.ts is only safe while "how common is this word" is measured over the same
     population retrieval can return. Retrieval's population is now per story, so the corpus
     is too — measured in ONE scan that also selects the origin, and split here rather than
     asked for twice, so every corpus is as of one instant. */
  const asks = await frameAsks(
    [member('st_demo', 'i1', POSTED, SEEN), member('st_real', 'i2', POSTED, SEEN)],
    new Map([
      ['st_demo', 'fixture'],
      ['st_real', 'observed'],
    ]),
  );

  const corpus = corpusAsk(asks);
  /* The scan reads the UNION of what the frame can retrieve — anything narrower would count
     a fixture story's own words as rarer than they are — and it carries the origin so the
     split is possible at all. */
  assert.match(corpus.sql.replace(/\s+/g, ' '), /select a\.origin,/);
  assert.deepEqual(
    [...boundOrigins(corpus)].sort(),
    [...new Set([...coinOriginsVisibleTo('fixture'), ...coinOriginsVisibleTo('observed')])].sort(),
  );

  /* And ONE scan, not one per origin: the seventh round trip stays the seventh. */
  assert.equal(asks.filter((a) => a.sql.includes('group by 1, 2, 3')).length, 1);
});
