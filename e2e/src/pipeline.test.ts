/**
 * ★ THE PIPELINE END TO END: replayed posts in, a story on the board out.
 *
 * Every migration is applied to a real Postgres — PGlite, in process, with pgvector — and
 * the runner's own loops, the projector's own frame and the read service's own routes run
 * against it. Nothing here is a copy of production code; where a sequence lived only in a
 * `main`, it was moved into an exported function so this file could call it
 * (services/project/src/frame.ts).
 *
 * What it proves, in the order it happens:
 *   1. GROUP seeds a story from the first post and joins the next ones to it by their
 *      shared carrier, in ONE pass — the block is live within a pass.
 *   2. The story is PROMOTED the moment it clears the breadth bar, and the unrelated post
 *      stays a one-post candidate.
 *   3. QUALIFY's judge runs dry: it is priced, never contacted, and nothing is spent.
 *   4. The projector puts the promoted story — and only it — on board `default`, titled by
 *      quoting its earliest post, with its real posts on the story page.
 *   5. A second pass of GROUP changes nothing: membership is the durable filter.
 *
 * No network, no key, no spend. The judge's HTTP client throws if it is ever called.
 */

import { strict as assert } from 'node:assert';
import { before, test } from 'node:test';

import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';

import type { Millis } from '@insidor/contracts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import { anthropicJudge } from '@insidor/judge-anthropic';
import { inMemoryMeter } from '@insidor/meter';
import { decodeItem } from '@insidor/platform-replay';
import { projectStoryFrame } from '@insidor/project/src/frame.ts';
import { handle } from '@insidor/read/src/routes.ts';
import { policyHash } from '@insidor/runner/src/hash.ts';
import { groupLoop } from '@insidor/runner/src/loops/group.ts';
import { qualifyLoop } from '@insidor/runner/src/loops/qualify.ts';
import { resolveLoop } from '@insidor/runner/src/loops/resolve.ts';
import type { Logger } from '@insidor/runner/src/log.ts';
import { storeWork } from '@insidor/runner/src/work/stages.ts';
import {
  migrate,
  PgAssetRepo,
  PgAuthorRepo,
  PgDecisionRepo,
  PgItemRepo,
  PgJudgementRepo,
  PgObservationRepo,
  PgStoryRepo,
} from '@insidor/store';
import type { Db } from '@insidor/store';

const MINUTE = 60_000;
const NOW = Date.now() as Millis;

/* ── the database ─────────────────────────────────────────────────────── */

type Pg = Pick<PGlite, 'query' | 'exec'>;

/** The store's Db over PGlite. A statement with no parameters may hold several, as a migration does. */
function dbOf(pg: Pg): Db {
  return {
    query: async <R>(sql: string, params?: readonly unknown[]): Promise<R[]> => {
      if (params === undefined || params.length === 0) {
        const results = await pg.exec(sql);
        return (results.at(-1)?.rows ?? []) as R[];
      }
      const result = await pg.query<R>(sql, [...params]);
      return result.rows;
    },
  } as Db;
}

const quiet: Logger = { info: () => {}, warn: () => {}, error: () => {}, child: () => quiet };

/* ── the replayed posts ───────────────────────────────────────────────── */

/**
 * Five posts as a replay tape holds them. Four are one moment — the same sound, the same
 * named thing — from three accounts; the fifth shares nothing with them.
 */
const SOUND = { kind: 'formatId', key: 'x:sound:hippo-yawn-remix' };
const NAMED = { kind: 'entitySpan', key: 'moo deng' };

function post(n: number, author: string, minutesAgo: number, text: string, fingerprints: readonly unknown[]): unknown {
  return {
    itemId: `x:e2e${n}`,
    source: 'x',
    sourceItemId: `e2e${n}`,
    origin: 'observed',
    authorKey: `x:${author}`,
    postedAt: NOW - minutesAgo * MINUTE,
    lang: 'en',
    text,
    media: [{ kind: 'image', uri: `https://example.invalid/e2e${n}.jpg`, width: 600, height: 700, durationMs: null }],
    counters: {},
    fingerprints,
    rebroadcastOf: null,
    reproductionOf: null,
    formatIds: [SOUND.key],
    rawRef: `replay/e2e${n}.json`,
  };
}

