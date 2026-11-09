/**
 * `node --env-file=.env.local --experimental-strip-types tools/runner-lead.ts [--days <n>] [--min-cap <usd>] [--list]`
 *
 * RUNNER LEAD, the goal's own number (the owner, 2026-11-09: "find the post before the actual runner
 * launches — as many posts as possible"): of the coins that RAN in the last `--days` (default 21), the
 * share whose post For You showed before the runner launched, and by how much. Free and read-only.
 *
 * Why its own tool and not tools/lead-time.ts: that one measures each post against its FIRST coin, which
 * is a bot copy ~35 s after the post on most viral posts — a race no search can win, so its "0%" says
 * nothing about the goal. Here each post is measured against the one coin of it that ran.
 *
 * A runner: a coin tied to a post (named in its metadata — coin_post_link —, confirmed by the owner, or our
 * pick) whose market cap read at least `--min-cap` (default launch-intel's WINNER_CAP_USD, $100k) on two or
 * more readings with a pool (oneCoin.minLiquidityUsd) — two, because one quote on a $0 pool is not a run
 * (store missed-runners.ts). Graduation is not in the database, so a coin that graduated without a market
 * reading over the bar is not counted. Several posts can share one runner (copies, quotes): the headline
 * counts each runner once, by its best post — shown earliest, else held earliest.
 *
 * Each runner falls in one bucket, and each bucket has its own fix:
 *   shown before launch   the goal met
 *   held, shown late      we had the post before launch and For You did not show it in time (pipeline)
 *   held only after       we never had the post before the runner launched (finding)
 *
 * What breaks if changed carelessly: the launch time is the runner's mint, not when it crossed the bar —
 * measuring against the crossing would credit us for showing a post after people could already buy.
 */

import process from 'node:process';

import { DEFAULT_POLICY as P } from '../contracts/src/policy.ts';
import { asDb, createPool, DB_ROLE } from '../store/src/index.ts';
import { WINNER_CAP_USD } from './lib/launch-intel.ts';

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};
const days = Number(arg('--days') ?? '21');
const minCap = Number(arg('--min-cap') ?? String(WINNER_CAP_USD));
const list = process.argv.includes('--list');
const MIN_READINGS = 2;

interface Row {
  item_id: string;
  address: string;
  launched_at: Date;
  peak: number;
  crossed_at: Date;
  posted_at: Date | null;
  held_at: Date | null;
  shown_at: Date | null;
  found_by: string | null;
}

const RUNNER_POSTS = `
  with linked as (
    select l.source || ':' || l.source_item_id as item_id, l.address from internal.coin_post_link l where l.minted_at >= $1
    union
    select f.item_id, f.coin_address from internal.owner_feedback f
     where f.subject_kind = 'coin_match' and f.verdict = 'right' and f.coin_address is not null
    union
    select p.item_id, p.address from internal.post_coin_pick p where p.outcome = 'picked'
  ),
  coin as (
    select a.address, a.asset_key, coalesce(a.minted_at, a.first_seen_at) as launched_at
      from public.asset a
     where a.address in (select address from linked) and coalesce(a.minted_at, a.first_seen_at) >= $1
  ),
  ran as (
    select c.address, c.launched_at, max(m.market_cap_usd)::double precision as peak, min(m.taken_at) as crossed_at
      from coin c
      join public.market_reading m on m.asset_key = c.asset_key
     where m.market_cap_usd >= $2 and (m.liquidity_usd is null or m.liquidity_usd >= $3)
     group by c.address, c.launched_at
    having count(*) >= $4
  )
  select l.item_id, r.address, r.launched_at, r.peak, r.crossed_at,
         i.posted_at, i.first_seen_at as held_at, fp.first_shown_at as shown_at, fb.lane as found_by,
         j.coinable as judged_yes
    from linked l
    join ran r on r.address = l.address
    left join public.item i on i.item_id = l.item_id
    left join internal.item_found_by fb on fb.item_id = l.item_id
    left join public.feed_post fp on fp.item_id = l.item_id and fp.feed_id = 'fyp'
    left join lateral (select pj.coinable from internal.post_judgement pj
                        where pj.item_id = l.item_id and pj.prompt_id not like 'post-kind%'
                        order by pj.judged_at desc limit 1) j on true`;

type Bucket = 'shown before launch' | 'held, shown late' | 'missed, post first' | 'post after launch';
const BUCKETS: readonly Bucket[] = ['shown before launch', 'held, shown late', 'missed, post first', 'post after launch'];

