/**
 * ★ NARRATIVES NEVER DISAPPEAR (the owner, 2026-10-18), on the real schema (PGlite, every migration):
 * the runner's narratives pass, the projector's board frame and the read routes, end to end.
 *
 * What this holds: a narrative made five days ago is still open, still has its page and is in the
 * All time list after its posts left the regroup's window, marked dead and given no Trending place;
 * a new story beside it is a new narrative and is live; only the owner's "Merge with…" folds one
 * into another, and the merged one's link opens the survivor; only his "Not a narrative" takes a
 * page away; the rebuild brings a dropped narrative back under its own id; a narrative the old
 * regroup folded into another comes back with its own posts, which leave the one it was in; and
 * the owner's "Split" makes the posts he picked a new narrative, once, kept apart by later passes.
 */

import { strict as assert } from 'node:assert';
import { before, test } from 'node:test';

import type { Millis } from '@insidor/contracts';
import { DEFAULT_POLICY as LIVE_POLICY } from '@insidor/contracts/policy.ts';
import { withMeasuredBars } from '@insidor/contracts/policy-measured-bars.ts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import { projectNarrativeFrame } from '@insidor/project/src/narrative-frame.ts';
import { SILENT } from '@insidor/read/src/log.ts';
import { handle } from '@insidor/read/src/routes.ts';
import { createLogger } from '@insidor/runner/src/log.ts';
import { narrativeGrouper } from '@insidor/runner/src/work/narratives.ts';
import { PgNarrativeRepo, type Db } from '@insidor/store';

import { planRebuild } from '@insidor/runner/src/work/narrative-rebuild.ts';
import { planUnmerge } from '@insidor/runner/src/work/narrative-unmerge.ts';
import { migratedDb } from './db.ts';

const NOW = Date.now();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const DEFAULT_POLICY = withMeasuredBars(LIVE_POLICY);
const SPACE = DEFAULT_POLICY.group.image.postSpace;
const JUDGE = 'judge:anthropic/claude-haiku-4-5@abc';
const meter = { line: () => ({ capUsd: 1, spentUsd: 0 }) } as unknown as Meter;
const log = createLogger({ test: 'narratives-permanent' });
let db: Db;

/** A unit vector pointing along `axis`: posts of one story share it, other stories are at right angles. */
const along = (axis: number) => `[${Array.from({ length: 1024 }, (_, i) => (i === axis ? 1 : 0)).join(',')}]`;

/** Each post from its own account (a narrative needs two), unless `author` names a shared one. */
async function post(id: string, atMs: number, story: { name: string; body: string; axis: number }, author = `x:by-${id}`, views: number | null = DEFAULT_POLICY.rising.fypMinReach): Promise<void> {
  const at = new Date(atMs).toISOString();
  await db.query(`insert into public.author (author_key, source, source_author_id, handle) values ($1, 'x', $2, $2) on conflict do nothing`, [author, author.replace(/[^a-z0-9]/gi, '')]);
  await db.query(
    `insert into public.item (item_id, source, source_item_id, author_key, posted_at, first_seen_at, body, raw_ref, origin) values ($1, 'x', $2, $5, $3, $3, $4, 'r', 'observed')`,
    [`x:${id}`, id, at, story.body, author],
  );
  await db.query(`insert into internal.item_found_by (item_id, lane, found_at) values ($1, 'all', now()) on conflict do nothing`, [`x:${id}`]);
  await db.query(
    `insert into internal.post_judgement (item_id, judged_at, member_count, judge_id, prompt_id, looked_at, coinable, confidence, proposed_name, alternate_names, subject_spans, cost_usd)
     values ($1, $2, 1, $3, 'post-v1', 'text', true, 0.99, $4, '[]', '[]', 0)`,
    [`x:${id}`, at, JUDGE, story.name],
  );
  await db.query(`insert into internal.post_embedding (item_id, space, embedding) values ($1, $2, $3::vector)`, [`x:${id}`, SPACE, along(story.axis)]);
  /* Viral by default: For You's views bar, so the narrative is listed (Policy.narrative.origin.viralFloor). */
  if (views !== null) await db.query(
    `insert into public.observation (item_id, kind, captured_at, value, fidelity_kind, observed_at, censored) values ($1, 'reach', $2, $3, 'exact', $2, 'below_step')`,
    [`x:${id}`, new Date(atMs + HOUR).toISOString(), views],
  );
}

