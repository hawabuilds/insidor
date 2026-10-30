/**
 * `node --env-file=.env.local --experimental-strip-types tools/odds-backfill.ts <stage> [options]`
 *
 * READS THE FIRST HOUR OF A MONTH'S SAMPLE OF LAUNCHES FROM THE CHAIN, for the launch odds a token page
 * shows (tools/odds-bands.ts turns this into 0155's bands). A research tool, not a service: it runs once,
 * by hand, for hours, and writes only to a scratch directory outside git.
 *
 *   list     the launchpad's launches of the last `--days` days from public.asset, split into those that
 *            reached a pool (graduated: a market reading quoted by a pool) and the rest, and a random
 *            sample of each (`--grads`, `--others`), shuffled together so a run stopped anywhere is still
 *            a random sample of both. Each stratum's population is recorded for the weights. Free.
 *   run      each listed coin's trades through its first hour, oldest first, one JSONL line a coin. Paid
 *            in RPC credits on the RESEARCH key.
 *   late     hours 1 to 24 of each coin already read, for the slow run (2x after the first hour). Paid
 *            on the same ledger and cap; refuses unless `--budget` calls fit under the cap.
 *   status   coins done, by stratum, and credits used.
 *
 * ★ ONLY THE RESEARCH KEY. `HELIUS_RESEARCH_KEY`, never `HELIUS_API_KEY`: the live key exhausted by a
 * backtest took the app down on 29 Oct. The tool refuses to start without the research key and never
 * reads the other.
 * ★ A HARD CAP, COUNTED HERE. Every request (a retry included) is counted in `ledger.json` before it is
 * sent, at `CREDITS_PER_CALL`, and the run stops at `CREDIT_CAP` — well under the research key's free
 * month of 1,000,000 — whatever the provider's own meter says. Paced at `MIN_GAP_MS` between requests,
 * backing off on 429 and 5xx.
 * ★ THE FIRST HOUR, NOT EVERY TRADE OF IT. A busy launch trades thousands of times in its first hour.
 * The first `DENSE_S` seconds are read in full (every feature the odds are scored on is in there), and
 * after it the read jumps to a grid of times (`GRID_S`) and reads one page at each, which is enough for
 * the hour's peak and fall to within a grid step. A quiet launch's first page covers its whole hour, so
 * most coins cost one request. The windows actually read are recorded, so nothing downstream mistakes a
 * gap between pages for an hour without trades.
 *
 * Resumable: `run` skips every coin already in the JSONL. What breaks if changed carelessly: the order of
 * the list. It is shuffled once, at `list`; re-shuffling between runs would bias a stopped run toward
 * whichever coins happened to come first in both.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

import { asDb, createPool, DB_ROLE } from '../store/src/index.ts';
import { readTx, type LaunchTrade } from './lib/launch-trades.ts';

const DIR = process.env['ODDS_DIR'] ?? '/tmp/insidor-odds';
const LIST_FILE = join(DIR, 'launches.json');
const OUT_FILE = join(DIR, 'launches.jsonl');
const LEDGER_FILE = join(DIR, 'ledger.json');

/** Measured on the research key: a full-detail page of 100 costs about ten credits. */
const CREDITS_PER_CALL = 10;
/** Stop here: 60% of the research key's free month, so a mistake cannot take the whole month. */
const CREDIT_CAP = 600_000;
/** At most two requests a second. */
const MIN_GAP_MS = 500;
const PAGE = 100;
/** A grid page reads this many trades from its time on: the hour's price there, not every trade. */
const GRID_PAGE = 50;
const HOUR_S = 3_600;
/** Read in full: the first second, the entry three seconds later, and every trade up to the minute-five
    signal, which ends with the clock minute holding launch + 5 minutes (up to 360 s after launch). */
const DENSE_S = 370;
/** At most this many full pages a coin; a launch busier than this is read on the grid from there. */
const DENSE_PAGES = 15;
/** After the dense read, one page at each of these offsets from launch. */
const GRID_S = Array.from({ length: 28 }, (_, i) => 420 + i * 120);
const MAX_RETRIES = 8;
const RPC_URL = 'https://mainnet.helius-rpc.com/';

