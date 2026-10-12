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
}