const t = (d: Date | null): number | null => (d === null ? null : d.getTime());
const minsBetween = (later: number, earlier: number): number => (later - earlier) / 60_000;
const median = (xs: readonly number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[m] ?? null) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
};
const fmtMin = (m: number | null): string => (m === null ? '—' : `${m >= 0 ? '+' : ''}${Math.round(m)} min`);
const pct = (n: number, d: number): string => (d === 0 ? '—' : `${Math.round((100 * n) / d)}%`);
const usd = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`;

function bucketOf(r: Row): Bucket {
  const launch = r.launched_at.getTime();
  const shown = t(r.shown_at);
  const held = t(r.held_at);
  if (shown !== null && shown < launch) return 'shown before launch';
  if (held !== null && held < launch) return 'held, shown late';
  const posted = t(r.posted_at);
  if (posted !== null && posted >= launch) return 'post after launch';
  return 'missed, post first';
}

/** A runner's best post: shown earliest, else held earliest, else any. */
function bestPost(rows: readonly Row[]): Row {
  const key = (r: Row): [number, number] => [t(r.shown_at) ?? Number.POSITIVE_INFINITY, t(r.held_at) ?? Number.POSITIVE_INFINITY];
  return [...rows].sort((a, b) => key(a)[0] - key(b)[0] || key(a)[1] - key(b)[1])[0]!;
}

const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-runner-lead' });
const db = asDb(pool);

try {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db.query<Row>(RUNNER_POSTS, [since, minCap, P.oneCoin.minLiquidityUsd, MIN_READINGS]);

  const byCoin = new Map<string, Row[]>();
  for (const r of rows) byCoin.set(r.address, [...(byCoin.get(r.address) ?? []), r]);
  const runners = [...byCoin.values()].map(bestPost);

  console.log(`Runners launched in the last ${days} days (cap ${usd(minCap)}+ on ${MIN_READINGS}+ pool readings), each by its best post:`);
  console.log(`  ${runners.length} runners, ${rows.length} posts tied to them`);
  console.log();
  for (const b of BUCKETS) {
    const xs = runners.filter((r) => bucketOf(r) === b);
    console.log(`  ${b.padEnd(20)} ${String(xs.length).padStart(5)}  ${pct(xs.length, runners.length).padStart(4)}`);
  }
  console.log();

  const shown = runners.filter((r) => r.shown_at !== null);
  const leadLaunch = shown.map((r) => minsBetween(r.launched_at.getTime(), r.shown_at!.getTime()));
  const leadCross = shown.map((r) => minsBetween(r.crossed_at.getTime(), r.shown_at!.getTime()));
  console.log(`  shown at all: ${shown.length} of ${runners.length} (${pct(shown.length, runners.length)})`);
  console.log(`  median lead over the runner's launch:          ${fmtMin(median(leadLaunch))} (positive: shown first)`);
  console.log(`  median lead over its first ${usd(minCap)} reading: ${fmtMin(median(leadCross))}`);
  const early = shown.filter((r) => r.shown_at!.getTime() < r.launched_at.getTime()).map((r) => minsBetween(r.launched_at.getTime(), r.shown_at!.getTime()));
  console.log(`  of those shown first, median minutes ahead:     ${fmtMin(median(early))}`);

  const lateHeld = runners.filter((r) => bucketOf(r) === 'held, shown late');
  const heldToShown = lateHeld.filter((r) => r.shown_at !== null && r.held_at !== null).map((r) => minsBetween(r.shown_at!.getTime(), r.held_at!.getTime()));
  const heldLead = lateHeld.flatMap((r) => (r.held_at === null ? [] : [minsBetween(r.launched_at.getTime(), r.held_at.getTime())]));
  console.log();
  const neverShown = lateHeld.filter((r) => r.shown_at === null);
  const verdicts = (xs: readonly Row[]): string =>
    `judged yes ${xs.filter((r) => r.judged_yes === true).length}, no ${xs.filter((r) => r.judged_yes === false).length}, not judged ${xs.filter((r) => r.judged_yes === null).length}`;
  console.log(`  held, shown late: ${neverShown.length} never shown (${verdicts(neverShown)}); median held → shown ${fmtMin(median(heldToShown))}; median held before launch ${fmtMin(median(heldLead))}`);

  const yesUnshown = new Map<string, number>();
  for (const r of neverShown.filter((x) => x.judged_yes === true)) yesUnshown.set(r.found_by ?? 'no lane', (yesUnshown.get(r.found_by ?? 'no lane') ?? 0) + 1);
  if (yesUnshown.size > 0) console.log(`    judged yes, never shown, by lane: ${[...yesUnshown].sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l} ${n}`).join(', ')}`);

  const missed = runners.filter((r) => bucketOf(r) === 'missed, post first');
  const postToLaunch = missed.flatMap((r) => (r.posted_at === null ? [] : [minsBetween(r.launched_at.getTime(), r.posted_at.getTime())]));
  console.log(`  missed, post first: median post → runner launch ${fmtMin(median(postToLaunch))} (the time a search had); ${missed.filter((r) => r.posted_at === null).length} with no post time`);

  const lanes = new Map<string, number>();
  for (const r of runners.filter((x) => bucketOf(x) === 'shown before launch')) lanes.set(r.found_by ?? 'other', (lanes.get(r.found_by ?? 'other') ?? 0) + 1);
  if (lanes.size > 0) console.log(`  shown-first runners by lane: ${[...lanes].map(([l, n]) => `${l} ${n}`).join(', ')}`);

  if (list) {
    console.log();
    const ordered = [...runners].sort((a, b) => b.peak - a.peak);
    for (const r of ordered) {
      const shownLead = r.shown_at === null ? null : minsBetween(r.launched_at.getTime(), r.shown_at.getTime());
      const heldLead = r.held_at === null ? null : minsBetween(r.launched_at.getTime(), r.held_at.getTime());
      const postAge = r.posted_at === null ? null : minsBetween(r.launched_at.getTime(), r.posted_at.getTime());
      console.log(`  ${r.item_id}  peak ${usd(r.peak)}  ${bucketOf(r)}  post→launch ${fmtMin(postAge)}  held ${fmtMin(heldLead)}  shown ${fmtMin(shownLead)}  found by ${r.found_by ?? '—'}  runner ${r.address}`);
    }
  }
} finally {
  await pool.end();
}
