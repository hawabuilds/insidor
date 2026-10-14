/**
 * GET /rising/:feed/older?before=<cursor> — For You's and Popular's infinite scroll: every post that
 * was ever on the feed and is not on its frame now (public.feed_post, 0075), twenty at a time,
 * newest-joined first. The phone shows the frame (`GET /rising/:feed`) at the top and appends these
 * pages under it as the person scrolls.
 *
 * ★ THE CURSOR IS WHEN THE POST JOINED, THEN ITS ID. `first_shown_at` is written once and never
 * moved (services/project feed-members.ts), so a page boundary the phone holds never shifts: a post
 * joining later lands above every cursor, where the frame and the live slide-in show it. The cursor
 * is opaque to the phone (`<ms>~<id>`); a malformed one is a 400, never a guess.
 *
 * ★ THE ONE PLACE THIS SERVICE CHANGES A PAYLOAD, AND WHY. Everything else here hands the
 * projection over verbatim. But a member's card was projected when it was last refreshed, minutes
 * or hours ago, and its coin's price, market cap, liquidity and day's move were current THEN. A
 * card whose projection is older than the market's freshness bar (`market.readingFreshnessMs`, the
 * bar the projector itself dashes a price by) has those four dashed as not read yet: a cap from
 * yesterday is never shown as today's. The coin itself, the views and every other fact stay — they
 * are still true. The phone's card shows a live cap anyway when it holds a fresh price.
 *
 * Its own file because routes.ts holds no meaning and this holds one decision. What breaks if
 * changed carelessly: a payload's `sheet` must stay cut, as the frame's is; and a database without
 * 0075 answers 404 (the phone then stops asking), never a 500 and never an empty list that would
 * claim the feed has no older posts.
 */

import { DEFAULT_POLICY } from '@insidor/contracts';

import type { Row } from './queries.ts';

/** Posts per page: the phone asks for the next page about ten cards before the end. */
export const FEED_PAGE_SIZE = 20;

export const FEED_PAGE_FEEDS: readonly string[] = ['fyp', 'popular'];

/**
 * One page of a feed's members not on its frame now, from a cursor. The frame's own posts are
 * left out because the phone already shows them above; a post that left the frame while the
 * phone was reading is the phone's to de-duplicate, by id.
 */
export const FEED_PAGE_SQL = `
select (f.payload - 'sheet') || jsonb_build_object('authorPictureUrl', to_jsonb(a) ->> 'picture_url') as payload,
       f.item_id, f.first_shown_at, f.payload_at
  from public.feed_post f
  left join public.item i on i.item_id = f.item_id
  left join public.author a on a.author_key = i.author_key
 where f.feed_id = $1
   and f.withdrawn_at is null
   and f.payload is not null
   and not exists (select 1 from public.rising_row r where r.feed_id = f.feed_id and r.item_id = f.item_id)
   and (f.first_shown_at, f.item_id) < ($2::timestamptz, $3::text)
 order by f.first_shown_at desc, f.item_id desc
 limit $4`;

export interface Cursor {
  readonly atMs: number;
  readonly id: string;
}

/** The first page starts above every member: the last millisecond of the year 9999. */
export const FIRST_PAGE: Cursor = { atMs: 253_402_300_799_999, id: '' };

export function parseCursor(raw: string | null): Cursor | null {
  if (raw === null || raw === '') return FIRST_PAGE;
  const m = /^(\d{1,15})~(.{1,200})$/s.exec(raw);
  if (m === null) return null;
  const atMs = Number(m[1]);
  return Number.isSafeInteger(atMs) && atMs <= FIRST_PAGE.atMs ? { atMs, id: m[2] ?? '' } : null;
}

export const cursorText = (c: Cursor): string => `${c.atMs}~${c.id}`;

const msOf = (v: unknown): number | null => {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'string') {
    const n = Date.parse(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const DASHED = { v: null, why: 'not_read_yet' } as const;

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function dashMarket(coin: unknown): unknown {
  if (!isObj(coin)) return coin;
  return { ...coin, priceUsd: DASHED, marketCapUsd: DASHED, liquidityUsd: DASHED, priceChange24h: DASHED, marketCapBasis: null };
}

/** The card as projected, with its coins' market numbers dashed when the projection is older than the bar. */
export function withCurrentMarket(payload: unknown, payloadAtMs: number | null, nowMs: number, freshnessMs: number = DEFAULT_POLICY.market.readingFreshnessMs): unknown {
  if (!isObj(payload)) return payload;
  if (payloadAtMs !== null && nowMs - payloadAtMs <= freshnessMs) return payload;
  const coins = payload['coins'];
  if (!isObj(coins)) return payload;
  if ((coins['kind'] === 'one' || coins['kind'] === 'matched') && 'coin' in coins) return { ...payload, coins: { ...coins, coin: dashMarket(coins['coin']) } };
  if (coins['kind'] === 'several' && Array.isArray(coins['coins'])) return { ...payload, coins: { ...coins, coins: coins['coins'].map(dashMarket) } };
  return payload;
}

/** The reply's body from the page's rows: the cards, and the cursor of the next page when this one was full. */
export function feedPage(rows: readonly Row[], nowMs: number, size: number = FEED_PAGE_SIZE): { readonly posts: readonly unknown[]; readonly next: string | null } {
  const posts = rows.map((r) => {
    if (r['payload'] === undefined || r['payload'] === null) throw new TypeError('a feed member arrived with no payload');
    return withCurrentMarket(r['payload'], msOf(r['payload_at']), nowMs);
  });
  const last = rows[rows.length - 1];
  const lastAt = last === undefined ? null : msOf(last['first_shown_at']);
  const lastId = last === undefined ? null : last['item_id'];
  const next = rows.length >= size && lastAt !== null && typeof lastId === 'string' ? cursorText({ atMs: lastAt, id: lastId }) : null;
  return { posts, next };
}
