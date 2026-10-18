/**
 * `node --env-file=.env.local --experimental-strip-types tools/fyp-sort-check.ts [--lists mv1h,mv6h,mv24h,tr1h] [--top 10]`
 * `SPEND=live node --env-file=.env.local --experimental-strip-types tools/fyp-sort-check.ts --yes`
 *
 * THE OWNER'S CHECK OF FOR YOU'S SORTS AGAINST FRESH READS (2026-10-18: "compare the top 10 of each
 * sort against fresh reads. At least 9 of 10 must be in the right order"). For each list it takes two
 * top 10s at the same moment — the one the live read service is serving (GET /rising/fyp/sorted) and
 * the one this branch's ranking (services/read/src/post-sorts.ts) gives on the database's own
 * readings — re-reads every post in either by id, once, and says where each really ranks.
 *
 *   Fresh truth, per post: Most viewed W is its views now (the fresh read) less its views at now - W,
 *   worked out from its stored readings by the narratives' rule (between two readings evenly; a post
 *   first read inside the window counts from that first reading). Trending is the sort's own rule on
 *   the fresh numbers: speed now (fresh read less its views at the half, a minute) over speed before,
 *   for posts at or over the policy's floor; a post under it below them by its speed; a short video
 *   at the policy's short-video scale.
 *   In order: the longest run of the ten that the fresh truth keeps in the same order (9 of 10 means
 *   one post out of place), with exact places and pairs agreeing beside it.
 *
 * ★ DRY BY DEFAULT. Without SPEND=live and --yes it reads the API and the database only, prints both
 * top 10s and what the re-read would cost, and stops: no supplier is called, nothing is written. A
 * live run refuses above CAP_USD ($0.05) — narrow `--lists` until it fits — and spends under a meter
 * capped at its own estimate, on the jobs' book, so it cannot spend more than it printed.
 *
 * Its own tool because the check needs the internal readings the read service may not see and the
 * suppliers it must never call. What breaks if changed carelessly: the cap, and reading a post twice
 * when it is in several lists (each id is read once, whichever lists it is in).
 */

import process from 'node:process';

import { DEFAULT_POLICY } from '../contracts/src/policy.ts';
import type { Meter } from '../contracts/src/ports/meter.ts';
import { metered } from '../adapters/meter/spend/src/index.ts';
import { xPlatform, httpClient as xClient } from '../adapters/platform/x/src/index.ts';
import { DEFAULT_FEED_BASE_URL } from '../adapters/platform/tiktok/src/trending-feed.ts';
import { scClient, SC_PRICES, SC_VENDOR } from '../adapters/platform/tiktok/src/scrapecreators.ts';
import { fromSearchActor } from '../adapters/platform/tiktok/src/search-actor.ts';
import { asDb, createPool, DB_ROLE } from '../store/src/index.ts';
import { loadReach } from '../services/project/src/db.ts';
import { firstCount } from '../services/project/src/rising.ts';
import { gainIn, rankPost, rankScale, ranked, runsOf, SORT_WINDOWS, type Reading, type SortBy, type SortWindow } from '../services/read/src/post-sorts.ts';
import { openSharedMeter } from './lib/shared-meter.ts';

const CAP_USD = 0.05;
const X_USD = 0.000_15;
const TIKTOK_USD = 0.001_88;
const READ_URL = (process.env['READ_SERVICE_URL'] ?? 'https://read-production-a6c0.up.railway.app').replace(/\/+$/, '');
const LISTS: Readonly<Record<string, readonly [SortBy, SortWindow]>> = { mv1h: ['most_viewed', '1h'], mv6h: ['most_viewed', '6h'], mv24h: ['most_viewed', '24h'], tr1h: ['trending', '1h'] };

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};
const top = Math.max(1, Math.trunc(Number(arg('--top') ?? '10')));
const chosen = (arg('--lists') ?? Object.keys(LISTS).join(',')).split(',').map((s) => s.trim()).filter((s) => s in LISTS);
const live = process.env['SPEND'] === 'live' && process.argv.includes('--yes');

const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-fyp-sort-check' });
const db = asDb(pool);
const now = Date.now();