const PANCAKE = { name: 'Pancake', body: 'Pancake the cat drinks from the fountain again and everyone online is sharing the clip', axis: 1 };
const AZUMA = { name: 'Azuma', body: 'Azuma the koala sat calmly through a blood draw at the zoo and the video went viral', axis: 2 };
const MOODENG = { name: 'Moodeng', body: 'Moodeng the baby pygmy hippo bit her keeper again and the zoo posted it', axis: 4 };
const BANGO = { name: 'Bango', body: 'Bango the capybara and Tsururin the duck went viral at the onsen today', axis: 5 };
const CAPY = { name: 'Capy', body: 'The capybara at the spa got a yuzu bath and the clip is everywhere today', axis: 6 };
const KONASU = { name: 'Konasu', body: 'Konasu the pygmy hippo escaped her keeper again at the zoo this morning', axis: 3 };

const passAt = (nowMs: number) =>
  narrativeGrouper({
    repo: new PgNarrativeRepo(db), save: (p) => new PgNarrativeRepo(db).save(p), block: async () => ({ cutoff: null, chosenOn: null }), titler: null, embed: null,
    keepVectors: async () => false, meter, mode: 'live', policy: DEFAULT_POLICY, postSpace: SPACE, log, now: () => nowMs as Millis,
  }).pass();

const frameAt = (nowMs: number) =>
  projectNarrativeFrame(db, 'default', { nowMs: nowMs as Millis, sparkWindowMs: 30 * 60_000, marketFreshnessMs: DEFAULT_POLICY.market.readingFreshnessMs, feedFreshnessMs: DEFAULT_POLICY.assets.feedFreshnessMs }, nowMs - 26 * HOUR);

const read = async (path: string) => {
  const r = await handle('GET', path, { db: { query: (s: string, p: readonly unknown[]) => db.query(s, p) }, log: SILENT });
  return { status: r.status, body: JSON.parse(r.body) as Record<string, unknown> };
};

const narrativeOf = async (item: string) => (await db.query<{ narrative_id: string }>(`select narrative_id from internal.narrative_member where item_id = $1`, [item]))[0]?.narrative_id ?? null;

before(async () => {
  db = await migratedDb();
  await db.query(`insert into public.author (author_key, source, source_author_id, handle) values ('x:a', 'x', 'a', 'poster')`);
  for (const [i, h] of [5 * DAY + 3 * HOUR, 5 * DAY + 2 * HOUR, 5 * DAY + HOUR].entries()) await post(`p${i}`, NOW - h, PANCAKE);
});

test('★ a narrative made five days ago is still there after its posts left the window, dead, with its page', async () => {
  const first = await passAt(NOW - 5 * DAY);
  assert.equal(first.created, 1);
  const pancake = await narrativeOf('x:p0');
  assert.ok(pancake !== null);

  /* Five days on: a new story, and none of Pancake's posts in the window. */
  for (const [i, h] of [2 * HOUR, HOUR].entries()) await post(`a${i}`, NOW - h, AZUMA);
  const now = await passAt(NOW);
  assert.equal(now.created, 1, 'Azuma is a new narrative');
  assert.equal(now.retired, 0, 'and nothing is retired');
  const [kept] = await db.query<{ state: string; member_count: number }>(`select state, member_count from internal.narrative where narrative_id = $1`, [pancake]);
  assert.deepEqual(kept, { state: 'open', member_count: 3 });

  await frameAt(NOW);
  const page = await read(`/story/${encodeURIComponent(pancake)}`);
  assert.equal(page.status, 200);
  assert.equal(page.body['dead'], true);
  const azuma = await narrativeOf('x:a0');
  assert.ok(azuma !== null);
  const live = await read(`/story/${encodeURIComponent(azuma)}`);
  assert.equal(live.body['dead'], false);
  const windows = page.body['inWindow'] as { trendingPlace?: number }[];
  assert.ok(windows.length > 0 && windows.every((w) => w.trendingPlace === undefined), 'a dead narrative has no Trending place');
  assert.ok((live.body['inWindow'] as { trendingPlace?: number }[]).every((w) => typeof w.trendingPlace === 'number'));
  /* Its posts keep their narrative tag. */
  assert.equal((await db.query(`select 1 from public.story_post where story_id = $1`, [pancake])).length, 3);
});

