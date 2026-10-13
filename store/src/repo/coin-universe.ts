/**
 * The coin universe's records: what each coin's metadata said (internal.coin_metadata), its
 * origin status (internal.coin_origin), and the posts we hold that name it.
 *
 * Separate from the asset repo because public.asset is the chain's record of a coin and its
 * upsert overwrites name, symbol and picture from each sighting; what the metadata document and
 * our own checks said must not be overwritten by the next sighting of the same mint.
 *
 * What breaks if changed carelessly: `unchecked` is what keeps a coin from being checked again
 * and again. It returns a coin once, again while its row is `not_checked_yet`, and once more
 * after `recheckAfterMs` for the statuses a later post could change — never a settled origin.
 */

import type { ItemId, Millis } from '@insidor/contracts';
import type { OriginStatus } from '@insidor/contracts/origin.ts';

import type { Db } from '../client.ts';
import { reBrand, toMillis, toTimestamp } from '../rows.ts';

export interface UnreadCoin {
  readonly assetKey: string;
  readonly metadataUri: string | null;
}

export interface CoinMetadataRow {
  readonly outcome: 'read' | 'not_content_addressed' | 'unavailable';
  readonly contentId: string | null;
  readonly name: string | null;
  readonly ticker: string | null;
  readonly description: string | null;
  readonly imageUri: string | null;
  readonly socialLink: string | null;
  readonly website: string | null;
  readonly chatLink: string | null;
}

export interface CoinToCheck {
  readonly assetKey: string;
  readonly address: string;
  readonly ticker: string;
  readonly name: string;
  /** The coin's launch, as public.asset holds it. Null when unknown — such a coin is not checked. */
  readonly launchedAt: Millis | null;
  readonly imageUri: string | null;
  readonly socialLink: string | null;
  /** How many times it has been checked before. */
  readonly checks: number;
}

export interface NamingPost {
  readonly itemId: ItemId;
  readonly postedAt: Millis | null;
  readonly text: string;
}

/** A coin a market source answered about: listed or not, bonded or not, its market cap now. */
/** A feed post's name-search coin, with both pictures and, when the coin's is embedded, how alike they are. */
export interface PostCoinPicture {
  readonly itemId: string;
  readonly assetKey: string;
  readonly coinUri: string;
  readonly postUri: string;
  readonly similarity: number | null;
}

export interface StandingRow {
  readonly assetKey: string;
  readonly listed: boolean;
  readonly bonded: boolean;
  readonly marketCapUsd: number | null;
}

/** An old coin to ask about. */
export interface AgedCoin {
  readonly assetKey: string;
  readonly address: string;
}

/*
 * ★ THE COINS NEVER DELETED, IN ONE SPELLING, used by both the ask and the sweep so they cannot
 * disagree. `a` is public.asset; `named` is every coin a narrative's page or a post names.
 *   - anything not from the mint stream or a search: seeds and the team's own entries;
 *   - a coin with a market reading: that history is append-only and points at the coin;
 *   - a coin with a found origin or an origin post, which includes the gold set (`found_by_team`)
 *     and posts that went viral after launch;
 *   - a coin a narrative or a post names on screen;
 *   - a coin a past narrative names (0038): history is kept forever.
 */
const NAMED_COINS = `named as (
  select v.payload #>> '{coins,coin,coinId}' as k from public.story_view v where v.payload #>> '{coins,kind}' = 'one'
  union
  select c ->> 'coinId' from public.story_view v
   cross join lateral jsonb_array_elements(case when jsonb_typeof(v.payload #> '{coins,coins}') = 'array'
                                               then v.payload #> '{coins,coins}' else '[]'::jsonb end) c
  union
  select r.payload #>> '{coins,coin,coinId}' from public.rising_row r where r.payload #>> '{coins,kind}' in ('one', 'matched')
)`;
const KEPT_ALWAYS = `(
  a.origin not in ('live_stream', 'backfill')
  or exists (select 1 from public.market_reading m where m.chain = a.chain and m.address = a.address)
  or exists (select 1 from internal.coin_origin o where o.asset_key = a.asset_key
              and (o.post_item_id is not null
                   or o.status in ('linked_by_creator', 'matched_by_insidor', 'found_by_team', 'influencer_origin', 'viral_after_launch')))
  or exists (select 1 from named n where n.k = a.asset_key)
  or exists (select 1 from public.history_coin h where h.address = a.address)
)`;

