/**
 * THE SCORECARD — the six numbers the owner measures us on from 2026-10-18 ("Our job is not to
 * predict which posts get coined. It's to show memeable posts before they go viral, and show the
 * right coin the moment it appears"). For a window and for each UTC day in it:
 *
 *   1. memeable %      For You posts the owner called memeable, three ways (below)
 *   2. earliness       views when For You first showed a post against its views 24 h after posting
 *   3. coverage        memeable posts that reached the viral line, shown before 20% of the line
 *   4. before any coin For You posts shown before the first coin naming them; median minutes ahead
 *   5. coin speed      seconds from a coin's create to its post's line carrying it
 *   6. right coin      proven coins on a post's line that were the biggest of their name at +1 h
 *
 * Shared by tools/scorecard.ts and the number table (tools/name-report.ts), so the two never
 * disagree. Free and read-only: stored rows only, nothing asked of any vendor.
 *
 * ★ EACH NUMBER SAYS WHAT IT COULD NOT SEE. The data is thinner than the questions, and the
 * decisions below are the honest reading of it, each counted where it bites:
 *   - Labels: the owner taps "Not a meme" on For You and almost never "meme" (6 ever, none since
 *     2026-10-14). So (a) labelled only, (b) every untapped post counted memeable (a ceiling: what
 *     he did not tap), and (c) the floor: a post counted memeable only on evidence — his meme
 *     label, a gold sheet, his missed list, or a coin naming it — and never against his "not".
 *   - 24 h views: posts stop being read long before a day is up, so a reading within
 *     `NEAR_24H_MS` of posted + 24 h is rare. Without one the post's highest reading stands in and
 *     is counted as such ("final is the last reading"); it is smaller than the true day's views,
 *     so the share shown early is understated, never flattered.
 *   - Coverage counts only posts we ever read: a memeable post never found has no views here. That
 *     is the funnel's "never found", not this number's.
 *   - Coin time is the launch time with its clock (services/read post-sheet.ts `launchClock`): a
 *     coin on an unknown clock is counted apart, never as a minute-exact time.
 *   - Coin speed is measured to the notify service's first sight of the proven coin on the post's
 *     For You line (people.pipeline_seen 'fyp-proven', read every Policy.alerts.pipelineLoopMs),
 *     the only place a coin's first showing is recorded; the link's own write (coin_post_link
 *     found_at) is printed beside it as the floor. Only a post's first coin, launched while the post
 *     was on For You, is timed: a coin made before the post showed arrives with the post.
 *   - Right coin: no stored volume exists (public.market_reading has caps, liquidity and price, no
 *     volume), so the market cap nearest launch + 1 h (`CAP_AT_MS` either side of `CAP_WINDOW_MS`)
 *     decides. Same name = same ticker or same name, launched within `SAME_NAME_MS` of ours. A coin
 *     of that name with no reading is unmeasured, never zero, and ours unmeasured is "can't tell".
 *     A generic ticker is shared by unrelated coins, so the number is also given against only the
 *     rivals whose own links name the same post: the copycats proper.
 *
 * What breaks if changed carelessly: the viral lines. They are the owner's definition of "went
 * viral" in this report; a change moves coverage without anything about the feed changing, so a
 * new line is stated beside the number it moves.
 */

import { launchClock } from '../../services/read/src/post-sheet.ts';
import type { Db } from '../../store/src/index.ts';

/**
 * THE VIRAL LINE, by source, in the source's own views counter (X impressions, TikTok plays).
 * Chosen from the posts read in the three days to 2026-10-18: 500k is X's 98th percentile (855 of
 * 42,852 posts), 2M TikTok's 99th (79 of 7,875); a TikTok play is cheaper than an X impression,
 * which is why the two differ.
 */
export const VIRAL_LINE: Readonly<Record<string, number>> = { x: 500_000, tiktok: 2_000_000 };
/** "Early" for coverage and earliness: under a fifth of the final count (the owner's 20%). */
export const EARLY_SHARE = 0.2;
/** A reading this close to posted + 24 h is "24 h later"; further off, the last reading stands in. */
export const NEAR_24H_MS = 3 * 3_600_000;
const DAY_MS = 86_400_000;
/** Right coin: the cap read nearest launch + 1 h, within half an hour of it. */
const CAP_WINDOW_MS = 3_600_000;
const CAP_AT_MS = 30 * 60_000;
/** Right coin: coins of the same name launched within a day of ours either side. */
const SAME_NAME_MS = DAY_MS;