test('★ the All time list pages every narrative, dead ones too, by when we found it and by views', async () => {
  const all = await read('/narratives/default/all?sort=new');
  assert.equal(all.status, 200);
  const ids = (all.body['stories'] as { id: string }[]).map((s) => s.id);
  assert.deepEqual(ids, [await narrativeOf('x:a0'), await narrativeOf('x:p0')], 'newest found first');
  assert.equal(all.body['next'], null, 'one page');
  assert.equal((await read('/narratives/default/all?sort=viewed')).status, 200);
  assert.equal((await read('/narratives/default/all?sort=nonsense')).status, 400);
  assert.equal((await read('/narratives/nowhere/all')).status, 404);
});

test('★ only the owner merges: his "Merge with…" folds one into the other, and its old link opens the survivor', async () => {
  const pancake = (await narrativeOf('x:p0')) ?? '';
  const azuma = (await narrativeOf('x:a0')) ?? '';
  await db.query(
    `insert into internal.owner_feedback (owner_ref, user_id, subject_kind, item_id, verdict, other_id, members, other_members) values ('x:owner', 'did:owner', 'narrative', $1, 'merge', $2, $3::text[], $4::text[])`,
    [azuma, pancake, ['x:a0', 'x:a1'], ['x:p0', 'x:p1', 'x:p2']],
  );
  const r = await passAt(NOW);
  assert.equal(r.retired, 1);
  assert.equal(await narrativeOf('x:a0'), pancake, "Azuma's posts are in Pancake now");
  await frameAt(NOW);
  const old = await read(`/story/${encodeURIComponent(azuma)}`);
  assert.equal(old.status, 200);
  assert.equal(old.body['id'], pancake, 'the merged link opens the narrative it was merged into');
});

test('★ only "Not a narrative" takes a page away', async () => {
  const pancake = (await narrativeOf('x:p0')) ?? '';
  const members = (await db.query<{ item_id: string }>(`select item_id from internal.narrative_member where narrative_id = $1`, [pancake])).map((m) => m.item_id);
  await db.query(`insert into internal.owner_feedback (owner_ref, user_id, subject_kind, item_id, verdict, members) values ('x:owner', 'did:owner', 'narrative', $1, 'not_narrative', $2::text[])`, [pancake, members]);
  await frameAt(NOW);
  assert.equal((await read(`/story/${encodeURIComponent(pancake)}`)).status, 404);
});

test('★ the rebuild brings a dropped narrative back under its own id, from the stored posts', async () => {
  for (const [i, h] of [3 * DAY + 2 * HOUR, 3 * DAY + HOUR].entries()) await post(`k${i}`, NOW - h, KONASU);
  /* As the old regroup left it: retired, its posts in no narrative. */
  await db.query(`insert into internal.narrative (narrative_id, state, anchor_item, member_count, shown, first_shown_at, title) values ('n-x:k0', 'gone', 'x:k0', 2, false, now() - interval '3 days', 'Konasu The Pygmy Hippo')`);
  const plan = await planRebuild(db, { policy: DEFAULT_POLICY, nowMs: NOW, days: 7, stepMs: 3 * HOUR });
  const missing = plan.missing.find((m) => m.id === 'n-x:k0');
  assert.equal(missing?.outcome.kind, 'back');
  assert.ok(await new PgNarrativeRepo(db).save(plan.pass));
  const [row] = await db.query<{ state: string; title: string; restored: boolean }>(`select state, title, restored_at is not null as restored from internal.narrative where narrative_id = 'n-x:k0'`);
  assert.deepEqual(row, { state: 'open', title: 'Konasu The Pygmy Hippo', restored: true });
  assert.equal(await narrativeOf('x:k1'), 'n-x:k0');
  /* A second run makes nothing new. */
  assert.equal((await planRebuild(db, { policy: DEFAULT_POLICY, nowMs: NOW, days: 7, stepMs: 3 * HOUR })).created.length, 0);
  /* Its page is written by the next frame, off the board's newest if need be. */
  await frameAt(NOW);
  assert.equal((await read('/story/n-x%3Ak0')).status, 200);
});

