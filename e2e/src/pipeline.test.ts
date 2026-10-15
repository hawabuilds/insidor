/**
 * ★ THE PIPELINE END TO END: posts as X sends them in, a story on the board out.
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
 *      quoting its earliest post, with every post cited by a working link built from the
 *      handle the X adapter read.
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
import { anthropicJudge, httpClient } from '@insidor/judge-anthropic';
import { inMemoryMeter } from '@insidor/meter';
import { xPlatform } from '@insidor/platform-x';
import type { XClient } from '@insidor/platform-x/client.ts';
import { projectStoryFrame } from '@insidor/project/src/frame.ts';
import { buildRising, projectRisingFeeds } from '@insidor/project/src/rising.ts';
import { handle } from '@insidor/read/src/routes.ts';
import { policyHash } from '@insidor/runner/src/hash.ts';
import { groupLoop } from '@insidor/runner/src/loops/group.ts';
import { qualifyLoop } from '@insidor/runner/src/loops/qualify.ts';
import { resolveLoop } from '@insidor/runner/src/loops/resolve.ts';
import { trackLoop } from '@insidor/runner/src/loops/track.ts';
import type { Logger } from '@insidor/runner/src/log.ts';
import { storeArrivals } from '@insidor/runner/src/work/arrivals.ts';
import { startFloors } from '@insidor/core';
import { feedQueryFor } from '@insidor/runner/src/work/discover.ts';
import { scorePosts } from '@insidor/runner/src/work/score-posts.ts';
import { storeWork } from '@insidor/runner/src/work/stages.ts';
import {
  migrate,
  PgAssetRepo,
  PgAuthorRepo,
  PgDecisionRepo,
  PgItemRepo,
  PgJudgementRepo,
  PgObservationRepo,
  PgPostJudgementRepo,
  PgStoryRepo,
} from '@insidor/store';
import type { Db } from '@insidor/store';

const MINUTE = 60_000;
const NOW = Date.now() as Millis;

import { dbOf } from './db.ts';

const quiet: Logger = { info: () => {}, warn: () => {}, error: () => {}, child: () => quiet };

/* ── the posts, as X sends them ───────────────────────────────────────── */

/**
 * Five posts in the shape X's search returns them — the same fields the adapter's own
 * fixtures record. Four are one moment, sharing a hashtag, from three accounts; the fifth
 * shares nothing with them. They go through the real X adapter, so the post ids, the author
 * keys, the handles and the carriers are all the adapter's own translation.
 */
function xPost(n: number, userId: string, userName: string, minutesAgo: number, text: string, tag: string): unknown {
  return {
    id: `190000000000000000${n}`,
    text: `${text} #${tag}`,
    createdAt: new Date(NOW - minutesAgo * MINUTE).toUTCString(),
    lang: 'en',
    viewCount: 1_000 * n,
    likeCount: 10 * n,
    replyCount: n,
    retweetCount: n,
    quoteCount: 0,
    bookmarkCount: 0,
    author: { id: userId, userName },
    entities: { hashtags: [{ text: tag }], symbols: [] },
    extendedEntities: {
      media: [{ type: 'photo', media_url_https: `https://example.invalid/e2e${n}.jpg`, sizes: { large: { w: 600, h: 700 } } }],
    },
  };
}

const SEARCH_RESULTS = [
  xPost(1, '1001', 'hippofan', 40, 'moo deng yawning to the remix is the only thing I need today', 'moodeng'),
  xPost(2, '1002', 'zookeeperdiary', 31, 'my version of the moo deng yawn', 'moodeng'),
  xPost(3, '1001', 'hippofan', 22, 'part two because you asked', 'moodeng'),
  xPost(4, '1003', 'clipsdaily', 15, 'everyone is doing the moo deng yawn now', 'moodeng'),
  xPost(5, '1004', 'weatherbot', 12, 'light rain this evening', 'weather'),
];

/**
 * What a recorded X client answers. Nothing here opens a socket. Each lookup — TRACK's
 * re-read — finds every post's views a little higher than the last, as a live post's are.
 */
