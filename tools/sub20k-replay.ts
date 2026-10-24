/**
 * `node --env-file=.env.local --experimental-strip-types tools/sub20k-replay.ts [--from ISO] [--to ISO]
 *    [--hour-era] [--case item_id] [--show "label,label"] [--list] [--runners] [--dump]`
 *
 * CAN AN EARLY BAR PICK A POST'S COIN WHILE IT IS UNDER $20K? (the owner, 2026-10-24: "I preferably
 * want to catch the coins below 20k market cap".) Read-only replay of the stored days: every post the
 * matcher gave two or more launch candidates, each candidate's market readings cut at every moment we
 * read one, run through a grid of early bars that may fire only while the coin is under $20K, against
 * what the coin did next and against what the live rule and the launch push really did.
 *
 * Its own tool, not a mode of onecoin-replay.ts, because it asks a different question. That one
 * scores the rule in force at fixed minutes after the REAL coin's launch. This one asks where each bar
 * first commits — one pick per post, one push per coin — at what cap and how many minutes in, and
 * whether that coin then ran (held $50K / $100K inside 24 h) or died (never held $20K). An early bar
 * is read as an ADDITION to today's rule: its runners are counted as minutes sooner than the live
 * pick, its deaths as new noise only when the live rule never picked that coin.
 *
 * ★ READINGS, NOT TRADES, BECAUSE THAT IS WHAT WAS STORED. The trade feed hits its daily credit cap
 * every day; most watched coins are cut ('day_cap') before they trade and busy ones by 'outage' within
 * minutes. So the bars run on public.market_reading, and the trade-minute bar is printed only over the
 * coins the feed held from launch to +K. The reading's last hour (dollars, buys, sells) exists only
 * from 2026-10-23 23:21 UTC: before it only the cap bars can be judged, so the buyer and volume bars
 * are tried only with `--hour-era` over a window that starts there.
 *
 * ★ A CAP IS HELD OR IT IS NOT A PEAK. A coin's peak is the highest cap the NEXT reading at least
 * four minutes later still met. Without it the "runners" were mostly launches read once at $260-420K
 * a minute in, on a $40-50K pool, and at $2-3K an hour later.
 *
 * ★ AN UNREAD RIVAL IS ZERO HERE, AS IN THE LIVE READINGS RULE: a coin with no reading cannot block a
 * pick. That favours early picks; the replay counts the picks made while a rival was still unread.
 * Rivals are the post's candidates launched in the hour before the moment judged — the launch wave;
 * an older coin of the post is the incumbent, which the live hand-overs judge.
 *
 * Nothing is written: the session is read-only.
 *
 * What breaks if changed carelessly: evaluating only the coin that was just read. A rival's reading
 * that falls can hand the lead to a coin read minutes ago; every candidate is re-judged at every
 * reading of any candidate of the post, as the live rule re-judges on every update.
 */

import process from 'node:process';

import { DEFAULT_POLICY } from '../contracts/src/policy.ts';
import { asDb, createPool, DB_ROLE } from '../store/src/index.ts';

const P = DEFAULT_POLICY.oneCoin;
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
/** Outcome bars: the owner's "ran" and "died" lines for this question. */
const HIT_USD = 50_000;
const BIG_USD = 100_000;
const DEAD_USD = 20_000;
const STRONG = new Set(['link', 'name_stated', 'picture']);
/** Rivals are the post's candidates launched within this long before the moment judged (the watch). */
const RIVAL_WINDOW_MS = P.watchMs;
/**
 * A cap is a coin's only when the next reading this much later is as high (min of the two). Without
 * it the "runners" were mostly launches read once at $260-420K a minute in, on a $40-50K pool, and at
 * $2-3K an hour later — the live rule picked and pushed several of them.
 */
const HOLD_MS = 4 * MIN;

const argOf = (name: string): string | null => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? null : (process.argv[i + 1] ?? null);
};

interface Reading { t: number; cap: number | null; vol: number | null; buys: number | null; sells: number | null }
interface Cand { item: string; address: string; launched: number; ties: string[]; strong: boolean }
/** `peak`: the held peak (HOLD_MS); null when it cannot be told. `spikeOnly`: read high once, never held. */
interface Coin { address: string; readings: Reading[]; peak: number | null; peakAt: number | null; reads24h: number; spikeOnly?: boolean }

