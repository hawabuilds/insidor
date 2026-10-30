/**
 * ★ THE QUICK FRAME PLACES A POST THE MOMENT A READING PUTS IT OVER FOR YOU'S BAR (policy.v213,
 * Policy.rising.quickFrame.barCross; the owner, 2026-10-30: "beat the runner"), on the real schema
 * (PGlite, every migration). Between two quick frames no answer, link or owner call lands — only
 * readings. The judged post a reading took over the bar joins For You in that quick frame; the judged
 * post whose new reading is still under the bar does not; a post the judge never passed (no answer, or
 * a "no") does not, however many views; and a judged post already over the bar before the cursor is the
 * full frame's, not re-weighed on every reading. Nothing is fetched or spent.
 */

import { strict as assert } from 'node:assert';
import { before, test } from 'node:test';

import type { Millis } from '@insidor/contracts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import { quickDue, quickForYou, readProbe } from '@insidor/project/src/quick-frame.ts';
import type { Db } from '@insidor/store';

import { migratedDb } from './db.ts';

const MIN = 60_000;
const NOW = Math.floor(Date.now() / MIN) * MIN;
const iso = (ms: number) => new Date(ms).toISOString();
const policy = { ...DEFAULT_POLICY, rising: { ...DEFAULT_POLICY.rising, varietyOn: false, authorShare: { ...DEFAULT_POLICY.rising.authorShare, on: false } } };

const CROSSES = 'x:7001';
const UNDER = 'x:7002';
const NEVER_JUDGED = 'x:7003';
const JUDGED_NO = 'x:7004';
const ALREADY_OVER = 'x:7005';
/** Where the last frame began: every answer is before it, and only readings after. */
const CURSOR_AT = NOW - 5 * MIN;

let db: Db;

const post = async (itemId: string, n: number) => {
  await db.query(
    `insert into public.item (item_id, source, source_item_id, author_key, posted_at, first_seen_at, body, raw_ref, origin)
     values ($1, 'x', $2, $3, $4, $4, $5, 'r', 'observed')`,
    [itemId, itemId.slice(2), `x:a${n}`, iso(NOW - 90 * MIN), `post ${n}`],
  );
  await db.query(`insert into internal.item_found_by (item_id, lane, found_at) values ($1, 'all', $2)`, [itemId, iso(NOW - 80 * MIN)]);
};

const judged = (itemId: string, coinable: boolean) =>
  db.query(
    `insert into internal.post_judgement (item_id, judged_at, member_count, judge_id, prompt_id, looked_at, coinable, confidence, proposed_name, alternate_names, subject_spans, cost_usd)
     values ($1, $2, 1, 'judge:test', 'post-v1', 'text', $3, 0.99, 'Moo Deng', '[]', '[]', 0)`,
    [itemId, iso(NOW - 60 * MIN), coinable],
  );

const reading = (itemId: string, minutesAgo: number, views: number) =>
  db.query(
    `insert into public.observation (item_id, kind, captured_at, value, fidelity_kind, observed_at, censored) values ($1, 'reach', $2, $3, 'exact', $2, 'no_prior')`,
    [itemId, iso(NOW - minutesAgo * MIN), views],
  );

before(async () => {
  db = await migratedDb();
  await db.query(`insert into public.rising_view (feed_id, tick) values ('fyp', 1)`);
  for (let n = 1; n <= 5; n += 1) await db.query(`insert into public.author (author_key, source, source_author_id, handle) values ($1, 'x', $2, $3)`, [`x:a${n}`, `a${n}`, `account${n}`]);
  for (const [i, id] of [CROSSES, UNDER, NEVER_JUDGED, JUDGED_NO, ALREADY_OVER].entries()) await post(id, i + 1);
  await judged(CROSSES, true);
  await judged(UNDER, true);
  await judged(JUDGED_NO, false);
  await judged(ALREADY_OVER, true);
  /* Before the cursor: every one under the bar but the one already over it. */
  for (const id of [CROSSES, UNDER, NEVER_JUDGED, JUDGED_NO]) await reading(id, 30, 900);
  await reading(ALREADY_OVER, 30, 50_000);
  /* After the cursor: readings only. */
  await reading(CROSSES, 1, 60_000);
  await reading(UNDER, 1, 2_000);
  await reading(NEVER_JUDGED, 1, 90_000);
  await reading(JUDGED_NO, 1, 90_000);
  await reading(ALREADY_OVER, 1, 70_000);
});

const cursor = async () => {
  const rows = await db.query<{ id: string }>(`select max(id)::text as id from internal.post_judgement`);
  return { answerId: Number(rows[0]?.id ?? 0), atMs: CURSOR_AT };
};

test('★ no new answer, only readings: the probe sees one post cross, and a quick frame is due', async () => {
  const from = await cursor();
  const probe = await readProbe(db, from, policy);
  assert.equal(probe.answerId, from.answerId, 'no answer since the cursor');
  assert.equal(probe.crossers, 1, 'one judged post crossed the bar');
  /* The answers filed in setup are seconds old here: once they have settled, as they long have live. */
  const settled = { ...probe, atMs: probe.atMs + policy.rising.quickFrame.settleMs };
  assert.equal(quickDue(from, null, settled, settled.atMs, policy), true);
});

test('★ the quick frame adds the post that crossed — never the one under the bar, nor one the judge did not pass', async () => {
  /* In a transaction, as quick-main.ts runs it: the frame keeps a savepoint for its history write. */
  const from = await cursor();
  await db.query('begin');
  const r = await quickForYou(db, NOW as Millis, from, policy);
  await db.query('commit');
  const shown = (await db.query<{ item_id: string }>(`select item_id from public.rising_row where feed_id = 'fyp' order by position`)).map((x) => x.item_id);
  assert.deepEqual(shown, [CROSSES]);
  assert.equal(r.added, 1);
  assert.ok(!shown.includes(UNDER), 'its new reading is still under the bar');
  assert.ok(!shown.includes(NEVER_JUDGED) && !shown.includes(JUDGED_NO), 'no answer, or a no: never added, whatever the views');
  assert.ok(!shown.includes(ALREADY_OVER), 'over the bar before the cursor: the full frame\'s, not this one\'s');
});

test('switched off: the crossing waits for the full frame, as before', async () => {
  const off = { ...policy, rising: { ...policy.rising, quickFrame: { ...policy.rising.quickFrame, barCross: { on: false, maxPosts: 40 } } } };
  const probe = await readProbe(db, await cursor(), off);
  assert.equal(probe.crossers, 0);
});