/* ── the rows ────────────────────────────────────────────────────────────────────────────────── */

/** Every coin tied to a post: its metadata names the post, or the owner confirmed it (as lead-time.ts). */
const LINKED = `
  select l.source || ':' || l.source_item_id as item_id, l.address, a.minted_at, a.minted_at_source, a.minted_at_bound_s
    from internal.coin_post_link l join public.asset a on a.asset_key = l.asset_key
  union all
  select f.item_id, f.coin_address, coalesce(a.minted_at, n.launched_at), case when a.minted_at is null then null else a.minted_at_source end, a.minted_at_bound_s
    from internal.owner_feedback f
    left join public.asset a on a.chain = 'solana' and a.address = f.coin_address
    left join public.coin_name n on n.address = f.coin_address
   where f.subject_kind = 'coin_match' and f.verdict = 'right' and f.coin_address is not null`;

const OWNER_LABEL = `(select o.verdict from internal.owner_feedback o
                       where o.subject_kind = 'post' and o.item_id = %ID% and o.verdict in ('meme', 'not')
                       order by o.created_at desc limit 1)`;

const reach = (when: string, order: 'asc' | 'desc') => `(select array[extract(epoch from o.captured_at) * 1000, o.value] from public.observation o
   where o.item_id = f.item_id and o.kind = 'reach' and o.value is not null and ${when} order by o.captured_at ${order} limit 1)`;

const FYP_ROWS = `
  with f as (
    select fp.item_id, fp.first_shown_at, i.posted_at
      from public.feed_post fp join public.item i using (item_id)
     where fp.feed_id = 'fyp' and fp.first_shown_at >= $1 and fp.first_shown_at < $2
  ),
  linked as (${LINKED})
  select f.item_id, f.first_shown_at, f.posted_at,
         ${OWNER_LABEL.replace('%ID%', 'f.item_id')} as label,
         (exists (select 1 from internal.gold_addition g where g.item_id = f.item_id)
          or exists (select 1 from internal.missed_post m where m.item_id = f.item_id)) as listed,
         ${reach('o.captured_at <= f.first_shown_at', 'desc')} as at_shown,
         ${reach("o.captured_at <= f.posted_at + interval '24 hours'", 'desc')} as before24,
         ${reach("o.captured_at >= f.posted_at + interval '24 hours'", 'asc')} as after24,
         (select array[extract(epoch from o.captured_at) * 1000, o.value] from public.observation o
           where o.item_id = f.item_id and o.kind = 'reach' and o.value is not null order by o.value desc, o.captured_at desc limit 1) as top,
         c.minted_at as first_coin_at, c.minted_at_source as first_coin_source, c.minted_at_bound_s as first_coin_bound
    from f
    left join lateral (select * from linked l where l.item_id = f.item_id and l.minted_at is not null order by l.minted_at limit 1) c on true`;

const COVER_ROWS = `
  with memeable as (
    select item_id, 'label' as why from internal.owner_feedback where subject_kind = 'post' and verdict = 'meme' and item_id is not null
    union all select item_id, 'gold' from internal.gold_addition
    union all select item_id, 'missed' from internal.missed_post where item_id is not null
    union all select source || ':' || source_item_id, 'coined' from internal.coin_post_link
    union all select item_id, 'coined' from internal.owner_feedback where subject_kind = 'coin_match' and verdict = 'right' and item_id is not null
  ),
  m as (
    select m.item_id, array_agg(distinct m.why) as why, i.source, i.posted_at
      from memeable m join public.item i using (item_id)
     where i.posted_at >= $1 and i.posted_at < $2
     group by m.item_id, i.source, i.posted_at
  )
  select m.item_id, m.source, m.posted_at, m.why, fp.first_shown_at,
         (select max(o.value) from public.observation o where o.item_id = m.item_id and o.kind = 'reach') as top,
         (select min(o.captured_at) from public.observation o
           where o.item_id = m.item_id and o.kind = 'reach' and o.value >= $3::float8 * (case m.source when 'x' then $4::float8 when 'tiktok' then $5::float8 end)) as crossed_at
    from m
    left join public.feed_post fp on fp.feed_id = 'fyp' and fp.item_id = m.item_id
   where ${OWNER_LABEL.replace('%ID%', 'm.item_id')} is distinct from 'not'`;

