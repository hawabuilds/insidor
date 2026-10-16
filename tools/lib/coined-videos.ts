/**
 * THE TIKTOK TRAINING SET — composed, filled out, and learned from (the owner, 2026-10-16: "build a
 * TikTok training set from every coined TikTok … add every new one straight away … learn separately
 * for TikTok").
 *
 *   composeSet   every coined TikTok from every place one is recorded: the coins whose links name it
 *                (internal.coin_post_link), the owner's confirmed coins and missed posts, the
 *                founders' backtest 2 and 3 sheets (eval/src/gold/coin-origins.json, which is those
 *                sheets cleaned, every short link resolved), and gold additions. Each with its FIRST
 *                coin (the earliest launch: copycats come later), the coin's name and ticker, the
 *                highest market cap we read, its caption, tags, sound, creator, the judge's kind,
 *                and its views at 30 minutes, 1 and 2 hours from our own readings only. Free.
 *   refetch      the ones we never held, read again by id through ScrapeCreators (one credit each,
 *                on the learning book, capped by the caller): caption, tags, sound, creator, views
 *                now. A video the source no longer serves is 'gone' and is still learned from by its
 *                coin's name and what its link says. Kept in var/ as well, so a run before 0085 does
 *                not pay twice.
 *   learn        what the set says: the speed bar's views at each age (and a proposed bar once
 *                enough coined videos had early readings), the tags, sounds and creators counted by
 *                the runner's own `learnWords`, the kinds of video, and how people name coins from
 *                them.
 *
 * Shared by the re-tune (tools/retune.ts), the training-set tool (tools/coined-videos.ts), the
 * backtest (tools/tiktok-backtest.ts) and the side-by-side table (tools/lib/side-by-side.ts), so
 * all four read the same set.
 *
 * ★ A VIEW COUNT AT AN AGE IS A READING, NOT A GUESS. It is interpolated only between two of our
 * readings (the post itself counts as 0 views at 0 minutes) no further apart than
 * Policy.learning.shortVideo.readingGapMs. A video we first read a day old has no 30-minute count;
 * it is a dash, never its average rate scaled down.
 *
 * What breaks if changed carelessly: the first coin. Taking any coin but the earliest launch would
 * call a copycat the post's coin and move every lead time and every "before the coin".
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { DEFAULT_POLICY, type Policy } from '../../contracts/src/policy.ts';
import type { Meter } from '../../contracts/src/ports/meter.ts';
import type { Millis } from '../../contracts/src/vocabulary.ts';
import { clearsReachBar, type ReachLevel } from '../../core/src/qualify/reach-bar.ts';
import { postTimeFromId } from '../../adapters/platform/tiktok/src/post-time.ts';
import { learnWords } from '../../services/runner/src/work/search-words.ts';
import { CURRENT_COIN_CALLS, PgCoinedVideoRepo, type CoinedVideo, type Db } from '../../store/src/index.ts';

const SOURCE = 'tiktok';
const ORIGINS = new URL('../../eval/src/gold/coin-origins.json', import.meta.url);
/* Re-fetched videos, kept on disk too: the table may not exist yet, and a credit is paid once. */
export const FETCH_CACHE = 'var/coined-videos-fetched.json';
const SC_BASE = 'https://api.scrapecreators.com';
const SC_VENDOR = 'scrapecreators';
const SC_ENDPOINT = 'video';
/* One credit, at the dearer pack (adapters/platform/tiktok/src/trending-feed.ts FEED_USD_PER_CREDIT). */
export const SC_USD_PER_VIDEO = 0.001_88;
const SC_TIMEOUT_MS = 30_000;
const TAG = /#([\p{L}\p{N}_]+)/gu;
const LINK = /tiktok\.com\/@([A-Za-z0-9_.]+)\/(?:video|photo)\/(\d{8,25})/;

