/**
 * `node --env-file=.env.local --experimental-strip-types tools/race-replay.ts [--days 7] [--readings]`
 *
 * `--readings` judges on market readings alone, as the live rule does without trade data: a week
 * stored before the free trade relay has trade minutes for few coins, and a coin with none would
 * otherwise read as nobody buying it.
 *
 * THE RACE AND THE CRASH SWITCH, REPLAYED on what we stored (read-only), to choose their bars
 * (the owner, 2026-10-26: "I'm trying to get the earliest entry possible"). Every post the matcher
 * gave candidates in the last `--days`, with its real coin (the owner's call, else the biggest
 * candidate an hour after its launch — services/project/src/onecoin-cases.ts), run through:
 *
 *   the pick       `pickOneCoin` as in force, and with the keep bar and the crash switch
 *   the race       `racingCoins` at each bar set below, beside the new pick
 *
 * For each, per post with a real coin: the first moment the card showed the real coin (as its
 * pick, or among the racers), how long after the real coin's launch, and the real coin's cap then
 * — the entry a person reading the card had. And the noise: posts that showed a race at all, races
 * that never held the real coin, and races on posts where nothing ran.
 *
 * Nothing is written. What breaks if changed carelessly: the clock. Every judgement reads only
 * minutes closed and readings taken by then (core contendersAt), as the live rule does.
 */

import process from 'node:process';

import { DEFAULT_POLICY } from '../contracts/src/policy.ts';
import { coinAt, contendersAt, oneCoinBars, racingCoins, replayTimeline, type OneCoinBars, type RaceBars, type ReplayCase } from '../core/src/index.ts';
import { asDb, createPool, DB_ROLE, PgOneCoinRepo } from '../store/src/index.ts';
import { loadCases } from '../services/project/src/onecoin-cases.ts';

const P = DEFAULT_POLICY.oneCoin;
const MIN = 60_000;
const DAY = 86_400_000;
const days = (() => {
  const i = process.argv.indexOf('--days');
  const v = i < 0 ? NaN : Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : 7;
})();

const RACES: readonly { readonly label: string; readonly bars: Omit<RaceBars, 'rugShareOfPeak'> | null }[] = [
  { label: 'no race (pick only)', bars: null },
  { label: 'race $20k, 3x, 2 coins', bars: { windowMs: P.race.windowMs, minCapUsd: 20_000, gapRatio: 3, size: 2 } },
  { label: 'race $10k, 1.5x, 2 coins', bars: { windowMs: P.race.windowMs, minCapUsd: 10_000, gapRatio: 1.5, size: 2 } },
  { label: 'race $5k, 1x, 3 coins', bars: { windowMs: P.race.windowMs, minCapUsd: 5_000, gapRatio: 1, size: 3 } },
];