let lookups = 0;
const recordedX: XClient = {
  search: async () => ({ items: SEARCH_RESULTS, cursor: null, hasMore: false }),
  lookup: async (ids) => {
    lookups += 1;
    return SEARCH_RESULTS.filter((raw) => ids.includes((raw as { id: string }).id)).map((raw) => {
      const post = raw as { viewCount: number; likeCount: number };
      return { ...post, viewCount: post.viewCount + 600 * lookups, likeCount: post.likeCount + 7 * lookups };
    });
  },
};

/** The test's clock, moved forward between TRACK passes. */
let clock: Millis = NOW;
/** TRACK's spend mode, switched from dry to live part-way through the test. */
let trackMode: 'dry' | 'live' = 'dry';

/**
 * The judge, live, over a recorded Messages API reply: every post is coinable at 0.82
 * except the weather post, which is not. Nothing here opens a socket.
 */
function recordedPostJudge() {
  const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { messages: { content: { type: string; text?: string }[] }[] };
    const asked = body.messages[0]?.content.find((c) => c.text?.startsWith('Stories to judge'))?.text ?? '';
    const subjects = JSON.parse(asked.slice(asked.indexOf('\n') + 1)) as { storyId: string; posts: string[] }[];
    const answers = subjects.map((s) => {
      const weather = s.posts.join(' ').includes('light rain');
      return { storyId: s.storyId, coinable: !weather, proposedName: weather ? null : 'moo deng', confidence: weather ? 0.2 : 0.82, alternateNames: [], subjectSpans: [] };
    });
    return new Response(
      JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ answers }) }], usage: { input_tokens: 1_200, output_tokens: 90 } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof globalThis.fetch;
  const P = DEFAULT_POLICY;
  return anthropicJudge({
    client: httpClient({
      apiKey: 'sk-test-not-a-real-key',
      baseUrl: 'https://judge.invalid',
      model: 'claude-haiku-4-5',
      maxOutputTokens: P.judge.maxOutputTokens,
      effort: null,
      timeoutMs: P.judge.timeoutMs,
      maxAttempts: 1,
      backoffMs: P.judge.backoffMs,
      maxWaitMs: P.judge.maxWaitMs,
      maxFrameBytes: P.judge.maxFrameBytes,
      fetch,
      sleep: async () => {},
    }),
    meter,
    now: () => clock,
    model: 'claude-haiku-4-5',
    policy: P.judge,
    maxBatch: P.qualify.batchSize,
  });
}

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
  /* TRACK reads through the real X adapter, over the recorded client above. */
  const x = xPlatform({ client: recordedX, meter, now: () => clock });
  const work = storeWork(
    repos,
    policy,
    { judge, judgements: new PgJudgementRepo(db), meter, mode: 'dry', policy, log: quiet },
    {
      platforms: { has: (source) => source === x.id, get: () => x },
      meter,
      get mode() {
        return trackMode;
      },
      log: quiet,
      now: () => clock,
    },
  );
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
  return { group: groupLoop(deps), qualify: qualifyLoop(deps), resolve: resolveLoop(deps), track: trackLoop(deps) };
}

const ctx = { signal: new AbortController().signal, now: () => clock };