const missing = (e: unknown): boolean => typeof e === 'object' && e !== null && ['42P01', '42703'].includes(String((e as { code?: unknown }).code));
const soft = async <T>(read: () => Promise<T[]>): Promise<T[]> => {
  try {
    return await read();
  } catch (e) {
    if (missing(e)) return [];
    throw e;
  }
};

export const tagsOf = (caption: string): readonly string[] => [...new Set([...caption.matchAll(TAG)].map((m) => (m[1] ?? '').toLowerCase()).filter((t) => t !== ''))];

/* ── views at an age, from our readings only ─────────────────────────────────────────────────── */

export interface Reading {
  readonly atMs: number;
  readonly views: number;
}

/**
 * Views at `ageMin` after the post, between the two readings that bracket it (the post itself is
 * 0 views at 0) when they are at most `gapMs` apart; null otherwise. A reading at the age exactly
 * is that reading.
 */
export function viewsAt(postedMs: number, readings: readonly Reading[], ageMin: number, gapMs: number): number | null {
  const t = postedMs + ageMin * 60_000;
  const pts = [{ atMs: postedMs, views: 0 }, ...readings.filter((r) => r.atMs > postedMs)].sort((a, b) => a.atMs - b.atMs);
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1];
    const b = pts[i];
    if (a === undefined || b === undefined || b.atMs < t || a.atMs > t) continue;
    if (b.atMs === t) return b.views;
    if (b.atMs - a.atMs > gapMs) return null;
    return a.views + ((b.views - a.views) * (t - a.atMs)) / (b.atMs - a.atMs);
  }
  return null;
}

/* ── the set ─────────────────────────────────────────────────────────────────────────────────── */

interface SheetOrigin {
  readonly id: string;
  readonly sheet: string;
  readonly mint: string;
  readonly ticker: string | null;
  readonly name: string | null;
  readonly description: string | null;
  readonly createdAt: string | null;
  readonly origin: { readonly platform?: string; readonly url?: string; readonly postId?: string } | null;
}

/** The founders' sheet rows whose origin is a TikTok (backtest 2 and 3), as the gold set cleaned them. */
export function sheetVideos(): readonly SheetOrigin[] {
  const rows = JSON.parse(readFileSync(ORIGINS, 'utf8')) as SheetOrigin[];
  return rows.filter((r) => r.origin?.platform === SOURCE && typeof r.origin.postId === 'string' && /^backtest[23]$/.test(r.sheet));
}

interface Fetched {
  readonly itemId: string;
  readonly at: string;
  readonly gone: boolean;
  readonly caption: string | null;
  readonly tags: readonly string[];
  readonly handle: string | null;
  readonly postedAtMs: number | null;
  readonly sound: string | null;
  readonly soundTitle: string | null;
  readonly views: number | null;
}

export function readFetchCache(path = FETCH_CACHE): Map<string, Fetched> {
  if (!existsSync(path)) return new Map();
  return new Map((JSON.parse(readFileSync(path, 'utf8')) as Fetched[]).map((f) => [f.itemId, f]));
}

function writeFetchCache(cache: ReadonlyMap<string, Fetched>, path = FETCH_CACHE): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify([...cache.values()], null, 1));
}

/** Our reach readings for these posts, oldest first. */
export async function readingsOf(db: Db, itemIds: readonly string[]): Promise<Map<string, Reading[]>> {
  const out = new Map<string, Reading[]>();
  if (itemIds.length === 0) return out;
  const rows = await db.query<{ item_id: string; captured_at: Date; value: number }>(
    `select item_id, captured_at, value from public.observation where kind = 'reach' and value is not null and item_id = any($1::text[]) order by captured_at`,
    [itemIds],
  );
  for (const r of rows) {
    const list = out.get(r.item_id) ?? [];
    list.push({ atMs: r.captured_at.getTime(), views: Number(r.value) });
    out.set(r.item_id, list);
  }
  return out;
}

