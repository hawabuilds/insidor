/**
 * PROMOTIONS OFF THE FEEDS, AND THEIR COIN ON THE ORIGINAL (Policy.rising.promotion; the owner,
 * 2026-10-24): which of a frame's posts only point at another account's bigger post (core
 * match/promotion.ts), and where each such post's picked coin goes instead.
 *
 * Its own file because it is one gate over every route at once. rising.ts lets a post onto For You
 * by the views bar, a coin's vouch, the coin-first route, the late route or a running pick, and onto
 * Popular by its views; a promotion is taken out of the frame's lists after every route has had its
 * say, so no route — present or future — can put one back. And it is the one reader of the picks on
 * promotions, so the card, the running route and the push all hear the same original.
 *
 * The miss that made it (24 Oct): @Infinitidigits' "We ran Moustache Baby, but how tf did we miss
 * this Light Baby?!" quoting @prtygal777's 6-day-old 69M-view post was picked $BI at 13:23 UTC and put
 * on For You by its coin at 13:34, at 0 views. The coin-link step's own promotion rule
 * (services/runner work/coin-links.ts) only sees the posts a coin's metadata names; this one was
 * found by the stream and tied by the matcher through another account's quote of it.
 *
 * ★ THE COIN GOES TO THE ORIGINAL. A promotion's pick is carried on its original's card when the
 * original has no picked coin of its own: always when the original was young at the launch (core
 * `promotionAge`), and for an older one only while the coin runs by the saved-post bars (core
 * `promotionRevives`) — then the running route brings the original back to For You, at its own age
 * on the card. The carried pick claims no tie: the coin does not link the original, so the card says
 * only that it is the post's coin and how long after the post it launched. The pick row itself is
 * the runner's (services/runner one-coin.ts) and is never written here.
 *
 * What breaks if changed carelessly: reading the original's reach from anywhere but its own row's
 * newest reading. The bigger-post rule compares the two posts' counts as the coin-link step does; a
 * different source for one of them would call a viral quote a promotion, or the reverse.
 */

import { promotionAge, promotionOf, promotionRevives, type PromotedOriginal, type PromoFacts } from '@insidor/core';
import { DEFAULT_POLICY, type Policy } from '@insidor/contracts/policy.ts';
import { missingTable, type Db } from '@insidor/store';

import type { CardPick } from './one-coin-cards.ts';

/** Whether the rule is in force. */
export const promotionOn = (policy: Policy = DEFAULT_POLICY): boolean => policy.rising.promotion.on;

/** The views bar a post must reach on its own not to be a promotion, by its source (rising.ts scales the short-video source). */
export type OwnReachOf = (source: string) => number;

const num = (x: unknown): number | null => (x === null || x === undefined ? null : Number.isFinite(Number(x)) ? Number(x) : null);
const ms = (x: unknown): number | null => {
  if (x === null || x === undefined) return null;
  const n = x instanceof Date ? x.getTime() : Date.parse(String(x));
  return Number.isFinite(n) ? n : null;
};

/** The originals these posts promote, by promotion id; a post that is not one is absent. */
export async function loadPromotions(db: Db, itemIds: readonly string[], ownReachOf: OwnReachOf): Promise<ReadonlyMap<string, PromotedOriginal>> {
  if (itemIds.length === 0) return new Map();
  const refs = await db.query<{ t: string | null }>(`select to_regclass('internal.post_reference')::text as t`);
  const kept = (refs[0]?.t ?? null) !== null;
  const rows = await db.query<{ item_id: string; source: string; author_key: string; reach: unknown; rebroadcast_of: string | null; reproduction_of: string | null; refers_to: string[] | null }>(
    `select i.item_id, i.source, i.author_key, i.counters -> 'reach' ->> 'value' as reach, i.rebroadcast_of, i.reproduction_of,
            ${kept ? '(select r.refers_to from internal.post_reference r where r.item_id = i.item_id)' : 'null::text[]'} as refers_to
       from public.item i
      where i.item_id = any($1::text[]) and (i.rebroadcast_of is not null or i.reproduction_of is not null${kept ? ' or exists (select 1 from internal.post_reference r where r.item_id = i.item_id and cardinality(r.refers_to) > 0)' : ''})`,
    [[...new Set(itemIds)]],
  );
  if (rows.length === 0) return new Map();
  const facts = rows.map((r) => ({
    source: r.source,
    p: { itemId: r.item_id, authorKey: r.author_key, reach: num(r.reach), rebroadcastOf: r.rebroadcast_of, reproductionOf: r.reproduction_of, links: r.refers_to ?? [] } satisfies PromoFacts,
  }));
  const targets = [...new Set(facts.flatMap(({ p }) => [p.rebroadcastOf, p.reproductionOf, ...p.links].filter((t): t is string => t !== null && t !== p.itemId)))];
  const held = new Map(
    (await db.query<{ item_id: string; author_key: string; reach: unknown; at: unknown }>(
      `select item_id, author_key, counters -> 'reach' ->> 'value' as reach, coalesce(posted_at, first_seen_at) as at from public.item where item_id = any($1::text[])`,
      [targets],
    )).map((o) => [o.item_id, { itemId: o.item_id, authorKey: o.author_key, reach: num(o.reach), postedAtMs: ms(o.at) } satisfies PromotedOriginal] as const),
  );
  const out = new Map<string, PromotedOriginal>();
  for (const { source, p } of facts) {
    const o = promotionOf(p, (id) => held.get(id), { ownReach: ownReachOf(source) });
    if (o !== null) out.set(p.itemId, o);
  }
  return out;
}