before(async () => {
  const pg = await PGlite.create({ extensions: { vector } });
  db = dbOf(pg);
  await migrate(db, (fn) => pg.transaction((tx) => fn(dbOf(tx))));

  decisions = new PgDecisionRepo(db);
  for (const day of [NOW - 86_400_000, NOW, NOW + 86_400_000]) {
    await decisions.ensurePartition(new Date(day).toISOString().slice(0, 10));
  }
  await decisions.recordPolicy(policyHash(DEFAULT_POLICY), DEFAULT_POLICY, 'e2e');

  meter = inMemoryMeter({ dailyCapUsd: 1, softStop: DEFAULT_POLICY.budget.softStopFraction, now: () => clock });
  loops = buildLoops();

  /* Discovery exactly as the runner does it: the adapter's page, then the accounts, then
     the posts — `wiring.ts`'s `store`. */
  const x = xPlatform({ client: recordedX, meter, now: () => (NOW - 10 * MINUTE) as Millis });
  /* Through the catch-all lane, as the runner asks it now: no keyword, the lane's floor. */
  const page = await x.discover(feedQueryFor('all', startFloors(DEFAULT_POLICY), (NOW - 10 * MINUTE) as Millis, DEFAULT_POLICY), {
    capUsd: 1,
    spentUsd: 0,
    maxCalls: null,
    deadline: NOW + MINUTE,
  });
  await storeArrivals({ authors: new PgAuthorRepo(db), items: new PgItemRepo(db), observations: new PgObservationRepo(db) }, DEFAULT_POLICY, () => clock)(
    page.value.items,
    page.value.authors,
    'all',
  );
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

  /* 4. TRACK. Discovery's own reading, ten minutes ago, counts as a read: with no view rate
     yet each post sits on the warm tier (15 minutes), so it is due five minutes from now.
     Dry first: every read is priced and none is sent. */
  clock = (NOW + 6 * MINUTE) as Millis;
  const dry = await loops.track.run(ctx);
  assert.equal(dry.failed, 0, dry.firstError ?? '');
  assert.equal(dry.out, 4, 'the four posts of the promoted story are due a read; the unrelated post is not tracked');
  assert.equal(lookups, 0, 'a dry run contacts nobody');
  const dryRows = await db.query<{ n: number }>(
    `select count(*)::int as n from internal.decisions where stage = 'track' and verdict = 'pass' and applied_at is null`,
  );
  assert.equal(dryRows[0]?.n, 4, 'and its rows wait unapplied, rather than claiming a read happened');

  /* Live, against the recorded client: one batched lookup for all four posts. */
  trackMode = 'live';
  clock = (NOW + 7 * MINUTE) as Millis;
  const first = await loops.track.run(ctx);
  assert.equal(first.failed, 0, first.firstError ?? '');
  assert.equal(lookups, 1, 'four due reads, one call');

  /* After the first re-read each post's rate is measured against the discovery reading
     and ranked; with four posts one is hot and the rest warm (15 minutes): read again. */
  clock = (NOW + 23 * MINUTE) as Millis;
  const second = await loops.track.run(ctx);
  assert.equal(second.failed, 0, second.firstError ?? '');
  assert.equal(lookups, 2);
  const readings = await db.query<{ n: number }>(`select count(distinct captured_at)::int as n from public.observation`);
  assert.equal(readings[0]?.n, 3, 'the reading discovery paid for, then two re-reads');

  /* 5. Each catch-all post scored alone, against a recorded judge reply: the moment's posts
     clear the bar, the weather post does not. */
  /* ★ FREE CHECK FIRST: under the owner's reach bar only the post already past it is sent to the
     judge; the small ones wait. The rest of this test lowers the bar to one view, so every
     catch-all post is scored once and the board below has its posts. */
  const held = await scorePosts({
    judge: recordedPostJudge(),
    items: new PgItemRepo(db),
    scores: new PgPostJudgementRepo(db),
    meter,
    mode: 'live',
    policy: DEFAULT_POLICY,
    log: quiet,
    now: () => clock,
  });
  assert.ok(held.scored < 5, 'posts under the reach bar wait, unscored');
  const LOW_BAR = { ...DEFAULT_POLICY, rising: { ...DEFAULT_POLICY.rising, fypMinReach: 1, fypEarlyReach: 1, fypFastReachPerMinute: 1 } };
  const scored = await scorePosts({
    judge: recordedPostJudge(),
    items: new PgItemRepo(db),
    scores: new PgPostJudgementRepo(db),
    meter,
    mode: 'live',
    policy: LOW_BAR,
    log: quiet,
    now: () => clock,
  });
  assert.equal(held.scored + scored.scored, 5, 'every catch-all post scored, once');
  const rescored = await scorePosts({
    judge: recordedPostJudge(),
    items: new PgItemRepo(db),
    scores: new PgPostJudgementRepo(db),
    meter,
    mode: 'live',
    policy: LOW_BAR,
    log: quiet,
    now: () => clock,
  });
  assert.equal(rescored.queued, 0, 'and none is asked about twice');

  /* 6. The projector, then the read service. */
  const frame = await projectStoryFrame(
    db,
    'default',
    {
      nowMs: clock,
      sparkWindowMs: 30 * MINUTE,
      marketFreshnessMs: DEFAULT_POLICY.market.readingFreshnessMs,
      feedFreshnessMs: DEFAULT_POLICY.assets.feedFreshnessMs,
    },
    { storiesSinceMs: NOW - 48 * 60 * MINUTE, reachSinceMs: NOW - 26 * 60 * MINUTE, limit: 200 },
  );
  /* ★ THE REACH BAR HOLDS: these posts are a few thousand views, under For You's 40k and too slow
     for its growth paths, so the owner's bar leaves both feeds empty. The rest of this test lowers
     the bar to one view, to check what a post that clears it carries. */
  await projectRisingFeeds(db, clock, frame.coinsByStory, 30 * MINUTE);
  assert.equal((await db.query<{ n: number }>(`select count(*)::int as n from public.rising_row`))[0]?.n, 0, 'small slow posts are on no feed');
  await projectRisingFeeds(db, clock, frame.coinsByStory, 30 * MINUTE, {
    ...DEFAULT_POLICY,
    rising: { ...DEFAULT_POLICY.rising, fypMinReach: 1, popularMinReach: 1 },
  });

  const board = await handle('GET', '/board/default', { db: { query: (s, p) => db.query(s, p) }, log: quiet });
  assert.equal(board.status, 200);
  const body = JSON.parse(board.body) as {
    order: string[];
    rows: { title: string; reach: { v: number | null }; spark: { points: { value: number | null }[] } }[];
  };
  assert.deepEqual(body.order, [moment.story_id], 'the promoted story, and only it');
  /* ★ VIEWS ON THE CARD, AND A SPARKLINE WITH POINTS. */
  const card = body.rows[0];
  assert.ok((card?.reach.v ?? 0) > 0, `the card shows views: ${JSON.stringify(card?.reach)}`);
  assert.ok(
    (card?.spark.points ?? []).some((p) => p.value !== null),
    `the sparkline has a measured point: ${JSON.stringify(card?.spark)}`,
  );
  assert.equal(body.rows[0]?.title, 'moo deng yawning to the remix is the only thing I need today #moodeng', 'titled by quoting its earliest post');

  const page = await handle('GET', `/story/${moment.story_id}`, { db: { query: (s, p) => db.query(s, p) }, log: quiet });
  assert.equal(page.status, 200);
  const story = JSON.parse(page.body) as { evidence: { excerpt?: string; permalink?: string }[] };
  assert.equal(story.evidence.length, 4, 'every post in the story is cited');
  /* ★ A LIVE-SHAPED POST RENDERS A WORKING LINK: the handle the adapter read, and the post
     id the adapter read, in the URL X itself uses for that post. */
  const links = JSON.stringify(story.evidence);
  assert.ok(links.includes('https://x.com/hippofan/status/1900000000000000001'), links);
  assert.ok(links.includes('https://x.com/zookeeperdiary/status/1900000000000000002'));
  assert.ok(links.includes('https://x.com/clipsdaily/status/1900000000000000004'));
  assert.ok(!page.body.includes('light rain'), 'and not the unrelated one');

  /* ★ THE FOR YOU FEED: the posts that cleared the bar, newest first, each with its
     views and a working link, and no coin — the narrative has none. The weather post was
     found by the same search and scored below the bar, so it is not here. All four are one
     story, and one topic takes at most three cards in twenty (services/project variety.ts):
     the three most viewed keep a place, the fourth is on Popular and the story page. */
  const read = { db: { query: (s: string, p: readonly unknown[]) => db.query(s, p) }, log: quiet };
  const fypReply = JSON.parse((await handle('GET', '/rising/fyp', read)).body) as {
    posts: { id: string; permalink: string | null; reach: { v: number | null }; coins: unknown; storyId: unknown }[];
  };
  assert.deepEqual(
    fypReply.posts.map((p) => p.id),
    ['x:1900000000000000004', 'x:1900000000000000003', 'x:1900000000000000002'],
  );
  for (const p of fypReply.posts) {
    assert.ok((p.reach.v ?? 0) > 0, `views on ${p.id}`);
    assert.ok(p.permalink?.startsWith('https://x.com/'), `a link on ${p.id}`);
    /* No coin and no search for one in this run: a dash, or the narrative's own "none". */
    const kind = (p.coins as { kind?: string } | null)?.kind;
    assert.ok(kind === 'pending' || kind === 'none', `the coin line on ${p.id} is ${String(kind)}`);
    if (kind === 'pending') assert.equal(p.storyId, null);
  }
  const popularReply = JSON.parse((await handle('GET', '/rising/popular', read)).body) as { posts: { reach: { v: number } }[] };
  const views = popularReply.posts.map((p) => p.reach.v);
  assert.deepEqual(views, [...views].sort((a, b) => b - a), 'Popular is most views first');

  /* ★ THE OWNER'S CALL WINS (0054, services/project/src/owner-calls.ts). "Not a meme" takes a
     post off both feeds and off its narrative's page; "Is a meme" brings it back, and lifts the
     judge's no from the weather post — the reach bar still applies. */
  /* From here the four posts of the one story are the members and owner calls under test, so For
     You's variety rule (one topic, three cards in twenty) is off: it would keep the fourth off. */
  const reproject = async () => {
    await projectStoryFrame(
      db,
      'default',
      { nowMs: clock, sparkWindowMs: 30 * MINUTE, marketFreshnessMs: DEFAULT_POLICY.market.readingFreshnessMs, feedFreshnessMs: DEFAULT_POLICY.assets.feedFreshnessMs },
      { storiesSinceMs: NOW - 48 * 60 * MINUTE, reachSinceMs: NOW - 26 * 60 * MINUTE, limit: 200 },
    );
    await projectRisingFeeds(db, clock, frame.coinsByStory, 30 * MINUTE, { ...DEFAULT_POLICY, rising: { ...DEFAULT_POLICY.rising, fypMinReach: 1, popularMinReach: 1, varietyOn: false } });
    const feedIds = async (feed: string) => (JSON.parse((await handle('GET', `/rising/${feed}`, read)).body) as { posts: { id: string }[] }).posts.map((p) => p.id);
    const storyPage = JSON.parse((await handle('GET', `/story/${moment.story_id}`, read)).body) as { evidence: { evidenceId: string }[] };
    return { fyp: await feedIds('fyp'), popular: await feedIds('popular'), story: storyPage.evidence.map((e) => e.evidenceId) };
  };
  const call = (itemId: string, verdict: string) =>
    db.query(`insert into internal.owner_feedback (owner_ref, user_id, subject_kind, item_id, verdict) values ('wallet:A1e82D9Lw4irgKMpXRpJbvLw8c7xCCyA42NdcxzKvvdL', 'did:privy:owner', 'post', $1, $2)`, [itemId, verdict]);
  const HIDDEN = 'x:1900000000000000002';
  await call(HIDDEN, 'not');
  const hidden = await reproject();
  assert.ok(!hidden.fyp.includes(HIDDEN) && !hidden.popular.includes(HIDDEN), 'a post the owner hid is on neither feed');
  assert.ok(!hidden.story.includes(HIDDEN), "and not on its narrative's page");
  assert.equal(hidden.story.length, 3, 'the narrative keeps its other posts');
  const why = await db.query<{ reason: string }>(`select reason from public.feed_rejection where subject_kind = 'post' and subject_id = $1`, [HIDDEN]);
  assert.equal(why[0]?.reason, 'owner_not_meme', "recorded as the owner's no, not the judge's");
  await assert.rejects(db.query(`update internal.owner_feedback set verdict = 'meme' where item_id = $1`, [HIDDEN]), 'a call is never edited in place');

  await call(HIDDEN, 'meme');
  await call('x:1900000000000000005', 'meme');
  const back = await reproject();
  assert.ok(back.fyp.includes(HIDDEN) && back.popular.includes(HIDDEN) && back.story.includes(HIDDEN), '"Is a meme" brings it back everywhere');
  /* ★ THE INFINITE SCROLL'S MEMBERS (0075, services/project feed-members.ts): every post a frame
     showed joined its feed once; the owner's "Not a meme" withdrew HIDDEN and "Is a meme" restored
     it, at the place it first joined. */
  const members = await db.query<{ feed_id: string; item_id: string; withdrawn: boolean; has_card: boolean }>(
    `select feed_id, item_id, withdrawn_at is not null as withdrawn, payload is not null as has_card from public.feed_post order by feed_id, item_id`,
  );
  assert.deepEqual(new Set(members.filter((m) => m.feed_id === 'fyp').map((m) => m.item_id)), new Set(back.fyp), 'every post For You showed is a member');
  assert.ok(members.every((m) => !m.withdrawn && m.has_card), 'none withdrawn after "Is a meme", each with its card');
  /* Seven hours on, the posts are past For You's six hours and not growing: they stay, because they
     were already on it. */
  const later = (clock + 7 * 60 * MINUTE) as Millis;
  await projectRisingFeeds(db, later, frame.coinsByStory, 30 * MINUTE, { ...DEFAULT_POLICY, rising: { ...DEFAULT_POLICY.rising, fypMinReach: 1, popularMinReach: 1, varietyOn: false, fypMaxAgeOn: true } });
  const stayed = (JSON.parse((await handle('GET', '/rising/fyp', read)).body) as { posts: { id: string }[] }).posts.map((p) => p.id);
  assert.deepEqual(new Set(stayed), new Set(back.fyp), 'the six hours never take a post off For You');
  const strangers = await buildRising(db, later, frame.coinsByStory, 30 * MINUTE, { ...DEFAULT_POLICY, rising: { ...DEFAULT_POLICY.rising, fypMinReach: 1, popularMinReach: 1, varietyOn: false, fypMaxAgeOn: true } });
  assert.equal(strangers.fyp.length, 0, 'while the same posts, not yet on it, would be turned away');
  /* A member no longer on the frame is on the scroll under it, newest-joined first; a frame's own
     posts are not repeated there. */
  await db.query(
    `insert into public.feed_post (feed_id, item_id, first_shown_at, last_shown_at, payload, payload_at)
     values ('fyp', 'x:gone', $1, $1, '{"id":"x:gone","coins":{"kind":"pending","why":"not_read_yet"}}', $1)`,
    [new Date(NOW - 3 * 24 * 60 * MINUTE).toISOString()],
  );
  const older = JSON.parse((await handle('GET', '/rising/fyp/older', read)).body) as { posts: { id: string }[]; next: string | null };
  assert.deepEqual(older.posts.map((p) => p.id), ['x:gone']);
  assert.equal(older.next, null, 'a short page ends the scroll');
  await db.query(`delete from public.feed_post where item_id = 'x:gone'`);

  /* The weather post passes the owner's call and meets the reach bar like any other post: its
     views were never read as a rate, so with only measured readings counted it waits, for that
     reason and not the judge's. */
  const weather = await buildRising(db, clock, frame.coinsByStory, 30 * MINUTE, { ...DEFAULT_POLICY, rising: { ...DEFAULT_POLICY.rising, fypMinReach: 1, popularMinReach: 1, varietyOn: false, feedBarCountsEveryReading: false } });
  assert.equal(weather.whyNot.get('x:1900000000000000005'), 'reach_unread', 'the owner says what a post is, not how many saw it');

  /* 6. A second GROUP pass has nothing to do. */
  const again = await loops.group.run(ctx);
  assert.equal(again.in, 0, 'every post already belongs to a story, so none is asked again');
  const after = await db.query<{ n: number }>('select count(*)::int as n from public.story');
  assert.equal(after[0]?.n, 2, 'and no story was made twice');
});
