/**
 * THE NARRATIVES TAB'S ORDERS, per window: for each of Policy.narrative.trend's windows (1h, 6h,
 * 24h), each narrative's facts in it (views gained, new posts) and its place in the trending order
 * (core group/narrative-trend.ts). The frame (narrative-frame.ts) writes them on the page as
 * `inWindow`; the phone sorts by them and shows the facts, never the number behind the order.
 *
 * Its own file because it is the one place the frame reads market and trade rows: the checked
 * coin's market cap at the window's start and now (public.market_reading, already stored by the
 * market reader) and the buys made through us in the window (public.trade). No new reads of any
 * outside source — the trending order costs nothing beyond these two statements a frame.
 *
 * ★ ONLY A CHECKED OR PROVEN COIN is an input (the owner's rule): a coin the owner confirmed, or
 * the one coin its posts prove. Several proven equally, a fitting coin, a top coin: not checked,
 * never read here, never moving the order.
 *
 * What breaks if changed carelessly: both statements are bounded by the board (at most one coin a
 * narrative, `BOARD_LIMIT` narratives, three windows) and each reading is one index probe on
 * market_reading's primary key. A statement over every coin's readings would be the projector
 * freezing again.
 */

import type { Policy } from '@insidor/contracts/policy.ts';
import { trendFacts, trendOrder, type NarrativeCoin, type TrendCoin, type TrendFacts, type TrendInput } from '@insidor/core';
import type { Db } from '@insidor/store';

import { measured, type WireStory } from './wire.ts';

const HOUR_MS = 3_600_000;

/** The one coin that counts for the order: confirmed, or the single coin its posts prove. */
export function checkedCoinOf(coin: NarrativeCoin): string | null {
  if (coin.kind === 'confirmed') return coin.address;
  if (coin.kind === 'proven' && coin.addresses.length === 1) return coin.addresses[0] ?? null;
  return null;
}

/** The checked coins' market caps at each window's start and now, and our buys in it. */
export async function loadTrendCoins(db: Db, addresses: readonly string[], nowMs: number, windowsMs: readonly number[]): Promise<ReadonlyMap<string, ReadonlyMap<number, TrendCoin>>> {
  const out = new Map<string, Map<number, TrendCoin>>();
  if (addresses.length === 0 || windowsMs.length === 0) return out;
  const now = new Date(nowMs).toISOString();
  /* The newest reading in the window before each edge: a reading older than one window is not "the cap then". */
  const caps = await db.query<{ address: string; ms: string | number; cap_start: number | null; cap_now: number | null }>(
    `select x.address, w.ms,
            (select m.market_cap_usd from public.market_reading m
              where m.chain = 'solana' and m.address = x.address and m.market_cap_usd is not null
                and m.taken_at <= $2::timestamptz - make_interval(secs => w.ms / 1000.0)
                and m.taken_at > $2::timestamptz - make_interval(secs => 2 * w.ms / 1000.0)
              order by m.taken_at desc limit 1) as cap_start,
            (select m.market_cap_usd from public.market_reading m
              where m.chain = 'solana' and m.address = x.address and m.market_cap_usd is not null
                and m.taken_at <= $2::timestamptz
                and m.taken_at > $2::timestamptz - make_interval(secs => w.ms / 1000.0)
              order by m.taken_at desc limit 1) as cap_now
       from unnest($1::text[]) as x(address) cross join unnest($3::bigint[]) as w(ms)`,
    [[...addresses], now, [...windowsMs]],
  );
  const longest = Math.max(...windowsMs);
  const buys = await db.query<{ mint: string; at: Date | string }>(
    `select mint, settled_at as at from public.trade
      where kind = 'buy' and status = 'confirmed' and mint = any($1::text[])
        and settled_at > $2::timestamptz - make_interval(secs => $3::bigint / 1000.0) and settled_at <= $2::timestamptz`,
    [[...addresses], now, longest],
  );
  const buyTimes = new Map<string, number[]>();
  for (const b of buys) {
    const t = b.at instanceof Date ? b.at.getTime() : Date.parse(b.at);
    if (Number.isFinite(t)) buyTimes.set(b.mint, [...(buyTimes.get(b.mint) ?? []), t]);
  }
  for (const c of caps) {
    const ms = Number(c.ms);
    const of = out.get(c.address) ?? new Map<number, TrendCoin>();
    of.set(ms, {
      capAtStart: c.cap_start === null ? null : Number(c.cap_start),
      capNow: c.cap_now === null ? null : Number(c.cap_now),
      buys: (buyTimes.get(c.address) ?? []).filter((t) => t > nowMs - ms).length,
    });
    out.set(c.address, of);
  }
  return out;
}

/** One narrative as the orders read it. */
export interface TrendSubject {
  readonly id: string;
  readonly input: Omit<TrendInput, 'coin'>;
  readonly coin: string | null;
}

/** The window's name on the wire: "1h", "6h", "24h". */
export const windowHours = (ms: number): number => Math.round(ms / HOUR_MS);

/**
 * Each narrative's facts and trending place in every window, as the page's `inWindow`; and the
 * first window's order, the board's own order (Trending 1h is the tab's default). ★ A dead
 * narrative (`dead`, core `narrativeDead`) gets its facts and no place, and is not in the order:
 * Trending is the stories still picking up.
 */
export function trendWindows(subjects: readonly TrendSubject[], coins: ReadonlyMap<string, ReadonlyMap<number, TrendCoin>>, nowMs: number, policy: Policy, dead: ReadonlySet<string> = new Set()): { readonly pages: Map<string, NonNullable<WireStory['inWindow']>>; readonly order: readonly string[] } {
  const pages = new Map<string, { hours: number; viewsGained: ReturnType<typeof measured>; newPosts: number; viralPosts: number; viralAccounts: number; viralMinViews: number; trendingPlace?: number }[]>();
  const bar = policy.rising.fypMinReach;
  let first: readonly string[] = [];
  policy.narrative.trend.windows.forEach((w, i) => {
    const facts = new Map<string, TrendFacts>();
    for (const s of subjects) {
      const coin = s.coin === null ? null : (coins.get(s.coin)?.get(w.ms) ?? null);
      facts.set(s.id, trendFacts({ ...s.input, coin }, nowMs, w.ms, policy));
    }
    const order = trendOrder(subjects.filter((s) => !dead.has(s.id)).map((s) => ({ id: s.id, facts: facts.get(s.id) as TrendFacts, foundAtMs: s.input.foundAtMs })), policy);
    if (i === 0) first = order;
    for (const s of subjects) {
      const f = facts.get(s.id);
      if (!dead.has(s.id) || f === undefined) continue;
      pages.set(s.id, [...(pages.get(s.id) ?? []), { hours: windowHours(w.ms), viewsGained: measured(f.gained, 'not_read_yet'), newPosts: f.newPosts, viralPosts: f.viralPosts, viralAccounts: f.viralAccounts, viralMinViews: bar }]);
    }
    order.forEach((id, place) => {
      const f = facts.get(id);
      if (f === undefined) return;
      const list = pages.get(id) ?? [];
      list.push({ hours: windowHours(w.ms), viewsGained: measured(f.gained, 'not_read_yet'), newPosts: f.newPosts, viralPosts: f.viralPosts, viralAccounts: f.viralAccounts, viralMinViews: bar, trendingPlace: place + 1 });
      pages.set(id, list);
    });
  });
  return { pages, order: first };
}
