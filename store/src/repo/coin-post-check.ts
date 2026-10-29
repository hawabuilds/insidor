/**
 * The coin-and-post answers (0151): the pairs still to ask, each answer written once, the day's
 * count for the cap, and the "no"s the matchers drop.
 *
 * Its own repo, apart from image-pairs.ts: that one keys a pair of PICTURES, which two coins with the
 * same logo share; this keys a coin and a post, because the question reads the coin's words too.
 *
 * ★ ONLY NAME-ONLY TIES ARE DUE. A candidate the runner tied by a link, a picture or a missed runner,
 * or one the projector found by the poster's posted address, never comes up: those are proven or near
 * it by evidence the judge would only second-guess. And only for a post on a feed or in a narrative —
 * a tie on a post nobody sees costs money and shows nothing.
 *
 * What breaks if changed carelessly: `refused` reads `answer = 'no'` and nothing else. A null answer
 * (nothing learned) or "unsure" must keep the coin: an outage is not a claim.
 */

import type { Millis } from '@insidor/contracts';
import type { SameSubjectAnswer } from '@insidor/contracts/ports/judge.ts';

import type { Db } from '../client.ts';
import { toTimestamp } from '../rows.ts';

/** One pair to ask, with each side as it presents itself. */
export interface CoinPostDue {
  readonly itemId: string;
  readonly address: string;
  readonly coinName: string | null;
  readonly coinTicker: string | null;
  readonly coinDescription: string | null;
  readonly coinPicture: string;
  /** The words of the post the coin's own link points at, when we hold it. */
  readonly linkedText: string | null;
  readonly postText: string | null;
  readonly postPicture: string;
}

interface DueRow {
  item_id: string;
  address: string;
  coin_name: string | null;
  coin_ticker: string | null;
  coin_description: string | null;
  coin_picture: string;
  linked_text: string | null;
  post_text: string | null;
  post_picture: string;
}

/**
 * Each side as it presents itself, over a set `s(item_id, address)`: the coin's name, ticker,
 * description and picture, the words of the post its own link names, and the post's words and first
 * picture (a video's poster frame when it has no picture, never the video file). Shared by `due` and
 * `sides`, so the golden cases ask exactly what the runner asks.
 */
const SIDES = `select s.item_id, s.address, a.name as coin_name, a.symbol as coin_ticker, m.description as coin_description,
              coalesce(m.image_uri, a.image_uri) as coin_picture,
              (select li.body from public.item li where li.item_id = 'x:' || substring(m.social_link from '/status/([0-9]+)')) as linked_text,
              i.body as post_text,
              coalesce(
                (select e->>'uri' from jsonb_array_elements(i.media) e where e->>'kind' = 'image' and coalesce(e->>'uri', '') <> '' limit 1),
                (select e->>'uri' from jsonb_array_elements(i.media) e where e->>'kind' = 'video' and e->>'uri' !~* '\\.(mp4|m3u8|mov|webm)([?#]|$)' limit 1)
              ) as post_picture
         from shown s
         join public.item i on i.item_id = s.item_id
         join public.asset a on a.address = s.address
         left join internal.coin_metadata m on m.asset_key = a.asset_key
        where coalesce(m.image_uri, a.image_uri) like 'https://%'
          and jsonb_typeof(i.media) = 'array'
          and coalesce(substring(m.social_link from '/status/([0-9]+)'), '') <> coalesce(i.source_item_id, '')`;

/**
 * ★ THE POST'S OWN NAME, AND NO CLAIM ELSEWHERE (29 Oct, live): over `k` (item_id, address), true when the
 * coin's name or ticker IS the subject the judge named for the post and the coin's own link names no other
 * post. Such a coin is never dropped, and never asked: on its first live hour the judge said "no" to seven
 * $GTA6 coins on the South Park GTA 6 posts, reading "Earn $TTWO stock" as another story. @AFP's $vanilla
 * keeps its "no" — the name is the post's, but its link says it is about another post.
 */
const OWN_NAME = `(
  exists (
    select 1 from public.asset na
      left join internal.coin_metadata nm on nm.asset_key = na.asset_key
      cross join lateral (
        select pj.proposed_name from internal.post_judgement pj
         where pj.item_id = k.item_id and pj.prompt_id not like 'post-kind%'
         order by pj.judged_at desc, pj.id desc limit 1) j
     where na.address = k.address
       and regexp_replace(lower(coalesce(j.proposed_name, '')), '[^a-z0-9]', '', 'g') <> ''
       and regexp_replace(lower(coalesce(j.proposed_name, '')), '[^a-z0-9]', '', 'g')
           in (regexp_replace(lower(coalesce(na.name, '')), '[^a-z0-9]', '', 'g'), regexp_replace(lower(coalesce(na.symbol, '')), '[^a-z0-9]', '', 'g'))
       and coalesce(nm.social_link, '') !~ '/status/[0-9]+'))`;

const duesOf = (rows: readonly DueRow[]): CoinPostDue[] =>
  rows
    .filter((r) => r.post_picture !== null && r.post_picture.startsWith('https://'))
    .map((r) => ({
      itemId: r.item_id,
      address: r.address,
      coinName: r.coin_name,
      coinTicker: r.coin_ticker,
      coinDescription: r.coin_description,
      coinPicture: r.coin_picture,
      linkedText: r.linked_text,
      postText: r.post_text,
      postPicture: r.post_picture,
    }));

