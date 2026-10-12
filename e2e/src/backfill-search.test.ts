/**
 * ★ THE SEARCH BACK, END TO END: a promoted story the judge named "Jimothy" is searched for
 * once, ending at our earliest post. Of what comes back, the same picture posted an hour
 * earlier joins and moves the story's start back; an unrelated post with the word in it
 * joins nothing and seeds nothing. A story with no name is not searched, and says so.
 *
 * Real schema (PGlite), the real backfill and embedding steps, the real GROUP loop. The
 * source answers from a table and the image vectors are in the vendor's reply shape;
 * nothing opens a socket.
 */

import { strict as assert } from 'node:assert';
import { before, test } from 'node:test';

import type { Item, Judgement, Millis } from '@insidor/contracts';
import { authorKey, itemId, sourceId, storyId } from '@insidor/contracts/ids.ts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import type { DiscoveryQuery, PlatformAdapter } from '@insidor/contracts/ports/platform.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import { voyageEmbed } from '@insidor/embed-voyage';
import { policyHash } from '@insidor/runner/src/hash.ts';
import type { Logger } from '@insidor/runner/src/log.ts';
import { groupLoop } from '@insidor/runner/src/loops/group.ts';
import { storeArrivals } from '@insidor/runner/src/work/arrivals.ts';
import { backfillStories, type BackfillDeps } from '@insidor/runner/src/work/backfill.ts';
import { embedImages } from '@insidor/runner/src/work/embed-images.ts';
import { storeWork } from '@insidor/runner/src/work/stages.ts';
import {
  PgAssetRepo,
  PgAuthorRepo,
  PgBackfillRepo,
  PgDecisionRepo,
  PgImageEmbeddingRepo,
  PgImagePairRepo,
  PgItemRepo,
  PgJudgementRepo,
  PgObservationRepo,
  PgPostJudgementRepo,
  PgStoryRepo,
} from '@insidor/store';
import type { Db } from '@insidor/store';

import { migratedDb } from './db.ts';

const NOW = Date.now() as Millis;
const MIN = 60_000;
const P = DEFAULT_POLICY;
const X = sourceId('x');
const NAMED = storyId('jimothy');
const UNNAMED = storyId('unnamed');
const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet };
const openMeter = {
  record: () => undefined,
  spentUsd: () => 0,
  mayspend: () => true,
  line: () => ({ capUsd: 21, spentUsd: 0, stopAtUsd: 21, remainingUsd: 21, unrecordedUsd: 0 }),
} as unknown as Meter;

let db: Db;
const searches: DiscoveryQuery[] = [];

function post(n: number, author: string, picture: string, text: string, minutesAgo: number): Item {
  return {
    itemId: itemId(X, `${n}`), source: X, sourceItemId: `${n}`, origin: 'observed', authorKey: authorKey(X, author),
    postedAt: (NOW - minutesAgo * MIN) as Millis, firstSeenAt: NOW, lang: 'en', text,
    media: [{ kind: 'image', uri: `https://img.invalid/${picture}.jpg`, width: 1200, height: 675, durationMs: null }],
    counters: {}, fingerprints: [], rebroadcastOf: null, reproductionOf: null, formatIds: [], rawRef: `x/${n}`,
  };
}

/** The original picture on one axis; the earlier copy at 0.97 to it; anything else elsewhere. */
function vectorFor(uri: string): number[] {
  const v = Array.from({ length: 1024 }, () => 0);
  if (uri.includes('jimothy-earlier')) {
    v[0] = 0.97;
    v[1] = Math.sqrt(1 - 0.97 ** 2);
  } else if (uri.includes('jimothy')) {
    v[0] = 1;
  } else {
    v[3] = 1;
  }
  return v;
}

