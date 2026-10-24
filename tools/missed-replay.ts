/**
 * `node --env-file=.env.local --experimental-strip-types tools/missed-replay.ts [--out file.md] [--judge --yes] [--cap 0.50]`
 *
 * THE OWNER'S MISSED POSTS, REPLAYED THROUGH TODAY'S LIVE SETTINGS: for every post he pasted (now
 * and every one he pastes later), found or not and when, passed the judge or not, cleared the views
 * bar or not, shown before its coin launched or not — with the reason for every "no", and the fix at
 * the step that said no, with what it would cost.
 *
 * Its own tool, beside tools/missed-report.ts (which prints what the runner recorded at paste time),
 * because this one re-asks every gate with TODAY's settings, so a change to discovery or the judge
 * can be checked against the owner's list the day it ships. The gates are tools/lib/missed-replay.ts.
 *
 * ★ READ-ONLY BY DEFAULT. Without `--judge` nothing is paid and nothing is written but the
 * markdown file. `--judge --yes` with SPEND=live asks the live judge (the applied learned block, or
 * the written rules when none is applied) about posts it NEVER answered, on the learning book
 * (openSharedMeter … 'learning'), capped at `--cap` dollars. The answers are printed, never stored:
 * the runner's own judge owns internal.post_judgement.
 *
 * ★ A FIX IS A RECOMMENDATION, NEVER APPLIED. Discovery's cost is the posts it would return at
 * the supplier's price, scaled from today's measured volumes under the assumption stated in the line.
 *
 * ★ THE POSTER'S PROFILE (0080): each post's coin — the one the owner gave, else his newest "this is
 * the coin" for the post, else the runner's — is looked for in every profile text its poster ever
 * showed us (core `bioAddresses`, the match's own reader), and the table says "the poster's bio
 * names this coin" when one does, with when that text was first read. Free: our own tables.
 *
 * What breaks if changed carelessly: the outage check must be the runner's (readOutages). A second
 * definition here would let the table say "down" where the app's list says "unexplained".
 */

import { writeFileSync } from 'node:fs';
import process from 'node:process';

import { DEFAULT_POLICY } from '../contracts/src/policy.ts';
import type { Millis } from '../contracts/src/index.ts';
import { bioAddresses } from '../core/src/match/poster-bio.ts';
import { bandFloor, startFloors } from '../core/src/sources/feed-floor.ts';
import { asDb, createPool, DB_ROLE, PgAuthorRepo, PgFeedFloorRepo, PgLearningRepo, PgMissedPostRepo, PgRecallRepo, type Db } from '../store/src/index.ts';
import { measureDiscovery } from '../services/runner/src/work/discovery-settings.ts';
import { readOutages } from '../services/runner/src/work/missed-posts.ts';
import { openSharedMeter } from './lib/shared-meter.ts';
import { loadMissedPosts, missedPostsPassing, replayOne, type PassEvidence, type ReplayRow } from './lib/missed-replay.ts';
import type { EvalRow } from './lib/pass-rates.ts';

const P = DEFAULT_POLICY;

/* ── operational constants: what is read and what a post costs, never what is decided ─────────── */

/* What the text source bills per post its search returns (the audit's and gold-fetch's price). */
const USD_PER_POST = 0.000_15;
/* The spans the live timings are measured over. */
const TIMING_SPAN = '12 hours';
const VOLUME_SPAN = '24 hours';
/* The sources counted at the short-video views scale. */
const SHORT_VIDEO_SOURCES = ['tiktok'];
const DEFAULT_OUT = 'missed-replay.md';
const DEFAULT_CAP_USD = 0.5;
/* The newest band's asks return posts up to about its age plus a language's spacing (an hour at
   most, `langSplit.maxEveryMs`, but ~4 to 15 minutes for the languages asked most): the 50-minute
   band's posts are older than this, so they are kept out of the youngest band's evidence. */
const NEWEST_ASK_MAX_AGE_MIN = 30;

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string): string | null => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? null) : null;
};

interface Volumes {
  readonly postsPerDay: number;
  readonly usdPerDay: number;
  /** Posts first found per lane, last day: the share each lane's spend is taken as. */
  readonly foundByLane: Readonly<Record<string, number>>;
  /** Posts the main lane returns a minute, at today's floor. */
  readonly mainPerMin: number;
}

