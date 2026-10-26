/**
 * Items and their authors.
 *
 * Nothing in this file knows a platform's field names. By the time an Item reaches
 * here it is already in our vocabulary; the adapter did the translating and is the
 * only code permitted to have done it. If a vendor word ever appears in this file,
 * the boundary has already been crossed somewhere upstream.
 *
 * The `counters` column is written here as a convenience cache of the newest
 * reading. It is NOT the record — public.observation is — and nothing that
 * differences counters may read it, because a cache that is one pass stale
 * produces a rate that is silently wrong rather than absent.
 */

import type { Item, CounterSet, Fingerprint, Judgement, MediaRef, Millis } from '@insidor/contracts';
import { JUDGE_EVIDENCE } from '@insidor/contracts';
import type { ItemId, SourceId } from '@insidor/contracts/ids.ts';
import type { ItemRepo } from '@insidor/contracts/ports/store.ts';
import type { CoinModelTarget } from '@insidor/contracts/policy.ts';

import type { Db } from '../client.ts';
import { NotImplemented } from '../not-implemented.ts';
import { reBrand, toBitLiteral, toMillis, toMillisRequired, toTimestamp } from '../rows.ts';
import type { TimestampColumn } from '../rows.ts';

interface ItemRow {
  item_id: string;
  source: string;
  source_item_id: string;
  origin: Item['origin'];
  author_key: string;
  posted_at: TimestampColumn;
  first_seen_at: TimestampColumn;
  lang: string | null;
  body: string;
  media: MediaRef[];
  counters: CounterSet;
  rebroadcast_of: string | null;
  reproduction_of: string | null;
  format_ids: string[];
  raw_ref: string;
}

interface FingerprintRow {
  item_id: string;
  kind: Fingerprint['kind'];
  key: string;
}

/** A stored post a huge account has just shared (`sharedOriginals`), with the share's facts. */
export interface SharedOriginal {
  readonly item: Item;
  readonly byItemId: string;
  readonly byAuthorKey: string;
  /** The sharing account's handle; null when we hold none. */
  readonly handle: string | null;
  readonly followers: number | null;
  /** The sharing post's own text, as stored. */
  readonly words: string;
  readonly how: 'quoted' | 'samePicture' | 'reposted';
  readonly sharedAtMs: number;
}

/** The judge's newest answer about one post, as much of it as the per-post rule reads. */
export interface TrackingJudgement {
  readonly coinable: boolean;
  readonly confidence: number;
  readonly lookedAt: 'text' | 'picture' | 'videoFrame';
  readonly proposedName: string | null;
}

/** See `PgItemRepo.trackingFacts`. Keyed by item id and story id as strings. */
export interface TrackingFacts {
  /** In the live frame of either feed (public.rising_row). */
  readonly onFeed: ReadonlySet<string>;
  /**
   * On For You: in its live frame, or a member of its scroll not withdrawn (public.feed_post, 0075).
   * TRACK's off-feed cut keeps these whatever their age (Policy.track.offFeedMaxAgeMs).
   */
  readonly onForYou: ReadonlySet<string>;
  readonly catchAll: ReadonlySet<string>;
  /** The promoted, unmerged stories each post is in. A post in none is absent. */
  readonly storiesOf: ReadonlyMap<string, readonly string[]>;
  /** Every member of those stories. */
  readonly membersOf: ReadonlyMap<string, readonly string[]>;
  /**
   * The newest answer to the post question per post and per member — never a kind answer, whose
   * yes/no is not the judge's verdict on the post (the projector reads it the same way). A post
   * never judged is absent, never a "no".
   */
  readonly judged: ReadonlyMap<string, TrackingJudgement>;
  /**
   * The kind label, only when a post's newest answer of all is a kind answer (`post-kind…`: a held
   * kind, the shill rule's AD, the close-match NOT_MEME_MATCH). Whether it holds is policy's
   * (`judge.heldKinds`, core `heldKind`). Absent when the newest answer is the post question's.
   */
  readonly kindOf: ReadonlyMap<string, string>;
  /** The owner's newest call on a post (0054), which outranks the judge either way. Absent: none. */
  readonly ownerCall: ReadonlyMap<string, 'meme' | 'not'>;
}

const SELECT_ITEM_COLUMNS = `
  select item_id, source, source_item_id, origin, author_key, posted_at, first_seen_at,
         lang, body, media, counters, rebroadcast_of, reproduction_of,
         format_ids, raw_ref`;
const SELECT_ITEM = `${SELECT_ITEM_COLUMNS}
    from public.item
`;

/**
 * A post's row version: Postgres's `xmin` (new on every update of the row) and how many
 * fingerprints it has (append only, never updated). Equal versions, equal `Item`.
 */
const ITEM_VERSION = `public.item.xmin::text || '/' || (select count(*) from public.item_fingerprint f where f.item_id = public.item.item_id)::text`;

/** A held post unused this long is dropped: the stages read the last day's posts, and a post leaves that window. */
const HELD_ITEM_IDLE_MS = 60 * 60_000;

export class PgItemRepo implements ItemRepo {
  readonly #db: Db;
  /**
   * ★ POSTS THIS REPO HAS READ, BY ROW VERSION. ADMIT, DETECT and GROUP each read the last day's
   * newest posts every pass, body, media and counters (~1.1 KB a post, ~1,700 a read), and the
   * stages ask `byIds` for the same posts over and over; nearly all are unchanged since the last
   * read. `admittedSince` and `byIds` now ask for each post's version (`ITEM_VERSION`) and read
   * whole only the posts not held at it. A post whose row or fingerprints changed has a new version
   * and is read again, so the answer is the one a full read gives.
   */
  readonly #held = new Map<string, { readonly version: string; readonly item: Item; usedAt: number }>();
  #sweptAt = 0;

  constructor(db: Db) {
    this.#db = db;
  }