type Strength = 'vol' | 'net' | 'climb';
interface Bar {
  label: string;
  strength: Strength;
  lead: number;
  minCap: number;
  minBuys: number;
  /** A pick may be made only this long after the coin's launch. */
  withinMs: number;
  /** Judged from this long after the coin's launch (the live rule's judgeFromMs). */
  fromMs: number;
  /** The tie the picked coin must carry: a link, any strong tie (link / stated name / picture), or any. */
  ties: 'link' | 'strong' | 'any';
  /** Rivals: every candidate of the post, or only the strong ones. */
  rivals: 'all' | 'strong';
}
interface Pick { item: string; address: string; t: number; ageMin: number; cap: number; unreadRival: boolean; strong: boolean }

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const k = (n: number | null): string => (n === null ? '—' : n >= 1000 ? `$${(n / 1000).toFixed(1)}K` : `$${Math.round(n)}`);
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function strengthOf(r: Reading | undefined, s: Strength): number {
  if (r === undefined) return 0;
  if (s === 'vol') return r.vol ?? 0;
  if (s === 'net') return (r.buys ?? 0) - (r.sells ?? 0);
  return Math.max(0, (r.cap ?? 0) - P.openingCapUsd);
}

/** The latest reading at or before t (readings sorted by time). */
function at(rs: Reading[], t: number): Reading | undefined {
  let lo = 0;
  let hi = rs.length - 1;
  let best: Reading | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rs[mid]!.t <= t) { best = rs[mid]; lo = mid + 1; } else hi = mid - 1;
  }
  return best;
}

function firstPick(cands: Cand[], coins: Map<string, Coin>, bar: Bar): Pick | null {
  const events: number[] = [];
  for (const c of cands) {
    for (const r of coins.get(c.address)?.readings ?? []) {
      const age = r.t - c.launched;
      if (age >= bar.fromMs && age <= bar.withinMs) events.push(r.t);
    }
  }
  events.sort((a, b) => a - b);
  for (const t of events) {
    for (const c of cands) {
      if ((bar.ties === 'strong' && !c.strong) || (bar.ties === 'link' && !c.ties.includes('link'))) continue;
      const age = t - c.launched;
      if (age < bar.fromMs || age > bar.withinMs) continue;
      const rs = coins.get(c.address)?.readings ?? [];
      const r = at(rs, t);
      if (r === undefined || r.cap === null || r.cap < bar.minCap || r.cap >= DEAD_USD) continue;
      if ((r.buys ?? 0) < bar.minBuys) continue;
      const mine = strengthOf(r, bar.strength);
      if (mine <= 0) continue;
      let best = 0;
      let unread = false;
      for (const o of cands) {
        /* The launch wave only: a coin of the post launched hours before is an incumbent, which the
           live rule's hand-over and the runner hand-over judge — not this race. */
        if (o.address === c.address || o.launched > t || o.launched < t - RIVAL_WINDOW_MS) continue;
        if (bar.rivals === 'strong' && !o.strong) continue;
        const or = at(coins.get(o.address)?.readings ?? [], t);
        if (or === undefined) unread = true;
        best = Math.max(best, strengthOf(or, bar.strength));
      }
      if (mine >= bar.lead * best) return { item: c.item, address: c.address, t, ageMin: age / MIN, cap: r.cap, unreadRival: unread, strong: c.strong };
    }
  }
  return null;
}