/** Each post's first coin (earliest launched link) that launched while the post was on For You. */
const SPEED_ROWS = `
  with firsts as (
    select distinct on (l.source, l.source_item_id) l.source || ':' || l.source_item_id as item_id, l.address, l.found_at,
           a.minted_at, a.minted_at_source, a.minted_at_bound_s
      from internal.coin_post_link l join public.asset a on a.asset_key = l.asset_key
     where a.minted_at is not null
     order by l.source, l.source_item_id, a.minted_at, l.found_at
  )
  select c.item_id, c.address, c.minted_at, c.minted_at_source, c.minted_at_bound_s, c.found_at, s.seen_at
    from firsts c
    join public.feed_post fp on fp.feed_id = 'fyp' and fp.item_id = c.item_id
    left join people.pipeline_seen s on s.stream = 'fyp-proven' and s.key = c.item_id || '|' || c.address
   where c.minted_at >= $1 and c.minted_at < $2
     and c.minted_at > fp.first_shown_at and c.minted_at <= coalesce(fp.last_shown_at, fp.first_shown_at)`;

const RIGHT_ROWS = `
  with p as (
    select split_part(key, '|', 1) as item_id, split_part(key, '|', 2) as mint, seen_at
      from people.pipeline_seen where stream = 'fyp-proven' and key like '%|%' and seen_at >= $1 and seen_at < $2
  ),
  ours as materialized (
    select p.*, coalesce(a.symbol, n.ticker) as ticker, coalesce(a.name, n.name) as name, coalesce(a.minted_at, n.launched_at) as at
      from p left join public.asset a on a.chain = 'solana' and a.address = p.mint left join public.coin_name n on n.address = p.mint
  ),
  named as materialized (
    select o.item_id, o.mint, x.address, x.launched_at
      from ours o cross join lateral (
        select n.address, n.launched_at from public.coin_name n
         where upper(n.ticker) = upper(o.ticker) and n.launched_at between o.at - $3::float8 * interval '1 millisecond' and o.at + $3::float8 * interval '1 millisecond'
        union
        select n.address, n.launched_at from public.coin_name n
         where lower(n.name) = lower(o.name) and n.launched_at between o.at - $3::float8 * interval '1 millisecond' and o.at + $3::float8 * interval '1 millisecond'
        union
        select o.mint, o.at
      ) x
     where o.at is not null
  )
  select n.item_id, n.mint, o.seen_at, n.address,
         (select m.market_cap_usd from public.market_reading m
           where m.chain = 'solana' and m.address = n.address and m.market_cap_usd is not null
             and m.taken_at between n.launched_at + ($4::float8 - $5::float8) * interval '1 millisecond' and n.launched_at + ($4::float8 + $5::float8) * interval '1 millisecond'
           order by abs(extract(epoch from m.taken_at - n.launched_at) * 1000 - $4::float8) limit 1) as cap_1h,
         exists (select 1 from internal.coin_post_link l
                  where l.address = n.address and l.source || ':' || l.source_item_id = n.item_id) as names_post
    from named n join ours o on o.item_id = n.item_id and o.mint = n.mint`;

/* ── the arithmetic (pure) ───────────────────────────────────────────────────────────────────── */

type Reading = readonly [number, number] | null;

export interface FypRow {
  readonly itemId: string;
  readonly shownAtMs: number;
  readonly postedAtMs: number | null;
  readonly label: 'meme' | 'not' | null;
  /** A gold sheet or the owner's missed list holds it, or a coin names it. */
  readonly evidence: boolean;
  readonly atShown: Reading;
  readonly before24: Reading;
  readonly after24: Reading;
  readonly top: Reading;
  readonly firstCoinAtMs: number | null;
  readonly firstCoinClock: 'chain' | 'within' | 'unknown' | null;
}

