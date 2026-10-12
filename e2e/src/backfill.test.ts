/**
 * ★ WHERE A NARRATIVE STARTED, END TO END: a promoted story whose first post we caught quotes
 * a post we never saw, which quotes another. The backfill fetches both, GROUP joins them on
 * the quote, and the story's earliest post moves back to the real start. A post fetched for
 * the story that does not belong to it seeds nothing.
 *
 * Real schema (PGlite), the real backfill step, the real arrivals path and the real GROUP
 * loop. The source is a stand-in that answers lookups from a table; nothing opens a socket.
 */

import { strict as assert } from 'node:assert';
import { before, test } from 'node:test';

import type { Item, Millis } from '@insidor/contracts';
import { authorKey, itemId, sourceId, storyId } from '@insidor/contracts/ids.ts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import type { PlatformAdapter } from '@insidor/contracts/ports/platform.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import { policyHash } from '@insidor/runner/src/hash.ts';
import type { Logger } from '@insidor/runner/src/log.ts';
import { groupLoop } from '@insidor/runner/src/loops/group.ts';
import { storeArrivals } from '@insidor/runner/src/work/arrivals.ts';
import { backfillStories, type BackfillDeps } from '@insidor/runner/src/work/backfill.ts';
import { storeWork } from '@insidor/runner/src/work/stages.ts';
import {
  PgAssetRepo,
  PgAuthorRepo,
  PgBackfillRepo,
  PgDecisionRepo,
  PgItemRepo,
  PgJudgementRepo,
  PgObservationRepo,
  PgStoryRepo,
} from '@insidor/store';
import type { Db } from '@insidor/store';

import { migratedDb } from './db.ts';

const NOW = Date.now() as Millis;
const MIN = 60_000;
const P = DEFAULT_POLICY;
const X = sourceId('x');
const STORY = storyId('jimothy');
const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet };
const openMeter = {
  record: () => undefined,
  spentUsd: () => 0,
  mayspend: () => true,
  line: () => ({ capUsd: 21, spentUsd: 0, stopAtUsd: 21, remainingUsd: 21, unrecordedUsd: 0 }),
} as unknown as Meter;

let db: Db;
let lookups = 0;

function post(n: number, author: string, text: string, minutesAgo: number, quotes: number | null = null): Item {
  return {
    itemId: itemId(X, `${n}`), source: X, sourceItemId: `${n}`, origin: 'observed', authorKey: authorKey(X, author),
    postedAt: (NOW - minutesAgo * MIN) as Millis, firstSeenAt: NOW, lang: 'en', text, media: [],
    counters: {}, fingerprints: [], rebroadcastOf: null, reproductionOf: quotes === null ? null : itemId(X, `${quotes}`), formatIds: [], rawRef: `x/${n}`,
  };
}

/** What the source holds and we never saw: the post our first member quotes, and the one it quotes. */
const ELSEWHERE = new Map<string, Item>([
  ['100', post(100, 'relay', 'lmao look at this', 180, 101)],
  ['101', post(101, 'firstpost', 'a raccoon just walked into the senate', 300)],
]);

const source = {
  id: X,
  estimate: (call: { sourceItemIds?: readonly string[] }) => ({ vendor: 'test', usd: (call.sourceItemIds?.length ?? 0) * 0.00015 }),
  lookup: async (ids: readonly string[]) => {
    lookups += 1;
    const items = ids.flatMap((id) => ELSEWHERE.get(id) ?? []);
    return { value: { items, authors: [], cursor: null, hasMore: false }, spend: { usd: items.length * 0.00015 } };
  },
} as unknown as PlatformAdapter;

function backfillDeps(): BackfillDeps {
  const items = new PgItemRepo(db);
  return {
    platforms: { has: (s) => s === X, get: () => source },
    stories: new PgStoryRepo(db),
    names: new PgJudgementRepo(db),
    items,
    backfill: new PgBackfillRepo(db),
    store: storeArrivals({ authors: new PgAuthorRepo(db), items, observations: new PgObservationRepo(db) }, P, () => NOW),
    meter: openMeter,
    mode: 'live',
    policy: P,
    log: quiet,
    now: () => NOW,
  };
}

async function group(): Promise<void> {
  const decisions = new PgDecisionRepo(db);
  const repos = {
    items: new PgItemRepo(db), authors: new PgAuthorRepo(db), observations: new PgObservationRepo(db),
    stories: new PgStoryRepo(db), assets: new PgAssetRepo(db), decisions, backfill: new PgBackfillRepo(db),
  };
  const work = storeWork(
    repos,
    P,
    { judge: null, judgements: new PgJudgementRepo(db), meter: openMeter, mode: 'dry', policy: P, log: quiet },
    { platforms: { has: () => false, get: () => { throw new Error('no source'); } }, meter: openMeter, mode: 'dry', log: quiet, now: () => NOW },
  );
  const loop = groupLoop({
    policy: P,
    policyHash: policyHash(P),
    decisions: { write: (d) => decisions.append(d), markApplied: (id, at) => decisions.markApplied(id, at) },
    log: quiet,
    ...work,
  });
  const result = await loop.run({ signal: new AbortController().signal, now: () => NOW });
  assert.equal(result.failed, 0, result.firstError ?? '');
}

