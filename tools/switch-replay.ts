/**
 * `node --env-file=.env.local --experimental-strip-types tools/switch-replay.ts [--days 7] [--list <rule>] [--save <cache.json>]`
 *
 * WHICH RULE SHOULD MOVE A POST'S PICK TO A LATER COIN? (the owner, 2026-11-09: "3x the first coin
 * isn't a good rule … if the first one's at 30k, we're finding the other one at 90k plus. We want to get
 * it at a similar level we put the first one".) Read-only copy-test: every post of the last `--days`
 * with two or more pump.fun launch candidates, replayed minute by minute on their stored trades, under
 * a grid of switch rules, against what the coins did next and what the live rule really did.
 *
 * Why its own tool and not onecoin-replay.ts: that one scores the first pick at fixed minutes after the
 * real coin's launch. This one is about the SECOND decision — a pick already held when a newer coin
 * shows up — which is where the live hand-over (`oneCoin.handOverRatio`, three times the held coin's
 * last hour of dollars) loses most of a runner's rise: in the 7 days to 9 Nov it moved a median 54
 * minutes after the runner launched, at 1.6x left to its peak against 3.0x at its second minute.
 *
 * The replay, per post:
 *   gate      a coin may be picked at age >= `wait` when it is a pump.fun coin with cap >= oneCoin
 *             .minCapUsd, unique buyers >= minUniqueBuyers and cap per buyer <= maxCapPerBuyer —
 *             today's bars. The first coin to clear it is the first pick.
 *   switch    each minute after, any other coin that clears the gate takes the pick when the rule
 *             says so (it may move again later, by the same rule)
 *   truth     the post's runner is its candidate with the highest held peak, when that peak is at
 *             least `RAN_USD`; a coin under `DUD_USD` at its peak is a dud
 *
 * The rules compare a newer coin with the held one AT THE SAME AGE (minute N of each one's life) or
 * at the same moment, on cap, unique buyers or buy dollars, at several ratios. Each prints: of the posts
 * whose runner was not the first pick, how many reached the runner, how many minutes into the runner's
 * life, at what cap and with how much left to its peak; and the switches onto duds, which are pushes
 * of coins that never ran. "Today" is the live record (internal.coin_pick_change), not a simulation.
 *
 * ★ STORED TRADES COVER EACH COIN'S FIRST HOUR. The trade writer watches a candidate for an hour from
 * its launch (coin_watch's default), so a rule here can act only inside that hour; a post whose runner
 * or first pick has no stored minute is left out and counted. The live rule acts for two days: what it
 * does after the hour is in "today" and in no simulated rule, which can only flatter today.
 *
 * Nothing is written: the session is read-only.
 *
 * What breaks if changed carelessly: comparing caps at the same MOMENT only. A coin launched twenty
 * minutes after the held one is compared, at its minute 2, with a coin twenty-two minutes old — that is
 * how a rule ends up needing the newer coin to pass $90k before it moves.
 */

import process from 'node:process';

import { DEFAULT_POLICY } from '../contracts/src/policy.ts';
import { asDb, createPool, DB_ROLE } from '../store/src/index.ts';

const P = DEFAULT_POLICY.oneCoin;
const MIN = 60_000;
const DAY = 86_400_000;
const RAN_USD = 100_000;
const DUD_USD = 30_000;
const WATCH_MIN = 60;

const argOf = (name: string): string | null => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? null : (process.argv[i + 1] ?? null);
};
const days = Number(argOf('days') ?? '7');
const listRule = argOf('list');

export interface Minute {
  readonly cap: number;
  readonly buyers: number;
  readonly buyUsd: number;
  /** Buys less sells in SOL since launch: money that stayed in. */
  readonly netSol: number;
  /** Since launch: buy and sell trades, SOL sold, and SOL the creator sold. */
  readonly buys: number;
  readonly sells: number;
  readonly sellSol: number;
  readonly creatorSoldSol: number;
  /** The highest cap seen so far. */
  readonly highCap: number;
}
/** What the coin's first second said (internal.launch_open, 0154); null when not recorded. */
export interface Opening {
  /** First buyers on the smart list judged BEFORE the launch's day (no wallet is smart on the coin it is scored on). */
  readonly smart: number;
  readonly firstSecondBuyers: number;
  readonly devBuySol: number | null;
  readonly blockShare: number | null;
  readonly devSold: boolean | null;
}
export interface Coin {
  readonly address: string;
  readonly launchMs: number;
  readonly pumpfun: boolean;
  readonly peak: number;
  readonly opening: Opening | null;
  /** By minute of age (0 = the launch minute), cumulative where it should be; carried forward over gaps. */
  readonly byAge: readonly (Minute | null)[];
}
export interface Post {
  readonly itemId: string;
  readonly coins: readonly Coin[];
  readonly runner: Coin | null;
  readonly liveRunnerAtMs: number | null;
  /** The live pick's moves onto another coin of the post (internal.coin_pick_change), oldest first. */
  readonly liveSwitches: readonly { readonly to: string; readonly atMs: number }[];
}