export interface CoverRow {
  readonly itemId: string;
  readonly source: string;
  readonly postedAtMs: number;
  readonly why: readonly string[];
  readonly shownAtMs: number | null;
  readonly top: number | null;
  readonly crossedAtMs: number | null;
}

export interface SpeedRow {
  readonly itemId: string;
  readonly mintedAtMs: number;
  readonly clock: 'chain' | 'within' | 'unknown';
  readonly foundAtMs: number;
  readonly seenAtMs: number | null;
}

export interface RightRow {
  readonly itemId: string;
  readonly mint: string;
  readonly seenAtMs: number;
  readonly address: string;
  readonly cap1h: number | null;
  /** This coin's own links name the post too (a copycat that copied the links, or ours). */
  readonly namesPost: boolean;
}

export const median = (xs: readonly number[]): number | null => quantile(xs, 0.5);
export function quantile(xs: readonly number[], q: number): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return (s[lo] ?? 0) + ((s[hi] ?? 0) - (s[lo] ?? 0)) * (i - lo);
}

/** The views "24 h later": the reading nearest posted + 24 h when one is near; else the highest, flagged. */
export function finalViews(r: Pick<FypRow, 'postedAtMs' | 'atShown' | 'before24' | 'after24' | 'top'>): { readonly v: number; readonly at24: boolean } | null {
  if (r.postedAtMs !== null) {
    const t = r.postedAtMs + DAY_MS;
    const near = [r.before24, r.after24].filter((x): x is readonly [number, number] => x !== null && Math.abs(x[0] - t) <= NEAR_24H_MS).sort((a, b) => Math.abs(a[0] - t) - Math.abs(b[0] - t))[0];
    if (near !== undefined) return { v: Math.max(near[1], r.atShown?.[1] ?? 0), at24: true };
  }
  return r.top === null ? null : { v: r.top[1], at24: false };
}

export interface RightTally {
  readonly coins: number;
  /** No other coin of the name to beat. */
  readonly alone: number;
  /** Ours had the biggest cap at +1 h of every one measured. */
  readonly biggest: number;
  /** Another coin of the name was bigger at +1 h (or measured where ours was not). */
  readonly beaten: number;
  /** Ours had no reading at +1 h and no rival did either. */
  readonly cantTell: number;
}

/** Each proven coin against its rivals: the coins of its name `rival` keeps. */
export function rightTally(right: readonly RightRow[], rival: (r: RightRow) => boolean = () => true): RightTally {
  const pairs = new Map<string, RightRow[]>();
  for (const r of right) pairs.set(`${r.itemId}|${r.mint}`, [...(pairs.get(`${r.itemId}|${r.mint}`) ?? []), r]);
  const t = { coins: pairs.size, alone: 0, biggest: 0, beaten: 0, cantTell: 0 };
  for (const rows of pairs.values()) {
    const mint = rows[0]?.mint;
    const others = rows.filter((r) => r.address !== mint && rival(r));
    const ours = rows.find((r) => r.address === mint)?.cap1h ?? null;
    if (others.length === 0) t.alone += 1;
    else if (others.some((r) => r.cap1h !== null && (ours === null || r.cap1h > ours))) t.beaten += 1;
    else if (ours === null) t.cantTell += 1;
    else t.biggest += 1;
  }
  return t;
}

export interface Scorecard {
  readonly label: string;
  readonly fyp: number;
  readonly memeable: { readonly labelledMeme: number; readonly labelledNot: number; readonly evidence: number };
  readonly earliness: { readonly measured: number; readonly at24: number; readonly noReadingBefore: number; readonly medianRatio: number | null; readonly under20: number };
  readonly coverage: { readonly viral: number; readonly shownEarly: number; readonly shownLate: number; readonly byWhy: Readonly<Record<string, number>> };
  readonly beforeCoin: { readonly coined: number; readonly coinedFirst: number; readonly uncoined: number; readonly unknownClock: number; readonly medianAheadMin: number | null };
  readonly speed: { readonly coins: number; readonly shown: number; readonly unknownClock: number; readonly medianS: number | null; readonly p90S: number | null; readonly linkMedianS: number | null; readonly linkP90S: number | null };
  /** Against every coin of the same name, and against only those whose links name the post too. */
  readonly right: RightTally;
  readonly rightNaming: RightTally;
}