async function measured(db: Db): Promise<{ postToShownMin: number | null; searchLagMin: number | null; volumes: Volumes }> {
  const t = await db.query<{ shown: number | null; lag: number | null }>(
    `with j as (
       select f.found_at, i.posted_at, (select seen_at from people.pipeline_seen s where s.stream = 'rising' and s.key = f.item_id) as shown
         from internal.item_found_by f join public.item i using (item_id)
        where f.found_at > now() - interval '${TIMING_SPAN}' and f.lane in ('all', 'media'))
     select percentile_cont(0.5) within group (order by extract(epoch from shown - posted_at) / 60) as shown,
            (select percentile_cont(0.5) within group (order by y) from (
               select extract(epoch from min(f.found_at - i.posted_at)) / 60 as y
                 from internal.item_found_by f join public.item i using (item_id)
                where f.found_at > now() - interval '${TIMING_SPAN}' and f.lane = 'all'
                group by date_trunc('minute', f.found_at)) p) as lag
       from j`,
  );
  const v = await db.query<{ posts: string | null; usd: string | null }>(
    `select sum(units)::text as posts, sum(usd)::text as usd from internal.spend where endpoint = 'search' and at > now() - interval '${VOLUME_SPAN}'`,
  );
  const lanes = await db.query<{ lane: string; n: string }>(`select lane, count(*)::text as n from internal.item_found_by where found_at > now() - interval '${VOLUME_SPAN}' group by lane`);
  const foundByLane = Object.fromEntries(lanes.map((l) => [l.lane, Number(l.n)]));
  return {
    postToShownMin: t[0]?.shown === null || t[0]?.shown === undefined ? null : Number(t[0].shown),
    searchLagMin: t[0]?.lag === null || t[0]?.lag === undefined ? null : Number(t[0].lag),
    volumes: { postsPerDay: Number(v[0]?.posts ?? 0), usdPerDay: Number(v[0]?.usd ?? 0), foundByLane, mainPerMin: (foundByLane['all'] ?? 0) / (24 * 60) },
  };
}

/**
 * What the newest-posts search's own asks say about a post made while it ran: the ask whose window
 * held its posting time, and the lowest likes among what that ask and its neighbours returned, read
 * when first seen. The floor then was at most that.
 *
 * ★ IN ITS OWN LANGUAGE. Since 2026-10-19 each language is its own search, with its own floor and
 * its own spacing (`feed.langSplit`), and a language outside `feed.langs` was not asked at all: an
 * ask that returned English posts says nothing about a Turkish one. So asks are read from the
 * posts in the post's language alone; with none, no ask is known to have looked and the model
 * alone speaks. An ask is told apart by the second its posts were stored, and only posts under
 * `NEWEST_ASK_MAX_AGE_MIN` old count, so the 50-minute band's, stored the same pass, are not read
 * as the youngest band's.
 *
 * ★ WHICH ASK HELD IT: a language's youngest-band asks tile posting time — each asks from where the
 * last one ended to the band's age before now — so the post was in the first ask made at least the
 * band's age after it, provided an earlier ask shows the tiling had begun. A small language returns
 * a post or two an ask, so one ask's lowest likes is a thin reading of its floor; the ask before
 * and after it are read with it.
 */
async function passEvidence(db: Db, postedAtMs: number, lang: string | null): Promise<PassEvidence> {
  const bandMin = Math.min(...P.feed.fresh.bandAgesMin);
  const asks = await db.query<{ at: Date; low: number | null }>(
    `select date_trunc('second', f.found_at) as at,
            min((select o.value from public.observation o where o.item_id = f.item_id and o.kind = 'approval' order by observed_at limit 1))::float8 as low
       from internal.item_found_by f join public.item i using (item_id)
      where f.lane = 'all' and i.lang is not distinct from $2
        and f.found_at between $1::timestamptz - make_interval(mins => $3::int) and $1::timestamptz + make_interval(mins => $3::int * 2)
        and f.found_at - i.posted_at < make_interval(mins => $3::int)
      group by 1 order by 1`,
    [new Date(postedAtMs), lang, NEWEST_ASK_MAX_AGE_MIN],
  );
  const due = postedAtMs + bandMin * 60_000;
  const k = asks.findIndex((a) => a.at.getTime() >= due);
  const floorToday = lang === null ? null : await langFloorToday(db, lang);
  if (k <= 0) return { mainPasses: 0, floorThenAtMost: null, floorToday };
  const lows = asks.slice(k - 1, k + 2).map((a) => a.low).filter((x): x is number => x !== null);
  return { mainPasses: 1, floorThenAtMost: lows.length === 0 ? null : Math.min(...lows), floorToday };
}

