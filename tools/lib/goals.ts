/**
 * THE GOALS SCORECARD at the top of the 20:00 report (the owner, 2026-10-20): one row per goal, one
 * column per UTC day of the last seven, and the trend in plain words. Six goals:
 *
 *   1. Speed            X and TikTok apart: median minutes from posting to For You, and the share
 *                       on For You within 15, 30 and 60 minutes (by the day first shown)
 *   2. Before the coin  posts whose coin ran: the share on For You before that coin launched, and
 *                       the median head start (by the coin's launch day)
 *   3. Quality          For You posts a day; the share the owner tapped "Not a meme"; the share he
 *                       marked memeable (a "meme" tap or a gold sheet). Below them, for information
 *                       only, the share that later got a coin that ran (by the day first shown)
 *   4. Coin match       the one-coin picks the owner called: right / wrong / no pick; and, with no
 *                       call from him, picks that were the coin biggest at +1 h (by the decided day)
 *   5. Notifications    pushes about posts and coins a day and per person, how many were about a
 *                       coin that ran, and system notices apart (by the day sent)
 *   6. Cost             X, judge, TikTok, pictures and the total, $ a day, live book only
 *
 * Its own file so the arithmetic is tested on made-up rows (goals.test.ts) apart from the SQL, the
 * way coin-picks.ts is. Free and read-only: stored rows only, nothing asked of any vendor.
 *
 * ★ "A COIN THAT RAN" is one thing here: a coin tied to the post (its own links name the post, or
 * the owner confirmed it) whose market cap reached Policy.oneCoin.minCapUsd ($15k) within
 * Policy.oneCoin.watchMs (its first hour), on a reading whose pool is not under
 * Policy.oneCoin.minLiquidityUsd (the $0.01-pool caps the one-coin rule throws out). That is the
 * owner's own words and the one-coin rule's bar for a coin worth picking. Row 4's "+1 h" is the
 * one-coin replay's truth instead (services/project onecoin-cases.ts: the biggest candidate an hour
 * after launch, at least Policy.oneCoin.refit.truthMinCapUsd), because that is what the picks are
 * judged against everywhere else; the two are named apart on screen.
 *
 * ★ QUALITY IS MEMEABLE, NOT COINED (the owner, 2026-10-20: "not every good quality meme gets
 * coined"). The coin share is printed under the quality rows as information and never as the
 * quality number.
 *
 * What breaks if changed carelessly: the trend. It pools the rows of the three latest whole days
 * against the three before (today, still running, is never in it), so a day with few posts does
 * not swing it; comparing day averages instead would let one quiet day decide the word.
 */

import { DEFAULT_POLICY, type Policy } from '../../contracts/src/policy.ts';
import { JOB_ENDPOINT_PREFIX, LEARN_ENDPOINT_PREFIX } from '../../contracts/src/ports/meter.ts';
import { addressOfCoinId, foldCoinCalls, type PostCoinCalls } from '../../core/src/index.ts';
import { launchClock } from '../../services/read/src/post-sheet.ts';
import { loadCases } from '../../services/project/src/onecoin-cases.ts';
import { PgOwnerCoinCallRepo, missingTable, type Db } from '../../store/src/index.ts';
import { verdictOf, type PickRow, type Verdict } from './coin-picks.ts';

const DAY_MS = 86_400_000;
const MIN_MS = 60_000;
/** The speed thresholds the owner asked for, in minutes. */
export const SPEED_MINUTES = [15, 30, 60] as const;
/** The trend: the latest whole days pooled against as many before them. */
export const TREND_DAYS = 3;

/* ── the rows ────────────────────────────────────────────────────────────────────────────────── */

export interface FypRow {
  readonly itemId: string;
  readonly source: string;
  readonly postedAtMs: number | null;
  readonly shownAtMs: number;
  /** The owner's newest meme / not tap on the post. */
  readonly label: 'meme' | 'not' | null;
  /** A gold sheet holds it: the owner's own list of memeable posts. */
  readonly gold: boolean;
  /** A coin that ran launched after the post was first shown. */
  readonly laterRan: boolean;
}