before(async () => {
  db = await migratedDb();
  const decisions = new PgDecisionRepo(db);
  for (const day of [NOW - 86_400_000, NOW, NOW + 86_400_000]) await decisions.ensurePartition(new Date(day).toISOString().slice(0, 10));
  await decisions.recordPolicy(policyHash(P), P, 'e2e');

  /* The story as we caught it: three posts in the last hour, the first quoting post 100. */
  const members = [post(1, 'dcwatch', 'this is the best thing today', 60, 100), post(2, 'pets', 'raccoon in the senate', 50), post(3, 'news', 'senate raccoon', 45)];
  await new PgItemRepo(db).upsert(members);
  const stories = new PgStoryRepo(db);
  await stories.upsert({
    storyId: STORY, state: 'promoted', origin: 'observed', createdAt: NOW - 60 * MIN, promotedAt: NOW - 40 * MIN,
    earliestPostAt: (NOW - 60 * MIN) as Millis, lastMemberAt: (NOW - 45 * MIN) as Millis, memberCount: 3, distinctAuthors: 3, distinctSources: 1, carriers: [], mergedInto: null,
  });
  await stories.addMembers(members.map((m) => ({ storyId: STORY, itemId: m.itemId, authorKey: m.authorKey, source: X, postedAt: m.postedAt, joinedAt: (NOW - 45 * MIN) as Millis, evidence: { kind: 'seed' as const } })));
  /* Every member has been decided by GROUP already, so the loop below sees only what the
     backfill brings in. */
  await group();
});

test('★ the quote chain is followed to its root, and the root joins the story on the quote', async () => {
  const result = await backfillStories(backfillDeps());
  assert.deepEqual({ stories: result.stories, fetched: result.fetched }, { stories: 1, fetched: 2 }, 'two hops: post 100, then post 101');
  assert.equal(lookups, 2);

  await group();
  const rows = await db.query<{ item_id: string; story_id: string; evidence_kind: string; lineage_to_item: string | null }>(
    `select item_id, story_id, evidence_kind, lineage_to_item from public.story_member where item_id in ('x:100', 'x:101') order by item_id`,
  );
  assert.deepEqual(rows.map((r) => [r.item_id, r.story_id, r.evidence_kind]), [
    ['x:100', STORY, 'lineage'],
    ['x:101', STORY, 'lineage'],
  ]);

  const story = await new PgStoryRepo(db).byId(STORY);
  assert.equal(story?.earliestPostAt, NOW - 300 * MIN, 'the earliest post is now the root, five hours back');

  const run = await new PgBackfillRepo(db).last(STORY);
  assert.equal(run?.quotedPosts, 2);
  assert.ok(Math.abs((run?.costUsd ?? 0) - 2 * 0.00015) < 1e-9, 'and what it cost is kept with it');
});

test('★ a story is not backfilled again until it has new members, and then nothing known is fetched twice', async () => {
  /* The two joins above are new members, so the story is due once more; every quote in it
     is already stored, so nothing is asked. */
  const again = await backfillStories(backfillDeps());
  assert.equal(again.fetched, 0);
  assert.equal(lookups, 2, 'no lookup was made for posts we already have');
  const third = await backfillStories(backfillDeps());
  assert.equal(third.stories, 0, 'and with no new members it is not due at all');
});

test('★ a post fetched for a story that does not belong to it seeds no story of its own', async () => {
  const stray = post(200, 'someone', 'completely unrelated cooking video', 400);
  await new PgItemRepo(db).upsert([stray]);
  await new PgBackfillRepo(db).markPosts([{ itemId: stray.itemId, reachedFrom: null }], STORY, 'quote', NOW);
  await group();
  const homes = await db.query<{ story_id: string }>(`select story_id from public.story_member where item_id = 'x:200'`);
  assert.deepEqual(homes, [], 'no join, and no new story seeded from it');
});

test('a dry run fetches nothing and records nothing', async () => {
  await db.query(`delete from internal.story_backfill`);
  const before = lookups;
  const result = await backfillStories({ ...backfillDeps(), mode: 'dry' });
  assert.equal(result.fetched, 0);
  assert.equal(lookups, before);
  assert.equal(await new PgBackfillRepo(db).last(STORY), null);
});