const asIn = <T>(xs: readonly T[], at: (x: T) => number | null, from: number, to: number) => xs.filter((x) => {
  const t = at(x);
  return t !== null && t >= from && t < to;
});

/** One column of the table: the rows already cut to the window by their own clock. */
export function scorecard(label: string, fyp: readonly FypRow[], cover: readonly CoverRow[], speed: readonly SpeedRow[], right: readonly RightRow[], lines: Readonly<Record<string, number>> = VIRAL_LINE): Scorecard {
  const ratios: number[] = [];
  let at24 = 0;
  let noReadingBefore = 0;
  for (const r of fyp) {
    const fin = finalViews(r);
    if (r.atShown === null) noReadingBefore += 1;
    if (fin === null || r.atShown === null || fin.v <= 0) continue;
    ratios.push(Math.min(1, r.atShown[1] / fin.v));
    if (fin.at24) at24 += 1;
  }

  const coined = fyp.filter((r) => r.firstCoinAtMs !== null);
  const ahead = coined.filter((r) => r.firstCoinClock !== 'unknown').map((r) => ((r.firstCoinAtMs ?? 0) - r.shownAtMs) / 60_000);

  const viral = cover.filter((r) => r.top !== null && r.top >= (lines[r.source] ?? Infinity));
  const early = viral.filter((r) => r.shownAtMs !== null && (r.crossedAtMs === null || r.shownAtMs < r.crossedAtMs));
  const byWhy: Record<string, number> = {};
  for (const r of viral) for (const w of r.why) byWhy[w] = (byWhy[w] ?? 0) + 1;

  const timed = speed.filter((r) => r.clock !== 'unknown');
  const shown = timed.filter((r) => r.seenAtMs !== null);

  return {
    label,
    fyp: fyp.length,
    memeable: { labelledMeme: fyp.filter((r) => r.label === 'meme').length, labelledNot: fyp.filter((r) => r.label === 'not').length, evidence: fyp.filter((r) => r.label !== 'not' && (r.label === 'meme' || r.evidence)).length },
    earliness: { measured: ratios.length, at24, noReadingBefore, medianRatio: median(ratios), under20: ratios.filter((x) => x < EARLY_SHARE).length },
    coverage: { viral: viral.length, shownEarly: early.length, shownLate: viral.filter((r) => r.shownAtMs !== null).length - early.length, byWhy },
    beforeCoin: { coined: coined.length, coinedFirst: coined.filter((r) => r.firstCoinClock !== 'unknown' && (r.firstCoinAtMs ?? 0) > r.shownAtMs).length, uncoined: fyp.length - coined.length, unknownClock: coined.length - ahead.length, medianAheadMin: median(ahead) },
    speed: {
      coins: timed.length,
      shown: shown.length,
      unknownClock: speed.length - timed.length,
      medianS: median(shown.map((r) => ((r.seenAtMs ?? 0) - r.mintedAtMs) / 1000)),
      p90S: quantile(shown.map((r) => ((r.seenAtMs ?? 0) - r.mintedAtMs) / 1000), 0.9),
      linkMedianS: median(timed.map((r) => (r.foundAtMs - r.mintedAtMs) / 1000)),
      linkP90S: quantile(timed.map((r) => (r.foundAtMs - r.mintedAtMs) / 1000), 0.9),
    },
    right: rightTally(right),
    rightNaming: rightTally(right, (r) => r.namesPost),
  };
}

/* ── the database ────────────────────────────────────────────────────────────────────────────── */

const ms = (v: Date | string | null): number | null => (v === null ? null : new Date(v).getTime());
const reading = (v: (string | number)[] | null): Reading => (v === null || v.length < 2 ? null : [Number(v[0]), Number(v[1])]);
const clockOf = (source: unknown, bound: unknown): 'chain' | 'within' | 'unknown' => launchClock(source, bound).kind;

export interface ScorecardRows {
  readonly fyp: readonly FypRow[];
  readonly cover: readonly CoverRow[];
  readonly speed: readonly SpeedRow[];
  readonly right: readonly RightRow[];
}

