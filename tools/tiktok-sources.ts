/**
 * `node --env-file=.env.local --experimental-strip-types tools/tiktok-sources.ts [--days=3] [--out=<file.md>]`
 *
 * THE 3-DAY REVIEW OF THE TIKTOK SOURCES (the owner, 2026-10-16, point 7: "after 3 days: drop any
 * TikTok source that adds cost but no lead time"). Free and read-only. For each lane that finds
 * TikToks (internal.item_found_by), over the last `--days` (Policy.learning.shortVideo.reviewAfterMs
 * by default):
 *
 *   found       videos it found, and how many went on to For You
 *   cost        its judging (internal.post_judgement on its videos) plus its share of the fetching
 *               (internal.spend): an endpoint only one lane uses is that lane's; the keyword search
 *               is shared by the owner's words, the learned words and the sounds, and split by the
 *               videos each found — an estimate, and said to be one. Re-reads serve every lane and
 *               are listed apart, never charged to one.
 *   lead        coined TikToks it found before their first coin, and For You showed before the coin,
 *               with the median lead (tools/lib/lead-time.ts)
 *   verdict     DROP when it cost money and found not one coined TikTok before its coin in the whole
 *               window, and has run the full window; KEEP when it has lead; TOO EARLY otherwise —
 *               with the switch that turns it off
 *
 * ★ IT REPORTS; IT DROPS NOTHING. A lane's switch is code (Policy.finders) and the runner reads no
 * switch from the database, so "drop" is the owner's or the coordinator's edit, named exactly here.
 *
 * What breaks if changed carelessly: lead is credited to the lane that FIRST found the video
 * (item_found_by keeps the first). A lane that only ever re-finds what another found first has no
 * lead of its own, and that is the point of the review.
 */

import { writeFileSync } from 'node:fs';
import process from 'node:process';

import { DEFAULT_POLICY as P } from '../contracts/src/policy.ts';
import { asDb, createPool, DB_ROLE } from '../store/src/index.ts';
import { leadRows } from './lib/lead-time.ts';
import { sideBySide, sideBySideLines } from './lib/side-by-side.ts';

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? null;
const days = Number(arg('days') ?? String(P.learning.shortVideo.reviewAfterMs / 86_400_000));
const out = arg('out');
/* The switch that turns each lane off. 'watch' is the owner's own words: his to change, never dropped here. */
const SWITCH: Record<string, string> = {
  coin_link: 'finders.coinLinks.on',
  x_repost: 'finders.reposts.on',
  trend: 'finders.trends.asksOn (learned and trend words) / finders.sounds.on',
  creator: 'finders.creators.on',
  trending: 'finders.trending.on',
  watch: "feed.hashtags (the owner's words: his call)",
};
/* Fetch endpoints that belong to one lane; the rest of the short-video vendors' endpoints are the shared keyword search or re-reads. */
const ONE_LANE: readonly [RegExp, string][] = [[/trending-feed/, 'trending'], [/profile/, 'creator']];
const REREADS = /observe|video|lookup|reread/;
const SEARCH_LANES = new Set(['watch', 'trend']);

const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-tiktok-sources' });
const db = asDb(pool);
const lines: string[] = [];
const say = (s = '') => {
  lines.push(s);
  console.log(s);
};
const usd = (x: number | string | null) => `$${Number(x ?? 0).toFixed(2)}`;