type Metric = 'cap' | 'buyers' | 'buyUsd' | 'netSol';
export interface Rule {
  readonly name: string;
  readonly wait: number;
  /** null: never switch. */
  readonly test: ((held: Coin, newer: Coin, nowMs: number) => boolean) | null;
}

export const ageAt = (c: Coin, ms: number): number => Math.floor((ms - c.launchMs) / MIN);
export const at = (c: Coin, age: number): Minute | null => (age < 0 || age >= c.byAge.length ? null : c.byAge[age] ?? null);
export const nowOf = (c: Coin, ms: number): Minute | null => {
  const a = ageAt(c, ms);
  return at(c, Math.min(a, c.byAge.length - 1));
};

export function passesGate(c: Coin, ms: number, wait: number): boolean {
  if (!c.pumpfun) return false;
  const a = ageAt(c, ms);
  if (a < wait || a >= c.byAge.length) return false;
  const m = at(c, a);
  if (m === null) return false;
  return m.cap >= P.minCapUsd && m.buyers >= P.minUniqueBuyers && (P.maxCapPerBuyer === 0 || m.buyers === 0 || m.cap / m.buyers <= P.maxCapPerBuyer);
}

/** Newer at its age N against held at ITS age N. */
const sameAge = (metric: Metric, k: number) => (held: Coin, newer: Coin, ms: number): boolean => {
  const a = ageAt(newer, ms);
  const n = at(newer, a);
  const h = at(held, a);
  if (n === null || h === null) return false;
  return n[metric] >= k * h[metric];
};
const sameAgeBoth = (k: number) => (held: Coin, newer: Coin, ms: number): boolean => sameAge('cap', k)(held, newer, ms) && sameAge('buyers', k)(held, newer, ms);
/** Newer now against held now (held's newest stored minute when its hour is over). */
const sameMoment = (metric: Metric, k: number) => (held: Coin, newer: Coin, ms: number): boolean => {
  const n = nowOf(newer, ms);
  const h = nowOf(held, ms);
  if (n === null || h === null) return false;
  return n[metric] >= k * h[metric];
};

/* ── the wallet rules: who bought, not by how many times ─────────────────────────────────────────── */

const smartOf = (c: Coin): number => c.opening?.smart ?? 0;
const devSold = (c: Coin): boolean => c.opening?.devSold === true;
/** The opening's strength from the signal research (reports/signals/stage1.md §5): each signal that held out of sample counts. */
const strength = (c: Coin): number => {
  const o = c.opening;
  if (o === null) return 0;
  return 2 * Math.min(o.smart, 2) + (o.firstSecondBuyers >= 15 ? 1 : 0) + ((o.blockShare ?? 0) >= 0.3 ? 1 : 0) + ((o.devBuySol ?? 0) >= 10 ? 1 : 0) - (o.devSold === true ? 2 : 0);
};
const clean = (newer: Coin): boolean => !devSold(newer);
const smartLead = (held: Coin, newer: Coin): boolean => clean(newer) && smartOf(newer) > smartOf(held);
const smartAtLeast = (n: number) => (_held: Coin, newer: Coin): boolean => clean(newer) && smartOf(newer) >= n;
const strongerOpening = (held: Coin, newer: Coin): boolean => clean(newer) && strength(newer) > strength(held);
const moneyLeadNow = (held: Coin, newer: Coin, ms: number): boolean => clean(newer) && sameMoment('netSol', 1)(held, newer, ms) && (nowOf(newer, ms)?.netSol ?? 0) > 0;
const moneyLeadSameAge = (held: Coin, newer: Coin, ms: number): boolean => clean(newer) && sameAge('netSol', 1)(held, newer, ms) && (nowOf(newer, ms)?.netSol ?? 0) > 0;
const and = (...fs: ((h: Coin, n: Coin, ms: number) => boolean)[]) => (h: Coin, n: Coin, ms: number): boolean => fs.every((f) => f(h, n, ms));
const or = (...fs: ((h: Coin, n: Coin, ms: number) => boolean)[]) => (h: Coin, n: Coin, ms: number): boolean => fs.some((f) => f(h, n, ms));