/** Every row the window needs, read once; `scorecards` cuts them by day. */
export async function scorecardRows(db: Db, since: Date, until: Date, lines: Readonly<Record<string, number>> = VIRAL_LINE): Promise<ScorecardRows> {
  type F = { item_id: string; first_shown_at: Date; posted_at: Date | null; label: 'meme' | 'not' | null; listed: boolean; at_shown: (string | number)[] | null; before24: (string | number)[] | null; after24: (string | number)[] | null; top: (string | number)[] | null; first_coin_at: Date | null; first_coin_source: string | null; first_coin_bound: number | null };
  type C = { item_id: string; source: string; posted_at: Date; why: string[]; first_shown_at: Date | null; top: number | null; crossed_at: Date | null };
  type S = { item_id: string; address: string; minted_at: Date; minted_at_source: string | null; minted_at_bound_s: number | null; found_at: Date; seen_at: Date | null };
  type R = { item_id: string; mint: string; seen_at: Date; address: string; cap_1h: number | null; names_post: boolean };
  const [f, c, s, r] = await Promise.all([
    db.query<F>(FYP_ROWS, [since, until]),
    db.query<C>(COVER_ROWS, [since, until, EARLY_SHARE, lines['x'] ?? null, lines['tiktok'] ?? null]),
    db.query<S>(SPEED_ROWS, [since, until]),
    db.query<R>(RIGHT_ROWS, [since, until, SAME_NAME_MS, CAP_WINDOW_MS, CAP_AT_MS]),
  ]);
  return {
    fyp: f.map((x) => ({
      itemId: x.item_id,
      shownAtMs: new Date(x.first_shown_at).getTime(),
      postedAtMs: ms(x.posted_at),
      label: x.label,
      evidence: x.listed || x.first_coin_at !== null,
      atShown: reading(x.at_shown),
      before24: reading(x.before24),
      after24: reading(x.after24),
      top: reading(x.top),
      firstCoinAtMs: ms(x.first_coin_at),
      firstCoinClock: x.first_coin_at === null ? null : clockOf(x.first_coin_source, x.first_coin_bound),
    })),
    cover: c.map((x) => ({ itemId: x.item_id, source: x.source, postedAtMs: new Date(x.posted_at).getTime(), why: x.why, shownAtMs: ms(x.first_shown_at), top: x.top === null ? null : Number(x.top), crossedAtMs: ms(x.crossed_at) })),
    speed: s.map((x) => ({ itemId: x.item_id, mintedAtMs: new Date(x.minted_at).getTime(), clock: clockOf(x.minted_at_source, x.minted_at_bound_s), foundAtMs: new Date(x.found_at).getTime(), seenAtMs: ms(x.seen_at) })),
    right: r.map((x) => ({ itemId: x.item_id, mint: x.mint, seenAtMs: new Date(x.seen_at).getTime(), address: x.address, cap1h: x.cap_1h === null ? null : Number(x.cap_1h), namesPost: x.names_post })),
  };
}

/** The whole window, then each UTC day in it (oldest first), each number on its own clock. */
export function scorecards(rows: ScorecardRows, since: Date, until: Date): readonly Scorecard[] {
  const all = scorecard('all', rows.fyp, rows.cover, rows.speed, rows.right);
  const days: Scorecard[] = [];
  for (let d = Math.floor(since.getTime() / DAY_MS) * DAY_MS; d < until.getTime(); d += DAY_MS) {
    const from = Math.max(d, since.getTime());
    const to = Math.min(d + DAY_MS, until.getTime());
    days.push(scorecard(new Date(d).toISOString().slice(0, 10), asIn(rows.fyp, (x) => x.shownAtMs, from, to), asIn(rows.cover, (x) => x.postedAtMs, from, to), asIn(rows.speed, (x) => x.mintedAtMs, from, to), asIn(rows.right, (x) => x.seenAtMs, from, to)));
  }
  return [...days, all];
}

/* ── the table ───────────────────────────────────────────────────────────────────────────────── */

