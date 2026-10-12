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
 *   - a coin a narrative or a post names on screen.
 */
const NAMED_COINS = `named as (
  select v.payload #>> '{coins,coin,coinId}' as k from public.story_view v where v.payload #>> '{coins,kind}' = 'one'
  union
  select c ->> 'coinId' from public.story_view v
   cross join lateral jsonb_array_elements(case when jsonb_typeof(v.payload #> '{coins,coins}') = 'array'
                                               then v.payload #> '{coins,coins}' else '[]'::jsonb end) c
  union
  select r.payload #>> '{coins,coin,coinId}' from public.rising_row r where r.payload #>> '{coins,kind}' = 'one'
)`;
const KEPT_ALWAYS = `(
  a.origin not in ('live_stream', 'backfill')
  or exists (select 1 from public.market_reading m where m.chain = a.chain and m.address = a.address)
  or exists (select 1 from internal.coin_origin o where o.asset_key = a.asset_key
              and (o.post_item_id is not null
                   or o.status in ('linked_by_creator', 'matched_by_insidor', 'found_by_team', 'influencer_origin', 'viral_after_launch')))
  or exists (select 1 from named n where n.k = a.asset_key)
)`;

/** Statuses a later post could change, so they are looked at once more. */
const RECHECKED: readonly OriginStatus[] = ['unlinked', 'account_only', 'promo_only'];

export class PgCoinUniverseRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /** Observed coins whose metadata is unread, or unavailable fewer than `maxAttempts` times — newest first. */
  async unread(sinceMs: Millis, maxAttempts: number, limit: number): Promise<readonly UnreadCoin[]> {
    const rows = await this.#db.query<{ asset_key: string; metadata_uri: string | null }>(
      `select a.asset_key, a.declared_social ->> 'metadata' as metadata_uri
         from public.asset a
         left join internal.coin_metadata m using (asset_key)
        where a.origin in ('live_stream', 'backfill')
          and a.first_seen_at >= $1
          and (m.asset_key is null or (m.outcome = 'unavailable' and m.attempts < $2))
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
   * Names to search: promoted narratives whose page shows no coin, and For You posts with no
   * coin, each by the judge's name for it — newest first, skipping any searched since
   * `keepBefore`. A subject the judge has not named has nothing to search and is not returned.
   */
  async lookupTerms(keepBefore: Millis, limit: number): Promise<readonly LookupTerm[]> {
    const rows = await this.#db.query<{ subject_kind: 'story' | 'post'; subject_id: string; term: string }>(
      `with stories as (
         select 'story' as subject_kind, s.story_id as subject_id, j.proposed_name as term, s.promoted_at as at
           from public.story s
           join public.story_view v on v.story_id = s.story_id
           join lateral (
             select proposed_name from internal.judgement jj
              where jj.story_id = s.story_id and jj.proposed_name is not null
              order by jj.judged_at desc limit 1
           ) j on true
          where s.state = 'promoted' and coalesce(v.payload -> 'coins' ->> 'kind', 'none') in ('none', 'pending')
       ),
       posts as (
         select distinct on (r.item_id) 'post' as subject_kind, r.item_id as subject_id, pj.proposed_name as term, i.first_seen_at as at
           from public.rising_row r
           join public.item i on i.item_id = r.item_id
           join internal.post_judgement pj on pj.item_id = r.item_id and pj.proposed_name is not null
          where r.payload -> 'coins' is null or r.payload ->> 'coins' = 'null'
          order by r.item_id, pj.judged_at desc
       )
       select c.subject_kind, c.subject_id, c.term
         from (select * from stories union all select * from posts) c
         left join internal.coin_lookup l on l.subject_kind = c.subject_kind and l.subject_id = c.subject_id
        where l.subject_id is null or l.looked_at < $1
        order by c.at desc nulls last
        limit $2`,
      [toTimestamp(keepBefore), limit],
    );
    return rows.map((r) => ({ kind: r.subject_kind, id: r.subject_id, term: r.term }));
  }

  async recordLookup(term: LookupTerm, found: number, added: number, at: Millis): Promise<void> {
    await this.#db.query(
      `insert into internal.coin_lookup (subject_kind, subject_id, term, looked_at, found, added)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (subject_kind, subject_id) do update set
         term = excluded.term, looked_at = excluded.looked_at, found = excluded.found, added = excluded.added`,
      [term.kind, term.id, term.term, toTimestamp(at), found, added],
    );
  }

  /** Searches since an instant — the day's count for the cap. */
  async lookupsSince(at: Millis): Promise<number> {
    const rows = await this.#db.query<{ n: string | number }>(`select count(*) as n from internal.coin_lookup where looked_at >= $1`, [toTimestamp(at)]);
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
   * listed nowhere or seen only below the bar — and not one of the coins always kept. Their metadata and origin rows go
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
       gone as (delete from public.asset a using doomed d where a.asset_key = d.asset_key returning 1)
       select count(*) as n from gone`,
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
}