const source = {
  id: X,
  capabilities: { discovery: ['keyword', 'catchall'] },
  estimate: () => ({ vendor: 'test', usd: 0.003 }),
  discover: async (query: DiscoveryQuery) => {
    searches.push(query);
    const items = [post(300, 'firstpost', 'jimothy-earlier', 'raccoon in the senate building', 120), post(301, 'chef', 'pasta', 'jimothy makes the best pasta', 90)];
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

async function embed(): Promise<void> {
  await embedImages({
    embed: voyageEmbed({
      client: { embed: async ({ inputs }) => ({ vectors: inputs.map((i) => Float32Array.from(vectorFor('imageUrl' in i ? i.imageUrl : ''))), totalTokens: inputs.length * 1_446 }) },
      meter: openMeter,
      now: () => NOW,
    }),
    images: new PgImageEmbeddingRepo(db),
    mode: 'live',
    policy: P,
    log: quiet,
    now: () => NOW,
  });
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
    {
      images: new PgImageEmbeddingRepo(db),
      postScores: new PgPostJudgementRepo(db),
      storyJudgements: new PgJudgementRepo(db),
      pairs: { judge: null, pairs: new PgImagePairRepo(db), mode: 'live', policy: P, log: quiet, now: () => NOW },
    },
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

const judged = (name: string | null): Judgement => ({
  judgeId: 'judge:test@1', promptId: 'p@1', judgedAt: NOW, coinable: true, confidence: 0.85, lookedAt: 'text',
  proposedName: name, alternateNames: [], subjectSpans: [], rationaleRef: null, costUsd: 0,
});

before(async () => {
  db = await migratedDb();
  const decisions = new PgDecisionRepo(db);
  for (const day of [NOW - 86_400_000, NOW, NOW + 86_400_000]) await decisions.ensurePartition(new Date(day).toISOString().slice(0, 10));
  await decisions.recordPolicy(policyHash(P), P, 'e2e');

  const stories = new PgStoryRepo(db);
  const items = new PgItemRepo(db);
  for (const [id, base] of [[NAMED, 1], [UNNAMED, 11]] as const) {
    const members = [post(base, `a${base}`, 'jimothy', 'Jimothy on the steps', 60), post(base + 1, `b${base}`, 'jimothy', 'jimothy again', 50), post(base + 2, `c${base}`, 'jimothy', 'the raccoon', 45)];
    await items.upsert(members);
    await stories.upsert({
      storyId: id, state: 'promoted', origin: 'observed', createdAt: NOW - 60 * MIN, promotedAt: NOW - 40 * MIN,
      earliestPostAt: (NOW - 60 * MIN) as Millis, lastMemberAt: (NOW - 45 * MIN) as Millis, memberCount: 3, distinctAuthors: 3, distinctSources: 1, carriers: [], mergedInto: null,
    });
    await stories.addMembers(members.map((m) => ({ storyId: id, itemId: m.itemId, authorKey: m.authorKey, source: X, postedAt: m.postedAt, joinedAt: (NOW - 45 * MIN) as Millis, evidence: { kind: 'seed' as const } })));
  }
  await new PgJudgementRepo(db).record(NAMED, 3, judged('Jimothy'));
  await embed();
  await group();
});

test('★ one search for the story\'s name, ending at our earliest post', async () => {
  await backfillStories(backfillDeps());
  assert.equal(searches.length, 1, 'the unnamed story was not searched');
  assert.equal(searches[0]?.mode, 'keyword');
  assert.equal(searches[0]?.term, 'Jimothy');
  assert.equal(searches[0]?.untilMs, NOW - 60 * MIN, 'nothing at or after our earliest post');
  assert.equal(searches[0]?.limit, P.backfill.searchResultCap);

  const run = await new PgBackfillRepo(db).last(NAMED);
  assert.deepEqual(run?.search, { name: 'Jimothy', returned: 2 });
  const unnamed = await new PgBackfillRepo(db).last(UNNAMED);
  assert.deepEqual(unnamed?.search, { name: null, note: 'no_name' }, 'and the story with no name says why it was not searched');
});

test('★ the same picture posted earlier joins and moves the start back; a name-only match joins nothing', async () => {
  await embed();
  await group();
  const rows = await db.query<{ item_id: string; story_id: string }>(`select item_id, story_id from public.story_member where item_id in ('x:300', 'x:301')`);
  assert.deepEqual(rows.map((r) => [r.item_id, r.story_id]), [['x:300', NAMED]], 'the pasta post with the word in it joined nothing, and seeded nothing');
  const story = await new PgStoryRepo(db).byId(NAMED);
  assert.equal(story?.earliestPostAt, NOW - 120 * MIN, 'the earliest post found is now two hours back');
});