interface Claim {
  readonly address: string;
  readonly launchedMs: number | null;
  readonly from: string;
  readonly link: string | null;
  readonly name?: string | null;
  readonly ticker?: string | null;
}

/**
 * Every coined TikTok, composed from every place one is recorded (see the header). Free: database
 * reads, the gold file and the re-fetch cache. `fetched` overrides the cache (a run's own fetches).
 */
export async function composeSet(db: Db, p: Policy = DEFAULT_POLICY, fetched: ReadonlyMap<string, Fetched> = readFetchCache()): Promise<CoinedVideo[]> {
  const claims = new Map<string, Claim[]>();
  const claim = (itemId: string, c: Claim) => claims.set(itemId, [...(claims.get(itemId) ?? []), c]);

  for (const l of await soft(() => db.query<{ source_item_id: string; address: string; minted_at: Date | null; link: string }>(
    `select source_item_id, address, minted_at, link from internal.coin_post_link where source = $1`, [SOURCE]))) {
    claim(`${SOURCE}:${l.source_item_id}`, { address: l.address, launchedMs: l.minted_at?.getTime() ?? null, from: 'link', link: l.link });
  }
  for (const o of await soft(() => db.query<{ item_id: string; coin_address: string }>(
    `select item_id, coin_address from (${CURRENT_COIN_CALLS}) c where c.verdict = 'right' and c.coin_address is not null and c.item_id like $1`, [`${SOURCE}:%`]))) {
    claim(o.item_id, { address: o.coin_address, launchedMs: null, from: 'owner', link: null });
  }
  const missedIds = new Set((await soft(() => db.query<{ item_id: string; coin_address: string | null }>(
    `select item_id, coin_address from internal.missed_post where source = $1 and item_id is not null`, [SOURCE]))).map((m) => {
    if (m.coin_address !== null) claim(m.item_id, { address: m.coin_address, launchedMs: null, from: 'missed', link: null });
    return m.item_id;
  }));
  for (const s of sheetVideos()) {
    const id = `${SOURCE}:${s.origin?.postId ?? ''}`;
    claim(id, { address: s.mint, launchedMs: s.createdAt === null ? null : Date.parse(s.createdAt), from: `sheet:${s.sheet}`, link: s.origin?.url ?? null, name: s.name, ticker: s.ticker });
  }
  for (const g of await soft(() => db.query<{ item_id: string; coin_mint: string | null; launched_at: Date | null }>(
    `select item_id, coin_mint, launched_at from internal.gold_addition where item_id like $1 and coin_mint is not null`, [`${SOURCE}:%`]))) {
    if (g.coin_mint !== null) claim(g.item_id, { address: g.coin_mint, launchedMs: g.launched_at?.getTime() ?? null, from: 'gold', link: null });
  }
  /* The missed posts carry no coin of their own: they are in the set by the owner's confirmed coin, and say so. */
  for (const id of missedIds) {
    const c = claims.get(id);
    if (c !== undefined && !c.some((x) => x.from === 'missed')) claims.set(id, [...c, { ...c[0]!, from: 'missed' }]);
  }

  const ids = [...claims.keys()];
  const addresses = [...new Set([...claims.values()].flat().map((c) => c.address))];
  const coins = new Map((await db.query<{ address: string; launched: Date | null; name: string | null; ticker: string | null; peak: number | null }>(
    `select x.address, coalesce(a.minted_at, n.launched_at) as launched, coalesce(n.name, a.name) as name, coalesce(n.ticker, a.symbol) as ticker,
            (select max(m.market_cap_usd) from public.market_reading m where m.asset_key = a.asset_key and m.market_cap_usd is not null) as peak
       from unnest($1::text[]) x(address)
       left join public.asset a on a.chain = 'solana' and a.address = x.address
       left join public.coin_name n on n.address = x.address`, [addresses])).map((r) => [r.address, r]));
  const items = new Map((await db.query<{ item_id: string; posted_at: Date | null; body: string | null; format_ids: string[] | null; handle: string | null }>(
    `select i.item_id, i.posted_at, i.body, i.format_ids, a.handle from public.item i left join public.author a on a.author_key = i.author_key where i.item_id = any($1::text[])`, [ids])).map((r) => [r.item_id, r]));
  const kinds = new Map((await db.query<{ item_id: string; kind: string | null }>(
    `select distinct on (item_id) item_id, proposed_name as kind from internal.post_judgement where prompt_id like 'post-kind%' and item_id = any($1::text[]) order by item_id, judged_at desc`, [ids])).map((r) => [r.item_id, r.kind]));
  const readings = await readingsOf(db, ids);
  const sv = p.learning.shortVideo;
  const [m30, m60, m120] = [sv.barAgesMin[0] ?? 30, sv.barAgesMin[1] ?? 60, sv.barAgesMin[2] ?? 120];

  return ids.map((itemId): CoinedVideo => {
    const sourceItemId = itemId.slice(SOURCE.length + 1);
    const cs = (claims.get(itemId) ?? []).map((c) => ({ ...c, launchedMs: c.launchedMs ?? coins.get(c.address)?.launched?.getTime() ?? null }));
    /* The first coin: the earliest launch we know; a claim with no launch time only when none has one. */
    const first = [...cs].sort((a, b) => (a.launchedMs ?? Infinity) - (b.launchedMs ?? Infinity) || a.address.localeCompare(b.address))[0]!;
    const coin = coins.get(first.address);
    const item = items.get(itemId);
    const f = fetched.get(itemId);
    const linkHandle = cs.map((c) => (c.link === null ? null : LINK.exec(c.link)?.[1] ?? null)).find((h) => h !== null) ?? null;
    const caption = item?.body ?? (f?.gone === false ? f.caption : null) ?? null;
    const postedMs = item?.posted_at?.getTime() ?? f?.postedAtMs ?? postTimeFromId(sourceItemId);
    const rs = readings.get(itemId) ?? [];
    const firstRead = postedMs === null ? undefined : rs.find((r) => r.atMs > postedMs);
    const at = (age: number) => (postedMs === null ? null : viewsAt(postedMs, rs, age, sv.readingGapMs));
    const latest = Math.max(...rs.map((r) => r.views), f?.views ?? Number.NEGATIVE_INFINITY);
    const sound = item?.format_ids?.find((x) => x.includes(':sound:')) ?? f?.sound ?? null;
    return {
      itemId, source: SOURCE, sourceItemId,
      handle: item?.handle ?? f?.handle ?? linkHandle,
      postedAt: postedMs === null ? null : new Date(postedMs),
      caption, tags: caption === null ? (f?.tags ?? []) : [...new Set([...tagsOf(caption), ...(f?.tags ?? [])])],
      sound, soundTitle: f?.soundTitle ?? null,
      kind: kinds.get(itemId) ?? null,
      firstCoin: first.address,
      firstCoinAt: first.launchedMs === null ? null : new Date(first.launchedMs),
      coinName: coin?.name ?? first.name ?? null,
      coinTicker: coin?.ticker ?? first.ticker ?? null,
      coins: new Set(cs.map((c) => c.address)).size,
      peakUsd: coin?.peak ?? null,
      foundFrom: [...new Set(cs.map((c) => c.from))].sort(),
      views30m: at(m30), views1h: at(m60), views2h: at(m120),
      firstReadMin: firstRead === undefined || postedMs === null ? null : (firstRead.atMs - postedMs) / 60_000,
      firstReadViews: firstRead?.views ?? null,
      latestViews: Number.isFinite(latest) ? latest : null,
      fetch: item !== undefined ? 'held' : f === undefined ? 'unfetched' : f.gone ? 'gone' : 'fetched',
      fetchedAt: f === undefined ? null : new Date(f.at),
    };
  });
}