async function main(): Promise<void> {
  const now = Date.now();
  const fromMs = Date.parse(argOf('from') ?? new Date(now - 4 * DAY).toISOString());
  const toMs = Date.parse(argOf('to') ?? new Date(now - 6 * HOUR).toISOString());
  const caseItem = argOf('case');
  /* The market reading carries its last hour's dollars and trades only from 2026-10-23 23:21 UTC: before it, only the cap bars can be judged. */
  const hourEra = process.argv.includes('--hour-era');
  const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-sub20k-replay', max: 1 });
  const client = await pool.connect();
  try {
    await client.query('begin read only');
    const db = asDb(client);

    /* ── candidates: launch-path ties of coins launched in the window ── */
    const candRows = (await db.query(
      `select item_id, address, launched_at, evidence->'ties' ties from internal.one_coin_candidate
        where path = 'launch' and launched_at >= $1 and launched_at < $2`,
      [new Date(fromMs), new Date(toMs)],
    )) as { item_id: string; address: string; launched_at: Date; ties: string[] | null }[];
    const byPost = new Map<string, Cand[]>();
    for (const r of candRows) {
      const ties = (r.ties ?? []).filter((t) => t !== 'existing');
      const c: Cand = { item: r.item_id, address: r.address, launched: r.launched_at.getTime(), ties, strong: ties.some((t) => STRONG.has(t)) };
      const list = byPost.get(r.item_id) ?? [];
      list.push(c);
      byPost.set(r.item_id, list);
    }
    const posts = [...byPost].filter(([, cs]) => cs.length >= 2);
    const wanted = new Set(posts.flatMap(([, cs]) => cs.map((c) => c.address)));

    /* ── readings, by six-hour slices so no one statement runs long ── */
    const coins = new Map<string, Coin>();
    for (let s = fromMs; s < toMs + DAY; s += 6 * HOUR) {
      const rows = (await db.query(
        `select address, taken_at, market_cap_usd, liquidity_usd, volume_1h_usd, buys_1h, sells_1h
           from public.market_reading where taken_at >= $1 and taken_at < $2`,
        [new Date(s), new Date(s + 6 * HOUR)],
      )) as { address: string; taken_at: Date; market_cap_usd: number | null; liquidity_usd: number | null; volume_1h_usd: number | null; buys_1h: number | null; sells_1h: number | null }[];
      for (const r of rows) {
        if (!wanted.has(r.address)) continue;
        /* A quote with no pool is not a price (one-coin.ts): its cap is left unknown. */
        const pooled = r.liquidity_usd === null || r.liquidity_usd >= P.minLiquidityUsd;
        const coin = coins.get(r.address) ?? { address: r.address, readings: [], peak: null, peakAt: null, reads24h: 0 };
        coin.readings.push({ t: r.taken_at.getTime(), cap: pooled ? num(r.market_cap_usd) : null, vol: num(r.volume_1h_usd), buys: num(r.buys_1h), sells: num(r.sells_1h) });
        coins.set(r.address, coin);
      }
    }
    const launchOf = new Map<string, number>();
    for (const [, cs] of posts) for (const c of cs) launchOf.set(c.address, c.launched);
    for (const coin of coins.values()) {
      coin.readings.sort((a, b) => a.t - b.t);
      const l = launchOf.get(coin.address)!;
      const day = coin.readings.filter((r) => r.t <= l + DAY && r.cap !== null);
      coin.reads24h = day.length;
      /* The HELD peak: a cap counts only as high as the next reading at least `HOLD_MS` later. */
      for (let i = 0; i < day.length; i++) {
        const j = day.findIndex((r) => r.t >= day[i]!.t + HOLD_MS);
        if (j < 0) break;
        let held = day[i]!.cap!;
        for (let x = i + 1; x <= j; x++) held = Math.min(held, day[x]!.cap!);
        if (coin.peak === null || held > coin.peak) { coin.peak = held; coin.peakAt = day[i]!.t; }
      }
      /* Never held across two readings: its one reading is all we know, and a low one is low. */
      if (coin.peak === null) {
        const top = Math.max(0, ...day.map((r) => r.cap!));
        coin.peak = top < DEAD_USD && day.length > 0 ? top : null;
        coin.spikeOnly = top >= DEAD_USD;
      }
    }

    /* ── trade-feed coverage, counted only ── */
    const watch = (await db.query(
      `select address, measured_from, coalesce(unmeasured_from, measured_to) measured_until, unmeasured_reason
         from internal.coin_watch where since >= $1 and since < $2`,
      [new Date(fromMs - DAY), new Date(toMs + DAY)],
    )) as { address: string; measured_from: Date | null; measured_until: Date | null; unmeasured_reason: string | null }[];
    const measured = new Map(watch.map((w) => [w.address, w]));
    const measuredAt = (a: string, t: number): boolean => {
      const w = measured.get(a);
      return w?.measured_from != null && w.measured_from.getTime() <= t && (w.measured_until?.getTime() ?? 0) >= t;
    };

    /* ── what the live rule did: each post's first live pick of each coin ── */
    const live = (await db.query(
      `select subject_id, to_address, min(changed_at) at from internal.coin_pick_change
        where subject_kind = 'post' and mode = 'live' and to_address is not null and changed_at >= $1
        group by 1, 2`,
      [new Date(fromMs)],
    )) as { subject_id: string; to_address: string; at: Date }[];
    const liveAt = new Map(live.map((r) => [`${r.subject_id}|${r.to_address}`, r.at.getTime()]));
    const liveFirst = new Map<string, { address: string; t: number }>();
    for (const r of live) {
      const f = liveFirst.get(r.subject_id);
      if (f === undefined || r.at.getTime() < f.t) liveFirst.set(r.subject_id, { address: r.to_address, t: r.at.getTime() });
    }

    /* ── who could have been pushed: For You before the coin, or a coin-first post ── */
    const shown = new Map(((await db.query(
      `select item_id, min(first_shown_at) at from public.feed_post where item_id = any($1) group by 1`,
      [posts.map(([p]) => p)],
    )) as { item_id: string; at: Date }[]).map((r) => [r.item_id, r.at.getTime()]));
    const coinFirst = new Set(((await db.query(
      `select item_id from internal.coin_first_post where item_id = any($1)`,
      [posts.map(([p]) => p)],
    )) as { item_id: string }[]).map((r) => r.item_id));
    const pushable = (p: Pick): boolean => coinFirst.has(p.item) || (shown.has(p.item) && shown.get(p.item)! <= launchOf.get(p.address)!);

    const days = (toMs - fromMs) / DAY;
    const withMin = new Set([...coins.keys()].filter((a) => measured.get(a)?.measured_from != null));
    console.log(`window ${new Date(fromMs).toISOString()} → ${new Date(toMs).toISOString()} (${days.toFixed(2)} days)`);
    console.log(`posts with ≥2 launch candidates: ${posts.length}; their coins: ${wanted.size}; with any reading: ${coins.size}; ever measured by the trade feed: ${withMin.size}`);
    const reasons = new Map<string, number>();
    for (const a of wanted) { const w = measured.get(a); const r = w === undefined ? 'not watched' : w.unmeasured_reason ?? 'measured to the end'; reasons.set(r, (reasons.get(r) ?? 0) + 1); }
    console.log(`trade feed on these coins: ${[...reasons].sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r} ${n}`).join(', ')}`);

    /* How often a candidate is read in its first hour: an early bar has only these looks. */
    {
      const n10: number[] = [];
      let later = 0;
      let all = 0;
      for (const [a, l] of launchOf) {
        const rs = coins.get(a)?.readings ?? [];
        all += 1;
        n10.push(rs.filter((r) => r.t - l <= 10 * MIN).length);
        if (rs.some((r) => r.t - l > 10 * MIN && r.t - l <= HOUR)) later += 1;
      }
      const s = [...n10].sort((x, y) => x - y);
      console.log(`market readings a candidate gets: in its first 10 min a median ${s[Math.floor(s.length / 2)]} (90th pct ${s[Math.floor(s.length * 0.9)]}); any reading between +10 and +60 min: ${Math.round((100 * later) / Math.max(1, all))}% of candidates`);
    }

    const outcome = (a: string): 'big' | 'hit' | 'mid' | 'dud' | 'thin' => {
      const c = coins.get(a);
      if (c === undefined || c.peak === null) return 'thin';
      if (c.peak >= BIG_USD) return 'big';
      if (c.peak >= HIT_USD) return 'hit';
      if (c.peak >= DEAD_USD) return 'mid';
      return c.reads24h < 2 ? 'thin' : 'dud';
    };
    const ran = (a: string): boolean => outcome(a) === 'hit' || outcome(a) === 'big';
    /* Each live coin's first live pick, on any post: "today" for a coin the bar picks on another post. */
    const liveCoinAt = new Map<string, number>();
    for (const r of live) { const t = r.at.getTime(); if (!liveCoinAt.has(r.to_address) || t < liveCoinAt.get(r.to_address)!) liveCoinAt.set(r.to_address, t); }

    /* ── the coins that ran: could anything have seen them under $20K? ── */
    const runners = new Map<string, { c: Cand; posts: number }>();
    for (const [, cs] of posts) for (const c of cs) if (ran(c.address)) { const e = runners.get(c.address); if (e) e.posts += 1; else runners.set(c.address, { c, posts: 1 }); }
    let seenUnder = 0; let strongRunners = 0; let liveRunners = 0; let liveUnder = 0;
    const firstSeen: number[] = []; const liveMin: number[] = []; const liveCap: number[] = [];
    for (const [a, { c }] of runners) {
      if (c.strong || [...byPost.values()].some((cs) => cs.some((x) => x.address === a && x.strong))) strongRunners += 1;
      const early = (coins.get(a)?.readings ?? []).find((r) => r.cap !== null && r.t - c.launched <= 30 * MIN);
      if (early && early.cap! < DEAD_USD) { seenUnder += 1; firstSeen.push((early.t - c.launched) / MIN); }
      const lt = liveCoinAt.get(a);
      if (lt !== undefined) {
        liveRunners += 1; liveMin.push((lt - c.launched) / MIN);
        const cap = at(coins.get(a)?.readings ?? [], lt)?.cap ?? null;
        if (cap !== null) { liveCap.push(cap); if (cap < DEAD_USD) liveUnder += 1; }
      }
    }
    console.log(`coins that ran (peak ≥ ${k(HIT_USD)} in 24 h): ${runners.size}, of which ${strongRunners} carry a link / stated name / picture tie on some post`);
    console.log(`  read under ${k(DEAD_USD)} in their first 30 min: ${seenUnder} (first such reading a median +${(median(firstSeen) ?? 0).toFixed(1)} min)`);
    console.log(`  picked live at all: ${liveRunners}, a median ${(median(liveMin) ?? 0).toFixed(0)} min after launch at a median ${k(median(liveCap))}; ${liveUnder} of them while under ${k(DEAD_USD)}`);
    if (process.argv.includes('--runners')) {
      for (const [a, { c, posts: n }] of [...runners].sort((x, y) => x[1].c.launched - y[1].c.launched)) {
        const rs = coins.get(a)?.readings ?? [];
        const firstR = rs.find((r) => r.cap !== null);
        const lt = liveCoinAt.get(a);
        console.log(`  R ${a} ${new Date(c.launched).toISOString().slice(5, 16)} posts ${n} [${c.ties.join(',')}] peak ${k(coins.get(a)?.peak ?? null)} first read +${firstR ? ((firstR.t - c.launched) / MIN).toFixed(0) : '—'}m ${k(firstR?.cap ?? null)} | live +${lt === undefined ? '—' : ((lt - c.launched) / MIN).toFixed(0)}m ${k(lt === undefined ? null : at(rs, lt)?.cap ?? null)} | reads<30m ${rs.filter((r) => r.t - c.launched <= 30 * MIN).length}`);
      }
    }

    const report = (label: string, picks: Pick[]): void => {
      /* One coin is one push and one outcome, however many posts it ties. */
      const first = new Map<string, Pick>();
      for (const p of [...picks].sort((a, b) => a.t - b.t)) if (!first.has(p.address)) first.set(p.address, p);
      const cs = [...first.values()];
      const push = new Map<string, Pick>();
      for (const p of [...picks].filter(pushable).sort((a, b) => a.t - b.t)) if (!push.has(p.address)) push.set(p.address, p);
      const ps = [...push.values()];
      const tally = (xs: Pick[]) => {
        const o = xs.map((p) => outcome(p.address));
        return { n: xs.length, hit: o.filter((x) => x === 'hit' || x === 'big').length, big: o.filter((x) => x === 'big').length, dud: o.filter((x) => x === 'dud' || x === 'thin').length, thin: o.filter((x) => x === 'thin').length };
      };
      const a = tally(cs);
      const b = tally(ps);
      /* Against today: a runner the live rule also picked — how much sooner, and at what cap it did;
         a death the live rule also picked is not new noise, one it never picked is. */
      const earlier: number[] = [];
      const liveCaps: number[] = [];
      let todayNever = 0;
      let newDeaths = 0;
      for (const p of cs) {
        const lt = liveCoinAt.get(p.address);
        const died = ['dud', 'thin'].includes(outcome(p.address));
        if (lt === undefined) { if (ran(p.address)) todayNever += 1; if (died) newDeaths += 1; continue; }
        if (ran(p.address)) {
          earlier.push((lt - p.t) / MIN);
          const cap = at(coins.get(p.address)?.readings ?? [], lt)?.cap;
          if (cap != null) liveCaps.push(cap);
        }
      }
      console.log(
        `${label.padEnd(36)} ${(a.n / days).toFixed(1).padStart(5)}/day  ran ${String(a.hit).padStart(3)} (≥100K ${String(a.big).padStart(3)})  died ${String(a.dud).padStart(3)} (new ${String(newDeaths).padStart(3)})` +
        ` | For You ${(b.n / days).toFixed(1).padStart(4)}/day ran ${String(b.hit).padStart(2)} died ${String(b.dud).padStart(2)}` +
        ` | at pick ${k(median(cs.map((p) => p.cap))).padStart(7)} +${(median(cs.map((p) => p.ageMin)) ?? 0).toFixed(1).padStart(4)}m` +
        ` | runners vs live: ${median(earlier)?.toFixed(0) ?? '—'} min sooner (n ${earlier.length}, live then at ${k(median(liveCaps))}), live never ${todayNever}` +
        ` | unread rival ${cs.filter((p) => p.unreadRival).length}, feed on ${cs.filter((p) => measuredAt(p.address, p.t)).length}`,
      );
    };

    /* ── today's rule, as it ran live ── */
    const todayPicks: Pick[] = [];
    for (const [item, cs] of posts) {
      const f = liveFirst.get(item);
      if (f === undefined) continue;
      const c = cs.find((x) => x.address === f.address);
      if (c === undefined) continue;
      const r = at(coins.get(c.address)?.readings ?? [], f.t);
      todayPicks.push({ item, address: c.address, t: f.t, ageMin: (f.t - c.launched) / MIN, cap: r?.cap ?? 0, unreadRival: false, strong: c.strong });
    }
    console.log('');
    report('TODAY (live first pick per post)', todayPicks);

    const grid: Bar[] = [];
    for (const strength of (hourEra ? ['vol', 'net', 'climb'] : ['climb']) as Strength[]) {
      for (const lead of [2, 3, 5]) {
        for (const minCap of [6_000, 8_000, 10_000, 12_000, 15_000]) {
          for (const minBuys of hourEra ? [0, 30, 60, 100, 150, 300] : [0]) {
            for (const withinMin of [10, 15, 30]) {
              for (const ties of ['link', 'strong', 'any'] as const) {
                grid.push({ label: `${strength} ${lead}x cap≥${minCap / 1000}K buys≥${minBuys} ≤${withinMin}m ${ties}`, strength, lead, minCap, minBuys, withinMs: withinMin * MIN, fromMs: 2 * MIN, ties, rivals: 'all' });
              }
            }
          }
        }
      }
    }
    const results = grid.map((bar) => {
      const picks: Pick[] = [];
      for (const [, cs] of posts) { const p = firstPick(cs, coins, bar); if (p) picks.push(p); }
      const coinsPicked = new Map<string, Pick>();
      for (const p of picks) if (!coinsPicked.has(p.address) || p.t < coinsPicked.get(p.address)!.t) coinsPicked.set(p.address, p);
      const cs = [...coinsPicked.values()];
      const hit = cs.filter((p) => ran(p.address)).length;
      const dud = cs.filter((p) => ['dud', 'thin'].includes(outcome(p.address))).length;
      const medCap = median(cs.map((p) => p.cap)) ?? 1e9;
      return { bar, picks, hit, dud, medCap };
    });
    const show = (title: string, rs: typeof results): void => { console.log(`\n${title}`); for (const r of rs) report(r.bar.label, r.picks); };
    const under = results.filter((r) => r.picks.length > 0);
    const share = (r: (typeof results)[number]): number => r.hit / Math.max(1, r.hit + r.dud);
    show(`${grid.length} bars tried (each fires only while the coin is under ${k(DEAD_USD)}); the 15 that catch the most runners:`, [...under].sort((a, b) => b.hit - a.hit || share(b) - share(a)).slice(0, 15));
    show('the 15 with the best runner share (at least 2 runners):', [...under].filter((r) => r.hit >= 2).sort((a, b) => share(b) - share(a) || b.hit - a.hit).slice(0, 15));
    const named = (argOf('show') ?? '').split(',').filter(Boolean);
    if (named.length > 0) show('asked for:', results.filter((r) => named.includes(r.bar.label)));
    /* --list: the first named bar's coins, one line each, for reading by hand. */
    if (process.argv.includes('--list') && named.length > 0) {
      const r = results.find((x) => x.bar.label === named[0]);
      const seen = new Set<string>();
      for (const p of [...(r?.picks ?? [])].sort((a, b) => a.t - b.t)) {
        if (seen.has(p.address)) continue;
        seen.add(p.address);
        const lt = liveCoinAt.get(p.address);
        console.log(`  L ${new Date(p.t).toISOString().slice(5, 16)} ${p.address} ${p.item} +${p.ageMin.toFixed(1)}m ${k(p.cap)} → ${outcome(p.address)} ${k(coins.get(p.address)?.peak ?? null)}  live ${lt === undefined ? '—' : `+${((lt - launchOf.get(p.address)!) / MIN).toFixed(0)}m`} ${pushable(p) ? 'ForYou' : ''}`);
      }
    }

    /* ── what the pushes really did: every coin pushed as a launch, by its held peak ── */
    const pushed = await db.query<{ subject: string; at: Date; mc: string | null }>(
      `select subject, min(at) at, min(facts->>'mcUsd') mc from people.alert
        where kind = 'coin_launched' and at >= $1 and at < $2 group by 1`,
      [new Date(fromMs), new Date(toMs)],
    ).catch(() => []);
    if (pushed.length > 0) {
      const o = pushed.map((p) => outcome(p.subject));
      const caps = pushed.map((p) => Number(p.mc)).filter((x) => Number.isFinite(x));
      console.log(`\nPUSHED (people.alert coin_launched, coins): ${(pushed.length / days).toFixed(1)}/day; ran ${o.filter((x) => x === 'hit' || x === 'big').length} (≥100K ${o.filter((x) => x === 'big').length}), between ${o.filter((x) => x === 'mid').length}, died ${o.filter((x) => x === 'dud').length}, unknown ${o.filter((x) => x === 'thin').length} (a coin read only outside these posts is unknown here); cap in the push a median ${k(median(caps))}, ${caps.filter((x) => x < DEAD_USD).length} of ${caps.length} under ${k(DEAD_USD)}`);
    }

    /* ── THE TRADES BAR, where the feed measured it: a strong-tie coin's first K minutes of trades,
       on the coins the feed had from launch and still had at launch + K ── */
    {
      const tm = await db.query<{ address: string; minute: Date; buyers: number; new_buyers: number; buys: number; sells: number; net_sol: string; last_mcap_sol: string }>(
        `select address, minute, buyers, new_buyers, buys, sells, net_sol, last_mcap_sol from internal.coin_trade_minute where minute >= $1 and minute < $2`,
        [new Date(fromMs), new Date(toMs + HOUR)],
      );
      const byCoin = new Map<string, typeof tm>();
      for (const r of tm) { const l = byCoin.get(r.address) ?? []; l.push(r); byCoin.set(r.address, l); }
      const strongCoins = new Map<string, Cand>();
      for (const [, cs] of posts) for (const c of cs) if (c.strong && !strongCoins.has(c.address)) strongCoins.set(c.address, c);
      for (const K of [3, 5, 10]) {
        const rows: { a: string; buyers: number; net: number; trades: number; o: string }[] = [];
        for (const [a, c] of strongCoins) {
          const w = measured.get(a);
          if (w?.measured_from == null || w.measured_from.getTime() > c.launched + 90_000 || (w.measured_until?.getTime() ?? 0) < c.launched + K * MIN) continue;
          const ms = (byCoin.get(a) ?? []).filter((r) => r.minute.getTime() < c.launched + K * MIN);
          rows.push({ a, buyers: ms.reduce((s, r) => s + r.new_buyers, 0), net: ms.reduce((s, r) => s + Number(r.net_sol), 0), trades: ms.reduce((s, r) => s + r.buys + r.sells, 0), o: outcome(a) });
        }
        const ranN = rows.filter((r) => r.o === 'hit' || r.o === 'big').length;
        console.log(`\ntrades, first ${K} min: ${rows.length} strong-tie coins measured from launch through +${K}m (of ${strongCoins.size}); ${ranN} ran`);
        for (const B of [15, 30, 60, 100]) {
          for (const N of [0, 5, 10, 20]) {
            const sel = rows.filter((r) => r.buyers >= B && r.net >= N);
            if (sel.length === 0) continue;
            console.log(`  buyers≥${String(B).padStart(3)} net≥${String(N).padStart(2)} SOL: ${String(sel.length).padStart(4)} coins (${(sel.length / days).toFixed(1)}/day)  ran ${sel.filter((r) => r.o === 'hit' || r.o === 'big').length}  died ${sel.filter((r) => r.o === 'dud' || r.o === 'thin').length}`);
          }
        }
        for (const r of rows.filter((x) => x.o === 'hit' || x.o === 'big')) console.log(`  ran: ${r.a.slice(0, 6)}… buyers ${r.buyers} net ${r.net.toFixed(1)} SOL trades ${r.trades} → ${k(coins.get(r.a)?.peak ?? null)}`);
      }
    }

    /* ── --dump: every strong-tie candidate's first reading under $20K in its first 30 min ── */
    if (process.argv.includes('--dump')) {
      console.log('\nDUMP\taddress\titem\tageMin\tcap\tvol\tbuys\tsells\trivals\trivalVolMax\trivalNetMax\toutcome\theldPeak\tties');
      for (const [item, cs] of posts) {
        for (const c of cs) {
          if (!c.strong) continue;
          for (const r of coins.get(c.address)?.readings ?? []) {
            const age = r.t - c.launched;
            if (age > 30 * MIN || r.cap === null || r.cap < 5_000 || r.cap >= DEAD_USD) continue;
            let rv = 0; let rn = 0; let n = 0;
            for (const o of cs) {
              if (o.address === c.address || o.launched > r.t || o.launched < r.t - RIVAL_WINDOW_MS) continue;
              n += 1;
              const or = at(coins.get(o.address)?.readings ?? [], r.t);
              rv = Math.max(rv, strengthOf(or, 'vol')); rn = Math.max(rn, strengthOf(or, 'net'));
            }
            console.log(`DUMP\t${c.address}\t${item}\t${(age / MIN).toFixed(1)}\t${Math.round(r.cap)}\t${Math.round(r.vol ?? -1)}\t${r.buys ?? -1}\t${r.sells ?? -1}\t${n}\t${Math.round(rv)}\t${rn}\t${outcome(c.address)}\t${Math.round(coins.get(c.address)?.peak ?? -1)}\t${c.ties.join(',')}`);
          }
        }
      }
    }

    if (caseItem) {
      const cs = byPost.get(caseItem) ?? [];
      console.log(`\ncase ${caseItem}: ${cs.length} launch candidates`);
      for (const c of [...cs].sort((a, b) => a.launched - b.launched)) {
        const coin = coins.get(c.address);
        if (!c.strong && (coin?.peak ?? 0) < 10_000) continue;
        const early = (coin?.readings ?? []).filter((r) => r.t <= c.launched + 30 * MIN).map((r) => `+${((r.t - c.launched) / MIN).toFixed(0)}m ${k(r.cap)} vol ${k(r.vol)} b${r.buys}/s${r.sells}`).join('; ');
        console.log(`  ${c.address.slice(0, 6)}… ${new Date(c.launched).toISOString().slice(11, 19)} [${c.ties.join(',')}] peak ${k(coin?.peak ?? null)} reads ${coin?.reads24h ?? 0}  live pick ${liveAt.has(`${caseItem}|${c.address}`) ? new Date(liveAt.get(`${caseItem}|${c.address}`)!).toISOString().slice(11, 19) : '—'}  | ${early}`);
      }
      const named2 = results.filter((r) => named.includes(r.bar.label));
      for (const r of [...[...under].sort((a, b) => (b.hit - b.dud) - (a.hit - a.dud)).slice(0, 5), ...named2]) {
        const p = firstPick(cs, coins, r.bar);
        console.log(`  ${r.bar.label.padEnd(40)} → ${p ? `${p.address.slice(0, 6)}… at +${p.ageMin.toFixed(1)}m, ${k(p.cap)}` : 'no pick'}`);
      }
    }
  } finally {
    await client.query('rollback').catch(() => undefined);
    client.release();
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  });
}
