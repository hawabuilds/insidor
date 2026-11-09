/**
 * `node --env-file=.env.local --experimental-strip-types tools/launch-intel.ts [due | run | dry | report]`
 *
 * THE NIGHTLY LAUNCH-INTELLIGENCE RUN (the owner, 2026-11-08/09: smart wallets, which team launched a coin,
 * rug within an hour, peak time, and using them to push and pick better — collected for good, owner-only,
 * no database load). Asked every ten minutes by the projector's schedule (tools/railway-start.mjs) with
 * `due`; runs once per UTC day after 01:00:
 *
 *   1. exports yesterday's picks (each candidate coin, the post's facts) and launch pushes to the archive
 *      bucket as narrative/<day> — one small read-only read of indexed rows; the first run fills the week
 *   2. looks up who funded the creators of coins we pushed or picked and of coins that ran, on Helius,
 *      under a hard cap of FUNDER_CAP_CALLS calls a night (the 29 Oct rule: a small fixed cap, stop at the
 *      first refusal) — funders/<day>
 *   3. reads 21 days of the archive (launches, outcomes, graduations, funders, narrative) and works out
 *      smart wallets, teams, the rug and peak tables and the copy-tests (tools/lib/launch-intel.ts)
 *   4. writes intel/<day>/report.json, smart-wallets/latest.json and teams/latest.json
 *   5. sends the owner one summary (owner alert `launch_intel`); nobody else sees any of it
 *
 *   due     run only if today (UTC) has no report yet and it is past 01:00
 *   run     run now, replacing today's report
 *   dry     run everything but write nothing to the bucket and tell nobody
 *   report  print the latest report
 *
 * LAUNCH_INTEL_QUIET=1 on a by-hand re-run: everything as `run`, but no second summary to the owner.
 *
 * ★ OWNER-ONLY, AND RECORDED, NOT USED. Nothing here changes a push or a pick; the copy-tests say what a
 * rule would have done, for the owner to decide (the owner replays every pick change first).
 *
 * What breaks if changed carelessly: the Helius cap and the stop on refusal. The key is the live app's;
 * on 29 Oct a research read without a cap exhausted it and took the trade feed down overnight.
 */

import process from 'node:process';

import { DEFAULT_POLICY as P } from '../contracts/src/policy.ts';
import { asDb, createPool, DB_ROLE, PgOwnerAlertRepo, type Db } from '../store/src/index.ts';
import { archiveGet, archiveList, archivePut, readArchiveConfig, type ArchiveConfig } from '../adapters/storage/supabase/src/r2-archive.ts';
import { decodeGraduations, decodeLaunches, decodeOutcomes, encodeRecords, type LaunchRecord, type OutcomeRecord } from '../adapters/storage/supabase/src/launch-archive.ts';
import { gunzipSync, gzipSync } from 'node:zlib';
import {
  BOT_MAX_LAUNCHES, buildTeams, copyTestEarlyLine, copyTestPicks, copyTestRugHold, earlyWallets, peakTable, ran, rugRisk, rugTable, smartWallets, tallyWallets,
  type Outcomes, type PickCase, type PushCase, type RugFacts, type TeamLaunch,
} from './lib/launch-intel.ts';

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 21;
const NARRATIVE_BACKFILL_DAYS = 7;
const RUN_AFTER_UTC_HOUR = 1;
const FUNDER_CAP_CALLS = 1_000;
const FUNDER_PAGE = 100;
const FUNDER_MAX_PAGES = 3;
const FUNDER_PACE_MS = 300;
const FUNDER_RATE_WAIT_MS = 10_000;
const RAN_IN_HOUR_USD = 15_000;
const EARLY_LINE_TEST_USD = 13_000;
const STATEMENT_TIMEOUT_MS = 30_000;

const [cmd = 'due'] = process.argv.slice(2);
if (!['due', 'run', 'dry', 'report'].includes(cmd)) throw new Error('usage: launch-intel.ts [due | run | dry | report]');
const write = cmd !== 'dry';
const log = (msg: string, fields: Record<string, unknown> = {}): void => console.log(JSON.stringify({ level: 'info', svc: 'launch-intel', msg, ...fields }));

