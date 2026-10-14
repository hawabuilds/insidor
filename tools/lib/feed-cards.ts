/**
 * EVERY FEED CARD'S COIN LINE, AS THE APP IS SENT IT: the live frame (public.rising_row, For You
 * and Popular) and every member of the scroll (public.feed_post, 0075, not withdrawn), each with
 * the coin the card shows (a proven or story coin, `matched` / `one` / the first of `several`),
 * or the "See N coins" count when it shows none (`unsure`).
 *
 * Shared by the namer's backfill (tools/name-backfill.ts: before and after) and its first-day
 * watch (tools/name-watch.ts: each run against the last), so "the card changed coin" means one
 * thing in both. Read-only.
 *
 * What breaks if changed carelessly: the payload read. The live frame's payload is the fresher
 * one (rewritten every projector run); a scroll member's is its last projection. A card in both
 * is read from the live frame.
 */

import type { Db } from '../../store/src/index.ts';

export interface FeedCard {
  readonly itemId: string;
  readonly feeds: readonly string[];
  readonly live: boolean;
  readonly excerpt: string;
  /** The coin line's kind as sent: matched, one, several, unsure, none, pending, unchecked, or null (no payload yet). */
  readonly kind: string | null;
  /** The coin the card shows; null when it shows none. */
  readonly address: string | null;
  readonly name: string | null;
  readonly ticker: string | null;
  /** "See N coins": the unsure line's count; null when the card shows no list. */
  readonly claimCount: number | null;
}

type Coin = { address?: unknown; name?: unknown; ticker?: unknown };
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

/** The card's coin line out of a payload. */
export function coinLineOf(payload: unknown): Pick<FeedCard, 'kind' | 'address' | 'name' | 'ticker' | 'claimCount' | 'excerpt'> {
  const p = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>;
  const c = (typeof p['coins'] === 'object' && p['coins'] !== null ? p['coins'] : {}) as Record<string, unknown>;
  const kind = str(c['kind']);
  const shown: Coin | null =
    kind === 'matched' || kind === 'one' ? ((c['coin'] ?? null) as Coin | null) : kind === 'several' && Array.isArray(c['coins']) ? ((c['coins'][0] ?? null) as Coin | null) : null;
  return {
    excerpt: (str(p['excerpt']) ?? '').replace(/\s+/g, ' ').slice(0, 120),
    kind,
    address: str(shown?.address),
    name: str(shown?.name),
    ticker: str(shown?.ticker),
    claimCount: kind === 'unsure' && typeof c['claimCount'] === 'number' ? c['claimCount'] : null,
  };
}

/** Every card on For You, Popular and the scroll, now. */
export async function feedCards(db: Db): Promise<readonly FeedCard[]> {
  const rows = await db.query<{ item_id: string; feeds: string[]; live: boolean; payload: unknown }>(
    `with live as (select item_id, array_agg(distinct feed_id) as feeds, (array_agg(payload))[1] as payload from public.rising_row group by item_id),
          member as (select item_id, array_agg(distinct feed_id) as feeds, (array_agg(payload order by last_shown_at desc))[1] as payload
                       from public.feed_post where withdrawn_at is null group by item_id)
     select coalesce(l.item_id, m.item_id) as item_id,
            array(select distinct unnest(coalesce(l.feeds, '{}') || coalesce(m.feeds, '{}'))) as feeds,
            l.item_id is not null as live,
            coalesce(l.payload, m.payload) as payload
       from live l full join member m on m.item_id = l.item_id`,
  );
  return rows.map((r) => ({ itemId: r.item_id, feeds: r.feeds, live: r.live, ...coinLineOf(r.payload) }));
}
