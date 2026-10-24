/**
 * `node --env-file=.env.local --experimental-strip-types tools/narrative-origin.ts [--days <n>] [--out <file.md>]`
 *
 * THE STARTING POSTS, THE SAME-STORY MERGES AND THE VIRAL FLOOR, REPLAYED READ-ONLY ON LIVE DATA
 * (the owner's copy test, 2026-10-23). Runs the runner's own narratives pass (work/narratives.ts
 * `group`, which now ends with work/narrative-origin.ts) inside a read-only transaction, over the
 * narratives with a post in the last `--days` (default 5; the live pass reads `origin.liveMs`), and
 * reports:
 *
 *   1. every merge the pass would make: which narrative goes into which, why (a shared starting
 *      post, or quotes through N posts), how alike, and the posts that tie them
 *   2. every narrative given earlier posts: each post's account, time, language, views and tie, and
 *      which post is then its first
 *   3. the viral floor: of the narratives with a post in the window, the ones no longer listed (no
 *      post clears For You's views bar), with five examples of each side
 *
 * Nothing is written, embedded, searched or judged: the pass's write is caught and printed.
 *
 * What breaks if changed carelessly: this must call the runner's `group`, never a copy of it, or the
 * replay measures a rule nobody runs (tools/narratives.ts says the same).
 */

import { writeFileSync } from 'node:fs';
import process from 'node:process';

import type { Millis } from '../contracts/src/vocabulary.ts';
import { DEFAULT_POLICY, type Policy } from '../contracts/src/policy.ts';
import { barWindowMs, standsOnViralPost } from '../core/src/index.ts';
import { inMemoryMeter } from '../adapters/meter/spend/src/index.ts';
import { createPool, DB_ROLE, PgLearningRepo, PgNarrativeRepo, withTransaction, type Db } from '../store/src/index.ts';
import { narrativeGrouper } from '../services/runner/src/work/narratives.ts';

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(name);
  return i < 0 ? null : (process.argv[i + 1] ?? null);
};
const DAY_MS = 86_400_000;
const days = Number(arg('--days') ?? 5);
const P: Policy = { ...DEFAULT_POLICY, narrative: { ...DEFAULT_POLICY.narrative, origin: { ...DEFAULT_POLICY.narrative.origin, liveMs: days * DAY_MS } } };
const POST_SPACE = 'multimodal-3.1024.post';
const SHORT_VIDEO_SOURCE = 'tiktok';
/** The board's length (services/project narrative-frame.ts BOARD_LIMIT). */
const BOARD = 200;
const quiet = { info: () => {}, warn: (m: string, f?: unknown) => console.warn(m, f ?? ''), error: (m: string, f?: unknown) => console.error(m, f ?? ''), child: () => quiet };

interface PostFacts {
  readonly handle: string;
  readonly at: string;
  readonly atMs: number;
  readonly lang: string;
  readonly views: number | null;
  readonly text: string;
}

async function facts(db: Db, ids: readonly string[]): Promise<ReadonlyMap<string, PostFacts>> {
  if (ids.length === 0) return new Map();
  const rows = await db.query<{ item_id: string; handle: string | null; at: Date; lang: string | null; views: string | null; body: string }>(
    `select i.item_id, a.handle, coalesce(i.posted_at, i.first_seen_at) as at, i.lang, i.body,
            (select max(o.value) from public.observation o where o.item_id = i.item_id and o.kind = 'reach' and o.value is not null) as views
       from public.item i left join public.author a on a.author_key = i.author_key
      where i.item_id = any($1::text[])`,
    [[...ids]],
  );
  return new Map(rows.map((r) => [r.item_id, {
    handle: r.handle === null ? '?' : `@${r.handle.replace(/^@/, '')}`,
    atMs: new Date(r.at).getTime(),
    at: new Date(r.at).toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
    lang: r.lang ?? '?',
    views: r.views === null ? null : Number(r.views),
    text: r.body.replace(/\s+/g, ' ').slice(0, 80),
  }] as const));
}