/** Composes the set and writes it to 0085. The rows written, the new ones, and whether the table exists. */
export async function refreshSet(db: Db, now: Date, p: Policy = DEFAULT_POLICY): Promise<{ readonly rows: readonly CoinedVideo[]; readonly added: number; readonly stored: boolean }> {
  const rows = await composeSet(db, p);
  const repo = new PgCoinedVideoRepo(db);
  const stored = await repo.present();
  const added = stored ? await repo.put(rows, now) : 0;
  return { rows, added, stored };
}

/* ── the re-fetch ────────────────────────────────────────────────────────────────────────────── */

const rec = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null);

/** One video's answer from ScrapeCreators' single-video endpoint, in the set's terms; `gone` when it has none. */
export function fromVideoAnswer(itemId: string, body: unknown, at: Date): Fetched {
  const d = rec(rec(body).aweme_detail);
  const caption = str(d.desc);
  if (str(d.aweme_id) === null && caption === null) return { itemId, at: at.toISOString(), gone: true, caption: null, tags: [], handle: null, postedAtMs: null, sound: null, soundTitle: null, views: null };
  const listed = (Array.isArray(d.text_extra) ? d.text_extra : []).map((t) => /^[\p{L}\p{N}_]+/u.exec(str(rec(t).hashtag_name)?.toLowerCase() ?? '')?.[0] ?? null).filter((t): t is string => t !== null);
  const music = rec(d.music);
  const musicId = str(music.id_str) ?? (num(music.id) === null ? null : String(music.id));
  const created = num(d.create_time);
  return {
    itemId, at: at.toISOString(), gone: false, caption,
    tags: [...new Set([...listed, ...tagsOf(caption ?? '')])],
    handle: str(rec(d.author).unique_id),
    postedAtMs: created === null ? null : created * 1_000,
    sound: musicId === null ? null : `${SOURCE}:sound:${musicId}`,
    soundTitle: str(music.title),
    views: num(rec(d.statistics).play_count),
  };
}

