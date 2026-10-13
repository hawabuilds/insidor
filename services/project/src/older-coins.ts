/**
 * "AN OLDER COIN IS TRADING ON THIS": the running older coins of each feed post, as wire facts.
 *
 * The runner measures coins launched before a post, named for its subject, for whether their
 * trading jumped since the post (services/runner work/older-coins.ts, internal.older_coin 0060).
 * This module reads the ones that did and turns each into facts the card can say: its name and
 * ticker, when its market began, its usual hour and its busiest hour since in dollars, how its
 * price moved since the post, and when that was read. rising.ts puts them on the post as
 * `runningOlder`, a field of its own beside `coins`.
 *
 * ★ NEVER THE POST'S COIN, AND NEVER A BUY ON THE CARD. A coin launched before a post cannot be
 * its coin (core match/post-coin.ts), so these never enter `coins` and never carry the coin
 * shape a Buy button is built from — only an address, which opens the coin's own page.
 *
 * ★ THE BARS STAY BEHIND. `running` decides which rows are read; the multiples and the floor it
 * was decided with are not on the wire. What is sent are dollars and prices, true whether or not
 * Insidor exists. A coin whose name or ticker would leak a word the wire refuses (a vendor's
 * name) is left off the card rather than failing the whole post.
 *
 * What breaks if changed carelessly: the table check. The projector runs inside one transaction;
 * querying a table 0060 has not created would abort it and every feed with it, so the table's
 * presence is asked first and an absent table is "nothing running", not an error.
 */

import type { Db } from '@insidor/store';

import { assertNoInternalVocabulary, instant, type WireInstant } from './wire.ts';

/** At most this many older coins are carried on one post; the busiest hour first. */
export const MAX_OLDER_SHOWN = 10;

/** One older coin whose trading jumped since the post. Facts only. */
export interface WireOlderCoin {
  /** The coin's address: the card opens its token page with it. */
  readonly address: string;
  readonly name: string | null;
  readonly ticker: string | null;
  /** When its market began, as the search reported it: before the post, by construction. */
  readonly launchedAt: WireInstant;
  /** Dollars traded per hour, averaged over the day before the post. */
  readonly hourBeforeUsd: number | null;
  /** The busiest hour since the post, in dollars. */
  readonly peakHourUsd: number;
  /** The last price since the post against the last before it, as a fraction: -0.25 is down a quarter. */
  readonly priceChangeSincePost: number | null;
  /** When these numbers were read. */
  readonly readAt: WireInstant;
}

interface Row {
  item_id: string;
  address: string;
  name: string | null;
  ticker: string | null;
  launched_at: Date | string;
  checked_at: Date | string | null;
  hour_before_usd: number | string | null;
  peak_hour_usd: number | string | null;
  price_at_post_usd: number | string | null;
  price_since_usd: number | string | null;
}

const ms = (v: Date | string | null): number | null => {
  if (v === null) return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(t) ? t : null;
};
const num = (v: number | string | null): number | null => (v === null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** One row as the wire carries it, or null when it cannot be said (no peak, or a refused word). */
export function olderCoinFacts(r: Row): WireOlderCoin | null {
  const peak = num(r.peak_hour_usd);
  if (peak === null) return null;
  const at = num(r.price_at_post_usd);
  const since = num(r.price_since_usd);
  const coin: WireOlderCoin = {
    address: r.address,
    name: r.name,
    ticker: r.ticker,
    launchedAt: instant(ms(r.launched_at), 'not_reported'),
    hourBeforeUsd: num(r.hour_before_usd),
    peakHourUsd: peak,
    priceChangeSincePost: at !== null && at > 0 && since !== null ? since / at - 1 : null,
    readAt: instant(ms(r.checked_at), 'not_read_yet'),
  };
  try {
    assertNoInternalVocabulary(coin, '$.runningOlder');
  } catch {
    return null;
  }
  return coin;
}

/** Each post's running older coins, busiest hour first. Empty for a post with none. */
export async function loadRunningOlder(db: Db, itemIds: readonly string[]): Promise<ReadonlyMap<string, readonly WireOlderCoin[]>> {
  if (itemIds.length === 0) return new Map();
  const present = await db.query<{ ok: boolean }>(`select to_regclass('internal.older_coin') is not null as ok`);
  if (present[0]?.ok !== true) return new Map();
  const rows = await db.query<Row>(
    `select o.item_id, o.address, o.name, o.ticker, o.launched_at, o.checked_at,
            o.hour_before_usd, o.peak_hour_usd, o.price_at_post_usd, o.price_since_usd
       from internal.older_coin o
      where o.running and o.item_id = any($1::text[])
      order by o.item_id, o.peak_hour_usd desc nulls last, o.address`,
    [[...itemIds]],
  );
  const out = new Map<string, WireOlderCoin[]>();
  for (const r of rows) {
    const coin = olderCoinFacts(r);
    const list = out.get(r.item_id) ?? [];
    if (coin === null || list.length >= MAX_OLDER_SHOWN) continue;
    out.set(r.item_id, [...list, coin]);
  }
  return out;
}