/** A post whose coin ran, with that coin (the earliest that ran) and when For You first showed the post. */
export interface RanRow {
  readonly itemId: string;
  readonly coinAtMs: number;
  /** A launch time read off the chain; 'unknown' is a time from a second-hand source. */
  readonly clock: 'chain' | 'unknown';
  readonly shownAtMs: number | null;
}

export interface MatchRow {
  readonly decidedAtMs: number;
  /** Against the owner's call; null when he made none. */
  readonly verdict: Verdict | null;
  /** With no call: whether the pick was the +1 h coin; null when there is no +1 h truth for it. */
  readonly plus1h: boolean | null;
}

export interface PushRow {
  readonly atMs: number;
  readonly userId: string;
  /** Outages, supplier warnings, re-tune summaries and tests: about us, not about a post. */
  readonly system: boolean;
  readonly ran: boolean;
}

export type CostPart = 'x' | 'judge' | 'tiktok' | 'pictures' | 'other';

export interface SpendRow {
  readonly dayMs: number;
  readonly part: CostPart;
  readonly usd: number;
}

export interface GoalRows {
  readonly fyp: readonly FypRow[];
  readonly ran: readonly RanRow[];
  readonly match: readonly MatchRow[];
  readonly pushes: readonly PushRow[];
  readonly spend: readonly SpendRow[];
}

/* ── the arithmetic (pure) ───────────────────────────────────────────────────────────────────── */

export function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[m] ?? null) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
}

/** A share in [0, 1], or null when there is nothing to divide by. */
const share = (n: number, d: number): number | null => (d === 0 ? null : n / d);

/**
 * The suppliers by role, by the vendor token each bills under (services/runner vendor-lines.ts
 * `supplierRoles`). A vendor not here is "other": counted in the total, never lost.
 */
const PART_OF_VENDOR: Readonly<Record<string, CostPart>> = {
  'twitterapi.io': 'x',
  anthropic: 'judge',
  openrouter: 'judge',
  together: 'judge',
  apify: 'tiktok',
  scrapecreators: 'tiktok',
  /* Our own embedding service ($0 a call, still recorded). */
  'embed-service': 'pictures',
};
export const costPartOf = (vendor: string): CostPart => PART_OF_VENDOR[vendor] ?? 'other';

/** What a cell holds: a value to compare for the trend, and the words to print. */
export interface Cell {
  readonly v: number | null;
  readonly text: string;
}

type Better = 'up' | 'down' | null;
type Kind = 'minutes' | 'share' | 'count' | 'usd' | 'text';

interface Line {
  readonly label: string;
  readonly kind: Kind;
  readonly better: Better;
  readonly cell: (r: GoalRows) => Cell;
}

const dash = (why: string): Cell => ({ v: null, text: `— (${why})` });
const minutes = (v: number | null, why: string): Cell => (v === null ? dash(why) : { v, text: `${Math.round(v)} min` });
const pctOf = (n: number, d: number, why: string): Cell => {
  const s = share(n, d);
  return s === null ? dash(why) : { v: s, text: `${Math.round(100 * s)}% of ${d}` };
};
const count = (n: number): Cell => ({ v: n, text: String(n) });
const usd = (n: number): Cell => ({ v: n, text: `$${n.toFixed(2)}` });

const SOURCE_WORDS: Readonly<Record<string, string>> = { x: 'X', tiktok: 'TikTok' };

function speedLines(source: string): readonly Line[] {
  const name = SOURCE_WORDS[source] ?? source;
  const timed = (r: GoalRows) => r.fyp.filter((p) => p.source === source && p.postedAtMs !== null).map((p) => (p.shownAtMs - (p.postedAtMs ?? 0)) / MIN_MS);
  return [
    { label: `${name}: posts reaching For You`, kind: 'count', better: null, cell: (r) => count(r.fyp.filter((p) => p.source === source).length) },
    { label: `${name}: median minutes, posted to For You`, kind: 'minutes', better: 'down', cell: (r) => minutes(median(timed(r)), 'none') },
    ...SPEED_MINUTES.map((m): Line => ({
      label: `${name}: on For You within ${m} min`,
      kind: 'share',
      better: 'up',
      cell: (r) => {
        const t = timed(r);
        return pctOf(t.filter((x) => x <= m).length, t.length, 'none');
      },
    })),
  ];
}

