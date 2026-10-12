/**
 * ★ GROUP WITH PICTURES, END TO END: a cropped and captioned copy of the same raccoon joins
 * the story; a different raccoon that only looks alike does not — even when it claims the
 * same name — because the judge, shown both pictures, says "no".
 *
 * Real schema (PGlite), the real GROUP loop, the real embedding step through the Voyage port,
 * and the real same-subject question through the judge client. The vendor replies are in each
 * vendor's documented shape and written by hand (see adapters/embed/voyage/src/__fixtures__);
 * nothing here opens a socket.
 */

import { strict as assert } from 'node:assert';
import { before, test } from 'node:test';

import type { Item, Judgement, Millis } from '@insidor/contracts';
import { authorKey, itemId, sourceId, storyId } from '@insidor/contracts/ids.ts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import { voyageEmbed } from '@insidor/embed-voyage';
import { anthropicJudge, httpClient } from '@insidor/judge-anthropic';
import { policyHash } from '@insidor/runner/src/hash.ts';
import type { Logger } from '@insidor/runner/src/log.ts';
import { groupLoop } from '@insidor/runner/src/loops/group.ts';
import { embedImages } from '@insidor/runner/src/work/embed-images.ts';
import { storeWork } from '@insidor/runner/src/work/stages.ts';
import {
  PgAssetRepo,
  PgAuthorRepo,
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
const STORY = storyId('jimothy');
const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet };
const openMeter = {
  record: () => undefined,
  spentUsd: () => 0,
  mayspend: () => true,
  line: () => ({ capUsd: 21, spentUsd: 0, stopAtUsd: 21, remainingUsd: 21, unrecordedUsd: 0 }),
} as unknown as Meter;

let db: Db;
let questions = 0;

const img = (name: string): string => `https://img.invalid/${name}.jpg`;

function post(n: number, author: string, picture: string, text: string, minutesAgo: number): Item {
  return {
    itemId: itemId(X, `${n}`), source: X, sourceItemId: `${n}`, origin: 'observed', authorKey: authorKey(X, author),
    postedAt: NOW - minutesAgo * MIN, firstSeenAt: NOW - minutesAgo * MIN, lang: 'en', text,
    media: [{ kind: 'image', uri: img(picture), width: 1200, height: 675, durationMs: null }],
    counters: {}, fingerprints: [], rebroadcastOf: null, reproductionOf: null, formatIds: [], rawRef: `x/${n}`,
  };
}

/**
 * The image vectors, as the Voyage reply carries them: the original raccoon photo along one
 * axis; the cropped and captioned copy at cosine 0.90 to it; a different raccoon at 0.76.
 */
function vectorFor(uri: string): number[] {
  const v = Array.from({ length: 1024 }, () => 0);
  if (uri.includes('different-raccoon')) {
    v[0] = 0.76;
    v[2] = Math.sqrt(1 - 0.76 ** 2);
  } else if (uri.includes('crop')) {
    v[0] = 0.9;
    v[1] = Math.sqrt(1 - 0.9 ** 2);
  } else {
    v[0] = 1;
  }
  return v;
}

const judgedName = (name: string): Judgement => ({
  judgeId: 'judge:test@1', promptId: 'p@1', judgedAt: NOW, coinable: true, confidence: 0.85, lookedAt: 'text',
  proposedName: name, alternateNames: [], subjectSpans: [], rationaleRef: null, costUsd: 0,
});