test('★ a merge nobody asked for is undone: the folded narrative comes back with its own posts, and they leave the blob', async () => {
  for (const [i, h] of [5 * HOUR, 4 * HOUR].entries()) await post(`m${i}`, NOW - h, MOODENG);
  for (const [i, h] of [5 * HOUR, 4 * HOUR].entries()) await post(`b${i}`, NOW - h, BANGO);
  /* As the old regroup left it: Bango folded into Moodeng, every post in Moodeng. */
  await db.query(`insert into internal.narrative (narrative_id, state, anchor_item, member_count, shown, first_shown_at, title) values ('n-x:m0', 'open', 'x:m0', 4, true, now(), 'Moodeng')`);
  await db.query(`insert into internal.narrative_member (narrative_id, item_id) select 'n-x:m0', unnest(array['x:m0', 'x:m1', 'x:b0', 'x:b1'])`);
  await db.query(`insert into internal.narrative (narrative_id, state, merged_into, anchor_item, member_count, shown, first_shown_at, title) values ('n-x:b0', 'merged', 'n-x:m0', 'x:b0', 2, false, now(), 'Bango And Tsururin Go Viral')`);
  await frameAt(NOW);
  assert.equal((await read('/story/n-x%3Ab0')).body['id'], 'n-x:m0', 'folded, its link opens the blob');

  const plan = await planUnmerge(db, { policy: DEFAULT_POLICY });
  const bango = plan.back.find((b) => b.id === 'n-x:b0');
  assert.deepEqual([...(bango?.items ?? [])].sort(), ['x:b0', 'x:b1']);
  assert.deepEqual(plan.back.map((b) => b.id), ['n-x:b0'], 'my own merge (Azuma into Pancake) is never undone');
  assert.equal(plan.holders.find((h) => h.id === 'n-x:m0')?.after, 2);
  assert.equal(await new PgNarrativeRepo(db).unmerge(plan.back), plan.back.length);
  assert.equal(await narrativeOf('x:b1'), 'n-x:b0');
  assert.equal(await narrativeOf('x:m1'), 'n-x:m0');
  const [row] = await db.query<{ state: string; title: string }>(`select state, title from internal.narrative where narrative_id = 'n-x:b0'`);
  assert.deepEqual(row, { state: 'open', title: 'Bango And Tsururin Go Viral' });
  assert.equal((await planUnmerge(db, { policy: DEFAULT_POLICY })).back.length, 0, 'a second run does nothing');

  await frameAt(NOW);
  assert.equal((await db.query(`select 1 from public.story_alias where story_id = 'n-x:b0'`)).length, 0, 'its alias is gone');
  assert.equal((await read('/story/n-x%3Ab0')).body['id'], 'n-x:b0', 'and its link opens its own page');
});

test('★ the owner\'s split: the posts he picked leave for a new narrative, once, and the old page drops them at once', async () => {
  for (const [i, h] of [4 * HOUR, 3 * HOUR, 2 * HOUR, HOUR].entries()) await post(`s${i}`, NOW - h, CAPY);
  await passAt(NOW);
  const capy = (await narrativeOf('x:s0')) ?? '';
  assert.equal(await narrativeOf('x:s3'), capy);
  /* 0108 takes a split call. */
  await db.query(
    `insert into internal.owner_feedback (owner_ref, user_id, subject_kind, item_id, verdict, other_id, members, other_members) values ('x:owner', 'did:owner', 'narrative', $1, 'split', 'n-x:s2', $2::text[], $3::text[])`,
    [capy, ['x:s2', 'x:s3'], ['x:s0', 'x:s1']],
  );
  /* Before the regroup, the old page already lists only the posts that stayed. */
  await frameAt(NOW);
  assert.equal((await db.query(`select 1 from public.story_post where story_id = $1`, [capy])).length, 2);

  await passAt(NOW);
  assert.equal(await narrativeOf('x:s2'), 'n-x:s2');
  assert.equal(await narrativeOf('x:s3'), 'n-x:s2');
  assert.equal(await narrativeOf('x:s1'), capy);
  const counts = await db.query<{ narrative_id: string; state: string; member_count: number; shown: boolean }>(`select narrative_id, state, member_count, shown from internal.narrative where narrative_id = any($1::text[]) order by narrative_id`, [[capy, 'n-x:s2']]);
  assert.deepEqual(counts.map((c) => [c.state, c.member_count, c.shown]), [['open', 2, true], ['open', 2, true]]);

  /* A later pass keeps them apart and splits nothing again. */
  await passAt(NOW);
  assert.equal(await narrativeOf('x:s3'), 'n-x:s2');
  assert.equal(await narrativeOf('x:s0'), capy);
  await frameAt(NOW);
  assert.equal((await read('/story/n-x%3As2')).status, 200, 'the new narrative has its page');
});