const timedRan = (r: GoalRows) => r.ran.filter((x) => x.clock !== 'unknown');
const headStarts = (r: GoalRows) => timedRan(r).filter((x) => x.shownAtMs !== null && x.shownAtMs < x.coinAtMs).map((x) => (x.coinAtMs - (x.shownAtMs ?? 0)) / MIN_MS);
const owned = (r: GoalRows) => r.match.filter((m) => m.verdict !== null);
const nonSystem = (r: GoalRows) => r.pushes.filter((p) => !p.system);
const costOf = (part: CostPart | 'total') => (r: GoalRows) => usd(r.spend.filter((s) => part === 'total' || s.part === part).reduce((a, s) => a + s.usd, 0));

/** The scorecard's sections, each a list of lines; every line is computed the same way for a day and for the trend. */
export const SECTIONS: readonly { readonly title: string; readonly lines: readonly Line[] }[] = [
  { title: '1. Speed (by the day first shown on For You)', lines: [...speedLines('x'), ...speedLines('tiktok')] },
  {
    title: '2. Before the coin (posts whose coin reached $15k in its first hour, by the coin\'s launch day)',
    lines: [
      { label: 'posts whose coin ran', kind: 'count', better: null, cell: (r) => count(r.ran.length) },
      { label: 'on For You at all (before or after)', kind: 'share', better: 'up', cell: (r) => pctOf(r.ran.filter((x) => x.shownAtMs !== null).length, r.ran.length, 'none') },
      { label: 'on For You before the coin launched', kind: 'share', better: 'up', cell: (r) => pctOf(headStarts(r).length, timedRan(r).length, 'no chain times') },
      { label: 'median head start', kind: 'minutes', better: 'up', cell: (r) => minutes(median(headStarts(r)), 'none ahead') },
    ],
  },
  {
    title: '3. Quality (For You posts, by the day first shown)',
    lines: [
      { label: 'For You posts', kind: 'count', better: null, cell: (r) => count(r.fyp.length) },
      { label: 'you tapped "Not a meme"', kind: 'share', better: 'down', cell: (r) => pctOf(r.fyp.filter((p) => p.label === 'not').length, r.fyp.length, 'none') },
      { label: 'you marked memeable (meme tap or gold sheet)', kind: 'share', better: 'up', cell: (r) => pctOf(r.fyp.filter((p) => p.label !== 'not' && (p.label === 'meme' || p.gold)).length, r.fyp.length, 'none') },
      { label: 'for information: later got a coin that ran', kind: 'share', better: null, cell: (r) => pctOf(r.fyp.filter((p) => p.laterRan).length, r.fyp.length, 'none') },
    ],
  },
  {
    title: '4. Coin match (one-coin picks, by the day decided)',
    lines: [
      {
        label: 'your calls: right / wrong / no pick',
        kind: 'text',
        better: null,
        cell: (r) => {
          const o = owned(r);
          if (o.length === 0) return dash('no calls');
          const n = (vs: readonly Verdict[]) => o.filter((m) => m.verdict !== null && vs.includes(m.verdict)).length;
          return { v: null, text: `${n(['right'])} / ${n(['wrong'])} / ${n(['no_pick', 'never_weighed'])}` };
        },
      },
      { label: 'your calls: right', kind: 'share', better: 'up', cell: (r) => pctOf(owned(r).filter((m) => m.verdict === 'right').length, owned(r).length, 'no calls') },
      {
        label: 'no call: picked the biggest coin at +1h',
        kind: 'share',
        better: 'up',
        cell: (r) => {
          const m = r.match.filter((x) => x.verdict === null && x.plus1h !== null);
          return pctOf(m.filter((x) => x.plus1h === true).length, m.length, 'none measured');
        },
      },
    ],
  },
  {
    title: '5. Notifications (pushes sent, by the day sent)',
    lines: [
      { label: 'pushes about posts and coins', kind: 'count', better: null, cell: (r) => count(nonSystem(r).length) },
      {
        label: 'per person',
        kind: 'count',
        better: null,
        cell: (r) => {
          const p = nonSystem(r);
          const people = new Set(p.map((x) => x.userId)).size;
          return people === 0 ? dash('no one') : { v: p.length / people, text: `${(p.length / people).toFixed(1)} (${people} ${people === 1 ? 'person' : 'people'})` };
        },
      },
      { label: 'about a coin that ran', kind: 'share', better: 'up', cell: (r) => pctOf(nonSystem(r).filter((p) => p.ran).length, nonSystem(r).length, 'none sent') },
      { label: 'system notices (outages, suppliers, re-tunes, tests)', kind: 'count', better: null, cell: (r) => count(r.pushes.filter((p) => p.system).length) },
    ],
  },
  {
    title: '6. Cost ($ a day, live book only)',
    lines: [
      { label: 'X', kind: 'usd', better: 'down', cell: costOf('x') },
      { label: 'judge', kind: 'usd', better: 'down', cell: costOf('judge') },
      { label: 'TikTok', kind: 'usd', better: 'down', cell: costOf('tiktok') },
      { label: 'pictures', kind: 'usd', better: 'down', cell: costOf('pictures') },
      { label: 'total (with anything else)', kind: 'usd', better: 'down', cell: costOf('total') },
    ],
  },
];

