/**
 * `node --env-file=.env.local --experimental-strip-types tools/late-no-coin-replay.ts [--days 5] [--wide-hours 168]`
 *
 * THE LATE ROUTE, REPLAYED READ-ONLY (Policy.lateNoCoin, services/project late-no-coin.ts). For the
 * posts first seen in the last `--days` days more than For You's six hours after they went up, judged
 * yes, this works out the first moment the route would have let each onto For You — found, judged yes
 * (the projector's own `postRoute`), over the views bar on the readings taken by then (`clearsReachBar`),
 * not over the junk bar, under the age cap and before any coin for it was running (`loadLate`) — and
 * lists them with how long each would have stayed. Counted per London day of joining, so the owner sees
 * the volume.
 *
 * `--wide-hours` replays the same posts under a longer cap, to show what the cap costs: the posts a
 * longer cap would add and whether any running coin came for them after the cap.
 *
 * What it cannot replay: the variety rule and the one-account share (they act on the whole list at
 * once), and a judge's answer that a later prompt replaced — the newest answer is used, as the
 * projector would read it now. Both can only take posts away, so the counts are an upper bound.
 *
 * Why its own tool and not a test: it reads the live database, inside `begin read only`, and spends
 * nothing. What breaks if changed carelessly: the moment it calls "joined" must use only readings taken
 * by then; a reading from later would put a post on For You before it had the views.
 */

import process from 'node:process';

import type { Millis } from '../contracts/src/index.ts';
import { DEFAULT_POLICY, type Policy } from '../contracts/src/policy.ts';
import { clearsReachBar } from '../core/src/index.ts';
import { loadAnswerPolicies, policyForAnswer } from '../services/project/src/judge-cutoff.ts';
import { loadReach } from '../services/project/src/db.ts';
import { overJunkBar } from '../services/project/src/junk-bar.ts';
import { lateAnswerPolicy, loadLate, type LateRecord } from '../services/project/src/late-no-coin.ts';
import { barReadings, cryptoSignalFor, forYouBarPolicy, loadCandidates, postRoute } from '../services/project/src/rising.ts';
import { asDb, createPool, DB_ROLE } from '../store/src/index.ts';

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
};
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const days = Number(arg('--days') ?? 5);
const wideMs = Number(arg('--wide-hours') ?? 168) * HOUR_MS;
/* `--item <id>`: say what the replay made of one post, step by step. */
const traced = arg('--item');
const trace = (id: string, what: string): void => {
  if (id === traced) console.log(`[${id}] ${what}`);
};