const TAPE = [
  post(1, 'hippofan', 40, 'moo deng yawning to the remix is the only thing I need today', [SOUND, NAMED]),
  post(2, 'zookeeperdiary', 31, 'my version of the moo deng yawn', [SOUND, NAMED]),
  post(3, 'hippofan', 22, 'part two because you asked', [SOUND]),
  post(4, 'clipsdaily', 15, 'everyone is doing the moo deng yawn now', [SOUND, NAMED]),
  post(5, 'weatherbot', 12, 'light rain this evening', [{ kind: 'formatId', key: 'x:sound:rain-ambience' }]),
];

/* ── the run ──────────────────────────────────────────────────────────── */

let db: Db;
let judgeContacted = 0;
let decisions: PgDecisionRepo;
let meter: ReturnType<typeof inMemoryMeter>;
let loops: ReturnType<typeof buildLoops>;

function buildLoops() {
  const policy = DEFAULT_POLICY;
  const repos = {
    items: new PgItemRepo(db),
    authors: new PgAuthorRepo(db),
    observations: new PgObservationRepo(db),
    stories: new PgStoryRepo(db),
    assets: new PgAssetRepo(db),
    decisions,
  };
  /* SPEND=dry, exactly as the runner wires it: a priced judge whose client would throw. */
  const judge = anthropicJudge({
    client: {
      judge: () => {
        judgeContacted += 1;
        return Promise.reject(new Error('the judge must not be contacted in a dry run'));
      },
      frame: () => {
        judgeContacted += 1;
        return Promise.reject(new Error('the judge must not be contacted in a dry run'));
      },
    },
    meter,
    now: () => NOW,
    model: 'claude-haiku-4-5',
    policy: policy.judge,
    maxBatch: policy.qualify.batchSize,
  });
  const work = storeWork(repos, policy, {
    judge,
    judgements: new PgJudgementRepo(db),
    meter,
    mode: 'dry',
    policy,
    log: quiet,
  });
  const deps = {
    policy,
    policyHash: policyHash(policy),
    decisions: {
      write: (d: Parameters<PgDecisionRepo['append']>[0]) => decisions.append(d),
      markApplied: (id: string, at: Millis) => decisions.markApplied(id, at),
    },
    log: quiet,
    ...work,
  };
  return { group: groupLoop(deps), qualify: qualifyLoop(deps), resolve: resolveLoop(deps) };
}

const ctx = { signal: new AbortController().signal, now: () => NOW };

before(async () => {
  const pg = await PGlite.create({ extensions: { vector } });
  db = dbOf(pg);
  await migrate(db, (fn) => pg.transaction((tx) => fn(dbOf(tx))));

  decisions = new PgDecisionRepo(db);
  for (const day of [NOW - 86_400_000, NOW, NOW + 86_400_000]) {
    await decisions.ensurePartition(new Date(day).toISOString().slice(0, 10));
  }
  await decisions.recordPolicy(policyHash(DEFAULT_POLICY), DEFAULT_POLICY, 'e2e');

  meter = inMemoryMeter({ dailyCapUsd: 1, softStop: DEFAULT_POLICY.budget.softStopFraction, now: () => NOW });
  loops = buildLoops();

  await new PgItemRepo(db).upsert(TAPE.map((raw) => decodeItem(raw, (NOW - 10 * MINUTE) as Millis)));

  /* ★ THE HANDLES ARE WRITTEN HERE BECAUSE NOTHING IN LIVE INGESTION WRITES THEM YET. A post
     is only cited on a story page with a permalink, and a permalink needs the author's
     handle; `Author` has no handle field and no adapter fills `public.author.handle`. The
     seed writes it directly, and so does this test. Until an adapter does, real stories
     reach the board with an empty evidence list. */
  for (const author of ['hippofan', 'zookeeperdiary', 'clipsdaily', 'weatherbot']) {
    await db.query('update public.author set handle = $1 where author_key = $2', [author, `x:${author}`]);
  }
});

