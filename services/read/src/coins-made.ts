/**
 * HOW MANY COINS A NARRATIVE'S CARD MAY OFFER — the Narratives tab's "See N coins" (the owner,
 * 2026-10-24: a card with no picked coin said "No coin yet" with Create and no way to see the coins
 * that exist). N is the length of the list the narrative page's Choose coin pop-up will show, so it
 * is counted from the same set and by the same rule:
 *
 *   the set   what GET /story/:id/sheet lists (story-sheet.ts `buildStorySheet`): the narrative's
 *             own link coins, then the coins written beside it (public.same_name_coin), then the
 *             coins its first MEMBERS_MAX posts' feed cards prove (`matched` / `one`), without
 *             repeats, the first STORY_COINS_MAX of them
 *   the rule  the phone's (mobile/src/shared/coins-made.ts `coinsMadeAfter`): a coin launched no
 *             earlier than COIN_LEAD_MS before the narrative's oldest post, or the narrative's own
 *             proven coin; a coin whose launch we do not know is not counted, as it is not listed
 *
 * Its own file beside story-sheet.ts because it answers for a page of narratives at once, in ONE
 * statement for at most a list page's ids (narrative-sorts.ts), with no market read: the count needs
 * only launch times, which the name index holds. The launch time is the sheet's own
 * (`coalesce(asset.minted_at, coin_name.launched_at)`, the link's `mintedAt` for the proven coin).
 *
 * ★ A COUNT IS A FACT OR IT IS ABSENT. A narrative this statement did not answer for gets no count,
 * never 0, and the phone then shows no button; the list itself never fails for want of one.
 *
 * What breaks if changed carelessly: change the set or the rule here and not in story-sheet.ts and
 * the phone's coins-made.ts (or the reverse) and the button says "See 3 coins" over a pop-up of two.
 */

import { MEMBERS_MAX, STORY_COINS_MAX } from './story-sheet.ts';
import type { Db, Row } from './queries.ts';

/** How long before the narrative's oldest post a coin may launch and still count: the phone's COIN_LEAD_MS. */
export const COIN_LEAD_MS = 10 * 60_000;

/**
 * Per narrative in `$1`: its oldest post's time, its own proven coin and that coin's launch from its
 * link, and its candidate coins in the sheet's order (`grp` link, beside it, its posts' cards), each
 * with the launch time the sheet would read. `$2` is the sheet's bound on posts read.
 */
export const COINS_MADE_SQL = `
with v as (
  select story_id, payload from public.story_view where story_id = any($1::text[])
), cand as (
  select v.story_id, 0 as grp, x.ord, x.value ->> 'address' as address
    from v cross join lateral jsonb_array_elements(case v.payload #>> '{coins,kind}'
      when 'one' then jsonb_build_array(v.payload #> '{coins,coin}')
      when 'several' then case when jsonb_typeof(v.payload #> '{coins,coins}') = 'array' then v.payload #> '{coins,coins}' else '[]'::jsonb end
      else '[]'::jsonb end) with ordinality as x(value, ord)
  union all
  select s.subject_id, 1, s.position, s.address
    from public.same_name_coin s where s.subject_kind = 'story' and s.subject_id = any($1::text[])
  union all
  select v.story_id, 2, m.ord, m.coins #>> '{coin,address}'
    from v cross join lateral (
      select e.ord, coalesce(
        (select r.payload -> 'coins' from public.rising_row r where r.item_id = e.value ->> 'evidenceId' order by (r.feed_id = 'fyp') desc limit 1),
        (select f.payload -> 'coins' from public.feed_post f where f.item_id = e.value ->> 'evidenceId' and f.payload is not null order by (f.feed_id = 'fyp') desc limit 1)
      ) as coins
      from jsonb_array_elements(coalesce(v.payload -> 'evidence', '[]'::jsonb)) with ordinality as e(value, ord)
      order by e.ord limit $2
    ) m
   where m.coins ->> 'kind' in ('matched', 'one')
)
select v.story_id,
       (select min((p.value #>> '{postedAt,at}')::double precision) from jsonb_array_elements(coalesce(v.payload -> 'evidence', '[]'::jsonb)) p
         where jsonb_typeof(p.value #> '{postedAt,at}') = 'number') as first_posted,
       case when v.payload #>> '{coins,kind}' = 'one' then v.payload #>> '{coins,coin,address}' end as proven,
       case when jsonb_typeof(v.payload #> '{coins,coin,mintedAt,at}') = 'number' then (v.payload #>> '{coins,coin,mintedAt,at}')::double precision end as proven_at,
       (select jsonb_agg(jsonb_build_object('a', c.address, 'at', extract(epoch from coalesce(a.minted_at, n.launched_at)) * 1000) order by c.grp, c.ord)
          from cand c
          left join public.coin_name n on n.address = c.address
          left join public.asset a on a.chain = 'solana' and a.address = n.address
         where c.story_id = v.story_id and c.address is not null) as coins
  from v`;

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

/**
 * One narrative's count from its row: the sheet's set (in order, no repeats, the first
 * STORY_COINS_MAX), then the phone's rule over it. No oldest post: only its proven coin counts.
 */
export function coinsMadeOf(r: Row): number {
  const first = num(r['first_posted']);
  const proven = str(r['proven']);
  const seen = new Map<string, number | null>();
  for (const c of Array.isArray(r['coins']) ? r['coins'] : []) {
    const o = typeof c === 'object' && c !== null ? (c as Row) : {};
    const a = str(o['a']);
    if (a === null || seen.has(a)) continue;
    if (seen.size >= STORY_COINS_MAX) break;
    /* The sheet keeps the link's own launch for its coin when the name index does not hold one. */
    seen.set(a, num(o['at']) ?? (a === proven ? num(r['proven_at']) : null));
  }
  let n = 0;
  for (const [a, at] of seen) if (a === proven || (first !== null && at !== null && at >= first - COIN_LEAD_MS)) n += 1;
  return n;
}

/** Each listed narrative's count, by id; a narrative the statement did not answer for is left out. */
export async function coinsMade(db: Db, ids: readonly string[]): Promise<ReadonlyMap<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await db.query(COINS_MADE_SQL, [[...ids], MEMBERS_MAX]);
  return new Map(rows.flatMap((r) => (typeof r['story_id'] === 'string' ? [[r['story_id'], coinsMadeOf(r)] as const] : [])));
}