const median = (xs: readonly number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};
const usd = (n: number | null): string => (n === null ? '-' : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1000)}k`);
const pct = (a: number, b: number): string => (b === 0 ? '-' : `${Math.round((100 * a) / b)}%`);

/** Every moment something new became known for a case, from the first launch to two hours on. */
function timesOf(c: ReplayCase, useTrades: boolean): number[] {
  const t = new Set<number>();
  for (const x of c.coins) {
    for (const r of x.readings) t.add(r.atMs);
    if (useTrades) for (const m of x.minutes) t.add(m.atMs + MIN);
  }
  /* From the real coin's launch (where a post has one), else the newest launch: an older coin of the
     name launched days before would close the two hours before the post existed. */
  const truthLaunch = c.coins.find((x) => x.address === c.truth)?.launchedAtMs ?? null;
  const launches = c.coins.map((x) => x.launchedAtMs).filter((x): x is number => x !== null);
  const from = truthLaunch ?? (launches.length === 0 ? -Infinity : Math.max(...launches));
  return [...t].filter((x) => x >= from && x <= from + 2 * 3_600_000).sort((a, b) => a - b);
}

interface Seen { readonly afterLaunchMs: number; readonly capUsd: number | null }

async function main(): Promise<void> {
  const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-race-replay', max: 1 });
  const client = await pool.connect();
  try {
    await client.query('begin read only');
    const db = asDb(client);
    const now = Date.now();
    const loaded = await loadCases(db, now - days * DAY, now, { truthAtMs: P.refit.truthAtMs, truthMinCapUsd: P.refit.truthMinCapUsd, watchMs: P.watchMs });
    const fit = await new PgOneCoinRepo(db).appliedFit();
    const newBars = oneCoinBars(P, fit);
    const oldBars: OneCoinBars = { ...newBars, rugKeepAboveUsd: Number.POSITIVE_INFINITY, crashCapRatio: Number.POSITIVE_INFINITY };
    const useTrades = loaded.useTrades && !process.argv.includes('--readings');
    const withCoin = loaded.cases.filter((c) => c.truth !== null);
    /* A post we could have judged in the real coin's first hour: it has a reading or a minute in it. */
    const measurable = withCoin.filter((c) => {
      const t = c.coins.find((x) => x.address === c.truth);
      if (t === undefined || t.launchedAtMs === null) return false;
      const end = t.launchedAtMs + 60 * MIN;
      return t.readings.some((r) => r.atMs <= end) || (useTrades && t.minutes.some((m) => m.atMs <= end));
    }).length;
    const nothing = loaded.cases.filter((c) => c.truth === null);
    console.log(`race replay, last ${days} day(s): ${withCoin.length} posts with a real coin (${measurable} with a reading of it in its first hour), ${nothing.length} where nothing ran; judged on ${useTrades ? 'trade minutes where stored' : 'market readings'}`);

    /* The pick, as in force and with the keep bar and crash switch: right at +10/+30/+60 min. */
    for (const [label, bars] of [['pick as in force', oldBars], ['pick + keep $50k + crash 2x', newBars]] as const) {
      const at = [10, 30, 60].map(() => 0);
      const wrong = [10, 30, 60].map(() => 0);
      for (const c of withCoin) {
        const truth = loaded.truths.get(c.subject);
        const launch = c.coins.find((x) => x.address === c.truth)?.launchedAtMs ?? null;
        if (launch === null || truth === undefined) continue;
        const tl = replayTimeline(c.coins, bars, launch + 2 * 3_600_000, useTrades);
        [10, 30, 60].forEach((m, i) => {
          const shown = coinAt(tl, launch + m * MIN);
          if (shown === c.truth) at[i]! += 1;
          else if (shown !== null) wrong[i]! += 1;
        });
      }
      console.log(`${label.padEnd(30)} real coin on the card at +10m ${pct(at[0]!, withCoin.length)}  +30m ${pct(at[1]!, withCoin.length)}  +60m ${pct(at[2]!, withCoin.length)}  | a wrong coin at +10m ${pct(wrong[0]!, withCoin.length)}  +30m ${pct(wrong[1]!, withCoin.length)}  +60m ${pct(wrong[2]!, withCoin.length)}  (of ${withCoin.length})`);
    }

    console.log('\nearliest the card showed the real coin (as the pick, or among the racers), and the noise:');
    for (const r of RACES) {
      const bars: RaceBars | null = r.bars === null ? null : { ...r.bars, rugShareOfPeak: newBars.rugShareOfPeak, creatorDumpShareOfPeak: newBars.creatorDumpShareOfPeak };
      const seen: Seen[] = [];
      let earlierThanPick = 0;
      let raced = 0;
      let racedWithout = 0;
      let raceOnNothing = 0;
      for (const c of loaded.cases) {
        const launch = c.truth === null ? null : c.coins.find((x) => x.address === c.truth)?.launchedAtMs ?? null;
        const times = timesOf(c, useTrades);
        const tl = replayTimeline(c.coins, newBars, times[times.length - 1] ?? 0, useTrades);
        let first: Seen | null = null;
        let firstPick: number | null = null;
        let anyRace = false;
        let raceHeldTruth = false;
        for (const t of times) {
          const pick = coinAt(tl, t);
          const racers = bars === null ? [] : racingCoins(contendersAt(c.coins, t, useTrades), t, bars);
          if (racers.length > 0) {
            anyRace = true;
            if (c.truth !== null && racers.includes(c.truth)) raceHeldTruth = true;
          }
          if (c.truth === null || launch === null) continue;
          if (firstPick === null && pick === c.truth) firstPick = t;
          if (first === null && (pick === c.truth || racers.includes(c.truth))) {
            const truthNow = contendersAt(c.coins.filter((x) => x.address === c.truth), t, useTrades)[0];
            const cap = truthNow === undefined ? null : truthNow.trades !== null && truthNow.trades !== 'quiet' && truthNow.trades.capUsd !== null ? truthNow.trades.capUsd : truthNow.market?.capUsd ?? null;
            first = { afterLaunchMs: t - launch, capUsd: cap };
            if (pick !== c.truth) earlierThanPick += 1;
          }
        }
        if (first !== null) seen.push(first);
        if (anyRace) {
          raced += 1;
          if (c.truth === null) raceOnNothing += 1;
          else if (!raceHeldTruth) racedWithout += 1;
        }
      }
      const within = seen.filter((s) => s.afterLaunchMs <= 60 * MIN);
      const mins = median(within.map((s) => s.afterLaunchMs / MIN));
      const cap = median(within.flatMap((s) => (s.capUsd === null ? [] : [s.capUsd])));
      console.log(`${r.label.padEnd(26)} shown within 1h ${String(within.length).padStart(4)} posts (${pct(within.length, measurable)} of measurable)  median ${mins === null ? '-' : `${mins.toFixed(1)} min`} after launch at ${usd(cap)}  | earlier than the pick on ${earlierThanPick} posts  | races on ${raced} posts: ${racedWithout} never held the real coin, ${raceOnNothing} where nothing ran`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

await main();