/** A language's youngest-band floor as sent today (internal.feed_lang_floor through core `bandFloor`); null when it has none. */
async function langFloorToday(db: Db, lang: string): Promise<number | null> {
  const held = (await new PgFeedFloorRepo(db).langFloors().catch(() => ({}) as Record<string, number>))[lang];
  if (held === undefined || !(held > 0)) return null;
  return bandFloor(Math.min(...P.feed.fresh.bandAgesMin), { ...startFloors(P), all: held }, P);
}

const money = (usd: number) => `$${usd < 0.1 ? usd.toFixed(3) : usd.toFixed(2)}`;
const cell = (s: string) => s.replaceAll('|', '/').replaceAll('\n', ' ');
const yes = (ok: boolean | null) => (ok === true ? 'yes' : ok === false ? '**no**' : 'not known');

/** The fix at each step that said no, with its cost. Text for the owner; nothing applied. */
function fix(r: ReplayRow, vol: Volumes, lagMin: number | null, slow: { floor: number; reachMin: number; everyMin: number } | null): string {
  const lanesFound = (vol.foundByLane['all'] ?? 0) + (vol.foundByLane['media'] ?? 0) + (vol.foundByLane['slow'] ?? 0);
  const mainUsd = (vol.usdPerDay * (vol.foundByLane['all'] ?? 0)) / Math.max(1, lanesFound);
  const out: string[] = [];
  const w = r.window;
  if (r.running.why === 'not_yet') out.push('Discovery: nothing to fix; our search had not started when it was posted.');
  if (r.running.why === 'partly' && r.found.why === 'under_floor_seen') out.push('Discovery uptime: the outage ended minutes after it was posted, but the passes after it found it under the floor, so a catch-up search would not have caught it.');
  else if (r.running.why === 'down' || r.running.why === 'partly') {
    const gapMin = w?.postedIn?.toMs === null || w?.postedIn?.toMs === undefined || w.postedIn.fromMs === null ? null : (w.postedIn.toMs - w.postedIn.fromMs) / 60_000;
    const posts = gapMin === null ? null : gapMin * vol.mainPerMin;
    out.push(`Discovery uptime, not a setting: an alarm when no pass stores a post for ${P.feed.windowMin} min (free), and one catch-up search over the gap when discovery comes back (the main query with its window set to the gap${gapMin === null ? '' : `, ${Math.round(gapMin)} min`}): about ${posts === null ? '—' : Math.round(posts)} posts, ${posts === null ? '—' : money(posts * USD_PER_POST)} once per outage at today's main-lane rate (${vol.mainPerMin.toFixed(1)} posts a minute).`);
  }
  if (r.found.ok === false) {
    if (r.found.why.startsWith('not_in_search:language')) out.push(`Discovery: add '${r.post.lang}' to feed.langs; costs up to the posts line, the floor rises to hold it (today ${money(vol.usdPerDay)} a day).`);
    else if (r.found.why === 'under_floor_seen' && slow !== null) {
      /* The slow lane is the lane for a slow starter; capped at its newest pages, it reaches back only so far. */
      const perPass = P.feed.maxPagesPerLane * P.feed.pageLimit;
      const passes = (24 * 60) / slow.everyMin;
      const more = passes * perPass * (P.feed.slow.windowMin / Math.max(1, slow.reachMin) - 1) * USD_PER_POST;
      out.push(`Discovery (slow starter): the slow lane is the one for it, but its ${perPass}-post cap reaches back only ${Math.round(slow.reachMin)} of its ${P.feed.slow.windowMin} min. Letting it page through its whole window: about ${money(more)} a day more (today about ${money(passes * perPass * USD_PER_POST)}), if posts over its floor are spread evenly over the window. Or keep the cap and raise its floor until 60 posts span the window: free, but it then misses slow starters under the higher floor. Which would have caught this post is not known: its likes over time were not measured.`);
    } else if (r.found.why === 'under_floor' || r.found.why === 'between_checks') out.push(`Discovery: a main window of ${P.feed.windowMin * 2} min instead of ${P.feed.windowMin}: about ${money(mainUsd)} a day more (main lane today ${money(mainUsd)}), if posts returned grow with the window.`);
  }
  if (r.judge.ok === false) out.push('Rules: the judge says no under today\'s rules (a rule finding, sent to the coordinator; not changed here).');
  if (r.judge.ok === null) out.push('Judge: never asked; run with --judge.');
  if (r.bar.ok === false) out.push('Growth path: under every views bar inside the feed window.');
  if (r.beforeLaunch.ok === false && r.beforeLaunch.said.includes('too late even')) out.push(`Timing: the coin came faster than our pipeline can show anything (the search returns nothing younger than about ${lagMin === null ? '—' : lagMin.toFixed(0)} min); no step's fix reaches it.`);
  return out.length === 0 ? 'None needed on what is known.' : out.join(' ');
}