const archive = readArchiveConfig(process.env);
if (archive === null) { log('archive not configured; nothing to do'); process.exit(0); }
const A: ArchiveConfig = archive;

const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const today = dayOf(Date.now());
const reportPath = (day: string) => `intel/${day}/report.json`;
const gz = (o: unknown) => gzipSync(Buffer.from(JSON.stringify(o)));
const ungz = <T>(b: Uint8Array): T => JSON.parse(gunzipSync(b).toString('utf8')) as T;

if (cmd === 'report') {
  const keys = (await archiveList(A, fetch, 'intel/')).filter((k) => k.endsWith('report.json')).sort();
  const last = keys.at(-1);
  if (last === undefined) { console.log('no report yet'); process.exit(0); }
  console.log(JSON.stringify(ungz(await archiveGet(A, fetch, last) as Uint8Array), null, 2));
  process.exit(0);
}

if (cmd === 'due') {
  if (new Date().getUTCHours() < RUN_AFTER_UTC_HOUR) { log('not yet: runs after 01:00 UTC'); process.exit(0); }
  if ((await archiveList(A, fetch, `intel/${today}/`)).length > 0) { log('already ran today'); process.exit(0); }
}

const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-launch-intel', max: 1 });
async function readOnly<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin read only');
    await client.query(`set local statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
    const out = await fn(asDb(client));
    await client.query('commit');
    return out;
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/* ── 1. narrative facts: yesterday's picks and pushes, and the week before on the first run ── */

interface PickRow { kind: 'pick'; itemId: string; address: string | null; outcome: string; decidedAt: number; candidates: { address: string; path: string; launchedAt: number | null; ties: string[] }[]; post: { postedAt: number | null; firstShownAt: number | null; lang: string | null; author: string | null; views: number | null; likes: number | null; reposts: number | null } }
interface PushRow { kind: 'push'; address: string; at: number; capAtPush: number | null; early: boolean; what: string | null; item: string | null; ageMs: number | null }

async function exportNarrative(day: string): Promise<number> {
  const from = new Date(`${day}T00:00:00Z`);
  const to = new Date(from.getTime() + DAY_MS);
  return readOnly(async (db) => {
    const picks = await db.query<{ item_id: string; address: string | null; outcome: string; decided_at: Date }>(
      `select item_id, address, outcome, decided_at from internal.post_coin_pick where updated_at >= $1 and updated_at < $2`, [from, to]);
    const ids = picks.map((p) => p.item_id);
    const cands = ids.length === 0 ? [] : await db.query<{ item_id: string; address: string; path: string; launched_at: Date | null; ties: string[] | null }>(
      `select item_id, address, path, launched_at, (select array_agg(k) from jsonb_object_keys(case when jsonb_typeof(evidence) = 'object' then evidence else '{}'::jsonb end) k) as ties
         from internal.one_coin_candidate where item_id = any($1)`, [ids]);
    const posts = ids.length === 0 ? [] : await db.query<{ item_id: string; posted_at: Date | null; lang: string | null; author_key: string; counters: Record<string, unknown> | null; first_shown_at: Date | null }>(
      `select i.item_id, i.posted_at, i.lang, i.author_key, i.counters, f.first_shown_at from public.item i left join public.feed_post f on f.item_id = i.item_id where i.item_id = any($1)`, [ids]);
    const pushes = await db.query<{ subject: string; at: Date; facts: Record<string, unknown> }>(
      `select distinct on (subject) subject, at, facts from people.alert where kind = 'coin_launched' and delivery = 'push' and at >= $1 and at < $2 order by subject, at`, [from, to]);
    const candOf = new Map<string, PickRow['candidates']>();
    for (const c of cands) { const l = candOf.get(c.item_id) ?? []; l.push({ address: c.address, path: c.path, launchedAt: c.launched_at?.getTime() ?? null, ties: c.ties ?? [] }); candOf.set(c.item_id, l); }
    const postOf = new Map(posts.map((p) => [p.item_id, p]));
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const rows: (PickRow | PushRow)[] = [
      ...picks.map((p): PickRow => {
        const q = postOf.get(p.item_id);
        const c = q?.counters ?? {};
        return {
          kind: 'pick', itemId: p.item_id, address: p.address, outcome: p.outcome, decidedAt: p.decided_at.getTime(), candidates: candOf.get(p.item_id) ?? [],
          post: { postedAt: q?.posted_at?.getTime() ?? null, firstShownAt: q?.first_shown_at?.getTime() ?? null, lang: q?.lang ?? null, author: q?.author_key ?? null, views: n(c['views']), likes: n(c['likes']), reposts: n(c['reposts']) },
        };
      }),
      ...pushes.map((p): PushRow => ({
        kind: 'push', address: p.subject, at: p.at.getTime(), capAtPush: n(p.facts['mcUsd']),
        early: p.facts['early'] === true || p.facts['what'] === 'early-pick', what: typeof p.facts['what'] === 'string' ? p.facts['what'] : null,
        item: typeof p.facts['item'] === 'string' ? p.facts['item'] : null, ageMs: n(p.facts['ageMs']),
      })),
    ];
    if (write) await archivePut(A, fetch, `narrative/${day}.jsonl.gz`, encodeRecords(rows as never), 'application/gzip');
    return rows.length;
  });
}

const haveNarrative = new Set(await archiveList(A, fetch, 'narrative/'));
for (let d = NARRATIVE_BACKFILL_DAYS; d >= 1; d -= 1) {
  const day = dayOf(Date.now() - d * DAY_MS);
  const path = `narrative/${day}.jsonl.gz`;
  if (d > 1 && haveNarrative.has(path)) continue;
  try { log('narrative exported', { day, rows: await exportNarrative(day) }); } catch (e) { log('narrative export failed; the report goes on without it', { day, err: e instanceof Error ? e.message : String(e) }); }
}

/* ── 2. read the archive ── */

const sinceMs = Date.now() - WINDOW_DAYS * DAY_MS;
const inWindow = (key: string): boolean => { const m = /(\d{4}-\d{2}-\d{2})/.exec(key); return m === null || Date.parse(`${m[1]}T00:00:00Z`) >= sinceMs - DAY_MS; };
async function readAll<T>(prefix: string, decode: (b: Uint8Array) => T[]): Promise<T[]> {
  const out: T[] = [];
  for (const k of (await archiveList(A, fetch, prefix)).filter(inWindow)) {
    const b = await archiveGet(A, fetch, k);
    if (b !== null) for (const r of decode(b)) out.push(r);
  }
  return out;
}

interface Compact { a: string; t: number; creator: string | null; early: string[]; devSold: boolean | null; block: number | null; devSol: number | null; buyers: number }
const launches = new Map<string, Compact>();
for (const k of (await archiveList(A, fetch, 'launches/')).filter(inWindow)) {
  const b = await archiveGet(A, fetch, k);
  if (b === null) continue;
  for (const l of decodeLaunches(b) as LaunchRecord[]) {
    const prev = launches.get(l.address);
    if (prev !== undefined && prev.creator !== null && l.creator === null) continue;
    launches.set(l.address, { a: l.address, t: l.launchedAt, creator: l.creator, early: earlyWallets(l).slice(0, 8), devSold: l.devSold, block: l.blockShare, devSol: l.devBuySol, buyers: l.firstBuyers?.length ?? l.buyers });
  }
}
const outcomes = new Map<string, { h1?: OutcomeRecord; h24?: OutcomeRecord; d7?: OutcomeRecord }>();
for (const h of ['1h', '24h', '7d'] as const) {
  for (const o of await readAll(`outcomes/${h}/`, decodeOutcomes)) {
    const v = outcomes.get(o.address) ?? {};
    if (h === '1h') v.h1 = o; else if (h === '24h') v.h24 = o; else v.d7 = o;
    outcomes.set(o.address, v);
  }
}
const graduated = new Set((await readAll('graduations/', decodeGraduations)).map((g) => g.address));
const funders = new Map<string, string | null>();
for (const k of await archiveList(A, fetch, 'funders/')) { const b = await archiveGet(A, fetch, k); if (b !== null) for (const [w, f] of Object.entries(ungz<Record<string, string | null>>(b))) funders.set(w, f); }
const narrative: (PickRow | PushRow)[] = [];
for (const k of (await archiveList(A, fetch, 'narrative/')).filter(inWindow)) {
  const b = await archiveGet(A, fetch, k);
  if (b !== null) for (const l of gunzipSync(b).toString('utf8').split('\n')) if (l.trim() !== '') narrative.push(JSON.parse(l) as PickRow | PushRow);
}
log('archive read', { launches: launches.size, outcomes: outcomes.size, graduated: graduated.size, funders: funders.size, narrative: narrative.length });

/* ── 3. funders of the creators that matter, under the cap ── */

const ows = (a: string): Outcomes => outcomes.get(a) ?? {};
const winner = (a: string): boolean => ran(ows(a), graduated.has(a));
let funderCalls = 0;
let funderStopped: string | null = null;
let funderSkipped = 0;
const heliusKey = (process.env['HELIUS_API_KEY'] ?? '').trim();
let lastCallAt = 0;
let waitedOnRate = false;
async function rpc(method: string, params: unknown[]): Promise<unknown> {
  if (funderCalls >= FUNDER_CAP_CALLS) throw new Error('cap');
  /* Paced well under the key's rate so the live app's own calls are never crowded out. */
  const wait = lastCallAt + FUNDER_PACE_MS - Date.now();
  if (wait > 0) await new Promise((res) => setTimeout(res, wait));
  lastCallAt = Date.now();
  funderCalls += 1;
  const r = await fetch(`https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(heliusKey)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(15_000) });
  /* One rate refusal is waited out once; a second, or out of credits, stops the night. */
  if (r.status === 429 && !waitedOnRate) { waitedOnRate = true; await new Promise((res) => setTimeout(res, FUNDER_RATE_WAIT_MS)); return rpc(method, params); }
  if (r.status === 429 || r.status === 402 || r.status === 403) throw new Refused(`refused ${r.status}`);
  const j = (await r.json()) as { result?: unknown; error?: { code?: number; message?: string } };
  /* A refusal of the key (rate, credits) stops the night; anything else is this wallet's and only skips it. */
  if (j.error !== undefined && (j.error.code === -32429 || /rate|limit|credit|usage|quota/i.test(j.error.message ?? ''))) throw new Refused(`refused ${j.error.code ?? ''}`);
  if (j.error !== undefined) throw new Error(`skipped ${j.error.code ?? ''}`);
  return j.result;
}
class Refused extends Error {}
async function funderOf(wallet: string): Promise<string | null> {
  let before: string | undefined;
  let oldest: string | null = null;
  for (let page = 0; page < FUNDER_MAX_PAGES; page += 1) {
    const sigs = (await rpc('getSignaturesForAddress', [wallet, { limit: FUNDER_PAGE, ...(before === undefined ? {} : { before }) }])) as { signature: string }[] | null;
    if (sigs === null || sigs.length === 0) break;
    oldest = sigs[sigs.length - 1]!.signature;
    if (sigs.length < FUNDER_PAGE) break;
    before = oldest;
  }
  if (oldest === null) return null;
  const tx = (await rpc('getTransaction', [oldest, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }])) as { transaction?: { message?: { instructions?: unknown[] } }; meta?: { innerInstructions?: { instructions?: unknown[] }[] } } | null;
  const all = [...(tx?.transaction?.message?.instructions ?? []), ...(tx?.meta?.innerInstructions ?? []).flatMap((i) => i.instructions ?? [])] as { parsed?: { type?: string; info?: { source?: string; destination?: string } } }[];
  const t = all.find((i) => i.parsed?.type === 'transfer' && i.parsed.info?.destination === wallet && typeof i.parsed.info.source === 'string');
  return t?.parsed?.info?.source ?? null;
}
const pushedOrPicked = new Set(narrative.flatMap((r) => (r.kind === 'push' ? [r.address] : r.address !== null ? [r.address] : [])));
const wantFunder = [...launches.values()]
  .filter((l) => l.creator !== null && !funders.has(l.creator) && (pushedOrPicked.has(l.a) || winner(l.a)))
  .sort((x, y) => Number(pushedOrPicked.has(y.a)) - Number(pushedOrPicked.has(x.a)) || y.t - x.t);