const COMET = { name: 'Comet', body: 'Comet the six legged deer is going viral in North Carolina again today', axis: 7 };
const GLORP = { name: 'Glorp', body: 'Glorp the alien cat is running on every timeline today and people love it', axis: 8 };
const NEO = { name: 'Neo', body: 'Neo the raccoon got a tiny wheelchair after his rescue and the clip is everywhere', axis: 9 };

test('★ two posts from one account are kept as a narrative but not listed until another account posts it', async () => {
  for (const [i, h] of [2 * HOUR, HOUR].entries()) await post(`g${i}`, NOW - h, GLORP, 'x:glorper');
  await passAt(NOW);
  const glorp = (await narrativeOf('x:g0')) ?? '';
  assert.ok(glorp !== '', 'kept: narratives are permanent');
  await frameAt(NOW);
  assert.equal((await read(`/story/${encodeURIComponent(glorp)}`)).status, 404, 'no page');
  assert.equal((await db.query(`select 1 from public.story_post where story_id = $1`, [glorp])).length, 0, 'and no story tag on its posts');

  await post('g2', NOW - HOUR / 2, GLORP);
  await passAt(NOW);
  assert.equal(await narrativeOf('x:g2'), glorp);
  await frameAt(NOW);
  assert.equal((await read(`/story/${encodeURIComponent(glorp)}`)).status, 200, 'listed once a second account posts it');
});

test('★ one story, one narrative: new posts about a narrative already made join it, and a newer duplicate merges into the older', async () => {
  for (const [i, h] of [3 * DAY + 2 * HOUR, 3 * DAY + HOUR].entries()) await post(`comet${i}`, NOW - h, COMET);
  await passAt(NOW - 3 * DAY);
  const comet = (await narrativeOf('x:comet0')) ?? '';
  assert.ok(comet !== '');
  /* Three days on its posts are out of the window: the new ones are a group with no pinned post. */
  for (const [i, h] of [2 * HOUR, HOUR].entries()) await post(`comet${i + 2}`, NOW - h, COMET);
  const r = await passAt(NOW);
  assert.equal(r.joinedSame, 1);
  assert.equal(await narrativeOf('x:comet2'), comet, 'the new posts joined the narrative of their subject');

  /* Two narratives already made about one story (as the old passes left them): the newer merges in. */
  for (const [i, h] of [5 * HOUR, 4 * HOUR].entries()) await post(`neoa${i}`, NOW - h, NEO);
  for (const [i, h] of [3 * HOUR, 2 * HOUR].entries()) await post(`neob${i}`, NOW - h, NEO);
  const repo = new PgNarrativeRepo(db);
  await repo.save({ narratives: [
    { id: 'n-x:neoa0', members: ['x:neoa0', 'x:neoa1'], anchor: 'x:neoa0', newestPostAtMs: NOW - 4 * HOUR, shown: true, changed: true },
    { id: 'n-x:neob0', members: ['x:neob0', 'x:neob1'], anchor: 'x:neob0', newestPostAtMs: NOW - 2 * HOUR, shown: true, changed: true },
  ], retired: [] });
  const m = await passAt(NOW);
  assert.equal(m.mergedSame, 1);
  assert.equal(await narrativeOf('x:neob0'), 'n-x:neoa0', 'the newer moved into the older');
  const [row] = await db.query<{ state: string; merged_into: string; merged_by: string }>(`select state, merged_into, merged_by from internal.narrative where narrative_id = 'n-x:neob0'`);
  assert.deepEqual(row, { state: 'merged', merged_into: 'n-x:neoa0', merged_by: 'same_subject' });
  await frameAt(NOW);
  assert.equal((await read('/story/n-x%3Aneob0')).body['id'], 'n-x:neoa0', 'its old link opens the older one');
  /* Comet and Glorp are other subjects: untouched. */
  assert.equal(await narrativeOf('x:comet0'), comet);
  assert.equal((await db.query(`select 1 from internal.narrative where merged_by = 'same_subject'`)).length, 1);
});