/**
 * For each post, whether its poster's profile names its coin: "the poster's bio names this coin
 * (read <when>)", "the poster's bio does not name it", or a dash with why. The coin is the post's
 * recorded one, else the owner's newest "this is the coin" on it.
 */
export async function bioNotes(db: Db, posts: readonly { readonly itemId: string; readonly coin: { readonly address: string } | null }[]): Promise<ReadonlyMap<string, string>> {
  const ids = posts.map((p) => p.itemId);
  if (ids.length === 0) return new Map();
  const authors = await db.query<{ item_id: string; author_key: string }>(`select item_id, author_key from public.item where item_id = any($1::text[])`, [ids]);
  const owner = await db.query<{ item_id: string; coin_address: string }>(
    `select distinct on (item_id) item_id, coin_address from internal.owner_feedback
      where subject_kind = 'coin_match' and verdict = 'right' and coin_address is not null and item_id = any($1::text[])
      order by item_id, created_at desc, id desc`,
    [ids],
  );
  const authorOf = new Map(authors.map((a) => [a.item_id, a.author_key]));
  const ownerCoin = new Map(owner.map((o) => [o.item_id, o.coin_address]));
  const bios = await new PgAuthorRepo(db).biosOf([...new Set(authorOf.values())]);
  return new Map(posts.map((p) => {
    const coin = p.coin?.address ?? ownerCoin.get(p.itemId) ?? null;
    const readings = bios.get(authorOf.get(p.itemId) ?? '') ?? [];
    if (coin === null) return [p.itemId, '— no coin recorded for the post'] as const;
    if (readings.length === 0) return [p.itemId, "— the poster's bio was never read"] as const;
    const naming = readings.filter((r) => bioAddresses([r.bio], P.attention).includes(coin));
    const first = naming.reduce<number | null>((m, r) => (m === null || r.firstReadAt < m ? r.firstReadAt : m), null);
    return [p.itemId, first === null ? "no: the poster's bio does not name it" : `yes: the poster's bio names this coin (read ${new Date(first).toISOString().slice(0, 16).replace('T', ' ')})`] as const;
  }));
}