/* For You's members and their readings as the projector will store them on the card (`counts`). */
const members = await db.query<{ item_id: string; source: string; source_item_id: string; handle: string | null; posted: string | null }>(
  `select f.item_id, i.source, i.source_item_id, a.handle, (extract(epoch from i.posted_at) * 1000)::bigint::text as posted
     from public.feed_post f join public.item i on i.item_id = f.item_id left join public.author a on a.author_key = i.author_key
    where f.feed_id = 'fyp' and f.withdrawn_at is null`,
);
const info = new Map(members.map((m) => [m.item_id, m] as const));
const reach = await loadReach(db, members.map((m) => m.item_id), (now - 50 * 3_600_000) as never);
const counts = new Map(members.map((m) => [m.item_id, (reach.get(m.item_id) ?? []).map((x): Reading => ({ atMs: x.atMs, value: x.rate.kind === 'measured' ? x.rate.level : firstCount(x) }))] as const));

/** Views at `at` by the narratives' rule: the gain spread between readings, the first reading if `at` is before it. */
function viewsAt(rs: readonly Reading[], at: number): number | null {
  const pts = rs.filter((r) => r.value !== null).sort((a, b) => a.atMs - b.atMs) as { atMs: number; value: number }[];
  const first = pts[0];
  if (first === undefined) return null;
  if (at <= first.atMs) return first.value;
  return first.value + gainIn(runsOf(pts).runs, first.atMs, at);
}

const served = new Map<string, readonly string[]>();
const ours = new Map<string, readonly string[]>();
for (const name of chosen) {
  const [by, w] = LISTS[name]!;
  const res = await fetch(`${READ_URL}/rising/fyp/sorted?by=${by}&window=${w}`);
  const body = (await res.json()) as { posts?: { id?: unknown }[] };
  served.set(name, (body.posts ?? []).flatMap((p) => (typeof p.id === 'string' ? [p.id] : [])).slice(0, top));
  const list = ranked(members.flatMap((m) => {
    const one = rankPost(m.item_id, counts.get(m.item_id) ?? [], m.posted === null ? null : Number(m.posted), by, SORT_WINDOWS[w], now, rankScale(m.source));
    return one === null ? [] : [one];
  }), top);
  ours.set(name, list.map((x) => x.id));
}

const ids = [...new Set([...served.values(), ...ours.values()].flat())].filter((id) => info.has(id));
const xs = ids.filter((id) => info.get(id)!.source === 'x');
const tts = ids.filter((id) => info.get(id)!.source === 'tiktok');
const estimate = xs.length * X_USD + tts.length * TIKTOK_USD;
console.log(`lists ${chosen.join(', ')}, top ${top}: ${ids.length} posts to re-read (${xs.length} X at $${X_USD}, ${tts.length} TikTok at $${TIKTOK_USD}) = $${estimate.toFixed(4)}; cap $${CAP_USD}`);
for (const name of chosen) console.log(`  ${name} served: ${served.get(name)!.join(' ')}\n  ${name} branch: ${ours.get(name)!.join(' ')}`);
if (!live) {
  console.log('DRY RUN: nothing read. SPEND=live and --yes to re-read.');
  await pool.end();
  process.exit(0);
}
if (estimate > CAP_USD) {
  console.error(`refused: $${estimate.toFixed(4)} is over the cap of $${CAP_USD}. Narrow --lists.`);
  await pool.end();
  process.exit(2);
}