/** A judge's subject span of at most this many words is searched as a name too (lookupTerms). */
const SPAN_NAME_WORDS = 3;

/** Statuses a later post could change, so they are looked at once more. */
const RECHECKED: readonly OriginStatus[] = ['unlinked', 'account_only', 'promo_only'];

/**
 * The feed's narratives and posts with no coin, each by the judge's name for it. A subject the
 * judge has not named has nothing to search and is not here. Shared by `queueLookups`, which
 * notes when each was first seen waiting, and `lookupTerms`, which picks what to search.
 *
 * ★ A POST'S "NO COIN" IS READ AS `coins ->> 'kind'`, the same way as a narrative's. The post
 * half used to test `payload -> 'coins' is null or payload ->> 'coins' = 'null'`, and a JSON
 * null matches neither (`->` gives the jsonb `null`, `->>` gives SQL NULL), so no post was ever
 * returned and the lookup searched nothing, silently, every pass. A coins value that is JSON
 * null, `none`, `pending` or `unchecked` is "no coin"; `one`, `several` and a narrative's
 * `unsure` are not searched. A post's OWN `unsure` is searched again every `keepMs` (2026-10-13):
 * the coin made from a post is usually launched after it, so the list its card offers and the
 * evidence that can make it confident (services/project post-match.ts) need the later launches.
 */
const WAITING = `
       stories as (
         select 'story' as subject_kind, s.story_id as subject_id, j.proposed_name as term, j.alternate_names as alternates, j.subject_spans as spans, s.promoted_at as seen_at
           from public.story s
           join public.story_view v on v.story_id = s.story_id
           join lateral (
             select proposed_name, alternate_names, subject_spans from internal.judgement jj
              where jj.story_id = s.story_id and jj.proposed_name is not null
              order by jj.judged_at desc limit 1
           ) j on true
          where s.state = 'promoted' and coalesce(v.payload -> 'coins' ->> 'kind', 'none') in ('none', 'pending')
       ),
       posts as (
         select distinct on (r.item_id) 'post' as subject_kind, r.item_id as subject_id, pj.proposed_name as term, pj.alternate_names as alternates, pj.subject_spans as spans, i.first_seen_at as seen_at
           from public.rising_row r
           join public.item i on i.item_id = r.item_id
           join internal.post_judgement pj on pj.item_id = r.item_id and pj.proposed_name is not null
                                          and pj.prompt_id not like 'post-kind%'
          where (coalesce(r.payload -> 'coins' ->> 'kind', 'none') in ('none', 'pending', 'unchecked')
                 or (r.payload -> 'coins' ->> 'kind' = 'unsure' and r.payload ->> 'storyId' is null))
          order by r.item_id, pj.judged_at desc
       ),
       waiting as (select * from posts union all select * from stories)`;