test('★ the owner\'s calls outrank the same-subject rule: a narrative he called on is never merged', async () => {
  for (const [i, h] of [5 * HOUR, 4 * HOUR].entries()) await post(`q${i}`, NOW - h, { ...NEO, name: 'Zazu', axis: 10 });
  for (const [i, h] of [3 * HOUR, 2 * HOUR].entries()) await post(`r${i}`, NOW - h, { ...NEO, name: 'Zazu', axis: 10 });
  await new PgNarrativeRepo(db).save({ narratives: [
    { id: 'n-x:q0', members: ['x:q0', 'x:q1'], anchor: 'x:q0', newestPostAtMs: NOW - 4 * HOUR, shown: true, changed: true },
    { id: 'n-x:r0', members: ['x:r0', 'x:r1'], anchor: 'x:r0', newestPostAtMs: NOW - 2 * HOUR, shown: true, changed: true },
  ], retired: [] });
  await db.query(
    `insert into internal.owner_feedback (owner_ref, user_id, subject_kind, item_id, verdict, coin_address, members) values ('x:owner', 'did:owner', 'narrative', 'n-x:r0', 'right', 'So11111111111111111111111111111111111111112', $1::text[])`,
    [['x:r0', 'x:r1']],
  );
  const r = await passAt(NOW);
  assert.equal(r.mergedSame, 0);
  assert.equal(await narrativeOf('x:r0'), 'n-x:r0');
});

const KOBUSHI = { name: 'Kobushi', body: 'Kobushi the pygmy hippo wore a green mask at the zoo and it looks like a horror film', axis: 20 };
const MEMEWAR = { name: 'Memewar', body: 'The Turkish and Chinese accounts are at war over one cat picture and the flag joke', axis: 21 };

test('★ the viral floor: two small posts are kept but not listed; a viral post joining lists them', async () => {
  await post('kob0', NOW - 2 * HOUR, KOBUSHI, 'x:kob0', 60);
  await post('kob1', NOW - HOUR, KOBUSHI, 'x:kob1', 25);
  await passAt(NOW);
  const kobushi = (await narrativeOf('x:kob0')) ?? '';
  assert.ok(kobushi !== '', 'kept: narratives are permanent');
  await frameAt(NOW);
  assert.equal((await read(`/story/${encodeURIComponent(kobushi)}`)).status, 404, 'no post over the views bar: no page');

  await post('kob2', NOW - HOUR / 2, KOBUSHI);
  await passAt(NOW);
  assert.equal(await narrativeOf('x:kob2'), kobushi);
  await frameAt(NOW);
  assert.equal((await read(`/story/${encodeURIComponent(kobushi)}`)).status, 200, 'listed once a viral post is in it');
});

test('★ the starting post: a post four days older that the narrative\'s posts quote joins it, and the page says "Started by"', async () => {
  await post('origin', NOW - 4 * DAY, MEMEWAR, 'x:barkin');
  await post('w0', NOW - 2 * HOUR, MEMEWAR);
  await post('w1', NOW - HOUR, MEMEWAR);
  await db.query(`insert into internal.post_reference (item_id, refers_to, read_at) values ('x:w1', array['x:origin'], now())`);
  const r = await passAt(NOW);
  assert.equal(r.traced, 1);
  const war = (await narrativeOf('x:w0')) ?? '';
  assert.equal(await narrativeOf('x:origin'), war, 'four days before, outside every gap: joined by the quote');
  await frameAt(NOW);
  const page = await read(`/story/${encodeURIComponent(war)}`);
  assert.equal(page.status, 200);
  const earliest = JSON.stringify(page.body);
  assert.match(earliest, /"startedBy":"quoted"/);
  assert.match(earliest, /"authorLabel":"@xbarkin"/);
});