/** The rows whose own clock falls in [from, to). */
export function cut(r: GoalRows, from: number, to: number): GoalRows {
  const inside = (t: number | null) => t !== null && t >= from && t < to;
  return {
    fyp: r.fyp.filter((x) => inside(x.shownAtMs)),
    ran: r.ran.filter((x) => inside(x.coinAtMs)),
    match: r.match.filter((x) => inside(x.decidedAtMs)),
    pushes: r.pushes.filter((x) => inside(x.atMs)),
    spend: r.spend.filter((x) => inside(x.dayMs)),
  };
}

/**
 * The trend in plain words: the latest `TREND_DAYS` whole days pooled against the ones before.
 * Shares move by points (3 or fewer is "about the same"); everything else by 10%.
 */
export function trendWords(kind: Kind, better: Better, before: Cell, after: Cell): string {
  if (kind === 'text') return '';
  if (before.v === null || after.v === null) return '— (not enough days)';
  /* Counts and dollars are sums over the pooled days: compared and printed as a day's average. */
  if (kind === 'count' || kind === 'usd') {
    const a = (c: Cell): Cell => {
      const v = (c.v ?? 0) / TREND_DAYS;
      return { v, text: kind === 'usd' ? `$${v.toFixed(2)}` : String(Math.round(v)) };
    };
    return trendWords('minutes', better, a(before), a(after)).replace(/\)$/, ' a day)');
  }
  const flat = kind === 'share' ? Math.abs(after.v - before.v) * 100 <= 3 : Math.abs(after.v - before.v) <= 0.1 * Math.max(Math.abs(before.v), Math.abs(after.v));
  const up = after.v > before.v;
  const word = flat ? 'about the same' : better === null ? (up ? 'up' : 'down') : (better === 'up') === up ? 'better' : 'worse';
  const short = (c: Cell) => c.text.replace(/ of \d+$/, '').replace(/ \(.*\)$/, '');
  return `${word} (${short(before)} → ${short(after)})`;
}