  /**
   * The posts `picked` names, in that order, from what is held or read whole now. A post gone
   * between the two reads is left out, as a read a moment later would.
   */
  async #heldItems(picked: readonly { readonly item_id: string; readonly v: string }[]): Promise<Item[]> {
    const now = Date.now();
    const stale = [...new Set(picked.filter((p) => this.#held.get(p.item_id)?.version !== p.v).map((p) => p.item_id))];
    if (stale.length > 0) {
      const rows = await this.#db.query<ItemRow & { v: string }>(
        `${SELECT_ITEM_COLUMNS}, ${ITEM_VERSION} as v from public.item where item_id = any($1::text[])`,
        [stale],
      );
      const fingerprints = await this.#fingerprintsFor(rows.map((row) => row.item_id));
      for (const row of rows) this.#held.set(row.item_id, { version: row.v, item: this.#toItem(row, fingerprints), usedAt: now });
    }
    const out: Item[] = [];
    for (const p of picked) {
      const held = this.#held.get(p.item_id);
      if (held === undefined) continue;
      held.usedAt = now;
      out.push(held.item);
    }
    if (now - this.#sweptAt >= HELD_ITEM_IDLE_MS) {
      this.#sweptAt = now;
      for (const [k, h] of this.#held) if (now - h.usedAt >= HELD_ITEM_IDLE_MS) this.#held.delete(k);
    }
    return out;
  }

  /**
   * Insert or refresh items. Idempotent on (source, source_item_id), because the
   * discovery path re-sees the same post constantly and a duplicate arrival must
   * cost nothing.
   *
   * `first_seen_at` is never overwritten: it is the clock the tracking schedule and
   * every age feature are computed from, and moving it forward would quietly make
   * old items look new.
   *
   * `origin` is never overwritten either: it is a fact about how the row came to exist, and
   * a refresh of the same post from the same source cannot change it.
   */
  async upsert(items: readonly Item[]): Promise<number> {
    if (items.length === 0) return 0;

    for (const item of items) {
      await this.#ensureAuthor(item);
      await this.#db.query(
        `insert into public.item (
           item_id, source, source_item_id, author_key, posted_at, first_seen_at,
           lang, body, media, counters, counters_observed_at,
           rebroadcast_of, reproduction_of, format_ids, raw_ref, origin
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15,$16)
         on conflict (item_id) do update set
           lang            = excluded.lang,
           body            = excluded.body,
           media           = excluded.media,
           counters        = excluded.counters,
           counters_observed_at = excluded.counters_observed_at,
           rebroadcast_of  = excluded.rebroadcast_of,
           reproduction_of = excluded.reproduction_of,
           format_ids      = excluded.format_ids`,
        [
          item.itemId,
          item.source,
          item.sourceItemId,
          item.authorKey,
          toTimestamp(item.postedAt),
          toTimestamp(item.firstSeenAt),
          item.lang,
          item.text,
          JSON.stringify(item.media),
          JSON.stringify(item.counters),
          toTimestamp(item.firstSeenAt),
          item.rebroadcastOf,
          item.reproductionOf,
          item.formatIds,
          item.rawRef,
          item.origin,
        ],
      );
      await this.#writeFingerprints(item);
    }
    await this.#writeReferences(items);
    await this.#writeReproduced(items);
    return items.length;
  }

  /** Whether 0128's public.reproduced_post is there; looked up, never found missing by a failed statement. */
  #reproducedPresent: boolean | null = null;

  /**
   * The quoted posts these posts' payloads carried (`Item.reproducedPost`, 0128), one row per quoted
   * post, the newest read kept. Never a public.item row (the migration says why). Skipped before
   * 0128, looked up first, for `#writeReferences`' reason.
   */
  async #writeReproduced(items: readonly Item[]): Promise<void> {
    const byId = new Map(items.flatMap((i) => (i.reproducedPost === undefined ? [] : [[i.reproducedPost.itemId, i.reproducedPost] as const])));
    if (byId.size === 0) return;
    if (this.#reproducedPresent !== true) {
      const rows = await this.#db.query<{ t: string | null }>(`select to_regclass('public.reproduced_post')::text as t`);
      this.#reproducedPresent = (rows[0]?.t ?? null) !== null;
      if (!this.#reproducedPresent) return;
    }
    const posts = [...byId.values()];
    const https = (u: string | null): string | null => (u !== null && u.startsWith('https://') ? u : null);
    await this.#db.query(
      `insert into public.reproduced_post (item_id, source, source_item_id, author_key, author_handle, author_name,
                                           author_picture_url, posted_at, lang, body, media, read_at)
       select * from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[],
                            $7::text[], $8::timestamptz[], $9::text[], $10::text[], $11::jsonb[], $12::timestamptz[])
       on conflict (item_id) do update set
         author_key = excluded.author_key, author_handle = excluded.author_handle, author_name = excluded.author_name,
         author_picture_url = excluded.author_picture_url, posted_at = excluded.posted_at, lang = excluded.lang,
         body = excluded.body, media = excluded.media, read_at = excluded.read_at
       where excluded.read_at >= public.reproduced_post.read_at`,
      [
        posts.map((p) => p.itemId),
        posts.map((p) => p.source),
        posts.map((p) => p.sourceItemId),
        posts.map((p) => p.authorKey),
        posts.map((p) => p.authorHandle),
        posts.map((p) => p.authorName),
        posts.map((p) => https(p.authorPictureUri)),
        posts.map((p) => (p.postedAt === null ? null : new Date(p.postedAt).toISOString())),
        posts.map((p) => p.lang),
        posts.map((p) => p.text),
        posts.map((p) => JSON.stringify(p.media)),
        posts.map((p) => new Date(p.readAt).toISOString()),
      ],
    );
  }

  /** Whether 0118's internal.post_reference is there; looked up, never found missing by a failed statement. */
  #referencesPresent: boolean | null = null;