const WALLET_RULES: readonly Rule[] = [
  { name: 'W: more smart wallets', wait: 5, test: smartLead },
  { name: 'W: 1+ smart wallet', wait: 5, test: smartAtLeast(1) },
  { name: 'W: 2+ smart wallets', wait: 5, test: smartAtLeast(2) },
  { name: 'W: stronger opening', wait: 5, test: strongerOpening },
  { name: 'W: more money in, now', wait: 5, test: moneyLeadNow },
  { name: 'W: more money in, same age', wait: 5, test: moneyLeadSameAge },
  { name: 'W: more smart wallets & cap ≥ 1x now', wait: 5, test: and(smartLead, sameMoment('cap', 1)) },
  { name: 'W: stronger opening & cap ≥ 1x now', wait: 5, test: and(strongerOpening, sameMoment('cap', 1)) },
  { name: 'W: stronger opening & more money in', wait: 5, test: and(strongerOpening, moneyLeadNow) },
  { name: 'W: more money in & cap ≥ 1x now', wait: 5, test: and(moneyLeadNow, sameMoment('cap', 1)) },
  { name: 'W: cap ≥ 1.5x now, dev not sold', wait: 5, test: and((_h, n) => clean(n), sameMoment('cap', 1.5)) },
  { name: 'W: cap ≥ 1.5x now OR (more smart & cap ≥ 1x)', wait: 5, test: or(sameMoment('cap', 1.5), and(smartLead, sameMoment('cap', 1))) },
  { name: 'W: cap ≥ 1.5x now & more money in', wait: 5, test: and(sameMoment('cap', 1.5), moneyLeadNow) },
  { name: 'W: cap ≥ 1.5x now & stronger-or-equal opening', wait: 5, test: and(sameMoment('cap', 1.5), (h, n) => clean(n) && strength(n) >= strength(h)) },
  { name: 'W: more smart wallets, wait 2', wait: 2, test: smartLead },
  { name: 'W: stronger opening & cap ≥ 1x now, wait 2', wait: 2, test: and(strongerOpening, sameMoment('cap', 1)) },
];

const RULES: readonly Rule[] = [
  { name: 'no switch (first pick only)', wait: 5, test: null },
  ...[2, 5].flatMap((wait) => [
    ...[1, 1.5, 2].map((k) => ({ name: `same age, cap ≥ ${k}x, wait ${wait}`, wait, test: sameAge('cap', k) })),
    ...[1, 1.5, 2].map((k) => ({ name: `same age, buyers ≥ ${k}x, wait ${wait}`, wait, test: sameAge('buyers', k) })),
    ...[1, 1.5, 2].map((k) => ({ name: `same age, buy $ ≥ ${k}x, wait ${wait}`, wait, test: sameAge('buyUsd', k) })),
    ...[1, 1.25, 1.5].map((k) => ({ name: `same age, cap & buyers ≥ ${k}x, wait ${wait}`, wait, test: sameAgeBoth(k) })),
    ...[1, 1.5, 3].map((k) => ({ name: `same moment, cap ≥ ${k}x, wait ${wait}`, wait, test: sameMoment('cap', k) })),
  ]),
  ...WALLET_RULES,
];

export interface Run {
  readonly first: Coin | null;
  /** When the pick first stood on the runner, if it did. */
  readonly onRunnerMs: number | null;
  readonly switches: readonly { readonly to: Coin; readonly atMs: number }[];
}

