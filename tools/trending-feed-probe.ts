/**
 * `SPEND=live node --env-file=.env.local --experimental-strip-types tools/trending-feed-probe.ts --sample <pages.jsonl> [--rounds 9] [--every-min 15] [--regions US,GB] --yes`
 * `node --env-file=.env.local --experimental-strip-types tools/trending-feed-probe.ts --analyze <pages.jsonl>`
 *
 * THE TEST OF THE RECOMMENDATION FEED AS A FINDER (2026-10-15), before its switch
 * (Policy.finders.trending) is turned on. `--sample` reads one page a region every `--every-min`
 * minutes, `--rounds` times, through the adapter (adapters/platform/tiktok/src/trending-feed.ts) on the
 * learning book, and appends each page to the file. `--analyze` is free and read-only: for every video
 * seen, its age when first seen, its views and likes, whether its only tags are the generic ones (#fyp
 * and its kin), how many videos each page added that no earlier page had, how many we already held
 * from our own searches (public.item) and whether that was before the feed showed it, and whether a
 * coin has named it since (internal.coin_post_link).
 *
 * Its own tool because the question is whether the feed is worth paying for, and the answer has to be
 * measured on pages read over hours, not on one page.
 *
 * What breaks if changed carelessly: the sample is capped at 40 pages a run (one credit each), and a
 * video's age is from its own time to the FIRST page that showed it; a later page would make every
 * video look older than it was when we could have had it.
 */

import { appendFileSync, readFileSync } from 'node:fs';
import process from 'node:process';

import type { Millis } from '../contracts/src/index.ts';
import { tiktokPlatform, trendingFeedClient } from '../adapters/platform/tiktok/src/index.ts';
import type { TikTokClient } from '../adapters/platform/tiktok/src/index.ts';
import { DEFAULT_FEED_BASE_URL } from '../adapters/platform/tiktok/src/trending-feed.ts';
import { asDb, createPool, DB_ROLE } from '../store/src/index.ts';
import { openSharedMeter } from './lib/shared-meter.ts';

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};
const MAX_PAGES = 40;
const USD_PER_PAGE = 0.00188;
const HOUR = 3_600_000;
/* The tags that say nothing about a video: a video carrying only these is one no word search reaches. */
const GENERIC = new Set(['fyp', 'foryou', 'foryoupage', 'fypシ', 'fypシ゚viral', 'viral', 'trending', 'xyzbca', 'xyzabc', 'abcxyz', 'fypp', 'parati', 'blowthisup']);

interface Seen {
  readonly id: string;
  readonly handle: string | null;
  readonly postedAt: number | null;
  readonly views: number | null;
  readonly likes: number | null;
  readonly text: string;
}
interface Page {
  readonly at: number;
  readonly region: string;
  readonly videos: readonly Seen[];
}

const sampleFile = arg('--sample');
const analyzeFile = arg('--analyze');

