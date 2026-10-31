/**
 * THE OWNER'S COIN CALLS, AS ROWS — every call on a post's coin, and the SQL spelling of "the
 * current call" that the store's own readers share.
 *
 * Two shapes, because two kinds of reader need them:
 *   `rows`                 every coin call, oldest first, for core `foldCoinCalls` (the projector:
 *                          which coin a post shows, which coins it must never show, and the coin
 *                          the owner confirmed for a post's story)
 *   `CURRENT_COIN_CALLS`   one row per post, its newest call, for SQL readers that only need "the
 *                          coin the owner says is this post's" (the re-tune's coin labels, the
 *                          coins the runner must add, the coined posts the judge is shown)
 *
 * ★ "WRONG" WITH A COIN IS THE RIGHT COIN, UNLESS IT TAKES BACK AN EARLIER RIGHT. The app saves the
 * owner's pick after "Wrong coin" as `wrong` with the picked coin. `CURRENT_COIN_CALLS` reports that
 * row as `right`, except when an earlier `right` on the same post named the same coin — the owner
 * taking it back (rows 15 and 183, KARL) — which stays `wrong`. core match/owner-coin-calls.ts is
 * the same rule in code; its tests pin the cases.
 *
 * Its own file so the rule has one SQL spelling: three readers in two files each had their own
 * `distinct on`, and each dropped the owner's pick after "Wrong coin" the same way.
 *
 * ★ A COIN SET ON A NARRATIVE IS A COIN SET ON ITS FIRST POST (the owner, 2026-10-31: "i gave a few
 * posts and narratives the right ca"). The narrative sheet saves "Right coin" / the pick after "Wrong
 * coin" as subject `narrative`, item `n-<post id>`, with the coin. Until now no reader looked at
 * those rows, so 19 coins the owner gave narratives since 16 Oct were never shown. `COIN_CALL_ROWS`
 * reads them as coin calls on the post the narrative is named after, under the same rules and the
 * same clock as a call made on the post itself: the newest call on that post wins either way. One
 * difference in what is saved: a narrative's "Wrong coin" stores the coin it REJECTED (NarrativeEdit
 * `coin_wrong` with the shown coin), where a post's stores the coin picked instead. So a narrative's
 * `wrong` is re-read as a bare "wrong" on that shown coin, never as a pick.
 *
 * What breaks if changed carelessly: the tie-break. `created_at desc, id desc` everywhere — two
 * calls saved in one request share a time, and the later id is the later call.
 */

import type { Db } from '../client.ts';

/**
 * Every coin call as a post's: the post's own (`coin_match`) and a narrative's coin, re-keyed to the
 * narrative's first post. A subquery with the owner_feedback columns the readers below use.
 */
const COIN_CALL_ROWS = `
  select id, case when subject_kind = 'narrative' then substr(item_id, 3) else item_id end as item_id,
         verdict,
         case when subject_kind = 'narrative' and verdict = 'wrong' then null else coin_address end as coin_address,
         note,
         case when subject_kind = 'narrative' and verdict = 'wrong' then jsonb_build_object('coinId', 'solana:' || coin_address) else shown end as shown,
         created_at
    from internal.owner_feedback
   where subject_kind = 'coin_match'
      or (subject_kind = 'narrative' and item_id like 'n-%' and verdict in ('right', 'wrong') and coin_address is not null)`;

/**
 * One row per post with a coin call: `item_id`, `verdict` ('right', 'wrong', 'none' or 'cleared',
 * with the pick after "Wrong coin" already read as 'right'), `coin_address`, `note`, `created_at`.
 * A subquery: use as `from (${CURRENT_COIN_CALLS}) cur`.
 */
export const CURRENT_COIN_CALLS = `
  select distinct on (f.item_id) f.item_id,
         case when f.verdict = 'wrong' and f.coin_address is not null
                   and not exists (select 1 from (${COIN_CALL_ROWS}) e
                                    where e.item_id = f.item_id and e.verdict = 'right'
                                      and e.coin_address = f.coin_address and (e.created_at, e.id) < (f.created_at, f.id))
              then 'right' else f.verdict end as verdict,
         f.coin_address, f.note, f.created_at
    from (${COIN_CALL_ROWS}) f
   order by f.item_id, f.created_at desc, f.id desc`;

/** One stored coin call, as core `foldCoinCalls` reads it; `shownCoinId` is the card's coin id, if it showed one. */
export interface StoredCoinCall {
  readonly itemId: string;
  readonly verdict: string;
  readonly coinAddress: string | null;
  readonly shownCoinId: string | null;
  readonly atMs: number;
  readonly id: number;
}

export class PgOwnerCoinCallRepo {
  readonly #db: Db;
  constructor(db: Db) {
    this.#db = db;
  }

  /** Every coin call, oldest first; only these posts' when `itemIds` is given. */
  async rows(itemIds: readonly string[] | null = null): Promise<readonly StoredCoinCall[]> {
    if (itemIds !== null && itemIds.length === 0) return [];
    const rows = await this.#db.query<{ id: string | number; item_id: string; verdict: string; coin_address: string | null; shown_coin: string | null; created_at: Date | string }>(
      `select id, item_id, verdict, coin_address, shown->>'coinId' as shown_coin, created_at
         from (${COIN_CALL_ROWS}) c
        ${itemIds === null ? '' : 'where item_id = any($1::text[])'}
        order by created_at, id`,
      itemIds === null ? [] : [[...itemIds]],
    );
    return rows.map((r) => ({ itemId: r.item_id, verdict: r.verdict, coinAddress: r.coin_address, shownCoinId: r.shown_coin, atMs: new Date(r.created_at).getTime(), id: Number(r.id) }));
  }
}