export function replay(post: Post, rule: Rule): Run {
  const start = Math.min(...post.coins.map((c) => c.launchMs));
  const end = Math.max(...post.coins.map((c) => c.launchMs + c.byAge.length * MIN));
  let held: Coin | null = null;
  let first: Coin | null = null;
  let onRunnerMs: number | null = null;
  const switches: { to: Coin; atMs: number }[] = [];
  for (let ms = start; ms <= end; ms += MIN) {
    const ready = post.coins.filter((c) => c !== held && passesGate(c, ms, rule.wait));
    if (held === null) {
      if (ready.length === 0) continue;
      held = ready.reduce((a, b) => ((nowOf(b, ms)?.cap ?? 0) > (nowOf(a, ms)?.cap ?? 0) ? b : a));
      first = held;
    } else if (rule.test !== null) {
      const taker = ready.filter((c) => rule.test!(held!, c, ms)).sort((a, b) => (nowOf(b, ms)?.cap ?? 0) - (nowOf(a, ms)?.cap ?? 0))[0];
      if (taker !== undefined) {
        held = taker;
        switches.push({ to: taker, atMs: ms });
      }
    }
    if (onRunnerMs === null && held === post.runner) onRunnerMs = ms;
  }
  return { first, onRunnerMs, switches };
}