const views = (v: number | null) => (v === null ? 'no reading' : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}K` : String(v));

const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-narrative-origin' });
const lines: string[] = [];
const say = (s = '') => lines.push(s);
try {
  await withTransaction(pool, async (db) => {
    await db.query('set transaction read only');
    const repo = new PgNarrativeRepo(db);
    const learning = new PgLearningRepo(db);
    const grouper = narrativeGrouper({
      repo,
      save: async () => false,
      block: async () => ((b) => ({ cutoff: b?.cutoff ?? null, chosenOn: b?.cutoffModel ?? null }))(await learning.latestApplied()),
      titler: null,
      embed: null,
      keepVectors: async () => false,
      meter: inMemoryMeter({ dailyCapUsd: 0.01, softStop: 1, now: () => Date.now() }),
      mode: 'dry',
      policy: P,
      postSpace: POST_SPACE,
      log: quiet,
      now: () => Date.now() as Millis,
    });
    const started = Date.now();
    const grouped = await grouper.group();
    if (typeof grouped === 'string') throw new Error(grouped);
    const ms = Date.now() - started;

    const live = await repo.live(Date.now() - days * DAY_MS);
    const titleOf = new Map(live.map((x) => [x.id, x.title ?? '(no title yet)'] as const));
    const membersOf = new Map(live.map((x) => [x.id, x.members] as const));
    const t = (id: string) => `"${titleOf.get(id) ?? '(new this pass)'}" (${membersOf.get(id)?.length ?? 0} posts)`;
    const story = grouped.pass.retired.filter((r) => r.by === 'same_story');
    const plan = grouped.origin ?? { merges: [], starts: new Map() };

    say(`# Starting posts and one story: replay of the narratives pass over ${days} days (read-only)`);
    say();
    say(`${live.length} shown narratives with a post in the last ${days} days. The pass took ${ms} ms. Rule: policy ${P.version} narrative.origin.`);
    say();
    /* Which early posts are the origin step's (the early step's are the ones it also lists). */
    const earlyIds = [...new Set([...plan.starts.values()].flat().map((x) => x.itemId))];
    const f = await facts(db, [...earlyIds, ...[...membersOf.values()].flat()]);
    say(`## 1. Merged as one story: ${story.length}`);
    say();
    for (const m of plan.merges) {
      const why = m.why === 'shared_start' ? 'both quote the same starting post' : m.why === 'quotes' ? `quotes join ${m.via.length} of their posts` : `both say ${m.words?.length ?? 0} rare words: ${(m.words ?? []).join(' ')}`;
      say(`- ${t(m.from)} → ${t(m.into)} — ${why}, alike ${m.meaning.toFixed(2)}; via ${m.via.join(' ')}`);
    }
    if (story.length !== plan.merges.length) say(`(the pass's write lists ${story.length})`);
    say();
    /* Each merged story's first post, as the board will show it: the earliest post of all its sides. */
    const sidesOf = (id: string): string[] => [id, ...plan.merges.filter((m) => m.into === id).flatMap((m) => sidesOf(m.from))];
    const into = new Set(plan.merges.map((m) => m.into).filter((id) => !plan.merges.some((m) => m.from === id)));
    for (const id of into) {
      const posts = sidesOf(id).flatMap((s) => [...(membersOf.get(s) ?? []), ...(plan.starts.get(s) ?? []).map((x) => x.itemId)]);
      const first = [...posts].sort((a, b) => (f.get(a)?.atMs ?? Number.POSITIVE_INFINITY) - (f.get(b)?.atMs ?? Number.POSITIVE_INFINITY))[0] ?? '';
      say(`- ${t(id)} now starts with ${first} ${f.get(first)?.handle ?? '?'} ${f.get(first)?.at ?? '?'}`);
    }
    say();

    say(`## 2. Narratives given a starting post: ${plan.starts.size} (${earlyIds.length} posts)`);
    say();
    for (const [id, list] of plan.starts) {
      const merged = plan.merges.filter((m) => m.into === id).map((m) => t(m.from));
      say(`- ${t(id)}${merged.length > 0 ? ` (with ${merged.join(', ')})` : ''} — now starts with ${f.get(list[0]?.itemId ?? '')?.handle ?? '?'}`);
      for (const x of list) {
        const p = f.get(x.itemId);
        say(`  - ${x.tie}: ${x.itemId} ${p?.handle ?? '?'} ${p?.at ?? '?'} [${p?.lang ?? '?'}] ${views(p?.views ?? null)} — ${p?.text ?? ''}`);
      }
    }
    say();

    /* ── 2b. the loose posts that join (policy.v145 `origin.join*`) ── */
    const joins = plan.joins ?? new Map();
    const joinIds = [...new Set([...joins.values()].flat().map((x) => x.itemId))];
    const fj = await facts(db, joinIds);
    say(`## 2b. Narratives given loose posts that quote them or say their words: ${joins.size} (${joinIds.length} posts; quoted ${[...joins.values()].flat().filter((x) => x.tie === 'quoted').length}, same words ${[...joins.values()].flat().filter((x) => x.tie === 'phrase').length}, same rare single words ${[...joins.values()].flat().filter((x) => x.tie === 'words').length})`);
    say();
    for (const [id, list] of joins) {
      say(`- ${t(id)}`);
      for (const x of list) {
        const p = fj.get(x.itemId);
        say(`  - ${x.tie}: ${x.itemId} ${p?.handle ?? '?'} ${p?.at ?? '?'} [${p?.lang ?? '?'}] ${views(p?.views ?? null)} — ${p?.text ?? ''}`);
      }
    }
    say();

    /* ── 3. the viral floor, over each narrative as the pass leaves it (its starting posts and merges in) ── */
    const goneInto = new Set(plan.merges.map((m) => m.from));
    const after = live.filter((x) => !goneInto.has(x.id)).map((x) => ({
      x,
      members: [...x.members, ...(plan.starts.get(x.id) ?? []).map((s) => s.itemId), ...plan.merges.filter((m) => m.into === x.id).flatMap((m) => membersOf.get(m.from) ?? [])],
    }));
    const ids = [...new Set(after.flatMap((y) => y.members))];
    const bar = await repo.barReadings(ids, barWindowMs(P));
    const more = await facts(db, ids.filter((id) => !f.has(id)));
    const viewsOf = (m: string) => f.get(m)?.views ?? more.get(m)?.views ?? null;
    const most = (members: readonly string[]) => Math.max(0, ...members.map((m) => viewsOf(m) ?? 0));
    const unread = (members: readonly string[]) => members.every((m) => viewsOf(m) === null);
    const on = after.map((y) => ({
      ...y,
      viral: standsOnViralPost(y.members.map((m) => {
        const b = bar.get(m);
        return { readings: b?.readings ?? [], postedAtMs: b?.postedAtMs ?? null, scale: b?.source === SHORT_VIDEO_SOURCE ? P.rising.shortVideoReachScale : 1 };
      }), P),
    }));
    const dropped = on.filter((y) => !y.viral);
    const kept = on.filter((y) => y.viral);
    const board = [...on].sort((a, b) => (b.x.newestPostAtMs ?? 0) - (a.x.newestPostAtMs ?? 0)).slice(0, BOARD);
    say(`## 3. Viral floor: ${dropped.length} of ${on.length} narratives would no longer be listed (kept in the database, listed again when a viral post joins)`);
    say();
    say(`- of the ${board.length} newest (the board): ${board.filter((y) => !y.viral).length} dropped, ${board.filter((y) => y.viral).length} kept`);
    say(`- dropped with no view reading on any post (never read, not small): ${dropped.filter((y) => unread(y.members)).length}`);
    say(`- kept only because a starting post traced back this pass is viral: ${on.filter((y) => y.viral && (plan.starts.get(y.x.id) ?? []).length > 0 && !standsOnViralPost(y.x.members.map((m) => { const b = bar.get(m); return { readings: b?.readings ?? [], postedAtMs: b?.postedAtMs ?? null, scale: b?.source === SHORT_VIDEO_SOURCE ? P.rising.shortVideoReachScale : 1 }; }), P)).length}`);
    say();
    const ex = (list: typeof on, by: 'new' | 'views') => [...list].sort((a, b) => (by === 'new' ? (b.x.firstShownAtMs ?? 0) - (a.x.firstShownAtMs ?? 0) : most(b.members) - most(a.members))).slice(0, 5).map((y) => `- "${y.x.title ?? '(no title)'}" ${y.members.length} posts, top post ${views(most(y.members))}`);
    say('Dropped, newest first:');
    for (const l of ex(dropped, 'new')) say(l);
    say();
    say('Dropped, the most viewed (the closest calls):');
    for (const l of ex(dropped, 'views')) say(l);
    say();
    say('Kept, newest first:');
    for (const l of ex(kept, 'new')) say(l);
    say();
    say('Dropped by top post views:');
    const buckets = [[0, 1_000], [1_000, 10_000], [10_000, 40_000], [40_000, Number.POSITIVE_INFINITY]] as const;
    for (const [lo, hi] of buckets) say(`- ${lo}–${hi === Number.POSITIVE_INFINITY ? '' : hi}: ${dropped.filter((y) => most(y.members) >= lo && most(y.members) < hi).length}`);
  });
} finally {
  await pool.end();
}
console.log(lines.join('\n'));
const out = arg('--out');
if (out !== null) writeFileSync(out, lines.join('\n') + '\n');
