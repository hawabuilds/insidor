/**
 * `node --env-file=.env.local --experimental-strip-types tools/recall-check.ts <command>`
 *
 * HOW MUCH OF WHAT STARTS A COIN DOES DISCOVERY CATCH, AND HOW EARLY?
 *
 *   settings          today's discovery settings as the recall model sees them: the floors as sent,
 *                     how far back each lane really reached, how often it ran, how approvals grow.
 *                     Read from the database. Free.
 *   gold-fetch        reads every founder-labelled X origin post of the gold set again (approvals,
 *                     language, picture, reply or not) and freezes it, with the settings, into
 *                     eval/src/gold/recall-evidence.json. Paid: X, about $0.01.
 *   daily [--force]   the daily check: the launchpad coins that bonded in the last day (Dune, under
 *                     a credit), each one's creator link, and whether we held the linked X post
 *                     before the coin launched — written to internal.recall_check (0047). Reads
 *                     each linked X post again to name the reason for a miss. Paid: X, a few cents.
 *   status [days]     the daily catch rate and lead time, from what `daily` wrote. Free.
 *
 * The gold report itself is offline: eval/src/gold/run-recall.ts, from the frozen evidence.
 *
 * ★ A PAID STEP REFUSES unless SPEND=live is set AND --yes is passed, prints its estimate first, and
 * spends under the shared ledger (tools/lib/shared-meter.ts) capped at that estimate. `daily`
 * without them still runs: it records caught or not from what we hold, and every miss as
 * `post_unread` rather than guessing why. On Railway it runs from the `project` schedule once a
 * day (tools/railway-start.mjs); it also skips itself when it ran in the last `RERUN_AFTER_MS`, so a
 * restart of that service does not pay for the same day twice.
 *
 * ★ `--detach` STARTS THE RUN AND RETURNS AT ONCE, and the schedule passes it. That schedule runs
 * its jobs one after another and is health-checked on the board being rebuilt every few minutes;
 * a day's metadata reads take several, so awaited there they would starve the board, fail the
 * health check and have Railway restart the service mid-run — every day. Detached, the run logs
 * to the same output and the schedule's "ok" means only that it started.
 *
 * What breaks if changed carelessly: `caught` is what public.item held, never the model. The model
 * (eval/src/recall/model.ts) only names the reason for a miss; letting it decide a catch would turn
 * a measurement into a restatement of our own assumptions.
 */

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

import { DEFAULT_POLICY } from '../contracts/src/policy.ts';
import type { Millis } from '../contracts/src/vocabulary.ts';
import type { Meter } from '../contracts/src/ports/meter.ts';
import { duneClient, fillParameters } from '../adapters/history/dune/src/index.ts';
import { fetchMetadata } from '../adapters/venue/solana-pumpfun/src/index.ts';
import { parseLink as xLink, postTimeFromId, xPlatform, httpClient as xClient } from '../adapters/platform/x/src/index.ts';
import { parseLink as tiktokLink } from '../adapters/platform/tiktok/src/index.ts';
import { asDb, createPool, DB_ROLE, PgFeedFloorRepo, PgRecallRepo, withTransaction, type RecallRow } from '../store/src/index.ts';
import { median, missReasonBefore, type PostFacts } from '../eval/src/recall/model.ts';
import { goldCoins } from '../eval/src/gold/coin-origins.ts';
import { openSharedMeter } from './lib/shared-meter.ts';
import { measureDiscovery, type SettingsSnapshot } from '../services/runner/src/work/discovery-settings.ts';

const P = DEFAULT_POLICY;
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

/* ── operational constants: how much is read and how often, never what is decided ───────────── */

/* What X bills per post returned (tools/gold-fetch.ts states the same price). */
const X_USD_PER_POST = 0.000_15;
/* The window of bonding the daily check asks about, and how far back a bonded coin's creation is
   looked up (5_bonded_day.sql says why that is bounded). */
const BONDED_HOURS = 24;
const CREATE_DAYS = 30;
/* A run in the last 20 hours means today is done: a restart does not re-pay for it. */
const RERUN_AFTER_MS = 20 * MS_PER_HOUR;
/* Metadata documents read at once. The gateways throttle; a few at a time keeps a day's read
   to minutes. The first gateway is the launchpad's own and fastest; the second answers what it
   refuses. Overridden by METADATA_GATEWAY. */