const newFunders: Record<string, string | null> = {};
if (heliusKey !== '' && write) {
  for (const l of wantFunder) {
    if (funderCalls >= FUNDER_CAP_CALLS - FUNDER_MAX_PAGES - 1) { funderStopped = 'cap'; break; }
    try { const f = await funderOf(l.creator!); newFunders[l.creator!] = f; funders.set(l.creator!, f); } catch (e) {
      if (e instanceof Refused || (e instanceof Error && e.message === 'cap')) { funderStopped = e.message; break; }
      funderSkipped += 1;
    }
  }
  if (Object.keys(newFunders).length > 0) await archivePut(A, fetch, `funders/${today}.json.gz`, gz(newFunders), 'application/gzip');
}
log('funders', { wanted: wantFunder.length, found: Object.keys(newFunders).length, skipped: funderSkipped, calls: funderCalls, stopped: funderStopped });

/* ── 4. the numbers ── */

const allLaunches = [...launches.values()];
const walletCount = tallyWallets(allLaunches.map((l) => ({ early: l.early, won: winner(l.a) })));
const smart = smartWallets(walletCount);
const smartSet = new Set(smart.map((s) => s.wallet));
const bots = new Set([...walletCount.tally].filter(([, v]) => v.launches > BOT_MAX_LAUNCHES).map(([w]) => w));
const teamInput: TeamLaunch[] = allLaunches.map((l) => ({
  address: l.a, creator: l.creator, funder: l.creator === null ? null : funders.get(l.creator) ?? null, early: l.early,
  won: winner(l.a), rug: ows(l.a).h1?.complete === true ? ows(l.a).h1!.crashAt !== null : null, peakAt: ows(l.a).h24?.peakAt ?? null, launchedAt: l.t,
}));
const teams = buildTeams(teamInput, bots);
const teamOf = new Map<string, (typeof teams)[number]>();
for (const t of teams) for (const a of t.launches) teamOf.set(a, t);