/** The section's lines: a table per goal, days oldest first, today marked "so far", then the trend. */
export function goalLines(rows: GoalRows, nowMs: number, days = 7): readonly string[] {
  const today = Math.floor(nowMs / DAY_MS) * DAY_MS;
  const starts = Array.from({ length: days }, (_, i) => today - (days - 1 - i) * DAY_MS);
  const heads = starts.map((d) => new Date(d).toISOString().slice(5, 10) + (d === today ? ' so far' : ''));
  const recent = cut(rows, today - TREND_DAYS * DAY_MS, today);
  const earlier = cut(rows, today - 2 * TREND_DAYS * DAY_MS, today - TREND_DAYS * DAY_MS);
  const perDay = starts.map((d) => cut(rows, d, d + DAY_MS));
  const width = Math.max(...SECTIONS.flatMap((s) => s.lines.map((l) => l.label.length)));
  const out: string[] = [];
  for (const s of SECTIONS) {
    const cells = s.lines.map((l) => [...perDay.map((r) => l.cell(r).text), trendWords(l.kind, l.better, l.cell(earlier), l.cell(recent))]);
    const colW = [...heads, 'trend'].map((h, i) => Math.max(h.length, ...cells.map((c) => (c[i] ?? '').length)));
    const line = (head: string, cs: readonly string[]) => `${head.padEnd(width)}  ${cs.map((c, i) => c.padEnd(colW[i] ?? 0)).join('  ')}`.trimEnd();
    out.push(s.title);
    out.push(line('', [...heads, 'trend']));
    s.lines.forEach((l, i) => out.push(line(l.label, cells[i] ?? [])));
    out.push('');
  }
  out.push(`Days are UTC. Trend: the ${TREND_DAYS} latest whole days against the ${TREND_DAYS} before them; today is never in it.`);
  out.push('A coin that ran: a coin whose own links name the post, or that you confirmed, reaching a $15k market cap in its first hour (pools under $100 not counted).');
  out.push('Coin match "+1h": with no call from you, the pick against the coin biggest an hour after launch (at least $10k), the one-coin replay\'s own reading.');
  out.push('Before the coin: only coins whose launch time came from the chain; a launch time from a market-data supplier ran a median 22 minutes late, too loose for "before".');
  out.push('Memeable: you almost never tap "meme" and the gold sheets hold few For You posts, so this is a floor; "Not a meme" is the firmer number.');
  return out;
}

/* ── the database ────────────────────────────────────────────────────────────────────────────── */

/** Whether a coin `addr` launched at `at` ran: a cap over the bar within the watch, on a pool not under the floor. */
const RAN = (addr: string, at: string) => `(
  exists (select 1 from public.market_reading m
           where m.chain = 'solana' and m.address = ${addr} and m.market_cap_usd >= $3::float8
             and (m.liquidity_usd is null or m.liquidity_usd >= $4::float8)
             and m.taken_at >= ${at} and m.taken_at <= ${at} + $5::float8 * interval '1 millisecond')
  or exists (select 1 from internal.coin_trade_minute t
              where t.address = ${addr} and t.last_mcap_usd >= $3::float8
                and t.minute >= ${at} and t.minute <= ${at} + $5::float8 * interval '1 millisecond'))`;

/** Every coin tied to a post: its own links name the post, or the owner confirmed it (as scorecard.ts). */
const LINKED = `
  select l.source || ':' || l.source_item_id as item_id, l.address, a.minted_at, a.minted_at_source
    from internal.coin_post_link l join public.asset a on a.asset_key = l.asset_key
  union
  select f.item_id, f.coin_address, coalesce(a.minted_at, n.launched_at), case when a.minted_at is null then null else a.minted_at_source end
    from internal.owner_feedback f
    left join public.asset a on a.chain = 'solana' and a.address = f.coin_address
    left join public.coin_name n on n.address = f.coin_address
   where f.subject_kind = 'coin_match' and f.verdict = 'right' and f.coin_address is not null`;

/* $1, $2 the window; $3 cap bar; $4 pool floor; $5 watch. */
const FYP_SQL = `
  select fp.item_id, i.source, i.posted_at, fp.first_shown_at,
         (select o.verdict from internal.owner_feedback o
           where o.subject_kind = 'post' and o.item_id = fp.item_id and o.verdict in ('meme', 'not')
           order by o.created_at desc limit 1) as label,
         exists (select 1 from internal.gold_addition g where g.item_id = fp.item_id) as gold,
         exists (select 1 from (
            select l.address, l.minted_at from internal.coin_post_link l
             where l.source = i.source and l.source_item_id = substring(fp.item_id from position(':' in fp.item_id) + 1) and l.minted_at > fp.first_shown_at
            union
            select f.coin_address, coalesce(a.minted_at, n.launched_at) from internal.owner_feedback f
              left join public.asset a on a.chain = 'solana' and a.address = f.coin_address
              left join public.coin_name n on n.address = f.coin_address
             where f.subject_kind = 'coin_match' and f.verdict = 'right' and f.item_id = fp.item_id and coalesce(a.minted_at, n.launched_at) > fp.first_shown_at
          ) c where ${RAN('c.address', 'c.minted_at')}) as later_ran
    from public.feed_post fp join public.item i using (item_id)
   where fp.feed_id = 'fyp' and fp.first_shown_at >= $1 and fp.first_shown_at < $2`;

