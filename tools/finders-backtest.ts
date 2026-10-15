/**
 * `node --env-file=.env.local --experimental-strip-types tools/finders-backtest.ts [--days <n>] [--links <followed.json>] [--trend <tags.txt>] [--out <file.md>]`
 *
 * WOULD THE FINDERS HAVE SHOWN IT BEFORE THE COIN? Every short video coined in the last `--days`
 * (default 3; a coin's metadata named it, or the owner confirmed its coin) and the owner's missed
 * videos, each against each finder (Policy.finders), from what we hold. Free and read-only.
 *
 *   coin links   found at the first coin's launch plus the step's seconds: never ahead of the coin,
 *                by its nature. Counted so the owner sees what it adds to the feed, not to lead.
 *   reposts      the earliest text post we held that links the video, by its shortened link
 *                followed (`--links`: a JSON map of short link → {id, at, to}, made by following
 *                the held posts' links once; without it the internal.short_link record is read)
 *   creators     the video's creator had a coined video before this one was posted (learned
 *                creators); found within `creators.askEveryMs` of posting, at best
 *   learned tags a tag on the video was on `learned.minPosts` coined posts before it was posted;
 *                only for videos we hold, since a video's tags are in its text
 *   trend tags   a tag on the video is in `--trend` (one per line: today's trend list); a list
 *                read today says nothing about days ago, so this is an upper bound
 *
 * Each "found at" is compared with the first coin: positive minutes are lead. The table at the
 * end ranks the finders by coined videos found ahead per dollar a day (the costs are the ones
 * measured for the switch-on table on 2026-10-15, passed in `COSTS` below).
 *
 * What breaks if changed carelessly: a finder that would have found a video only after its coin is
 * not "caught" here. Counting it would credit the coin-link finder with every coined video, which
 * is true and says nothing about finding them first.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

import { DEFAULT_POLICY as P } from '../contracts/src/policy.ts';
import { asDb, createPool, DB_ROLE } from '../store/src/index.ts';
import { leadRows } from './lib/lead-time.ts';

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};
const days = Number(arg('--days') ?? '3');
const MS_MIN = 60_000;
/* The owner's missed videos (2026-10-15 brief), always in the set whatever their coin's date. */
const MISSED = ['tiktok:7695970441126579470', 'tiktok:7695781291517627662', 'tiktok:7695856190563061006', 'tiktok:7696516827739966738'];
/* Measured $/day per finder at the settings in policy (the switch-on table, 2026-10-15). */
const COSTS: Record<string, number> = { coinLinks: 1.25, reposts: 0.85, creators: 0.6, learnedTags: 0.9, trendTags: 0.97 };

const postedAtOfId = (id: string): number | null => (/^\d+$/.test(id) ? Number(BigInt(id) >> 32n) * 1000 : null);
const TAG = /#([\p{L}\p{N}_]+)/gu;
const tagsOf = (body: string | null) => new Set([...(body ?? '').matchAll(TAG)].map((m) => (m[1] ?? '').toLowerCase()));
const iso = (ms: number | null) => (ms === null ? '—' : new Date(ms).toISOString().slice(5, 16).replace('T', ' '));
const lead = (coinAt: number, foundAt: number | null) => (foundAt === null ? null : Math.round((coinAt - foundAt) / MS_MIN) || 0);
const leadText = (m: number | null) => (m === null ? '—' : m === 0 ? 'at the coin' : `${m > 0 ? '+' : ''}${m}m`);

const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-finders-backtest' });
const db = asDb(pool);
const lines: string[] = [];
const say = (s = '') => {
  lines.push(s);
  console.log(s);
};