const london = (ms: number): string => new Date(ms).toLocaleString('en-GB', { timeZone: 'Europe/London', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const londonDay = (ms: number): string => new Date(ms).toLocaleDateString('en-GB', { timeZone: 'Europe/London', day: '2-digit', month: 'short' });
const hours = (ms: number): string => `${(ms / HOUR_MS).toFixed(1)}h`;

interface Joined {
  readonly r: LateRecord;
  readonly handle: string;
  readonly text: string;
  readonly confidence: number | null;
  readonly atMs: number;
  readonly views: number | null;
  readonly junk: boolean;
}

const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-late-no-coin-replay' });
const client = await pool.connect();
try {
  await client.query('begin read only');
  const db = asDb(client);
  /* `--strict`: the route's yes held to For You's own bar, whatever the policy says. */
  const policy: Policy = process.argv.includes('--strict') ? { ...DEFAULT_POLICY, lateNoCoin: { ...DEFAULT_POLICY.lateNoCoin, nearBar: false } } : DEFAULT_POLICY;
  const answers = await loadAnswerPolicies(db, policy);
  const now = Date.now();
  const start = now - days * DAY_MS;
  const capMs = policy.lateNoCoin.maxPostAgeMs;

  /* Every late post judged yes whose post went up inside the wide cap of the replay's start. */
  const all = (await loadLate(db, (start - wideMs) as Millis, policy)).filter((r) => r.foundAtMs >= start);
  const ids = all.map((r) => r.itemId);
  if (traced !== null) trace(traced, all.some((r) => r.itemId === traced) ? `late: ${JSON.stringify(all.find((r) => r.itemId === traced))}` : 'not a late post judged yes in the window');
  const rows = new Map((await loadCandidates(db, 0 as Millis, ids, ids, null, ids)).map((row) => [row.item_id, row] as const));
  const judgedAt = new Map((await db.query<{ item_id: string; at: Date }>(
    /* The first yes: a re-score after a prompt change files a newer answer, and the newest answer's time
       would put a post on For You hours after it had a yes. The newest answer still decides whether it passes. */
    `select item_id, min(judged_at) as at from internal.post_judgement
      where item_id = any($1::text[]) and prompt_id not like 'post-kind%' and coinable group by item_id`,
    [ids],
  )).map((r) => [r.item_id, r.at.getTime()] as const));
  const reach = await loadReach(db, ids, (start - wideMs) as Millis);
  /* A post already on For You (by its views while young, the coin-first route, a fast climb) does not join again. */
  const onForYou = new Map((await db.query<{ item_id: string; at: Date }>(
    `select item_id, first_shown_at as at from public.feed_post where feed_id = 'fyp' and item_id = any($1::text[])`,
    [ids],
  )).map((r) => [r.item_id, r.at.getTime()] as const));
  const fypBar = forYouBarPolicy(policy);

  const judgedNo: string[] = [];
  const neverViews: string[] = [];
  const already: string[] = [];
  const joined: Joined[] = [];
  for (const r of all) {
    const row = rows.get(r.itemId);
    if (row === undefined) {
      trace(r.itemId, 'not loaded by the candidate read');
      continue;
    }
    /* The judge's own yes, the kind, the owner's call; never the safety net. The crypto read is left out: it only adds a route for a post the judge said no to. */
    const { route } = postRoute(row, lateAnswerPolicy(policyForAnswer(row.judge_id, answers), policy), cryptoSignalFor(row, undefined, policy));
    if (route === null || route === 'net') {
      trace(r.itemId, `does not pass now: ${postRoute(row, policyForAnswer(row.judge_id, answers)).why} (kind ${row.kind_label ?? '-'}, owner ${row.owner_call ?? '-'})`);
      judgedNo.push(r.itemId);
      continue;
    }
    const readings = reach.get(r.itemId) ?? [];
    const scale = row.source === 'tiktok' ? policy.rising.shortVideoReachScale : 1;
    const from = Math.max(r.foundAtMs, judgedAt.get(r.itemId) ?? r.foundAtMs);
    const moments = [from, ...readings.map((x) => x.atMs).filter((t) => t > from)].sort((a, b) => a - b);
    const at = moments.find((t) => clearsReachBar('fyp', barReadings(readings.filter((x) => x.atMs <= t), policy), r.postedAtMs, fypBar, scale));
    if (at === undefined) {
      trace(r.itemId, `never over the views bar: ${JSON.stringify(barReadings(readings, policy))}`);
      neverViews.push(r.itemId);
      continue;
    }
    const shownAt = onForYou.get(r.itemId);
    if (shownAt !== undefined && shownAt <= at) {
      trace(r.itemId, `already on For You since ${london(shownAt)}`);
      already.push(r.itemId);
      continue;
    }
    const seen = readings.filter((x) => x.atMs <= at && x.count !== null && x.count !== undefined);
    joined.push({
      r,
      handle: row.handle ?? row.source_author_id,
      text: row.body.replace(/\s+/g, ' ').slice(0, 60),
      confidence: row.confidence === null ? null : Number(row.confidence),
      atMs: at,
      views: seen.length === 0 ? null : Math.max(...seen.map((x) => x.count as number)),
      junk: false,
    });
  }
  const junk = await overJunkBar(db, joined.map((j) => j.r.itemId), policy);
  const judged = joined.map((j) => ({ ...j, junk: junk.has(j.r.itemId) }));

  /* Under a cap: joins before the cap and before a running coin; stays until the first of the two. */
  const under = (cap: number) => judged.filter((j) => !j.junk && j.atMs - j.r.postedAtMs <= cap && (j.r.coinAtMs === null || j.atMs < j.r.coinAtMs));
  const shown = under(capMs);
  const wide = under(wideMs);

  console.log(`Late route replay, read-only, ${days} days to ${london(now)} London. Cap ${hours(capMs)}, a yes ${policy.lateNoCoin.nearBar ? `up to ${policy.rising.boostBarMargin} under its bar` : 'over its bar'} (policy ${policy.version}).`);
  console.log(`Late posts judged yes at least once: ${all.length}; not passing now (kind, bar, owner): ${judgedNo.length}; never over the views bar: ${neverViews.length}; already on For You: ${already.length}; over the junk bar: ${judged.filter((j) => j.junk).length}.`);
  console.log(`Would have joined For You: ${shown.length} under the ${hours(capMs)} cap, ${wide.length} under ${hours(wideMs)}.\n`);

  const perDay = new Map<string, number>();
  for (const j of shown) perDay.set(londonDay(j.atMs), (perDay.get(londonDay(j.atMs)) ?? 0) + 1);
  console.log('Per London day of joining:');
  for (const [d, n] of [...perDay].sort((a, b) => Date.parse(`${a[0]} 2026`) - Date.parse(`${b[0]} 2026`))) console.log(`  ${d}  ${n}`);

  console.log('\nThe posts (joined, posted, found, age at joining, views by then, judge, coin running, time on the route):');
  for (const j of shown.sort((a, b) => a.atMs - b.atMs)) {
    const until = Math.min(j.r.coinAtMs ?? Number.POSITIVE_INFINITY, j.r.postedAtMs + capMs, now);
    const coin = j.r.coinAtMs === null ? 'no coin yet' : `coin ${london(j.r.coinAtMs)} (${hours(j.r.coinAtMs - j.r.postedAtMs)} after post)`;
    console.log(`  ${london(j.atMs)}  @${j.handle}  posted ${london(j.r.postedAtMs)}  found ${london(j.r.foundAtMs)}  age ${hours(j.atMs - j.r.postedAtMs)}  views ${j.views ?? '-'}  judge ${j.confidence ?? '-'}  ${coin}  on ${hours(until - j.atMs)}  ${j.r.itemId}`);
    console.log(`      "${j.text}"`);
  }

  const added = wide.filter((j) => !shown.includes(j));
  console.log(`\nA ${hours(wideMs)} cap would add ${added.length}; of those, a running coin came later for ${added.filter((j) => j.r.coinAtMs !== null).length}.`);
  const coinedLate = judged.filter((j) => j.r.coinAtMs !== null && j.r.coinAtMs - j.r.postedAtMs > capMs);
  console.log(`Late posts whose first running coin came after the ${hours(capMs)} cap: ${coinedLate.length}${coinedLate.length === 0 ? '' : ` (${coinedLate.map((j) => `${j.r.itemId} ${hours((j.r.coinAtMs as number) - j.r.postedAtMs)}`).join(', ')})`}.`);
  const withCoin = judged.filter((j) => j.r.coinAtMs !== null && j.atMs < j.r.coinAtMs);
  console.log(`Of all that passed, ${withCoin.length} got a running coin after they would have joined, ${hours(median(withCoin.map((j) => (j.r.coinAtMs as number) - j.atMs)))} median after joining.`);
  await client.query('rollback');
} finally {
  client.release();
  await pool.end();
}

function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] as number;
}