export class PgCoinUniverseRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /**
   * Observed coins whose metadata is unread, or unavailable — or recorded not content-addressed —
   * fewer than `maxAttempts` times, newest first. Not content-addressed is asked again because
   * the runner now reads such a link from its own host (adapter declared-metadata.ts); before
   * that reader, 40% of new coins were recorded with no picture and no links, for good.
   */
  async unread(sinceMs: Millis, maxAttempts: number, limit: number): Promise<readonly UnreadCoin[]> {
    const rows = await this.#db.query<{ asset_key: string; metadata_uri: string | null }>(
      `select a.asset_key, a.declared_social ->> 'metadata' as metadata_uri
         from public.asset a
         left join internal.coin_metadata m using (asset_key)
        where a.origin in ('live_stream', 'backfill')
          and a.first_seen_at >= $1
          and (m.asset_key is null or (m.outcome in ('unavailable', 'not_content_addressed') and m.attempts < $2))
        order by a.first_seen_at desc
        limit $3`,
      [toTimestamp(sinceMs), maxAttempts, limit],
    );
    return rows.map((r) => ({ assetKey: r.asset_key, metadataUri: r.metadata_uri }));
  }

  async recordMetadata(assetKey: string, row: CoinMetadataRow, at: Millis): Promise<void> {
    await this.#db.query(
      `insert into internal.coin_metadata
         (asset_key, outcome, content_id, name, ticker, description, image_uri, social_link, website, chat_link, attempts, read_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1, $11)
       on conflict (asset_key) do update set
         outcome = excluded.outcome, content_id = excluded.content_id, name = excluded.name, ticker = excluded.ticker,
         description = excluded.description, image_uri = excluded.image_uri, social_link = excluded.social_link,
         website = excluded.website, chat_link = excluded.chat_link,
         attempts = internal.coin_metadata.attempts + 1, read_at = excluded.read_at`,
      [assetKey, row.outcome, row.contentId, row.name, row.ticker, row.description, row.imageUri, row.socialLink, row.website, row.chatLink, toTimestamp(at)],
    );
  }

  /**
   * Coins to check: metadata settled (read, or not content-addressed), and no origin yet, or
   * `not_checked_yet`, or a status a later post could change last checked before `recheckBefore`
   * and checked only once. Newest first.
   */
  async unchecked(sinceMs: Millis, recheckBefore: Millis, limit: number): Promise<readonly CoinToCheck[]> {
    const rows = await this.#db.query<{
      asset_key: string; address: string; symbol: string | null; name: string | null; minted_at: string | Date | null;
      m_name: string | null; m_ticker: string | null; image_uri: string | null; social_link: string | null; checks: number | null;
    }>(
      `select a.asset_key, a.address, a.symbol, a.name, a.minted_at,
              m.name as m_name, m.ticker as m_ticker, m.image_uri, m.social_link, o.checks
         from public.asset a
         join internal.coin_metadata m using (asset_key)
         left join internal.coin_origin o using (asset_key)
        where m.outcome in ('read', 'not_content_addressed')
          and a.first_seen_at >= $1
          and (o.asset_key is null
               or o.status = 'not_checked_yet'
               or (o.status = any($2::text[]) and o.checks = 1 and o.checked_at < $3))
        order by a.first_seen_at desc
        limit $4`,
      [toTimestamp(sinceMs), [...RECHECKED], toTimestamp(recheckBefore), limit],
    );
    return rows.map((r) => ({
      assetKey: r.asset_key,
      address: r.address,
      ticker: r.m_ticker ?? r.symbol ?? '',
      name: r.m_name ?? r.name ?? '',
      launchedAt: toMillis(r.minted_at),
      imageUri: r.image_uri,
      socialLink: r.social_link,
      checks: Number(r.checks ?? 0),
    }));
  }

  async recordOrigin(
    assetKey: string,
    origin: { readonly status: OriginStatus; readonly postItemId: ItemId | null; readonly postOffsetMs: number | null; readonly why: string },
    at: Millis,
    policyVersion: string,
  ): Promise<void> {
    await this.#db.query(
      `insert into internal.coin_origin (asset_key, status, post_item_id, post_offset_ms, why, checks, checked_at, policy_version)
       values ($1, $2, $3, $4, $5, 1, $6, $7)
       on conflict (asset_key) do update set
         status = excluded.status, post_item_id = excluded.post_item_id, post_offset_ms = excluded.post_offset_ms,
         why = excluded.why, checks = internal.coin_origin.checks + 1, checked_at = excluded.checked_at,
         policy_version = excluded.policy_version`,
      [assetKey, origin.status, origin.postItemId, origin.postOffsetMs, origin.why, toTimestamp(at), policyVersion],
    );
  }

  /**
   * Each feed post's name-search coins whose picture could be weighed against the post's: the
   * coin launched inside [post − allowanceMs, post + windowMs] (one launched earlier can never be
   * the post's), the coin has a picture (its metadata's, else the one stream gave), and the post
   * has a vector in `space`. With the similarity when the coin's picture is already embedded;
   * null when it is not yet. Newest post first. Read by the runner's coin-match step.
   */
  async postCoinPictures(space: string, allowanceMs: number, windowMs: number, limit: number): Promise<readonly PostCoinPicture[]> {
    const rows = await this.#db.query<{ item_id: string; asset_key: string; coin_uri: string; post_uri: string; similarity: number | string | null }>(
      `select p.item_id, a.asset_key, coalesce(m.image_uri, a.image_uri) as coin_uri, e.uri as post_uri,
              (select max(1 - (ae.embedding <=> e.embedding)) from internal.image_embedding ae
                where ae.subject_kind = 'asset' and ae.subject_id = a.asset_key and ae.space = $1
                  and ae.uri = coalesce(m.image_uri, a.image_uri)) as similarity
         from (select distinct item_id from public.rising_row where payload -> 'coins' ->> 'kind' in ('unsure', 'matched')) p
         join public.item i on i.item_id = p.item_id
         join internal.coin_lookup l on l.subject_kind = 'post' and l.subject_id = p.item_id and l.hits is not null
         cross join lateral unnest(l.hits) as h(address)
         join public.asset a on a.address = h.address
         left join internal.coin_metadata m on m.asset_key = a.asset_key
         join lateral (
                select x.uri, x.embedding from internal.image_embedding x
                 where x.subject_kind = 'item' and x.subject_id = p.item_id and x.space = $1
                 limit 1
              ) e on true
        where coalesce(m.image_uri, a.image_uri) is not null
          and a.minted_at is not null
          and a.minted_at >= coalesce(i.posted_at, i.first_seen_at) - make_interval(secs => $2::double precision / 1000)
          and a.minted_at <= coalesce(i.posted_at, i.first_seen_at) + make_interval(secs => $3::double precision / 1000)
        order by coalesce(i.posted_at, i.first_seen_at) desc, a.asset_key
        limit $4`,
      [space, allowanceMs, windowMs, limit],
    );
    return rows.map((r) => ({ itemId: r.item_id, assetKey: r.asset_key, coinUri: r.coin_uri, postUri: r.post_uri, similarity: r.similarity === null ? null : Number(r.similarity) }));
  }

  /**
   * Observed posts we hold, posted in [sinceMs, untilMs], whose text contains any of the terms
   * — a cheap first cut; core's `namesCoin` decides whole-word naming. Oldest first.
   */
  async postsNaming(terms: readonly string[], sinceMs: Millis, untilMs: Millis, limit: number): Promise<readonly NamingPost[]> {
    const usable = terms.map((t) => t.trim()).filter((t) => t.length >= 3);
    if (usable.length === 0) return [];
    const rows = await this.#db.query<{ item_id: string; posted_at: string | Date | null; body: string }>(
      `select item_id, posted_at, body
         from public.item
        where origin = 'observed'
          and posted_at between $1 and $2
          and body ilike any ($3::text[])
        order by posted_at asc
        limit $4`,
      [toTimestamp(sinceMs), toTimestamp(untilMs), usable.map((t) => `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`), limit],
    );
    return rows.map((r) => ({ itemId: reBrand<ItemId>(r.item_id), postedAt: toMillis(r.posted_at), text: r.body }));
  }

  /**
   * Observed posts we hold, posted in [sinceMs, untilMs], other than `itemId`, with a picture
   * whose vector in `space` is at least `minSimilarity` like one of `itemId`'s — the same
   * picture, at the near-identical bar — earliest first. Read by the origin check to find where a
   * matched post's picture started (core `earliestBySamePicture`). A post with no vector has none.
   */
  async postsWithSamePicture(itemId: string, space: string, minSimilarity: number, sinceMs: Millis, untilMs: Millis, limit: number): Promise<readonly NamingPost[]> {
    const rows = await this.#db.query<{ item_id: string; posted_at: string | Date | null; body: string }>(
      `select i.item_id, i.posted_at, i.body
         from internal.image_embedding me
         join internal.image_embedding ie on ie.subject_kind = 'item' and ie.space = me.space and ie.subject_id <> me.subject_id
         join public.item i on i.item_id = ie.subject_id
        where me.subject_kind = 'item' and me.subject_id = $1 and me.space = $2
          and i.origin = 'observed' and i.posted_at between $4 and $5
          and 1 - (ie.embedding <=> me.embedding) >= $3
        group by i.item_id, i.posted_at, i.body
        order by i.posted_at asc
        limit $6`,
      [itemId, space, minSimilarity, toTimestamp(sinceMs), toTimestamp(untilMs), limit],
    );
    return rows.map((r) => ({ itemId: reBrand<ItemId>(r.item_id), postedAt: toMillis(r.posted_at), text: r.body }));
  }

  /**
   * Notes every waiting subject not yet noted, at `at`. Run at the start of each pass, before the
   * caps decide how many are searched, so a post the caps leave for a later pass still has the
   * moment it was first seen waiting — the clock "Couldn't check" runs on. Never moves a time
   * already written (0048). Returns how many were new.
   */
  async queueLookups(at: Millis): Promise<number> {
    const rows = await this.#db.query<{ n: string | number }>(
      `with ${WAITING},
       added as (
         insert into internal.coin_lookup_attempt (subject_kind, subject_id, queued_at)
         select w.subject_kind, w.subject_id, $1 from waiting w
         on conflict (subject_kind, subject_id) do nothing
         returning 1
       )
       select count(*) as n from added`,
      [toTimestamp(at)],
    );
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * Names to search, in the order they are owed: feed posts first, newest into the feed first,
   * then narratives, newest promoted first. Skipped: a subject searched since `keepBefore`, and
   * one whose search failed `1 + retries` times in a row, until `keepBefore` has passed its last
   * failure — a source that is down for the day is not asked again every minute. A post searched
   * before 0051 that found coins is owed a search at once: its row has a count and no list, and
   * the card cannot offer "See N coins" until the list exists.
   */
  async lookupTerms(keepBefore: Millis, retries: number, limit: number): Promise<readonly LookupTerm[]> {
    const rows = await this.#db.query<{ subject_kind: 'story' | 'post'; subject_id: string; term: string; alternates: unknown; spans: unknown; attempts: number | null }>(
      `with ${WAITING}
       select w.subject_kind, w.subject_id, w.term, w.alternates, w.spans, a.attempts
         from waiting w
         left join internal.coin_lookup l on l.subject_kind = w.subject_kind and l.subject_id = w.subject_id
         left join internal.coin_lookup_attempt a on a.subject_kind = w.subject_kind and a.subject_id = w.subject_id
        where (l.subject_id is null or l.looked_at < $1 or (w.subject_kind = 'post' and l.hits is null and l.found > 0))
          and (a.subject_id is null or a.attempts <= $2 or a.last_failed_at < $1)
        order by (w.subject_kind = 'post') desc, a.queued_at desc nulls first, w.seen_at desc nulls last, w.subject_id
        limit $3`,
      [toTimestamp(keepBefore), retries, limit],
    );
    return rows.map((r) => {
      const strings = (v: unknown) => (Array.isArray(v) ? v.filter((n): n is string => typeof n === 'string' && n.trim() !== '') : []);
      /* A span short enough to be a name (the words the judge read in the post or its picture,
         "Koi-4B", "Banana Duck"); a longer one is a description and is not searched. */
      const spans = strings(r.spans).filter((t) => t.trim().split(/\s+/).length <= SPAN_NAME_WORDS);
      return { kind: r.subject_kind, id: r.subject_id, term: r.term, names: [...new Set([r.term, ...strings(r.alternates), ...spans])], attempts: Number(r.attempts ?? 0) };
    });
  }

  /**
   * A finished search: written over the last one, and the failed-attempt count starts again.
   * `hits` are the addresses kept, newest launch first; `more` says more came back than were
   * kept. Both together, so a row never has a list without saying whether it is the whole list.
   */
  async recordLookup(term: LookupTerm, kept: { readonly hits: readonly string[]; readonly more: boolean }, added: number, at: Millis): Promise<void> {
    await this.#db.query(
      `with reset as (
         update internal.coin_lookup_attempt set attempts = 0, last_error = null
          where subject_kind = $1 and subject_id = $2
       )
       insert into internal.coin_lookup (subject_kind, subject_id, term, looked_at, found, added, hits, more)
       values ($1, $2, $3, $4, $5, $6, $7::text[], $8)
       on conflict (subject_kind, subject_id) do update set
         term = excluded.term, looked_at = excluded.looked_at, found = excluded.found, added = excluded.added,
         hits = excluded.hits, more = excluded.more`,
      [term.kind, term.id, term.term, toTimestamp(at), kept.hits.length, added, [...kept.hits], kept.more],
    );
  }

  /**
   * A search every source failed on. Counted, never written to coin_lookup: an outage is not
   * "searched, nothing found". The error is kept bounded, for whoever reads the table.
   */
  async recordFailedLookup(term: LookupTerm, error: string, at: Millis): Promise<void> {
    await this.#db.query(
      `insert into internal.coin_lookup_attempt (subject_kind, subject_id, queued_at, attempts, last_failed_at, last_error)
       values ($1, $2, $3, 1, $3, $4)
       on conflict (subject_kind, subject_id) do update set
         attempts = internal.coin_lookup_attempt.attempts + 1, last_failed_at = excluded.last_failed_at, last_error = excluded.last_error`,
      [term.kind, term.id, toTimestamp(at), error.slice(0, 500)],
    );
  }

  /**
   * Searches made since an instant, finished or failed — what the per-minute and per-day caps
   * count. One per subject at most: a subject searched twice in the window counts once, which
   * can only happen across `keepMs` and so never inside a minute.
   */
  async searchesSince(at: Millis): Promise<number> {
    const rows = await this.#db.query<{ n: string | number }>(
      `select (select count(*) from internal.coin_lookup where looked_at >= $1)
            + (select count(*) from internal.coin_lookup_attempt a
                where a.last_failed_at >= $1
                  and not exists (select 1 from internal.coin_lookup l
                                   where l.subject_kind = a.subject_kind and l.subject_id = a.subject_id and l.looked_at >= $1)) as n`,
      [toTimestamp(at)],
    );
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * Coins past the keep-everything window that have not been asked about, oldest first. A coin
   * that is always kept is never asked about: there is nothing its answer could change.
   */
  async agedUnasked(firstSeenBefore: Millis, limit: number): Promise<readonly AgedCoin[]> {
    const rows = await this.#db.query<{ asset_key: string; address: string }>(
      `with ${NAMED_COINS}
       select a.asset_key, a.address
         from public.asset a
        where a.origin in ('live_stream', 'backfill') and a.first_seen_at < $1
          and not exists (select 1 from internal.coin_standing s where s.asset_key = a.asset_key)
          and not ${KEPT_ALWAYS}
        order by a.first_seen_at asc
        limit $2`,
      [toTimestamp(firstSeenBefore), limit],
    );
    return rows.map((r) => ({ assetKey: r.asset_key, address: r.address }));
  }

  /** What a source answered, for each coin asked about. The highest cap seen is kept, never lowered. */
  async recordStandings(rows: readonly StandingRow[], at: Millis): Promise<void> {
    if (rows.length === 0) return;
    await this.#db.query(
      `insert into internal.coin_standing (asset_key, listed, bonded, peak_market_cap_usd, checked_at)
       select * from unnest($1::text[], $2::boolean[], $3::boolean[], $4::double precision[], array_fill($5::timestamptz, array[cardinality($1::text[])]))
       on conflict (asset_key) do update set
         listed = internal.coin_standing.listed or excluded.listed,
         bonded = internal.coin_standing.bonded or excluded.bonded,
         peak_market_cap_usd = greatest(internal.coin_standing.peak_market_cap_usd, excluded.peak_market_cap_usd),
         checked_at = excluded.checked_at`,
      [rows.map((r) => r.assetKey), rows.map((r) => r.listed), rows.map((r) => r.bonded), rows.map((r) => r.marketCapUsd), toTimestamp(at)],
    );
  }

  /**
   * ★ DELETE THE OLD COINS THAT DO NOT MATTER: past the window, asked about, not bonded, and either
   * listed nowhere or seen only below the bar — and not one of the coins always kept. A deleted
   * coin that never traded leaves the name index too; one that traded stays findable by name. Their metadata and origin rows go
   * with them (on delete cascade). A coin not yet asked about is never deleted. Returns how many.
   */
  async sweep(firstSeenBefore: Millis, marketCapUsd: number, limit: number): Promise<number> {
    const rows = await this.#db.query<{ n: string | number }>(
      `with ${NAMED_COINS},
       doomed as (
         select a.asset_key
           from public.asset a
           join internal.coin_standing s on s.asset_key = a.asset_key
          where a.origin in ('live_stream', 'backfill') and a.first_seen_at < $1
            and not s.bonded
            /* Not listed: nobody traded it. Listed with no cap reported: unknown, so kept — an
               absence is never read as "below the bar". */
            and (not s.listed or s.peak_market_cap_usd < $2)
            and not ${KEPT_ALWAYS}
          order by a.first_seen_at asc
          limit $3
       ),
       gone as (delete from public.asset a using doomed d where a.asset_key = d.asset_key returning a.address),
       /* The name index (0037) keeps a deleted coin only if it ever traded: no market listed
          it, so nobody did, and a name nobody traded is not worth finding forever. */
       forgotten as (
         delete from public.coin_name n
          using gone g, internal.coin_standing s
          where n.address = g.address and s.asset_key = 'solana:' || g.address and not s.listed
         returning 1)
       select (select count(*) from gone) as n, (select count(*) from forgotten) as forgotten`,
      [toTimestamp(firstSeenBefore), marketCapUsd, limit],
    );
    return Number(rows[0]?.n ?? 0);
  }

  /** Which of these coins the universe already holds. */
  async knownAssets(assetKeys: readonly string[]): Promise<ReadonlySet<string>> {
    if (assetKeys.length === 0) return new Set();
    const rows = await this.#db.query<{ asset_key: string }>(`select asset_key from public.asset where asset_key = any($1::text[])`, [[...assetKeys]]);
    return new Set(rows.map((r) => r.asset_key));
  }
}

/** A narrative or post whose name is to be searched for coins. */
export interface LookupTerm {
  readonly kind: 'story' | 'post';
  readonly id: string;
  readonly term: string;
  /**
   * Every name the judge gave the subject: `term` (its proposed name) first, then its alternates,
   * then its short subject spans — the words it read in the post or its picture (the judge has
   * no separate reading of the picture's text, and asking for one would be a call per post).
   * The runner searches each (owner, 2026-10-13: the right coin was among one name's results
   * for only 25 of 71 gold origin posts). `term` stays the row's key and label.
   */
  readonly names?: readonly string[];
  /** Searches for it that failed on every source since the last one that finished. */
  readonly attempts: number;
}