const TAMA = { name: 'Tama', body: 'Tama the station master cat got a new tiny hat and the whole line came to see it', axis: 30 };
const OKAPI = { name: 'Okapi', body: 'The baby okapi took her first wobbly steps at the zoo and the keepers filmed all of it', axis: 31 };
const BUBU = { name: 'Bubu', body: 'Bubu the walrus clapped for the crowd again and the aquarium posted the whole show', axis: 32 };

const frameWith = (nowMs: number, policy: typeof DEFAULT_POLICY) =>
  projectNarrativeFrame(db, 'default', { nowMs: nowMs as Millis, sparkWindowMs: 30 * 60_000, marketFreshnessMs: policy.market.readingFreshnessMs, feedFreshnessMs: policy.assets.feedFreshnessMs }, nowMs - 26 * HOUR, policy);

test('★ once listed, listed: a rule that moves after a page was written never takes it away', async () => {
  for (const [i, h] of [3 * HOUR, 2 * HOUR].entries()) await post(`tama${i}`, NOW - h, TAMA);
  await passAt(NOW);
  const tama = (await narrativeOf('x:tama0')) ?? '';
  await frameAt(NOW);
  assert.equal((await read(`/story/${encodeURIComponent(tama)}`)).status, 200);
  const [row] = await db.query<{ listed: boolean }>(`select listed_at is not null as listed from internal.narrative where narrative_id = $1`, [tama]);
  assert.equal(row?.listed, true, 'the page written marks it listed');

  /* The bar rises and three accounts are asked for: a new narrative would not be listed now. */
  const stricter = {
    ...DEFAULT_POLICY,
    rising: { ...DEFAULT_POLICY.rising, fypMinReach: DEFAULT_POLICY.rising.fypMinReach * 1000 },
    narrative: { ...DEFAULT_POLICY.narrative, minAccounts: 3 },
  };
  await frameWith(NOW, stricter);
  const page = await read(`/story/${encodeURIComponent(tama)}`);
  assert.equal(page.status, 200, 'its page stays');
  assert.equal((await db.query(`select 1 from public.story_post where story_id = $1`, [tama])).length, 2, 'and its posts keep their tag');

  /* A new narrative is still held to the rules the first time. */
  for (const [i, h] of [3 * HOUR, 2 * HOUR].entries()) await post(`okapi${i}`, NOW - h, OKAPI);
  await passAt(NOW);
  const okapi = (await narrativeOf('x:okapi0')) ?? '';
  assert.ok(okapi !== '');
  await frameWith(NOW, stricter);
  assert.equal((await read(`/story/${encodeURIComponent(okapi)}`)).status, 404, 'never listed: the rules decide');
});

test('★ a narrative listed before the viral floor, whose page went, comes back with its small posts', async () => {
  for (const [i, h] of [4 * DAY + 2 * HOUR, 4 * DAY + HOUR].entries()) await post(`bubu${i}`, NOW - h, BUBU, `x:bubu${i}`, 900);
  await passAt(NOW - 4 * DAY);
  const bubu = (await narrativeOf('x:bubu0')) ?? '';
  assert.ok(bubu !== '');
  await frameAt(NOW);
  assert.equal((await read(`/story/${encodeURIComponent(bubu)}`)).status, 404, 'small posts: not listed today');

  /* As 0135 seeds one the projector listed before 23 Oct and the floor then deleted. */
  await db.query(`update internal.narrative set listed_at = first_shown_at where narrative_id = $1`, [bubu]);
  await frameAt(NOW);
  const page = await read(`/story/${encodeURIComponent(bubu)}`);
  assert.equal(page.status, 200, 'its page is written again');
  assert.equal(page.body['dead'], true);
  assert.deepEqual(page.body['viewsTotal'], { v: 1800 }, 'its views as last read');

  /* Only the owner takes it: his "Not a meme" on every post. */
  for (const m of ['x:bubu0', 'x:bubu1']) {
    await db.query(`insert into internal.owner_feedback (owner_ref, user_id, subject_kind, item_id, verdict) values ('x:owner', 'did:owner', 'post', $1, 'not')`, [m]);
  }
  await frameAt(NOW);
  assert.equal((await read(`/story/${encodeURIComponent(bubu)}`)).status, 404, 'his calls left it no post');
});