export class PgCoinPostCheckRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /**
   * The name-only ties on screen not yet asked, newest post first: the runner's picked coin for a post
   * or its narrative, and the projector's "See N coins" list, on a post shown on a feed or joined to a narrative since `sinceMs`, both
   * pictures known. Driven from those posts, not from the candidates: read from the candidates it took
   * 78 s on 29 Oct, too slow for a step every 20 s. Only coins ON SCREEN: every name-only candidate of
   * a day's shown posts was 6,989 pairs, three times the day's cap, most never shown. A pick dropped on
   * "no" hands over to the next coin, which is due on a later pass. A coin whose own link names this
   * very post is left out: it already says it is this post's.
   */
  async due(sinceMs: Millis, limit: number): Promise<readonly CoinPostDue[]> {
    const rows = await this.#db.query<DueRow>(
      `with posts as (
         select f.item_id from public.feed_post f where f.withdrawn_at is null and f.last_shown_at >= $1
         union
         select nm.item_id from internal.narrative_member nm where nm.joined_at >= $1
       ), ties as (
         select o.item_id, o.address from posts p
           join internal.post_coin_pick pk on pk.item_id = p.item_id and pk.outcome = 'picked'
           join internal.one_coin_candidate o on o.item_id = p.item_id and o.address = pk.address
          where not (o.evidence->'ties' ?| array['link', 'picture', 'missed_runner'])
         union
         select o.item_id, o.address from posts p
           join internal.narrative_member nm on nm.item_id = p.item_id
           join internal.narrative_coin_pick nk on nk.narrative_id = nm.narrative_id and nk.outcome = 'picked'
           join internal.one_coin_candidate o on o.item_id = p.item_id and o.address = nk.address
          where not (o.evidence->'ties' ?| array['link', 'picture', 'missed_runner'])
         union
         select s.subject_id, s.address from posts p join public.same_name_coin s on s.subject_kind = 'post' and s.subject_id = p.item_id
       ), shown as (
         select t.* from ties t
          where not exists (select 1 from internal.coin_post_check k where k.item_id = t.item_id and k.address = t.address)
       ), k as (
         select s.* from shown s
       ), shown2 as (
         select k.* from k where not ${OWN_NAME}
       )
       ${SIDES.replace('from shown s', 'from shown2 s')}
        order by i.posted_at desc nulls last
        limit $2`,
      [toTimestamp(sinceMs), limit],
    );
    return duesOf(rows);
  }

  /** The sides of these pairs whether or not they were asked: the golden cases (tools/golden.ts). */
  async sides(pairs: readonly { readonly itemId: string; readonly address: string }[]): Promise<readonly CoinPostDue[]> {
    if (pairs.length === 0) return [];
    const rows = await this.#db.query<DueRow>(
      `with shown as (select * from unnest($1::text[], $2::text[]) as p(item_id, address))
       ${SIDES}`,
      [pairs.map((p) => p.itemId), pairs.map((p) => p.address)],
    );
    return duesOf(rows);
  }

  /** One answer, once: a pair already answered keeps its first answer. Null is "nothing learned". */
  async record(itemId: string, address: string, answer: SameSubjectAnswer | null, promptId: string, model: string, usd: number, at: Millis): Promise<void> {
    await this.#db.query(
      `insert into internal.coin_post_check (item_id, address, answer, prompt_id, model, usd, checked_at)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (item_id, address) do nothing`,
      [itemId, address, answer, promptId, model, usd, toTimestamp(at)],
    );
  }

  /** Pairs asked since an instant — the day's count for the cap. */
  async countSince(at: Millis): Promise<number> {
    const rows = await this.#db.query<{ n: string | number }>(`select count(*) as n from internal.coin_post_check where checked_at >= $1`, [toTimestamp(at)]);
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * Of these pairs, the ones the judge answered "no", as `item|address`. Before 0151: none.
   *
   * ★ ASKED FIRST WHETHER THE TABLE IS THERE, never caught after: the projector reads this inside its
   * one transaction, where a failed statement aborts every statement after it — a caught "no such
   * table" would still empty the frame.
   */
  async refused(pairs: readonly { readonly itemId: string; readonly address: string }[]): Promise<ReadonlySet<string>> {
    if (pairs.length === 0) return new Set();
    const there = await this.#db.query<{ ok: boolean }>(`select to_regclass('internal.coin_post_check') is not null as ok`);
    if (there[0]?.ok !== true) return new Set();
    const rows = await this.#db.query<{ item_id: string; address: string }>(
      `select k.item_id, k.address from internal.coin_post_check k
         join unnest($1::text[], $2::text[]) as p(item_id, address) on p.item_id = k.item_id and p.address = k.address
        where k.answer = 'no' and not ${OWN_NAME}`,
      [pairs.map((p) => p.itemId), pairs.map((p) => p.address)],
    );
    return new Set(rows.map((r) => `${r.item_id}|${r.address}`));
  }
}
