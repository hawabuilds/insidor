/**
 * `node --env-file=.env.local --experimental-strip-types tools/coin-origin-replay.ts [--days 3] [--read read.json] [--needs needs.json]`
 *
 * THE COIN-FIRST ROUTE'S WALK TO THE ORIGINAL, REPLAYED (Policy.rising.coinFirst.origin, 0118). Over
 * the coins of the last `--days` days that traded at `oneCoin.minCapUsd` or more (the route's running
 * bar), each linked post is walked to its original with the runner's own `walk` (services/runner
 * work/coin-first.ts) over today's database, read-only, and counted:
 *
 *   outcomes    the linked post is the viral post (`self`), points at an original (by which hops),
 *               is a launcher's post with nothing to follow (`pointer`), or needs a read first
 *   reads       the posts the walk would read by id — originals we do not hold, and held posts whose
 *               links were never kept (every post stored before 0118) — per day of launch, priced at
 *               the text source's read
 *   recorded    of the posts the route actually recorded (internal.coin_first_post) and let onto For
 *               You, which were pointers and which originals under the walk
 *   examples    a few of each, and the named cases (Laura, HI)
 *
 * The database alone cannot say what an unread post points at. `--needs` writes the ids the walk
 * wanted read; `--read` takes a JSON object of those posts as read elsewhere (`{ id: CoinOriginPost
 * & { followers } | { gone: true } }`) and overlays it, so a few rounds of paid reads (cents) finish
 * the walk. Without `--read` the remaining reads are reported as such, never guessed.
 *
 * What breaks if changed carelessly: the overlay must look like the store's own read
 * (`PgCoinFirstRepo.origins`); a field filled differently here would count a walk the runner never makes.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

import type { Millis } from '../contracts/src/index.ts';
import { DEFAULT_POLICY } from '../contracts/src/policy.ts';
import type { OriginOutcome } from '../core/src/index.ts';
import { walk } from '../services/runner/src/work/coin-first.ts';
import { asDb, createPool, DB_ROLE, PgCoinFirstRepo, type CoinOriginPost } from '../store/src/index.ts';

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
};
const days = Number(arg('--days') ?? 3);
const readPath = arg('--read');
const needsPath = arg('--needs');
/** The text source's read by id, as Policy prices it (`refillAuthorMaxUsdPerPost`'s note). */
const READ_USD = 0.00015;
const DAY_MS = 86_400_000;
const LAURA = 'x:2112515412315590765';
const HI = 'x:2112216643115925529';

type ReadPost = (CoinOriginPost & { readonly followers?: number | null }) | { readonly gone: true };
const read: Record<string, ReadPost> = readPath === null ? {} : (JSON.parse(readFileSync(readPath, 'utf8')) as Record<string, ReadPost>);