/** A coin picked for a promotion, as its original takes it. */
export interface PromotedPick {
  readonly promoId: string;
  readonly original: PromotedOriginal;
  readonly address: string;
  readonly launchedAtMs: number | null;
  readonly age: 'young' | 'old';
  /** The coin runs by the saved-post bars inside a day of its launch (core `promotionRevives`). */
  readonly revives: boolean;
  /** The judge's first question said yes on the original at least once. */
  readonly originalJudgedYes: boolean;
}

export interface PromotedPicks {
  /** Every recent pick on a promotion, by the promotion. */
  readonly byPromo: ReadonlyMap<string, PromotedPick>;
  /** The coin each original carries now (young, or old and running), by the original: running first, then the first launched. */
  readonly byOriginal: ReadonlyMap<string, PromotedPick>;
}

export const NO_PROMOTED_PICKS: PromotedPicks = { byPromo: new Map(), byOriginal: new Map() };

/** Whether this pick's coin is the original's now: young at the launch, or old and running. */
export const carries = (p: Pick<PromotedPick, 'age' | 'revives'>): boolean => p.age === 'young' || p.revives;

/** The one coin an original carries from its promotions' picks (the header), or none. */
export function carriedBy(picks: readonly PromotedPick[]): ReadonlyMap<string, PromotedPick> {
  const out = new Map<string, PromotedPick>();
  for (const p of picks) {
    if (!carries(p)) continue;
    const had = out.get(p.original.itemId);
    const earlier = (a: PromotedPick, b: PromotedPick): boolean => (a.launchedAtMs ?? Infinity) < (b.launchedAtMs ?? Infinity) || ((a.launchedAtMs ?? Infinity) === (b.launchedAtMs ?? Infinity) && a.address < b.address);
    if (had === undefined || (p.revives && !had.revives) || (p.revives === had.revives && earlier(p, had))) out.set(p.original.itemId, p);
  }
  return out;
}

/**
 * The picks of the last `runnerLink.running.pickWithinMs` on promotions, each with its coin's launch
 * and newest reading. Empty when the rule is off, the pick is not the card's coin, or before 0113.
 */
export async function loadPromotedPicks(db: Db, nowMs: number, ownReachOf: OwnReachOf, policy: Policy = DEFAULT_POLICY): Promise<PromotedPicks> {
  if (!promotionOn(policy) || policy.oneCoin.mode !== 'live') return NO_PROMOTED_PICKS;
  let rows: { item_id: string; address: string; launched: unknown; vol: unknown; trades: unknown; at: unknown }[];
  try {
    rows = await db.query(
      `select p.item_id, p.address, coalesce(a.minted_at, a.first_seen_at) as launched,
              r.volume_1h_usd as vol, (r.buys_1h + r.sells_1h) as trades, r.taken_at as at
         from internal.post_coin_pick p
         join public.asset a on a.address = p.address
         left join lateral (select m.volume_1h_usd, m.buys_1h, m.sells_1h, m.taken_at from public.market_reading m
                             where m.asset_key = a.asset_key order by m.taken_at desc limit 1) r on true
        where p.outcome = 'picked' and p.updated_at >= $1`,
      [new Date(nowMs - policy.runnerLink.running.pickWithinMs).toISOString()],
    );
  } catch (e) {
    if (missingTable(e)) return NO_PROMOTED_PICKS;
    throw e;
  }
  const promos = await loadPromotions(db, rows.map((r) => r.item_id), ownReachOf);
  if (promos.size === 0) return NO_PROMOTED_PICKS;
  const originals = [...new Set([...promos.values()].map((o) => o.itemId))];
  const yes = new Set(
    (await db.query<{ item_id: string }>(
      `select distinct item_id from internal.post_judgement where item_id = any($1::text[]) and coinable is true and prompt_id not like 'post-kind%'`,
      [originals],
    )).map((r) => r.item_id),
  );
  const byPromo = new Map<string, PromotedPick>();
  for (const r of rows) {
    const original = promos.get(r.item_id);
    if (original === undefined) continue;
    const launchedAtMs = ms(r.launched);
    byPromo.set(r.item_id, {
      promoId: r.item_id,
      original,
      address: r.address,
      launchedAtMs,
      age: promotionAge(original.postedAtMs, launchedAtMs, policy),
      revives: promotionRevives(launchedAtMs, { volume1hUsd: num(r.vol), trades1h: num(r.trades), readAtMs: ms(r.at) }, nowMs, policy),
      originalJudgedYes: yes.has(original.itemId),
    });
  }
  return { byPromo, byOriginal: carriedBy([...byPromo.values()]) };
}

/** The pick an original's card shows from its promotion: the coin, no tie claimed, and how long after the post it launched. */
export function carriedPick(p: PromotedPick): CardPick {
  const after = p.launchedAtMs === null || p.original.postedAtMs === null ? null : p.launchedAtMs - p.original.postedAtMs;
  return { address: p.address, outcome: 'picked', ties: [], launchedAfterMs: after };
}

/** These cards' picks with each original's carried coin where it has no picked coin of its own. */
export function withCarried(picks: ReadonlyMap<string, CardPick>, carried: ReadonlyMap<string, PromotedPick>, itemIds: readonly string[]): ReadonlyMap<string, CardPick> {
  if (carried.size === 0) return picks;
  const out = new Map(picks);
  for (const id of itemIds) {
    const c = carried.get(id);
    if (c !== undefined && out.get(id)?.outcome !== 'picked') out.set(id, carriedPick(c));
  }
  return out;
}
