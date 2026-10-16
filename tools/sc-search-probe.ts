/**
 * `SPEND=live node --env-file=.env.local --experimental-strip-types tools/sc-search-probe.ts --out <file.jsonl> [--words meme,dog] [--pages 3] [--sounds id,id] [--creators h,h] [--videos url,url] --yes`
 *
 * THE TEST OF THE SECOND VENDOR AS THE SHORT-VIDEO SOURCE'S SEARCH AND RE-READ (2026-10-16), before the
 * runner is moved onto it (Policy.feed.secondVendor). For each word it walks the newest-first keyword
 * search `--pages` pages and prints, a page at a time, how many videos came back, how old the newest
 * and oldest were and how many we already held; then a sound's videos, a creator's latest and single
 * videos by link, each the same way. Every page is appended raw to `--out`, so a shape question is
 * answered from the file without paying again.
 *
 * Its own tool because the questions — how many minutes of posting one page covers, whether the order
 * is really newest first, whether a re-read by link answers live — decide the cadence and the cost
 * of the switch, and they have to be measured on the vendor, not read off its docs.
 *
 * What breaks if changed carelessly: the cap. Every request is a credit (`MAX_CREDITS` a run, on the
 * learning book), and the owner's allowance for these tests is 40 credits in all.
 */

import { appendFileSync } from 'node:fs';
import process from 'node:process';

import { metered } from '../adapters/meter/spend/src/index.ts';
import { DEFAULT_FEED_BASE_URL } from '../adapters/platform/tiktok/src/trending-feed.ts';
import { scClient, SC_PRICES, SC_VENDOR, type ScPage } from '../adapters/platform/tiktok/src/scrapecreators.ts';
import { fromSearchActor } from '../adapters/platform/tiktok/src/search-actor.ts';
import { asDb, createPool, DB_ROLE } from '../store/src/index.ts';
import { openSharedMeter } from './lib/shared-meter.ts';

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};
const list = (name: string): string[] => (arg(name) ?? '').split(',').map((s) => s.trim()).filter((s) => s !== '');
const MAX_CREDITS = 25;
const USD_PER_CREDIT = 0.00188;

if (process.env['SPEND'] !== 'live' || !process.argv.includes('--yes')) {
  console.error('sc-search-probe refused: each request costs a credit. Set SPEND=live and pass --yes.');
  process.exit(2);
}
const out = arg('--out');
if (out === null) {
  console.error('refused: --out <file.jsonl> is required');
  process.exit(2);
}
const words = list('--words');
const pages = Math.max(1, Math.trunc(Number(arg('--pages') ?? '2')));
const sounds = list('--sounds');
const creators = list('--creators');
const videos = list('--videos');
const credits = words.length * pages + sounds.length + creators.length + videos.length;
if (credits > MAX_CREDITS) {
  console.error(`refused: ${credits} requests is over the cap of ${MAX_CREDITS}`);
  process.exit(2);
}
const client = scClient({ apiKey: process.env['SCRAPECREATORS_API_KEY'] ?? '', baseUrl: DEFAULT_FEED_BASE_URL, fetch: globalThis.fetch });
if (client === null) {
  console.error('refused: SCRAPECREATORS_API_KEY is not set');
  process.exit(2);
}

const { meter, close } = await openSharedMeter(credits * USD_PER_CREDIT + 0.01, process.env, 'learning');
const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-sc-probe' });
const db = asDb(pool);

interface Row {
  readonly id: string;
  readonly createTime: number | null;
  readonly views: number | null;
}
const rowOf = (raw: unknown): Row | null => {
  const m = fromSearchActor(raw) as Record<string, unknown>;
  return typeof m['id'] === 'string' ? { id: m['id'], createTime: typeof m['createTime'] === 'number' ? m['createTime'] : null, views: typeof m['playCount'] === 'number' ? m['playCount'] : null } : null;
};

async function call<T>(endpoint: string, what: string, f: () => Promise<T>): Promise<T | null> {
  const at = Date.now();
  try {
    const r = await metered(meter, SC_PRICES, { vendor: SC_VENDOR, endpoint, unit: 'per-call', estUnits: 1, at }, async () => {
      const v = await f();
      return { value: v, units: 1 };
    });
    return r.value;
  } catch (e) {
    console.error(`${what}: ${e instanceof Error ? e.message : String(e)} (${Date.now() - at} ms)`);
    appendFileSync(out!, JSON.stringify({ at, what, error: e instanceof Error ? e.message : String(e) }) + '\n');
    return null;
  }
}

async function describe(what: string, page: ScPage | null, at: number, ms: number): Promise<void> {
  if (page === null) return;
  appendFileSync(out!, JSON.stringify({ at, what, ms, cursor: page.cursor, credits: page.creditsCharged, items: page.items }) + '\n');
  const rows = page.items.map(rowOf).filter((r): r is Row => r !== null);
  const ages = rows.flatMap((r) => (r.createTime === null ? [] : [(at / 1000 - r.createTime) / 60])).sort((a, b) => a - b);
  const held = rows.length === 0 ? [] : await db.query<{ id: string }>(`select source_item_id as id from public.item where source = 'tiktok' and source_item_id = any($1)`, [rows.map((r) => r.id)]);
  const order = rows.every((r, i) => i === 0 || (rows[i - 1]!.createTime ?? 0) >= (r.createTime ?? 0)) ? 'newest first' : 'not in time order';
  const m = (x: number | undefined) => (x === undefined ? '—' : `${Math.round(x)} min`);
  console.log(`${what}: ${rows.length} videos in ${ms} ms, ${order}; age ${m(ages[0])} to ${m(ages[ages.length - 1])}, median ${m(ages[Math.floor(ages.length / 2)])}; under 60 min ${ages.filter((a) => a < 60).length}; held already ${held.length}; credits ${page.creditsCharged ?? '?'}; next cursor ${page.cursor ?? 'none'}`);
}

try {
  for (const w of words) {
    let cursor: string | null = null;
    for (let p = 0; p < pages; p++) {
      const at = Date.now();
      const page: ScPage | null = await call('search', `search "${w}" page ${p + 1}`, () => client.search(w, cursor));
      await describe(`search "${w}" page ${p + 1}`, page, at, Date.now() - at);
      if (page === null || page.cursor === null) break;
      cursor = page.cursor;
    }
  }
  for (const s of sounds) {
    const at = Date.now();
    await describe(`sound ${s}`, await call('sound', `sound ${s}`, () => client.sound(s)), at, Date.now() - at);
  }
  for (const h of creators) {
    const at = Date.now();
    await describe(`creator @${h}`, await call('profile', `creator @${h}`, () => client.profile(h)), at, Date.now() - at);
  }
  for (const u of videos) {
    const at = Date.now();
    const v = await call('video', `video ${u}`, () => client.video(u));
    if (v === null) continue;
    appendFileSync(out, JSON.stringify({ at, what: `video ${u}`, credits: v.creditsCharged, item: v.item }) + '\n');
    const r = v.item === null ? null : rowOf(v.item);
    console.log(`video ${u}: ${r === null ? 'no video in the answer' : `${r.views ?? '—'} views, ${r.createTime === null ? '—' : Math.round((at / 1000 - r.createTime) / 60)} min old`} in ${Date.now() - at} ms; credits ${v.creditsCharged ?? '?'}`);
  }
} finally {
  console.log(`spent $${meter.spentUsd(SC_VENDOR).toFixed(4)} on the learning book (${credits} requests at most)`);
  await close();
  await pool.end();
}