/**
 * Reads again, by id, up to `max` of the set's videos we never held and never asked for, owner's and
 * sheet's first, then the newest coined. One credit each on `meter` (the learning book); stops at
 * the first refusal. Writes the cache. The number asked and the dollars.
 */
export async function refetch(rows: readonly CoinedVideo[], max: number, meter: Meter, apiKey: string, now: () => Date = () => new Date()): Promise<{ readonly asked: number; readonly gone: number; readonly usd: number; readonly fetched: Map<string, Fetched> }> {
  const cache = readFetchCache();
  const rank = (v: CoinedVideo) => (v.foundFrom.some((f) => f === 'owner' || f === 'missed') ? 0 : v.foundFrom.some((f) => f.startsWith('sheet:')) ? 1 : 2);
  const want = rows
    .filter((v) => v.fetch === 'unfetched' && !cache.has(v.itemId))
    .sort((a, b) => rank(a) - rank(b) || (b.firstCoinAt?.getTime() ?? 0) - (a.firstCoinAt?.getTime() ?? 0))
    .slice(0, Math.max(0, max));
  let asked = 0;
  let gone = 0;
  for (const v of want) {
    if (apiKey === '' || !meter.mayspend(SC_VENDOR, SC_USD_PER_VIDEO)) break;
    const url = `https://www.tiktok.com/@${v.handle ?? 'i'}/video/${v.sourceItemId}`;
    const res = await fetch(`${SC_BASE}/v2/tiktok/video?url=${encodeURIComponent(url)}`, { headers: { 'x-api-key': apiKey, accept: 'application/json' }, signal: AbortSignal.timeout(SC_TIMEOUT_MS) });
    if (res.status === 402) break;
    if (res.status >= 500) continue; // not charged (trending-feed.ts measured the same); tried next run
    asked += 1;
    meter.record({ vendor: SC_VENDOR, endpoint: SC_ENDPOINT, unit: 'per-call', units: 1, usd: SC_USD_PER_VIDEO, at: Date.now() as Millis });
    const body = res.ok ? await res.json().catch(() => null) : null;
    const f = fromVideoAnswer(v.itemId, body, now());
    if (f.gone) gone += 1;
    cache.set(v.itemId, f);
  }
  writeFetchCache(cache);
  return { asked, gone, usd: asked * SC_USD_PER_VIDEO, fetched: cache };
}