const sorted = (xs: readonly number[]) => [...xs].sort((a, b) => a - b);
const q = (xs: readonly number[], p: number): number | null => (xs.length === 0 ? null : sorted(xs)[Math.min(xs.length - 1, Math.floor(p * xs.length))]!);
const usd = (n: number | null) => (n === null ? '—' : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1000)}k`);
const mins = (n: number | null) => (n === null ? '—' : n >= 120 ? `${(n / 60).toFixed(1)}h` : `${Math.round(n)}m`);
const times = (n: number | null) => (n === null ? '—' : `${n.toFixed(1)}x`);

interface MinuteRow {
  address: string;
  minute: Date;
  cap: number;
  new_buyers: number;
  buy_sol: number;
  sell_sol: number;
  buys: number;
  sells: number;
  creator_sold_sol: number;
}

export interface Loaded {
  readonly posts: Post[];
  readonly leftOut: number;
  readonly solUsd: number;
  readonly peakOf: ReadonlyMap<string, number>;
}

/**
 * The loaded days as a file of one post a line (`--save <file>`), read back by `fromCache` without the
 * database, so a search over many rules (an exploration script importing this file) pays the ten-minute
 * read once. A line, not one document: seven days are ~70,000 coins of sixty minutes, past the longest
 * string the runtime will build. A minute is an array in `Minute`'s field order.
 */
const MINUTE_FIELDS = ['cap', 'buyers', 'buyUsd', 'netSol', 'buys', 'sells', 'sellSol', 'creatorSoldSol', 'highCap'] as const;

export function cacheLines(l: Loaded): Iterable<string> {
  const pack = (m: Minute | null) => (m === null ? null : MINUTE_FIELDS.map((f) => Math.round(m[f] * 100) / 100));
  return (function* () {
    yield JSON.stringify({ leftOut: l.leftOut, solUsd: l.solUsd });
    for (const p of l.posts) yield JSON.stringify({ ...p, runner: p.runner?.address ?? null, coins: p.coins.map((c) => ({ ...c, byAge: c.byAge.map(pack) })) });
  })();
}

/** The file `--save` wrote, line by line (one big string would be over the runtime's limit). */
export async function readCache(path: string): Promise<Loaded> {
  const { createReadStream } = await import('node:fs');
  const { createInterface } = await import('node:readline');
  const lines: string[] = [];
  for await (const line of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) lines.push(line);
  return fromCache(lines);
}

export function fromCache(all: readonly string[]): Loaded {
  const [head, ...lines] = all.filter((s) => s !== '');
  const { leftOut, solUsd } = JSON.parse(head!) as { leftOut: number; solUsd: number };
  const unpack = (a: number[] | null): Minute | null => (a === null ? null : (Object.fromEntries(MINUTE_FIELDS.map((f, i) => [f, a[i]!])) as unknown as Minute));
  const peakOf = new Map<string, number>();
  const posts = lines.map((line) => {
    const p = JSON.parse(line) as Omit<Post, 'runner' | 'coins'> & { runner: string | null; coins: (Omit<Coin, 'byAge'> & { byAge: (number[] | null)[] })[] };
    const coins: Coin[] = p.coins.map((c) => ({ ...c, byAge: c.byAge.map(unpack) }));
    for (const c of coins) peakOf.set(c.address, c.peak);
    return { ...p, coins, runner: p.runner === null ? null : coins.find((c) => c.address === p.runner) ?? null };
  });
  return { leftOut, solUsd, peakOf, posts };
}

export async function load(): Promise<Loaded> {
  const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-switch-replay', max: 1 });
  const client = await pool.connect();
  try {
    await client.query('begin read only');
    const db = asDb(client);
    const since = new Date(Date.now() - days * DAY);
    const cands = await db.query<{ item_id: string; address: string; launched_at: Date; pumpfun: boolean }>(
      `select oc.item_id, oc.address, coalesce(oc.launched_at, a.minted_at, a.first_seen_at) as launched_at, coalesce(a.venue_id = 'solana:pumpfun', false) as pumpfun
         from internal.one_coin_candidate oc left join public.asset a on a.chain = 'solana' and a.address = oc.address
        where oc.path = 'launch' and coalesce(oc.launched_at, a.minted_at, a.first_seen_at) >= $1
          and oc.item_id in (select item_id from internal.one_coin_candidate where path = 'launch' group by item_id having count(*) >= 2)`,
      [since],
    );
    const addresses = [...new Set(cands.map((c) => c.address))];
    const px = await db.query<{ sol_usd: number | null }>(
      `select percentile_cont(0.5) within group (order by m.market_cap_usd / t.last_mcap_sol)::float8 as sol_usd
         from internal.coin_trade_minute t join public.asset a on a.address = t.address
         join public.market_reading m on m.asset_key = a.asset_key and date_trunc('minute', m.taken_at) = t.minute
        where t.minute >= $1 and m.market_cap_usd > 0`,
      [since],
    );
    const solUsd = Number(px[0]?.sol_usd ?? 0);
    const minutes = await db.query<MinuteRow>(
      `select address, minute, coalesce(last_mcap_usd, last_mcap_sol * $2)::float8 as cap, new_buyers, buy_sol::float8 as buy_sol, sell_sol::float8 as sell_sol,
              buys, sells, creator_sold_sol::float8 as creator_sold_sol
         from internal.coin_trade_minute where address = any($1::text[]) order by address, minute`,
      [addresses, solUsd],
    );
    /* The smart list judged before the launch's own day: the newest night strictly before it. */
    const openings = await db.query<{ address: string; buyers: number; dev_buy_sol: number | null; block_share: number | null; dev_sold: boolean | null; smart: number; recorded: boolean }>(
      `select lo.address, lo.buyers, lo.dev_buy_sol, lo.block_share, lo.dev_sold, lo.first_buyers is not null as recorded,
              coalesce((select count(*)::int from unnest(lo.first_buyers) w
                         where exists (select 1 from internal.smart_wallet s
                                        where s.wallet = w
                                          and s.judged_on = (select max(r.judged_on) from internal.smart_wallet_run r where r.judged_on < (lo.launched_at at time zone 'utc')::date))), 0) as smart
         from internal.launch_open lo where lo.address = any($1::text[])`,
      [addresses],
    );
    const openingOf = new Map<string, Opening>(
      openings.filter((o) => o.recorded).map((o) => [o.address, { smart: o.smart, firstSecondBuyers: o.buyers, devBuySol: o.dev_buy_sol, blockShare: o.block_share, devSold: o.dev_sold }]),
    );
    const runs = await db.query<{ n: number; first: Date | null }>(`select count(*)::int as n, min(judged_on)::timestamptz as first from internal.smart_wallet_run`);
    console.log(`smart-wallet nights judged: ${runs[0]?.n ?? 0} (from ${runs[0]?.first?.toISOString().slice(0, 10) ?? '—'}); openings recorded for ${openingOf.size} of ${addresses.length} coins, ${[...openingOf.values()].filter((o) => o.smart > 0).length} with a smart first buyer`);
    const peaks = await db.query<{ address: string; peak: number }>(
      `select a.address, max(m.market_cap_usd)::float8 as peak from public.asset a join public.market_reading m on m.asset_key = a.asset_key
        where a.chain = 'solana' and a.address = any($1::text[]) and (m.liquidity_usd is null or m.liquidity_usd >= $2) group by a.address`,
      [addresses, P.minLiquidityUsd],
    );
    const live = await db.query<{ subject_id: string; to_address: string; changed_at: Date }>(
      `select subject_id, to_address, min(changed_at) as changed_at from internal.coin_pick_change
        where subject_kind = 'post' and mode = 'live' and outcome = 'picked' and to_address is not null and changed_at >= $1 group by 1, 2`,
      [since],
    );
    const moves = await db.query<{ subject_id: string; to_address: string; changed_at: Date }>(
      `select subject_id, to_address, changed_at from internal.coin_pick_change
        where subject_kind = 'post' and mode = 'live' and outcome = 'picked' and from_address is not null and to_address is not null and changed_at >= $1
        order by changed_at`,
      [since],
    );
    const movesOf = new Map<string, { to: string; atMs: number }[]>();
    for (const m of moves) movesOf.set(m.subject_id, [...(movesOf.get(m.subject_id) ?? []), { to: m.to_address, atMs: m.changed_at.getTime() }]);

    const peakOf = new Map(peaks.map((p) => [p.address, p.peak]));
    const minsOf = new Map<string, MinuteRow[]>();
    for (const m of minutes) minsOf.set(m.address, [...(minsOf.get(m.address) ?? []), m]);
    const liveAt = new Map(live.map((l) => [`${l.subject_id}|${l.to_address}`, l.changed_at.getTime()]));

    const coinOf = (address: string, launchMs: number, pumpfun: boolean): Coin | null => {
      const ms = minsOf.get(address);
      if (ms === undefined || ms.length === 0) return null;
      const byAge: (Minute | null)[] = [];
      let buyers = 0;
      let buyUsd = 0;
      let netSol = 0;
      let buys = 0;
      let sells = 0;
      let sellSol = 0;
      let creatorSoldSol = 0;
      let highCap = 0;
      let last: Minute | null = null;
      const byMinute = new Map(ms.map((m) => [Math.floor((m.minute.getTime() - launchMs) / MIN), m]));
      for (let age = 0; age < WATCH_MIN; age++) {
        const m = byMinute.get(age);
        if (m !== undefined) {
          buyers += m.new_buyers;
          buyUsd += m.buy_sol * solUsd;
          netSol += m.buy_sol - m.sell_sol;
          buys += m.buys;
          sells += m.sells;
          sellSol += m.sell_sol;
          creatorSoldSol += m.creator_sold_sol;
          highCap = Math.max(highCap, m.cap);
          last = { cap: m.cap, buyers, buyUsd, netSol, buys, sells, sellSol, creatorSoldSol, highCap };
        }
        byAge.push(last);
      }
      return { address, launchMs, pumpfun, peak: peakOf.get(address) ?? 0, opening: openingOf.get(address) ?? null, byAge };
    };

    const byPost = new Map<string, typeof cands>();
    for (const c of cands) byPost.set(c.item_id, [...(byPost.get(c.item_id) ?? []), c]);
    const posts: Post[] = [];
    let leftOut = 0;
    for (const [itemId, cs] of byPost) {
      const coins = cs.flatMap((c) => coinOf(c.address, c.launched_at.getTime(), c.pumpfun) ?? []);
      const best = [...cs].sort((a, b) => (peakOf.get(b.address) ?? 0) - (peakOf.get(a.address) ?? 0))[0]!;
      const ran = (peakOf.get(best.address) ?? 0) >= RAN_USD;
      const runner = ran ? coins.find((c) => c.address === best.address) ?? null : null;
      if (coins.length < 2 || (ran && runner === null)) {
        leftOut++;
        continue;
      }
      posts.push({ itemId, coins, runner, liveRunnerAtMs: runner === null ? null : liveAt.get(`${itemId}|${runner.address}`) ?? null, liveSwitches: movesOf.get(itemId) ?? [] });
    }
    return { posts, leftOut, solUsd, peakOf };
  } finally {
    await client.query('rollback').catch(() => undefined);
    client.release();
    await pool.end();
  }
}

async function main(): Promise<void> {
  const loaded = await load();
  const save = argOf('save');
  if (save !== null) {
    const { openSync, writeSync, closeSync } = await import('node:fs');
    const fd = openSync(save, 'w');
    for (const line of cacheLines(loaded)) writeSync(fd, `${line}\n`);
    closeSync(fd);
    return;
  }
  const { posts, leftOut, solUsd, peakOf } = loaded;
  const withRunner = posts.filter((p) => p.runner !== null);
  console.log(`switch replay, last ${days} day(s): ${posts.length} posts with 2+ launch coins on stored trades (${leftOut} left out: under two coins with trades, or a runner with none); ${withRunner.length} with a runner ($${RAN_USD / 1000}k+); SOL at $${Math.round(solUsd)}`);

  /* Today, from the live record: when the pick first stood on the runner, as minutes into the runner's life. */
  const todayAges = withRunner.flatMap((p) => (p.liveRunnerAtMs === null ? [] : [(p.liveRunnerAtMs - p.runner!.launchMs) / MIN]));
  console.log(`today (live record): pick reached the runner on ${todayAges.length} of ${withRunner.length}; median ${mins(q(todayAges, 0.5))} into the runner's life, p75 ${mins(q(todayAges, 0.75))}`);
  console.log();

  const header = ['rule', 'took over', 'runner age', 'cap then', 'left to peak', 'held from 1st', 'onto duds', 'dud / post', 'net'];
  console.log(header.join(' | '));

  /* Today, on the same takeover posts (the simulated first pick at today's 5-minute wait was not the runner),
     in the same columns. Its cap is read off the runner's stored first hour, so a move after that hour
     shows the hour's last cap — a floor on what today really paid, which can only flatter today. */
  {
    const base = RULES.find((r) => r.test === null)!;
    const cases = posts.filter((p) => p.runner !== null && replay(p, base).first !== null && replay(p, base).first !== p.runner);
    const reached = cases.filter((p) => p.liveRunnerAtMs !== null);
    const ages = reached.map((p) => (p.liveRunnerAtMs! - p.runner!.launchMs) / MIN);
    const caps = reached.flatMap((p) => nowOf(p.runner!, p.liveRunnerAtMs!)?.cap ?? []);
    const left = reached.flatMap((p) => {
      const c = nowOf(p.runner!, p.liveRunnerAtMs!)?.cap;
      return c ? [p.runner!.peak / c] : [];
    });
    const duds = posts.reduce((n, p) => n + p.liveSwitches.filter((s) => (peakOf.get(s.to) ?? 0) < DUD_USD).length, 0);
    console.log(['TODAY (live 3x hand-over)', `${reached.length}/${cases.length}`, mins(q(ages, 0.5)), usd(q(caps, 0.5)), times(q(left, 0.5)), '—', String(duds), (duds / Math.max(1, posts.length)).toFixed(3), String(reached.length - duds)].join(' | '));
  }
  const scored: { name: string; tookOver: number; capThen: number | null; duds: number }[] = [];
  for (const rule of RULES) {
    const runs = posts.map((p) => ({ p, r: replay(p, rule) }));
    const takeoverCases = runs.filter(({ p, r }) => p.runner !== null && r.first !== null && r.first !== p.runner);
    const reached = takeoverCases.filter(({ r }) => r.onRunnerMs !== null);
    const ages = reached.map(({ p, r }) => (r.onRunnerMs! - p.runner!.launchMs) / MIN);
    const caps = reached.flatMap(({ p, r }) => nowOf(p.runner!, r.onRunnerMs!)?.cap ?? []);
    const left = reached.flatMap(({ p, r }) => {
      const c = nowOf(p.runner!, r.onRunnerMs!)?.cap;
      return c ? [p.runner!.peak / c] : [];
    });
    const heldFromFirst = runs.filter(({ p, r }) => p.runner !== null && r.first === p.runner).length;
    const duds = runs.reduce((n, { r }) => n + r.switches.filter((s) => s.to.peak < DUD_USD).length, 0);
    scored.push({ name: rule.name, tookOver: reached.length, capThen: q(caps, 0.5), duds });
    console.log([rule.name, `${reached.length}/${takeoverCases.length}`, mins(q(ages, 0.5)), usd(q(caps, 0.5)), times(q(left, 0.5)), String(heldFromFirst), String(duds), (duds / Math.max(1, posts.length)).toFixed(3), String(reached.length - duds)].join(' | '));

    if (listRule !== null && rule.name === listRule) {
      for (const { p, r } of takeoverCases) {
        console.log(`  ${p.itemId} first ${r.first!.address.slice(0, 6)} runner ${p.runner!.address.slice(0, 6)} reached ${r.onRunnerMs === null ? 'no' : mins((r.onRunnerMs - p.runner!.launchMs) / MIN)} switches ${r.switches.map((s) => `${s.to.address.slice(0, 6)}${s.to.peak < DUD_USD ? '(dud)' : ''}`).join(' → ') || '—'}`);
      }
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  });
}
