/**
 * PICTURE HASHES (internal.image_hash, 0070): which pictures still need one, and the coins whose
 * logo is close to a post's picture.
 *
 * The runner hashes (services/runner picture-hashes.ts) and the projector reads (services/project
 * post-match.ts); this file is the one place the table's shape — a hash as a signed 64-bit
 * integer, compared by XOR and a bit count — is spelled out, so the two can never disagree on it.
 *
 * ★ BEFORE 0070 IS APPLIED every read here answers "nothing" (an empty list, an empty map) and
 * every write is skipped, so the runner and projector run as they did: an unknown hash is an
 * unknown, never "different". `missingTable` is the one test for that, by Postgres's own code.
 *
 * What breaks if changed carelessly: `toBits`. The 16 hex digits are read as one unsigned 64-bit
 * number and stored as its signed twin (Postgres has no unsigned bigint); any other packing makes
 * every distance in SQL wrong while the hashes in JavaScript still look fine.
 */

import type { Millis } from '@insidor/contracts';

import type { Db } from '../client.ts';

/** A picture to hash: a feed post's (already embedded, so it passed the judge) or a recent coin's logo. */
export interface DuePicture {
  readonly uri: string;
  readonly kind: 'post' | 'coin';
}

/** A coin whose logo is within the bar of a post's picture, with its distance in bits. */
export interface PictureNeighbour {
  readonly itemId: string;
  readonly address: string;
  readonly distance: number;
}

const UNDEFINED_TABLE = '42P01';
const UNDEFINED_COLUMN = '42703';
/** True when the error is Postgres saying the table or column (0070) is not there yet. */
export const missingTable = (e: unknown): boolean => {
  const code = (e as { code?: unknown } | null)?.code;
  return code === UNDEFINED_TABLE || code === UNDEFINED_COLUMN;
};

const TWO_63 = 1n << 63n;
const TWO_64 = 1n << 64n;
/** 16 hex digits as the signed 64-bit integer Postgres stores. */
export function toBits(hex: string): string {
  const u = BigInt(`0x${hex}`);
  return (u >= TWO_63 ? u - TWO_64 : u).toString();
}
/** The stored integer back to 16 hex digits. */
export function fromBits(bits: string | number | bigint): string {
  const s = BigInt(bits);
  return (s < 0n ? s + TWO_64 : s).toString(16).padStart(16, '0');
}

export class PgImageHashRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /**
   * Pictures with no hash yet, coins first (a logo hashed late is a coin the picture search
   * cannot find), newest first: coin logos minted since `coinsSinceMs` whose metadata was read,
   * and the pictures of posts embedded since `postsSinceMs`. A picture that failed `maxAttempts`
   * times is not asked about again.
   */
  async due(coinsSinceMs: Millis, postsSinceMs: Millis, coins: number, posts: number, maxAttempts: number): Promise<readonly DuePicture[]> {
    try {
      const rows = await this.#db.query<{ uri: string; kind: 'post' | 'coin' }>(
        `(select distinct on (u.uri) u.uri, 'coin' as kind
            from (select coalesce(m.image_uri, a.image_uri) as uri, a.minted_at
                    from public.asset a
                    left join internal.coin_metadata m on m.asset_key = a.asset_key and m.outcome = 'read'
                   where a.minted_at >= $1 and coalesce(m.image_uri, a.image_uri) is not null
                   order by a.minted_at desc
                   limit $3 * 4) u
            left join internal.image_hash h on h.uri = u.uri
           where h.uri is null or (h.bits is null and h.attempts < $5)
           limit $3)
         union all
         (select distinct e.uri, 'post' as kind
            from internal.image_embedding e
            left join internal.image_hash h on h.uri = e.uri
           where e.subject_kind = 'item' and e.embedded_at >= $2
             and (h.uri is null or (h.bits is null and h.attempts < $5))
           limit $4)`,
        [new Date(coinsSinceMs).toISOString(), new Date(postsSinceMs).toISOString(), coins, posts, maxAttempts],
      );
      return rows;
    } catch (e) {
      if (missingTable(e)) return [];
      throw e;
    }
  }

  /** One picture's hash; null when it could not be read (counted, so it stops being asked). */
  async record(uri: string, hex: string | null, version: string, at: Millis): Promise<void> {
    try {
      await this.#db.query(
        `insert into internal.image_hash (uri, bits, version, attempts, hashed_at) values ($1, $2::bigint, $3, 1, $4)
         on conflict (uri) do update set bits = coalesce(excluded.bits, internal.image_hash.bits), version = excluded.version,
                attempts = internal.image_hash.attempts + 1, hashed_at = excluded.hashed_at`,
        [uri, hex === null ? null : toBits(hex), version, new Date(at).toISOString()],
      );
    } catch (e) {
      if (!missingTable(e)) throw e;
    }
  }

  /** The hashes held for these pictures, as hex. */
  async hashesOf(uris: readonly string[], version: string): Promise<ReadonlyMap<string, string>> {
    if (uris.length === 0) return new Map();
    try {
      const rows = await this.#db.query<{ uri: string; bits: string }>(
        `select uri, bits::text as bits from internal.image_hash where uri = any($1::text[]) and bits is not null and version = $2`,
        [[...uris], version],
      );
      return new Map(rows.map((r) => [r.uri, fromBits(r.bits)]));
    } catch (e) {
      if (missingTable(e)) return new Map();
      throw e;
    }
  }

  /**
   * For each post picture, the coins minted in [post − allowance, post + window] whose logo is
   * within `maxDistance` bits of it: the picture search over the whole universe.
   */
  async neighbours(posts: readonly { readonly itemId: string; readonly uri: string; readonly postedAt: Millis }[], allowanceMs: number, windowMs: number, maxDistance: number, perPost: number, version: string): Promise<readonly PictureNeighbour[]> {
    if (posts.length === 0) return [];
    try {
      const rows = await this.#db.query<{ item_id: string; address: string; distance: number }>(
        `select p.item_id, n.address, n.distance
           from unnest($1::text[], $2::text[], $3::timestamptz[]) as p(item_id, uri, posted_at)
           join internal.image_hash ph on ph.uri = p.uri and ph.bits is not null and ph.version = $7
           cross join lateral (
                  select a.address, bit_count((ph.bits # ch.bits)::bit(64))::int as distance
                    from public.asset a
                    left join internal.coin_metadata m on m.asset_key = a.asset_key and m.outcome = 'read'
                    join internal.image_hash ch on ch.uri = coalesce(m.image_uri, a.image_uri) and ch.bits is not null and ch.version = $7
                   where a.minted_at between p.posted_at - make_interval(secs => $4::double precision / 1000)
                                         and p.posted_at + make_interval(secs => $5::double precision / 1000)
                     and bit_count((ph.bits # ch.bits)::bit(64)) <= $6
                   order by 2, a.minted_at
                   limit $8
                ) n`,
        [posts.map((p) => p.itemId), posts.map((p) => p.uri), posts.map((p) => new Date(p.postedAt).toISOString()), allowanceMs, windowMs, maxDistance, version, perPost],
      );
      return rows.map((r) => ({ itemId: r.item_id, address: r.address, distance: Number(r.distance) }));
    } catch (e) {
      if (missingTable(e)) return [];
      throw e;
    }
  }
}