if (sampleFile !== null) {
  if (process.env['SPEND'] !== 'live' || !process.argv.includes('--yes')) {
    console.error('trending-feed-probe refused: sampling costs a credit a page. Set SPEND=live and pass --yes.');
    process.exit(2);
  }
  const regions = (arg('--regions') ?? 'US,GB').split(',').map((r) => r.trim().toUpperCase()).filter((r) => r !== '');
  const rounds = Math.max(1, Math.trunc(Number(arg('--rounds') ?? '9')));
  const everyMin = Math.max(1, Number(arg('--every-min') ?? '15'));
  if (rounds * regions.length > MAX_PAGES) {
    console.error(`refused: ${rounds * regions.length} pages is over the cap of ${MAX_PAGES}`);
    process.exit(2);
  }
  const feed = trendingFeedClient({ apiKey: process.env['SCRAPECREATORS_API_KEY'] ?? '', baseUrl: DEFAULT_FEED_BASE_URL, fetch: globalThis.fetch });
  if (feed === null) {
    console.error('refused: SCRAPECREATORS_API_KEY is not set');
    process.exit(2);
  }
  const { meter, close } = await openSharedMeter(rounds * regions.length * USD_PER_PAGE + 0.01, process.env, 'learning');
  const adapter = tiktokPlatform({ client: {} as TikTokClient, feed, meter, now: () => Date.now() as Millis, handleOf: () => null });
  try {
    for (let r = 0; r < rounds; r++) {
      for (const region of regions) {
        const at = Date.now();
        try {
          const got = await adapter.trendingFeed!({ regions: [region] }, { capUsd: 1, spentUsd: 0, maxCalls: null, deadline: (at + 60_000) as Millis });
          const handles = new Map(got.value.authors.map((a) => [String(a.authorKey), a.handle ?? null]));
          const videos: Seen[] = got.value.items.map((i) => ({
            id: i.sourceItemId,
            handle: i.authorKey === null ? null : (handles.get(String(i.authorKey)) ?? null),
            postedAt: i.postedAt,
            views: i.counters.reach?.value ?? null,
            likes: i.counters.approval?.value ?? null,
            text: i.text,
          }));
          appendFileSync(sampleFile, JSON.stringify({ at, region, videos } satisfies Page) + '\n');
          console.log(`${new Date(at).toISOString()} ${region}: ${videos.length} videos`);
        } catch (e) {
          console.error(`${region}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (r < rounds - 1) await new Promise((s) => setTimeout(s, everyMin * 60_000));
    }
  } finally {
    console.log(`spent $${meter.spentUsd('scrapecreators').toFixed(4)} on the learning book`);
    await close();
  }
}

if (analyzeFile !== null) {
  const pages: Page[] = readFileSync(analyzeFile, 'utf8').trim().split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as Page);
  const first = new Map<string, { page: number; at: number; region: string; v: Seen }>();
  const newPerPage: string[] = [];
  pages.forEach((p, n) => {
    let added = 0;
    for (const v of p.videos) {
      if (first.has(v.id)) continue;
      first.set(v.id, { page: n, at: p.at, region: p.region, v });
      added += 1;
    }
    newPerPage.push(`${new Date(p.at).toISOString().slice(11, 16)} ${p.region} ${added}/${p.videos.length}`);
  });
  const all = [...first.values()];
  const ages = all.flatMap((s) => (s.v.postedAt === null ? [] : [(s.at - s.v.postedAt) / HOUR])).sort((a, b) => a - b);
  const q = (f: number) => (ages.length === 0 ? null : ages[Math.min(ages.length - 1, Math.floor(f * ages.length))] ?? null);
  const tagsOf = (t: string) => [...t.matchAll(/#([\p{L}\p{N}_゚シ]+)/gu)].map((m) => (m[1] ?? '').toLowerCase());
  const genericOnly = (t: string) => {
    const tags = tagsOf(t);
    return tags.length > 0 && tags.every((x) => GENERIC.has(x));
  };
  const h = (x: number | null) => (x === null ? '—' : `${x.toFixed(1)} h`);
  console.log(`# The recommendation feed, ${pages.length} pages, ${all.length} different videos`);
  console.log(`ages when first seen: p10 ${h(q(0.1))}, median ${h(q(0.5))}, p90 ${h(q(0.9))}; under 2 h: ${ages.filter((a) => a < 2).length}, under 6 h: ${ages.filter((a) => a < 6).length}, under 24 h: ${ages.filter((a) => a < 24).length}`);
  console.log(`new videos a page (new/returned): ${newPerPage.join(', ')}`);
  console.log(`tagged only with generic tags: ${all.filter((s) => genericOnly(s.v.text)).length}; no tag at all: ${all.filter((s) => tagsOf(s.v.text).length === 0).length}`);

  const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-trending-feed-probe' });
  const db = asDb(pool);
  try {
    const ids = all.map((s) => s.v.id);
    const held = await db.query<{ id: string; first_seen: Date }>(`select source_item_id as id, first_seen_at as first_seen from public.item where source = 'tiktok' and source_item_id = any($1)`, [ids]);
    const heldAt = new Map(held.map((r) => [r.id, new Date(r.first_seen).getTime()]));
    const before = all.filter((s) => (heldAt.get(s.v.id) ?? Infinity) < s.at);
    const coined = await db.query<{ id: string; minted: Date | null }>(`select source_item_id as id, min(minted_at) as minted from internal.coin_post_link where source = 'tiktok' and source_item_id = any($1) group by 1`, [ids]);
    const coinAt = new Map(coined.map((r) => [r.id, r.minted === null ? null : new Date(r.minted).getTime()]));
    console.log(`already held from our own searches: ${held.length} (${before.length} of them before the feed showed it)`);
    console.log(`named by a coin: ${coined.length}`);
    console.log();
    console.log('| first seen | region | age | views | likes | video | held before? | coin | caption |');
    console.log('|---|---|---|---|---|---|---|---|---|');
    for (const s of all.sort((a, b) => (a.v.postedAt === null ? Infinity : a.at - a.v.postedAt) - (b.v.postedAt === null ? Infinity : b.at - b.v.postedAt))) {
      const coin = coinAt.get(s.v.id);
      const heldAtMs = heldAt.get(s.v.id);
      console.log(`| ${new Date(s.at).toISOString().slice(11, 16)} | ${s.region} | ${s.v.postedAt === null ? '—' : h((s.at - s.v.postedAt) / HOUR)} | ${s.v.views ?? '—'} | ${s.v.likes ?? '—'} | ${s.v.id} @${s.v.handle ?? '—'} | ${heldAtMs === undefined ? 'no' : heldAtMs < s.at ? 'yes' : 'after'} | ${coin === undefined ? '—' : coin === null ? 'yes, launch unknown' : new Date(coin).toISOString().slice(0, 16)} | ${s.v.text.replace(/\s+/g, ' ').replace(/\|/g, '/').slice(0, 60)} |`);
    }
  } finally {
    await pool.end();
  }
}

if (sampleFile === null && analyzeFile === null) {
  console.error('usage: --sample <pages.jsonl> [--rounds n] [--every-min m] [--regions US,GB] --yes, or --analyze <pages.jsonl>');
  process.exit(2);
}