async function main(): Promise<void> {
  const out = value('--out') ?? DEFAULT_OUT;
  const judge = flag('--judge');
  if (judge && (process.env['SPEND'] !== 'live' || !flag('--yes'))) {
    console.error('missed-replay --judge refused: it calls the paid judge. Set SPEND=live and pass --yes.');
    process.exit(2);
  }
  const pool = createPool(DB_ROLE.internal, { applicationName: 'insidor-missed-replay' });
  try {
    const db = asDb(pool);
    const now = Date.now();
    const posts = await loadMissedPosts(db);
    const snap = await measureDiscovery({ recall: new PgRecallRepo(db), floors: new PgFeedFloorRepo(db) }, now as Millis, P);
    const outages = await readOutages(new PgMissedPostRepo(db), P, now).catch(() => null);
    const m = await measured(db);

    let fresh = new Map<string, EvalRow<'missed'>>();
    let paid = 0;
    if (judge) {
      const never = posts.filter((p) => p.judgement === null).map((p) => p.itemId);
      const block = await db.query<{ text: string }>(`select text from internal.judge_examples_version where applied order by built_at desc limit 1`).catch(() => []);
      const shared = await openSharedMeter(Number(value('--cap') ?? DEFAULT_CAP_USD), process.env, 'learning');
      try {
        const coined = await new PgLearningRepo(db).coinedPictureVectors(P.group.image.space);
        const r = await missedPostsPassing(db, block[0]?.text ?? null, { env: process.env, meter: shared.meter, coined, only: never, batch: false });
        fresh = new Map(r.rows.map((x) => [x.id, x]));
        console.log(`judge asked about ${never.length} never-judged posts: ${r.passed}/${r.tested} pass, unanswered ${r.unanswered.length}`);
      } finally {
        paid = shared.meter.spentUsd();
        await shared.close();
      }
    }

    const ctx = { settings: snap?.settings ?? null, outages, postToShownMin: m.postToShownMin, searchLagMin: m.searchLagMin, shortVideoSources: SHORT_VIDEO_SOURCES };
    const evidence = await Promise.all(posts.map((p) => (p.postedAtMs === null ? null : passEvidence(db, p.postedAtMs, p.lang))));
    const rows = posts.map((p, i) => replayOne(p, ctx, fresh.get(p.itemId) ?? null, evidence[i] ?? null));
    const bio = await bioNotes(db, posts);
    const slowLane = snap?.settings.lanes.find((l) => l.lane === 'slow') ?? null;

    const s = snap?.settings;
    const lines: string[] = [];
    lines.push(`# Missed posts, replayed through today's settings`, '');
    lines.push(`Run ${new Date(now).toISOString()} UTC. ${posts.length} missed posts. ${judge ? `Judge asked on the learning book: ${money(paid)}.` : 'Read-only: no judge asked (posts never judged say so).'}`, '');
    lines.push(`Today's discovery: ${s === undefined ? 'could not be measured' : s.lanes.map((l) => `${l.lane} floor ${l.floor} likes, reaches back ${l.reachMin} min, every ${l.everyMin} min`).join('; ')}; languages ${s?.langs?.join(' + ') ?? 'any'}; plain reposts left out, replies kept; growth τ ${s?.tauMin ?? '—'} min.`);
    lines.push(`Measured: a main-lane pass returns posts ${m.searchLagMin?.toFixed(1) ?? '—'} min old at the youngest (median); a found post is shown ${m.postToShownMin?.toFixed(1) ?? '—'} min after posting (median). Search today: ${Math.round(m.volumes.postsPerDay).toLocaleString('en')} posts, ${money(m.volumes.usdPerDay)} in the last day.`);
    lines.push(`Discovery not running: ${outages === null ? 'could not be read' : outages.map((o) => `${o.fromMs === null ? 'before the first pass' : new Date(o.fromMs).toISOString().slice(0, 16)} → ${o.toMs === null ? 'now' : new Date(o.toMs).toISOString().slice(0, 16)}`).join('; ')} (UTC; a gap longer than ${P.feed.windowMin} min with no post stored).`, '');
    lines.push('| Post | Posted (UTC) | Discovery running then? | Today\'s settings find it? | Judge passes it? | Clears the views bar? | Shown before its coin? | Poster\'s bio names its coin? | Fix, at each step that said no |');
    lines.push('|---|---|---|---|---|---|---|---|---|');
    for (const r of rows) {
      const who = r.post.url.match(/\.com\/([^/]+)\//)?.[1] ?? r.post.itemId;
      const c = (g: { ok: boolean | null; said: string }) => cell(`${yes(g.ok)}: ${g.said}`);
      lines.push(`| [${who}](${r.post.url}) | ${r.post.postedAtMs === null ? '—' : new Date(r.post.postedAtMs).toISOString().slice(0, 16).replace('T', ' ')} | ${c(r.running)} | ${c(r.found)} | ${c(r.judge)} | ${c(r.bar)} | ${c(r.beforeLaunch)} | ${cell(bio.get(r.post.itemId) ?? '—')} | ${cell(fix(r, m.volumes, m.searchLagMin, slowLane))} |`);
    }
    lines.push('', 'Read "not known" as not known: a missed post was read once, after the fact, so its likes and views over time were never measured.');
    const outPath = out;
    writeFileSync(outPath, `${lines.join('\n')}\n`);
    console.log(`wrote ${outPath}`);
  } finally {
    await pool.end();
  }
}

main().catch((e: unknown) => {
  console.error(`missed-replay failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
