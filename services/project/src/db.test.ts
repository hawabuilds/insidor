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

import { DEFAULT_POLICY } from '@insidor/contracts';
import type { Db } from '@insidor/store';

import { loadStoryFacts } from './db.ts';

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

function story(storyId: string): Record<string, unknown> {
  return {
    story_id: storyId,
    display_title: 'A story',
    thumb_uri: null,
    last_member_at: new Date('2026-08-17T01:42:00Z'),
    member_count: 1,
    distinct_authors: 1,
    distinct_sources: 1,
  };
}

/** Dispatches on a distinctive fragment of each statement, and records every ask. */
function fakeDb(members: readonly Record<string, unknown>[]): { db: Db; asks: Ask[] } {
  const asks: Ask[] = [];
  const storyIds = [...new Set(members.map((row) => row['story_id'] as string))].sort();

  const db: Db = {
    query: (sql: string, params: readonly unknown[] = []) => {
      asks.push({ sql, params });
      if (sql.includes('from public.story\n')) return Promise.resolve(storyIds.map(story) as never);
      if (sql.includes('join public.author')) return Promise.resolve(members as never);
      return Promise.resolve([] as never);
    },
  };
  return { db, asks };
}

const coinAsk = (asks: readonly Ask[]): Ask => {
  const ask = asks.find((a) => a.sql.includes('from public.asset a') && a.sql.includes('unnest'));
  assert.notEqual(ask, undefined, 'no coin retrieval statement was issued');
  return ask as Ask;
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