try {
  const since = new Date(Date.now() - days * 86_400_000);
  const all = await leadRows(db, new Date(Date.now() - (days + 3) * 86_400_000));
  const videos = all.filter((r) => r.source === 'tiktok' && (r.firstCoinAt >= since || MISSED.includes(r.itemId)));
  for (const id of MISSED) if (!videos.some((v) => v.itemId === id)) say(`- ${id}: no coin names it and the owner confirmed none we hold the launch of; left out`);

  /* What we hold of each video, and its creator from the coin's link when we do not hold it. */
  const ids = videos.map((v) => v.itemId);
  const held = new Map((await db.query<{ item_id: string; body: string | null; handle: string | null; first_seen_at: Date }>(
    `select i.item_id, i.body, a.handle, i.first_seen_at from public.item i left join public.author a on a.author_key = i.author_key where i.item_id = any($1::text[])`, [ids])).map((r) => [r.item_id, r]));
  const linkHandles = new Map((await db.query<{ id: string; handle: string }>(
    `select distinct on (x[2]) x[2] as id, lower(x[1]) as handle
       from internal.coin_metadata m cross join lateral regexp_matches(concat_ws(' ', m.social_link, m.website, m.chat_link, m.description), 'tiktok\\.com/@([A-Za-z0-9_.]+)/(?:video|photo)/([0-9]{8,25})', 'g') as x
      where m.outcome = 'read' and x[2] = any($1::text[])`, [ids.map((i) => i.slice(i.indexOf(':') + 1))])).map((r) => [`tiktok:${r.id}`, r.handle]));
  const creatorOf = (id: string) => (held.get(id)?.handle ?? linkHandles.get(id) ?? null)?.toLowerCase() ?? null;

  /* Reposts: the followed links, from the file or the record. */
  const reposted = new Map<string, number>();
  const file = arg('--links');
  const followed: { to: string | null; at: string | number }[] = file !== null ? Object.values(JSON.parse(readFileSync(file, 'utf8')) as Record<string, { to: string | null; at: string }>) : (await db.query<{ to: string | null; at: Date }>(`select target as to, followed_at as at from internal.short_link where target ~ 'tiktok'`).catch(() => []));
  for (const f of followed) {
    const m = /tiktok\.com\/@[^/]+\/(?:video|photo)\/(\d+)/.exec(f.to ?? '');
    if (m?.[1] === undefined) continue;
    const at = new Date(f.at).getTime() + P.finders.reposts.everyMs;
    const key = `tiktok:${m[1]}`;
    reposted.set(key, Math.min(reposted.get(key) ?? Infinity, at));
  }

  /* Coined videos before each one, for the learned creators and tags (by time, never the video itself). */
  const coinedBefore = (at: number, self: string) => all.filter((r) => r.source === 'tiktok' && r.itemId !== self && r.firstCoinAt.getTime() < at);
  const trend = arg('--trend') === null ? new Set<string>() : new Set(readFileSync(arg('--trend') ?? '', 'utf8').split('\n').map((s) => s.trim().replace(/^#/, '').toLowerCase()).filter((s) => s !== ''));

  const caught: Record<string, { n: number; leads: number[] }> = Object.fromEntries(Object.keys(COSTS).map((k) => [k, { n: 0, leads: [] }]));
  const count = (k: string, m: number | null) => {
    if (m === null || m <= 0) return;
    caught[k]!.n += 1;
    caught[k]!.leads.push(m);
  };

  say(`# Finders backtest: ${videos.length} coined short videos (last ${days} days, plus the owner's missed)`);
  say();
  say('| video | posted | first coin | shown | coin links | reposts | creator | learned tag | trend tag |');
  say('|---|---|---|---|---|---|---|---|---|');
  for (const v of videos.sort((a, b) => a.firstCoinAt.getTime() - b.firstCoinAt.getTime())) {
    const coinAt = v.firstCoinAt.getTime();
    const posted = v.postedAt?.getTime() ?? postedAtOfId(v.itemId.slice(v.itemId.indexOf(':') + 1));
    const before = posted === null ? [] : coinedBefore(posted, v.itemId);
    const creator = creatorOf(v.itemId);
    const creatorHit = creator !== null && posted !== null && before.some((r) => creatorOf(r.itemId) === creator);
    const creatorAt = creatorHit && posted !== null ? posted + P.finders.creators.askEveryMs : null;
    const h = held.get(v.itemId);
    const tags = h === undefined ? null : tagsOf(h.body);
    const learnedCounts = new Map<string, number>();
    for (const r of before) for (const t of tagsOf(held.get(r.itemId)?.body ?? null)) learnedCounts.set(t, (learnedCounts.get(t) ?? 0) + 1);
    const skip = new Set(P.finders.learned.skip);
    const learnedHit = tags === null ? null : [...tags].some((t) => !skip.has(t) && (learnedCounts.get(t) ?? 0) >= P.finders.learned.minPosts);
    const trendHit = tags === null ? null : [...tags].some((t) => trend.has(t));
    const tagAt = (hit: boolean | null) => (hit === true && posted !== null ? posted + P.finders.trends.askEveryMs : null);
    /* Only a video a coin's metadata names: the owner's confirmed coin alone leaves the finder blind. */
    const links = v.named ? coinAt + 10_000 : null;
    const rows = { coinLinks: lead(coinAt, links), reposts: lead(coinAt, reposted.get(v.itemId) ?? null), creators: lead(coinAt, creatorAt), learnedTags: lead(coinAt, tagAt(learnedHit)), trendTags: lead(coinAt, tagAt(trendHit)) };
    for (const [k, m] of Object.entries(rows)) count(k, m);
    const mark = MISSED.includes(v.itemId) ? ' (missed)' : '';
    say(`| ${v.itemId}${mark} | ${iso(posted)} | ${iso(coinAt)} | ${leadText(v.leadMin === null ? null : Math.round(v.leadMin))} | ${v.named ? leadText(rows.coinLinks) : 'no link'} | ${leadText(rows.reposts)} | ${creatorHit ? leadText(rows.creators) : 'no'} | ${learnedHit === null ? 'not held' : learnedHit ? leadText(rows.learnedTags) : 'no'} | ${trendHit === null ? 'not held' : trendHit ? leadText(rows.trendTags) : 'no'} |`);
  }
  say();
  say('Lead in minutes before the first coin (positive: we would have had it first). "shown" is what For You actually did.');
  say();
  say('## Ranked by coined videos found ahead per dollar a day');
  say();
  say('| finder | found ahead | median lead | $/day | ahead per $ |');
  say('|---|---|---|---|---|');
  const median = (xs: number[]) => (xs.length === 0 ? null : [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? null);
  for (const [k, c] of Object.entries(caught).sort((a, b) => b[1].n / (COSTS[b[0]] ?? 1) - a[1].n / (COSTS[a[0]] ?? 1))) {
    say(`| ${k} | ${c.n} of ${videos.length} | ${leadText(median(c.leads))} | $${(COSTS[k] ?? 0).toFixed(2)} | ${(c.n / (COSTS[k] ?? 1)).toFixed(1)} |`);
  }
  const out = arg('--out');
  if (out !== null) writeFileSync(out, lines.join('\n') + '\n');
} finally {
  await pool.end();
}