const METADATA_CONCURRENCY = 6;
const METADATA_RETRY_CONCURRENCY = 2;
const METADATA_RETRY_PAUSE_MS = 30_000;
const GATEWAYS = ['https://pump.mypinata.cloud', 'https://gateway.pinata.cloud'];
const DUNE_TIMEOUT_MS = 600_000;
const DUNE_POLL_MS = 5_000;
const DEADLINE_MS = 120_000;
const STATUS_DAYS = 14;
/* The reply heuristic: the read post carries no reply flag of its own, and a post whose text opens
   with a mention is a reply. Replies are searched since 2026-10-13, so this only matters to a
   model run with `excludeReplies` (the settings before that day). A reply that does not open with
   a mention is counted as an original. */
const REPLY_OPENING = /^@\w/;

const EVIDENCE_FILE = new URL('../eval/src/gold/recall-evidence.json', import.meta.url);

function refuse(message: string): never {
  console.error(`recall-check refused — ${message}`);
  process.exit(1);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const round = (n: number, places = 1) => Number(n.toFixed(places));

function openDb() {
  const pool = createPool(DB_ROLE.internal, { applicationName: 'insidor-recall-check' });
  return { pool, db: asDb(pool) };
}

/* ── the settings ──────────────────────────────────────────────────────────────────────────── */

export type { SettingsSnapshot } from '../services/runner/src/work/discovery-settings.ts';

/* The settings are measured by the runner's own module, so the missed-post diagnosis and this
   check read the same floors, reaches and growth curve. */
async function readSettings(db: ReturnType<typeof asDb>): Promise<SettingsSnapshot> {
  const snapshot = await measureDiscovery({ recall: new PgRecallRepo(db), floors: new PgFeedFloorRepo(db) }, Date.now() as Millis, P);
  if (snapshot === null) refuse('no post has two approval readings yet; the growth curve cannot be fitted.');
  return snapshot;
}

/* ── paid reads ────────────────────────────────────────────────────────────────────────────── */

let closeMeter: (() => Promise<void>) | null = null;

/** A meter for this step, or null when spending is not allowed here (SPEND, --yes). */
async function paidOrNull(estimateUsd: number, what: string, required: boolean): Promise<Meter | null> {
  console.log(`${what}: estimated at most $${estimateUsd.toFixed(4)}.`);
  const why = process.env['SPEND'] !== 'live' ? 'SPEND=live is not set' : !process.argv.includes('--yes') ? '--yes was not passed' : (process.env['X_API_KEY'] ?? '') === '' ? 'X_API_KEY is not set' : null;
  if (why !== null) {
    if (required) refuse(`${why}. This step spends money.`);
    console.log(`  not read: ${why}. Misses are recorded as post_unread.`);
    return null;
  }
  const shared = await openSharedMeter(Math.max(estimateUsd * 1.5, 0.01));
  closeMeter = shared.close;
  return shared.meter;
}

interface ReadPost extends PostFacts {
  readonly postedAt: number | null;
}

/** The posts by id, read from X; a post absent from the answer is not in the map (deleted). */
async function readXPosts(ids: readonly string[], meter: Meter): Promise<Map<string, ReadPost>> {
  const out = new Map<string, ReadPost>();
  if (ids.length === 0) return out;
  const x = xPlatform({ client: xClient({ apiKey: process.env['X_API_KEY'] ?? '', baseUrl: process.env['X_API_BASE'] ?? 'https://api.twitterapi.io', fetch: globalThis.fetch }), meter, now: () => Date.now() });
  const line = meter.line();
  const result = await x.lookup!(ids, { capUsd: line.capUsd, spentUsd: line.spentUsd, maxCalls: null, deadline: Date.now() + DEADLINE_MS });
  for (const item of result.value.items) {
    out.set(item.sourceItemId, {
      approvals: item.counters.approval?.value ?? 0,
      lang: item.lang,
      hasMedia: item.media.length > 0,
      isReply: REPLY_OPENING.test(item.text.trim()),
      isRebroadcast: item.rebroadcastOf !== null,
      postedAt: item.postedAt,
    });
  }
  return out;
}

/* ── gold-fetch ────────────────────────────────────────────────────────────────────────────── */

async function goldFetch(): Promise<void> {
  const ids = [...new Set(goldCoins().flatMap((c) => (c.origin.kind === 'post' && c.origin.platform === 'x' ? [c.origin.postId] : [])))];
  const meter = await paidOrNull(ids.length * X_USD_PER_POST, `gold-fetch: ${ids.length} X origin posts by id`, true);
  const { pool, db } = openDb();
  try {
    const snapshot = await readSettings(db);
    const read = await readXPosts(ids, meter as Meter);
    const posts = Object.fromEntries(ids.map((id) => [id, read.get(id) ?? null]));
    writeFileSync(EVIDENCE_FILE, `${JSON.stringify({ ...snapshot, readPostsAt: new Date().toISOString(), posts }, null, 1)}\n`);
    console.log(`gold-fetch: ${read.size} of ${ids.length} read; spent $${(meter as Meter).line().spentUsd.toFixed(4)}. Now: node --experimental-strip-types eval/src/gold/run-recall.ts`);
  } finally {
    await closeMeter?.();
    await pool.end();
  }
}

/* ── daily ─────────────────────────────────────────────────────────────────────────────────── */

interface Bonded {
  readonly mint: string;
  readonly name: string | null;
  readonly uri: string | null;
  readonly launchedAt: number | null;
  readonly bondedAt: number;
}

/* Dune writes "2026-10-12 00:00:37.000 UTC". */
const duneTime = (v: unknown): number | null => (typeof v === 'string' ? Date.parse(v.replace(' UTC', 'Z').replace(' ', 'T')) : Number.NaN) || null;

async function bondedLastDay(): Promise<{ readonly coins: readonly Bonded[]; readonly credits: number | null }> {
  const apiKey = process.env['DUNE_API_KEY'] ?? '';
  if (apiKey === '') refuse('DUNE_API_KEY is not set; the bonded coins cannot be listed. Nothing was recorded.');
  const dune = duneClient({ apiKey, baseUrl: 'https://api.dune.com', fetch: globalThis.fetch, timeoutMs: DUNE_TIMEOUT_MS, pollMs: DUNE_POLL_MS, sleep });
  const sql = fillParameters(readFileSync(new URL('dune/5_bonded_day.sql', import.meta.url), 'utf8'), { since_hours: BONDED_HOURS, create_days: CREATE_DAYS });
  const run = await dune.run(sql);
  const coins: Bonded[] = [];
  for (const r of run.rows) {
    const bondedAt = duneTime(r['graduated_at']);
    if (typeof r['mint'] !== 'string' || bondedAt === null) continue;
    coins.push({ mint: r['mint'], name: typeof r['name'] === 'string' ? r['name'] : null, uri: typeof r['uri'] === 'string' ? r['uri'] : null, launchedAt: duneTime(r['created_at']), bondedAt });
  }
  return { coins, credits: run.credits };
}

/**
 * The creator's social link from each coin's metadata document; absent when it could not be read.
 * Two rounds: the gateways refuse a share of a burst, and most of what they refuse they serve a
 * little later, so the misses of the first round are asked again, fewer at a time, after a pause.
 */
async function socialLinks(coins: readonly Bonded[]): Promise<Map<string, string | null>> {
  const gateways = process.env['METADATA_GATEWAY'] ? [process.env['METADATA_GATEWAY']] : GATEWAYS;
  const out = new Map<string, string | null>();
  const readAll = async (todo: readonly Bonded[], concurrency: number) => {
    let next = 0;
    const worker = async () => {
      while (next < todo.length) {
        const coin = todo[next++] as Bonded;
        for (const gateway of gateways) {
          try {
            const read = await fetchMetadata(coin.uri, { gateway, fetch: globalThis.fetch, timeoutMs: P.universe.metadataTimeoutMs, maxBytes: P.universe.metadataMaxBytes });
            if (read.kind === 'read') out.set(coin.mint, read.metadata.links.social);
            break;
          } catch {
            /* The next gateway, or unread this round. */
          }
        }
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
  };
  await readAll(coins, METADATA_CONCURRENCY);
  await sleep(METADATA_RETRY_PAUSE_MS);
  await readAll(coins.filter((c) => !out.has(c.mint)), METADATA_RETRY_CONCURRENCY);
  return out;
}

type PostLink = { readonly platform: 'x' | 'tiktok' | 'instagram'; readonly id: string };

function postLink(link: string | null): PostLink | null {
  if (link === null) return null;
  const x = xLink(link);
  if (x?.kind === 'post') return { platform: 'x', id: x.sourceItemId };
  const t = tiktokLink(link);
  if (t?.kind === 'post') return { platform: 'tiktok', id: t.sourceItemId };
  const ig = /^https:\/\/(?:www\.)?instagram\.com\/(?:[^/]+\/)?(?:p|reels?)\/([\w-]+)/i.exec(link.trim())?.[1];
  return ig === undefined ? null : { platform: 'instagram', id: ig };
}

async function daily(): Promise<void> {
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const { pool, db } = openDb();
  try {
    const recall = new PgRecallRepo(db);
    const last = await recall.lastRanAt();
    if (last !== null && now - last < RERUN_AFTER_MS && !process.argv.includes('--force')) {
      console.log(`recall-check daily: ran ${round((now - last) / MS_PER_HOUR)} hours ago; nothing to do (--force to run again).`);
      return;
    }
    const { coins, credits } = await bondedLastDay();
    console.log(`bonded in the last ${BONDED_HOURS} hours: ${coins.length} (dune credits: ${credits ?? 'not reported'})`);
    const links = await socialLinks(coins);
    const linked = coins.flatMap((c) => {
      const link = links.get(c.mint) ?? null;
      const post = postLink(link);
      return post === null || link === null ? [] : [{ coin: c, link, post }];
    });
    console.log(`metadata read: ${links.size}; linked a post: ${linked.length} (${linked.filter((l) => l.post.platform === 'x').length} on X)`);

    const xIds = [...new Set(linked.filter((l) => l.post.platform === 'x').map((l) => l.post.id))];
    const firstSeen = await recall.firstSeen('x', xIds);
    const snapshot = await readSettings(db);
    /* Only the posts we did not have before their launch are read again: the reason is the only
       thing the read is for. */
    const toRead = [...new Set(linked.filter((l) => l.post.platform === 'x' && !((firstSeen.get(l.post.id) ?? Infinity) < (l.coin.launchedAt ?? -Infinity))).map((l) => l.post.id))];
    const meter = await paidOrNull(toRead.length * X_USD_PER_POST, `daily: ${toRead.length} missed X posts read again`, false);
    const read = meter === null ? null : await readXPosts(toRead, meter);

    /* A catch-all lane can only return a post while it is younger than the longest window any lane
       asks for; discovery that started after that says nothing about this post, so a post is
       `discovery_off` when nothing was stored from its posting until then (or the launch). */
    const catchableMs = Math.max(P.feed.windowMin, P.feed.slow.windowMin) * MS_PER_MINUTE;
    const rows: RecallRow[] = [];
    for (const { coin, link, post } of linked) {
      const base = { mint: coin.mint, coinName: coin.name, launchedAt: coin.launchedAt as Millis | null, bondedAt: coin.bondedAt as Millis, postLink: link, postPlatform: post.platform, postId: post.id };
      if (post.platform !== 'x') {
        rows.push({ ...base, postedAt: null, firstSeenAt: null, caught: null, leadMinutes: null, missReason: 'not_on_x', approvalsNow: null });
        continue;
      }
      const postedAt = postTimeFromId(post.id) as Millis | null;
      const seen = firstSeen.get(post.id) ?? null;
      const lead = seen === null || coin.launchedAt === null ? null : round((coin.launchedAt - seen) / MS_PER_MINUTE);
      const facts = read?.get(post.id) ?? null;
      const known = { ...base, postedAt, firstSeenAt: seen, leadMinutes: lead, approvalsNow: facts?.approvals ?? null };
      if (coin.launchedAt === null) rows.push({ ...known, caught: null, missReason: 'launch_unknown' });
      else if (postedAt !== null && postedAt >= coin.launchedAt) rows.push({ ...known, caught: null, missReason: 'posted_after_launch' });
      else if (seen !== null && seen < coin.launchedAt) rows.push({ ...known, caught: true, missReason: null });
      else if (postedAt !== null && !(await recall.storedBetween('x', postedAt, Math.min(coin.launchedAt, postedAt + catchableMs) as Millis))) rows.push({ ...known, caught: false, missReason: 'discovery_off' });
      else if (read === null) rows.push({ ...known, caught: false, missReason: 'post_unread' });
      else if (facts === null) rows.push({ ...known, caught: false, missReason: 'deleted' });
      else {
        const age = postedAt === null ? Infinity : (coin.launchedAt - postedAt) / MS_PER_MINUTE;
        rows.push({ ...known, caught: false, missReason: missReasonBefore(facts, age, snapshot.settings) });
      }
    }
    const xUsd = meter?.line().spentUsd ?? 0;
    await withTransaction(pool, (tx) => new PgRecallRepo(tx).record(day, now as Millis, { bonded: coins.length, metadataRead: links.size, linkedPost: linked.length, sourceCredits: credits, xUsd }, rows));
    console.log(`recorded ${rows.length} rows for ${day}; X spent $${xUsd.toFixed(4)}.`);
    await printStatus(recall, 1);
  } finally {
    await closeMeter?.();
    await pool.end();
  }
}

/* ── status ────────────────────────────────────────────────────────────────────────────────── */

async function printStatus(recall: PgRecallRepo, days: number): Promise<void> {
  const rows = await recall.status(days);
  if (rows.length === 0) {
    console.log('no daily recall check has run yet.');
    return;
  }
  const pct = (n: number, d: number) => (d <= 0 ? '—' : `${round((100 * n) / d)}%`);
  const min = (v: number | null) => (v === null ? '—' : `${round(v)} min`);
  for (const r of rows) {
    const off = r.reasons['discovery_off'] ?? 0;
    const misses = Object.entries(r.reasons).map(([k, v]) => `${k} ${v}`).join(', ') || '—';
    console.log(
      `${r.day}: ${r.bonded ?? '—'} bonded, ${r.linkedPost ?? '—'} linked a post, ${r.asked} asked, ${r.caught} caught — ` +
        `rate ${pct(r.caught, r.asked)}, while running ${pct(r.caught, r.asked - off)}; lead mean ${min(r.meanLeadMin)}, median ${min(r.medianLeadMin)}; ` +
        `${r.seenLate} more seen only after launch (median ${min(r.medianLateMin)} late)\n` +
        `            reasons: ${misses}`,
    );
  }
  console.log('asked: X posts made before their coin launched. rate while running leaves out coins whose post and launch both fell in a span when X discovery stored nothing.');
}

async function status(): Promise<void> {
  const n = Number(process.argv[3]);
  const { pool, db } = openDb();
  try {
    await printStatus(new PgRecallRepo(db), Number.isInteger(n) && n > 0 ? n : STATUS_DAYS);
  } finally {
    await pool.end();
  }
}

async function settings(): Promise<void> {
  const { pool, db } = openDb();
  try {
    console.log(JSON.stringify(await readSettings(db), null, 1));
  } finally {
    await pool.end();
  }
}

const commands: Record<string, () => Promise<void>> = { settings, 'gold-fetch': goldFetch, daily, status };
if (process.argv.includes('--detach')) {
  const child = spawn(process.execPath, [...process.execArgv, ...process.argv.slice(1).filter((a) => a !== '--detach')], { detached: true, stdio: 'inherit' });
  child.unref();
  console.log(`recall-check ${process.argv[2] ?? ''}: started in the background (pid ${child.pid ?? 'unknown'}).`);
  process.exit(0);
}
const command = commands[process.argv[2] ?? ''];
if (command === undefined) refuse(`one of: ${Object.keys(commands).join(', ')}`);
await command();