const factsOf = (l: Compact): { f: RugFacts; teamKnown: number } => {
  const t = teamOf.get(l.a);
  const own = ows(l.a).h1;
  const ownKnown = own?.complete === true ? 1 : 0;
  const ownRug = own?.complete === true && own.crashAt !== null ? 1 : 0;
  const known = t === undefined ? 0 : t.rugKnown - ownKnown;
  return {
    f: { devSoldEarly: l.devSold, blockShare: l.block, devBuySol: l.devSol, buyers: l.buyers, smart: l.early.filter((w) => smartSet.has(w)).length, teamRugShare: t === undefined || known <= 0 ? null : (t.rugs - ownRug) / known },
    teamKnown: known,
  };
};

const rugRows = allLaunches.flatMap((l) => { const o = ows(l.a).h1; return o?.complete === true ? [{ f: factsOf(l).f, rug: o.crashAt !== null }] : []; });
const peakRows = allLaunches.flatMap((l) => {
  const o = ows(l.a);
  const best = o.d7 ?? o.h24;
  return best !== undefined && best.complete && best.peakAt !== null && (best.peakCapUsd ?? 0) >= 100_000 ? [{ launchedAt: l.t, peakAt: best.peakAt }] : [];
});

const lastWeek = Date.now() - 7 * DAY_MS;
const pushCases: PushCase[] = narrative.flatMap((r) => {
  if (r.kind !== 'push' || r.at < lastWeek) return [];
  const o = ows(r.address).h1;
  if (o === undefined || !o.complete) return [];
  const l = launches.get(r.address);
  const ff = l === undefined ? null : factsOf(l);
  return [{ address: r.address, capAtPush: r.capAtPush, early: r.early, peak1h: o.peakCapUsd, ranAfter: (o.peakCapUsd ?? 0) >= RAN_IN_HOUR_USD, rugRisk: ff === null ? false : rugRisk(ff.f, ff.teamKnown) }];
});
const pickCases: PickCase[] = narrative.flatMap((r) => {
  if (r.kind !== 'pick' || r.outcome !== 'picked' || r.address === null || r.decidedAt < lastWeek) return [];
  return [{
    picked: r.address,
    candidates: r.candidates.map((c) => {
      const l = launches.get(c.address);
      const ff = l === undefined ? null : factsOf(l);
      const o = ows(c.address).h1;
      return { address: c.address, peak1h: o?.complete === true ? o.peakCapUsd : null, rugRisk: ff === null ? false : rugRisk(ff.f, ff.teamKnown), smart: l === undefined ? 0 : l.early.filter((w) => smartSet.has(w)).length };
    }),
  }];
});