const RAN_SQL = `
  with coins as (select * from (${LINKED}) x where minted_at >= $1 and minted_at < $2),
  ran as (select distinct on (item_id) * from coins c where ${RAN('c.address', 'c.minted_at')} order by item_id, minted_at)
  select r.item_id, r.minted_at, r.minted_at_source, fp.first_shown_at
    from ran r left join public.feed_post fp on fp.feed_id = 'fyp' and fp.item_id = r.item_id`;

/* The post a push is about, and its coin: a test's "sample:<n>:" prefix off, "<post>|<coin>" split. */
const PUSH_SQL = `
  with p as (
    select a.at, a.user_id, a.kind, a.subject,
           split_part(regexp_replace(a.subject, '^sample:[0-9]+:', ''), '|', 1) as post_id,
           coalesce(a.facts ->> 'address', nullif(split_part(regexp_replace(a.subject, '^sample:[0-9]+:', ''), '|', 2), '')) as coin
      from people.alert a where a.delivery = 'push' and a.at >= $1 and a.at < $2
  )
  select p.at, p.user_id, p.kind, p.subject,
         (exists (select 1 from (
             select p.coin as address, coalesce(a.minted_at, n.launched_at) as minted_at
               from (select 1) one left join public.asset a on a.chain = 'solana' and a.address = p.coin
               left join public.coin_name n on n.address = p.coin
              where p.coin is not null
             union
             select l.address, l.minted_at from internal.coin_post_link l
              where l.source = split_part(p.post_id, ':', 1) and l.source_item_id = substring(p.post_id from position(':' in p.post_id) + 1)
           ) c where c.minted_at is not null and ${RAN('c.address', 'c.minted_at')})) as ran
    from p`;

const SPEND_SQL = `
  select date_trunc('day', at at time zone 'UTC') at time zone 'UTC' as day, vendor, sum(usd)::float8 as usd
    from internal.spend
   where at >= $1 and at < $2 and endpoint not like $3 and endpoint not like $4
   group by 1, 2`;

/** Kinds that are about the system, not a post or a coin (services/notify): counted apart. */
const SYSTEM_KINDS: ReadonlySet<string> = new Set(['outage', 'supplier_account', 'supplier_warning', 'retune_summary', 'push_test']);

const ms = (v: Date | string): number => new Date(v).getTime();