before(async () => {
  db = await migratedDb();
  const decisions = new PgDecisionRepo(db);
  for (const day of [NOW - 86_400_000, NOW, NOW + 86_400_000]) await decisions.ensurePartition(new Date(day).toISOString().slice(0, 10));
  await decisions.recordPolicy(policyHash(P), P, 'e2e');

  /* The story: three posts of Jimothy from three accounts, each scored and named. */
  const items = new PgItemRepo(db);
  const members = [post(1, 'whitehouse', 'jimothy', 'Jimothy on the way to Washington', 60), post(2, 'dcwatch', 'jimothy-2', 'jimothy again', 50), post(3, 'pets', 'jimothy-3', 'the raccoon', 45)];
  await items.upsert(members);
  const stories = new PgStoryRepo(db);
  await stories.upsert({
    storyId: STORY, state: 'promoted', origin: 'observed', createdAt: NOW - 60 * MIN, promotedAt: NOW - 40 * MIN,
    earliestPostAt: NOW - 60 * MIN, lastMemberAt: NOW - 45 * MIN, memberCount: 3, distinctAuthors: 3, distinctSources: 1, carriers: [], mergedInto: null,
  });
  await stories.addMembers(members.map((m) => ({ storyId: STORY, itemId: m.itemId, authorKey: m.authorKey, source: X, postedAt: m.postedAt, joinedAt: NOW - 45 * MIN, evidence: { kind: 'seed' as const } })));

  /* The two newcomers, each named "Jimothy" by the per-post judge. */
  const crop = post(10, 'memes', 'jimothy-crop', 'when you see the cops lmao', 10);
  const other = post(11, 'zoo', 'different-raccoon', 'my raccoon is also called jimothy', 8);
  await items.upsert([crop, other]);
  const scores = new PgPostJudgementRepo(db);
  for (const m of [...members, crop, other]) await scores.record(m.itemId, judgedName('Jimothy'));

  /* Every picture embedded through the real step and port. */
  await embedImages({
    embed: voyageEmbed({
      client: {
        embed: async ({ inputs }) => ({
          vectors: inputs.map((i) => Float32Array.from(vectorFor('imageUrl' in i ? i.imageUrl : ''))),
          totalTokens: inputs.length * 1_446,
        }),
      },
      meter: openMeter,
      now: () => NOW,
    }),
    images: new PgImageEmbeddingRepo(db),
    mode: 'live',
    policy: P,
    log: quiet,
    now: () => NOW,
  });
});

/** The judge shown both pictures: "no", these are not the same raccoon. */
function pairJudge() {
  const fetch = (async (url: string | URL | Request) => {
    if (String(url).startsWith('https://img.invalid/')) {
      return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    }
    questions += 1;
    return new Response(
      JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"answer":"no"}' }], usage: { input_tokens: 3_300, output_tokens: 6 } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof globalThis.fetch;
  return anthropicJudge({
    client: httpClient({
      apiKey: 'sk-test-not-a-real-key', baseUrl: 'https://judge.invalid', model: 'claude-haiku-4-5', maxOutputTokens: P.judge.maxOutputTokens,
      effort: null, timeoutMs: P.judge.timeoutMs, maxAttempts: 1, backoffMs: P.judge.backoffMs, maxWaitMs: P.judge.maxWaitMs,
      maxFrameBytes: P.judge.maxFrameBytes, fetch, sleep: async () => {},
    }),
    meter: openMeter, now: () => NOW, model: 'claude-haiku-4-5', policy: P.judge, maxBatch: 10,
  });
}

test('★ the cropped copy joins on name plus picture; the different raccoon does not', async () => {
  const decisions = new PgDecisionRepo(db);
  const repos = {
    items: new PgItemRepo(db), authors: new PgAuthorRepo(db), observations: new PgObservationRepo(db),
    stories: new PgStoryRepo(db), assets: new PgAssetRepo(db), decisions,
  };
  const judge = pairJudge();
  const work = storeWork(
    repos,
    P,
    { judge: null, judgements: new PgJudgementRepo(db), meter: openMeter, mode: 'dry', policy: P, log: quiet },
    { platforms: { has: () => false, get: () => { throw new Error('no source'); } }, meter: openMeter, mode: 'dry', log: quiet, now: () => NOW },
    {
      images: new PgImageEmbeddingRepo(db),
      postScores: new PgPostJudgementRepo(db),
      storyJudgements: new PgJudgementRepo(db),
      pairs: { judge, pairs: new PgImagePairRepo(db), mode: 'live', policy: P, log: quiet, now: () => NOW },
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

  const rows = await db.query<{ item_id: string; story_id: string; evidence_kind: string; image_confirmed: boolean | null }>(
    `select item_id, story_id, evidence_kind, image_confirmed from public.story_member where item_id in ('x:10', 'x:11')`,
  );
  const crop = rows.find((r) => r.item_id === 'x:10');
  const other = rows.find((r) => r.item_id === 'x:11');
  assert.equal(crop?.story_id, STORY, 'the cropped copy joined the story');
  assert.equal(crop?.evidence_kind, 'nameImage', 'and its row says why: the name and the picture');
  assert.equal(crop?.image_confirmed, false, 'likely on its own similarity, with no question asked');
  assert.notEqual(other?.story_id, STORY, 'the different raccoon did not join');
  assert.equal(questions, 1, 'the judge was asked once, about the borderline pair');

  const asked = await new PgImagePairRepo(db).answer(img('different-raccoon'), img('jimothy'), judge.sameSubjectPromptId!);
  assert.equal(asked, 'no', 'and its answer is kept, so the pair is never paid for again');
});