const shared = await openSharedMeter(estimate + 0.001);
const meter: Meter = shared.meter;
const fresh = new Map<string, { views: number; atMs: number }>();
let spent = 0;
try {
  if (xs.length > 0) {
    const apiKey = process.env['X_API_KEY'] ?? '';
    const x = xPlatform({ client: xClient({ apiKey, baseUrl: process.env['X_API_BASE'] ?? 'https://api.twitterapi.io', fetch: globalThis.fetch }), meter, now: () => Date.now() });
    const line = meter.line();
    const r = await x.lookup!(xs.map((id) => info.get(id)!.source_item_id), { capUsd: line.capUsd, spentUsd: line.spentUsd, maxCalls: null, deadline: Date.now() + 60_000 });
    const at = Date.now();
    spent += r.spend.usd;
    for (const item of r.value.items) {
      const v = item.counters.reach?.value;
      if (typeof v === 'number') fresh.set(`x:${item.sourceItemId}`, { views: v, atMs: at });
    }
  }
  const sc = scClient({ apiKey: process.env['SCRAPECREATORS_API_KEY'] ?? '', baseUrl: DEFAULT_FEED_BASE_URL, fetch: globalThis.fetch });
  for (const id of tts) {
    const m = info.get(id)!;
    if (sc === null) break;
    if (m.handle === null) continue;
    const at = Date.now();
    try {
      const v = await metered(meter, SC_PRICES, { vendor: SC_VENDOR, endpoint: 'video', unit: 'per-call', estUnits: 1, at }, async () => ({ value: await sc.video(`https://www.tiktok.com/@${m.handle}/video/${m.source_item_id}`), units: 1 }));
      spent += TIKTOK_USD;
      const views = v.value.item === null ? null : (fromSearchActor(v.value.item) as Record<string, unknown>)['playCount'];
      if (typeof views === 'number') fresh.set(id, { views, atMs: Date.now() });
    } catch (e) {
      console.error(`${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
} finally {
  await shared.close();
}

/** The fresh truth a list ranks by, or null when the post was not re-read or has no stored reading. */
function truth(id: string, by: SortBy, w: SortWindow): number | null {
  const f = fresh.get(id);
  const rs = counts.get(id) ?? [];
  if (f === undefined) return null;
  const W = SORT_WINDOWS[w];
  const start = viewsAt(rs, now - W);
  if (start === null) return null;
  if (by === 'most_viewed') return Math.max(0, f.views - start);
  const mid = viewsAt(rs, now - W / 2);
  if (mid === null) return null;
  const minutes = W / 2 / 60_000;
  const scale = rankScale(info.get(id)!.source, DEFAULT_POLICY.rising.shortVideoReachScale);
  const speed = (f.views - mid) / scale / minutes;
  const before = (mid - start) / scale / minutes;
  /* Over the floor ranks by the ratio, above every post under it, which ranks by speed (core rank/post-sorts.ts). */
  if (speed < DEFAULT_POLICY.rising.forYouSorts.trendFloorPerMin) return speed - Number.MAX_SAFE_INTEGER;
  return before > 0 ? speed / before : Number.MAX_SAFE_INTEGER;
}

function inOrder(list: readonly string[], by: SortBy, w: SortWindow): string {
  const keys = list.map((id) => truth(id, by, w));
  const known = keys.map((k, i) => ({ k, i })).filter((x): x is { k: number; i: number } => x.k !== null);
  const freshRank = [...known].sort((a, b) => b.k - a.k).map((x) => x.i);
  /* Longest run kept in order: the longest increasing subsequence of the fresh places. */
  const order = known.map((x) => freshRank.indexOf(x.i));
  const lis: number[] = [];
  for (const v of order) {
    let lo = 0;
    let hi = lis.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (lis[mid]! < v) lo = mid + 1;
      else hi = mid;
    }
    lis[lo] = v;
  }
  let pairs = 0;
  let agree = 0;
  for (let a = 0; a < known.length; a++) for (let b = a + 1; b < known.length; b++) { pairs++; if (known[a]!.k >= known[b]!.k) agree++; }
  const exact = order.filter((v, i) => v === i).length;
  return `${lis.length} of ${known.length} in order (exact places ${exact}, pairs ${agree}/${pairs})${known.length < list.length ? `; ${list.length - known.length} not re-read` : ''}`;
}

for (const name of chosen) {
  const [by, w] = LISTS[name]!;
  for (const [label, list] of [['before (served now)', served.get(name)!], ['after (this branch)', ours.get(name)!]] as const) {
    console.log(`\n${name} ${label}: ${inOrder(list, by, w)}`);
    list.forEach((id, i) => {
      const f = fresh.get(id);
      const k = truth(id, by, w);
      const sorted = list.map((x) => truth(x, by, w)).filter((x): x is number => x !== null).sort((a, b) => b - a);
      console.log(`  ${i + 1}. ${id}  fresh views ${f?.views ?? '-'}  ${k === null ? '-' : by === 'most_viewed' ? `gained ${Math.round(k)}` : k < 0 ? `under the floor, ${Math.round(k + Number.MAX_SAFE_INTEGER)}/min` : k === Number.MAX_SAFE_INTEGER ? 'ratio: from nothing' : `ratio ${k.toFixed(2)}`}  fresh place ${k === null ? '-' : sorted.indexOf(k) + 1}`);
    });
  }
}
console.log(`\nspent about $${spent.toFixed(4)} on the jobs' book (estimate $${estimate.toFixed(4)})`);
await pool.end();