  /**
   * The posts each post's own links name (`Item.refersTo`, 0118), for the posts whose source said:
   * a post it did not say about keeps whatever row it had. Skipped before 0118, looked up first —
   * a failed statement would abort the caller's transaction and lose the posts themselves.
   */
  async #writeReferences(items: readonly Item[]): Promise<void> {
    const said = items.filter((i) => i.refersTo !== undefined);
    if (said.length === 0) return;
    if (this.#referencesPresent !== true) {
      const rows = await this.#db.query<{ t: string | null }>(`select to_regclass('internal.post_reference')::text as t`);
      this.#referencesPresent = (rows[0]?.t ?? null) !== null;
      if (!this.#referencesPresent) return;
    }
    await this.#db.query(
      `insert into internal.post_reference (item_id, refers_to, read_at)
       select r.item_id, array(select jsonb_array_elements_text(r.refs)), now()
         from unnest($1::text[], $2::jsonb[]) as r(item_id, refs)
       on conflict (item_id) do update set refers_to = excluded.refers_to, read_at = excluded.read_at`,
      [said.map((i) => i.itemId), said.map((i) => JSON.stringify(i.refersTo ?? []))],
    );
  }

  /**
   * Note which catch-all lane found these posts (0025). The first lane to find a post
   * keeps it: a post the media lane found again later was still found by the first one.
   */
  async markFoundBy(itemIds: readonly ItemId[], lane: string, at: Millis): Promise<void> {
    if (itemIds.length === 0) return;
    await this.#db.query(
      `insert into internal.item_found_by (item_id, lane, found_at)
       select id, $2, $3 from unnest($1::text[]) as id
       on conflict (item_id) do nothing`,
      [[...itemIds], lane, toTimestamp(at)],
    );
  }

  /**
   * How many of these posts no lane has found yet (no `item_found_by` row): the ones a lane about
   * to store them would be first to find, and so the ones whose judging it brings in. Asked before
   * the store, which writes the rows. A capped lane charges itself that judging (0088).
   */
  async uncredited(itemIds: readonly string[]): Promise<number> {
    if (itemIds.length === 0) return 0;
    const rows = await this.#db.query<{ n: string }>(
      `select count(*)::text as n from unnest($1::text[]) as id
        where not exists (select 1 from internal.item_found_by f where f.item_id = id)`,
      [[...new Set(itemIds)]],
    );
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * Catch-all posts the judge has not scored yet, newest first — the queue the per-post
   * score works through. Observed posts only: a seeded post is never sent to a paid judge.
   *
   * Posts the backfill fetched for a story are scored too (0032): the judge's name for a
   * post is half of GROUP's name-plus-picture join, and without it a backfilled copy could
   * only join on a near-identical picture. Scoring one does not put it on the For You feed;
   * only a catch-all lane does that.
   */
  async catchAllUnscored(at: Millis, limit: number, minReach: number | null = null, lane: string | null = null, notJunkSkipped = false): Promise<readonly Item[]> {
    /* With `minReach`, a catch-all post waits until some reading of its reach has reached it —
       the free check before the paid judge. A backfilled post is never held back: it is scored
       for GROUP's name join, not for the feed.
       With `lane`, only that lane's posts (and no backfill): the short-video watch lane is read
       on its own, because newest-first over every lane it never makes the page — the text lanes
       add hundreds of unscored posts an hour (2026-10-13: 233 videos stored, none judged).
       With `notJunkSkipped`, a post the junk filter kept from the judge (internal.junk_skip, 0091) is
       left out, or it would be scored again every pass and crowd the page. Only set by the scorer
       while the filter is on and a fit was read from 0091, so the table is known to exist. */
    /* Ids and versions under the page's own filter and order; posts whole only when not held (`#held`). */
    const picked = await this.#db.query<{ item_id: string; v: string }>(
      `select item_id, ${ITEM_VERSION} as v from public.item
        where origin = 'observed'
          and first_seen_at >= $1
          and ((exists (select 1 from internal.item_found_by f where f.item_id = public.item.item_id and ($4::text is null or f.lane = $4))
                and ($3::double precision is null
                     or exists (select 1 from public.observation o
                                 where o.item_id = public.item.item_id and o.kind = 'reach' and o.value >= $3)))
               or ($4::text is null and exists (select 1 from internal.item_backfill b where b.item_id = public.item.item_id)))
          and not exists (select 1 from internal.post_judgement j where j.item_id = public.item.item_id)
          ${notJunkSkipped ? 'and not exists (select 1 from internal.junk_skip s where s.item_id = public.item.item_id)' : ''}
        order by first_seen_at desc
        limit $2`,
      [toTimestamp(at), limit, minReach, lane],
    );
    return this.#heldItems(picked);
  }

  /**
   * Never-judged posts a big account has just reproduced (Policy.judge.reproductionBoost): the originals of
   * the posts first seen since `reproducedSince` by an account with at least `minFollowers` followers
   * as last read, or whose handle is in `handles` (lower case) — an original being the post a
   * reproduction names (`reproduction_of`), or an earlier post by another account whose first
   * picture or video has the same address. Only stored, observed originals posted since
   * `postedSince`, by another account, with no judgement at all; newest reproduction first.
   *
   * ★ THE SAME MEDIA ADDRESS COUNTS: the text source names a quote, but a repost of someone's video
   * under one's own words carries no quote — only the video's address, which is the original's.
   * That is how the Saylor repost of 2026-10-20 looked (reproduction_of empty, the same video).
   */
  async reproducedOriginals(args: { readonly reproducedSince: Millis; readonly postedSince: Millis; readonly minFollowers: number; readonly handles: readonly string[]; readonly limit: number }): Promise<readonly { readonly item: Item; readonly by: string }[]> {
    if (args.limit <= 0) return [];
    const rows = await this.#db.query<ItemRow & { by_item: string }>(
      `with q as (
         select i.item_id, i.author_key, i.posted_at, i.reproduction_of, i.media->0->>'uri' as m, i.first_seen_at
           from public.item i
           join public.author a on a.author_key = i.author_key
          where i.first_seen_at >= $1
            and i.origin = 'observed'
            and i.rebroadcast_of is null
            and (a.follower_count >= $3 or lower(a.handle) = any($4::text[]))
       ), pairs as (
         select q.reproduction_of as oid, q.item_id as by_item, q.author_key as by_author, q.first_seen_at as at
           from q where q.reproduction_of is not null
         union all
         select o.item_id, q.item_id, q.author_key, q.first_seen_at
           from q
           join public.item o on o.media->0->>'uri' = q.m
                             and o.first_seen_at >= $2
                             and o.posted_at < q.posted_at
          where q.m is not null
       ), picked as (
         select distinct on (p.oid) p.oid, p.by_item, p.at
           from pairs p
           join public.item o on o.item_id = p.oid
          where o.origin = 'observed'
            and o.posted_at >= $2
            and o.author_key <> p.by_author
            and not exists (select 1 from internal.post_judgement j where j.item_id = p.oid)
          order by p.oid, p.at desc
       )
       select i.item_id, i.source, i.source_item_id, i.origin, i.author_key, i.posted_at, i.first_seen_at,
              i.lang, i.body, i.media, i.counters, i.rebroadcast_of, i.reproduction_of,
              i.format_ids, i.raw_ref, picked.by_item
         from picked
         join public.item i on i.item_id = picked.oid
        order by picked.at desc
        limit $5`,
      [toTimestamp(args.reproducedSince), toTimestamp(args.postedSince), args.minFollowers, args.handles.map((h) => h.toLowerCase()), args.limit],
    );
    const fingerprints = await this.#fingerprintsFor(rows.map((row) => row.item_id));
    return rows.map((row) => ({ item: this.#toItem(row, fingerprints), by: row.by_item }));
  }

  /**
   * Stored posts a huge account has just shared (Policy.judge.resurface), whatever their age and
   * whatever answer they have: the posts that the posts first seen since `sharedSince`, by an account
   * with at least `minFollowers` followers as last read, quote (`reproduction_of`) or carry the same
   * first picture or video address of (an earlier post, as `reproducedOriginals` reads it). Only
   * observed originals by another account, and only shares not yet asked about (internal.resurfacing,
   * 0139). One share a post — its newest — newest share first, at most `limit`; each with the
   * sharing post's id, account, followers, words, how it shared, and its time (its post time, else
   * its first sight).
   */
  async sharedOriginals(args: { readonly sharedSince: Millis; readonly minFollowers: number; readonly limit: number; readonly keyHandles?: readonly string[] }): Promise<readonly SharedOriginal[]> {
    if (args.limit <= 0) return [];
    const rows = await this.#db.query<ItemRow & { by_item: string; by_author: string; by_handle: string | null; by_followers: string | number | null; by_words: string; how: 'quoted' | 'samePicture' | 'reposted'; shared_at: Date | string }>(
      `with q as (
         select i.item_id, i.author_key, i.posted_at, i.first_seen_at, i.reproduction_of, i.media->0->>'uri' as m, i.body,
                a.handle, a.follower_count
           from public.item i
           join public.author a on a.author_key = i.author_key
          where i.first_seen_at >= $1
            and i.origin = 'observed'
            and (a.follower_count >= $2 or lower(a.handle) = any($4::text[]))
       ), pairs as (
         select q.reproduction_of as oid, q.item_id as by_item, q.author_key as by_author, q.handle as by_handle,
                q.follower_count as by_followers, q.body as by_words, 'quoted' as how,
                coalesce(q.posted_at, q.first_seen_at) as shared_at
           from q where q.reproduction_of is not null and q.rebroadcast_of is null
         union all
         /* ★ A plain repost (0140): the account put the post itself in front of its followers. */
         select q.rebroadcast_of, q.item_id, q.author_key, q.handle, q.follower_count, q.body, 'reposted',
                coalesce(q.posted_at, q.first_seen_at)
           from q where q.rebroadcast_of is not null
         union all
         select o.item_id, q.item_id, q.author_key, q.handle, q.follower_count, q.body, 'samePicture',
                coalesce(q.posted_at, q.first_seen_at)
           from q
           join public.item o on o.media->0->>'uri' = q.m
                             and o.posted_at < q.posted_at
          where q.m is not null and q.rebroadcast_of is null
       ), picked as (
         select distinct on (p.oid) p.*
           from pairs p
           join public.item o on o.item_id = p.oid
          where o.origin = 'observed'
            and o.author_key <> p.by_author
            and not exists (select 1 from internal.resurfacing r where r.item_id = p.oid and r.by_item_id = p.by_item)
          order by p.oid, p.shared_at desc, (p.how = 'reposted') desc, (p.how = 'quoted') desc
       )
       select i.item_id, i.source, i.source_item_id, i.origin, i.author_key, i.posted_at, i.first_seen_at,
              i.lang, i.body, i.media, i.counters, i.rebroadcast_of, i.reproduction_of,
              i.format_ids, i.raw_ref,
              picked.by_item, picked.by_author, picked.by_handle, picked.by_followers, picked.by_words, picked.how, picked.shared_at
         from picked
         join public.item i on i.item_id = picked.oid
        order by picked.shared_at desc
        limit $3`,
      [toTimestamp(args.sharedSince), args.minFollowers, args.limit, (args.keyHandles ?? []).map((h) => h.toLowerCase())],
    );
    const fingerprints = await this.#fingerprintsFor(rows.map((row) => row.item_id));
    return rows.map((row) => ({
      item: this.#toItem(row, fingerprints),
      byItemId: row.by_item,
      byAuthorKey: row.by_author,
      handle: row.by_handle,
      followers: row.by_followers === null ? null : Number(row.by_followers),
      words: row.by_words,
      how: row.how,
      sharedAtMs: new Date(row.shared_at).getTime(),
    }));
  }

  /**
   * Catch-all posts whose newest answer to the post question came from ANOTHER version of it than
   * `promptId` — the queue the scorer re-judges after a prompt change, newest first, with the same
   * window, lane and reach floor as `catchAllUnscored`. Kind answers (prompt ids starting
   * `kindPrefix`) are not answers to the post question and are skipped when finding the newest;
   * a post with only kind answers is not here. Observed posts only.
   */
  async catchAllStale(at: Millis, limit: number, promptId: string, kindPrefix: string, minReach: number | null = null): Promise<readonly Item[]> {
    if (limit <= 0) return [];
    const rows = await this.#db.query<ItemRow>(
      `${SELECT_ITEM}
        where origin = 'observed'
          and first_seen_at >= $1
          and exists (select 1 from internal.item_found_by f where f.item_id = public.item.item_id)
          and ($4::double precision is null
               or exists (select 1 from public.observation o
                           where o.item_id = public.item.item_id and o.kind = 'reach' and o.value >= $4))
          and (select j.prompt_id from internal.post_judgement j
                where j.item_id = public.item.item_id and j.prompt_id not like $5
                order by j.judged_at desc, j.id desc limit 1) <> $3
        order by first_seen_at desc
        limit $2`,
      [toTimestamp(at), limit, promptId, minReach, `${kindPrefix}%`],
    );
    const fingerprints = await this.#fingerprintsFor(rows.map((row) => row.item_id));
    return rows.map((row) => this.#toItem(row, fingerprints));
  }

  /**
   * Catch-all posts whose newest answer to the post question, given since `at`, is a "yes" at
   * `minConfidence` or more and has met no kind question since: no kind answer (prompt id
   * starting `kindPrefix`) at or after it, and no ask recorded for it in internal.kind_asked
   * (0095 — an OTHER answer files nothing in post_judgement). Newest answer first, at most
   * `limit`, each with that answer, for the scorer's kind catch-up. `minConfidence` is only a
   * floor for the database; core `couldPassWithBoost` makes the exact call. Observed posts only,
   * any path that answered them (a lane, a coin's instant pass, a backfill): each path asked the kind
   * of what it passed, so each is screened here. Driven from post_judgement's judged_at index, so
   * it reads one window of answers, not every post.
   *
   * `withNet` (Policy.judge.coinModel.on) also takes a "no" our own coin model's stored score would
   * let through (0096): such a post may reach For You, so it is screened by kind like a yes. Off, the
   * coin model's table is never read. `withNet` names the target the net acts on
   * (Policy.judge.coinModel.liveTarget, 0099): a shadowed target's would-add is never read here.
   */
  async catchAllKindUnasked(at: Millis, limit: number, kindPrefix: string, minConfidence: number, withNet: CoinModelTarget | null = null): Promise<readonly { readonly item: Item; readonly answer: Pick<Judgement, 'coinable' | 'confidence' | 'lookedAt' | 'proposedName' | 'judgedAt'> }[]> {
    if (limit <= 0) return [];
    const rows = await this.#db.query<{ item_id: string; judged_at: TimestampColumn; looked_at: string | null; coinable: boolean; confidence: number; proposed_name: string | null }>(
      `with latest as (
         select distinct on (j.item_id) j.item_id, j.judged_at, j.looked_at, j.coinable, j.confidence, j.proposed_name
           from internal.post_judgement j
          where j.judged_at >= $1 and j.prompt_id not like $3
          order by j.item_id, j.judged_at desc, j.id desc
       )
       select l.item_id, l.judged_at, l.looked_at, l.coinable, l.confidence, l.proposed_name
         from latest l
         join public.item i on i.item_id = l.item_id
        where ((l.coinable and l.confidence >= $4)${withNet !== null ? ` or (not l.coinable and exists (select 1 from internal.coin_model_score s where s.item_id = l.item_id and s.would_add and s.target = $5))` : ''})
          and i.origin = 'observed'
          and not exists (select 1 from internal.post_judgement k
                           where k.item_id = l.item_id and k.prompt_id like $3 and k.judged_at >= l.judged_at)
          and not exists (select 1 from internal.kind_asked a
                           where a.item_id = l.item_id and a.answer_judged_at >= l.judged_at)
        order by l.judged_at desc
        limit $2`,
      [toTimestamp(at), limit, `${kindPrefix}%`, minConfidence, ...(withNet !== null ? [withNet] : [])],
    );
    if (rows.length === 0) return [];
    const items = await this.byIds(rows.map((r) => r.item_id as ItemId));
    return rows.flatMap((r) => {
      const item = items.get(r.item_id as ItemId);
      if (item === undefined) return [];
      /* An answer whose evidence is not one the policy has a bar for is not guessed at: skipped. */
      const lookedAt = JUDGE_EVIDENCE.find((e) => e === r.looked_at);
      if (lookedAt === undefined) return [];
      return [{ item, answer: { coinable: r.coinable, confidence: Number(r.confidence), lookedAt, proposedName: r.proposed_name, judgedAt: toMillisRequired(r.judged_at, 'post_judgement.judged_at') } }];
    });
  }

  /** Every reach reading of these posts since `at`, oldest first: the counter as read, null when unreadable. */
  async reachReadings(itemIds: readonly ItemId[], at: Millis): Promise<ReadonlyMap<string, readonly { atMs: number; reach: number | null }[]>> {
    const out = new Map<string, { atMs: number; reach: number | null }[]>();
    if (itemIds.length === 0) return out;
    const rows = await this.#db.query<{ item_id: string; captured_at: Date; value: number | null; fidelity_kind: string }>(
      `select item_id, captured_at, value, fidelity_kind from public.observation
        where item_id = any($1::text[]) and kind = 'reach' and captured_at >= $2
        order by item_id, captured_at`,
      [[...itemIds], toTimestamp(at)],
    );
    for (const r of rows) {
      const list = out.get(r.item_id) ?? [];
      list.push({ atMs: new Date(r.captured_at).getTime(), reach: r.fidelity_kind === 'absent' || r.value === null ? null : Number(r.value) });
      out.set(r.item_id, list);
    }
    return out;
  }

  /** Which of these posts a story's backfill fetched. */
  async backfilled(itemIds: readonly ItemId[]): Promise<ReadonlySet<string>> {
    if (itemIds.length === 0) return new Set();
    const rows = await this.#db.query<{ item_id: string }>('select item_id from internal.item_backfill where item_id = any($1::text[])', [[...itemIds]]);
    return new Set(rows.map((r) => r.item_id));
  }

  async byId(id: ItemId): Promise<Item | null> {
    const rows = await this.#db.query<ItemRow>(`${SELECT_ITEM} where item_id = $1`, [id]);
    const row = rows[0];
    if (!row) return null;
    return this.#toItem(row, await this.#fingerprintsFor([row.item_id]));
  }

  /**
   * A map rather than an array, and the difference is not cosmetic: a caller that
   * zips a returned array against the ids it asked for is silently wrong the first
   * time one of them is missing, and an item disappearing between two stages is
   * normal rather than exceptional. A map makes the absence something the caller
   * has to meet.
   */
  async byIds(ids: readonly ItemId[]): Promise<ReadonlyMap<ItemId, Item>> {
    const found = new Map<ItemId, Item>();
    if (ids.length === 0) return found;

    /* Versions first, posts whole only when not held at that version: see `#held`. */
    const picked = await this.#db.query<{ item_id: string; v: string }>(
      `select item_id, ${ITEM_VERSION} as v from public.item where item_id = any($1::text[])`,
      [[...ids]],
    );
    for (const item of await this.#heldItems(picked)) found.set(item.itemId, item);
    return found;
  }

  /**
   * The posts TRACK may spend a read on, NEWEST FIRST: the posts that are on screen.
   *
   *   - in a promoted story — the narratives, whose cards and pages show their views;
   *   - a row on the For You or Popular feed as the projector last committed it
   *     (`public.rising_row`, `rising.maxRows` per feed).
   *
   * Everything else keeps the readings discovery already paid for and no more. A post that
   * clears the score but has fallen off both feeds is no longer on screen and is no longer
   * re-read. Re-reads are the expensive part of the day; a post nobody can see is not
   * worth one.
   *
   * ★ NEWEST FIRST because reads are budgeted and views move fastest in a post's first
   * hours. Oldest first would spend a tight budget on posts that are days old.
   *
   * What this no longer includes, said so it is not rediscovered as a bug: posts ADMIT
   * passed, and with them ADMIT's holdout lane. Tracking every admitted post cost several
   * times the daily budget.
   *
   * Two more, because the feeds are fed by re-reads and the list above only re-reads what is
   * already on them — so a new post kept the one reading discovery paid for, never cleared a
   * reach bar, and the For You feed starved (2026-10-13):
   *
   *   - a catch-all post the judge has answered, posted since `watch.judgedSince` or already at
   *     `watch.judgedMinReach` — TRACK's gate keeps only the answers that can still pass, so this
   *     is a few dozen at a time. Not every answered post of the tracked day, because that was
   *     about $5 of reads; but an older one close to the bar is still worth reading, or a post
   *     at 38k after four hours could never be seen crossing 40k;
   *   - a catch-all post nobody has judged, posted within `watch.sinceMs` and averaging at least
   *     `watch.minPerMinute` reach a minute at its latest reading. Its reach decides whether it
   *     is judged at all; a slow one keeps its one reading.
   *
   *   - ★ and a post of `watch.longer.source` nobody has judged, posted within `watch.longer.since`
   *     and averaging `watch.longer.minPerMinute` — the short-video source, found 30 minutes to
   *     6 hours after posting, which the half-hour window above never holds (its growth paths run
   *     to four hours, `rising.shortVideoFastWindowMs`). Its re-reads are paid runs, capped by the
   *     runner's work/paid-reads.ts, so a wider window here costs nothing it has not budgeted.
   *
   * On-screen and judged posts sort first, so the unjudged watch list can never crowd them out
   * of the page TRACK pulls — and ahead of them, ★ a found post whose newest answer is a yes, posted
   * since `watch.judgedYesSince` and not on For You (Policy.track.judgedYesMaxAgeMs): read until it
   * joins, whatever its views rate, and first, so TRACK's per-pass reads reach it before the rest.
   *
   * TRACK narrows this further with `trackingFacts` (the runner's work/track-gate.ts): a story
   * member that can never be shown — a firm "no", a failed name test — is not re-read.
   */
  async trackable(
    at: Millis,
    limit: number,
    watch: {
      readonly now: Millis;
      readonly since: Millis;
      readonly minPerMinute: number;
      readonly judgedSince: Millis;
      readonly judgedMinReach: number;
      readonly longer?: { readonly source: string; readonly since: Millis; readonly minPerMinute: number };
      /** A found post whose newest answer is a yes, posted since this and not on For You, is kept and pulled first (Policy.track.judgedYesMaxAgeMs). */
      readonly judgedYesSince?: Millis;
    },
  ): Promise<readonly Item[]> {
    const rows = await this.#db.query<ItemRow>(
      `with recent as (
         select i.item_id, i.source, i.posted_at, i.first_seen_at,
                (i.posted_at >= $11
                 and exists (select 1 from internal.item_found_by f where f.item_id = i.item_id)
                 and coalesce((select j.coinable from internal.post_judgement j
                                where j.item_id = i.item_id and j.prompt_id not like 'post-kind%'
                                order by j.judged_at desc, j.id desc limit 1), false)
                 and not exists (select 1 from public.rising_row r where r.item_id = i.item_id and r.feed_id = 'fyp')) as yes,
                (exists (select 1 from public.story_member m
                           join public.story s on s.story_id = m.story_id
                          where m.item_id = i.item_id and s.state = 'promoted' and s.merged_into is null)
                 or exists (select 1 from public.rising_row r where r.item_id = i.item_id)
                 or (exists (select 1 from internal.item_found_by f where f.item_id = i.item_id)
                     and exists (select 1 from internal.post_judgement j where j.item_id = i.item_id)
                     and (i.posted_at >= $6
                          or (select o.value from public.observation o
                               where o.item_id = i.item_id and o.kind = 'reach' and o.value is not null
                               order by o.captured_at desc limit 1) >= $7))
                ) as kept
           from public.item i
          where i.first_seen_at >= $1
       ), picked as (
         select r.item_id, r.yes, r.kept or r.yes as kept, r.first_seen_at from recent r
          where r.kept or r.yes
             or (r.posted_at >= (case when r.source = $8 then $9::timestamptz else $3::timestamptz end)
                 and exists (select 1 from internal.item_found_by f where f.item_id = r.item_id)
                 and not exists (select 1 from internal.post_judgement j where j.item_id = r.item_id)
                 and (select o.value from public.observation o
                       where o.item_id = r.item_id and o.kind = 'reach' and o.value is not null
                       order by o.captured_at desc limit 1)
                     >= (case when r.source = $8 then $10::float8 else $4::float8 end) * greatest(extract(epoch from ($5::timestamptz - r.posted_at)) / 60, 1))
          order by r.yes desc, (r.kept or r.yes) desc, r.first_seen_at desc
          limit $2
       )
       select item.item_id, item.source, item.source_item_id, item.origin, item.author_key,
              item.posted_at, item.first_seen_at, item.lang, item.body, item.media, item.counters,
              item.rebroadcast_of, item.reproduction_of, item.format_ids, item.raw_ref
         from picked p
         join public.item item on item.item_id = p.item_id
        order by p.yes desc, p.kept desc, p.first_seen_at desc`,
      [
        toTimestamp(at), limit, toTimestamp(watch.since), watch.minPerMinute, toTimestamp(watch.now), toTimestamp(watch.judgedSince), watch.judgedMinReach,
        /* No longer window: a source name nothing has, so every post takes the half-hour one. */
        watch.longer?.source ?? '', toTimestamp(watch.longer?.since ?? watch.since), watch.longer?.minPerMinute ?? watch.minPerMinute,
        /* No yes window: a time nothing is posted after, so no post is kept as a yes. */
        toTimestamp(watch.judgedYesSince ?? (8_640_000_000_000_000 as Millis)),
      ],
    );
    const fingerprints = await this.#fingerprintsFor(rows.map((row) => row.item_id));
    return rows.map((row) => this.#toItem(row, fingerprints));
  }

  /**
   * What TRACK needs to know before it pays to re-read these posts: which are on a feed now,
   * which a catch-all lane found, the promoted stories each is in, every member of those
   * stories, and the newest per-post judgement of each post and each member.
   *
   * Facts only — what the judge said and where the post sits. Whether that is worth a read is
   * the runner's call (work/track-gate.ts), held to core's own per-post rule, because the rule
   * has thresholds and a word count that do not belong in SQL.
   */
  async trackingFacts(itemIds: readonly ItemId[]): Promise<TrackingFacts> {
    const onFeed = new Set<string>();
    const onForYou = new Set<string>();
    const catchAll = new Set<string>();
    const storiesOf = new Map<string, string[]>();
    const membersOf = new Map<string, string[]>();
    const judged = new Map<string, TrackingJudgement>();
    const kindOf = new Map<string, string>();
    const ownerCall = new Map<string, 'meme' | 'not'>();
    if (itemIds.length === 0) return { onFeed, onForYou, catchAll, storiesOf, membersOf, judged, kindOf, ownerCall };
    const ids = [...itemIds];

    const where = await this.#db.query<{ item_id: string; on_feed: boolean; on_for_you: boolean; catch_all: boolean }>(
      `select i.id as item_id,
              exists (select 1 from public.rising_row r where r.item_id = i.id) as on_feed,
              (exists (select 1 from public.rising_row r where r.item_id = i.id and r.feed_id = 'fyp')
               or exists (select 1 from public.feed_post p where p.item_id = i.id and p.feed_id = 'fyp' and p.withdrawn_at is null)) as on_for_you,
              exists (select 1 from internal.item_found_by f where f.item_id = i.id) as catch_all
         from unnest($1::text[]) as i(id)`,
      [ids],
    );
    for (const row of where) {
      if (row.on_feed) onFeed.add(row.item_id);
      if (row.on_for_you) onForYou.add(row.item_id);
      if (row.catch_all) catchAll.add(row.item_id);
    }

    /* ★ EACH STORY'S MEMBERS ONCE, NOT ONCE PER ASKED POST IN IT. This was one join of the asked
       posts to every member of their stories: a story with 40 asked posts and 200 members came back
       as 8,000 rows, ~90k a pass and the largest row count the database served. Now the asked posts'
       stories (`own`) and every member of those stories (`member`) come back as two row kinds of
       one statement — the same pairs, without the product. */
    const members = await this.#db.query<{ kind: 'own' | 'member'; story_id: string; item_id: string }>(
      `with own as (
         select m.story_id, m.item_id
           from public.story_member m
           join public.story s on s.story_id = m.story_id
          where m.item_id = any($1::text[]) and s.state = 'promoted' and s.merged_into is null)
       select 'own' as kind, story_id, item_id from own
       union all
       select 'member' as kind, all_m.story_id, all_m.item_id
         from public.story_member all_m
        where all_m.story_id in (select story_id from own)`,
      [ids],
    );
    for (const row of members) {
      if (row.kind === 'own') {
        const stories = storiesOf.get(row.item_id) ?? [];
        if (!stories.includes(row.story_id)) storiesOf.set(row.item_id, [...stories, row.story_id]);
      } else {
        const list = membersOf.get(row.story_id) ?? [];
        if (!list.includes(row.item_id)) membersOf.set(row.story_id, [...list, row.item_id]);
      }
    }

    const everyone = [...new Set([...ids, ...members.filter((m) => m.kind === 'member').map((m) => m.item_id)])];
    /* ★ THE POST QUESTION'S ANSWER, THE KIND AND THE OWNER'S CALL APART, as the projector reads them
       (services/project rising.ts). This was the newest row of all: a kind answer filed after a yes
       (coinable false by construction) read as a "no", and a yes held by a kind could never be told
       from a judge's no — nor a no the owner called a meme from one he did not. */
    const answers = await this.#db.query<{
      item_id: string;
      coinable: boolean | null;
      confidence: number | null;
      looked_at: TrackingJudgement['lookedAt'] | null;
      proposed_name: string | null;
      kind_label: string | null;
      owner_call: string | null;
    }>(
      `select u.id as item_id, j.coinable, j.confidence, j.looked_at, j.proposed_name, k.kind_label, oc.verdict as owner_call
         from unnest($1::text[]) as u(id)
         left join lateral (
                select pj.coinable, pj.confidence, pj.looked_at, pj.proposed_name
                  from internal.post_judgement pj
                 where pj.item_id = u.id and pj.prompt_id not like 'post-kind%'
                 order by pj.judged_at desc, pj.id desc
                 limit 1) j on true
         left join lateral (
                select case when pj.prompt_id like 'post-kind%' then pj.proposed_name end as kind_label
                  from internal.post_judgement pj
                 where pj.item_id = u.id
                 order by pj.judged_at desc, pj.id desc
                 limit 1) k on true
         left join lateral (
                select ofb.verdict
                  from internal.owner_feedback ofb
                 where ofb.subject_kind = 'post' and ofb.item_id = u.id
                 order by ofb.created_at desc, ofb.id desc
                 limit 1) oc on true`,
      [everyone],
    );
    for (const a of answers) {
      if (a.coinable !== null && a.confidence !== null && a.looked_at !== null) {
        judged.set(a.item_id, { coinable: a.coinable, confidence: Number(a.confidence), lookedAt: a.looked_at, proposedName: a.proposed_name });
      }
      if (a.kind_label !== null) kindOf.set(a.item_id, a.kind_label);
      if (a.owner_call === 'meme' || a.owner_call === 'not') ownerCall.set(a.item_id, a.owner_call);
    }
    return { onFeed, onForYou, catchAll, storiesOf, membersOf, judged, kindOf, ownerCall };
  }

  /**
   * Items admitted since an instant, NEWEST first — the query ADMIT, DETECT and GROUP pull from.
   *
   * ★ NEWEST FIRST SINCE 2026-10-13. It was oldest first, with a limit: once two days of
   * discovery held more posts than one page, every page was the same oldest few thousand posts,
   * all already decided, and no stage ever reached a new one — GROUP placed nothing from 23:04
   * UTC on 2026-10-12 and the board emptied. Newest first, a stage that cannot keep up drops its
   * oldest work instead of all its new work. A stage that needs order inside a page (GROUP: an
   * original before its copies) sorts the page itself.
   *
   * `first_seen_at` IS the admission clock: an item is in this table because the
   * admit stage put it there, and the column is never moved forward on a re-arrival
   * (see upsert). It is not `posted_at`, which is the source's claim about the
   * world and is null whenever the source omits it or is known to lie.
   */
  async admittedSince(at: Millis, limit: number): Promise<readonly Item[]> {
    /* The page's posts and their versions, in the page's order; posts whole only when not held
       at that version (see `#held`). */
    const picked = await this.#db.query<{ item_id: string; v: string }>(
      `select item_id, ${ITEM_VERSION} as v from public.item where first_seen_at >= $1 order by first_seen_at desc limit $2`,
      [toTimestamp(at), limit],
    );
    return this.#heldItems(picked);
  }

  /**
   * Items due a re-read, newest tier first.
   *
   * Left unimplemented deliberately, and throwing rather than returning `[]`. The
   * re-read cadence is the tracking policy — which tier an item is in at what age,
   * and how long a tier waits — and policy does not belong in SQL, which is exactly
   * where the previous build's schedule went to hide. There is also no column to
   * schedule against yet: `counters_observed_at` records when we last read, not when
   * we next should, and deriving the second from the first here would bury the
   * cadence in this file.
   *
   * A tracking loop that calls this gets a loud, named gap in
   * `internal.stage_runs.err`. One that got an empty array would look exactly like a
   * loop with nothing to do, which is the failure this whole package is a reaction to.
   */
  async dueForObservation(_now: Millis, _limit: number): Promise<readonly Item[]> {
    throw new NotImplemented(
      'ItemRepo.dueForObservation',
      'the re-read cadence is tracking policy and there is no next_read_at column to schedule against',
    );
  }

  async bySourceItemId(source: SourceId, sourceItemId: string): Promise<Item | null> {
    const rows = await this.#db.query<ItemRow>(
      `${SELECT_ITEM} where source = $1 and source_item_id = $2`,
      [source, sourceItemId],
    );
    const row = rows[0];
    if (!row) return null;
    return this.#toItem(row, await this.#fingerprintsFor([row.item_id]));
  }

  /**
   * The author row exists so the item's foreign key resolves and so follower counts
   * have somewhere to live. The key's shape — `<source>:<stable id>` — is assigned
   * by the adapter; splitting on the first colon is the store's only assumption
   * about it, and it is asserted rather than assumed.
   */
  async #ensureAuthor(item: Item): Promise<void> {
    const separator = item.authorKey.indexOf(':');
    if (separator <= 0) {
      throw new TypeError(
        `authorKey '${item.authorKey}' is not '<source>:<stable id>'; the adapter must namespace it`,
      );
    }
    await this.#db.query(
      `insert into public.author (author_key, source, source_author_id, first_seen_at, last_seen_at)
       values ($1, $2, $3, $4, $4)
       on conflict (author_key) do update set last_seen_at = greatest(public.author.last_seen_at, excluded.last_seen_at)`,
      [
        item.authorKey,
        item.source,
        item.authorKey.slice(separator + 1),
        toTimestamp(item.firstSeenAt),
      ],
    );
  }

  /**
   * Carriers are append-only in practice: a fingerprint that once matched must keep
   * matching, or a story's membership stops being reproducible. Hence
   * `do nothing` rather than an update, and no delete path.
   */
  async #writeFingerprints(item: Item): Promise<void> {
    for (const fingerprint of item.fingerprints) {
      const width = fingerprint.bits;
      const imageBits =
        width !== undefined && fingerprint.kind === 'imageHash'
          ? toBitLiteral(fingerprint.key, width)
          : null;
      const textBits =
        width !== undefined && fingerprint.kind === 'textShingle'
          ? toBitLiteral(fingerprint.key, width)
          : null;

      await this.#db.query(
        `insert into public.item_fingerprint (item_id, kind, key, image_bits, text_bits)
         values ($1, $2, $3, $4::bit varying, $5::bit varying)
         on conflict (item_id, kind, key) do nothing`,
        [item.itemId, fingerprint.kind, fingerprint.key, imageBits, textBits],
      );
    }
  }

  async #fingerprintsFor(itemIds: readonly string[]): Promise<Map<string, Fingerprint[]>> {
    const byItem = new Map<string, Fingerprint[]>();
    if (itemIds.length === 0) return byItem;

    const rows = await this.#db.query<FingerprintRow>(
      `select item_id, kind, key from public.item_fingerprint where item_id = any($1)`,
      [[...itemIds]],
    );
    for (const row of rows) {
      const existing = byItem.get(row.item_id);
      const fingerprint: Fingerprint = { kind: row.kind, key: row.key };
      if (existing) existing.push(fingerprint);
      else byItem.set(row.item_id, [fingerprint]);
    }
    return byItem;
  }

  #toItem(row: ItemRow, fingerprints: Map<string, Fingerprint[]>): Item {
    return {
      itemId: reBrand<ItemId>(row.item_id),
      source: reBrand<SourceId>(row.source),
      sourceItemId: row.source_item_id,
      origin: row.origin,
      authorKey: reBrand(row.author_key),
      postedAt: toMillis(row.posted_at),
      firstSeenAt: toMillisRequired(row.first_seen_at, 'first_seen_at'),
      lang: row.lang,
      text: row.body,
      media: row.media,
      counters: row.counters,
      fingerprints: fingerprints.get(row.item_id) ?? [],
      rebroadcastOf: row.rebroadcast_of === null ? null : reBrand<ItemId>(row.rebroadcast_of),
      reproductionOf: row.reproduction_of === null ? null : reBrand<ItemId>(row.reproduction_of),
      formatIds: row.format_ids,
      rawRef: row.raw_ref,
    };
  }
}