const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-coin-origin-replay' });
const client = await pool.connect();
try {
  await client.query('begin read only');
  const db = asDb(client);
  const repo = new PgCoinFirstRepo(db);
  const policy = DEFAULT_POLICY;
  const now = Date.now();
  const since = (now - days * DAY_MS) as Millis;

  const rows = await repo.running(since, policy.oneCoin.minCapUsd, 100_000);
  const first = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const had = first.get(r.itemId);
    if (had === undefined || r.launchedAtMs < had.launchedAtMs) first.set(r.itemId, r);
  }
  const linked = [...new Set([...first.keys(), LAURA, HI])];

  /* The store's read, with the posts read elsewhere laid over it (a post read since is held, its links known). */
  const overlay: Pick<PgCoinFirstRepo, 'origins' | 'accounts'> = {
    origins: async (ids, mediaSince) => {
      const got = await repo.origins(ids, mediaSince);
      /* Before 0118 no post's links were kept: after it, every such post is one whose links were never read. */
      const held = new Map([...got.held].map(([k, v]) => [k, got.referencesKept ? v : { ...v, refersTo: null }] as const));
      const fetched = new Map(got.fetchAskedAtMs);
      for (const id of ids) {
        const r = read[id];
        if (r === undefined) continue;
        if ('gone' in r) fetched.set(id, now as Millis);
        else {
          held.set(id, { ...(held.get(id) ?? {}), ...r, judged: held.get(id)?.judged ?? false, credited: held.get(id)?.credited ?? false });
          fetched.set(id, now as Millis);
        }
      }
      return { held, fetchAskedAtMs: fetched, judgeAskedAtMs: got.judgeAskedAtMs, referencesKept: true };
    },
    accounts: async (keys, s) => {
      const got = new Map(await repo.accounts(keys, s));
      for (const r of Object.values(read)) {
        if ('gone' in r || got.has(r.authorKey) || !keys.includes(r.authorKey)) continue;
        got.set(r.authorKey, { posts: 1, linked: 0, followers: r.followers ?? null });
      }
      return got;
    },
  };
  const w = await walk({ repo: overlay as PgCoinFirstRepo, policy }, linked, now, policy.rising.coinFirst.origin.maxDepth);

  const kindOf = (o: OriginOutcome | undefined): string => (o === undefined ? 'none' : o.kind === 'original' ? `original (${o.hops.join('>')})` : o.kind);
  const tally = new Map<string, number>();
  for (const id of first.keys()) tally.set(kindOf(w.outcomes.get(id)), (tally.get(kindOf(w.outcomes.get(id))) ?? 0) + 1);
  console.log(`Linked posts of coins that ran (≥ $${policy.oneCoin.minCapUsd}) over ${days} days: ${first.size} (${(first.size / days).toFixed(0)} a day), from ${rows.length} coin links.`);
  for (const [k, n] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(30)} ${String(n).padStart(5)}  ${((100 * n) / Math.max(1, first.size)).toFixed(0)}%`);

  /* The launcher bars: how the linked posts the walk takes as the viral post would move under looser ones. */
  const selfIds = [...first.keys()].filter((id) => w.outcomes.get(id)?.kind === 'self');
  const selfAuthors = new Map([...selfIds].flatMap((id) => {
    const a = w.held.get(id)?.authorKey;
    return a === undefined ? [] : [[id, a] as const];
  }));
  const o = policy.rising.coinFirst.origin;
  const acc = await repo.accounts([...new Set(selfAuthors.values())], (now - o.launcherLookbackMs) as Millis);
  console.log(`\nOf the ${selfIds.length} taken as the viral post, by their account over ${o.launcherLookbackMs / DAY_MS} days (posts coins link / share of its posts / followers):`);
  for (const [i, [minLinked, share, maxF]] of [[o.launcherMinLinkedPosts, o.launcherMinLinkedShare, o.launcherMaxFollowers], [5, 0.5, 50_000], [3, 0.3, 100_000]].entries()) {
    const hit = selfIds.filter((id) => {
      const a = acc.get(selfAuthors.get(id) ?? '');
      return a !== undefined && a.followers !== null && a.linked >= minLinked && a.linked / Math.max(1, a.posts) >= share && a.followers < maxF;
    });
    const keys = [...new Set(hit.map((id) => selfAuthors.get(id) ?? ''))];
    const handles = (await db.query<{ author_key: string; handle: string | null }>(`select author_key, handle from public.author where author_key = any($1::text[])`, [keys]))
      .map((r) => {
        const a = acc.get(r.author_key);
        return `@${r.handle ?? '?'} ${a?.linked}/${a?.posts} ${a?.followers}`;
      });
    console.log(`  ≥ ${String(minLinked).padStart(2)} linked, ≥ ${share} of its posts, < ${maxF} followers${i === 0 ? ' (policy)' : ''}: ${hit.length} would be launchers' pointers`);
    if (handles.length > 0) console.log(`      ${handles.slice(0, 40).join(', ')}`);
  }

  /* The reads the walk made or still wants: posts not held, and held posts whose links were never kept. */
  const wanted = [...new Set([...w.outcomes.values()].flatMap((o) => (o.kind === 'read' ? [o.itemId] : [])))];
  const readCount = Object.keys(read).length;
  const byDay = new Map<string, number>();
  for (const id of first.keys()) {
    const o = w.outcomes.get(id);
    const touched = (o?.kind === 'read' ? 1 : 0) + (read[id] !== undefined ? 1 : 0);
    if (touched === 0) continue;
    const day = new Date(first.get(id)?.launchedAtMs ?? now).toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + touched);
  }
  console.log(`\nReads by id: ${readCount} done in rounds (--read), ${wanted.length} still wanted. At $${READ_USD} each: $${((readCount + wanted.length) * READ_USD).toFixed(3)} for ${days} days, $${(((readCount + wanted.length) * READ_USD) / days).toFixed(3)} a day.`);
  for (const [d, n] of [...byDay].sort()) console.log(`  ${d}  ${n} reads`);
  if (needsPath !== null) writeFileSync(needsPath, JSON.stringify(wanted));

  /* What the route recorded and let in, under the walk. */
  const rec = await db.query<{ item_id: string; admitted: boolean; via: string }>(
    `select item_id, admitted_at is not null as admitted, via from internal.coin_first_post where first_seen_at >= $1`,
    [new Date(since).toISOString()],
  );
  const recIds = rec.map((r) => r.item_id);
  const recWalk = await walk({ repo: overlay as PgCoinFirstRepo, policy }, recIds, now, policy.rising.coinFirst.origin.maxDepth);
  const judge = (id: string): string => {
    const o = recWalk.outcomes.get(id);
    if (o === undefined) return 'none';
    if (o.kind === 'self') return 'original';
    if (o.kind === 'original' || o.kind === 'pointer') return 'pointer';
    return o.kind === 'read' && o.itemId !== id ? 'pointer (original unread)' : o.kind;
  };
  const recTally = new Map<string, { all: number; admitted: number }>();
  for (const r of rec) {
    const k = judge(r.item_id);
    const t = recTally.get(k) ?? { all: 0, admitted: 0 };
    recTally.set(k, { all: t.all + 1, admitted: t.admitted + (r.admitted ? 1 : 0) });
  }
  console.log(`\nPosts the route recorded since ${new Date(since).toISOString().slice(0, 16)} (${rec.length}; ${rec.filter((r) => r.admitted).length} let onto For You), under the walk:`);
  for (const [k, t] of recTally) console.log(`  ${k.padEnd(28)} ${String(t.all).padStart(4)} recorded, ${t.admitted} admitted`);

  /* Examples, with handles. */
  const admitted = rec.filter((r) => r.admitted).map((r) => r.item_id);
  const ids = [...new Set([...w.outcomes.entries(), ...recWalk.outcomes.entries()].flatMap(([id, o]) => (o.kind === 'original' ? [id, o.itemId] : [id])))];
  const names = new Map(
    (await db.query<{ item_id: string; handle: string | null; body: string }>(
      `select i.item_id, a.handle, left(regexp_replace(i.body, '\\s+', ' ', 'g'), 70) as body from public.item i left join public.author a on a.author_key = i.author_key where i.item_id = any($1::text[])`,
      [ids],
    )).map((r) => [r.item_id, `@${r.handle ?? '?'} "${r.body}"`] as const),
  );
  const show = (id: string): string => names.get(id) ?? `${id} (not held)`;
  const example = (id: string): string => {
    const o = w.outcomes.get(id);
    return o?.kind === 'original' ? `${show(id)}\n      → ${o.hops.join('>')} → ${show(o.itemId)}` : `${show(id)} — ${kindOf(o)}`;
  };
  console.log('\nLet onto For You by the route, under the walk:');
  for (const id of admitted) {
    const o = recWalk.outcomes.get(id);
    console.log(`  ${judge(id).padEnd(9)} ${show(id)}${o?.kind === 'original' ? `\n            → ${o.hops.join('>')} → ${show(o.itemId)}` : ''}`);
  }
  console.log('\nNamed cases:');
  console.log(`  Laura  ${example(LAURA)}`);
  console.log(`  HI     ${example(HI)}`);
  for (const k of ['original', 'chain', 'pointer', 'self']) {
    console.log(`\nExamples — ${k}:`);
    const of = (i: string): boolean => {
      const x = w.outcomes.get(i);
      return k === 'chain' ? x?.kind === 'original' && x.hops.length > 1 : x?.kind === k;
    };
    for (const id of [...first.keys()].filter(of).slice(0, 8)) console.log(`  ${example(id)}`);
  }
  await client.query('rollback');
} finally {
  client.release();
  await pool.end();
}