const withCreator = allLaunches.filter((l) => l.creator !== null).length;
const report = {
  day: today,
  at: new Date().toISOString(),
  collected: {
    launches: allLaunches.length, withCreator, withOutcome1h: [...outcomes.values()].filter((o) => o.h1 !== undefined).length,
    withOutcome24h: [...outcomes.values()].filter((o) => o.h24 !== undefined).length, withOutcome7d: [...outcomes.values()].filter((o) => o.d7 !== undefined).length,
    graduated: graduated.size, funders: funders.size, narrativeRows: narrative.length,
  },
  smartWallets: { count: smart.length, top: smart.slice(0, 20), winners: walletCount.wins, launchesCounted: walletCount.n },
  teams: { count: teams.length, launchesInTeams: teams.reduce((s, t) => s + t.launches.length, 0), biggest: teams.slice(0, 10).map((t) => ({ launches: t.launches.length, wins: t.wins, rugs: t.rugs, rugKnown: t.rugKnown, via: t.via })) },
  rugWithinHour: rugTable(rugRows),
  peakTime: peakTable(peakRows),
  copyTests: {
    earlyLine13k: copyTestEarlyLine(pushCases, EARLY_LINE_TEST_USD),
    holdRugRisk: copyTestRugHold(pushCases),
    picks: copyTestPicks(pickCases),
  },
  funderLookups: { calls: funderCalls, found: Object.keys(newFunders).length, skipped: funderSkipped, wanted: wantFunder.length, stopped: funderStopped },
};