interface Listed { readonly a: string; readonly s: 'g' | 'o'; readonly m: number }
interface ListFile { readonly from: string; readonly to: string; readonly population: { readonly g: number; readonly o: number }; readonly coins: readonly Listed[] }
interface Ledger { calls: number; credits: number; throttled: number }

const arg = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(name);
  const v = i >= 0 ? Number(process.argv[i + 1]) : fallback;
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

/** A seeded shuffle, so a re-listed sample is the same sample. */
function shuffle<T>(xs: T[], seed: number): T[] {
  let s = seed >>> 0;
  const rand = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  for (let i = xs.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [xs[i], xs[j]] = [xs[j] as T, xs[i] as T];
  }
  return xs;
}

async function list(): Promise<void> {
  const days = arg('--days', 30);
  const grads = arg('--grads', 1_500);
  const others = arg('--others', 12_000);
  const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-odds-backfill' });
  try {
    const db = asDb(pool);
    /* Two hours back at the newest, so every listed coin has its whole first hour behind it. */
    const bounds = await db.query<{ f: Date; t: Date }>(`select now() - make_interval(days => $1::int) f, now() - interval '2 hours' t`, [days]);
    const { f, t } = bounds[0] as { f: Date; t: Date };
    const pooled = await db.query<{ address: string }>(
      `select distinct address from public.market_reading
        where chain = 'solana' and quoted_by in ('solana:pool', 'solana:pool:kept') and taken_at >= $1`,
      [f],
    );
    const grad = new Set(pooled.map((r) => r.address));
    const rows = await db.query<{ address: string; m: string }>(
      `select address, (extract(epoch from minted_at) * 1000)::bigint::text m from public.asset
        where venue_id = 'solana:pumpfun' and minted_at >= $1 and minted_at < $2`,
      [f, t],
    );
    const g: Listed[] = [];
    const o: Listed[] = [];
    for (const r of rows) (grad.has(r.address) ? g : o).push({ a: r.address, s: grad.has(r.address) ? 'g' : 'o', m: Number(r.m) });
    const picked = shuffle([...shuffle(g, 1).slice(0, grads), ...shuffle(o, 2).slice(0, others)], 3);
    mkdirSync(DIR, { recursive: true });
    const file: ListFile = { from: f.toISOString(), to: t.toISOString(), population: { g: g.length, o: o.length }, coins: picked };
    writeFileSync(LIST_FILE, JSON.stringify(file));
    console.log(`${rows.length} launches ${f.toISOString()} – ${t.toISOString()}: ${g.length} reached a pool, ${o.length} did not. Listed ${picked.length}.`);
  } finally {
    await pool.end();
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function readLedger(): Ledger {
  return existsSync(LEDGER_FILE) ? (JSON.parse(readFileSync(LEDGER_FILE, 'utf8')) as Ledger) : { calls: 0, credits: 0, throttled: 0 };
}

class CapReached extends Error {}

function rpcCaller(apiKey: string, ledger: Ledger): (params: unknown) => Promise<{ data: unknown[]; token: string | null }> {
  let last = 0;
  return async (params) => {
    for (let attempt = 0; ; attempt += 1) {
      if (ledger.credits + CREDITS_PER_CALL > CREDIT_CAP) throw new CapReached(`credit cap ${CREDIT_CAP} reached`);
      /* Reserve the next free slot before waiting, so two coins in flight never share one. */
      const slot = Math.max(Date.now(), last + MIN_GAP_MS);
      last = slot;
      if (slot > Date.now()) await sleep(slot - Date.now());
      ledger.calls += 1;
      ledger.credits += CREDITS_PER_CALL;
      writeFileSync(LEDGER_FILE, JSON.stringify(ledger));
      let status = 0;
      try {
        const r = await fetch(`${RPC_URL}?api-key=${apiKey}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransactionsForAddress', params }),
          signal: AbortSignal.timeout(60_000),
        });
        status = r.status;
        if (r.ok) {
          const j = (await r.json()) as { result?: { data?: unknown[]; paginationToken?: string | null }; error?: { message?: string } };
          if (j.result !== undefined) return { data: j.result.data ?? [], token: j.result.paginationToken ?? null };
          throw new Error(`rpc error: ${j.error?.message ?? 'unknown'}`);
        }
      } catch (e) {
        if (attempt >= MAX_RETRIES) throw e;
      }
      if (status !== 0 && status !== 429 && status < 500) throw new Error(`responded ${status}`);
      if (status === 429) ledger.throttled += 1;
      if (attempt >= MAX_RETRIES) throw new Error(`gave up after ${attempt + 1} tries (last ${status})`);
      await sleep(Math.min(60_000, 1_000 * 2 ** attempt));
    }
  };
}

/** One coin's first hour: the trades read, and the windows of time they cover. */
async function readCoin(call: ReturnType<typeof rpcCaller>, address: string): Promise<Record<string, unknown>> {
  const base = { transactionDetails: 'full', sortOrder: 'asc', encoding: 'jsonParsed', maxSupportedTransactionVersion: 1 };
  const trades: LaunchTrade[] = [];
  const windows: [number, number][] = [];
  let creator: string | null = null;
  let slot0: number | null = null;
  let bt0: number | null = null;
  let graduatedAt: number | null = null;
  let calls = 0;
  let txs = 0;
  let unpriced = 0;
  let densePages = 0;
  let token: string | null = null;
  let ended = false;

  const take = (data: unknown[]): { first: number; last: number } | null => {
    let first = Infinity;
    let last = -Infinity;
    for (const tx of data) {
      const t = tx as { slot?: number; blockTime?: number };
      if (slot0 === null && typeof t.slot === 'number') {
        slot0 = t.slot;
        bt0 = t.blockTime ?? null;
      }
      const r = readTx(tx, address);
      txs += 1;
      unpriced += r.unpriced;
      if (r.creator !== null && creator === null) creator = r.creator;
      if (r.completed && graduatedAt === null) graduatedAt = t.blockTime ?? null;
      trades.push(...r.trades);
      if (typeof t.blockTime === 'number') {
        first = Math.min(first, t.blockTime);
        last = Math.max(last, t.blockTime);
      }
    }
    return Number.isFinite(first) ? { first, last } : null;
  };

  /* The dense read: from the launch on, page after page. */
  let cursor = -Infinity;
  while (!ended) {
    const page = await call([address, { ...base, limit: PAGE, filters: { status: 'succeeded' }, ...(token !== null ? { paginationToken: token } : {}) }]);
    calls += 1;
    densePages += 1;
    const span = take(page.data);
    if (span !== null) {
      windows.push([span.first, span.last]);
      cursor = span.last;
    }
    token = page.token;
    if (page.data.length < PAGE || token === null) ended = true;
    if (bt0 === null) break;
    if (cursor >= bt0 + HOUR_S || cursor >= bt0 + DENSE_S || densePages >= DENSE_PAGES) break;
  }

  const denseTo = cursor === -Infinity || bt0 === null ? 0 : cursor - bt0;
  const denseEnded = ended;

  /* The grid: one page at each grid time not already covered — and at the two minute signals' moments
     (the end of the clock minute holding launch + 1 and + 5 minutes, launch-odds.ts `signalMomentMs`),
     so a launch too busy for the dense read still has its price at each signal. */
  if (!ended && bt0 !== null) {
    const minuteEnd = (after: number): number => (Math.floor((bt0 + after) / 60) + 1) * 60 - bt0;
    const grid = [...new Set([minuteEnd(60), minuteEnd(300), ...GRID_S])].sort((a, b) => a - b);
    for (const g of grid) {
      const at = bt0 + g;
      if (at <= cursor) continue;
      if (at >= bt0 + HOUR_S) break;
      const page = await call([address, { ...base, limit: GRID_PAGE, filters: { status: 'succeeded', blockTime: { gte: at } } }]);
      calls += 1;
      const span = take(page.data);
      if (span !== null) {
        /* The window starts at the grid time asked for: nothing traded between it and the first trade. */
        windows.push([at, span.last]);
        cursor = span.last;
      }
      if (cursor >= bt0 + HOUR_S) break;
      if (page.data.length < GRID_PAGE) {
        /* Fewer than asked: these were the coin's last trades, so the rest of the hour is read too. */
        windows.push([at, bt0 + HOUR_S]);
        break;
      }
    }
  } else if (bt0 !== null && ended && cursor < bt0 + HOUR_S) {
    /* The read reached the coin's last trade inside the hour: the rest of the hour had none. */
    windows.push([cursor === -Infinity ? bt0 : cursor, bt0 + HOUR_S]);
  }

  const wallets = new Map<string, number>();
  const w = (x: string): number => {
    let i = wallets.get(x);
    if (i === undefined) {
      i = wallets.size;
      wallets.set(x, i);
    }
    return i;
  };
  const s0 = slot0 ?? 0;
  const b0 = bt0 ?? 0;
  const inHour = trades.filter((t) => t.blockTime - b0 <= HOUR_S + 60);
  const rows = inHour.map((t) => [t.slot - s0, t.blockTime - b0, w(t.wallet), t.side === 'buy' ? 1 : 0, Number(t.sol.toPrecision(5)), Number(t.price.toPrecision(6)), t.venue === 'pool' ? 1 : 0]);
  return {
    slot0,
    bt0,
    creator,
    creatorW: creator === null ? null : w(creator),
    graduatedS: graduatedAt === null || bt0 === null ? null : graduatedAt - bt0,
    windows: windows.map(([a, b]) => [a - b0, Math.min(b, b0 + HOUR_S) - b0]),
    /* Every trade up to here (seconds after launch) was read; `denseEnded`: and there were no more. */
    denseTo,
    denseEnded,
    calls,
    /* Transactions read, and trades seen with no SOL price: a coin with none of either had no trade at all. */
    txs,
    unpriced,
    wallets: [...wallets.keys()],
    /* [slot offset, seconds offset, wallet index, buy, SOL, price in SOL, on a pool] */
    trades: rows,
  };
}

async function run(): Promise<void> {
  const apiKey = process.env['HELIUS_RESEARCH_KEY'];
  if (apiKey === undefined || apiKey === '') throw new Error('HELIUS_RESEARCH_KEY is not set; this tool reads on the research key only.');
  if (!existsSync(LIST_FILE)) throw new Error('run `list` first');
  const listed = JSON.parse(readFileSync(LIST_FILE, 'utf8')) as ListFile;
  const limit = arg('--limit', Infinity);
  const done = new Set<string>();
  if (existsSync(OUT_FILE)) for (const line of readFileSync(OUT_FILE, 'utf8').split('\n')) if (line) done.add((JSON.parse(line) as { a: string }).a);
  const ledger = readLedger();
  const call = rpcCaller(apiKey, ledger);
  let n = 0;
  let capped = false;
  const started = ledger.calls;
  const queue = listed.coins.filter((c) => !done.has(c.a)).slice(0, limit);
  /* Three coins in flight: one request's download overlaps the others' waits, and the shared pace in
     `rpcCaller` still holds them to `MIN_GAP_MS` between requests. */
  const worker = async (): Promise<void> => {
    for (let c = queue.shift(); c !== undefined && !capped; c = queue.shift()) {
      try {
        const r = await readCoin(call, c.a);
        appendFileSync(OUT_FILE, JSON.stringify({ a: c.a, s: c.s, m: c.m, ...r }) + '\n');
      } catch (e) {
        if (e instanceof CapReached) {
          if (!capped) console.log(`Stopped: ${e.message}.`);
          capped = true;
          return;
        }
        appendFileSync(join(DIR, 'errors.log'), `${new Date().toISOString()} ${c.a} ${e instanceof Error ? e.message : String(e)}\n`);
      }
      n += 1;
      if (n % 100 === 0) console.log(`${new Date().toISOString()} ${done.size + n} coins, ${ledger.calls} calls (${ledger.calls - started} this run), ${ledger.credits} credits, ${ledger.throttled} throttled`);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  console.log(`Done: ${n} coins this run, ${ledger.calls} calls, ${ledger.credits} credits in all.`);
}

/* ── the slow run: hours 1 to 24 ─────────────────────────────────────────── */

const LATE_FILE = join(DIR, 'launches-late.jsonl');
const DAY_S = 86_400;
/** After hour one, one page at each of these offsets from launch: enough to see a slow 2x, not every trade. */
const LATE_GRID_S = Array.from({ length: 12 }, (_, i) => HOUR_S + i * 7_200);

/**
 * `late`: for each coin already read, its trades from hour 1 to hour 24, for "Slow run, 2x after 1h". A
 * coin whose trades ended before an hour is one request; one still trading reads one page every two hours.
 * Counted on the same ledger and stopped by the same cap: it never raises it, and it refuses to start
 * unless `--budget` calls (the caller's estimate of what the pass needs) fit under the cap.
 */
async function late(): Promise<void> {
  const apiKey = process.env['HELIUS_RESEARCH_KEY'];
  if (apiKey === undefined || apiKey === '') throw new Error('HELIUS_RESEARCH_KEY is not set; this tool reads on the research key only.');
  const ledger = readLedger();
  const budget = arg('--budget', 0);
  if (budget <= 0 || ledger.credits + budget * CREDITS_PER_CALL > CREDIT_CAP) {
    console.log(`Refusing: --budget ${budget} calls would take the ledger from ${ledger.credits} past the ${CREDIT_CAP}-credit cap (or no budget given).`);
    return;
  }
  const done = new Set<string>();
  if (existsSync(LATE_FILE)) for (const line of readFileSync(LATE_FILE, 'utf8').split('\n')) if (line) done.add((JSON.parse(line) as { a: string }).a);
  const coins = readFileSync(OUT_FILE, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as { a: string; bt0: number | null; creator: string | null });
  const call = rpcCaller(apiKey, ledger);
  const base = { transactionDetails: 'full', sortOrder: 'asc', encoding: 'jsonParsed', maxSupportedTransactionVersion: 1 };
  const start = ledger.calls;
  for (const c of coins) {
    if (done.has(c.a) || c.bt0 === null || c.creator === null) continue;
    if (ledger.calls - start >= budget) break;
    const trades: LaunchTrade[] = [];
    const windows: [number, number][] = [];
    try {
      for (const g of LATE_GRID_S) {
        const at = c.bt0 + g;
        if (windows.length > 0 && (windows[windows.length - 1] as [number, number])[1] >= at - c.bt0) continue;
        const page = await call([c.a, { ...base, limit: GRID_PAGE, filters: { status: 'succeeded', blockTime: { gte: at, lt: c.bt0 + DAY_S } } }]);
        let last = at;
        for (const tx of page.data) {
          trades.push(...readTx(tx, c.a).trades);
          const bt = (tx as { blockTime?: number }).blockTime;
          if (typeof bt === 'number') last = Math.max(last, bt);
        }
        /* Fewer than asked: the coin's last trades before hour 24 — the rest of the day is read. */
        windows.push([g, page.data.length < GRID_PAGE ? DAY_S : last - c.bt0]);
        if (page.data.length < GRID_PAGE) break;
      }
    } catch (e) {
      if (e instanceof CapReached) {
        console.log(`Stopped: ${e.message}.`);
        break;
      }
      appendFileSync(join(DIR, 'errors.log'), `${new Date().toISOString()} late ${c.a} ${e instanceof Error ? e.message : String(e)}\n`);
      continue;
    }
    /* [seconds after launch, price in SOL] — the slow run needs only the price path. */
    appendFileSync(LATE_FILE, JSON.stringify({ a: c.a, windows, prices: trades.map((t) => [t.blockTime - (c.bt0 as number), Number(t.price.toPrecision(6))]) }) + '\n');
  }
  console.log(`Late pass: ${ledger.calls - start} calls this run, ledger ${ledger.credits} credits of ${CREDIT_CAP}.`);
}

function status(): void {
  const ledger = readLedger();
  const by = { g: 0, o: 0 };
  let calls = 0;
  if (existsSync(OUT_FILE)) for (const line of readFileSync(OUT_FILE, 'utf8').split('\n')) if (line) {
    const r = JSON.parse(line) as { s: 'g' | 'o'; calls: number };
    by[r.s] += 1;
    calls += r.calls;
  }
  console.log(`Done: ${by.g} graduates, ${by.o} others; ${calls} calls in coins; ledger ${ledger.calls} calls, ${ledger.credits} credits of ${CREDIT_CAP}, ${ledger.throttled} throttled.`);
}

const stage = process.argv[2];
if (stage === 'list') await list();
else if (stage === 'run') await run();
else if (stage === 'status') status();
else if (stage === 'late') await late();
else console.log('stages: list | run [--limit N] | late --budget N | status');