const pct = (n: number, d: number) => (d === 0 ? '—' : `${Math.round((100 * n) / d)}%`);
const frac = (n: number, d: number) => (d === 0 ? '— (none)' : `${pct(n, d)} (${n}/${d})`);
const num = (v: number | null, unit: string, dash: string) => (v === null ? `— (${dash})` : `${Math.round(v)}${unit}`);
const signed = (v: number | null, dash: string) => (v === null ? `— (${dash})` : `${v >= 0 ? '+' : ''}${Math.round(v)} min`);

/** The rows of the table: one line per number, one column per day and the window. */
export function scorecardTable(cards: readonly Scorecard[], lines: Readonly<Record<string, number>> = VIRAL_LINE): readonly string[] {
  const rows: [string, (c: Scorecard) => string][] = [
    ['For You posts first shown', (c) => String(c.fyp)],
    ['1a memeable, labelled only', (c) => frac(c.memeable.labelledMeme, c.memeable.labelledMeme + c.memeable.labelledNot)],
    ['1b memeable, untapped = memeable', (c) => frac(c.fyp - c.memeable.labelledNot, c.fyp)],
    ['1c memeable, on evidence only', (c) => frac(c.memeable.evidence, c.fyp)],
    ['2  median views shown / at 24h', (c) => (c.earliness.medianRatio === null ? '— (no readings)' : `${Math.round(100 * c.earliness.medianRatio)}% of final`)],
    ['2  shown under 20% of final', (c) => frac(c.earliness.under20, c.earliness.measured)],
    ['2  final read near 24h', (c) => frac(c.earliness.at24, c.earliness.measured)],
    ['3  viral memeable shown <20% line', (c) => frac(c.coverage.shownEarly, c.coverage.viral)],
    ['3  ... shown, but later', (c) => String(c.coverage.shownLate)],
    ['4  shown before any coin, all', (c) => frac(c.beforeCoin.uncoined + c.beforeCoin.coinedFirst, c.fyp)],
    ['4  shown before coin, coined only', (c) => frac(c.beforeCoin.coinedFirst, c.beforeCoin.coined)],
    ['4  median ahead of first coin', (c) => signed(c.beforeCoin.medianAheadMin, 'none coined')],
    ['5  coin speed median', (c) => num(c.speed.medianS, ' s', 'none shown')],
    ['5  coin speed p90', (c) => num(c.speed.p90S, ' s', 'none shown')],
    ['5  first coins timed / on the line', (c) => `${c.speed.shown}/${c.speed.coins}`],
    ['5  link written, median / p90', (c) => `${num(c.speed.linkMedianS, ' s', 'none')} / ${num(c.speed.linkP90S, ' s', 'none')}`],
    ['6  right coin (biggest at +1h)', (c) => frac(c.right.alone + c.right.biggest, c.right.coins)],
    ['6  beaten / can\'t tell / alone', (c) => `${c.right.beaten} / ${c.right.cantTell} / ${c.right.alone}`],
    ['6  right, rivals naming the post', (c) => frac(c.rightNaming.alone + c.rightNaming.biggest, c.rightNaming.coins)],
  ];
  const width = Math.max(...rows.map((r) => r[0].length));
  const cols = cards.map((c) => [c.label, ...rows.map((r) => r[1](c))]);
  const colW = cols.map((col) => Math.max(...col.map((s) => s.length)));
  const line = (head: string, cells: readonly string[]) => `${head.padEnd(width)}  ${cells.map((s, i) => s.padEnd(colW[i] ?? 0)).join('  ')}`.trimEnd();
  const all = cards[cards.length - 1];
  const why = all === undefined ? '' : Object.entries(all.coverage.byWhy).sort((a, b) => b[1] - a[1]).map(([w, n]) => `${w} ${n}`).join(', ');
  return [
    line('', cols.map((c) => c[0] ?? '')),
    ...rows.map((r, i) => line(r[0], cols.map((c) => c[i + 1] ?? ''))),
    `Viral line: X ${lines['x']?.toLocaleString('en-GB')} views, TikTok ${lines['tiktok']?.toLocaleString('en-GB')} plays (our own readings). Days are UTC: 1, 2, 4 by first shown; 3 by posted; 5 by launch; 6 by the coin's first sight on the line.`,
    `Memeable for coverage: the owner's meme label, a gold sheet, his missed list or a coin naming the post, never his "not"; the viral ones by evidence: ${why || '—'}.`,
  ];
}