if (write) {
  await archivePut(A, fetch, reportPath(today), gz(report), 'application/gzip');
  await archivePut(A, fetch, 'smart-wallets/latest.json', gz({ day: today, wallets: smart }), 'application/gzip');
  await archivePut(A, fetch, 'teams/latest.json', gz({ day: today, teams }), 'application/gzip');
}
log('report', { day: today, smart: smart.length, teams: teams.length, rugRows: rugRows.length, peakRows: peakRows.length, pushCases: pushCases.length, pickCases: pickCases.length, written: write });

/* ── 5. the owner's summary (LAUNCH_INTEL_QUIET=1 for a by-hand re-run the same day: no second summary) ── */

if (write && process.env['LAUNCH_INTEL_QUIET'] !== '1') {
  try {
    const all = report.rugWithinHour['all launches'];
    const early = report.copyTests.earlyLine13k;
    const picks = report.copyTests.picks;
    await readWrite(async (db) => {
      const alerts = new PgOwnerAlertRepo(db);
      for (const userId of await alerts.ownerIds(P.owner.wallets)) {
        await alerts.queue(userId, {
          kind: 'launch_intel', subject: `launch_intel|${today}`, rung: 1, href: '/#/alerts',
          facts: {
            launches: allLaunches.length, withCreator, smart: smart.length, teams: teams.length,
            rugPct: all?.pct ?? null, rugN: all?.n ?? 0,
            pushBefore: early.before.pct, pushAfter: early.after.pct, pushN: early.before.n,
            picksAsPicked: picks.asPicked.pct, picksWithRule: picks.withRule.pct, picksN: picks.asPicked.n,
            funders: report.funderLookups.found,
          },
        });
      }
    });
  } catch (e) {
    log('owner summary not queued; the report is in the bucket all the same', { err: e instanceof Error ? e.message : String(e) });
  }
}

async function readWrite(fn: (db: Db) => Promise<void>): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`set local statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
    await fn(asDb(client));
    await client.query('commit');
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

await pool.end();