test('★ posts in, a promoted story on the board out — with its real posts, and nothing spent', async () => {
  /* 1–2. GROUP, one pass. */
  const grouped = await loops.group.run(ctx);
  assert.equal(grouped.failed, 0, grouped.firstError ?? '');
  assert.equal(grouped.in, 5);

  const stories = await db.query<{ story_id: string; state: string; origin: string; member_count: number; distinct_authors: number }>(
    'select story_id, state, origin, member_count, distinct_authors from public.story order by member_count desc',
  );
  assert.equal(stories.length, 2, 'one story for the moment, one for the unrelated post');
  const [moment, lone] = stories;
  assert.ok(moment && lone);
  assert.equal(moment.member_count, 4);
  assert.equal(moment.distinct_authors, 3);
  assert.equal(moment.state, 'promoted', 'four posts from three accounts clears the breadth bar');
  assert.equal(moment.origin, 'observed', 'built from observed posts, so an observed story');
  assert.equal(lone.member_count, 1);
  assert.equal(lone.state, 'candidate', 'one post from one account is never promoted');

  const reasons = await db.query<{ reason: string; n: number }>(
    `select reason, count(*)::int as n from internal.decisions where stage = 'group' group by reason order by reason`,
  );
  assert.deepEqual(
    Object.fromEntries(reasons.map((r) => [r.reason, r.n])),
    { M0_carrier_join: 3, M3_below_match_bar: 1, M6_no_candidate_block: 1 },
    'one seed from nothing, three carrier joins, and the unrelated post below the bar — which seeds its own',
  );
  const unapplied = await db.query<{ n: number }>(
    `select count(*)::int as n from internal.decisions where stage = 'group' and applied_at is null`,
  );
  assert.equal(unapplied[0]?.n, 0, 'every GROUP decision was carried out');

  /* 3. QUALIFY, with the judge in dry-run. */
  const qualified = await loops.qualify.run(ctx);
  assert.equal(qualified.failed, 0, qualified.firstError ?? '');
  const q = await db.query<{ subject_id: string; verdict: string; reason: string }>(
    `select subject_id, verdict, reason from internal.decisions where stage = 'qualify'`,
  );
  const onMoment = q.find((row) => row.subject_id === moment.story_id);
  assert.equal(onMoment?.verdict, 'abstain');
  assert.match(onMoment?.reason ?? '', /dry/i, 'priced and not sent, and the row says so');
  assert.equal(judgeContacted, 0, 'the judge was never contacted');
  assert.equal(meter.spentUsd('anthropic'), 0, 'nothing was spent');

  /* RESOLVE runs too. No coin was minted, so it has nothing to link — and says so. */
  const resolved = await loops.resolve.run(ctx);
  assert.equal(resolved.failed, 0, resolved.firstError ?? '');

  /* 4. The projector, then the read service. */
  await projectStoryFrame(
    db,
    'default',
    {
      nowMs: NOW,
      sparkWindowMs: 30 * MINUTE,
      marketFreshnessMs: DEFAULT_POLICY.market.readingFreshnessMs,
      feedFreshnessMs: DEFAULT_POLICY.assets.feedFreshnessMs,
    },
    { storiesSinceMs: NOW - 48 * 60 * MINUTE, reachSinceMs: NOW - 26 * 60 * MINUTE, limit: 200 },
  );

  const board = await handle('GET', '/board/default', { db: { query: (s, p) => db.query(s, p) }, log: quiet });
  assert.equal(board.status, 200);
  const body = JSON.parse(board.body) as { order: string[]; rows: { title: string }[] };
  assert.deepEqual(body.order, [moment.story_id], 'the promoted story, and only it');
  assert.equal(body.rows[0]?.title, 'moo deng yawning to the remix is the only thing I need today', 'titled by quoting its earliest post');

  const page = await handle('GET', `/story/${moment.story_id}`, { db: { query: (s, p) => db.query(s, p) }, log: quiet });
  assert.equal(page.status, 200);
  for (const raw of TAPE.slice(0, 4)) {
    const text = (raw as { text: string }).text;
    assert.ok(page.body.includes(text), `the story page carries the real post: ${text}`);
  }
  assert.ok(!page.body.includes('light rain'), 'and not the unrelated one');

  /* 5. A second GROUP pass has nothing to do. */
  const again = await loops.group.run(ctx);
  assert.equal(again.in, 0, 'every post already belongs to a story, so none is asked again');
  const after = await db.query<{ n: number }>('select count(*)::int as n from public.story');
  assert.equal(after[0]?.n, 2, 'and no story was made twice');
});