/* ── what the set teaches ────────────────────────────────────────────────────────────────────── */

const quantile = (xs: readonly number[], q: number): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))] ?? null;
};
const median = (xs: readonly number[]) => quantile(xs, 0.5);

export interface LearnedBar {
  /** Coined videos with a count at each age, and the median count. */
  readonly at: readonly { readonly ageMin: number; readonly n: number; readonly medianViews: number | null }[];
  /** Coined videos read under two hours old at least once. */
  readonly earlyRead: number;
  /** Views a minute at the first reading inside the fast window, of each coined video read in it. */
  readonly firstRatePerMin: readonly number[];
  /** The bar proposed from them (null: fewer than `minEarlyCoined`, the bar in use stays). */
  readonly proposed: { readonly earlyReach: number; readonly fastReachPerMinute: number } | null;
  readonly why: string;
}

export interface Learned {
  readonly size: number;
  readonly withWords: number;
  readonly bySource: Record<string, number>;
  readonly byFetch: Record<string, number>;
  readonly bar: LearnedBar;
  readonly tags: readonly { readonly value: string; readonly posts: number }[];
  readonly sounds: readonly { readonly value: string; readonly posts: number; readonly title: string | null }[];
  readonly creators: readonly { readonly value: string; readonly posts: number }[];
  readonly kinds: Record<string, number>;
  readonly naming: Record<string, number>;
}