/** Every row the window [since, until) needs, read once; `goalLines` cuts them by day. */
export async function goalRows(db: Db, sinceMs: number, untilMs: number, P: Policy = DEFAULT_POLICY): Promise<GoalRows> {
  const since = new Date(sinceMs).toISOString();
  const until = new Date(untilMs).toISOString();
  const bars = [P.oneCoin.minCapUsd, P.oneCoin.minLiquidityUsd, P.oneCoin.watchMs];
  /* One after another: tools/goals.ts runs this on one client inside a read-only transaction. */
  const fyp = await db.query<{ item_id: string; source: string; posted_at: Date | null; first_shown_at: Date; label: 'meme' | 'not' | null; gold: boolean; later_ran: boolean }>(FYP_SQL, [since, until, ...bars]);
  const ran = await db.query<{ item_id: string; minted_at: Date; minted_at_source: string | null; first_shown_at: Date | null }>(RAN_SQL, [since, until, ...bars]);
  const pushes = await db.query<{ at: Date; user_id: string; kind: string; subject: string; ran: boolean }>(PUSH_SQL, [since, until, ...bars]);
  const spend = await db.query<{ day: Date; vendor: string; usd: number }>(SPEND_SQL, [since, until, `${JOB_ENDPOINT_PREFIX}%`, `${LEARN_ENDPOINT_PREFIX}%`]);
  return {
    fyp: fyp.map((r) => ({ itemId: r.item_id, source: r.source, postedAtMs: r.posted_at === null ? null : ms(r.posted_at), shownAtMs: ms(r.first_shown_at), label: r.label, gold: r.gold, laterRan: r.later_ran })),
    ran: ran.map((r) => ({ itemId: r.item_id, coinAtMs: ms(r.minted_at), clock: launchClock(r.minted_at_source).kind === 'chain' ? 'chain' : 'unknown', shownAtMs: r.first_shown_at === null ? null : ms(r.first_shown_at) })),
    match: await matchRows(db, sinceMs, untilMs, P),
    pushes: pushes.map((r) => ({ atMs: ms(r.at), userId: r.user_id, system: SYSTEM_KINDS.has(r.kind) || r.subject.startsWith('sample:'), ran: r.ran })),
    spend: spend.map((r) => ({ dayMs: ms(r.day), part: costPartOf(r.vendor), usd: Number(r.usd) })),
  };
}

/** The window's one-coin picks: against the owner's calls (coin-picks.ts `verdictOf`), else against the +1 h coin. */
async function matchRows(db: Db, sinceMs: number, untilMs: number, P: Policy): Promise<readonly MatchRow[]> {
  let picks: (PickRow & { decidedAtMs: number })[];
  try {
    const rows = await db.query<{ id: string; address: string | null; outcome: PickRow['outcome']; decided_at: Date }>(
      `select item_id as id, address, outcome, decided_at from internal.post_coin_pick where decided_at >= $1 and decided_at < $2`,
      [new Date(sinceMs).toISOString(), new Date(untilMs).toISOString()],
    );
    picks = rows.map((r) => ({ kind: 'post', id: r.id, address: r.address, outcome: r.outcome, basis: null, decidedAtMs: ms(r.decided_at) }));
  } catch (e) {
    if (missingTable(e)) return [];
    throw e;
  }
  const ids = picks.map((p) => p.id);
  const callRows = await new PgOwnerCoinCallRepo(db).rows(ids);
  const calls: ReadonlyMap<string, PostCoinCalls> = foldCoinCalls(callRows.map((r) => ({ itemId: r.itemId, verdict: r.verdict, coinAddress: r.coinAddress, shownCoin: addressOfCoinId(r.shownCoinId), atMs: r.atMs, id: r.id })));
  const weighed = new Map<string, Set<string>>();
  const called = [...calls.keys()];
  if (called.length > 0) {
    const rows = await db.query<{ item_id: string; address: string }>(`select item_id, address from internal.one_coin_candidate where item_id = any($1::text[])`, [called]);
    for (const r of rows) weighed.set(r.item_id, (weighed.get(r.item_id) ?? new Set()).add(r.address));
  }
  const { truths } = await loadCases(db, sinceMs - P.oneCoin.postWindowMs, untilMs, { truthAtMs: P.oneCoin.refit.truthAtMs, truthMinCapUsd: P.oneCoin.refit.truthMinCapUsd, watchMs: P.oneCoin.watchMs });
  return picks.map((p) => {
    const verdict = verdictOf(p, calls.get(p.id), weighed.get(p.id) ?? new Set());
    const t = truths.get(p.id);
    return { decidedAtMs: p.decidedAtMs, verdict, plus1h: verdict !== null || t?.by !== 'plus_1h' ? null : p.address === t.address };
  });
}

/** The section read from the store: the last `days` UTC days up to `nowMs`. */
export async function goalSection(db: Db, nowMs: number, days = 7): Promise<readonly string[]> {
  const since = Math.floor(nowMs / DAY_MS) * DAY_MS - (days - 1) * DAY_MS;
  return goalLines(await goalRows(db, since, nowMs), nowMs, days);
}