try {
  const since = new Date(Date.now() - days * 86_400_000);
  const lanes = await db.query<{ lane: string; found: number; fyp: number; first_at: Date; judge_usd: number | null }>(
    `select fb.lane, count(*)::int as found, count(fp.item_id)::int as fyp, min(fb.found_at) as first_at,
            (select sum(pj.cost_usd) from internal.post_judgement pj join internal.item_found_by f2 on f2.item_id = pj.item_id
              where f2.lane = fb.lane and f2.item_id like 'tiktok:%' and f2.found_at >= $1)::float as judge_usd
       from internal.item_found_by fb left join public.feed_post fp on fp.item_id = fb.item_id and fp.feed_id = 'fyp'
      where fb.item_id like 'tiktok:%' and fb.found_at >= $1 group by fb.lane order by 2 desc`, [since]);
  const firstEver = new Map((await db.query<{ lane: string; at: Date }>(
    `select lane, min(found_at) as at from internal.item_found_by where item_id like 'tiktok:%' group by 1`)).map((r) => [r.lane, r.at.getTime()]));
  const spend = await db.query<{ vendor: string; endpoint: string; usd: number }>(
    `select vendor, endpoint, sum(usd)::float as usd from internal.spend
      where at >= $1 and vendor in ('apify', 'scrapecreators') and endpoint not like 'learn:%' and endpoint not like 'job:%' and endpoint not like 'trial:%' group by 1, 2`, [since]);
  const fetchOf = new Map<string, number>();
  let shared = 0;
  let rereads = 0;
  const unattributed: string[] = [];
  for (const s of spend) {
    const one = ONE_LANE.find(([re]) => re.test(s.endpoint));
    if (one !== undefined) fetchOf.set(one[1], (fetchOf.get(one[1]) ?? 0) + s.usd);
    else if (REREADS.test(s.endpoint)) rereads += s.usd;
    else if (/discover|search|keyword|song|sound/.test(s.endpoint)) shared += s.usd;
    else unattributed.push(`${s.vendor} ${s.endpoint} ${usd(s.usd)}`);
  }
  const searchFound = lanes.filter((l) => SEARCH_LANES.has(l.lane)).reduce((n, l) => n + l.found, 0);
  for (const l of lanes) if (SEARCH_LANES.has(l.lane) && searchFound > 0) fetchOf.set(l.lane, (fetchOf.get(l.lane) ?? 0) + (shared * l.found) / searchFound);

  const coined = (await leadRows(db, since)).filter((r) => r.source === 'tiktok');
  say(`# TikTok sources: cost against lead, the last ${days} days (from ${since.toISOString().slice(0, 16)} UTC)`);
  say();
  say('| lane | found | on For You | judging | fetching | $/day | coined found | found before the coin | shown before the coin | median lead | verdict | switch |');
  say('|---|---|---|---|---|---|---|---|---|---|---|---|');
  const verdicts: string[] = [];
  for (const l of lanes) {
    const mine = coined.filter((c) => c.foundBy === l.lane);
    const before = mine.filter((c) => c.foundAt !== null && c.foundAt < c.firstCoinAt).length;
    const shownBefore = mine.filter((c) => (c.leadMin ?? 0) > 0).length;
    const leads = mine.flatMap((c) => (c.leadMin === null ? [] : [c.leadMin])).sort((a, b) => a - b);
    const med = leads.length === 0 ? '— (none shown)' : `${Math.round(leads[Math.floor((leads.length - 1) / 2)] ?? 0)} min`;
    const cost = (l.judge_usd ?? 0) + (fetchOf.get(l.lane) ?? 0);
    const ranFull = (firstEver.get(l.lane) ?? Date.now()) <= since.getTime();
    const verdict = l.lane === 'watch' ? "KEEP (the owner's words)" : before > 0 || shownBefore > 0 ? 'KEEP: it has lead' : cost > 0 && ranFull ? 'DROP: cost, no lead' : ranFull ? 'KEEP: no cost' : `TOO EARLY: running since ${new Date(firstEver.get(l.lane) ?? 0).toISOString().slice(0, 16)}`;
    if (verdict.startsWith('DROP')) verdicts.push(`${l.lane}: set ${SWITCH[l.lane] ?? '—'} to false (saves about ${usd(cost / days)} a day)`);
    say(`| ${l.lane} | ${l.found} | ${l.fyp} | ${usd(l.judge_usd ?? 0)} | ${usd(fetchOf.get(l.lane) ?? 0)}${SEARCH_LANES.has(l.lane) ? ' (est.)' : ''} | ${usd(cost / days)} | ${mine.length} | ${before} | ${shownBefore} | ${med} | ${verdict} | ${SWITCH[l.lane] ?? '—'} |`);
  }
  say();
  say(`Re-reads (every lane's, not charged to one): ${usd(rereads)} (${usd(rereads / days)} a day). Shared keyword search split by videos found: ${usd(shared)}.${unattributed.length === 0 ? '' : ` Not attributed: ${unattributed.join(', ')}.`}`);
  say(`Coined TikToks in the window: ${coined.length}; found by no lane: ${coined.filter((c) => c.foundBy === null).length}.`);
  say();
  say(verdicts.length === 0 ? 'Nothing to drop: no lane has run the full window with cost and no lead.' : `To drop (the owner's call; nothing was changed): ${verdicts.join('; ')}.`);
  say();
  say('```');
  for (const line of sideBySideLines(await sideBySide(db, days, P))) say(line);
  say('```');
  if (out !== null) writeFileSync(out, `${lines.join('\n')}\n`);
} finally {
  await pool.end();
}