/** How a coin's name relates to its video: the words people take. */
export function namingOf(v: CoinedVideo): string {
  const key = (s: string | null) => (s ?? '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '');
  const name = key(v.coinName);
  const ticker = key(v.coinTicker);
  if (name === '' && ticker === '') return 'no name read';
  const words = (s: string | null) => (s ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3).map(key);
  /* A word of the video IS the name or the ticker, or the name contains it: 'batfish' for $BATFISH, 'raccoon' in "Raccoon Bandit". */
  const hit = (pool: readonly string[]) => pool.some((w) => (w.length >= 3 && (w === ticker || w === name)) || (w.length >= 4 && name.includes(w)));
  if (v.caption === null) return v.handle !== null && hit([key(v.handle)]) ? 'the creator' : 'words unknown (never held)';
  if (hit(v.tags.map(key))) return 'a hashtag';
  if (hit(words(v.caption))) return 'a word of the caption';
  if (v.handle !== null && hit([key(v.handle)])) return 'the creator';
  if (hit(words(v.soundTitle))) return 'the sound';
  return 'none of its words (the picture or the subject)';
}

/** The speed bar the set supports, against `p.rising` in use. Pure. */
export function learnBar(rows: readonly CoinedVideo[], readings: ReadonlyMap<string, readonly Reading[]>, p: Policy): LearnedBar {
  const sv = p.learning.shortVideo;
  const at = sv.barAgesMin.map((ageMin, i) => {
    const xs = rows.map((r) => [r.views30m, r.views1h, r.views2h][i] ?? null).filter((x): x is number => x !== null);
    return { ageMin, n: xs.length, medianViews: median(xs) };
  });
  const fastMs = p.rising.shortVideoFastWindowMs;
  const early = rows.filter((r) => r.firstReadMin !== null && r.firstReadMin <= (sv.barAgesMin.at(-1) ?? 120));
  const firstRatePerMin = rows.flatMap((r) => {
    const posted = r.postedAt?.getTime();
    if (posted === undefined) return [];
    const x = (readings.get(r.itemId) ?? []).find((y) => y.atMs > posted && y.atMs - posted <= fastMs);
    return x === undefined ? [] : [x.views / ((x.atMs - posted) / 60_000)];
  });
  const twoHour = rows.map((r) => r.views2h).filter((x): x is number => x !== null);
  if (early.length < sv.minEarlyCoined || twoHour.length === 0 || firstRatePerMin.length === 0) {
    return { at, earlyRead: early.length, firstRatePerMin, proposed: null, why: `${early.length} coined videos read under ${sv.barAgesMin.at(-1) ?? 120} minutes old, ${sv.minEarlyCoined} needed: the bar in use stays` };
  }
  const q = 1 - sv.barCatchShare;
  const proposed = { earlyReach: Math.round(quantile(twoHour, q) ?? 0), fastReachPerMinute: Math.round(quantile(firstRatePerMin, q) ?? 0) };
  return { at, earlyRead: early.length, firstRatePerMin, proposed, why: `the ${Math.round(sv.barCatchShare * 100)}% of ${early.length} coined videos read early` };
}

/** Everything the set teaches. Pure but for `readings` (pass `readingsOf`). */
export function learn(rows: readonly CoinedVideo[], readings: ReadonlyMap<string, readonly Reading[]>, p: Policy = DEFAULT_POLICY): Learned {
  const count = (xs: readonly string[]) => xs.reduce<Record<string, number>>((m, x) => ({ ...m, [x]: (m[x] ?? 0) + 1 }), {});
  const posts = rows.map((r) => ({ source: r.source, handle: r.handle, body: [r.caption ?? '', ...r.tags.filter((t) => !(r.caption ?? '').toLowerCase().includes(`#${t}`)).map((t) => `#${t}`)].join(' '), formatIds: r.sound === null ? [] : [r.sound] }));
  const words = learnWords(posts, SOURCE, p);
  const soundTitle = new Map(rows.flatMap((r) => (r.sound === null || r.soundTitle === null ? [] : [[r.sound, r.soundTitle] as const])));
  const n = (w: { facts: Record<string, unknown> | null }) => Number(w.facts?.['coinedPosts'] ?? 0);
  return {
    size: rows.length,
    withWords: rows.filter((r) => r.caption !== null).length,
    bySource: count(rows.flatMap((r) => r.foundFrom)),
    byFetch: count(rows.map((r) => r.fetch)),
    bar: learnBar(rows, readings, p),
    tags: words.filter((w) => w.kind === 'tag').map((w) => ({ value: w.value, posts: n(w) })),
    sounds: words.filter((w) => w.kind === 'sound').map((w) => ({ value: w.value, posts: n(w), title: soundTitle.get(w.value) ?? null })),
    creators: words.filter((w) => w.kind === 'creator').map((w) => ({ value: w.value, posts: n(w) })),
    kinds: count(rows.map((r) => r.kind ?? 'not judged')),
    naming: count(rows.map(namingOf)),
  };
}

/* ── the speed bar replayed ──────────────────────────────────────────────────────────────────── */

/** `p` with the short-video speed bar set to `bar` (on). */
export const withBar = (p: Policy, bar: { readonly earlyReach: number; readonly fastReachPerMinute: number }): Policy =>
  ({ ...p, rising: { ...p.rising, shortVideoSpeedBar: { enabled: true, earlyReach: bar.earlyReach, fastReachPerMinute: bar.fastReachPerMinute } } });

/** Whether a video's readings clear For You's bar under `p` (core `clearsReachBar`, the source's scale). */
export function clearsBar(readings: readonly Reading[], postedMs: number | null, p: Policy): boolean {
  const levels: ReachLevel[] = readings.map((r) => ({ atMs: r.atMs, reach: r.views }));
  return clearsReachBar('fyp', levels, postedMs, p, p.rising.shortVideoReachScale);
}
