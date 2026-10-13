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
 * What breaks if changed carelessly: the outage check must be the runner's (readOutages). A second
 * definition here would let the table say "down" where the app's list says "unexplained".
 */

import { writeFileSync } from 'node:fs';
import process from 'node:process';

import { DEFAULT_POLICY } from '../contracts/src/policy.ts';
import type { Millis } from '../contracts/src/index.ts';
import { asDb, createPool, DB_ROLE, PgFeedFloorRepo, PgLearningRepo, PgMissedPostRepo, PgRecallRepo, type Db } from '../store/src/index.ts';
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
 * What the main lane's own passes say about a post made while it ran: the passes that asked for
 * posts of its age (posted inside the pass's window, older than the search's lag) and reached the
 * back of their window (so a full page did not cut them short), and the lowest likes among what
 * they returned, read when first seen. The floor then was at most that.
 */
async function passEvidence(db: Db, postedAtMs: number, lagMin: number): Promise<PassEvidence> {
  const r = await db.query<{ passes: string; floor: number | null }>(
    `with p as (
       select date_trunc('minute', f.found_at) as m, min(f.found_at) as first, min(i.posted_at) as oldest, array_agg(f.item_id) as ids
         from internal.item_found_by f join public.item i using (item_id)
        where f.lane = 'all' and f.found_at between $1 and $1::timestamptz + make_interval(mins => $2::int + 1)
        group by 1),
     /* When the pass asked: its first paid page just before its posts were stored (a pass's
        since_time is its request time less the window). */
     q as (
       select p.*, (select min(s.at) from internal.spend s
                     where s.endpoint = 'search' and s.at between p.first - interval '30 seconds' and p.first) as asked_at
         from p),
     asked as (
       select * from q
        where asked_at is not null
          and $1 between asked_at - make_interval(mins => $2) and asked_at - make_interval(secs => $3::float8 * 60)
          and oldest <= asked_at - make_interval(mins => $2) + interval '1 minute')
     select (select count(*) from asked)::text as passes,
            (select min(o.value)::float8 from asked, unnest(asked.ids) as id
               join lateral (select value from public.observation o where o.item_id = id and o.kind = 'approval' order by observed_at limit 1) o on true) as floor`,
    [new Date(postedAtMs), P.feed.windowMin, lagMin],
  );
  return { mainPasses: Number(r[0]?.passes ?? 0), floorThenAtMost: r[0]?.floor ?? null };
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
        const coined = await new PgLearningRepo(db).coinedPictureVectors();
        const r = await missedPostsPassing(db, block[0]?.text ?? null, { env: process.env, meter: shared.meter, coined, only: never, batch: false });
        fresh = new Map(r.rows.map((x) => [x.id, x]));
        console.log(`judge asked about ${never.length} never-judged posts: ${r.passed}/${r.tested} pass, unanswered ${r.unanswered.length}`);
      } finally {
        paid = shared.meter.spentUsd();
        await shared.close();
      }
    }

    const ctx = { settings: snap?.settings ?? null, outages, postToShownMin: m.postToShownMin, searchLagMin: m.searchLagMin, shortVideoSources: SHORT_VIDEO_SOURCES };
    const evidence = await Promise.all(posts.map((p) => (p.postedAtMs === null ? null : passEvidence(db, p.postedAtMs, m.searchLagMin ?? 0))));
    const rows = posts.map((p, i) => replayOne(p, ctx, fresh.get(p.itemId) ?? null, evidence[i] ?? null));
    const slowLane = snap?.settings.lanes.find((l) => l.lane === 'slow') ?? null;

    const s = snap?.settings;
    const lines: string[] = [];
    lines.push(`# Missed posts, replayed through today's settings`, '');
    lines.push(`Run ${new Date(now).toISOString()} UTC. ${posts.length} missed posts. ${judge ? `Judge asked on the learning book: ${money(paid)}.` : 'Read-only: no judge asked (posts never judged say so).'}`, '');
    lines.push(`Today's discovery: ${s === undefined ? 'could not be measured' : s.lanes.map((l) => `${l.lane} floor ${l.floor} likes, reaches back ${l.reachMin} min, every ${l.everyMin} min`).join('; ')}; languages ${s?.langs?.join(' + ') ?? 'any'}; plain reposts left out, replies kept; growth τ ${s?.tauMin ?? '—'} min.`);
    lines.push(`Measured: a main-lane pass returns posts ${m.searchLagMin?.toFixed(1) ?? '—'} min old at the youngest (median); a found post is shown ${m.postToShownMin?.toFixed(1) ?? '—'} min after posting (median). Search today: ${Math.round(m.volumes.postsPerDay).toLocaleString('en')} posts, ${money(m.volumes.usdPerDay)} in the last day.`);
    lines.push(`Discovery not running: ${outages === null ? 'could not be read' : outages.map((o) => `${o.fromMs === null ? 'before the first pass' : new Date(o.fromMs).toISOString().slice(0, 16)} → ${o.toMs === null ? 'now' : new Date(o.toMs).toISOString().slice(0, 16)}`).join('; ')} (UTC; a gap longer than ${P.feed.windowMin} min with no post stored).`, '');
    lines.push('| Post | Posted (UTC) | Discovery running then? | Today\'s settings find it? | Judge passes it? | Clears the views bar? | Shown before its coin? | Fix, at each step that said no |');
    lines.push('|---|---|---|---|---|---|---|---|');
    for (const r of rows) {
      const who = r.post.url.match(/\.com\/([^/]+)\//)?.[1] ?? r.post.itemId;
      const c = (g: { ok: boolean | null; said: string }) => cell(`${yes(g.ok)}: ${g.said}`);
      lines.push(`| [${who}](${r.post.url}) | ${r.post.postedAtMs === null ? '—' : new Date(r.post.postedAtMs).toISOString().slice(0, 16).replace('T', ' ')} | ${c(r.running)} | ${c(r.found)} | ${c(r.judge)} | ${c(r.bar)} | ${c(r.beforeLaunch)} | ${cell(fix(r, m.volumes, m.searchLagMin, slowLane))} |`);
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
